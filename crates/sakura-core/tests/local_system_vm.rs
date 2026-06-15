use sakura_core::InstallManifest;
use sakura_core::{
    classify_dsc_script, decompress_dsc, sniff_payload, ArcArchive, LoadedScriptKind, PayloadKind,
    Runtime, RuntimeConfig, ScriptId, SystemCallFamily, SystemHost, SystemInstructionKind,
    SystemProgram, SystemRuntime, SystemVm, SystemVmEvent, SystemVmEventOwned,
};
use std::collections::BTreeMap;
use std::collections::BTreeSet;
use std::env;
use std::error::Error;
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};

type TestResult<T> = std::result::Result<T, Box<dyn Error>>;
const MAX_DEEP_EVENTS_PER_SCRIPT: usize = 256;
const MAX_INSTRUCTIONS_PER_EVENT: usize = 100_000;
const ENTRY_SCRIPT_NAME: &[u8] = b"logwnd._bp";
const GRAPH9C_PROBE_OFFSET: usize = 0x12df;
const GRAPH88_PROBE_OFFSET: usize = 0x197;

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn executes_local_system_scripts_to_first_vm_event_without_asset_output() -> TestResult<()> {
    let game_dir = env::var_os("SAKURA_INSTALL_DIR")
        .map(PathBuf::from)
        .ok_or("SAKURA_INSTALL_DIR is required for this ignored local-install probe")?;
    let archive_paths = collect_archive_files(&game_dir)?;
    let mut system_scripts = 0usize;
    let mut first_service_events = 0usize;
    let mut first_user_script_calls = 0usize;
    let mut first_user_script_loads = 0usize;
    let mut first_user_script_frees = 0usize;
    let mut first_user_script_returns = 0usize;
    let mut first_halted = 0usize;
    let mut first_event_errors = 0usize;
    let mut first_standalone_dispatcher_errors = 0usize;
    let mut first_error_categories = BTreeMap::<&'static str, usize>::new();
    let mut first_error_messages = BTreeMap::<String, usize>::new();
    let mut first_error_opcodes = BTreeMap::<u8, usize>::new();
    let mut first_error_offsets = BTreeMap::<usize, usize>::new();
    let mut first_error_scripts = BTreeMap::<String, usize>::new();
    let mut first_error_opcode_trails = BTreeMap::<String, usize>::new();
    let mut first_service_counts = BTreeMap::<(u8, u8), usize>::new();
    let mut first_service_arg_buckets = [0usize; 8];
    let mut first_user_arg_buckets = [0usize; 8];

    let mut script_index = 0usize;
    for path in &archive_paths {
        let data = fs::read(path)?;
        let archive = ArcArchive::parse(&data)?;
        for entry in archive.entries() {
            let payload = archive.entry_data(entry)?;
            if sniff_payload(payload) != PayloadKind::Dsc {
                continue;
            }
            let decompressed = decompress_dsc(payload)?;
            if classify_dsc_script(entry.name.as_bytes(), &decompressed)
                != Some(LoadedScriptKind::System)
            {
                script_index += 1;
                continue;
            }
            system_scripts += 1;
            let mut vm = SystemVm::parse(&decompressed)?;
            match vm.next_event() {
                Ok(SystemVmEvent::ServiceCall {
                    family,
                    service_id,
                    args,
                }) => {
                    first_service_events += 1;
                    *first_service_counts
                        .entry((family_code(family), service_id))
                        .or_default() += 1;
                    first_service_arg_buckets[args.len().min(7)] += 1;
                }
                Ok(SystemVmEvent::UserScriptCall { args, .. }) => {
                    first_user_script_calls += 1;
                    first_user_arg_buckets[args.len().min(7)] += 1;
                }
                Ok(SystemVmEvent::LoadedProgramCall { args, .. }) => {
                    first_user_script_calls += 1;
                    first_user_arg_buckets[args.len().min(7)] += 1;
                }
                Ok(SystemVmEvent::UserScriptLoad) => first_user_script_loads += 1,
                Ok(SystemVmEvent::UserScriptFree { .. }) => first_user_script_frees += 1,
                Ok(SystemVmEvent::UserScriptReturn) => first_user_script_returns += 1,
                Ok(SystemVmEvent::Halted) => first_halted += 1,
                Err(error) => {
                    first_event_errors += 1;
                    let message = error.to_string();
                    let opcode_trail = format_opcode_trail(vm.recent_opcodes());
                    if is_standalone_dispatcher_error(&message, &opcode_trail) {
                        first_standalone_dispatcher_errors += 1;
                    }
                    *first_error_categories
                        .entry(error_category(&message))
                        .or_default() += 1;
                    *first_error_messages.entry(message).or_default() += 1;
                    if let Some(opcode) = vm.last_opcode() {
                        *first_error_opcodes.entry(opcode).or_default() += 1;
                    }
                    if let Some(offset) = vm.last_instruction_offset() {
                        *first_error_offsets.entry(offset).or_default() += 1;
                    }
                    *first_error_scripts
                        .entry(format!(
                            "{}:{:08x}:0x{:x}",
                            script_index,
                            fnv1a32(&decompressed),
                            vm.last_instruction_offset().unwrap_or(0)
                        ))
                        .or_default() += 1;
                    *first_error_opcode_trails.entry(opcode_trail).or_default() += 1;
                }
            }
            script_index += 1;
        }
    }

    println!("system_vm_first_event_probe_version=1");
    println!("system_script_count={system_scripts}");
    println!("system_vm_first_service_event_count={first_service_events}");
    println!("system_vm_first_user_script_call_count={first_user_script_calls}");
    println!("system_vm_first_user_script_load_count={first_user_script_loads}");
    println!("system_vm_first_user_script_free_count={first_user_script_frees}");
    println!("system_vm_first_user_script_return_count={first_user_script_returns}");
    println!("system_vm_first_halted_count={first_halted}");
    println!("system_vm_first_error_count={first_event_errors}");
    println!(
        "system_vm_first_standalone_dispatcher_error_count={first_standalone_dispatcher_errors}"
    );
    println!(
        "system_vm_first_unclassified_error_count={}",
        first_event_errors.saturating_sub(first_standalone_dispatcher_errors)
    );
    println!(
        "system_vm_first_error_top={}",
        format_error_categories(&first_error_categories)
    );
    println!(
        "system_vm_first_error_message_top={}",
        format_error_messages(&first_error_messages, 8)
    );
    println!(
        "system_vm_first_error_opcode_top={}",
        format_opcode_counts(&first_error_opcodes, 8)
    );
    println!(
        "system_vm_first_error_offset_top={}",
        format_offset_counts(&first_error_offsets, 8)
    );
    println!(
        "system_vm_first_error_script_top={}",
        format_string_counts(&first_error_scripts, 12)
    );
    println!(
        "system_vm_first_error_opcode_trail_top={}",
        format_string_counts(&first_error_opcode_trails, 8)
    );
    println!(
        "system_vm_first_service_top={}",
        format_top_service_counts(&first_service_counts, 12)
    );
    println!(
        "system_vm_first_service_arg_buckets={}",
        format_buckets(&first_service_arg_buckets)
    );
    println!(
        "system_vm_first_user_arg_buckets={}",
        format_buckets(&first_user_arg_buckets)
    );

    assert!(system_scripts > 0);
    assert!(first_service_events > 0 || first_user_script_calls > 0);
    assert!(first_event_errors < system_scripts);
    Ok(())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn executes_local_system_scripts_with_host_without_asset_output() -> TestResult<()> {
    let game_dir = env::var_os("SAKURA_INSTALL_DIR")
        .map(PathBuf::from)
        .ok_or("SAKURA_INSTALL_DIR is required for this ignored local-install probe")?;
    let archive_paths = collect_archive_files(&game_dir)?;
    let mut runtime = Runtime::new(RuntimeConfig::default());
    for path in &archive_paths {
        let data = fs::read(path)?;
        let archive_name = path
            .file_name()
            .and_then(OsStr::to_str)
            .map(|name| name.as_bytes().to_vec());
        runtime.mount_archive_data_named(data, archive_name.as_deref())?;
    }
    let script_library = runtime.scripts();
    let mut host = SystemHost::with_runtime(&runtime);
    let mut system_scripts = 0usize;
    let mut completed_scripts = 0usize;
    let mut event_limit_scripts = 0usize;
    let mut host_event_count = 0usize;
    let mut service_events = 0usize;
    let mut user_call_events = 0usize;
    let mut user_load_events = 0usize;
    let mut user_free_events = 0usize;
    let mut user_return_events = 0usize;
    let mut halted_events = 0usize;
    let mut error_count = 0usize;
    let mut standalone_dispatcher_errors = 0usize;
    let mut error_categories = BTreeMap::<&'static str, usize>::new();
    let mut error_messages = BTreeMap::<String, usize>::new();
    let mut error_opcodes = BTreeMap::<u8, usize>::new();
    let mut error_offsets = BTreeMap::<usize, usize>::new();
    let mut error_scripts = BTreeMap::<String, usize>::new();
    let mut error_opcode_trails = BTreeMap::<String, usize>::new();
    let mut service_counts = BTreeMap::<(u8, u8), usize>::new();
    let mut service_arg_kind_shapes = BTreeMap::<String, usize>::new();
    let mut limit_last_events = BTreeMap::<&'static str, usize>::new();
    let mut limit_event_counts = BTreeMap::<usize, usize>::new();
    let mut limit_user_call_counts = BTreeMap::<u8, usize>::new();
    let mut limit_user_call_shapes = BTreeMap::<String, usize>::new();
    let mut limit_user_call_handle_counts = BTreeMap::<u8, usize>::new();
    let mut limit_user_call_handle_targets = BTreeMap::<String, usize>::new();
    let mut user_call_shapes = BTreeMap::<String, usize>::new();
    let mut user_call_arg_kind_shapes = BTreeMap::<String, usize>::new();
    let mut user_call_handle_counts = BTreeMap::<u8, usize>::new();
    let mut user_call_handle_targets = BTreeMap::<String, usize>::new();
    let mut unknown_user_call_opcode_trails = BTreeMap::<String, usize>::new();
    let mut limit_service_counts = BTreeMap::<(u8, u8), usize>::new();
    let mut sys40_target_counts = BTreeMap::<String, usize>::new();

    let mut script_index = 0usize;
    for path in &archive_paths {
        let data = fs::read(path)?;
        let archive = ArcArchive::parse(&data)?;
        for entry in archive.entries() {
            let payload = archive.entry_data(entry)?;
            if sniff_payload(payload) != PayloadKind::Dsc {
                continue;
            }
            let decompressed = decompress_dsc(payload)?;
            if classify_dsc_script(entry.name.as_bytes(), &decompressed)
                != Some(LoadedScriptKind::System)
            {
                script_index += 1;
                continue;
            }
            system_scripts += 1;
            let mut vm = SystemVm::parse(&decompressed)?;
            let mut events_for_script = 0usize;
            let mut last_event_kind = "none";
            let mut last_user_call_id = None;
            let mut last_user_call_shape: Option<String> = None;
            let mut last_user_call_has_handle = false;
            let mut last_service_id = None;
            loop {
                if events_for_script == MAX_DEEP_EVENTS_PER_SCRIPT {
                    event_limit_scripts += 1;
                    *limit_last_events.entry(last_event_kind).or_default() += 1;
                    *limit_event_counts.entry(events_for_script).or_default() += 1;
                    if let Some(service_id) = last_user_call_id {
                        *limit_user_call_counts.entry(service_id).or_default() += 1;
                    }
                    if let Some(shape) = last_user_call_shape.as_ref() {
                        *limit_user_call_shapes.entry(shape.clone()).or_default() += 1;
                    }
                    if last_user_call_has_handle {
                        if let Some(service_id) = last_user_call_id {
                            *limit_user_call_handle_counts.entry(service_id).or_default() += 1;
                        }
                        if let Some(shape) = last_user_call_shape.as_ref() {
                            *limit_user_call_handle_targets
                                .entry(shape.clone())
                                .or_default() += 1;
                        }
                    }
                    if let Some((family, service_id)) = last_service_id {
                        *limit_service_counts
                            .entry((family, service_id))
                            .or_default() += 1;
                    }
                    break;
                }
                let event = match vm.next_event_with_limit(MAX_INSTRUCTIONS_PER_EVENT) {
                    Ok(event) => event,
                    Err(error) => {
                        error_count += 1;
                        let message = error.to_string();
                        let opcode_trail = format_opcode_trail(vm.recent_opcodes());
                        if is_standalone_dispatcher_error(&message, &opcode_trail) {
                            standalone_dispatcher_errors += 1;
                        }
                        *error_categories
                            .entry(error_category(&message))
                            .or_default() += 1;
                        *error_messages.entry(message).or_default() += 1;
                        if let Some(opcode) = vm.last_opcode() {
                            *error_opcodes.entry(opcode).or_default() += 1;
                        }
                        if let Some(offset) = vm.last_instruction_offset() {
                            *error_offsets.entry(offset).or_default() += 1;
                        }
                        *error_scripts
                            .entry(format!(
                                "{}:{:08x}:0x{:x}",
                                script_index,
                                fnv1a32(&decompressed),
                                vm.last_instruction_offset().unwrap_or(0)
                            ))
                            .or_default() += 1;
                        *error_opcode_trails.entry(opcode_trail).or_default() += 1;
                        break;
                    }
                };
                events_for_script += 1;
                host_event_count += 1;
                match &event {
                    SystemVmEvent::ServiceCall {
                        family,
                        service_id,
                        args,
                    } => {
                        last_event_kind = "service";
                        last_service_id = Some((family_code(*family), *service_id));
                        last_user_call_id = None;
                        last_user_call_has_handle = false;
                        last_user_call_shape = None;
                        service_events += 1;
                        *service_counts
                            .entry((family_code(*family), *service_id))
                            .or_default() += 1;
                        *service_arg_kind_shapes
                            .entry(format_service_arg_kinds(
                                family_code(*family),
                                *service_id,
                                args,
                            ))
                            .or_default() += 1;
                        if *family == SystemCallFamily::System && *service_id == 0x40 {
                            if let Some(target) = sys40_target_shape(script_library, args) {
                                *sys40_target_counts.entry(target).or_default() += 1;
                            }
                        }
                    }
                    SystemVmEvent::UserScriptCall { service_id, args } => {
                        last_event_kind = "user_call";
                        last_user_call_id = Some(*service_id);
                        let shape = format_user_call_shape(*service_id, args);
                        last_user_call_shape = Some(shape.clone());
                        *user_call_shapes.entry(shape).or_default() += 1;
                        *user_call_arg_kind_shapes
                            .entry(format_user_call_arg_kinds(*service_id, args))
                            .or_default() += 1;
                        last_user_call_has_handle = args.iter().any(|value| {
                            matches!(value, sakura_core::SystemValue::UserScriptHandle(_))
                        });
                        if last_user_call_has_handle {
                            *user_call_handle_counts.entry(*service_id).or_default() += 1;
                            for value in args {
                                if let Some(target) =
                                    describe_script_handle_from_value(script_library, value)
                                {
                                    *user_call_handle_targets.entry(target).or_default() += 1;
                                }
                            }
                        }
                        if args
                            .last()
                            .is_some_and(|value| matches!(value, sakura_core::SystemValue::Unknown))
                        {
                            *unknown_user_call_opcode_trails
                                .entry(format!(
                                    "{service_id:02x}:{}",
                                    format_opcode_trail(vm.recent_opcodes())
                                ))
                                .or_default() += 1;
                        }
                        last_service_id = None;
                        user_call_events += 1;
                    }
                    SystemVmEvent::LoadedProgramCall {
                        handle,
                        offset: _,
                        args,
                    } => {
                        last_event_kind = "user_call";
                        let service_id = *handle as u8;
                        last_user_call_id = Some(service_id);
                        let target = describe_script_handle(script_library, *handle);
                        let shape = format!(
                            "{}:target-{target}",
                            format_user_call_shape(service_id, args)
                        );
                        last_user_call_shape = Some(shape.clone());
                        *user_call_shapes.entry(shape).or_default() += 1;
                        *user_call_arg_kind_shapes
                            .entry(format_user_call_arg_kinds(service_id, args))
                            .or_default() += 1;
                        last_user_call_has_handle = true;
                        *user_call_handle_counts.entry(service_id).or_default() += 1;
                        *user_call_handle_targets.entry(target).or_default() += 1;
                        last_service_id = None;
                        user_call_events += 1;
                    }
                    SystemVmEvent::UserScriptLoad => {
                        last_event_kind = "user_load";
                        last_user_call_has_handle = false;
                        last_user_call_shape = None;
                        user_load_events += 1;
                    }
                    SystemVmEvent::UserScriptFree { .. } => {
                        last_event_kind = "user_free";
                        last_user_call_has_handle = false;
                        last_user_call_shape = None;
                        user_free_events += 1;
                    }
                    SystemVmEvent::UserScriptReturn => {
                        last_user_call_shape = None;
                        last_user_call_has_handle = false;
                        user_return_events += 1;
                    }
                    SystemVmEvent::Halted => {
                        halted_events += 1;
                        completed_scripts += 1;
                        break;
                    }
                }
                let Some(result) = host.event_result(&event) else {
                    completed_scripts += 1;
                    break;
                };
                if let Some(effect) = result.effect() {
                    for write in effect.writes() {
                        vm.apply_host_write(write)?;
                    }
                }
                if let Some(value) = result.into_value() {
                    vm.resume_with(value)?;
                }
            }
            script_index += 1;
        }
    }

    println!("system_vm_host_probe_version=1");
    println!("system_script_count={system_scripts}");
    println!(
        "system_vm_host_loaded_script_count={}",
        script_library.script_count()
    );
    println!(
        "system_vm_host_loaded_scenario_script_count={}",
        script_library.scenario_script_count()
    );
    println!(
        "system_vm_host_loaded_system_script_count={}",
        script_library.system_script_count()
    );
    println!("system_vm_host_event_count={host_event_count}");
    println!("system_vm_host_completed_script_count={completed_scripts}");
    println!("system_vm_host_event_limit_script_count={event_limit_scripts}");
    println!("system_vm_host_service_event_count={service_events}");
    println!("system_vm_host_user_call_event_count={user_call_events}");
    println!("system_vm_host_user_load_event_count={user_load_events}");
    println!("system_vm_host_user_free_event_count={user_free_events}");
    println!("system_vm_host_user_return_event_count={user_return_events}");
    println!("system_vm_host_halted_event_count={halted_events}");
    println!("system_vm_host_error_count={error_count}");
    println!("system_vm_host_standalone_dispatcher_error_count={standalone_dispatcher_errors}");
    println!(
        "system_vm_host_unclassified_error_count={}",
        error_count.saturating_sub(standalone_dispatcher_errors)
    );
    println!(
        "system_vm_host_error_top={}",
        format_error_categories(&error_categories)
    );
    println!(
        "system_vm_host_error_message_top={}",
        format_error_messages(&error_messages, 8)
    );
    println!(
        "system_vm_host_error_opcode_top={}",
        format_opcode_counts(&error_opcodes, 8)
    );
    println!(
        "system_vm_host_error_offset_top={}",
        format_offset_counts(&error_offsets, 8)
    );
    println!(
        "system_vm_host_error_script_top={}",
        format_string_counts(&error_scripts, 16)
    );
    println!(
        "system_vm_host_error_opcode_trail_top={}",
        format_string_counts(&error_opcode_trails, 8)
    );
    println!(
        "system_vm_host_limit_last_event_top={}",
        format_static_str_counts(&limit_last_events, 8)
    );
    println!(
        "system_vm_host_limit_event_count_top={}",
        format_usize_counts(&limit_event_counts, 8)
    );
    println!(
        "system_vm_host_limit_user_call_top={}",
        format_opcode_counts(&limit_user_call_counts, 12)
    );
    println!(
        "system_vm_host_limit_user_call_shape_top={}",
        format_string_counts(&limit_user_call_shapes, 16)
    );
    println!(
        "system_vm_host_limit_user_call_handle_top={}",
        format_opcode_counts(&limit_user_call_handle_counts, 12)
    );
    println!(
        "system_vm_host_limit_user_call_handle_target_top={}",
        format_string_counts(&limit_user_call_handle_targets, 16)
    );
    println!(
        "system_vm_host_user_call_shape_top={}",
        format_string_counts(&user_call_shapes, 16)
    );
    println!(
        "system_vm_host_user_call_arg_kind_top={}",
        format_string_counts(&user_call_arg_kind_shapes, 16)
    );
    println!(
        "system_vm_host_user_call_handle_top={}",
        format_opcode_counts(&user_call_handle_counts, 12)
    );
    println!(
        "system_vm_host_user_call_handle_target_top={}",
        format_string_counts(&user_call_handle_targets, 16)
    );
    println!(
        "system_vm_host_unknown_user_call_trail_top={}",
        format_string_counts(&unknown_user_call_opcode_trails, 16)
    );
    println!(
        "system_vm_host_limit_service_top={}",
        format_top_service_counts(&limit_service_counts, 12)
    );
    println!(
        "system_vm_host_service_top={}",
        format_top_service_counts(&service_counts, 16)
    );
    println!(
        "system_vm_host_sys40_count={}",
        service_counts.get(&(0, 0x40)).copied().unwrap_or(0)
    );
    println!(
        "system_vm_host_sys40_arg_kind_top={}",
        format_prefixed_string_counts(&service_arg_kind_shapes, "sys:40:", 8)
    );
    println!(
        "system_vm_host_sys40_target_top={}",
        format_string_counts(&sys40_target_counts, 16)
    );
    println!(
        "system_vm_host_graph88_count={}",
        service_counts.get(&(1, 0x88)).copied().unwrap_or(0)
    );
    println!(
        "system_vm_host_graph9c_count={}",
        service_counts.get(&(1, 0x9c)).copied().unwrap_or(0)
    );
    println!(
        "system_vm_host_sound_service_count={}",
        service_counts
            .iter()
            .filter_map(|(&(family, _), count)| (family == 2).then_some(*count))
            .sum::<usize>()
    );

    assert!(system_scripts > 0);
    assert!(host_event_count > system_scripts);
    assert!(error_count < system_scripts);
    Ok(())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn dispatches_ranked_local_system_entry_without_asset_output() -> TestResult<()> {
    probe_named_runtime_entry(ENTRY_SCRIPT_NAME, None, "entry")
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn dispatches_ranked_local_graph_offsets_without_asset_output() -> TestResult<()> {
    probe_named_runtime_entry(ENTRY_SCRIPT_NAME, Some(GRAPH9C_PROBE_OFFSET), "graph9c")?;
    probe_named_runtime_entry(ENTRY_SCRIPT_NAME, Some(GRAPH88_PROBE_OFFSET), "graph88")
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn dispatches_ipl_bootstrap_without_asset_output() -> TestResult<()> {
    let game_dir = env::var_os("SAKURA_INSTALL_DIR")
        .map(PathBuf::from)
        .ok_or("SAKURA_INSTALL_DIR is required for this ignored local-install probe")?;
    let mut runtime = Runtime::new(RuntimeConfig::default());
    for path in collect_archive_files(&game_dir)? {
        let archive_name = path
            .file_name()
            .and_then(OsStr::to_str)
            .map(|name| name.as_bytes().to_vec());
        runtime.mount_archive_data_named(fs::read(path)?, archive_name.as_deref())?;
    }
    let scripts = runtime.scripts();
    let entry_id = scripts
        .find_by_name_bytes(b"ipl._bp")
        .ok_or("ipl bootstrap script is missing")?;
    let host = SystemHost::with_runtime(&runtime);
    let mut system_runtime = SystemRuntime::new(scripts, host);
    system_runtime.push_script(entry_id, Vec::new())?;
    let (summary, trace) =
        system_runtime.run_with_service_trace(4096, MAX_INSTRUCTIONS_PER_EVENT, 16)?;

    println!("system_runtime_ipl_probe_version=1");
    println!("system_runtime_ipl_index={}", entry_id.index());
    println!("system_runtime_event_count={}", summary.event_count);
    println!(
        "system_runtime_service_event_count={}",
        summary.service_event_count
    );
    println!(
        "system_runtime_service_trace_total_count={}",
        trace.total_service_count
    );
    println!(
        "system_runtime_service_trace_recorded_count={}",
        trace.recorded_services.len()
    );
    if let Some(first) = trace.recorded_services.first() {
        println!(
            "system_runtime_service_trace_first={}:{}:argc{}:top{}",
            family_label(family_code(first.family)),
            first.service_id,
            first.arg_count.min(7),
            first.top_kind
        );
    } else {
        println!("system_runtime_service_trace_first=none");
    }
    println!(
        "system_runtime_user_call_event_count={}",
        summary.user_call_event_count
    );
    println!("system_runtime_completed={}", u8::from(summary.completed));
    println!(
        "system_runtime_event_limited={}",
        u8::from(summary.event_limited)
    );
    println!(
        "system_runtime_syscall_top={}",
        format_top_counts(&summary.syscall_service_counts, 12)
    );
    println!(
        "system_runtime_graphcall_top={}",
        format_top_counts(&summary.graphcall_service_counts, 12)
    );
    println!(
        "system_runtime_soundcall_top={}",
        format_top_counts(&summary.soundcall_service_counts, 12)
    );
    println!(
        "system_runtime_extcall_top={}",
        format_top_counts(&summary.extcall_service_counts, 12)
    );
    println!(
        "system_runtime_user_dispatch_top={}",
        format_top_counts(&summary.user_script_dispatch_counts, 12)
    );
    println!(
        "system_runtime_graph88_count={}",
        summary.graphcall_service_counts[0x88]
    );
    println!(
        "system_runtime_graph9c_count={}",
        summary.graphcall_service_counts[0x9c]
    );
    println!(
        "system_runtime_sound_service_count={}",
        summary.soundcall_service_counts.iter().sum::<usize>()
    );

    assert!(summary.event_count > 0);
    assert_eq!(trace.total_service_count, summary.service_event_count);
    Ok(())
}

fn probe_named_runtime_entry(
    entry_name: &[u8],
    offset: Option<usize>,
    label: &str,
) -> TestResult<()> {
    let game_dir = env::var_os("SAKURA_INSTALL_DIR")
        .map(PathBuf::from)
        .ok_or("SAKURA_INSTALL_DIR is required for this ignored local-install probe")?;
    let mut runtime = Runtime::new(RuntimeConfig::default());
    for path in collect_archive_files(&game_dir)? {
        let archive_name = path
            .file_name()
            .and_then(OsStr::to_str)
            .map(|name| name.as_bytes().to_vec());
        runtime.mount_archive_data_named(fs::read(path)?, archive_name.as_deref())?;
    }
    let scripts = runtime.scripts();
    let entry_id = scripts
        .find_by_name_bytes(entry_name)
        .ok_or("named local entry script is missing")?;
    let host = SystemHost::with_runtime(&runtime);
    let mut system_runtime = SystemRuntime::new(scripts, host);
    system_runtime.push_script_at(entry_id, offset, Vec::new())?;
    let (summary, trace) =
        system_runtime.run_with_service_trace(4096, MAX_INSTRUCTIONS_PER_EVENT, 16)?;

    println!("system_runtime_ranked_entry_probe_version=1");
    println!("system_runtime_probe_label={label}");
    println!("system_runtime_entry_index={}", entry_id.index());
    println!(
        "system_runtime_entry_offset={}",
        offset.map_or_else(|| "default".to_owned(), |offset| format!("0x{offset:x}"))
    );
    println!("system_runtime_event_count={}", summary.event_count);
    println!(
        "system_runtime_service_event_count={}",
        summary.service_event_count
    );
    println!(
        "system_runtime_service_trace_total_count={}",
        trace.total_service_count
    );
    println!(
        "system_runtime_service_trace_recorded_count={}",
        trace.recorded_services.len()
    );
    println!(
        "system_runtime_service_trace_first={}",
        format_service_trace_first(&trace.recorded_services)
    );
    println!(
        "system_runtime_user_call_event_count={}",
        summary.user_call_event_count
    );
    println!(
        "system_runtime_user_return_event_count={}",
        summary.user_return_event_count
    );
    println!(
        "system_runtime_halted_event_count={}",
        summary.halted_event_count
    );
    println!("system_runtime_completed={}", u8::from(summary.completed));
    println!(
        "system_runtime_event_limited={}",
        u8::from(summary.event_limited)
    );
    println!("system_runtime_max_call_depth={}", summary.max_call_depth);
    println!(
        "system_runtime_last_event_kind={}",
        system_host_event_kind_label(summary.last_event_kind)
    );
    println!(
        "system_runtime_syscall_top={}",
        format_top_counts(&summary.syscall_service_counts, 12)
    );
    println!(
        "system_runtime_graphcall_top={}",
        format_top_counts(&summary.graphcall_service_counts, 12)
    );
    println!(
        "system_runtime_soundcall_top={}",
        format_top_counts(&summary.soundcall_service_counts, 12)
    );
    println!(
        "system_runtime_extcall_top={}",
        format_top_counts(&summary.extcall_service_counts, 12)
    );
    println!(
        "system_runtime_user_dispatch_top={}",
        format_top_counts(&summary.user_script_dispatch_counts, 12)
    );
    println!(
        "system_runtime_graph88_count={}",
        summary.graphcall_service_counts[0x88]
    );
    println!(
        "system_runtime_graph9c_count={}",
        summary.graphcall_service_counts[0x9c]
    );
    println!(
        "system_runtime_sound_service_count={}",
        summary.soundcall_service_counts.iter().sum::<usize>()
    );
    println!(
        "system_runtime_first_graph88_shape=argc{}:top-{}",
        summary.first_graph88_arg_count,
        system_value_kind_code_label(summary.first_graph88_top_kind)
    );
    println!(
        "system_runtime_first_graph9c_shape=argc{}:top-{}",
        summary.first_graph9c_arg_count,
        system_value_kind_code_label(summary.first_graph9c_top_kind)
    );
    println!(
        "system_runtime_first_sound_shape=id{:02x}:argc{}:top-{}",
        summary.first_sound_service_id,
        summary.first_sound_arg_count,
        system_value_kind_code_label(summary.first_sound_top_kind)
    );

    assert!(summary.event_count > 0);
    assert!(summary.service_event_count > 0 || summary.user_call_event_count > 0);
    assert_eq!(trace.total_service_count, summary.service_event_count);
    Ok(())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn traces_scrdrv_userdata_loaded_call_shape() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let scripts = runtime.scripts();
    let entry = scripts
        .find_by_name_bytes(b"scrdrv._bp")
        .ok_or("scrdrv._bp is missing")?;
    let mut host = SystemHost::with_runtime(&runtime);
    let mut vm = scripts
        .system_vm(entry)?
        .ok_or("scrdrv._bp is not a system script")?;

    println!("local_scrdrv_userdata_call_probe_version=1");
    for event_index in 0..32usize {
        let event = vm.next_event()?;
        println!(
            "local_scrdrv_userdata_call_event={} kind={}",
            event_index,
            describe_event(&event)
        );
        if let SystemVmEvent::LoadedProgramCall {
            handle,
            offset: _,
            args,
        } = &event
        {
            let target = describe_script_handle(scripts, *handle);
            println!("local_scrdrv_userdata_call_target={target}");
            println!("local_scrdrv_userdata_call_args={}", format_values(args));
            println!(
                "local_scrdrv_userdata_call_arg_kinds={}",
                format_user_call_arg_kinds(0xff, args)
            );
            if target.contains("userdata._bp") {
                assert!(args.len() >= 3);
                return Ok(());
            }
        }
        let Some(result) = host.event_result(&event) else {
            break;
        };
        if let Some(effect) = result.effect() {
            for write in effect.writes() {
                vm.apply_host_write(write)?;
            }
        }
        if let Some(value) = result.into_value() {
            vm.resume_with(value)?;
        }
    }
    Err("userdata._bp loaded call was not observed from scrdrv._bp".into())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn reproduces_userdata_selector_six_with_scrdrv_arguments() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let scripts = runtime.scripts();
    let entry = scripts
        .find_by_name_bytes(b"userdata._bp")
        .ok_or("userdata._bp is missing")?;
    let host = SystemHost::with_runtime(&runtime);
    let mut system_runtime = SystemRuntime::new(scripts, host);
    system_runtime.push_script(
        entry,
        vec![
            sakura_core::SystemValue::VariablePointer(0x18),
            sakura_core::SystemValue::Integer(100),
            sakura_core::SystemValue::Integer(6),
        ],
    )?;

    println!("local_userdata_selector_six_probe_version=1");
    for step in 0..8usize {
        let summary = system_runtime.run(1, MAX_INSTRUCTIONS_PER_EVENT)?;
        let frame = system_runtime.current_frame_state();
        println!(
            "local_userdata_selector_six_step={} completed={} limited={} events={} services={} user_calls={} halted={} frame={}",
            step,
            u8::from(summary.completed),
            u8::from(summary.event_limited),
            summary.event_count,
            summary.service_event_count,
            summary.user_call_event_count,
            summary.halted_event_count,
            frame
                .as_ref()
                .map(|frame| format!(
                    "{}:0x{:x}",
                    frame.script_index, frame.last_instruction_offset
                ))
                .unwrap_or_else(|| "none".to_owned())
        );
        if summary.completed {
            break;
        }
    }
    Ok(())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn reproduces_userdata_selector_six_from_scrdrv_loaded_call_context() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let scripts = runtime.scripts();
    let scrdrv = scripts
        .find_by_name_bytes(b"scrdrv._bp")
        .ok_or("scrdrv._bp is missing")?;
    let mut host = SystemHost::with_runtime(&runtime);
    let mut vm = scripts
        .system_vm(scrdrv)?
        .ok_or("scrdrv._bp is not a system script")?;

    println!("local_userdata_selector_six_scrdrv_context_probe_version=1");
    for event_index in 0..32usize {
        let event = vm.next_event()?;
        println!(
            "local_userdata_selector_six_scrdrv_event={} kind={} cursor={} last=0x{:x} mem_ptr=0x{:x} stack={}",
            event_index,
            describe_event(&event),
            vm.cursor(),
            vm.last_instruction_offset().unwrap_or(0),
            vm.mem_ptr(),
            format_values(vm.stack()),
        );
        if let SystemVmEvent::LoadedProgramCall { handle, args, .. } = &event {
            let target = describe_script_handle(scripts, *handle);
            if target.contains("userdata._bp") {
                println!("local_userdata_selector_six_scrdrv_target={target}");
                println!(
                    "local_userdata_selector_six_scrdrv_args={}",
                    format_values(args)
                );
                println!(
                    "local_userdata_selector_six_scrdrv_raw1044={}",
                    vm.host_integer_raw(1044, 2).unwrap_or(0)
                );
                println!(
                    "local_userdata_selector_six_scrdrv_raw144576={}",
                    vm.host_integer_raw(144576, 2).unwrap_or(0)
                );
                println!(
                    "local_userdata_selector_six_scrdrv_raw603604={}",
                    vm.host_integer_raw(603604, 2).unwrap_or(0)
                );
                return Ok(());
            }
        }
        let Some(result) = host.event_result(&event) else {
            break;
        };
        if let Some(effect) = result.effect() {
            for write in effect.writes() {
                vm.apply_host_write(write)?;
            }
        }
        if let Some(value) = result.into_value() {
            vm.resume_with(value)?;
        }
    }
    Err("userdata._bp loaded call with scrdrv context was not observed".into())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn traces_userdata_sys34_from_scrdrv_context() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let scripts = runtime.scripts();
    let scrdrv = scripts
        .find_by_name_bytes(b"scrdrv._bp")
        .ok_or("scrdrv._bp is missing")?;
    let host = SystemHost::with_runtime(&runtime);
    let mut system_runtime = SystemRuntime::new(scripts, host);
    system_runtime.push_script(scrdrv, Vec::new())?;

    println!("local_userdata_sys34_from_scrdrv_context_probe_version=1");
    for step in 0..24usize {
        let (summary, trace) =
            system_runtime.run_with_service_trace(1, MAX_INSTRUCTIONS_PER_EVENT, 4)?;
        let frame = system_runtime.current_frame_state();
        let head = trace.recorded_services.first();
        println!(
            "local_userdata_sys34_from_scrdrv_context_step={} completed={} limited={} events={} services={} user_calls={} halted={} frame={} trace={}",
            step,
            u8::from(summary.completed),
            u8::from(summary.event_limited),
            summary.event_count,
            summary.service_event_count,
            summary.user_call_event_count,
            summary.halted_event_count,
            frame
                .as_ref()
                .map(|frame| format!("{}:0x{:x}", frame.script_index, frame.last_instruction_offset))
                .unwrap_or_else(|| "none".to_owned()),
            head
                .map(|event| format!(
                    "{}:{:02x}:argc{}:str{}:{}",
                    family_label(family_code(event.family)),
                    event.service_id,
                    event.arg_count,
                    event.first_string_len,
                    event.first_string_hash
                ))
                .unwrap_or_else(|| "none".to_owned())
        );
        if let Some(event) = trace.recorded_services.first() {
            if event.family == sakura_core::SystemCallFamily::System && event.service_id == 0x34 {
                println!(
                    "local_userdata_sys34_from_scrdrv_context_args={}",
                    format_arg_slots(event)
                );
                if let Some(slot) = event.arg_slots.iter().find(|slot| slot.kind == 2) {
                    let text = system_runtime
                        .current_frame_bytes_raw(slot.value, slot.len as usize)
                        .map(|bytes| {
                            let end = bytes
                                .iter()
                                .position(|byte| *byte == 0)
                                .unwrap_or(bytes.len());
                            String::from_utf8_lossy(&bytes[..end]).into_owned()
                        })
                        .unwrap_or_else(|| "<unreadable>".to_owned());
                    println!(
                        "local_userdata_sys34_from_scrdrv_context_string_addr=0x{:x}",
                        slot.value
                    );
                    println!(
                        "local_userdata_sys34_from_scrdrv_context_string_len={}",
                        slot.len
                    );
                    println!(
                        "local_userdata_sys34_from_scrdrv_context_string_text={}",
                        text
                    );
                }
                println!(
                    "local_userdata_sys34_from_scrdrv_context_host_name={}",
                    String::from_utf8_lossy(system_runtime.host_last_asset_name())
                );
                return Ok(());
            }
        }
        if summary.completed {
            break;
        }
    }
    Err("sys:34 was not observed from scrdrv context".into())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn traces_scrdrv_sys33_context_and_codeptr_state() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let scripts = runtime.scripts();
    let scrdrv = scripts
        .find_by_name_bytes(b"scrdrv._bp")
        .ok_or("scrdrv._bp is missing")?;
    let host = SystemHost::with_runtime(&runtime);
    let mut system_runtime = SystemRuntime::new(scripts, host);
    system_runtime.push_script(scrdrv, Vec::new())?;

    let watched = [
        1044u32, 260, 123420, 123424, 128560, 128564, 128576, 144576, 603604,
    ];
    println!("local_scrdrv_sys33_context_probe_version=1");
    for step in 0..64usize {
        let frame_before = system_runtime.current_frame_state();
        let raw_before = watched
            .iter()
            .map(|address| {
                format!(
                    "0x{address:x}={:#010x}",
                    system_runtime
                        .current_frame_integer_raw(*address, 2)
                        .unwrap_or(0)
                )
            })
            .collect::<Vec<_>>()
            .join(",");
        let (summary, trace) =
            system_runtime.run_with_service_trace(1, MAX_INSTRUCTIONS_PER_EVENT, 8)?;
        let frame_after = system_runtime.current_frame_state();
        let raw_after = watched
            .iter()
            .map(|address| {
                format!(
                    "0x{address:x}={:#010x}",
                    system_runtime
                        .current_frame_integer_raw(*address, 2)
                        .unwrap_or(0)
                )
            })
            .collect::<Vec<_>>()
            .join(",");
        let head = trace.recorded_services.first().map(format_arg_slots);
        let service = trace.recorded_services.first().map(|event| {
            format!(
                "{}:{:02x}:argc{}",
                family_label(family_code(event.family)),
                event.service_id,
                event.arg_count
            )
        });
        println!(
            "local_scrdrv_sys33_context_step={} completed={} limited={} events={} services={} user_calls={} halted={} before_frame={} after_frame={} service={} args={} raw_before={} raw_after={} stack_before={} stack_after={}",
            step,
            u8::from(summary.completed),
            u8::from(summary.event_limited),
            summary.event_count,
            summary.service_event_count,
            summary.user_call_event_count,
            summary.halted_event_count,
            frame_before
                .as_ref()
                .map(|frame| format!("{}:0x{:x}", frame.script_index, frame.last_instruction_offset))
                .unwrap_or_else(|| "none".to_owned()),
            frame_after
                .as_ref()
                .map(|frame| format!("{}:0x{:x}", frame.script_index, frame.last_instruction_offset))
                .unwrap_or_else(|| "none".to_owned()),
            service.unwrap_or_else(|| "none".to_owned()),
            head.unwrap_or_else(|| "none".to_owned()),
            raw_before,
            raw_after,
            frame_before
                .as_ref()
                .map(|frame| format!("mem=0x{:x}", frame.mem_ptr))
                .unwrap_or_else(|| "mem=none".to_owned()),
            frame_after
                .as_ref()
                .map(|frame| format!("mem=0x{:x}", frame.mem_ptr))
                .unwrap_or_else(|| "mem=none".to_owned()),
        );
        if trace.recorded_services.first().is_some_and(|event| {
            event.family == sakura_core::SystemCallFamily::System && event.service_id == 0x33
        }) {
            return Ok(());
        }
        if summary.completed {
            break;
        }
    }
    Err("sys:33 was not observed from scrdrv context".into())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn traces_scrdrv_sys44_strings() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let scripts = runtime.scripts();
    let scrdrv = scripts
        .find_by_name_bytes(b"scrdrv._bp")
        .ok_or("scrdrv._bp is missing")?;
    let host = SystemHost::with_runtime(&runtime);
    let mut system_runtime = SystemRuntime::new(scripts, host);
    system_runtime.push_script(scrdrv, Vec::new())?;

    println!("local_scrdrv_sys44_probe_version=1");
    for step in 0..160usize {
        let (summary, trace) =
            system_runtime.run_with_service_trace(1, MAX_INSTRUCTIONS_PER_EVENT, 8)?;
        let frame = system_runtime.current_frame_state();
        if let Some(event) = trace.recorded_services.first() {
            if event.family == sakura_core::SystemCallFamily::System && event.service_id == 0x44 {
                println!(
                    "local_scrdrv_sys44_step={} frame={} args={}",
                    step,
                    frame
                        .as_ref()
                        .map(|frame| format!(
                            "{}:0x{:x}",
                            frame.script_index, frame.last_instruction_offset
                        ))
                        .unwrap_or_else(|| "none".to_owned()),
                    format_arg_slots(event)
                );
                return Ok(());
            }
        }
        if summary.completed {
            break;
        }
    }
    Err("sys:44 was not observed from scrdrv context".into())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn traces_scrdrv_runtime_transition_services() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let scripts = runtime.scripts();
    let scrdrv = scripts
        .find_by_name_bytes(b"scrdrv._bp")
        .ok_or("scrdrv._bp is missing")?;
    let host = SystemHost::with_runtime(&runtime);
    let mut system_runtime = SystemRuntime::new(scripts, host);
    system_runtime.push_script(scrdrv, Vec::new())?;

    println!("local_scrdrv_runtime_transition_probe_version=1");
    for step in 0..320usize {
        let (summary, trace, pending_asset) =
            system_runtime.run_with_service_trace_until_asset(1, MAX_INSTRUCTIONS_PER_EVENT, 16)?;
        let frame = system_runtime.current_frame_state();
        if let Some(pending) = pending_asset {
            println!(
                "local_scrdrv_runtime_transition_pending step={} frame={} service={} asset_name={} asset_size={}",
                step,
                frame
                    .as_ref()
                    .map(|frame| format!("{}:0x{:x}", frame.script_index, frame.last_instruction_offset))
                    .unwrap_or_else(|| "none".to_owned()),
                match pending.event {
                    SystemVmEventOwned::ServiceCall { family, service_id, .. } => {
                        format!("{}:{:02x}", family_label(family_code(family)), service_id)
                    }
                    _ => "other".to_owned(),
                },
                String::from_utf8_lossy(&pending.request.name),
                pending.request.size,
            );
            return Ok(());
        }

        if let Some(event) = trace.recorded_services.first() {
            if event.family == sakura_core::SystemCallFamily::System
                && matches!(event.service_id, 0x14 | 0x44 | 0x98 | 0xd0)
            {
                println!(
                    "local_scrdrv_runtime_transition_step={} completed={} limited={} frame={} service=sys:{:02x} args={} local44={} local48={} local64={} local68={} local3956={} local4024={} local7100={} local7108={} host_name={}",
                    step,
                    u8::from(summary.completed),
                    u8::from(summary.event_limited),
                    frame
                        .as_ref()
                        .map(|frame| format!("{}:0x{:x}", frame.script_index, frame.last_instruction_offset))
                        .unwrap_or_else(|| "none".to_owned()),
                    event.service_id,
                    format_arg_slots(event),
                    frame.as_ref().map_or(0, |frame| frame.local_44),
                    frame.as_ref().map_or(0, |frame| frame.local_48),
                    frame.as_ref().map_or(0, |frame| frame.local_64),
                    frame.as_ref().map_or(0, |frame| frame.local_68),
                    frame.as_ref().map_or(0, |frame| frame.local_3956),
                    frame.as_ref().map_or(0, |frame| frame.local_4024),
                    frame.as_ref().map_or(0, |frame| frame.local_7100),
                    frame.as_ref().map_or(0, |frame| frame.local_7108),
                    String::from_utf8_lossy(system_runtime.host_last_asset_name()),
                );
                for (index, slot) in event
                    .arg_slots
                    .iter()
                    .take(event.arg_count.min(event.arg_slots.len()))
                    .enumerate()
                {
                    if slot.kind != 2 {
                        continue;
                    }
                    if let Some(bytes) =
                        system_runtime.current_frame_bytes_raw(slot.value, slot.len as usize)
                    {
                        let end = bytes
                            .iter()
                            .position(|byte| *byte == 0)
                            .unwrap_or(bytes.len());
                        let text = String::from_utf8_lossy(&bytes[..end]);
                        println!(
                            "local_scrdrv_runtime_transition_arg_string step={} arg={} addr=0x{:x} len={} text={}",
                            step,
                            index,
                            slot.value,
                            slot.len,
                            text,
                        );
                    }
                }
            }
        }
        if summary.completed {
            break;
        }
    }
    Ok(())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn dumps_scrdrv_transition_instruction_window() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let scripts = runtime.scripts();
    let scrdrv = scripts
        .find_by_name_bytes(b"scrdrv._bp")
        .ok_or("scrdrv._bp is missing")?;
    let script = scripts
        .script(scrdrv)
        .ok_or("scrdrv._bp payload is missing")?;
    let program = SystemProgram::parse(script.decompressed())?;

    println!("local_scrdrv_transition_instruction_window_version=1");
    for offset in [
        0x20eusize, 0xd7a, 0xf06, 0xf19, 0x1047, 0x1080, 0x1e9d, 0x1f21, 0x20d4,
    ] {
        for cursor in offset.saturating_sub(12)..=offset.saturating_add(24) {
            let Ok(instruction) = program.decode(cursor) else {
                continue;
            };
            if instruction.offset != cursor {
                continue;
            }
            println!(
                "local_scrdrv_transition_instr anchor=0x{:x} offset=0x{:x} opcode=0x{:02x} next=0x{:x} kind={}",
                offset,
                instruction.offset,
                instruction.opcode,
                instruction.next_offset,
                describe_instruction_kind(&instruction.kind)
            );
        }
    }
    Ok(())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn probes_scrdrv_transition_host_results() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let scripts = runtime.scripts();
    let scrdrv = scripts
        .find_by_name_bytes(b"scrdrv._bp")
        .ok_or("scrdrv._bp is missing")?;
    let mut host = SystemHost::with_runtime(&runtime);
    let mut vm = scripts
        .system_vm(scrdrv)?
        .ok_or("scrdrv._bp is not a system script")?;

    println!("local_scrdrv_transition_host_results_version=1");
    for step in 0..260usize {
        let event = vm.next_event()?;
        let last = vm.last_instruction_offset().unwrap_or(0);
        let frame = format!("{}:0x{:x}", scrdrv.index(), last);
        if let SystemVmEvent::ServiceCall {
            family: sakura_core::SystemCallFamily::System,
            service_id,
            args,
        } = &event
        {
            if matches!(*service_id, 0x14 | 0x44 | 0x98 | 0xd0) {
                let result = host
                    .event_result(&event)
                    .ok_or("targeted service returned no host result")?;
                let watch_addresses = [
                    0x1200_0004u32,
                    0x1200_0044,
                    0x1200_0048,
                    0x1200_0064,
                    0x1200_0068,
                    0x1200_04bc,
                    0x1200_04c0,
                    0x1200_04c4,
                    0x1200_04d0,
                    0x1200_04e8,
                    0x2000_0000,
                    0x2000_0053,
                    0x2000_023f,
                    0x2000_0591,
                    0x2000_06d6,
                    0x2000_08dd,
                    0x200f_2693,
                ];
                let before = watch_addresses
                    .iter()
                    .map(|address| {
                        format!(
                            "{address:08x}={:08x}",
                            vm.host_local_integer(*address, 2).unwrap_or(0)
                        )
                    })
                    .collect::<Vec<_>>()
                    .join(",");
                if let Some(effect) = result.effect() {
                    for write in effect.writes() {
                        vm.apply_host_write(write)?;
                    }
                }
                if let Some(value) = result.into_value() {
                    vm.resume_with(value)?;
                }
                let after = watch_addresses
                    .iter()
                    .map(|address| {
                        format!(
                            "{address:08x}={:08x}",
                            vm.host_local_integer(*address, 2).unwrap_or(0)
                        )
                    })
                    .collect::<Vec<_>>()
                    .join(",");
                println!(
                    "local_scrdrv_transition_host_result step={} frame={} service=sys:{:02x} args={} result={} before={} after={} host_name={}",
                    step,
                    frame,
                    service_id,
                    format_values(args),
                    describe_result(&result),
                    before,
                    after,
                    String::from_utf8_lossy(host.last_asset_name()),
                );
                continue;
            }
        }
        let Some(result) = host.event_result(&event) else {
            break;
        };
        if let Some(effect) = result.effect() {
            for write in effect.writes() {
                vm.apply_host_write(write)?;
            }
        }
        if let Some(value) = result.into_value() {
            vm.resume_with(value)?;
        }
    }
    Ok(())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn experiments_scrdrv_transition_service_return_overrides() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let scripts = runtime.scripts();
    let scrdrv = scripts
        .find_by_name_bytes(b"scrdrv._bp")
        .ok_or("scrdrv._bp is missing")?;

    let scenarios = [
        ("baseline", None, 0u64),
        ("sys98_one", Some(0x98u8), 1),
        ("sys14_one", Some(0x14u8), 1),
        ("sys44_one", Some(0x44u8), 1),
        ("sysd0_one", Some(0xd0u8), 1),
    ];

    println!("local_scrdrv_transition_override_version=1");
    for (label, override_service, override_value) in scenarios {
        let mut host = SystemHost::with_runtime(&runtime);
        let mut vm = scripts
            .system_vm(scrdrv)?
            .ok_or("scrdrv._bp is not a system script")?;
        let mut graph_events = Vec::new();
        let mut last_frame = "none".to_owned();
        for step in 0..220usize {
            let event = vm.next_event()?;
            last_frame = format!(
                "{}:0x{:x}",
                scrdrv.index(),
                vm.last_instruction_offset().unwrap_or(0)
            );
            if let SystemVmEvent::ServiceCall {
                family: sakura_core::SystemCallFamily::Graph,
                service_id,
                ..
            } = &event
            {
                graph_events.push(format!(
                    "{service_id:02x}@0x{:x}",
                    vm.last_instruction_offset().unwrap_or(0)
                ));
                if graph_events.len() >= 12 {
                    break;
                }
            }
            let result = match (&event, override_service) {
                (
                    SystemVmEvent::ServiceCall {
                        family: sakura_core::SystemCallFamily::System,
                        service_id,
                        ..
                    },
                    Some(target),
                ) if *service_id == target => {
                    Some(sakura_core::SystemHostResult::Integer(override_value))
                }
                _ => host.event_result(&event),
            };
            let Some(result) = result else {
                break;
            };
            if let Some(effect) = result.effect() {
                for write in effect.writes() {
                    vm.apply_host_write(write)?;
                }
            }
            if let Some(value) = result.into_value() {
                vm.resume_with(value)?;
            }
            if step == 219 {
                break;
            }
        }
        println!(
            "local_scrdrv_transition_override case={} graph_events={} last_frame={} host_last_asset={}",
            label,
            graph_events.join(","),
            last_frame,
            String::from_utf8_lossy(host.last_asset_name()),
        );
    }
    Ok(())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn probes_scrdrv_title_graph_state_windows() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let scripts = runtime.scripts();
    let scrdrv = scripts
        .find_by_name_bytes(b"scrdrv._bp")
        .ok_or("scrdrv._bp is missing")?;
    let host = SystemHost::with_runtime(&runtime);
    let mut system_runtime = SystemRuntime::new(scripts, host);
    system_runtime.push_script(scrdrv, Vec::new())?;

    println!("local_scrdrv_title_graph_state_windows_version=1");
    for step in 0..260usize {
        let (summary, trace) =
            system_runtime.run_with_service_trace(1, MAX_INSTRUCTIONS_PER_EVENT, 16)?;
        let frame = system_runtime.current_frame_state().unwrap_or_default();
        let Some(event) = trace.recorded_services.first() else {
            if summary.completed {
                break;
            }
            continue;
        };
        if event.family != sakura_core::SystemCallFamily::Graph {
            if summary.completed {
                break;
            }
            continue;
        }
        if !matches!(
            event.service_id,
            0x4c | 0x65 | 0x80 | 0x85 | 0x88 | 0x89 | 0x9c | 0x9d | 0xe8
        ) {
            if summary.completed {
                break;
            }
            continue;
        }
        println!(
            "local_scrdrv_title_graph_state step={} frame={} service=graph:{:02x} args={} local44={} local48={} local64={} local68={} local1076={} local1152={} local3952={} local3956={} local3992={} local3996={} local4024={} local4028={} local7100={} local7104={} local7108={} local7112={}",
            step,
            format!("{}:0x{:x}", frame.script_index, frame.last_instruction_offset),
            event.service_id,
            format_arg_slots(event),
            frame.local_44,
            frame.local_48,
            frame.local_64,
            frame.local_68,
            frame.local_1076,
            frame.local_1152,
            frame.local_3952,
            frame.local_3956,
            frame.local_3992,
            frame.local_3996,
            frame.local_4024,
            frame.local_4028,
            frame.local_7100,
            frame.local_7104,
            frame.local_7108,
            frame.local_7112,
        );
        for (index, arg) in event
            .arg_slots
            .iter()
            .take(event.arg_count.min(event.arg_slots.len()).min(8))
            .enumerate()
        {
            if arg.kind != 1 && arg.kind != 6 {
                continue;
            }
            let mut candidates = Vec::new();
            if arg.kind == 6 {
                candidates.push(0x1200_0000u32 | (arg.value & 0x01ff_ffff));
            } else if arg.value >= 0x1200_0000 {
                candidates.push(arg.value);
            } else if arg.value > 0 && arg.value <= 0x01ff_ffff {
                candidates.push(0x1200_0000u32 | arg.value);
            }
            for address in candidates {
                if let Some(bytes) = system_runtime.current_frame_bytes_raw(address, 32) {
                    println!(
                        "local_scrdrv_title_graph_state_mem step={} service={:02x} arg={} address=0x{:x} bytes={}",
                        step,
                        event.service_id,
                        index,
                        address,
                        format_probe_bytes(&bytes),
                    );
                }
            }
        }
        if step >= 220 {
            break;
        }
        if summary.completed {
            break;
        }
    }
    Ok(())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn traces_scrdrv_startup_file_queries() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let scripts = runtime.scripts();
    let scrdrv = scripts
        .find_by_name_bytes(b"scrdrv._bp")
        .ok_or("scrdrv._bp is missing")?;
    let host = SystemHost::with_runtime(&runtime);
    let mut system_runtime = SystemRuntime::new(scripts, host);
    system_runtime.push_script(scrdrv, Vec::new())?;

    println!("local_scrdrv_startup_file_queries_probe_version=1");
    let mut query_count = 0usize;
    for step in 0..320usize {
        let (summary, trace) =
            system_runtime.run_with_service_trace(1, MAX_INSTRUCTIONS_PER_EVENT, 8)?;
        let frame = system_runtime.current_frame_state();
        if let Some(event) = trace.recorded_services.first() {
            if event.family == sakura_core::SystemCallFamily::System
                && matches!(event.service_id, 0x30 | 0x31 | 0x34 | 0x35)
            {
                query_count += 1;
                println!(
                    "local_scrdrv_startup_file_query step={} query={} frame={} service=sys:{:02x} args={} host_name={}",
                    step,
                    query_count,
                    frame
                        .as_ref()
                        .map(|frame| format!("{}:0x{:x}", frame.script_index, frame.last_instruction_offset))
                        .unwrap_or_else(|| "none".to_owned()),
                    event.service_id,
                    format_arg_slots(event),
                    String::from_utf8_lossy(system_runtime.host_last_asset_name())
                );
                if query_count >= 24 {
                    return Ok(());
                }
            }
        }
        if summary.completed {
            break;
        }
    }
    if query_count == 0 {
        return Err("no file query was observed from scrdrv startup context".into());
    }
    Ok(())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn traces_scrdrv_title_graph_memory_shapes() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let scripts = runtime.scripts();
    let scrdrv = scripts
        .find_by_name_bytes(b"scrdrv._bp")
        .ok_or("scrdrv._bp is missing")?;
    let host = SystemHost::with_runtime(&runtime);
    let mut system_runtime = SystemRuntime::new(scripts, host);
    system_runtime.push_script(scrdrv, Vec::new())?;

    println!("local_scrdrv_title_graph_memory_probe_version=1");
    let mut hits = 0usize;
    for step in 0..512usize {
        let (summary, trace) =
            system_runtime.run_with_service_trace(1, MAX_INSTRUCTIONS_PER_EVENT, 16)?;
        let frame = system_runtime.current_frame_state();
        if let Some(event) = trace.recorded_services.first() {
            if event.family == sakura_core::SystemCallFamily::Graph
                && matches!(event.service_id, 0x65 | 0x85 | 0x86 | 0x88 | 0xe8)
            {
                hits += 1;
                println!(
                    "local_scrdrv_title_graph_event step={} hit={} frame={} service=graph:{:02x} args={}",
                    step,
                    hits,
                    frame
                        .as_ref()
                        .map(|frame| format!("{}:0x{:x}", frame.script_index, frame.last_instruction_offset))
                        .unwrap_or_else(|| "none".to_owned()),
                    event.service_id,
                    format_arg_slots(event)
                );
                for (arg_index, slot) in event
                    .arg_slots
                    .iter()
                    .take(event.arg_count.min(event.arg_slots.len()))
                    .enumerate()
                {
                    if !matches!(slot.kind, 1 | 6) {
                        continue;
                    }
                    let mut candidates = Vec::new();
                    match slot.kind {
                        6 => candidates.push(("local", 0x1200_0000u32 | slot.value)),
                        1 if slot.value >= 0x1200_0000 => candidates.push(("raw", slot.value)),
                        1 if slot.value >= 0x2000_0000 => candidates.push(("raw", slot.value)),
                        1 if slot.value > 0 && slot.value < 0x0200_0000 => {
                            candidates.push(("raw", slot.value));
                            candidates.push(("local", 0x1200_0000u32 | slot.value));
                        }
                        _ => {}
                    }
                    for (space, address) in candidates {
                        if let Some(bytes) = system_runtime.current_frame_bytes_raw(address, 32) {
                            println!(
                                "local_scrdrv_title_graph_mem step={} hit={} arg={} kind={} space={} addr=0x{:x} bytes={}",
                                step,
                                hits,
                                arg_index,
                                slot.kind,
                                space,
                                address,
                                format_probe_bytes(&bytes)
                            );
                        }
                    }
                }
                if hits >= 24 {
                    return Ok(());
                }
            }
        }
        if summary.completed {
            break;
        }
    }
    if hits == 0 {
        return Err("no title-stage graph event was observed from scrdrv context".into());
    }
    Ok(())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn traces_scrdrv_title_graph_4c_context() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let scripts = runtime.scripts();
    let scrdrv = scripts
        .find_by_name_bytes(b"scrdrv._bp")
        .ok_or("scrdrv._bp is missing")?;
    let host = SystemHost::with_runtime(&runtime);
    let mut system_runtime = SystemRuntime::new(scripts, host);
    system_runtime.push_script(scrdrv, Vec::new())?;

    println!("local_scrdrv_title_graph_4c_context_version=1");
    for step in 0..320usize {
        let (summary, trace) =
            system_runtime.run_with_service_trace(1, MAX_INSTRUCTIONS_PER_EVENT, 16)?;
        let frame = system_runtime.current_frame_state().unwrap_or_default();
        let Some(event) = trace.recorded_services.first() else {
            if summary.completed {
                break;
            }
            continue;
        };
        if event.family == sakura_core::SystemCallFamily::Graph && event.service_id == 0x4c {
            println!(
                "local_scrdrv_title_graph_4c step={} frame={} args={} host_last_asset={} local44={} local48={} local64={} local68={} local1076={} local1152={} local3952={} local3956={} local3992={} local3996={}",
                step,
                format!("{}:0x{:x}", frame.script_index, frame.last_instruction_offset),
                format_arg_slots(event),
                String::from_utf8_lossy(system_runtime.host_last_asset_name()),
                frame.local_44,
                frame.local_48,
                frame.local_64,
                frame.local_68,
                frame.local_1076,
                frame.local_1152,
                frame.local_3952,
                frame.local_3956,
                frame.local_3992,
                frame.local_3996,
            );
            for address in [
                frame.local_44,
                frame.local_48,
                frame.local_64,
                frame.local_68,
                frame.local_1076,
                frame.local_1152,
                frame.local_3952,
                frame.local_3956,
                frame.local_3992,
                frame.local_3996,
            ] {
                let Ok(address32) = u32::try_from(address) else {
                    continue;
                };
                if let Some(bytes) = system_runtime.current_frame_bytes_raw(address32, 64) {
                    println!(
                        "local_scrdrv_title_graph_4c_mem address=0x{:x} bytes={}",
                        address,
                        format_probe_bytes(&bytes),
                    );
                }
            }
            return Ok(());
        }
        if summary.completed {
            break;
        }
    }
    Err("graph:4c was not observed in scrdrv title flow".into())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn traces_scrdrv_title_graph_image_context() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let scripts = runtime.scripts();
    let scrdrv = scripts
        .find_by_name_bytes(b"scrdrv._bp")
        .ok_or("scrdrv._bp is missing")?;
    let host = SystemHost::with_runtime(&runtime);
    let mut system_runtime = SystemRuntime::new(scripts, host);
    system_runtime.push_script(scrdrv, Vec::new())?;

    println!("local_scrdrv_title_graph_image_context_version=1");
    for step in 0..220usize {
        let (summary, trace) =
            system_runtime.run_with_service_trace(1, MAX_INSTRUCTIONS_PER_EVENT, 16)?;
        let frame = system_runtime.current_frame_state().unwrap_or_default();
        let Some(event) = trace.recorded_services.first() else {
            if summary.completed {
                break;
            }
            continue;
        };
        if event.family != sakura_core::SystemCallFamily::Graph
            || !matches!(
                event.service_id,
                0x4c | 0x56 | 0x16 | 0x11 | 0x13 | 0x18 | 0x57
            )
        {
            if summary.completed {
                break;
            }
            continue;
        }
        println!(
            "local_scrdrv_title_graph_image step={} frame={} service=graph:{:02x} args={} host_last_asset={} local44={} local48={} local64={} local68={} local1076={} local1152={} local3952={} local3956={} local3992={} local3996={}",
            step,
            format!("{}:0x{:x}", frame.script_index, frame.last_instruction_offset),
            event.service_id,
            format_arg_slots(event),
            String::from_utf8_lossy(system_runtime.host_last_asset_name()),
            frame.local_44,
            frame.local_48,
            frame.local_64,
            frame.local_68,
            frame.local_1076,
            frame.local_1152,
            frame.local_3952,
            frame.local_3956,
            frame.local_3992,
            frame.local_3996,
        );
        for (arg_index, slot) in event
            .arg_slots
            .iter()
            .take(event.arg_count.min(event.arg_slots.len()))
            .enumerate()
        {
            let mut candidates = Vec::new();
            match slot.kind {
                6 => candidates.push(("local", 0x1200_0000u32 | slot.value)),
                1 if slot.value >= 0x1200_0000 => candidates.push(("raw", slot.value)),
                1 if slot.value >= 0x2000_0000 => candidates.push(("raw", slot.value)),
                1 if slot.value > 0 && slot.value < 0x0200_0000 => {
                    candidates.push(("raw", slot.value));
                    candidates.push(("local", 0x1200_0000u32 | slot.value));
                    candidates.push(("aux", 0x2000_0000u32 | slot.value));
                }
                _ => {}
            }
            for (space, address) in candidates {
                if let Some(bytes) = system_runtime.current_frame_bytes_raw(address, 64) {
                    println!(
                        "local_scrdrv_title_graph_image_mem step={} service={:02x} arg={} kind={} space={} addr=0x{:x} bytes={}",
                        step,
                        event.service_id,
                        arg_index,
                        slot.kind,
                        space,
                        address,
                        format_probe_bytes(&bytes),
                    );
                }
            }
        }
        if summary.completed {
            break;
        }
    }
    Ok(())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn traces_scrdrv_title_vector_graph_state() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let scripts = runtime.scripts();
    let scrdrv = scripts
        .find_by_name_bytes(b"scrdrv._bp")
        .ok_or("scrdrv._bp is missing")?;
    let host = SystemHost::with_runtime(&runtime);
    let mut system_runtime = SystemRuntime::new(scripts, host);
    system_runtime.push_script(scrdrv, Vec::new())?;

    println!("local_scrdrv_title_vector_graph_state_version=1");
    let mut hits = 0usize;
    for step in 0..512usize {
        let (summary, trace) =
            system_runtime.run_with_service_trace(1, MAX_INSTRUCTIONS_PER_EVENT, 16)?;
        let frame = system_runtime.current_frame_state().unwrap_or_default();
        let Some(event) = trace.recorded_services.first() else {
            if summary.completed {
                break;
            }
            continue;
        };
        if event.family != sakura_core::SystemCallFamily::Graph
            || !matches!(event.service_id, 0x94 | 0x95 | 0x96 | 0x98 | 0x99 | 0x9a)
        {
            if summary.completed {
                break;
            }
            continue;
        }
        hits += 1;
        println!(
            "local_scrdrv_title_vector_graph step={} hit={} frame={}:0x{:x} service=graph:{:02x} args={} host_name={} local20={} local24={} local28={} local32={} local36={} local40={} local44={} local48={} local64={} local68={} local1076={} local1152={} local3952={} local3956={} local3992={} local3996={} local4024={} local4028={} local7100={} local7104={} local7108={} local7112={}",
            step,
            hits,
            frame.script_index,
            frame.last_instruction_offset,
            event.service_id,
            format_arg_slots(event),
            String::from_utf8_lossy(system_runtime.host_last_asset_name()),
            system_runtime.current_frame_local_integer(20, 2).unwrap_or(0),
            system_runtime.current_frame_local_integer(24, 2).unwrap_or(0),
            system_runtime.current_frame_local_integer(28, 2).unwrap_or(0),
            system_runtime.current_frame_local_integer(32, 2).unwrap_or(0),
            system_runtime.current_frame_local_integer(36, 2).unwrap_or(0),
            system_runtime.current_frame_local_integer(40, 2).unwrap_or(0),
            frame.local_44,
            frame.local_48,
            frame.local_64,
            frame.local_68,
            frame.local_1076,
            frame.local_1152,
            frame.local_3952,
            frame.local_3956,
            frame.local_3992,
            frame.local_3996,
            frame.local_4024,
            frame.local_4028,
            frame.local_7100,
            frame.local_7104,
            frame.local_7108,
            frame.local_7112,
        );
        if hits >= 24 {
            return Ok(());
        }
        if summary.completed {
            break;
        }
    }
    if hits == 0 {
        return Err("no title-stage vector graph event was observed from scrdrv context".into());
    }
    Ok(())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn traces_scrdrv_title_graph96_archive_slot_context() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let scripts = runtime.scripts();
    let scrdrv = scripts
        .find_by_name_bytes(b"scrdrv._bp")
        .ok_or("scrdrv._bp is missing")?;
    let host = SystemHost::with_runtime(&runtime);
    let mut system_runtime = SystemRuntime::new(scripts, host);
    system_runtime.push_script(scrdrv, Vec::new())?;

    println!("local_scrdrv_title_graph96_archive_slot_context_version=1");
    for step in 0..512usize {
        let (summary, trace) =
            system_runtime.run_with_service_trace(1, MAX_INSTRUCTIONS_PER_EVENT, 16)?;
        let frame = system_runtime.current_frame_state().unwrap_or_default();
        let Some(event) = trace.recorded_services.first() else {
            if summary.completed {
                break;
            }
            continue;
        };
        if event.family != sakura_core::SystemCallFamily::Graph
            || event.service_id != 0x96
            || event.arg_count != 1
        {
            if summary.completed {
                break;
            }
            continue;
        }
        let Some(raw_offset) = event
            .arg_slots
            .first()
            .filter(|slot| slot.kind == 1 && slot.value > 0)
            .map(|slot| slot.value as u64)
        else {
            if summary.completed {
                break;
            }
            continue;
        };
        let archive_address = 0x2040_6000u32.saturating_add(raw_offset as u32);
        let probe_64 = system_runtime
            .current_frame_bytes_raw(archive_address, 64)
            .map(|bytes| format_probe_bytes(&bytes))
            .unwrap_or_else(|| "none".to_owned());
        let probe_128 = system_runtime
            .current_frame_bytes_raw(archive_address, 128)
            .map(|bytes| format_probe_bytes(&bytes))
            .unwrap_or_else(|| "none".to_owned());
        let archive_head = system_runtime
            .current_frame_bytes_raw(0x2040_6000u32, 64)
            .map(|bytes| format_probe_bytes(&bytes))
            .unwrap_or_else(|| "none".to_owned());
        println!(
            "local_scrdrv_title_graph96_archive_slot_context step={} frame={}:0x{:x} host_name={} raw_offset=0x{:x} archive_address=0x{:x} probe64={} probe128={} archive_head={} local20={} local24={} local28={} local32={} local36={} local40={} local44={} local48={} local64={} local68={} local1076={} local1152={} local3952={} local3956={} local3992={} local3996={} local4024={} local4028={} local7100={} local7104={} local7108={} local7112={}",
            step,
            frame.script_index,
            frame.last_instruction_offset,
            String::from_utf8_lossy(system_runtime.host_last_asset_name()),
            raw_offset,
            archive_address,
            probe_64,
            probe_128,
            archive_head,
            system_runtime.current_frame_local_integer(20, 2).unwrap_or(0),
            system_runtime.current_frame_local_integer(24, 2).unwrap_or(0),
            system_runtime.current_frame_local_integer(28, 2).unwrap_or(0),
            system_runtime.current_frame_local_integer(32, 2).unwrap_or(0),
            system_runtime.current_frame_local_integer(36, 2).unwrap_or(0),
            system_runtime.current_frame_local_integer(40, 2).unwrap_or(0),
            frame.local_44,
            frame.local_48,
            frame.local_64,
            frame.local_68,
            frame.local_1076,
            frame.local_1152,
            frame.local_3952,
            frame.local_3956,
            frame.local_3992,
            frame.local_3996,
            frame.local_4024,
            frame.local_4028,
            frame.local_7100,
            frame.local_7104,
            frame.local_7108,
            frame.local_7112,
        );
        return Ok(());
    }
    Err("title graph:96 argc=1 archive-slot context was not observed".into())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn traces_scrdrv_title_graph_transition_sequence() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let scripts = runtime.scripts();
    let scrdrv = scripts
        .find_by_name_bytes(b"scrdrv._bp")
        .ok_or("scrdrv._bp is missing")?;
    let host = SystemHost::with_runtime(&runtime);
    let mut system_runtime = SystemRuntime::new(scripts, host);
    system_runtime.push_script(scrdrv, Vec::new())?;

    println!("local_scrdrv_title_graph_transition_sequence_version=1");
    let interesting = [
        0x31u8, 0x32, 0x34, 0x37, 0x38, 0x94, 0x95, 0x96, 0x98, 0x99, 0x9a,
    ];
    let mut captured = Vec::new();
    for step in 0..640usize {
        let (summary, trace) =
            system_runtime.run_with_service_trace(1, MAX_INSTRUCTIONS_PER_EVENT, 16)?;
        let frame = system_runtime.current_frame_state().unwrap_or_default();
        let Some(event) = trace.recorded_services.first() else {
            if summary.completed {
                break;
            }
            continue;
        };
        if event.family != sakura_core::SystemCallFamily::Graph
            || !interesting.contains(&event.service_id)
        {
            if summary.completed {
                break;
            }
            continue;
        }
        captured.push(event.service_id);
        println!(
            "local_scrdrv_title_graph_transition_sequence step={} frame={}:0x{:x} service=graph:{:02x} args={} host_name={} local20={} local24={} local28={} local32={} local36={} local40={} local44={} local48={} local64={} local68={} local1076={} local1152={} local3952={} local3956={} local3992={} local3996={} local4024={} local4028={} local7100={} local7104={} local7108={} local7112={}",
            step,
            frame.script_index,
            frame.last_instruction_offset,
            event.service_id,
            format_arg_slots(event),
            String::from_utf8_lossy(system_runtime.host_last_asset_name()),
            system_runtime.current_frame_local_integer(20, 2).unwrap_or(0),
            system_runtime.current_frame_local_integer(24, 2).unwrap_or(0),
            system_runtime.current_frame_local_integer(28, 2).unwrap_or(0),
            system_runtime.current_frame_local_integer(32, 2).unwrap_or(0),
            system_runtime.current_frame_local_integer(36, 2).unwrap_or(0),
            system_runtime.current_frame_local_integer(40, 2).unwrap_or(0),
            frame.local_44,
            frame.local_48,
            frame.local_64,
            frame.local_68,
            frame.local_1076,
            frame.local_1152,
            frame.local_3952,
            frame.local_3956,
            frame.local_3992,
            frame.local_3996,
            frame.local_4024,
            frame.local_4028,
            frame.local_7100,
            frame.local_7104,
            frame.local_7108,
            frame.local_7112,
        );
        if captured.len() >= 20 {
            return Ok(());
        }
        if summary.completed {
            break;
        }
    }
    Err("title graph transition sequence was not observed from scrdrv context".into())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn traces_scrdrv_data01_archive_aux_bytes() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let scripts = runtime.scripts();
    let scrdrv = scripts
        .find_by_name_bytes(b"scrdrv._bp")
        .ok_or("scrdrv._bp is missing")?;
    let host = SystemHost::with_runtime(&runtime);
    let mut system_runtime = SystemRuntime::new(scripts, host);
    system_runtime.push_script(scrdrv, Vec::new())?;

    println!("local_scrdrv_data01_aux_probe_version=1");
    for step in 0..160usize {
        let (summary, trace) =
            system_runtime.run_with_service_trace(1, MAX_INSTRUCTIONS_PER_EVENT, 8)?;
        let frame = system_runtime.current_frame_state();
        if let Some(event) = trace.recorded_services.first() {
            if event.family == sakura_core::SystemCallFamily::System && event.service_id == 0x30 {
                let host_name = String::from_utf8_lossy(system_runtime.host_last_asset_name());
                if host_name == "data01xxx.arc" {
                    let archive_address = 0x2040_6000u32;
                    let bytes = system_runtime
                        .current_frame_bytes_raw(archive_address, 64)
                        .ok_or("aux archive bytes were not readable")?;
                    println!(
                        "local_scrdrv_data01_aux_step={} frame={} addr=0x{:x} bytes={}",
                        step,
                        frame
                            .as_ref()
                            .map(|frame| format!(
                                "{}:0x{:x}",
                                frame.script_index, frame.last_instruction_offset
                            ))
                            .unwrap_or_else(|| "none".to_owned()),
                        archive_address,
                        format_probe_bytes(&bytes)
                    );
                    return Ok(());
                }
            }
        }
        if summary.completed {
            break;
        }
    }
    Err("data01xxx.arc aux payload was not observed from scrdrv context".into())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn traces_script_bp_archive_placeholder_context() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let scripts = runtime.scripts();
    let entry = scripts
        .find_by_name_bytes(b"script._bp")
        .ok_or("script._bp is missing")?;
    let mut host = SystemHost::with_runtime(&runtime);
    let mut vm = scripts
        .system_vm(entry)?
        .ok_or("script._bp is not a system script")?;

    println!("local_script_bp_archive_placeholder_probe_version=1");
    for event_index in 0..96usize {
        let event = vm.next_event()?;
        let last = vm.last_instruction_offset().unwrap_or(0);
        if let SystemVmEvent::ServiceCall {
            family: sakura_core::SystemCallFamily::System,
            service_id: 0x34,
            args,
        } = &event
        {
            let has_placeholder = args.iter().any(|value| {
                value
                    .string_bytes()
                    .is_some_and(|bytes| bytes == b"data01xxx.arc")
            });
            if has_placeholder {
                println!(
                    "local_script_bp_archive_placeholder_event={} last=0x{:x} cursor=0x{:x} mem_ptr=0x{:x} locals={}",
                    event_index,
                    last,
                    vm.cursor(),
                    vm.mem_ptr(),
                    format_local_probe_values(&vm, &[0x354, 0x458, 0x37c, 0x380, 0x4f0, 0x4f4, 0x4f8, 0x4fc])
                );
                println!(
                    "local_script_bp_archive_placeholder_args={}",
                    format_values(args)
                );
                return Ok(());
            }
        }
        let Some(result) = host.event_result(&event) else {
            break;
        };
        if let Some(effect) = result.effect() {
            for write in effect.writes() {
                vm.apply_host_write(write)?;
            }
        }
        if let Some(value) = result.into_value() {
            vm.resume_with(value)?;
        }
        if last >= 0x9b {
            break;
        }
    }
    Err("data01xxx.arc query was not observed in script._bp".into())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn traces_script_bp_call_target_slot_before_scrdrv_10c4() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let scripts = runtime.scripts();
    let scrdrv = scripts
        .find_by_name_bytes(b"scrdrv._bp")
        .ok_or("scrdrv._bp is missing")?;
    let host = SystemHost::with_runtime(&runtime);
    let mut system_runtime = SystemRuntime::new(scripts, host);
    system_runtime.push_script(scrdrv, Vec::new())?;

    println!("local_script_bp_call_target_slot_probe_version=1");
    for step in 0..160usize {
        let (summary, trace) =
            system_runtime.run_with_service_trace(1, MAX_INSTRUCTIONS_PER_EVENT, 8)?;
        let frame = system_runtime.current_frame_state().unwrap_or_default();
        println!(
            "local_script_bp_call_target_slot_step={} completed={} limited={} halted={} frame_script={} frame_last=0x{:x} g128600={} g170600={} g170604={} trace={}",
            step,
            u8::from(summary.completed),
            u8::from(summary.event_limited),
            summary.halted_event_count,
            frame.script_index,
            frame.last_instruction_offset,
            system_runtime.current_frame_integer_raw(128600, 2).unwrap_or(0),
            system_runtime
                .current_frame_integer_raw(144576 + 26024, 2)
                .unwrap_or(0),
            system_runtime
                .current_frame_integer_raw(144576 + 26028, 2)
                .unwrap_or(0),
            trace
                .recorded_services
                .first()
                .map(|event| {
                    format!(
                        "{}:{:02x}:argc{}:{}",
                        family_label(family_code(event.family)),
                        event.service_id,
                        event.arg_count,
                        format_arg_slots(event)
                    )
                })
                .unwrap_or_else(|| "none".to_owned())
        );
        if frame.script_index == 5 && frame.last_instruction_offset == 0x10c4 {
            return Ok(());
        }
        if summary.completed {
            break;
        }
    }
    Err("scrdrv._bp did not reach 0x10c4".into())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn traces_script_bp_system_88_context() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let scripts = runtime.scripts();
    let scrdrv = scripts
        .find_by_name_bytes(b"scrdrv._bp")
        .ok_or("scrdrv._bp is missing")?;
    let host = SystemHost::with_runtime(&runtime);
    let mut system_runtime = SystemRuntime::new(scripts, host);
    system_runtime.push_script(scrdrv, Vec::new())?;

    println!("local_script_bp_system_88_probe_version=1");
    for step in 0..160usize {
        let (summary, trace) =
            system_runtime.run_with_service_trace(1, MAX_INSTRUCTIONS_PER_EVENT, 8)?;
        let frame = system_runtime.current_frame_state().unwrap_or_default();
        println!(
            "local_script_bp_system_88_step={} completed={} limited={} halted={} frame_script={} frame_last=0x{:x} g170600={} g170604={} g128600={} trace={}",
            step,
            u8::from(summary.completed),
            u8::from(summary.event_limited),
            summary.halted_event_count,
            frame.script_index,
            frame.last_instruction_offset,
            system_runtime
                .current_frame_integer_raw(144576 + 26024, 2)
                .unwrap_or(0),
            system_runtime
                .current_frame_integer_raw(144576 + 26028, 2)
                .unwrap_or(0),
            system_runtime.current_frame_integer_raw(128600, 2).unwrap_or(0),
            trace
                .recorded_services
                .first()
                .map(|event| {
                    format!(
                        "{}:{:02x}:argc{}:{}",
                        family_label(family_code(event.family)),
                        event.service_id,
                        event.arg_count,
                        format_arg_slots(event)
                    )
                })
                .unwrap_or_else(|| "none".to_owned())
        );
        if let Some(event) = trace.recorded_services.first() {
            if event.family == sakura_core::SystemCallFamily::System && event.service_id == 0x88 {
                println!("local_script_bp_system_88_args={}", format_arg_slots(event));
                return Ok(());
            }
        }
        if summary.completed {
            break;
        }
    }
    Err("script._bp sys:88 was not observed from scrdrv bootstrap".into())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn traces_script_bp_archive_entry_memory_flow() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let scripts = runtime.scripts();
    let scrdrv = scripts
        .find_by_name_bytes(b"scrdrv._bp")
        .ok_or("scrdrv._bp is missing")?;
    let host = SystemHost::with_runtime(&runtime);
    let mut system_runtime = SystemRuntime::new(scripts, host);
    system_runtime.push_script(scrdrv, Vec::new())?;

    println!("local_script_bp_archive_entry_flow_probe_version=1");
    for step in 0..160usize {
        let (summary, trace) =
            system_runtime.run_with_service_trace(1, MAX_INSTRUCTIONS_PER_EVENT, 8)?;
        let frame = system_runtime.current_frame_state().unwrap_or_default();
        let Some(event) = trace.recorded_services.first() else {
            if summary.completed {
                break;
            }
            continue;
        };
        if event.family != sakura_core::SystemCallFamily::System {
            if summary.completed {
                break;
            }
            continue;
        }
        if !matches!(event.service_id, 0x30 | 0xe9 | 0x88) || frame.script_index != 29 {
            if summary.completed {
                break;
            }
            continue;
        }

        let aux2000 = system_runtime
            .current_frame_bytes_raw(0x2000_0000, 64)
            .map(|bytes| format_probe_bytes(&bytes))
            .unwrap_or_else(|| "none".to_owned());
        let auxf2693 = system_runtime
            .current_frame_bytes_raw(0x200f_2693, 128)
            .map(|bytes| format_probe_bytes(&bytes))
            .unwrap_or_else(|| "none".to_owned());
        let local890 = system_runtime
            .current_frame_bytes_raw(0x1200_0890, 256)
            .map(|bytes| format_probe_bytes(&bytes))
            .unwrap_or_else(|| "none".to_owned());
        let localbac = system_runtime
            .current_frame_bytes_raw(0x1200_0bac, 256)
            .map(|bytes| format_probe_bytes(&bytes))
            .unwrap_or_else(|| "none".to_owned());
        let auxf2600 = system_runtime
            .current_frame_bytes_raw(0x200f_2600, 256)
            .map(|bytes| format_probe_bytes(&bytes))
            .unwrap_or_else(|| "none".to_owned());
        println!(
            "local_script_bp_archive_entry_flow_step={} frame={} service=sys:{:02x} args={} aux2000={} auxf2600={} auxf2693={} local890={} localbac={}",
            step,
            format!("{}:0x{:x}", frame.script_index, frame.last_instruction_offset),
            event.service_id,
            format_arg_slots(event),
            aux2000,
            auxf2600,
            auxf2693,
            local890,
            localbac
        );
        if event.service_id == 0x88 {
            return Ok(());
        }
        if summary.completed {
            break;
        }
    }
    Err("script._bp archive entry memory flow did not reach sys:88".into())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn dumps_script_29_archive_entry_block() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let scripts = runtime.scripts();
    let id = scripts
        .id_from_index(29)
        .ok_or("script index 29 is missing")?;
    let script = scripts
        .script(id)
        .ok_or("script index 29 payload is missing")?;
    let program = SystemProgram::parse(script.decompressed())?;

    println!("local_script_29_archive_block_dump_version=1");
    for offset in 0x9b..=0x1f9 {
        let Ok(instruction) = program.decode(offset) else {
            continue;
        };
        if instruction.offset != offset {
            continue;
        }
        println!(
            "local_script_29_instr offset=0x{:x} opcode=0x{:02x} next=0x{:x} kind={}",
            instruction.offset,
            instruction.opcode,
            instruction.next_offset,
            describe_instruction_kind(&instruction.kind)
        );
    }
    Ok(())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn steps_script_29_archive_entry_block_live() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let scripts = runtime.scripts();
    let scrdrv = scripts
        .find_by_name_bytes(b"scrdrv._bp")
        .ok_or("scrdrv._bp is missing")?;
    let host = SystemHost::with_runtime(&runtime);
    let mut system_runtime = SystemRuntime::new(scripts, host);
    system_runtime.push_script(scrdrv, Vec::new())?;

    println!("local_script_29_archive_block_live_version=1");
    for step in 0..260usize {
        let frame = system_runtime.current_frame_state().unwrap_or_default();
        if frame.script_index == 29 && (0x9b..=0x1f9).contains(&frame.last_instruction_offset) {
            println!(
                "local_script_29_live_before step={} frame={} local24={} local28={} local2c={} local30={} local38={} local3c={} local40={} local44={} local48={} local208={} local20a={} local354={} local45c={} local464={} local468={} stack_hint=g128600:{}",
                step,
                format!("{}:0x{:x}", frame.script_index, frame.last_instruction_offset),
                system_runtime.current_frame_integer_raw(0x1200_0024, 2).unwrap_or(0),
                system_runtime.current_frame_integer_raw(0x1200_0028, 2).unwrap_or(0),
                system_runtime.current_frame_integer_raw(0x1200_002c, 2).unwrap_or(0),
                system_runtime.current_frame_integer_raw(0x1200_0030, 2).unwrap_or(0),
                system_runtime.current_frame_integer_raw(0x1200_0038, 2).unwrap_or(0),
                system_runtime.current_frame_integer_raw(0x1200_003c, 2).unwrap_or(0),
                system_runtime.current_frame_integer_raw(0x1200_0040, 2).unwrap_or(0),
                system_runtime.current_frame_integer_raw(0x1200_0044, 2).unwrap_or(0),
                system_runtime.current_frame_integer_raw(0x1200_0048, 2).unwrap_or(0),
                system_runtime.current_frame_integer_raw(0x1200_0208, 2).unwrap_or(0),
                system_runtime.current_frame_integer_raw(0x1200_020a, 2).unwrap_or(0),
                system_runtime.current_frame_integer_raw(0x1200_0354, 2).unwrap_or(0),
                system_runtime.current_frame_integer_raw(0x1200_045c, 2).unwrap_or(0),
                system_runtime.current_frame_integer_raw(0x1200_0464, 2).unwrap_or(0),
                system_runtime.current_frame_integer_raw(0x1200_0468, 2).unwrap_or(0),
                system_runtime.current_frame_integer_raw(128600, 2).unwrap_or(0),
            );
        }

        let (summary, trace) =
            system_runtime.run_with_service_trace(1, MAX_INSTRUCTIONS_PER_EVENT, 8)?;
        if frame.script_index == 29 && (0x9b..=0x1f9).contains(&frame.last_instruction_offset) {
            let current = system_runtime.current_frame_state().unwrap_or_default();
            println!(
                "local_script_29_live_after step={} completed={} limited={} frame={} trace={} local24={} local28={} local2c={} local30={} local38={} local3c={} local40={} local44={} local48={} local208={} local20a={} local354={} local45c={} local464={} local468={}",
                step,
                u8::from(summary.completed),
                u8::from(summary.event_limited),
                format!("{}:0x{:x}", current.script_index, current.last_instruction_offset),
                trace
                    .recorded_services
                    .first()
                    .map(|event| {
                        format!(
                            "{}:{:02x}:{}",
                            family_label(family_code(event.family)),
                            event.service_id,
                            format_arg_slots(event)
                        )
                    })
                    .unwrap_or_else(|| "none".to_owned()),
                system_runtime.current_frame_integer_raw(0x1200_0024, 2).unwrap_or(0),
                system_runtime.current_frame_integer_raw(0x1200_0028, 2).unwrap_or(0),
                system_runtime.current_frame_integer_raw(0x1200_002c, 2).unwrap_or(0),
                system_runtime.current_frame_integer_raw(0x1200_0030, 2).unwrap_or(0),
                system_runtime.current_frame_integer_raw(0x1200_0038, 2).unwrap_or(0),
                system_runtime.current_frame_integer_raw(0x1200_003c, 2).unwrap_or(0),
                system_runtime.current_frame_integer_raw(0x1200_0040, 2).unwrap_or(0),
                system_runtime.current_frame_integer_raw(0x1200_0044, 2).unwrap_or(0),
                system_runtime.current_frame_integer_raw(0x1200_0048, 2).unwrap_or(0),
                system_runtime.current_frame_integer_raw(0x1200_0208, 2).unwrap_or(0),
                system_runtime.current_frame_integer_raw(0x1200_020a, 2).unwrap_or(0),
                system_runtime.current_frame_integer_raw(0x1200_0354, 2).unwrap_or(0),
                system_runtime.current_frame_integer_raw(0x1200_045c, 2).unwrap_or(0),
                system_runtime.current_frame_integer_raw(0x1200_0464, 2).unwrap_or(0),
                system_runtime.current_frame_integer_raw(0x1200_0468, 2).unwrap_or(0),
            );
        }
        if summary.completed {
            break;
        }
    }
    Ok(())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn traces_scrdrv_loaded_call_frame_alignment() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let scripts = runtime.scripts();
    let scrdrv = scripts
        .find_by_name_bytes(b"scrdrv._bp")
        .ok_or("scrdrv._bp is missing")?;
    let host = SystemHost::with_runtime(&runtime);
    let mut system_runtime = SystemRuntime::new(scripts, host);
    system_runtime.push_script(scrdrv, Vec::new())?;

    println!("local_scrdrv_loaded_call_frame_alignment_version=1");
    for step in 0..160usize {
        let before = system_runtime.current_frame_state().unwrap_or_default();
        let before_name = scripts
            .id_from_index(before.script_index)
            .map(|id| describe_script_id(scripts, id))
            .unwrap_or_else(|| format!("invalid:{}", before.script_index));
        let (summary, trace) =
            system_runtime.run_with_service_trace(1, MAX_INSTRUCTIONS_PER_EVENT, 8)?;
        let after = system_runtime.current_frame_state().unwrap_or_default();
        let after_name = scripts
            .id_from_index(after.script_index)
            .map(|id| describe_script_id(scripts, id))
            .unwrap_or_else(|| format!("invalid:{}", after.script_index));
        let trace_head = format_service_trace_first(&trace.recorded_services);
        println!(
            "local_scrdrv_loaded_call_frame_alignment_step={} before={} after={} completed={} limited={} trace={}",
            step,
            format!("{before_name}@{}:0x{:x}", before.script_index, before.last_instruction_offset),
            format!("{after_name}@{}:0x{:x}", after.script_index, after.last_instruction_offset),
            u8::from(summary.completed),
            u8::from(summary.event_limited),
            trace_head,
        );
        if let Some(frame) = system_runtime.current_frame_state() {
            if frame.script_index == scrdrv.index()
                && trace.recorded_services.iter().any(|event| {
                    event.family == sakura_core::SystemCallFamily::System
                        && matches!(event.service_id, 0x40 | 0x44)
                })
            {
                println!(
                    "local_scrdrv_loaded_call_frame_alignment_scrdrv_after step={} frame={}:0x{:x}",
                    step, frame.script_index, frame.last_instruction_offset
                );
            }
        }
        if summary.completed {
            break;
        }
    }
    Ok(())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn traces_bitmap_bp_graph_string_arguments() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let scripts = runtime.scripts();
    let entry = scripts
        .find_by_name_bytes(b"bitmap._bp")
        .ok_or("bitmap._bp is missing")?;
    let mut host = SystemHost::with_runtime(&runtime);
    let mut vm = scripts
        .system_vm(entry)?
        .ok_or("bitmap._bp is not a system script")?;

    println!("local_bitmap_bp_graph_string_arguments_version=1");
    let mut hits = 0usize;
    for step in 0..64usize {
        let event = vm.next_event()?;
        if let SystemVmEvent::ServiceCall {
            family: sakura_core::SystemCallFamily::Graph,
            service_id,
            args,
        } = &event
        {
            let strings = args
                .iter()
                .enumerate()
                .filter_map(|(index, value)| {
                    value.string_bytes().map(|bytes| {
                        let end = bytes
                            .iter()
                            .position(|byte| *byte == 0)
                            .unwrap_or(bytes.len());
                        (
                            index,
                            String::from_utf8_lossy(&bytes[..end]).into_owned(),
                            bytes.len(),
                            fnv1a32(&bytes[..end]),
                        )
                    })
                })
                .collect::<Vec<_>>();
            if !strings.is_empty() {
                hits += 1;
                println!(
                    "local_bitmap_bp_graph_string_event step={} last=0x{:x} service=graph:{:02x} argc={}",
                    step,
                    vm.last_instruction_offset().unwrap_or(0),
                    service_id,
                    args.len(),
                );
                for (index, text, len, hash) in strings {
                    println!(
                        "local_bitmap_bp_graph_string_slot step={} arg={} len={} hash=0x{:08x} text={}",
                        step,
                        index,
                        len,
                        hash,
                        text,
                    );
                }
            }
        }
        let Some(result) = host.event_result(&event) else {
            break;
        };
        if let Some(effect) = result.effect() {
            for write in effect.writes() {
                vm.apply_host_write(write)?;
            }
        }
        if let Some(value) = result.into_value() {
            vm.resume_with(value)?;
        }
        if hits >= 8 {
            break;
        }
    }
    if hits == 0 {
        return Err("bitmap._bp emitted no graph calls with string arguments".into());
    }
    Ok(())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn traces_scrmain_event_progress_after_sys8b() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let scripts = runtime.scripts();
    let entry = scripts
        .find_by_name_bytes(b"scrmain._bp")
        .ok_or("scrmain._bp is missing")?;
    let mut host = SystemHost::with_runtime(&runtime);
    let mut vm = scripts
        .system_vm(entry)?
        .ok_or("scrmain._bp is not a system script")?;

    println!("local_scrmain_event_progress_probe_version=1");
    for event_index in 0..8usize {
        let event = vm.next_event();
        match event {
            Ok(event) => {
                println!(
                    "local_scrmain_event_progress_event={} kind={} cursor={} last=0x{:x} mem_ptr=0x{:x} local4={} local12={} local16={} local20={} local1264={} local1268={} local1272={} local1276={}",
                    event_index,
                    describe_event(&event),
                    vm.cursor(),
                    vm.last_instruction_offset().unwrap_or(0),
                    vm.mem_ptr(),
                    vm.host_local_integer(4, 2).unwrap_or(0),
                    vm.host_local_integer(12, 2).unwrap_or(0),
                    vm.host_local_integer(16, 2).unwrap_or(0),
                    vm.host_local_integer(20, 2).unwrap_or(0),
                    vm.host_local_integer(1264, 2).unwrap_or(0),
                    vm.host_local_integer(1268, 2).unwrap_or(0),
                    vm.host_local_integer(1272, 2).unwrap_or(0),
                    vm.host_local_integer(1276, 2).unwrap_or(0),
                );
                let Some(result) = host.event_result(&event) else {
                    break;
                };
                println!(
                    "local_scrmain_event_progress_result={} stack={}",
                    describe_result(&result),
                    format_values(vm.stack())
                );
                if let Some(effect) = result.effect() {
                    for write in effect.writes() {
                        vm.apply_host_write(write)?;
                    }
                }
                if let Some(value) = result.into_value() {
                    vm.resume_with(value)?;
                }
            }
            Err(error) => {
                println!(
                    "local_scrmain_event_progress_error event={} error={error} cursor={} last=0x{:x} mem_ptr=0x{:x} local4={} local12={} local16={} local20={} local1264={} local1268={} local1272={} local1276={}",
                    event_index,
                    vm.cursor(),
                    vm.last_instruction_offset().unwrap_or(0),
                    vm.mem_ptr(),
                    vm.host_local_integer(4, 2).unwrap_or(0),
                    vm.host_local_integer(12, 2).unwrap_or(0),
                    vm.host_local_integer(16, 2).unwrap_or(0),
                    vm.host_local_integer(20, 2).unwrap_or(0),
                    vm.host_local_integer(1264, 2).unwrap_or(0),
                    vm.host_local_integer(1268, 2).unwrap_or(0),
                    vm.host_local_integer(1272, 2).unwrap_or(0),
                    vm.host_local_integer(1276, 2).unwrap_or(0),
                );
                return Err(error.into());
            }
        }
    }
    Ok(())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn experiments_scrmain_sys8b_host_writes() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let scripts = runtime.scripts();
    let entry = scripts
        .find_by_name_bytes(b"scrmain._bp")
        .ok_or("scrmain._bp is missing")?;

    let scenarios = [
        ("none", Vec::<(u32, u64)>::new()),
        ("set_local4_123420", vec![(4, 0x1000_1e0c)]),
        ("set_1264_123420", vec![(1264, 0x1000_1e0c)]),
        ("set_1268_1", vec![(1268, 1)]),
        ("set_1272_123420", vec![(1272, 0x1000_1e0c)]),
        (
            "set_combo",
            vec![(4, 0x1000_1e0c), (1264, 0x1000_1e0c), (1268, 1)],
        ),
    ];

    println!("local_scrmain_sys8b_host_write_experiment_version=1");
    for (label, writes) in scenarios {
        let mut host = SystemHost::with_runtime(&runtime);
        let mut vm = scripts
            .system_vm(entry)?
            .ok_or("scrmain._bp is not a system script")?;
        let first = vm.next_event()?;
        println!(
            "local_scrmain_sys8b_host_write_case={} first_event={} mem_ptr=0x{:x}",
            label,
            describe_event(&first),
            vm.mem_ptr()
        );
        for (offset, value) in writes {
            vm.write_host_local_integer(offset, 2, value)?;
        }
        let Some(result) = host.event_result(&first) else {
            continue;
        };
        if let Some(effect) = result.effect() {
            for write in effect.writes() {
                vm.apply_host_write(write)?;
            }
        }
        if let Some(value) = result.into_value() {
            vm.resume_with(value)?;
        }
        match vm.next_event() {
            Ok(event) => {
                println!(
                    "local_scrmain_sys8b_host_write_case={} second_event={} cursor={} last=0x{:x} local4={} local16={} local20={} local1264={} local1268={} local1272={} local1276={}",
                    label,
                    describe_event(&event),
                    vm.cursor(),
                    vm.last_instruction_offset().unwrap_or(0),
                    vm.host_local_integer(4, 2).unwrap_or(0),
                    vm.host_local_integer(16, 2).unwrap_or(0),
                    vm.host_local_integer(20, 2).unwrap_or(0),
                    vm.host_local_integer(1264, 2).unwrap_or(0),
                    vm.host_local_integer(1268, 2).unwrap_or(0),
                    vm.host_local_integer(1272, 2).unwrap_or(0),
                    vm.host_local_integer(1276, 2).unwrap_or(0),
                );
            }
            Err(error) => {
                println!(
                    "local_scrmain_sys8b_host_write_case={} error={} cursor={} last=0x{:x} local4={} local16={} local20={} local1264={} local1268={} local1272={} local1276={}",
                    label,
                    error,
                    vm.cursor(),
                    vm.last_instruction_offset().unwrap_or(0),
                    vm.host_local_integer(4, 2).unwrap_or(0),
                    vm.host_local_integer(16, 2).unwrap_or(0),
                    vm.host_local_integer(20, 2).unwrap_or(0),
                    vm.host_local_integer(1264, 2).unwrap_or(0),
                    vm.host_local_integer(1268, 2).unwrap_or(0),
                    vm.host_local_integer(1272, 2).unwrap_or(0),
                    vm.host_local_integer(1276, 2).unwrap_or(0),
                );
            }
        }
    }
    Ok(())
}

fn describe_result(result: &sakura_core::SystemHostResult) -> String {
    match result {
        sakura_core::SystemHostResult::Integer(value) => format!("int:{value:08x}"),
        sakura_core::SystemHostResult::UserScriptHandle(handle) => {
            format!("handle:{handle:08x}")
        }
        sakura_core::SystemHostResult::UserScriptResult(service_id) => {
            format!("userret:{service_id:02x}")
        }
        sakura_core::SystemHostResult::Unknown => "unknown".to_owned(),
        sakura_core::SystemHostResult::Void => "void".to_owned(),
        sakura_core::SystemHostResult::Effect(effect) => {
            format!("effect:{}", describe_effect(effect))
        }
        sakura_core::SystemHostResult::ValueAndEffect { value, effect } => {
            format!(
                "value:{}+{}",
                describe_host_value(*value),
                describe_effect(effect)
            )
        }
    }
}

fn describe_instruction_kind(kind: &SystemInstructionKind<'_>) -> String {
    match kind {
        SystemInstructionKind::PushU8(value) => format!("push8:{value:#x}"),
        SystemInstructionKind::PushU16(value) => format!("push16:{value:#x}"),
        SystemInstructionKind::PushU32(value) => format!("push32:{value:#x}"),
        SystemInstructionKind::PushU64(value) => format!("push64:{value:#x}"),
        SystemInstructionKind::GetVariablePointer(offset) => format!("getvarptr:{offset:#x}"),
        SystemInstructionKind::GetString {
            displacement,
            target,
            bytes,
        } => format!(
            "getstr:disp={displacement} target={} bytes={}",
            target
                .map(|value| format!("0x{value:x}"))
                .unwrap_or_else(|| "none".to_owned()),
            bytes
                .map(|value| format_script_name(value, 64))
                .unwrap_or_else(|| "none".to_owned())
        ),
        SystemInstructionKind::GetCodeOffset {
            displacement,
            target,
        } => format!(
            "getcode:disp={displacement} target={}",
            target
                .map(|value| format!("0x{value:x}"))
                .unwrap_or_else(|| "none".to_owned())
        ),
        SystemInstructionKind::Branch { kind } => format!("branch:{kind:?}"),
        SystemInstructionKind::WidthOperand { width } => format!("width:{width}"),
        SystemInstructionKind::ArrayOperand { bytes } => {
            format!("array:{}:{}", bytes.len(), format_probe_bytes(bytes))
        }
        SystemInstructionKind::ShortOperand(value) => format!("short:{value:#x}"),
        SystemInstructionKind::ServiceCall {
            family,
            opcode,
            service_id,
        } => format!(
            "svc:{}:{service_id:02x}:op{opcode:02x}",
            match family {
                SystemCallFamily::System => "sys",
                SystemCallFamily::Graph => "graph",
                SystemCallFamily::Sound => "sound",
                SystemCallFamily::External => "ext",
            }
        ),
        SystemInstructionKind::UserScript(op) => format!("user:{op:?}"),
        SystemInstructionKind::Return => "return".to_owned(),
        SystemInstructionKind::NoOperand => "noop".to_owned(),
    }
}

fn describe_host_value(value: sakura_core::SystemHostValue) -> String {
    match value {
        sakura_core::SystemHostValue::Integer(value) => format!("int:{value:08x}"),
        sakura_core::SystemHostValue::UserScriptHandle(handle) => {
            format!("handle:{handle:08x}")
        }
        sakura_core::SystemHostValue::UserScriptResult(service_id) => {
            format!("userret:{service_id:02x}")
        }
        sakura_core::SystemHostValue::Unknown => "unknown".to_owned(),
    }
}

fn describe_effect(effect: &sakura_core::SystemHostEffect) -> String {
    effect
        .writes()
        .iter()
        .map(|write| match write {
            sakura_core::SystemHostWrite::Integer(write) => {
                format!(
                    "w:{:08x}/{}={:08x}",
                    write.address, write.width, write.value
                )
            }
            sakura_core::SystemHostWrite::LocalInteger(write) => {
                format!(
                    "lw:{:08x}/{}={:08x}",
                    write.address, write.width, write.value
                )
            }
            sakura_core::SystemHostWrite::Bytes(write) => {
                format!("b:{:08x}/{}", write.address, write.bytes.len())
            }
        })
        .collect::<Vec<_>>()
        .join(",")
}

fn collect_files(root: &Path) -> TestResult<Vec<PathBuf>> {
    let mut files = Vec::new();
    collect_files_inner(root, &mut files)?;
    files.sort();
    Ok(files)
}

fn collect_archive_files(root: &Path) -> TestResult<Vec<PathBuf>> {
    let files = collect_files(root)?;
    let mut by_basename = BTreeMap::<Vec<u8>, PathBuf>::new();
    for path in files.iter().filter(|path| has_extension(path, "arc")) {
        let Some(name) = path.file_name().and_then(OsStr::to_str) else {
            continue;
        };
        by_basename.insert(name.as_bytes().to_ascii_lowercase(), path.clone());
    }

    let mut ordered = Vec::with_capacity(by_basename.len());
    let mut mounted = BTreeSet::<Vec<u8>>::new();
    if let Ok(data) = fs::read(root.join("BGI.hvl")) {
        if let Ok(manifest) = InstallManifest::parse(&data) {
            for name in manifest.archive_files() {
                let key = name.to_ascii_lowercase();
                if let Some(path) = by_basename.get(&key) {
                    ordered.push(path.clone());
                    mounted.insert(key);
                }
            }
        }
    }

    for (key, path) in by_basename {
        if mounted.insert(key) {
            ordered.push(path);
        }
    }
    Ok(ordered)
}

fn collect_files_inner(path: &Path, files: &mut Vec<PathBuf>) -> TestResult<()> {
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            collect_files_inner(&path, files)?;
        } else if file_type.is_file() {
            files.push(path);
        }
    }
    Ok(())
}

fn has_extension(path: &Path, expected: &str) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .map(|extension| extension.eq_ignore_ascii_case(expected))
        .unwrap_or(false)
}

fn mount_runtime_from_env() -> TestResult<Runtime> {
    let game_dir = env::var_os("SAKURA_INSTALL_DIR")
        .map(PathBuf::from)
        .ok_or("SAKURA_INSTALL_DIR is required for this ignored local-install probe")?;
    let mut runtime = Runtime::new(RuntimeConfig::default());
    for path in collect_archive_files(&game_dir)? {
        let archive_name = path
            .file_name()
            .and_then(OsStr::to_str)
            .map(|name| name.as_bytes().to_vec());
        runtime.mount_archive_data_named(fs::read(path)?, archive_name.as_deref())?;
    }
    Ok(runtime)
}

fn format_top_service_counts(counts: &BTreeMap<(u8, u8), usize>, limit: usize) -> String {
    let mut ranked: Vec<((u8, u8), usize)> =
        counts.iter().map(|(key, value)| (*key, *value)).collect();
    ranked.sort_by(|(left_key, left_count), (right_key, right_count)| {
        right_count
            .cmp(left_count)
            .then_with(|| left_key.cmp(right_key))
    });
    ranked
        .into_iter()
        .take(limit)
        .map(|((family, service_id), count)| {
            format!("{}:{service_id:02x}:{count}", family_label(family))
        })
        .collect::<Vec<_>>()
        .join(",")
}

fn format_buckets(counts: &[usize; 8]) -> String {
    counts
        .iter()
        .enumerate()
        .map(|(bucket, count)| format!("{bucket}:{count}"))
        .collect::<Vec<_>>()
        .join(",")
}

fn format_opcode_counts(counts: &BTreeMap<u8, usize>, limit: usize) -> String {
    let mut ranked: Vec<(u8, usize)> = counts.iter().map(|(key, value)| (*key, *value)).collect();
    ranked.sort_by(|(left_key, left_count), (right_key, right_count)| {
        right_count
            .cmp(left_count)
            .then_with(|| left_key.cmp(right_key))
    });
    ranked
        .into_iter()
        .take(limit)
        .map(|(opcode, count)| format!("{opcode:02x}:{count}"))
        .collect::<Vec<_>>()
        .join(",")
}

fn format_top_counts(counts: &[usize; 256], limit: usize) -> String {
    let mut ranked: Vec<(usize, usize)> = counts
        .iter()
        .enumerate()
        .filter_map(|(index, count)| (*count > 0).then_some((index, *count)))
        .collect();
    ranked.sort_by(|(left_key, left_count), (right_key, right_count)| {
        right_count
            .cmp(left_count)
            .then_with(|| left_key.cmp(right_key))
    });
    ranked
        .into_iter()
        .take(limit)
        .map(|(index, count)| format!("{index:02x}:{count}"))
        .collect::<Vec<_>>()
        .join(",")
}

fn format_offset_counts(counts: &BTreeMap<usize, usize>, limit: usize) -> String {
    let mut ranked: Vec<(usize, usize)> =
        counts.iter().map(|(key, value)| (*key, *value)).collect();
    ranked.sort_by(|(left_key, left_count), (right_key, right_count)| {
        right_count
            .cmp(left_count)
            .then_with(|| left_key.cmp(right_key))
    });
    ranked
        .into_iter()
        .take(limit)
        .map(|(offset, count)| format!("{offset:x}:{count}"))
        .collect::<Vec<_>>()
        .join(",")
}

fn format_error_categories(counts: &BTreeMap<&'static str, usize>) -> String {
    let mut ranked: Vec<(&'static str, usize)> =
        counts.iter().map(|(key, value)| (*key, *value)).collect();
    ranked.sort_by(|(left_key, left_count), (right_key, right_count)| {
        right_count
            .cmp(left_count)
            .then_with(|| left_key.cmp(right_key))
    });
    ranked
        .into_iter()
        .map(|(category, count)| format!("{category}:{count}"))
        .collect::<Vec<_>>()
        .join(",")
}

fn format_error_messages(counts: &BTreeMap<String, usize>, limit: usize) -> String {
    let mut ranked: Vec<(&str, usize)> = counts
        .iter()
        .map(|(key, value)| (key.as_str(), *value))
        .collect();
    ranked.sort_by(|(left_key, left_count), (right_key, right_count)| {
        right_count
            .cmp(left_count)
            .then_with(|| left_key.cmp(right_key))
    });
    ranked
        .into_iter()
        .take(limit)
        .map(|(message, count)| format!("{}:{count}", sanitize_error_message(message)))
        .collect::<Vec<_>>()
        .join(",")
}

fn format_static_str_counts(counts: &BTreeMap<&'static str, usize>, limit: usize) -> String {
    let mut ranked: Vec<(&'static str, usize)> =
        counts.iter().map(|(key, value)| (*key, *value)).collect();
    ranked.sort_by(|(left_key, left_count), (right_key, right_count)| {
        right_count
            .cmp(left_count)
            .then_with(|| left_key.cmp(right_key))
    });
    ranked
        .into_iter()
        .take(limit)
        .map(|(value, count)| format!("{value}:{count}"))
        .collect::<Vec<_>>()
        .join(",")
}

fn format_usize_counts(counts: &BTreeMap<usize, usize>, limit: usize) -> String {
    let mut ranked: Vec<(usize, usize)> =
        counts.iter().map(|(key, value)| (*key, *value)).collect();
    ranked.sort_by(|(left_key, left_count), (right_key, right_count)| {
        right_count
            .cmp(left_count)
            .then_with(|| left_key.cmp(right_key))
    });
    ranked
        .into_iter()
        .take(limit)
        .map(|(value, count)| format!("{value}:{count}"))
        .collect::<Vec<_>>()
        .join(",")
}

fn format_string_counts(counts: &BTreeMap<String, usize>, limit: usize) -> String {
    let mut ranked: Vec<(&str, usize)> = counts
        .iter()
        .map(|(key, value)| (key.as_str(), *value))
        .collect();
    ranked.sort_by(|(left_key, left_count), (right_key, right_count)| {
        right_count
            .cmp(left_count)
            .then_with(|| left_key.cmp(right_key))
    });
    ranked
        .into_iter()
        .take(limit)
        .map(|(value, count)| format!("{value}:{count}"))
        .collect::<Vec<_>>()
        .join(",")
}

fn format_user_call_shape(service_id: u8, args: &[sakura_core::SystemValue<'_>]) -> String {
    let top = args.last().map(system_value_kind_label).unwrap_or("empty");
    format!("{service_id:02x}:argc{}:top-{top}", args.len().min(7))
}

fn format_values(values: &[sakura_core::SystemValue<'_>]) -> String {
    values
        .iter()
        .map(|value| match value {
            sakura_core::SystemValue::Integer(value) => format!("i:{value:08x}"),
            sakura_core::SystemValue::VariablePointer(value) => format!("p:{value:08x}"),
            sakura_core::SystemValue::LocalStringPointer { address, bytes } => {
                format!(
                    "ls:{address:08x}:{}:{}",
                    bytes.len(),
                    bytes
                        .iter()
                        .take(32)
                        .map(|byte| {
                            if byte.is_ascii_graphic() || *byte == b' ' {
                                *byte as char
                            } else {
                                '.'
                            }
                        })
                        .collect::<String>()
                )
            }
            sakura_core::SystemValue::String(bytes) => format!("s:{}", bytes.len()),
            sakura_core::SystemValue::OwnedString(bytes) => format!("os:{}", bytes.len()),
            sakura_core::SystemValue::Code(offset) => format!("c:{offset:08x}"),
            sakura_core::SystemValue::CodeInScript {
                script_index,
                offset,
            } => format!("cs:{script_index}:{offset:08x}"),
            sakura_core::SystemValue::UserScriptHandle(handle) => format!("h:{handle:08x}"),
            sakura_core::SystemValue::UserScriptResult(result) => format!("ur:{result:02x}"),
            sakura_core::SystemValue::Unknown => "u".to_owned(),
        })
        .collect::<Vec<_>>()
        .join("|")
}

fn format_probe_bytes(bytes: &[u8]) -> String {
    let hex = bytes
        .iter()
        .take(32)
        .map(|byte| format!("{byte:02x}"))
        .collect::<Vec<_>>()
        .join("");
    let ascii = bytes
        .iter()
        .take(64)
        .map(|byte| {
            if byte.is_ascii_graphic() || *byte == b' ' {
                *byte as char
            } else {
                '.'
            }
        })
        .collect::<String>();
    format!("hex={hex} ascii={ascii}")
}

fn format_local_probe_values(vm: &sakura_core::SystemVm<'_>, offsets: &[u32]) -> String {
    offsets
        .iter()
        .map(|offset| {
            format!(
                "{}:{}",
                offset,
                vm.host_local_integer(*offset, 2).unwrap_or(u64::MAX)
            )
        })
        .collect::<Vec<_>>()
        .join(",")
}

fn describe_script_handle_from_value(
    runtime_scripts: &sakura_core::ScriptLibrary,
    value: &sakura_core::SystemValue<'_>,
) -> Option<String> {
    let sakura_core::SystemValue::UserScriptHandle(handle) = value else {
        return None;
    };
    Some(describe_script_handle(runtime_scripts, *handle))
}

fn describe_script_handle(runtime_scripts: &sakura_core::ScriptLibrary, handle: u32) -> String {
    let Some(id) = usize::try_from(handle)
        .ok()
        .and_then(|index| runtime_scripts.id_from_index(index))
    else {
        return format!("invalid:{handle}");
    };
    describe_script_id(runtime_scripts, id)
}

fn describe_script_id(runtime_scripts: &sakura_core::ScriptLibrary, id: ScriptId) -> String {
    let Some(script) = runtime_scripts.script(id) else {
        return format!("missing:{}", id.index());
    };
    let kind = match script.kind() {
        LoadedScriptKind::Scenario => "scenario",
        LoadedScriptKind::System => "system",
    };
    let name = runtime_scripts
        .name_by_id(id)
        .map(|bytes| format_script_name(bytes, 48))
        .unwrap_or_else(|| "unknown".to_owned());
    format!("{kind}:{name}:#{}", fnv1a32(script.decompressed()))
}

fn sys40_target_shape(
    runtime_scripts: &sakura_core::ScriptLibrary,
    args: &[sakura_core::SystemValue<'_>],
) -> Option<String> {
    for value in args.iter().rev() {
        let name = value.string_bytes()?;
        let Some(id) = runtime_scripts.find_by_name_bytes(name) else {
            continue;
        };
        return Some(format!(
            "{}=>{}",
            format_script_name(name, 48),
            describe_script_id(runtime_scripts, id)
        ));
    }
    None
}

fn format_user_call_arg_kinds(service_id: u8, args: &[sakura_core::SystemValue<'_>]) -> String {
    let kinds = args
        .iter()
        .take(7)
        .map(system_value_kind_label)
        .collect::<Vec<_>>()
        .join("+");
    format!("{service_id:02x}:argc{}:kinds-{kinds}", args.len().min(7))
}

fn format_service_arg_kinds(
    family: u8,
    service_id: u8,
    args: &[sakura_core::SystemValue<'_>],
) -> String {
    let kinds = args
        .iter()
        .take(7)
        .map(system_value_kind_label)
        .collect::<Vec<_>>()
        .join("+");
    format!(
        "{}:{service_id:02x}:argc{}:kinds-{kinds}",
        family_label(family),
        args.len().min(7)
    )
}

fn format_prefixed_string_counts(
    counts: &BTreeMap<String, usize>,
    prefix: &str,
    limit: usize,
) -> String {
    let mut ranked: Vec<(&str, usize)> = counts
        .iter()
        .filter_map(|(key, value)| key.starts_with(prefix).then_some((key.as_str(), *value)))
        .collect();
    ranked.sort_by(|(left_key, left_count), (right_key, right_count)| {
        right_count
            .cmp(left_count)
            .then_with(|| left_key.cmp(right_key))
    });
    ranked
        .into_iter()
        .take(limit)
        .map(|(value, count)| format!("{value}:{count}"))
        .collect::<Vec<_>>()
        .join(",")
}

fn format_service_trace_first(events: &[sakura_core::SystemServiceTraceEvent]) -> String {
    events
        .iter()
        .take(4)
        .map(|event| {
            format!(
                "{}:{:02x}:argc{}:top{}:ints{}:args{}",
                family_label(family_code(event.family)),
                event.service_id,
                event.arg_count.min(7),
                event.top_kind,
                event.integer_arg_count.min(7),
                format_arg_slots(event)
            )
        })
        .collect::<Vec<_>>()
        .join(",")
}

fn describe_event(event: &SystemVmEvent<'_>) -> String {
    match event {
        SystemVmEvent::ServiceCall {
            family,
            service_id,
            args,
        } => format!(
            "service:{}:{service_id:02x}:argc{}",
            family_label(family_code(*family)),
            args.len()
        ),
        SystemVmEvent::LoadedProgramCall {
            handle,
            offset,
            args,
        } => {
            format!("loaded:{handle}:{:?}:argc{}", offset, args.len())
        }
        SystemVmEvent::UserScriptCall { service_id, args } => {
            format!("user:{service_id:02x}:argc{}", args.len())
        }
        SystemVmEvent::UserScriptLoad => "user-load".to_owned(),
        SystemVmEvent::UserScriptFree { args } => format!("user-free:argc{}", args.len()),
        SystemVmEvent::UserScriptReturn => "user-return".to_owned(),
        SystemVmEvent::Halted => "halted".to_owned(),
    }
}

fn format_arg_slots(event: &sakura_core::SystemServiceTraceEvent) -> String {
    event
        .arg_slots
        .iter()
        .take(event.arg_count.min(event.arg_slots.len()).min(8))
        .map(|arg| match arg.kind {
            0 => "0".to_owned(),
            1 | 3 | 4 | 5 | 6 => format!("{}:{:x}", arg.kind, arg.value),
            2 => format!("2:{:x}:{}:{:x}", arg.value, arg.len, arg.hash),
            7 => "7".to_owned(),
            kind => format!("{kind}"),
        })
        .collect::<Vec<_>>()
        .join("|")
}

fn system_value_kind_label(value: &sakura_core::SystemValue<'_>) -> &'static str {
    match value {
        sakura_core::SystemValue::Integer(_) => "integer",
        sakura_core::SystemValue::String(_)
        | sakura_core::SystemValue::OwnedString(_)
        | sakura_core::SystemValue::LocalStringPointer { .. } => "string",
        sakura_core::SystemValue::Code(_) | sakura_core::SystemValue::CodeInScript { .. } => "code",
        sakura_core::SystemValue::VariablePointer(_) => "pointer",
        sakura_core::SystemValue::UserScriptHandle(_) => "handle",
        sakura_core::SystemValue::UserScriptResult(_) => "user_result",
        sakura_core::SystemValue::Unknown => "unknown",
    }
}

fn system_value_kind_code_label(kind: u8) -> &'static str {
    match kind {
        0 => "empty",
        1 => "integer",
        2 => "string",
        3 => "code",
        4 => "handle",
        5 => "user_result",
        6 => "pointer",
        7 => "unknown",
        _ => "invalid",
    }
}

fn format_opcode_trail(opcodes: impl Iterator<Item = u8>) -> String {
    opcodes
        .map(|opcode| format!("{opcode:02x}"))
        .collect::<Vec<_>>()
        .join("-")
}

fn is_standalone_dispatcher_error(message: &str, opcode_trail: &str) -> bool {
    if !message.contains("target is out of range") {
        return false;
    }
    opcode_trail.contains("10-00-20-11")
        && opcode_trail.contains("0c-04")
        && opcode_trail.ends_with("-08-16")
}

fn sanitize_error_message(message: &str) -> String {
    message.replace(',', ";")
}

fn format_script_name(bytes: &[u8], limit: usize) -> String {
    let truncated = bytes.len() > limit;
    let slice = &bytes[..bytes.len().min(limit)];
    let mut text = String::new();
    for &byte in slice {
        match byte {
            b'\\' => text.push_str("\\\\"),
            b'"' => text.push_str("\\\""),
            0x20..=0x7e => text.push(byte as char),
            _ => text.push('.'),
        }
    }
    if truncated {
        text.push_str("...");
    }
    format!("\"{text}\"")
}

fn fnv1a32(data: &[u8]) -> u32 {
    let mut hash = 0x811c9dc5u32;
    for byte in data {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(0x0100_0193);
    }
    hash
}

fn error_category(message: &str) -> &'static str {
    if message.contains("string target") || message.contains("script string") {
        "string"
    } else if message.contains("EOF") {
        "eof"
    } else if message.contains("target") {
        "control_target"
    } else if message.contains("stack") {
        "stack"
    } else if message.contains("opcode") {
        "opcode"
    } else {
        "other"
    }
}

fn family_code(family: SystemCallFamily) -> u8 {
    match family {
        SystemCallFamily::System => 0,
        SystemCallFamily::Graph => 1,
        SystemCallFamily::Sound => 2,
        SystemCallFamily::External => 3,
    }
}

fn family_label(family: u8) -> &'static str {
    match family {
        0 => "sys",
        1 => "graph",
        2 => "sound",
        3 => "ext",
        _ => "invalid",
    }
}

fn system_host_event_kind_label(kind: sakura_core::SystemHostEventKind) -> &'static str {
    match kind {
        sakura_core::SystemHostEventKind::None => "none",
        sakura_core::SystemHostEventKind::Service => "service",
        sakura_core::SystemHostEventKind::UserCall => "user_call",
        sakura_core::SystemHostEventKind::UserLoad => "user_load",
        sakura_core::SystemHostEventKind::UserFree => "user_free",
        sakura_core::SystemHostEventKind::UserReturn => "user_return",
        sakura_core::SystemHostEventKind::Halted => "halted",
    }
}
