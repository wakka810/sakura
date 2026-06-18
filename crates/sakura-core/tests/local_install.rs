use sakura_core::{
    analyze_system_script, classify_dsc_script, decompress_dsc, is_buriko_script_v1, sniff_payload,
    summarize_scenario_events, system_trace_unknown_source_label, system_trace_value_kind_label,
    trace_system_script, ArcArchive, LoadedScriptKind, PayloadKind,
};
use std::collections::BTreeMap;
use std::env;
use std::error::Error;
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};

type TestResult<T> = std::result::Result<T, Box<dyn Error>>;

#[test]
#[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
fn summarizes_local_script_events_without_text_output() -> TestResult<()> {
    let game_dir = env::var_os("SAKURA_INSTALL_DIR")
        .map(PathBuf::from)
        .ok_or("SAKURA_INSTALL_DIR is required for this ignored local-install probe")?;
    let mut dsc_count = 0usize;
    let mut v1_count = 0usize;
    let mut message_count = 0usize;
    let mut choice_count = 0usize;
    let mut user_function_count = 0usize;
    let mut system_count = 0usize;
    let mut system_instruction_count = 0usize;
    let mut system_graphcall_count = 0usize;
    let mut system_soundcall_count = 0usize;
    let mut system_extcall_count = 0usize;
    let mut system_user_script_call_count = 0usize;
    let mut system_user_script_dispatch_count = 0usize;
    let mut system_trace_error_count = 0usize;
    let mut graphcall_service_counts = [0usize; 256];
    let mut soundcall_service_counts = [0usize; 256];
    let mut extcall_service_counts = [0usize; 256];
    let mut user_script_dispatch_counts = [0usize; 256];
    let mut trace_dispatch_empty_counts = [0usize; 256];
    let mut trace_dispatch_integer_counts = [0usize; 256];
    let mut trace_dispatch_string_counts = [0usize; 256];
    let mut trace_dispatch_code_counts = [0usize; 256];
    let mut trace_dispatch_handle_counts = [0usize; 256];
    let mut trace_dispatch_user_result_counts = [0usize; 256];
    let mut trace_dispatch_pointer_counts = [0usize; 256];
    let mut trace_dispatch_unknown_counts = [0usize; 256];
    let mut trace_dispatch_arg_buckets = [0usize; 8];
    let mut trace_dispatch_ff_unknown_sources = BTreeMap::<u16, usize>::new();
    let mut trace_dispatch_00_unknown_sources = BTreeMap::<u16, usize>::new();
    let mut trace_service_top_kinds = BTreeMap::<(u16, u8), usize>::new();
    let mut trace_service_arg_buckets = BTreeMap::<(u16, u8), usize>::new();

    for path in collect_files(&game_dir)?
        .iter()
        .filter(|path| has_extension(path, "arc"))
    {
        let data = fs::read(path)?;
        let archive = ArcArchive::parse(&data)?;
        for entry in archive.entries() {
            let payload = archive.entry_data(entry)?;
            if sniff_payload(payload) != PayloadKind::Dsc {
                continue;
            }
            dsc_count += 1;
            let decompressed = decompress_dsc(payload)?;
            if classify_dsc_script(entry.name.as_bytes(), &decompressed)
                == Some(LoadedScriptKind::System)
            {
                let summary = analyze_system_script(&decompressed)?;
                system_count += 1;
                system_instruction_count += summary.instruction_count;
                system_graphcall_count += summary.graphcall_count;
                system_soundcall_count += summary.soundcall_count;
                system_extcall_count += summary.extcall_count;
                system_user_script_call_count += summary.user_script_call_count;
                system_user_script_dispatch_count += summary.user_script_dispatch_count;
                add_counts(
                    &mut graphcall_service_counts,
                    &summary.graphcall_service_counts,
                );
                add_counts(
                    &mut soundcall_service_counts,
                    &summary.soundcall_service_counts,
                );
                add_counts(&mut extcall_service_counts, &summary.extcall_service_counts);
                add_counts(
                    &mut user_script_dispatch_counts,
                    &summary.user_script_dispatch_counts,
                );
                let Ok(trace) = trace_system_script(&decompressed) else {
                    system_trace_error_count += 1;
                    continue;
                };
                add_counts(
                    &mut trace_dispatch_empty_counts,
                    &trace.dispatch_empty_stack_counts,
                );
                add_counts(
                    &mut trace_dispatch_integer_counts,
                    &trace.dispatch_top_integer_counts,
                );
                add_counts(
                    &mut trace_dispatch_string_counts,
                    &trace.dispatch_top_string_counts,
                );
                add_counts(
                    &mut trace_dispatch_code_counts,
                    &trace.dispatch_top_code_counts,
                );
                add_counts(
                    &mut trace_dispatch_handle_counts,
                    &trace.dispatch_top_handle_counts,
                );
                add_counts(
                    &mut trace_dispatch_user_result_counts,
                    &trace.dispatch_top_user_result_counts,
                );
                add_counts(
                    &mut trace_dispatch_pointer_counts,
                    &trace.dispatch_top_pointer_counts,
                );
                add_counts(
                    &mut trace_dispatch_unknown_counts,
                    &trace.dispatch_top_unknown_counts,
                );
                add_bucket_counts(
                    &mut trace_dispatch_arg_buckets,
                    &trace.dispatch_arg_count_buckets,
                );
                for source in trace.dispatch_unknown_sources {
                    match source.dispatch_id {
                        0xff => {
                            *trace_dispatch_ff_unknown_sources
                                .entry(source.source_code)
                                .or_default() += source.count;
                        }
                        0x00 => {
                            *trace_dispatch_00_unknown_sources
                                .entry(source.source_code)
                                .or_default() += source.count;
                        }
                        _ => {}
                    }
                }
                add_source_value_counts(
                    &mut trace_service_top_kinds,
                    trace.service_input_top_kinds,
                );
                add_source_value_counts(
                    &mut trace_service_arg_buckets,
                    trace.service_input_arg_buckets,
                );
                continue;
            }
            if is_buriko_script_v1(&decompressed) {
                if entry.name.as_bytes().eq_ignore_ascii_case(b"Yuzu_2G") {
                    continue;
                }
                let summary = summarize_scenario_events(&decompressed)?;
                v1_count += 1;
                message_count += summary.message_count;
                choice_count += summary.choice_count;
                user_function_count += summary.user_function_count;
            }
        }
    }

    println!("local_scenario_event_probe_version=1");
    println!("dsc_payload_count={dsc_count}");
    println!("v1_script_count={v1_count}");
    println!("scenario_event_message_count={message_count}");
    println!("scenario_event_choice_count={choice_count}");
    println!("scenario_event_user_function_count={user_function_count}");
    println!("system_script_count={system_count}");
    println!("system_instruction_count={system_instruction_count}");
    println!("system_graphcall_count={system_graphcall_count}");
    println!("system_soundcall_count={system_soundcall_count}");
    println!("system_extcall_count={system_extcall_count}");
    println!("system_user_script_call_count={system_user_script_call_count}");
    println!("system_user_script_dispatch_count={system_user_script_dispatch_count}");
    println!("system_trace_error_count={system_trace_error_count}");
    println!(
        "system_graphcall_top={}",
        format_top_counts(&graphcall_service_counts, 8)
    );
    println!(
        "system_soundcall_top={}",
        format_top_counts(&soundcall_service_counts, 8)
    );
    println!(
        "system_extcall_top={}",
        format_top_counts(&extcall_service_counts, 8)
    );
    println!(
        "system_user_script_dispatch_top={}",
        format_top_counts(&user_script_dispatch_counts, 12)
    );
    println!(
        "system_trace_dispatch_arg_buckets={}",
        format_buckets(&trace_dispatch_arg_buckets)
    );
    println!(
        "system_trace_dispatch_ff_top_kind={}",
        format_dispatch_kinds(
            0xff,
            DispatchKindCounts {
                empty: &trace_dispatch_empty_counts,
                integer: &trace_dispatch_integer_counts,
                string: &trace_dispatch_string_counts,
                code: &trace_dispatch_code_counts,
                handle: &trace_dispatch_handle_counts,
                user_result: &trace_dispatch_user_result_counts,
                pointer: &trace_dispatch_pointer_counts,
                unknown: &trace_dispatch_unknown_counts,
            }
        )
    );
    println!(
        "system_trace_dispatch_00_top_kind={}",
        format_dispatch_kinds(
            0x00,
            DispatchKindCounts {
                empty: &trace_dispatch_empty_counts,
                integer: &trace_dispatch_integer_counts,
                string: &trace_dispatch_string_counts,
                code: &trace_dispatch_code_counts,
                handle: &trace_dispatch_handle_counts,
                user_result: &trace_dispatch_user_result_counts,
                pointer: &trace_dispatch_pointer_counts,
                unknown: &trace_dispatch_unknown_counts,
            }
        )
    );
    println!(
        "system_trace_dispatch_ff_unknown_source_top={}",
        format_top_source_counts(&trace_dispatch_ff_unknown_sources, 10)
    );
    println!(
        "system_trace_dispatch_00_unknown_source_top={}",
        format_top_source_counts(&trace_dispatch_00_unknown_sources, 10)
    );
    println!(
        "system_trace_service_ext_ff_top_kind={}",
        format_service_value_counts("ext:ff", &trace_service_top_kinds)
    );
    println!(
        "system_trace_service_ext_ff_arg_buckets={}",
        format_service_bucket_counts("ext:ff", &trace_service_arg_buckets)
    );
    println!(
        "system_trace_service_sound_00_top_kind={}",
        format_service_value_counts("sound:00", &trace_service_top_kinds)
    );
    println!(
        "system_trace_service_sound_00_arg_buckets={}",
        format_service_bucket_counts("sound:00", &trace_service_arg_buckets)
    );
    println!(
        "system_trace_service_graph_68_top_kind={}",
        format_service_value_counts("graph:68", &trace_service_top_kinds)
    );
    println!(
        "system_trace_service_graph_68_arg_buckets={}",
        format_service_bucket_counts("graph:68", &trace_service_arg_buckets)
    );

    assert!(dsc_count > 0);
    assert!(v1_count > 0);
    assert!(message_count > 0);
    assert!(system_count > 0);
    assert!(system_instruction_count > 0);
    assert!(system_graphcall_count > 0);
    assert!(system_soundcall_count > 0);
    Ok(())
}

fn collect_files(root: &Path) -> TestResult<Vec<PathBuf>> {
    let mut files = Vec::new();
    collect_files_inner(root, &mut files)?;
    files.sort();
    Ok(files)
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

fn add_counts(target: &mut [usize; 256], source: &[usize; 256]) {
    for (target, source) in target.iter_mut().zip(source.iter()) {
        *target += *source;
    }
}

fn add_bucket_counts(target: &mut [usize; 8], source: &[usize; 8]) {
    for (target, source) in target.iter_mut().zip(source.iter()) {
        *target += *source;
    }
}

fn add_source_value_counts(
    target: &mut BTreeMap<(u16, u8), usize>,
    source: Vec<sakura_core::SystemTraceSourceValueCount>,
) {
    for count in source {
        *target
            .entry((count.source_code, count.value_code))
            .or_default() += count.count;
    }
}

fn format_buckets(counts: &[usize; 8]) -> String {
    counts
        .iter()
        .enumerate()
        .map(|(bucket, count)| format!("{bucket}:{count}"))
        .collect::<Vec<_>>()
        .join(",")
}

fn format_service_value_counts(label: &str, counts: &BTreeMap<(u16, u8), usize>) -> String {
    let Some(source) = source_code_for_label(label, counts) else {
        return String::new();
    };
    let mut ranked: Vec<(u8, usize)> = counts
        .iter()
        .filter_map(|(&(source_code, value_code), &count)| {
            (source_code == source).then_some((value_code, count))
        })
        .collect();
    ranked.sort_by(|(left_kind, left_count), (right_kind, right_count)| {
        right_count
            .cmp(left_count)
            .then_with(|| left_kind.cmp(right_kind))
    });
    ranked
        .into_iter()
        .map(|(kind, count)| format!("{}:{count}", system_trace_value_kind_label(kind)))
        .collect::<Vec<_>>()
        .join(",")
}

fn format_service_bucket_counts(label: &str, counts: &BTreeMap<(u16, u8), usize>) -> String {
    let Some(source) = source_code_for_label(label, counts) else {
        return String::new();
    };
    let mut ranked: Vec<(u8, usize)> = counts
        .iter()
        .filter_map(|(&(source_code, bucket), &count)| {
            (source_code == source).then_some((bucket, count))
        })
        .collect();
    ranked.sort_by_key(|(bucket, _)| *bucket);
    ranked
        .into_iter()
        .map(|(bucket, count)| format!("{bucket}:{count}"))
        .collect::<Vec<_>>()
        .join(",")
}

fn source_code_for_label(label: &str, counts: &BTreeMap<(u16, u8), usize>) -> Option<u16> {
    counts
        .keys()
        .map(|(source, _)| *source)
        .find(|source| system_trace_unknown_source_label(*source) == label)
}

struct DispatchKindCounts<'a> {
    empty: &'a [usize; 256],
    integer: &'a [usize; 256],
    string: &'a [usize; 256],
    code: &'a [usize; 256],
    handle: &'a [usize; 256],
    user_result: &'a [usize; 256],
    pointer: &'a [usize; 256],
    unknown: &'a [usize; 256],
}

fn format_dispatch_kinds(id: usize, counts: DispatchKindCounts<'_>) -> String {
    format!(
        "empty:{},integer:{},string:{},code:{},handle:{},user_result:{},pointer:{},unknown:{}",
        counts.empty[id],
        counts.integer[id],
        counts.string[id],
        counts.code[id],
        counts.handle[id],
        counts.user_result[id],
        counts.pointer[id],
        counts.unknown[id]
    )
}

fn format_top_source_counts(counts: &BTreeMap<u16, usize>, limit: usize) -> String {
    let mut ranked: Vec<(u16, usize)> = counts.iter().map(|(key, value)| (*key, *value)).collect();
    ranked.sort_by(|(left_source, left_count), (right_source, right_count)| {
        right_count
            .cmp(left_count)
            .then_with(|| left_source.cmp(right_source))
    });
    ranked
        .into_iter()
        .take(limit)
        .map(|(source, count)| format!("{}:{count}", system_trace_unknown_source_label(source)))
        .collect::<Vec<_>>()
        .join(",")
}

fn format_top_counts(counts: &[usize; 256], limit: usize) -> String {
    let mut ranked: Vec<(usize, usize)> = counts
        .iter()
        .copied()
        .enumerate()
        .filter(|(_, count)| *count > 0)
        .collect();
    ranked.sort_by(|(left_id, left_count), (right_id, right_count)| {
        right_count
            .cmp(left_count)
            .then_with(|| left_id.cmp(right_id))
    });
    ranked
        .into_iter()
        .take(limit)
        .map(|(id, count)| format!("{id:02x}:{count}"))
        .collect::<Vec<_>>()
        .join(",")
}
