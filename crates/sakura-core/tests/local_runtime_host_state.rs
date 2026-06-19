use sakura_core::{
    InstallManifest, Runtime, RuntimeConfig, SystemCallFamily, SystemHost, SystemHostEffect,
    SystemHostResult, SystemHostValue, SystemRuntime, SystemValue, SystemVmEvent,
};
use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::error::Error;
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};

type TestResult<T> = std::result::Result<T, Box<dyn Error>>;

const ENTRY_SCRIPT_NAME: &[u8] = b"logwnd._bp";
const CLASSIFICATION_NEAR_OFFSET: usize = 0x12df;
const MAX_EVENTS: usize = 4096;
const MAX_INSTRUCTIONS_PER_EVENT: usize = 100_000;
const SOUND_TRACE_EVENTS: usize = 4096;

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn traces_safe_host_state_near_services_without_asset_output() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let entry_index = entry_script_index(&runtime)?;
    probe_host_state(&runtime, entry_index, None, "entry")?;
    probe_service_tail(&runtime, entry_index, None, "entry")?;
    probe_host_state(
        &runtime,
        entry_index,
        Some(CLASSIFICATION_NEAR_OFFSET),
        "classification_near",
    )?;
    Ok(())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn summarizes_safe_sound_service_shapes_without_asset_output() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let entry_index = entry_script_index(&runtime)?;
    probe_sound_shapes(&runtime, entry_index, None, "entry")?;
    probe_sound_shapes(
        &runtime,
        entry_index,
        Some(CLASSIFICATION_NEAR_OFFSET),
        "classification_near",
    )?;
    Ok(())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn traces_graph1f_local_values_without_asset_output() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let scripts = runtime.scripts();
    let entry = scripts
        .find_by_name_bytes(ENTRY_SCRIPT_NAME)
        .ok_or("local graph1f probe script is missing")?;
    let mut host = SystemHost::with_runtime(&runtime);
    let mut vm = scripts
        .system_vm(entry)?
        .ok_or("graph1f probe target is not a system script")?;
    let mut event_index = 0usize;

    println!("local_graph1f_probe_version=1");
    loop {
        let event = vm.next_event()?;
        event_index += 1;
        if event_index >= 24 {
            println!(
                "local_graph1f_event event={} mem_ptr=0x{:08x} at=0x{:x} kind={}",
                event_index,
                vm.mem_ptr(),
                vm.last_instruction_offset().unwrap_or(0),
                describe_event(&event)
            );
        }
        let should_trace = matches!(
            &event,
            SystemVmEvent::ServiceCall {
                family: SystemCallFamily::Graph,
                service_id: 0x1f,
                ..
            }
        );
        if should_trace {
            println!(
                "local_graph1f_before event={} locals={}",
                event_index,
                format_local_probe_values(&vm, &[704, 708, 712, 716, 720, 1024, 1028, 1032])
            );
            println!(
                "local_graph1f_before_bytes event={} bytes={}",
                event_index,
                format_local_probe_bytes(
                    &vm,
                    &[
                        0x636, 0x637, 0x638, 0x639, 0x640, 0x641, 0x642, 0x643, 0x644, 0x645,
                        0x646, 0x647, 0x648, 0x649, 0x64a, 0x64b, 0x650
                    ]
                )
            );
            if let SystemVmEvent::ServiceCall { args, .. } = &event {
                println!(
                    "local_graph1f_args event={} args={}",
                    event_index,
                    format_values(args)
                );
            }
        }
        let Some(result) = host.event_result(&event) else {
            break;
        };
        if event_index >= 24 {
            println!(
                "local_graph1f_result event={} result={}",
                event_index,
                describe_result(&result)
            );
        }
        if let Some(effect) = result.effect() {
            for write in effect.writes() {
                vm.apply_host_write(write)?;
            }
        }
        if should_trace {
            println!(
                "local_graph1f_after_effect event={} locals={}",
                event_index,
                format_local_probe_values(&vm, &[704, 708, 712, 716, 720, 1024, 1028, 1032])
            );
            println!(
                "local_graph1f_after_effect_bytes event={} bytes={}",
                event_index,
                format_local_probe_bytes(
                    &vm,
                    &[
                        0x636, 0x637, 0x638, 0x639, 0x640, 0x641, 0x642, 0x643, 0x644, 0x645,
                        0x646, 0x647, 0x648, 0x649, 0x64a, 0x64b, 0x650
                    ]
                )
            );
        }
        if let Some(value) = result.into_value() {
            vm.resume_with(value)?;
            if should_trace {
                println!(
                    "local_graph1f_after_resume event={} locals={}",
                    event_index,
                    format_local_probe_values(&vm, &[704, 708, 712, 716, 720, 1024, 1028, 1032])
                );
            }
        }
        if event_index >= 64 {
            break;
        }
    }
    Ok(())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn traces_graph1f_injected_return_without_asset_output() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let scripts = runtime.scripts();
    let entry = scripts
        .find_by_name_bytes(ENTRY_SCRIPT_NAME)
        .ok_or("local graph1f injection probe script is missing")?;
    let mut host = SystemHost::with_runtime(&runtime);
    let mut vm = scripts
        .system_vm(entry)?
        .ok_or("graph1f injection probe target is not a system script")?;
    let mut event_index = 0usize;

    println!("local_graph1f_injected_probe_version=1");
    loop {
        let event = vm.next_event()?;
        event_index += 1;
        let injected = matches!(
            &event,
            SystemVmEvent::ServiceCall {
                family: SystemCallFamily::Graph,
                service_id: 0x1f,
                ..
            }
        );
        if injected {
            println!(
                "local_graph1f_injected_before event={} locals={}",
                event_index,
                format_local_probe_values(&vm, &[704, 708, 712, 716, 720, 1024, 1028, 1032])
            );
            println!(
                "local_graph1f_injected_before_bytes event={} bytes={}",
                event_index,
                format_local_probe_bytes(
                    &vm,
                    &[
                        0x636, 0x637, 0x638, 0x639, 0x640, 0x641, 0x642, 0x643, 0x644, 0x645,
                        0x646, 0x647, 0x648, 0x649, 0x64a, 0x64b, 0x650
                    ]
                )
            );
            if let SystemVmEvent::ServiceCall { args, .. } = &event {
                println!(
                    "local_graph1f_injected_args event={} args={}",
                    event_index,
                    format_values(args)
                );
            }
        }
        if injected {
            vm.resume_with(SystemValue::Integer(0x0001_0001))?;
            println!(
                "local_graph1f_injected_after_resume event={} locals={}",
                event_index,
                format_local_probe_values(&vm, &[704, 708, 712, 716, 720, 1024, 1028, 1032])
            );
            println!(
                "local_graph1f_injected_after_resume_bytes event={} bytes={}",
                event_index,
                format_local_probe_bytes(
                    &vm,
                    &[
                        0x636, 0x637, 0x638, 0x639, 0x640, 0x641, 0x642, 0x643, 0x644, 0x645,
                        0x646, 0x647, 0x648, 0x649, 0x64a, 0x64b, 0x650
                    ]
                )
            );
        } else {
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
        if event_index >= 24 {
            break;
        }
    }
    Ok(())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn reproduces_runtime_session_step_progress_without_asset_output() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let entry_index = entry_script_index(&runtime)?;
    let scripts = runtime.scripts();
    let entry = scripts
        .id_from_index(entry_index)
        .ok_or("runtime session probe entry is missing")?;
    let host = SystemHost::with_runtime(&runtime);
    let mut system_runtime = SystemRuntime::new(scripts, host);
    system_runtime.push_script_at(entry, None, Vec::new())?;

    println!("local_runtime_session_probe_version=1");
    for step in 0..4usize {
        let (summary, _trace) =
            system_runtime.run_with_service_trace(64, MAX_INSTRUCTIONS_PER_EVENT, 8)?;
        let frame = system_runtime.current_frame_state();
        println!(
            "local_runtime_session_step={} events={} services={} completed={} limited={} sys1c={} sys49={} sys5f={} graphbf={} frame_script={} frame_cursor={} frame_last=0x{:x} local7100={} local7108={} local3956={} local4024={}",
            step,
            summary.event_count,
            summary.service_event_count,
            u8::from(summary.completed),
            u8::from(summary.event_limited),
            summary.syscall_service_counts[0x1c],
            summary.syscall_service_counts[0x49],
            summary.syscall_service_counts[0x5f],
            summary.graphcall_service_counts[0xbf],
            frame.as_ref().map_or(usize::MAX, |frame| frame.script_index),
            frame.as_ref().map_or(usize::MAX, |frame| frame.cursor),
            frame.as_ref().map_or(0, |frame| frame.last_instruction_offset),
            frame.as_ref().map_or(0, |frame| frame.local_7100),
            frame.as_ref().map_or(0, |frame| frame.local_7108),
            frame.as_ref().map_or(0, |frame| frame.local_3956),
            frame.as_ref().map_or(0, |frame| frame.local_4024),
        );
        if summary.completed {
            break;
        }
    }
    Ok(())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn reproduces_scrdrv_chunked_runtime_progress_without_restore() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let entry_index = runtime
        .script_index_by_name(b"scrdrv._bp")
        .ok_or("scrdrv chunked probe entry is missing")?;
    let scripts = runtime.scripts();
    let entry = scripts
        .id_from_index(entry_index)
        .ok_or("scrdrv chunked probe script is missing")?;
    let host = SystemHost::with_runtime(&runtime);
    let mut system_runtime = SystemRuntime::new(scripts, host);
    system_runtime.push_script_at(entry, None, Vec::new())?;

    println!("local_scrdrv_chunked_runtime_probe_version=1");
    for step in 0..8usize {
        let (summary, trace) =
            system_runtime.run_with_service_trace(64, MAX_INSTRUCTIONS_PER_EVENT, 8)?;
        let frame = system_runtime.current_frame_state();
        println!(
            "local_scrdrv_chunked_runtime_step={} events={} services={} completed={} limited={} halted={} user_calls={} frame_script={} frame_cursor={} frame_last=0x{:x} local64={} local68={} local3956={} local4024={} local7100={} local7108={} trace_total={} trace_tail={}",
            step,
            summary.event_count,
            summary.service_event_count,
            u8::from(summary.completed),
            u8::from(summary.event_limited),
            summary.halted_event_count,
            summary.user_call_event_count,
            frame.as_ref().map_or(usize::MAX, |frame| frame.script_index),
            frame.as_ref().map_or(usize::MAX, |frame| frame.cursor),
            frame.as_ref().map_or(0, |frame| frame.last_instruction_offset),
            frame.as_ref().map_or(0, |frame| frame.local_64),
            frame.as_ref().map_or(0, |frame| frame.local_68),
            frame.as_ref().map_or(0, |frame| frame.local_3956),
            frame.as_ref().map_or(0, |frame| frame.local_4024),
            frame.as_ref().map_or(0, |frame| frame.local_7100),
            frame.as_ref().map_or(0, |frame| frame.local_7108),
            trace.total_service_count,
            format_service_events_tail(&trace.recorded_services, 8),
        );
        if summary.completed {
            break;
        }
    }
    Ok(())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn pinpoints_scrdrv_chunked_runtime_failure_boundary() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let entry_index = runtime
        .script_index_by_name(b"scrdrv._bp")
        .ok_or("scrdrv boundary probe entry is missing")?;
    let scripts = runtime.scripts();
    let entry = scripts
        .id_from_index(entry_index)
        .ok_or("scrdrv boundary probe script is missing")?;
    let host = SystemHost::with_runtime(&runtime);
    let mut system_runtime = SystemRuntime::new(scripts, host);
    system_runtime.push_script_at(entry, None, Vec::new())?;

    let chunk_sizes = [64usize, 64, 8, 8, 8, 8, 4, 4, 2, 2, 1, 1, 1, 1];
    println!("local_scrdrv_boundary_probe_version=1");
    for (chunk_index, max_events) in chunk_sizes.into_iter().enumerate() {
        let result =
            system_runtime.run_with_service_trace(max_events, MAX_INSTRUCTIONS_PER_EVENT, 8);
        match result {
            Ok((summary, trace)) => {
                let frame = system_runtime.current_frame_state();
                println!(
                    "local_scrdrv_boundary_chunk={} max_events={} events={} services={} halted={} user_calls={} completed={} limited={} frame_script={} frame_cursor={} frame_last=0x{:x} trace_tail={}",
                    chunk_index,
                    max_events,
                    summary.event_count,
                    summary.service_event_count,
                    summary.halted_event_count,
                    summary.user_call_event_count,
                    u8::from(summary.completed),
                    u8::from(summary.event_limited),
                    frame.as_ref().map_or(usize::MAX, |frame| frame.script_index),
                    frame.as_ref().map_or(usize::MAX, |frame| frame.cursor),
                    frame.as_ref().map_or(0, |frame| frame.last_instruction_offset),
                    format_service_events_tail(&trace.recorded_services, 8),
                );
            }
            Err(error) => {
                let frame = system_runtime.current_frame_state();
                println!(
                    "local_scrdrv_boundary_error chunk={} max_events={} error={error} frame_script={} frame_cursor={} frame_last=0x{:x}",
                    chunk_index,
                    max_events,
                    frame.as_ref().map_or(usize::MAX, |frame| frame.script_index),
                    frame.as_ref().map_or(usize::MAX, |frame| frame.cursor),
                    frame.as_ref().map_or(0, |frame| frame.last_instruction_offset),
                );
                return Err(error.into());
            }
        }
    }
    Ok(())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn traces_scrmain_call_target_state() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let entry_index = runtime
        .script_index_by_name(b"scrmain._bp")
        .ok_or("scrmain target-state probe entry is missing")?;
    let scripts = runtime.scripts();
    let entry = scripts
        .id_from_index(entry_index)
        .ok_or("scrmain target-state probe script is missing")?;
    let host = SystemHost::with_runtime(&runtime);
    let mut system_runtime = SystemRuntime::new(scripts, host);
    system_runtime.push_script_at(entry, None, Vec::new())?;

    println!("local_scrmain_target_state_probe_version=1");
    for step in 0..8usize {
        let (summary, trace) =
            system_runtime.run_with_service_trace(1, MAX_INSTRUCTIONS_PER_EVENT, 4)?;
        let frame = system_runtime.current_frame_state();
        println!(
            "local_scrmain_target_state_step={} events={} services={} completed={} limited={} halted={} frame_script={} frame_cursor={} frame_last=0x{:x} local12={} local16={} local20={} local_0x1f62c={} local_0x935e8={} local_0x935ec={} trace_tail={}",
            step,
            summary.event_count,
            summary.service_event_count,
            u8::from(summary.completed),
            u8::from(summary.event_limited),
            summary.halted_event_count,
            frame.as_ref().map_or(usize::MAX, |frame| frame.script_index),
            frame.as_ref().map_or(usize::MAX, |frame| frame.cursor),
            frame.as_ref().map_or(0, |frame| frame.last_instruction_offset),
            read_host_local_u32(&system_runtime, 12),
            read_host_local_u32(&system_runtime, 16),
            read_host_local_u32(&system_runtime, 20),
            read_host_local_u32(&system_runtime, 0x1f62c),
            read_host_local_u32(&system_runtime, 0x935e8),
            read_host_local_u32(&system_runtime, 0x935ec),
            format_service_events_tail(&trace.recorded_services, 4),
        );
    }
    Ok(())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn traces_scrmain_init_locals_across_events() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let entry_index = runtime
        .script_index_by_name(b"scrmain._bp")
        .ok_or("scrmain init-local probe entry is missing")?;
    let scripts = runtime.scripts();
    let entry = scripts
        .id_from_index(entry_index)
        .ok_or("scrmain init-local probe script is missing")?;
    let host = SystemHost::with_runtime(&runtime);
    let mut system_runtime = SystemRuntime::new(scripts, host);
    system_runtime.push_script_at(entry, None, Vec::new())?;

    println!("local_scrmain_init_locals_probe_version=1");
    for step in 0..12usize {
        let result = system_runtime.run_with_service_trace(1, MAX_INSTRUCTIONS_PER_EVENT, 4);
        match result {
            Ok((summary, trace)) => {
                let frame = system_runtime.current_frame_state();
                println!(
                    "local_scrmain_init_locals_step={} events={} services={} halted={} completed={} limited={} frame_cursor={} frame_last=0x{:x} l12={} l16={} l20={} l1076={} l1140={} l1264={} l1268={} l1272={} l1276={} raw603624={} raw603628={} raw603632={} trace={}",
                    step,
                    summary.event_count,
                    summary.service_event_count,
                    summary.halted_event_count,
                    u8::from(summary.completed),
                    u8::from(summary.event_limited),
                    frame.as_ref().map_or(usize::MAX, |frame| frame.cursor),
                    frame.as_ref().map_or(0, |frame| frame.last_instruction_offset),
                    system_runtime.current_frame_local_integer(12, 2).unwrap_or(0),
                    system_runtime.current_frame_local_integer(16, 2).unwrap_or(0),
                    system_runtime.current_frame_local_integer(20, 2).unwrap_or(0),
                    system_runtime.current_frame_local_integer(1076, 2).unwrap_or(0),
                    system_runtime.current_frame_local_integer(1140, 2).unwrap_or(0),
                    system_runtime.current_frame_local_integer(1264, 2).unwrap_or(0),
                    system_runtime.current_frame_local_integer(1268, 2).unwrap_or(0),
                    system_runtime.current_frame_local_integer(1272, 2).unwrap_or(0),
                    system_runtime.current_frame_local_integer(1276, 2).unwrap_or(0),
                    read_host_raw_u32(&system_runtime, 603624),
                    read_host_raw_u32(&system_runtime, 603628),
                    read_host_raw_u32(&system_runtime, 603632),
                    format_service_events_tail(&trace.recorded_services, 4),
                );
            }
            Err(error) => {
                let frame = system_runtime.current_frame_state();
                println!(
                    "local_scrmain_init_locals_error step={} error={error} frame_cursor={} frame_last=0x{:x} l12={} l16={} l20={} l1076={} l1140={} l1264={} l1268={} l1272={} l1276={} raw603624={} raw603628={} raw603632={}",
                    step,
                    frame.as_ref().map_or(usize::MAX, |frame| frame.cursor),
                    frame.as_ref().map_or(0, |frame| frame.last_instruction_offset),
                    system_runtime.current_frame_local_integer(12, 2).unwrap_or(0),
                    system_runtime.current_frame_local_integer(16, 2).unwrap_or(0),
                    system_runtime.current_frame_local_integer(20, 2).unwrap_or(0),
                    system_runtime.current_frame_local_integer(1076, 2).unwrap_or(0),
                    system_runtime.current_frame_local_integer(1140, 2).unwrap_or(0),
                    system_runtime.current_frame_local_integer(1264, 2).unwrap_or(0),
                    system_runtime.current_frame_local_integer(1268, 2).unwrap_or(0),
                    system_runtime.current_frame_local_integer(1272, 2).unwrap_or(0),
                    system_runtime.current_frame_local_integer(1276, 2).unwrap_or(0),
                    read_host_raw_u32(&system_runtime, 603624),
                    read_host_raw_u32(&system_runtime, 603628),
                    read_host_raw_u32(&system_runtime, 603632),
                );
                return Err(error.into());
            }
        }
    }
    Ok(())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn traces_scrmain_low_instruction_budget_transition() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let entry_index = runtime
        .script_index_by_name(b"scrmain._bp")
        .ok_or("scrmain low-budget probe entry is missing")?;
    let scripts = runtime.scripts();
    let entry = scripts
        .id_from_index(entry_index)
        .ok_or("scrmain low-budget probe script is missing")?;
    let host = SystemHost::with_runtime(&runtime);
    let mut system_runtime = SystemRuntime::new(scripts, host);
    system_runtime.push_script_at(entry, None, Vec::new())?;

    let (summary, trace) =
        system_runtime.run_with_service_trace(1, MAX_INSTRUCTIONS_PER_EVENT, 4)?;
    println!(
        "local_scrmain_low_budget_seed events={} services={} frame_cursor={} frame_last=0x{:x} trace={}",
        summary.event_count,
        summary.service_event_count,
        system_runtime.current_frame_state().map_or(usize::MAX, |f| f.cursor),
        system_runtime.current_frame_state().map_or(0, |f| f.last_instruction_offset),
        format_service_events(&trace.recorded_services)
    );

    println!("local_scrmain_low_budget_probe_version=1");
    for limit in [1usize, 2, 4, 8, 12, 16, 20, 24, 32, 48, 64, 96, 128] {
        let result = system_runtime.run_with_service_trace(1, limit, 4);
        match result {
            Ok((step_summary, step_trace)) => {
                let frame = system_runtime.current_frame_state();
                println!(
                    "local_scrmain_low_budget limit={} events={} services={} halted={} completed={} limited={} frame_cursor={} frame_last=0x{:x} l4={} l12={} l16={} l20={} l1264={} l1268={} l1272={} l1276={} raw603624={} raw603628={} raw603632={} trace={}",
                    limit,
                    step_summary.event_count,
                    step_summary.service_event_count,
                    step_summary.halted_event_count,
                    u8::from(step_summary.completed),
                    u8::from(step_summary.event_limited),
                    frame.as_ref().map_or(usize::MAX, |f| f.cursor),
                    frame.as_ref().map_or(0, |f| f.last_instruction_offset),
                    system_runtime.current_frame_local_integer(4, 2).unwrap_or(0),
                    system_runtime.current_frame_local_integer(12, 2).unwrap_or(0),
                    system_runtime.current_frame_local_integer(16, 2).unwrap_or(0),
                    system_runtime.current_frame_local_integer(20, 2).unwrap_or(0),
                    system_runtime.current_frame_local_integer(1264, 2).unwrap_or(0),
                    system_runtime.current_frame_local_integer(1268, 2).unwrap_or(0),
                    system_runtime.current_frame_local_integer(1272, 2).unwrap_or(0),
                    system_runtime.current_frame_local_integer(1276, 2).unwrap_or(0),
                    read_host_raw_u32(&system_runtime, 603624),
                    read_host_raw_u32(&system_runtime, 603628),
                    read_host_raw_u32(&system_runtime, 603632),
                    format_service_events(&step_trace.recorded_services),
                );
            }
            Err(error) => {
                let frame = system_runtime.current_frame_state();
                println!(
                    "local_scrmain_low_budget_error limit={} error={error} frame_cursor={} frame_last=0x{:x} l4={} l12={} l16={} l20={} l1264={} l1268={} l1272={} l1276={} raw603624={} raw603628={} raw603632={}",
                    limit,
                    frame.as_ref().map_or(usize::MAX, |f| f.cursor),
                    frame.as_ref().map_or(0, |f| f.last_instruction_offset),
                    system_runtime.current_frame_local_integer(4, 2).unwrap_or(0),
                    system_runtime.current_frame_local_integer(12, 2).unwrap_or(0),
                    system_runtime.current_frame_local_integer(16, 2).unwrap_or(0),
                    system_runtime.current_frame_local_integer(20, 2).unwrap_or(0),
                    system_runtime.current_frame_local_integer(1264, 2).unwrap_or(0),
                    system_runtime.current_frame_local_integer(1268, 2).unwrap_or(0),
                    system_runtime.current_frame_local_integer(1272, 2).unwrap_or(0),
                    system_runtime.current_frame_local_integer(1276, 2).unwrap_or(0),
                    read_host_raw_u32(&system_runtime, 603624),
                    read_host_raw_u32(&system_runtime, 603628),
                    read_host_raw_u32(&system_runtime, 603632),
                );
            }
        }
    }
    Ok(())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn experiments_scrmain_sys5f_pending_clear_override() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let scripts = runtime.scripts();
    let entry_index = runtime
        .script_index_by_name(b"scrmain._bp")
        .ok_or("scrmain sys5f override entry is missing")?;
    let entry = scripts
        .id_from_index(entry_index)
        .ok_or("scrmain sys5f override script is missing")?;
    let mut host = SystemHost::with_runtime(&runtime);
    let mut vm = scripts
        .system_vm(entry)?
        .ok_or("scrmain sys5f override target is not a system script")?;

    println!("local_scrmain_sys5f_override_probe_version=1");
    let mut observed_31c_failure = false;
    for step in 0..16usize {
        let event = match vm.next_event() {
            Ok(event) => event,
            Err(error) => {
                let text = error.to_string();
                println!(
                    "local_scrmain_sys5f_override_error step={} error={} cursor={} last=0x{:x}",
                    step,
                    text,
                    vm.cursor(),
                    vm.last_instruction_offset().unwrap_or(0),
                );
                if text.contains("0x31c") {
                    observed_31c_failure = true;
                    break;
                }
                return Err(error.into());
            }
        };
        println!(
            "local_scrmain_sys5f_override_event step={} kind={} cursor={} last=0x{:x} mem_ptr=0x{:x} l4={} l12={} l16={} l20={} l1076={} l1140={} l1264={} l1268={} l1272={} l1276={} raw603624={} raw603628={} raw603632={}",
            step,
            describe_event(&event),
            vm.cursor(),
            vm.last_instruction_offset().unwrap_or(0),
            vm.mem_ptr(),
            vm.host_local_integer(4, 2).unwrap_or(0),
            vm.host_local_integer(12, 2).unwrap_or(0),
            vm.host_local_integer(16, 2).unwrap_or(0),
            vm.host_local_integer(20, 2).unwrap_or(0),
            vm.host_local_integer(1076, 2).unwrap_or(0),
            vm.host_local_integer(1140, 2).unwrap_or(0),
            vm.host_local_integer(1264, 2).unwrap_or(0),
            vm.host_local_integer(1268, 2).unwrap_or(0),
            vm.host_local_integer(1272, 2).unwrap_or(0),
            vm.host_local_integer(1276, 2).unwrap_or(0),
            read_host_raw_u32_vm(&vm, 603624),
            read_host_raw_u32_vm(&vm, 603628),
            read_host_raw_u32_vm(&vm, 603632),
        );
        let result = match &event {
            SystemVmEvent::ServiceCall {
                family: SystemCallFamily::System,
                service_id: 0x5f,
                ..
            } => {
                let mut effect = SystemHostEffect::new();
                effect.push_write(603624, 2, 0);
                effect.push_write(603628, 2, 0);
                effect.push_write(603632, 2, 0);
                Some(SystemHostResult::ValueAndEffect {
                    value: SystemHostValue::Integer(0),
                    effect,
                })
            }
            _ => host.event_result(&event),
        };
        let Some(result) = result else {
            break;
        };
        println!(
            "local_scrmain_sys5f_override_result step={} result={}",
            step,
            describe_result(&result)
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
    if !observed_31c_failure {
        return Err("sys5f override did not reproduce the scrmain 0x31c failure".into());
    }
    Ok(())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn traces_scrmain_raw_vm_stack_after_sys8b() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let scripts = runtime.scripts();
    let entry_index = runtime
        .script_index_by_name(b"scrmain._bp")
        .ok_or("scrmain raw-vm probe entry is missing")?;
    let entry = scripts
        .id_from_index(entry_index)
        .ok_or("scrmain raw-vm probe script is missing")?;
    let mut host = SystemHost::with_runtime(&runtime);
    let mut vm = scripts
        .system_vm(entry)?
        .ok_or("scrmain raw-vm probe target is not a system script")?;

    println!("local_scrmain_raw_vm_probe_version=1");
    for event_index in 0..4usize {
        let event = vm.next_event()?;
        println!(
            "local_scrmain_raw_vm_event={} kind={} cursor={} last=0x{:x} mem_ptr=0x{:x} stack_len={} stack={}",
            event_index,
            describe_event(&event),
            vm.cursor(),
            vm.last_instruction_offset().unwrap_or(0),
            vm.mem_ptr(),
            vm.stack().len(),
            format_values(vm.stack()),
        );
        let Some(result) = host.event_result(&event) else {
            break;
        };
        println!(
            "local_scrmain_raw_vm_result={} local4={} local12={} local16={} local20={} l1264={} l1268={} l1272={} l1276={}",
            describe_result(&result),
            vm.host_local_integer(4, 2).unwrap_or(0),
            vm.host_local_integer(12, 2).unwrap_or(0),
            vm.host_local_integer(16, 2).unwrap_or(0),
            vm.host_local_integer(20, 2).unwrap_or(0),
            vm.host_local_integer(1264, 2).unwrap_or(0),
            vm.host_local_integer(1268, 2).unwrap_or(0),
            vm.host_local_integer(1272, 2).unwrap_or(0),
            vm.host_local_integer(1276, 2).unwrap_or(0),
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
    Ok(())
}

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn experiments_scrmain_sys8b_gate_behavior() -> TestResult<()> {
    let runtime = mount_runtime_from_env()?;
    let scripts = runtime.scripts();
    let entry_index = runtime
        .script_index_by_name(b"scrmain._bp")
        .ok_or("scrmain sys8b experiment entry is missing")?;
    let entry = scripts
        .id_from_index(entry_index)
        .ok_or("scrmain sys8b experiment script is missing")?;

    for injected in [1u64, 0x1000_017e] {
        let mut host = SystemHost::with_runtime(&runtime);
        let mut vm = scripts
            .system_vm(entry)?
            .ok_or("scrmain sys8b experiment raw vm is missing")?;
        let mut observed_31c_failure = false;
        println!("local_scrmain_sys8b_experiment_injected={injected}");
        for event_index in 0..4usize {
            let event = match vm.next_event() {
                Ok(event) => event,
                Err(error) => {
                    let text = error.to_string();
                    println!(
                        "local_scrmain_sys8b_raw_error injected={} index={} error={} cursor={} last=0x{:x}",
                        injected,
                        event_index,
                        text,
                        vm.cursor(),
                        vm.last_instruction_offset().unwrap_or(0),
                    );
                    if text.contains("0x31c") {
                        observed_31c_failure = true;
                        break;
                    }
                    return Err(error.into());
                }
            };
            println!(
                "local_scrmain_sys8b_raw_event index={} event={} local12_before={} local16_before={} local20_before={} table_0x1f62c_before={} table_0x1f630_before={} table_0x1f634_before={}",
                event_index,
                describe_event(&event),
                vm.host_local_integer(12, 2).unwrap_or(0),
                vm.host_local_integer(16, 2).unwrap_or(0),
                vm.host_local_integer(20, 2).unwrap_or(0)
                ,
                vm.host_local_integer(0x1f62c, 2).unwrap_or(0),
                vm.host_local_integer(0x1f630, 2).unwrap_or(0),
                vm.host_local_integer(0x1f634, 2).unwrap_or(0),
            );
            if event_index == 0 {
                println!("local_scrmain_sys8b_raw_patch resume_value={}", injected);
                vm.resume_with(SystemValue::Integer(injected))?;
                println!(
                    "local_scrmain_sys8b_raw_after_resume local12_after={} local16_after={} local20_after={} table_0x1f62c_after={}",
                    vm.host_local_integer(12, 2).unwrap_or(0),
                    vm.host_local_integer(16, 2).unwrap_or(0),
                    vm.host_local_integer(20, 2).unwrap_or(0),
                    vm.host_local_integer(0x1f62c, 2).unwrap_or(0),
                );
                continue;
            }
            let Some(result) = host.event_result(&event) else {
                break;
            };
            println!(
                "local_scrmain_sys8b_raw_result index={} result={}",
                event_index,
                describe_result(&result)
            );
            if let Some(effect) = result.effect() {
                for write in effect.writes() {
                    vm.apply_host_write(write)?;
                }
            }
            if let Some(value) = result.into_value() {
                vm.resume_with(value)?;
            }
            println!(
                "local_scrmain_sys8b_raw_after index={} local12={} local16={} local20={} table_0x1f62c={} table_0x1f630={} table_0x1f634={}",
                event_index,
                vm.host_local_integer(12, 2).unwrap_or(0),
                vm.host_local_integer(16, 2).unwrap_or(0),
                vm.host_local_integer(20, 2).unwrap_or(0),
                vm.host_local_integer(0x1f62c, 2).unwrap_or(0),
                vm.host_local_integer(0x1f630, 2).unwrap_or(0),
                vm.host_local_integer(0x1f634, 2).unwrap_or(0),
            );
        }
        if !observed_31c_failure {
            return Err(format!(
                "raw sys8b resume value {injected:08x} did not reproduce the scrmain 0x31c failure"
            )
            .into());
        }
    }
    Ok(())
}

fn probe_host_state(
    runtime: &Runtime,
    script_index: usize,
    offset: Option<usize>,
    label: &str,
) -> TestResult<()> {
    let scripts = runtime.scripts();
    let entry = scripts
        .id_from_index(script_index)
        .ok_or("local runtime host-state probe script is missing")?;
    let host = SystemHost::with_runtime(runtime);
    let mut system_runtime = SystemRuntime::new(scripts, host);
    system_runtime.push_script_at(entry, offset, Vec::new())?;
    let (summary, trace) =
        system_runtime.run_with_service_trace(MAX_EVENTS, MAX_INSTRUCTIONS_PER_EVENT, 32)?;
    let state = summary.host_state;

    println!("local_runtime_host_state_probe_version=1");
    println!("local_runtime_host_state_label={label}");
    println!(
        "local_runtime_host_state_event_count={}",
        summary.event_count
    );
    println!(
        "local_runtime_host_state_service_count={}",
        summary.service_event_count
    );
    println!(
        "local_runtime_host_state_trace_total={}",
        trace.total_service_count
    );
    println!(
        "local_runtime_host_state_first_service_offset=0x{:x}",
        trace
            .recorded_services
            .first()
            .map_or(0, |event| event.instruction_offset)
    );
    println!(
        "local_runtime_host_state_sound_prefix={}",
        format_sound_prefix(&trace.recorded_services)
    );
    println!(
        "local_runtime_host_state_first_events={}",
        format_service_events(&trace.recorded_services)
    );
    println!(
        "local_runtime_host_state_sound_service_count={}",
        state.sound_service_count
    );
    println!(
        "local_runtime_host_state_last_sound_id={:02x}",
        state.last_sound_service_id
    );
    println!(
        "local_runtime_host_state_file_query_count={}",
        state.file_query_count
    );
    println!(
        "local_runtime_host_state_last_asset_string_len={}",
        state.last_asset_string_len
    );
    println!(
        "local_runtime_host_state_last_asset_hash_low32={}",
        state.last_asset_string_hash as u32
    );
    println!(
        "local_runtime_host_state_last_asset_query_service_id={:02x}",
        state.last_asset_query_service_id
    );
    println!(
        "local_runtime_host_state_last_asset_found={}",
        u8::from(state.last_asset_found)
    );
    println!(
        "local_runtime_host_state_loaded_script_string_len={}",
        state.last_loaded_script_string_len
    );
    println!(
        "local_runtime_host_state_loaded_script_hash_low32={}",
        state.last_loaded_script_string_hash as u32
    );
    println!(
        "local_runtime_host_state_loaded_script_found={}",
        u8::from(state.last_loaded_script_found)
    );
    println!(
        "local_runtime_host_state_sound_after_asset_query_count={}",
        state.sound_after_asset_query_count
    );
    Ok(())
}

fn probe_sound_shapes(
    runtime: &Runtime,
    script_index: usize,
    offset: Option<usize>,
    label: &str,
) -> TestResult<()> {
    let scripts = runtime.scripts();
    let entry = scripts
        .id_from_index(script_index)
        .ok_or("local sound service probe script is missing")?;
    let host = SystemHost::with_runtime(runtime);
    let mut system_runtime = SystemRuntime::new(scripts, host);
    system_runtime.push_script_at(entry, offset, Vec::new())?;
    let (_summary, trace) = system_runtime.run_with_service_trace(
        MAX_EVENTS,
        MAX_INSTRUCTIONS_PER_EVENT,
        SOUND_TRACE_EVENTS,
    )?;
    let sound = summarize_sound_trace(&trace.recorded_services);

    println!("local_sound_service_shape_probe_version=1");
    println!("local_sound_service_shape_label={label}");
    println!(
        "local_sound_service_shape_total={}",
        sound.total_sound_count
    );
    println!(
        "local_sound_service_shape_recorded_services={}",
        trace.recorded_services.len()
    );
    println!(
        "local_sound_service_shape_ids={}",
        format_sound_id_shapes(&sound.by_id, 12)
    );
    println!(
        "local_sound_service_shape_prev_services={}",
        format_prev_services(&sound.prev_services, 10)
    );
    println!(
        "local_sound_service_shape_prev_sound_pairs={}",
        format_sound_pairs(&sound.prev_sound_pairs, 16)
    );
    println!(
        "local_sound_service_shape_recent_non_sound={}",
        format_sound_contexts(&sound.recent_non_sound_by_id, 16)
    );
    println!(
        "local_sound_service_shape_distance_from_file_query={}",
        format_buckets(&sound.file_query_distance_buckets)
    );
    println!(
        "local_sound_service_shape_sound_with_string_count={}",
        sound.sound_with_string_count
    );
    println!(
        "local_sound_service_shape_first_string_len={}",
        sound.first_sound_string_len
    );
    println!(
        "local_sound_service_shape_first_string_hash_low32={}",
        sound.first_sound_string_hash as u32
    );
    Ok(())
}

fn probe_service_tail(
    runtime: &Runtime,
    script_index: usize,
    offset: Option<usize>,
    label: &str,
) -> TestResult<()> {
    let scripts = runtime.scripts();
    let entry = scripts
        .id_from_index(script_index)
        .ok_or("local service tail probe script is missing")?;
    let host = SystemHost::with_runtime(runtime);
    let mut system_runtime = SystemRuntime::new(scripts, host);
    system_runtime.push_script_at(entry, offset, Vec::new())?;
    let (_summary, trace) = system_runtime.run_with_service_trace(
        MAX_EVENTS,
        MAX_INSTRUCTIONS_PER_EVENT,
        SOUND_TRACE_EVENTS,
    )?;

    println!("local_service_tail_probe_version=1");
    println!("local_service_tail_label={label}");
    println!(
        "local_service_tail_recorded={}",
        trace.recorded_services.len()
    );
    println!(
        "local_service_tail_last_events={}",
        format_service_events_tail(&trace.recorded_services, 24)
    );
    println!(
        "local_service_tail_last_pairs={}",
        format_service_pairs_tail(&trace.recorded_services, 16)
    );
    Ok(())
}

fn format_local_probe_values(vm: &sakura_core::SystemVm<'_>, offsets: &[u32]) -> String {
    offsets
        .iter()
        .map(|offset| {
            let value = vm.host_local_integer(*offset, 2).unwrap_or(u64::MAX);
            format!("{offset}:{value:08x}")
        })
        .collect::<Vec<_>>()
        .join(",")
}

fn format_local_probe_bytes(vm: &sakura_core::SystemVm<'_>, offsets: &[u32]) -> String {
    offsets
        .iter()
        .map(|offset| {
            let value = vm.host_local_integer(*offset, 0).unwrap_or(u64::MAX);
            format!("{offset}:{value:02x}")
        })
        .collect::<Vec<_>>()
        .join(",")
}

fn format_values(values: &[SystemValue<'_>]) -> String {
    values
        .iter()
        .map(|value| match value {
            SystemValue::Integer(value) => format!("i:{value:08x}"),
            SystemValue::VariablePointer(value) => format!("p:{value:08x}"),
            SystemValue::LocalStringPointer { address, .. } => format!("ls:{address:08x}"),
            SystemValue::String(bytes) => format!("s:{}", bytes.len()),
            SystemValue::OwnedString(bytes) => format!("os:{}", bytes.len()),
            SystemValue::Code(offset) => format!("c:{offset:08x}"),
            SystemValue::CodeInScript {
                script_index,
                offset,
            } => format!("cs:{script_index}:{offset:08x}"),
            SystemValue::UserScriptHandle(handle) => format!("h:{handle:08x}"),
            SystemValue::UserScriptResult(result) => format!("ur:{result:02x}"),
            SystemValue::Unknown => "u".to_owned(),
        })
        .collect::<Vec<_>>()
        .join("|")
}

fn format_service_events_tail(
    events: &[sakura_core::SystemServiceTraceEvent],
    limit: usize,
) -> String {
    let start = events.len().saturating_sub(limit);
    format_service_events(&events[start..])
}

fn format_service_pairs_tail(
    events: &[sakura_core::SystemServiceTraceEvent],
    limit: usize,
) -> String {
    let start = events.len().saturating_sub(limit + 1);
    events[start..]
        .windows(2)
        .map(|pair| {
            let prev = &pair[0];
            let next = &pair[1];
            format!(
                "{}:{:02x}>{}:{:02x}",
                family_label(prev.family),
                prev.service_id,
                family_label(next.family),
                next.service_id
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
            "svc:{}:{service_id:02x}:{}",
            family_label(*family),
            format_values(args)
        ),
        SystemVmEvent::LoadedProgramCall {
            handle,
            offset,
            args,
        } => {
            format!("loaded:{handle}:{:?}:{}", offset, format_values(args))
        }
        SystemVmEvent::UserScriptCall { service_id, args } => {
            format!("user:{service_id:02x}:{}", format_values(args))
        }
        SystemVmEvent::UserScriptLoad => "userload".to_owned(),
        SystemVmEvent::UserScriptFree { args } => format!("userfree:{}", format_values(args)),
        SystemVmEvent::UserScriptReturn => "userret".to_owned(),
        SystemVmEvent::Halted => "halt".to_owned(),
    }
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

fn read_host_raw_u32_vm(vm: &sakura_core::SystemVm<'_>, address: u32) -> u64 {
    vm.host_integer_raw(address, 2).unwrap_or(0)
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
        .join("|")
}

fn read_host_local_u32(runtime: &SystemRuntime<'_>, offset: u32) -> u64 {
    runtime
        .current_frame_local_integer(usize::try_from(offset).ok().unwrap_or(usize::MAX), 2)
        .unwrap_or(0)
}

fn read_host_raw_u32(runtime: &SystemRuntime<'_>, address: u32) -> u64 {
    runtime.current_frame_integer_raw(address, 2).unwrap_or(0)
}

fn summarize_sound_trace(events: &[sakura_core::SystemServiceTraceEvent]) -> SoundTraceShape {
    let mut shape = SoundTraceShape::default();
    let mut previous = None;
    let mut previous_sound = None;
    let mut recent_non_sound = None;
    let mut last_file_query_index = None;
    for event in events {
        if is_file_query(event) {
            last_file_query_index = Some(event.event_index);
        }
        if event.family == sakura_core::SystemCallFamily::Sound {
            shape.total_sound_count += 1;
            let id_shape = shape.by_id.entry(event.service_id).or_default();
            id_shape.record(event);
            if let Some(previous) = previous {
                *shape.prev_services.entry(previous).or_default() += 1;
            }
            if let Some(previous_sound) = previous_sound {
                *shape
                    .prev_sound_pairs
                    .entry((previous_sound, event.service_id))
                    .or_default() += 1;
            }
            if let Some(non_sound) = recent_non_sound {
                *shape
                    .recent_non_sound_by_id
                    .entry((event.service_id, non_sound))
                    .or_default() += 1;
            }
            let distance_bucket = last_file_query_index
                .map(|index| event.event_index.saturating_sub(index))
                .map(file_query_distance_bucket)
                .unwrap_or(0);
            shape.file_query_distance_buckets[distance_bucket] += 1;
            if event.string_arg_count > 0 {
                shape.sound_with_string_count += 1;
                if shape.first_sound_string_len == 0 {
                    shape.first_sound_string_len = event.first_string_len;
                    shape.first_sound_string_hash = event.first_string_hash;
                }
            }
            previous_sound = Some(event.service_id);
        } else {
            recent_non_sound = Some((family_key(event.family), event.service_id));
        }
        previous = Some((family_key(event.family), event.service_id));
    }
    shape
}

fn is_file_query(event: &sakura_core::SystemServiceTraceEvent) -> bool {
    event.family == sakura_core::SystemCallFamily::System
        && matches!(event.service_id, 0x30 | 0x31 | 0x34 | 0x35)
}

#[derive(Debug, Default)]
struct SoundTraceShape {
    total_sound_count: usize,
    by_id: BTreeMap<u8, SoundIdShape>,
    prev_services: BTreeMap<(u8, u8), usize>,
    prev_sound_pairs: BTreeMap<(u8, u8), usize>,
    recent_non_sound_by_id: BTreeMap<(u8, (u8, u8)), usize>,
    file_query_distance_buckets: [usize; 8],
    sound_with_string_count: usize,
    first_sound_string_len: usize,
    first_sound_string_hash: u64,
}

#[derive(Debug, Default)]
struct SoundIdShape {
    count: usize,
    arg_buckets: [usize; 8],
    top_kinds: [usize; 8],
    integer_arg_buckets: [usize; 8],
    min_integer_arg: u64,
    max_integer_arg: u64,
    string_arg_count: usize,
    first_string_len: usize,
    first_string_hash: u64,
}

impl SoundIdShape {
    fn record(&mut self, event: &sakura_core::SystemServiceTraceEvent) {
        if self.count == 0 {
            self.min_integer_arg = event.min_integer_arg;
        }
        self.count += 1;
        self.arg_buckets[event.arg_count.min(7)] += 1;
        self.top_kinds[usize::from(event.top_kind.min(7))] += 1;
        self.integer_arg_buckets[event.integer_arg_count.min(7)] += 1;
        self.min_integer_arg = self.min_integer_arg.min(event.min_integer_arg);
        self.max_integer_arg = self.max_integer_arg.max(event.max_integer_arg);
        if event.string_arg_count > 0 {
            self.string_arg_count += event.string_arg_count;
            if self.first_string_len == 0 {
                self.first_string_len = event.first_string_len;
                self.first_string_hash = event.first_string_hash;
            }
        }
    }
}

fn file_query_distance_bucket(distance: usize) -> usize {
    match distance {
        0 => 0,
        1 => 1,
        2..=4 => 2,
        5..=16 => 3,
        17..=64 => 4,
        65..=256 => 5,
        257..=1024 => 6,
        _ => 7,
    }
}

fn format_sound_id_shapes(shapes: &BTreeMap<u8, SoundIdShape>, limit: usize) -> String {
    let mut ranked = shapes.iter().collect::<Vec<_>>();
    ranked.sort_by(|(left_id, left), (right_id, right)| {
        right
            .count
            .cmp(&left.count)
            .then_with(|| left_id.cmp(right_id))
    });
    ranked
        .into_iter()
        .take(limit)
        .map(|(id, shape)| {
            format!(
                "{id:02x}:count{}:args[{}]:top[{}]:ints[{}]:range{}-{}:str{}:{}:{}",
                shape.count,
                format_buckets(&shape.arg_buckets),
                format_buckets(&shape.top_kinds),
                format_buckets(&shape.integer_arg_buckets),
                shape.min_integer_arg.min(u32::MAX.into()),
                shape.max_integer_arg.min(u32::MAX.into()),
                shape.string_arg_count,
                shape.first_string_len,
                shape.first_string_hash as u32
            )
        })
        .collect::<Vec<_>>()
        .join(",")
}

fn format_prev_services(counts: &BTreeMap<(u8, u8), usize>, limit: usize) -> String {
    let mut ranked = counts.iter().collect::<Vec<_>>();
    ranked.sort_by(
        |((left_family, left_id), left_count), ((right_family, right_id), right_count)| {
            right_count
                .cmp(left_count)
                .then_with(|| left_family.cmp(right_family))
                .then_with(|| left_id.cmp(right_id))
        },
    );
    ranked
        .into_iter()
        .take(limit)
        .map(|((family, service_id), count)| {
            format!("{}:{service_id:02x}:{count}", family_key_label(*family))
        })
        .collect::<Vec<_>>()
        .join(",")
}

fn format_sound_pairs(counts: &BTreeMap<(u8, u8), usize>, limit: usize) -> String {
    let mut ranked = counts.iter().collect::<Vec<_>>();
    ranked.sort_by(
        |((left_a, left_b), left_count), ((right_a, right_b), right_count)| {
            right_count
                .cmp(left_count)
                .then_with(|| left_a.cmp(right_a))
                .then_with(|| left_b.cmp(right_b))
        },
    );
    ranked
        .into_iter()
        .take(limit)
        .map(|((left, right), count)| format!("{left:02x}>{right:02x}:{count}"))
        .collect::<Vec<_>>()
        .join(",")
}

fn format_sound_contexts(counts: &BTreeMap<(u8, (u8, u8)), usize>, limit: usize) -> String {
    let mut ranked = counts.iter().collect::<Vec<_>>();
    ranked.sort_by(
        |((left_sound, (left_family, left_id)), left_count),
         ((right_sound, (right_family, right_id)), right_count)| {
            right_count
                .cmp(left_count)
                .then_with(|| left_sound.cmp(right_sound))
                .then_with(|| left_family.cmp(right_family))
                .then_with(|| left_id.cmp(right_id))
        },
    );
    ranked
        .into_iter()
        .take(limit)
        .map(|((sound_id, (family, service_id)), count)| {
            format!(
                "{sound_id:02x}<{}:{service_id:02x}:{count}",
                family_key_label(*family)
            )
        })
        .collect::<Vec<_>>()
        .join(",")
}

fn family_key(family: sakura_core::SystemCallFamily) -> u8 {
    match family {
        sakura_core::SystemCallFamily::System => 0,
        sakura_core::SystemCallFamily::Graph => 1,
        sakura_core::SystemCallFamily::Sound => 2,
        sakura_core::SystemCallFamily::External => 3,
    }
}

fn family_key_label(family: u8) -> &'static str {
    match family {
        0 => "sys",
        1 => "graph",
        2 => "sound",
        3 => "ext",
        _ => "unknown",
    }
}

fn format_buckets(buckets: &[usize; 8]) -> String {
    buckets
        .iter()
        .enumerate()
        .filter(|(_, count)| **count > 0)
        .map(|(bucket, count)| format!("{bucket}:{count}"))
        .collect::<Vec<_>>()
        .join("|")
}

fn format_sound_prefix(events: &[sakura_core::SystemServiceTraceEvent]) -> String {
    events
        .iter()
        .take_while(|event| event.family == sakura_core::SystemCallFamily::Sound)
        .take(8)
        .map(|event| {
            format!(
                "{:02x}@0x{:x}:argc{}:ints{}:{}-{}",
                event.service_id,
                event.instruction_offset,
                event.arg_count.min(7),
                event.integer_arg_count.min(7),
                event.min_integer_arg.min(u32::MAX.into()),
                event.max_integer_arg.min(u32::MAX.into())
            )
        })
        .collect::<Vec<_>>()
        .join(",")
}

fn format_service_events(events: &[sakura_core::SystemServiceTraceEvent]) -> String {
    events
        .iter()
        .take(16)
        .map(|event| {
            format!(
                "{}:{:02x}@s{}:0x{:x}:argc{}:top{}:ints{}:{}-{}:args{}",
                family_label(event.family),
                event.service_id,
                event.script_index,
                event.instruction_offset,
                event.arg_count.min(7),
                event.top_kind,
                event.integer_arg_count.min(7),
                event.min_integer_arg.min(u32::MAX.into()),
                event.max_integer_arg.min(u32::MAX.into()),
                format_arg_slots(event)
            )
        })
        .collect::<Vec<_>>()
        .join(",")
}

fn format_arg_slots(event: &sakura_core::SystemServiceTraceEvent) -> String {
    event
        .arg_slots
        .iter()
        .take(event.arg_count.min(event.arg_slots.len()).min(8))
        .map(|arg| match arg.kind {
            0 => "0".to_owned(),
            1 | 3 | 4 | 5 | 6 => format!("{}:{:x}", arg.kind, arg.value),
            2 => format!("2:{}:{:x}", arg.len, arg.hash),
            7 => "7".to_owned(),
            kind => format!("{kind}"),
        })
        .collect::<Vec<_>>()
        .join("|")
}

fn family_label(family: sakura_core::SystemCallFamily) -> &'static str {
    match family {
        sakura_core::SystemCallFamily::System => "sys",
        sakura_core::SystemCallFamily::Graph => "graph",
        sakura_core::SystemCallFamily::Sound => "sound",
        sakura_core::SystemCallFamily::External => "ext",
    }
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

fn entry_script_index(runtime: &Runtime) -> TestResult<usize> {
    runtime
        .scripts()
        .find_by_name_bytes(ENTRY_SCRIPT_NAME)
        .map(|id| id.index())
        .ok_or_else(|| "local entry script is missing".into())
}

fn collect_archive_files(root: &Path) -> TestResult<Vec<PathBuf>> {
    let mut by_basename = BTreeMap::<Vec<u8>, PathBuf>::new();
    collect_arc_files(root, &mut by_basename)?;
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

fn collect_arc_files(path: &Path, files: &mut BTreeMap<Vec<u8>, PathBuf>) -> TestResult<()> {
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            collect_arc_files(&path, files)?;
        } else if file_type.is_file() && has_extension(&path, "arc") {
            if let Some(name) = path.file_name().and_then(OsStr::to_str) {
                files.insert(name.as_bytes().to_ascii_lowercase(), path);
            }
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
