use sakura_core::{
    analyze_scenario_script, analyze_system_script, cbg_to_rgba, classify_dsc_script, decode_cbg,
    decode_raw_bitmap, decompress_dsc, decrypt_cbg_stream, is_buriko_script_v1,
    read_bgi_audio_metadata, read_cbg_metadata, sniff_payload, ArcArchive, AssetCatalog,
    InstallManifest, LoadedScriptKind, PayloadKind, Runtime, RuntimeConfig, SakuraError,
    ScenarioArrayArg, ScenarioEvent, ScenarioProgram, ScenarioVm, SystemHost,
    SystemInstructionKind, SystemProgram,
};
use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::ffi::OsStr;
use std::fs;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

#[derive(Debug, Clone, Copy)]
struct SystemScriptRankRow {
    script_index: usize,
    code_bytes: usize,
    hash: u64,
    score: usize,
    sys40: usize,
    graph88: usize,
    graph9c: usize,
    sound: usize,
    min_sys40: usize,
    min_graph88: usize,
    min_graph9c: usize,
    min_sound: usize,
    block_sys40: usize,
    block_graph88: usize,
    block_graph9c: usize,
    block_sound: usize,
    user_load: usize,
    user_ret: usize,
    user_dispatch: usize,
}

fn main() -> Result<()> {
    let mut args = env::args_os();
    let _program = args.next();
    let command = args
        .next()
        .and_then(|arg| arg.into_string().ok())
        .unwrap_or_else(|| "help".to_owned());

    match command.as_str() {
        "probe" => {
            let game_dir = args.next().map(PathBuf::from).ok_or_else(|| {
                SakuraError::UnsupportedFormat("usage: sakura-cli probe <game-dir>".to_owned())
            })?;
            probe_install(&game_dir)?;
        }
        "arc-check" => {
            let archive_path = args.next().map(PathBuf::from).ok_or_else(|| {
                SakuraError::UnsupportedFormat(
                    "usage: sakura-cli arc-check <archive.arc>".to_owned(),
                )
            })?;
            check_archive(&archive_path)?;
        }
        "payload-signatures" => {
            let game_dir = args.next().map(PathBuf::from).ok_or_else(|| {
                SakuraError::UnsupportedFormat(
                    "usage: sakura-cli payload-signatures <game-dir> [limit]".to_owned(),
                )
            })?;
            let limit = args
                .next()
                .and_then(|arg| arg.into_string().ok())
                .and_then(|arg| arg.parse::<usize>().ok())
                .unwrap_or(32);
            payload_signatures(&game_dir, limit)?;
        }
        "dsc-signatures" => {
            let game_dir = args.next().map(PathBuf::from).ok_or_else(|| {
                SakuraError::UnsupportedFormat(
                    "usage: sakura-cli dsc-signatures <game-dir> [limit]".to_owned(),
                )
            })?;
            let limit = args
                .next()
                .and_then(|arg| arg.into_string().ok())
                .and_then(|arg| arg.parse::<usize>().ok())
                .unwrap_or(32);
            dsc_signatures(&game_dir, limit)?;
        }
        "payload-validate" => {
            let game_dir = args.next().map(PathBuf::from).ok_or_else(|| {
                SakuraError::UnsupportedFormat(
                    "usage: sakura-cli payload-validate <game-dir>".to_owned(),
                )
            })?;
            validate_payloads(&game_dir)?;
        }
        "catalog-validate" => {
            let game_dir = args.next().map(PathBuf::from).ok_or_else(|| {
                SakuraError::UnsupportedFormat(
                    "usage: sakura-cli catalog-validate <game-dir>".to_owned(),
                )
            })?;
            validate_catalog(&game_dir)?;
        }
        "image-info" => {
            let game_dir = args.next().map(PathBuf::from).ok_or_else(|| {
                SakuraError::UnsupportedFormat(
                    "usage: sakura-cli image-info <game-dir> <asset-name> [...]".to_owned(),
                )
            })?;
            let names = args
                .map(|arg| {
                    arg.into_string().map_err(|_| {
                        SakuraError::UnsupportedFormat("asset names must be valid UTF-8".to_owned())
                    })
                })
                .collect::<std::result::Result<Vec<_>, _>>()?;
            if names.is_empty() {
                return Err(SakuraError::UnsupportedFormat(
                    "image-info requires at least one asset name".to_owned(),
                )
                .into());
            }
            image_info(&game_dir, &names)?;
        }
        "image-extract" => {
            let game_dir = args.next().map(PathBuf::from).ok_or_else(|| {
                SakuraError::UnsupportedFormat(
                    "usage: sakura-cli image-extract <game-dir> <asset-name> <output.pam>"
                        .to_owned(),
                )
            })?;
            let name = args
                .next()
                .and_then(|arg| arg.into_string().ok())
                .ok_or_else(|| SakuraError::UnsupportedFormat("missing asset name".to_owned()))?;
            let output = args
                .next()
                .map(PathBuf::from)
                .ok_or_else(|| SakuraError::UnsupportedFormat("missing output path".to_owned()))?;
            image_extract(&game_dir, &name, &output)?;
        }
        "script-validate" => {
            let game_dir = args.next().map(PathBuf::from).ok_or_else(|| {
                SakuraError::UnsupportedFormat(
                    "usage: sakura-cli script-validate <game-dir>".to_owned(),
                )
            })?;
            validate_scripts(&game_dir)?;
        }
        "scenario-opcode-audit" => {
            let game_dir = args.next().map(PathBuf::from).ok_or_else(|| {
                SakuraError::UnsupportedFormat(
                    "usage: sakura-cli scenario-opcode-audit <game-dir> [name-prefix]".to_owned(),
                )
            })?;
            let prefix = args.next().and_then(|arg| arg.into_string().ok());
            audit_scenario_opcodes(&game_dir, prefix.as_deref())?;
        }
        "scenario-command-audit" => {
            let game_dir = args.next().map(PathBuf::from).ok_or_else(|| {
                SakuraError::UnsupportedFormat(
                    "usage: sakura-cli scenario-command-audit <game-dir> <scenario-name> <opcode>"
                        .to_owned(),
                )
            })?;
            let scenario_name = args
                .next()
                .and_then(|arg| arg.into_string().ok())
                .ok_or_else(|| {
                    SakuraError::UnsupportedFormat("missing scenario name".to_owned())
                })?;
            let opcode = args
                .next()
                .and_then(|arg| arg.into_string().ok())
                .and_then(|arg| parse_u32_arg(&arg))
                .ok_or_else(|| SakuraError::UnsupportedFormat("invalid opcode".to_owned()))?;
            audit_scenario_command(&game_dir, &scenario_name, opcode)?;
        }
        "scenario-control-audit" => {
            let game_dir = args.next().map(PathBuf::from).ok_or_else(|| {
                SakuraError::UnsupportedFormat(
                    "usage: sakura-cli scenario-control-audit <game-dir> <scenario-name>"
                        .to_owned(),
                )
            })?;
            let scenario_name = args
                .next()
                .and_then(|arg| arg.into_string().ok())
                .ok_or_else(|| {
                    SakuraError::UnsupportedFormat("missing scenario name".to_owned())
                })?;
            audit_scenario_controls(&game_dir, &scenario_name)?;
        }
        "scenario-byte-window" => {
            let game_dir = args.next().map(PathBuf::from).ok_or_else(|| {
                SakuraError::UnsupportedFormat(
                    "usage: sakura-cli scenario-byte-window <game-dir> <scenario-name> <offset> [word-count]"
                        .to_owned(),
                )
            })?;
            let scenario_name = args
                .next()
                .and_then(|arg| arg.into_string().ok())
                .ok_or_else(|| {
                    SakuraError::UnsupportedFormat("missing scenario name".to_owned())
                })?;
            let offset = args
                .next()
                .and_then(|arg| arg.into_string().ok())
                .and_then(|arg| parse_u32_arg(&arg))
                .ok_or_else(|| SakuraError::UnsupportedFormat("invalid offset".to_owned()))?
                as usize;
            let word_count = args
                .next()
                .and_then(|arg| arg.into_string().ok())
                .and_then(|arg| arg.parse::<usize>().ok())
                .unwrap_or(24)
                .clamp(1, 256);
            scenario_byte_window(&game_dir, &scenario_name, offset, word_count)?;
        }
        "scenario-event-window" => {
            let game_dir = args.next().map(PathBuf::from).ok_or_else(|| {
                SakuraError::UnsupportedFormat(
                    "usage: sakura-cli scenario-event-window <game-dir> <scenario-name> <start-event> [count]"
                        .to_owned(),
                )
            })?;
            let scenario_name = args
                .next()
                .and_then(|arg| arg.into_string().ok())
                .ok_or_else(|| {
                    SakuraError::UnsupportedFormat("missing scenario name".to_owned())
                })?;
            let start_event = args
                .next()
                .and_then(|arg| arg.into_string().ok())
                .and_then(|arg| arg.parse::<usize>().ok())
                .ok_or_else(|| SakuraError::UnsupportedFormat("invalid start event".to_owned()))?;
            let count = args
                .next()
                .and_then(|arg| arg.into_string().ok())
                .and_then(|arg| arg.parse::<usize>().ok())
                .unwrap_or(32)
                .clamp(1, 256);
            scenario_event_window(&game_dir, &scenario_name, start_event, count)?;
        }
        "scenario-label-audit" => {
            let game_dir = args.next().map(PathBuf::from).ok_or_else(|| {
                SakuraError::UnsupportedFormat(
                    "usage: sakura-cli scenario-label-audit <game-dir> <scenario-name> [name-filter]"
                        .to_owned(),
                )
            })?;
            let scenario_name = args
                .next()
                .and_then(|arg| arg.into_string().ok())
                .ok_or_else(|| {
                    SakuraError::UnsupportedFormat("missing scenario name".to_owned())
                })?;
            let name_filter = args.next().and_then(|arg| arg.into_string().ok());
            audit_scenario_labels(&game_dir, &scenario_name, name_filter.as_deref())?;
        }
        "system-script-rank" => {
            let game_dir = args.next().map(PathBuf::from).ok_or_else(|| {
                SakuraError::UnsupportedFormat(
                    "usage: sakura-cli system-script-rank <game-dir> [limit]".to_owned(),
                )
            })?;
            let limit = args
                .next()
                .and_then(|arg| arg.into_string().ok())
                .and_then(|arg| arg.parse::<usize>().ok())
                .unwrap_or(24);
            rank_system_scripts(&game_dir, limit)?;
        }
        "system-window" => {
            let game_dir = args.next().map(PathBuf::from).ok_or_else(|| {
                SakuraError::UnsupportedFormat(
                    "usage: sakura-cli system-window <game-dir> <script-index> <offset-hex> [count]"
                        .to_owned(),
                )
            })?;
            let script_index = args
                .next()
                .and_then(|arg| arg.into_string().ok())
                .and_then(|arg| arg.parse::<usize>().ok())
                .ok_or_else(|| SakuraError::UnsupportedFormat("missing script index".to_owned()))?;
            let offset = args
                .next()
                .and_then(|arg| arg.into_string().ok())
                .and_then(|arg| parse_hex_or_decimal(&arg).ok())
                .ok_or_else(|| SakuraError::UnsupportedFormat("missing offset".to_owned()))?;
            let count = args
                .next()
                .and_then(|arg| arg.into_string().ok())
                .and_then(|arg| arg.parse::<usize>().ok())
                .unwrap_or(32);
            system_window(&game_dir, script_index, offset, count)?;
        }
        "system-value-scan" => {
            let game_dir = args.next().map(PathBuf::from).ok_or_else(|| {
                SakuraError::UnsupportedFormat(
                    "usage: sakura-cli system-value-scan <game-dir> <script-index> <value> [limit]"
                        .to_owned(),
                )
            })?;
            let script_index = args
                .next()
                .and_then(|arg| arg.into_string().ok())
                .and_then(|arg| arg.parse::<usize>().ok())
                .ok_or_else(|| SakuraError::UnsupportedFormat("missing script index".to_owned()))?;
            let value = args
                .next()
                .and_then(|arg| arg.into_string().ok())
                .and_then(|arg| parse_hex_or_decimal(&arg).ok())
                .ok_or_else(|| SakuraError::UnsupportedFormat("missing value".to_owned()))?;
            let limit = args
                .next()
                .and_then(|arg| arg.into_string().ok())
                .and_then(|arg| arg.parse::<usize>().ok())
                .unwrap_or(64);
            system_value_scan(&game_dir, script_index, value, limit)?;
        }
        "system-string-ref-scan" => {
            let game_dir = args.next().map(PathBuf::from).ok_or_else(|| {
                SakuraError::UnsupportedFormat(
                    "usage: sakura-cli system-string-ref-scan <game-dir> <ascii-target> [limit]"
                        .to_owned(),
                )
            })?;
            let target = args
                .next()
                .and_then(|arg| arg.into_string().ok())
                .ok_or_else(|| SakuraError::UnsupportedFormat("missing ascii target".to_owned()))?;
            let limit = args
                .next()
                .and_then(|arg| arg.into_string().ok())
                .and_then(|arg| arg.parse::<usize>().ok())
                .unwrap_or(64);
            system_string_ref_scan(&game_dir, target.as_bytes(), limit)?;
        }
        "system-script-list" => {
            let game_dir = args.next().map(PathBuf::from).ok_or_else(|| {
                SakuraError::UnsupportedFormat(
                    "usage: sakura-cli system-script-list <game-dir> [limit] [start-system-index]"
                        .to_owned(),
                )
            })?;
            let limit = args
                .next()
                .and_then(|arg| arg.into_string().ok())
                .and_then(|arg| arg.parse::<usize>().ok())
                .unwrap_or(128);
            let start = args
                .next()
                .and_then(|arg| arg.into_string().ok())
                .and_then(|arg| arg.parse::<usize>().ok())
                .unwrap_or(0);
            list_system_scripts(&game_dir, limit, start)?;
        }
        "runtime-step-probe" => {
            let game_dir = args.next().map(PathBuf::from).ok_or_else(|| {
                SakuraError::UnsupportedFormat(
                    "usage: sakura-cli runtime-step-probe <game-dir> <script-name> [steps] [max-instructions]"
                        .to_owned(),
                )
            })?;
            let script_name = args
                .next()
                .and_then(|arg| arg.into_string().ok())
                .ok_or_else(|| SakuraError::UnsupportedFormat("missing script name".to_owned()))?;
            let steps = args
                .next()
                .and_then(|arg| arg.into_string().ok())
                .and_then(|arg| arg.parse::<usize>().ok())
                .unwrap_or(16);
            let max_instructions = args
                .next()
                .and_then(|arg| arg.into_string().ok())
                .and_then(|arg| arg.parse::<usize>().ok())
                .unwrap_or(100_000);
            runtime_step_probe(&game_dir, script_name.as_bytes(), steps, max_instructions)?;
        }
        "system-return-candidates" => {
            let game_dir = args.next().map(PathBuf::from).ok_or_else(|| {
                SakuraError::UnsupportedFormat(
                    "usage: sakura-cli system-return-candidates <game-dir> [limit]".to_owned(),
                )
            })?;
            let limit = args
                .next()
                .and_then(|arg| arg.into_string().ok())
                .and_then(|arg| arg.parse::<usize>().ok())
                .unwrap_or(32);
            system_return_candidates(&game_dir, limit)?;
        }
        "system-header-scan" => {
            let game_dir = args.next().map(PathBuf::from).ok_or_else(|| {
                SakuraError::UnsupportedFormat(
                    "usage: sakura-cli system-header-scan <game-dir> [limit]".to_owned(),
                )
            })?;
            let limit = args
                .next()
                .and_then(|arg| arg.into_string().ok())
                .and_then(|arg| arg.parse::<usize>().ok())
                .unwrap_or(64);
            system_header_scan(&game_dir, limit)?;
        }
        "cbg-stream-validate" => {
            let game_dir = args.next().map(PathBuf::from).ok_or_else(|| {
                SakuraError::UnsupportedFormat(
                    "usage: sakura-cli cbg-stream-validate <game-dir>".to_owned(),
                )
            })?;
            validate_cbg_streams(&game_dir)?;
        }
        "cbg-v1-decode-validate" => {
            let game_dir = args.next().map(PathBuf::from).ok_or_else(|| {
                SakuraError::UnsupportedFormat(
                    "usage: sakura-cli cbg-v1-decode-validate <game-dir>".to_owned(),
                )
            })?;
            validate_cbg_v1_decode(&game_dir)?;
        }
        "cbg-v2-decode-validate" => {
            let game_dir = args.next().map(PathBuf::from).ok_or_else(|| {
                SakuraError::UnsupportedFormat(
                    "usage: sakura-cli cbg-v2-decode-validate <game-dir> [limit] [progress-every]"
                        .to_owned(),
                )
            })?;
            let limit = args
                .next()
                .and_then(|arg| arg.into_string().ok())
                .and_then(|arg| arg.parse::<usize>().ok());
            let progress_every = args
                .next()
                .and_then(|arg| arg.into_string().ok())
                .and_then(|arg| arg.parse::<usize>().ok());
            validate_cbg_v2_decode(&game_dir, limit, progress_every)?;
        }
        "cbg-rgba-validate" => {
            let game_dir = args.next().map(PathBuf::from).ok_or_else(|| {
                SakuraError::UnsupportedFormat(
                    "usage: sakura-cli cbg-rgba-validate <game-dir> [limit] [progress-every]"
                        .to_owned(),
                )
            })?;
            let limit = args
                .next()
                .and_then(|arg| arg.into_string().ok())
                .and_then(|arg| arg.parse::<usize>().ok());
            let progress_every = args
                .next()
                .and_then(|arg| arg.into_string().ok())
                .and_then(|arg| arg.parse::<usize>().ok());
            validate_cbg_rgba(&game_dir, limit, progress_every)?;
        }
        "help" | "--help" | "-h" => print_help(),
        _ => {
            return Err(SakuraError::UnsupportedFormat(format!(
                "unknown command {command}; run sakura-cli --help"
            ))
            .into())
        }
    }
    Ok(())
}

fn print_help() {
    println!("sakura-cli");
    println!("  probe <game-dir>       validate local BGI install structure without asset names");
    println!("  arc-check <archive>    validate one BURIKO ARC20 archive without extracting it");
    println!("  payload-signatures <game-dir> [limit]");
    println!("                           count first-byte signatures without asset names");
    println!("  dsc-signatures <game-dir> [limit]");
    println!("                           count decompressed DSC signatures without text output");
    println!("  payload-validate <game-dir>");
    println!("                           validate known BGI payload headers without extraction");
    println!("  catalog-validate <game-dir>");
    println!(
        "                           validate canonical ARC catalog lookup without asset names"
    );
    println!("  image-info <game-dir> <asset-name> [...]");
    println!("                           report decoded image dimensions for named local assets");
    println!("  image-extract <game-dir> <asset-name> <output.pam>");
    println!("                           decode one named local image without overwriting files");
    println!("  script-validate <game-dir>");
    println!(
        "                           validate v1 Ethornell script structure without text output"
    );
    println!("  scenario-opcode-audit <game-dir> [name-prefix]");
    println!("                           list scenario command opcode counts without text output");
    println!("  scenario-command-audit <game-dir> <scenario-name> <opcode>");
    println!("                           list argument shapes for one scenario command");
    println!("  scenario-control-audit <game-dir> <scenario-name>");
    println!("                           list non-rendering scenario control commands");
    println!("  scenario-byte-window <game-dir> <scenario-name> <offset> [word-count]");
    println!("  scenario-event-window <game-dir> <scenario-name> <start-event> [count]");
    println!("                           show a bounded raw u32 window around a scenario offset");
    println!("  scenario-label-audit <game-dir> <scenario-name> [name-filter]");
    println!("                           list compiled scenario labels and code offsets");
    println!("  system-script-rank <game-dir> [limit]");
    println!(
        "                           rank system scripts by safe service counters without names"
    );
    println!("  system-window <game-dir> <script-index> <offset-hex> [count]");
    println!(
        "                           show safe opcode window ending at an offset without strings"
    );
    println!("  system-value-scan <game-dir> <script-index> <value> [limit]");
    println!(
        "                           list safe immediate/code-reference matches in one system script"
    );
    println!("  system-string-ref-scan <game-dir> <ascii-target> [limit]");
    println!(
        "                           list system scripts that reference an ASCII string operand"
    );
    println!("  system-script-list <game-dir> [limit] [start-system-index]");
    println!(
        "                           list system-script indexes with runtime indexes and safe names"
    );
    println!("  runtime-step-probe <game-dir> <script-name> [steps] [max-instructions]");
    println!(
        "                           step a named system runtime and report per-step frame state"
    );
    println!("  system-return-candidates <game-dir> [limit]");
    println!("                           find service calls whose result is immediately stored");
    println!("  system-header-scan <game-dir> [limit]");
    println!(
        "                           inspect executable system DSC header fields without names"
    );
    println!("  cbg-stream-validate <game-dir>");
    println!("                           decrypt and checksum CBG streams without writing images");
    println!("  cbg-v1-decode-validate <game-dir>");
    println!("                           decode v1 CBG images in memory without writing images");
    println!("  cbg-v2-decode-validate <game-dir> [limit] [progress-every]");
    println!("                           decode v2 CBG images in memory without writing images");
    println!("  cbg-rgba-validate <game-dir> [limit] [progress-every]");
    println!(
        "                           decode CBG images to RGBA in memory without writing images"
    );
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ReturnCandidateKey {
    family: sakura_core::SystemCallFamily,
    service_id: u8,
}

impl PartialOrd for ReturnCandidateKey {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for ReturnCandidateKey {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        family_code_for_key(self.family)
            .cmp(&family_code_for_key(other.family))
            .then_with(|| self.service_id.cmp(&other.service_id))
    }
}

#[derive(Debug, Clone, Copy, Default)]
struct ReturnCandidateStats {
    count: usize,
    first_script: usize,
    first_offset: usize,
    first_store_offset: usize,
    min_arg_count: usize,
    max_arg_count: usize,
}

fn system_return_candidates(game_dir: &Path, limit: usize) -> Result<()> {
    let archive_paths = collect_archive_files(game_dir)?;
    let mut script_index = 0usize;
    let mut candidates = BTreeMap::<ReturnCandidateKey, ReturnCandidateStats>::new();

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
                continue;
            }
            let current_script = script_index;
            script_index += 1;
            collect_return_candidates_for_script(current_script, &decompressed, &mut candidates)?;
        }
    }

    let mut rows: Vec<(ReturnCandidateKey, ReturnCandidateStats)> =
        candidates.into_iter().collect();
    rows.sort_by(|(left_key, left), (right_key, right)| {
        right
            .count
            .cmp(&left.count)
            .then_with(|| {
                family_code_for_key(left_key.family).cmp(&family_code_for_key(right_key.family))
            })
            .then_with(|| left_key.service_id.cmp(&right_key.service_id))
    });

    println!("system_return_candidate_version=1");
    for (key, stats) in rows.into_iter().take(limit) {
        println!(
            "family={} service={:02x} count={} first_script={} first_offset=0x{:x} first_store_offset=0x{:x} arg_count_range={}..{}",
            family_label_for_key(key.family),
            key.service_id,
            stats.count,
            stats.first_script,
            stats.first_offset,
            stats.first_store_offset,
            stats.min_arg_count,
            stats.max_arg_count
        );
    }
    Ok(())
}

fn system_header_scan(game_dir: &Path, limit: usize) -> Result<()> {
    let archive_paths = collect_archive_files(game_dir)?;
    let mut rows = Vec::new();
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
                continue;
            }
            let word0 = decompressed
                .get(0..4)
                .map(|bytes| u32::from_le_bytes(bytes.try_into().unwrap()))
                .unwrap_or(0);
            let word4 = decompressed
                .get(4..8)
                .map(|bytes| u32::from_le_bytes(bytes.try_into().unwrap()))
                .unwrap_or(0);
            rows.push((script_index, decompressed.len(), word0, word4));
            script_index += 1;
        }
    }

    println!("system_header_scan_version=1");
    for (index, len, word0, word4) in rows.into_iter().take(limit) {
        println!("script_index={index} len={len} word0=0x{word0:08x} word4=0x{word4:08x}");
    }
    Ok(())
}

fn collect_return_candidates_for_script(
    script_index: usize,
    data: &[u8],
    candidates: &mut BTreeMap<ReturnCandidateKey, ReturnCandidateStats>,
) -> Result<()> {
    let program = SystemProgram::parse(data)?;
    let mut cursor = program.code_offset();
    let mut stack_depth = 0usize;

    while cursor < program.code_end() {
        if !matches!(program.has_complete_min_instruction(cursor), Ok(true)) {
            break;
        }
        let instruction = match program.decode(cursor) {
            Ok(instruction) => instruction,
            Err(_) => break,
        };
        match &instruction.kind {
            SystemInstructionKind::ServiceCall {
                family, service_id, ..
            } => {
                if let Some(store_offset) =
                    service_result_store_offset(&program, instruction.next_offset)?
                {
                    let key = ReturnCandidateKey {
                        family: *family,
                        service_id: *service_id,
                    };
                    let entry = candidates.entry(key).or_insert(ReturnCandidateStats {
                        first_script: script_index,
                        first_offset: instruction.offset,
                        first_store_offset: store_offset,
                        min_arg_count: stack_depth,
                        max_arg_count: stack_depth,
                        ..ReturnCandidateStats::default()
                    });
                    entry.count += 1;
                    entry.min_arg_count = entry.min_arg_count.min(stack_depth);
                    entry.max_arg_count = entry.max_arg_count.max(stack_depth);
                }
                stack_depth = 0;
            }
            _ => {
                update_linear_stack_depth(&instruction.kind, instruction.opcode, &mut stack_depth);
            }
        }
        if instruction.next_offset <= cursor {
            break;
        }
        cursor = instruction.next_offset;
    }
    Ok(())
}

fn service_result_store_offset(
    program: &SystemProgram<'_>,
    mut cursor: usize,
) -> Result<Option<usize>> {
    for _ in 0..8 {
        if !matches!(program.has_complete_min_instruction(cursor), Ok(true)) {
            return Ok(None);
        }
        let instruction = match program.decode(cursor) {
            Ok(instruction) => instruction,
            Err(_) => return Ok(None),
        };
        match &instruction.kind {
            SystemInstructionKind::WidthOperand { width: 2 }
                if instruction.opcode == 0x09 || instruction.opcode == 0x0a =>
            {
                return Ok(Some(instruction.offset))
            }
            SystemInstructionKind::PushU8(_)
            | SystemInstructionKind::PushU16(_)
            | SystemInstructionKind::PushU32(_)
            | SystemInstructionKind::PushU64(_)
            | SystemInstructionKind::GetVariablePointer(_)
            | SystemInstructionKind::GetString { .. }
            | SystemInstructionKind::GetCodeOffset { .. } => {}
            SystemInstructionKind::NoOperand if matches!(instruction.opcode, 0x20 | 0x21) => {}
            _ => return Ok(None),
        }
        if instruction.next_offset <= cursor {
            return Ok(None);
        }
        cursor = instruction.next_offset;
    }
    Ok(None)
}

fn update_linear_stack_depth(
    kind: &SystemInstructionKind<'_>,
    opcode: u8,
    stack_depth: &mut usize,
) {
    match kind {
        SystemInstructionKind::PushU8(_)
        | SystemInstructionKind::PushU16(_)
        | SystemInstructionKind::PushU32(_)
        | SystemInstructionKind::PushU64(_)
        | SystemInstructionKind::GetVariablePointer(_)
        | SystemInstructionKind::GetString { .. }
        | SystemInstructionKind::GetCodeOffset { .. }
        | SystemInstructionKind::ArrayOperand { .. } => {
            *stack_depth = stack_depth.saturating_add(1)
        }
        SystemInstructionKind::WidthOperand { .. } if opcode == 0x08 => {}
        SystemInstructionKind::WidthOperand { .. } if opcode == 0x09 => {
            *stack_depth = stack_depth.saturating_sub(1)
        }
        SystemInstructionKind::WidthOperand { .. } if opcode == 0x0a => {
            *stack_depth = stack_depth.saturating_sub(2)
        }
        SystemInstructionKind::ShortOperand(value) => {
            let count = usize::from(value >> 8);
            *stack_depth = stack_depth.saturating_sub(count.saturating_add(1));
        }
        SystemInstructionKind::NoOperand => match opcode {
            0x10 | 0x70 => *stack_depth = stack_depth.saturating_add(1),
            0x28 | 0x3a | 0x48 | 0x49 | 0x68 => {}
            0x40 | 0x42 | 0x6c => *stack_depth = stack_depth.saturating_sub(2).saturating_add(1),
            0x20..=0x2b | 0x30..=0x35 | 0x38 | 0x39 | 0x43 | 0x44 | 0x63 | 0x69 => {
                *stack_depth = stack_depth.saturating_sub(1);
            }
            0x60 | 0x62 | 0x6b | 0x75 => *stack_depth = stack_depth.saturating_sub(3),
            0x61 | 0x6a | 0x6f => *stack_depth = stack_depth.saturating_sub(2),
            0x67 => *stack_depth = stack_depth.saturating_sub(4),
            0x6d | 0x71 => *stack_depth = stack_depth.saturating_sub(1),
            _ => {}
        },
        SystemInstructionKind::ServiceCall { .. }
        | SystemInstructionKind::UserScript(_)
        | SystemInstructionKind::Branch { .. }
        | SystemInstructionKind::Return
        | SystemInstructionKind::WidthOperand { .. } => {}
    }
}

fn family_code_for_key(family: sakura_core::SystemCallFamily) -> u8 {
    match family {
        sakura_core::SystemCallFamily::System => 0,
        sakura_core::SystemCallFamily::Graph => 1,
        sakura_core::SystemCallFamily::Sound => 2,
        sakura_core::SystemCallFamily::External => 3,
    }
}

fn family_label_for_key(family: sakura_core::SystemCallFamily) -> &'static str {
    match family {
        sakura_core::SystemCallFamily::System => "sys",
        sakura_core::SystemCallFamily::Graph => "graph",
        sakura_core::SystemCallFamily::Sound => "sound",
        sakura_core::SystemCallFamily::External => "ext",
    }
}

fn format_service_trace_probe_head(events: &[sakura_core::SystemServiceTraceEvent]) -> String {
    if events.is_empty() {
        return "none".to_owned();
    }
    events
        .iter()
        .take(4)
        .map(|event| {
            format!(
                "{}:{:02x}@s{}:0x{:x}:argc{}:top{}:ints{}:{}-{}:args{}",
                family_label_for_key(event.family),
                event.service_id,
                event.script_index,
                event.instruction_offset,
                event.arg_count.min(7),
                event.top_kind,
                event.integer_arg_count.min(7),
                event.min_integer_arg.min(u32::MAX.into()),
                event.max_integer_arg.min(u32::MAX.into()),
                format_service_trace_probe_args(event),
            )
        })
        .collect::<Vec<_>>()
        .join(",")
}

fn format_service_trace_probe_args(event: &sakura_core::SystemServiceTraceEvent) -> String {
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

fn rank_system_scripts(game_dir: &Path, limit: usize) -> Result<()> {
    let archive_paths = collect_archive_files(game_dir)?;
    let mut rows = Vec::new();
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
                continue;
            }
            let summary = analyze_system_script(&decompressed)?;
            let score = summary.graphcall_service_counts[0x88]
                .saturating_mul(100_000)
                .saturating_add(summary.graphcall_service_counts[0x9c].saturating_mul(100_000))
                .saturating_add(summary.soundcall_count.saturating_mul(10_000))
                .saturating_add(summary.syscall_service_counts[0x40].saturating_mul(10_000))
                .saturating_add(summary.user_script_load_count.saturating_mul(10_000))
                .saturating_add(summary.user_script_dispatch_count);
            rows.push(SystemScriptRankRow {
                script_index,
                code_bytes: summary.reachable_code_bytes,
                hash: fnv1a64(&decompressed),
                score,
                sys40: summary.syscall_service_counts[0x40],
                graph88: summary.graphcall_service_counts[0x88],
                graph9c: summary.graphcall_service_counts[0x9c],
                sound: summary.soundcall_count,
                min_sys40: summary.min_syscall_offsets[0x40],
                min_graph88: summary.min_graphcall_offsets[0x88],
                min_graph9c: summary.min_graphcall_offsets[0x9c],
                min_sound: min_offset(&summary.min_soundcall_offsets),
                block_sys40: summary.min_syscall_block_offsets[0x40],
                block_graph88: summary.min_graphcall_block_offsets[0x88],
                block_graph9c: summary.min_graphcall_block_offsets[0x9c],
                block_sound: min_offset(&summary.min_soundcall_block_offsets),
                user_load: summary.user_script_load_count,
                user_ret: summary.user_script_return_count,
                user_dispatch: summary.user_script_dispatch_count,
            });
            script_index += 1;
        }
    }

    rows.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| right.code_bytes.cmp(&left.code_bytes))
            .then_with(|| left.script_index.cmp(&right.script_index))
    });

    println!("system_script_rank_version=1");
    for row in rows.into_iter().take(limit) {
        println!(
            "script_index={} hash={:016x} code_bytes={} sys40={} min_sys40={} block_sys40={} graph88={} min_graph88={} block_graph88={} graph9c={} min_graph9c={} block_graph9c={} sound={} min_sound={} block_sound={} user_load={} user_ret={} user_dispatch={}",
            row.script_index,
            row.hash,
            row.code_bytes,
            row.sys40,
            format_optional_offset(row.min_sys40),
            format_optional_offset(row.block_sys40),
            row.graph88,
            format_optional_offset(row.min_graph88),
            format_optional_offset(row.block_graph88),
            row.graph9c,
            format_optional_offset(row.min_graph9c),
            format_optional_offset(row.block_graph9c),
            row.sound,
            format_optional_offset(row.min_sound),
            format_optional_offset(row.block_sound),
            row.user_load,
            row.user_ret,
            row.user_dispatch
        );
    }
    Ok(())
}

fn system_window(
    game_dir: &Path,
    target_script_index: usize,
    target_offset: usize,
    count: usize,
) -> Result<()> {
    let archive_paths = collect_archive_files(game_dir)?;
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
                continue;
            }
            let current = script_index;
            script_index += 1;
            if current != target_script_index {
                continue;
            }
            let program = SystemProgram::parse(&decompressed)?;
            println!("system_window_version=1");
            println!("script_index={target_script_index}");
            println!("target_offset=0x{target_offset:x}");
            println!("code_offset=0x{:x}", program.code_offset());
            println!("code_end=0x{:x}", program.code_end());
            let mut cursor = program.code_offset();
            let mut window = Vec::new();
            while cursor < program.code_end() {
                if !matches!(program.has_complete_min_instruction(cursor), Ok(true)) {
                    break;
                }
                let instruction = match program.decode(cursor) {
                    Ok(instruction) => instruction,
                    Err(error) => {
                        println!("decode_error={}", error.to_string().replace(',', ";"));
                        break;
                    }
                };
                if instruction.offset > target_offset {
                    break;
                }
                window.push((
                    instruction.offset,
                    instruction.opcode,
                    safe_instruction_label(&instruction.kind),
                    instruction_string_excerpt(&instruction.kind),
                ));
                if window.len() > count {
                    window.remove(0);
                }
                if instruction.offset == target_offset {
                    break;
                }
                if instruction.next_offset <= cursor {
                    break;
                }
                cursor = instruction.next_offset;
            }
            for (offset, opcode, label, string_excerpt) in window {
                println!(
                    "offset=0x{offset:x} opcode=0x{opcode:02x} kind={label} string={string_excerpt}"
                );
            }
            return Ok(());
        }
    }

    Err(SakuraError::InvalidScript("target script index not found".to_owned()).into())
}

fn system_value_scan(
    game_dir: &Path,
    target_script_index: usize,
    target_value: usize,
    limit: usize,
) -> Result<()> {
    let archive_paths = collect_archive_files(game_dir)?;
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
                continue;
            }
            let current = script_index;
            script_index += 1;
            if current != target_script_index {
                continue;
            }
            let program = SystemProgram::parse(&decompressed)?;
            println!("system_value_scan_version=1");
            println!("script_index={target_script_index}");
            println!("target_value=0x{target_value:x}");
            println!("code_offset=0x{:x}", program.code_offset());
            println!("code_end=0x{:x}", program.code_end());
            let mut cursor = program.code_offset();
            let mut match_count = 0usize;
            while cursor < program.code_end() {
                if !matches!(program.has_complete_min_instruction(cursor), Ok(true)) {
                    break;
                }
                let instruction = match program.decode(cursor) {
                    Ok(instruction) => instruction,
                    Err(error) => {
                        println!("decode_error={}", error.to_string().replace(',', ";"));
                        break;
                    }
                };
                if system_instruction_matches_value(&instruction.kind, target_value) {
                    match_count += 1;
                    if match_count <= limit {
                        println!(
                            "match={} offset=0x{:x} opcode=0x{:02x} kind={} string={}",
                            match_count - 1,
                            instruction.offset,
                            instruction.opcode,
                            safe_instruction_label(&instruction.kind),
                            instruction_string_excerpt(&instruction.kind)
                        );
                    }
                }
                if instruction.next_offset <= cursor {
                    break;
                }
                cursor = instruction.next_offset;
            }
            println!("match_count={match_count}");
            return Ok(());
        }
    }

    Err(SakuraError::InvalidScript("target script index not found".to_owned()).into())
}

fn system_instruction_matches_value(kind: &SystemInstructionKind<'_>, target: usize) -> bool {
    match kind {
        SystemInstructionKind::PushU8(value) => usize::from(*value) == target,
        SystemInstructionKind::PushU16(value) => usize::from(*value) == target,
        SystemInstructionKind::PushU32(value) => usize::try_from(*value) == Ok(target),
        SystemInstructionKind::PushU64(value) => usize::try_from(*value) == Ok(target),
        SystemInstructionKind::GetVariablePointer(offset) => usize::from(*offset) == target,
        SystemInstructionKind::GetCodeOffset {
            target: Some(offset),
            ..
        } => *offset == target,
        SystemInstructionKind::ShortOperand(value) => usize::from(*value) == target,
        SystemInstructionKind::ServiceCall { service_id, .. } => usize::from(*service_id) == target,
        _ => false,
    }
}

#[derive(Debug, Clone)]
struct SystemStringRefRow {
    script_index: usize,
    script_hash: u64,
    instruction_offset: usize,
    code_bytes: usize,
    user_load: usize,
    user_dispatch: usize,
    graph88: usize,
    graph9c: usize,
    sound: usize,
    excerpt: String,
}

fn system_string_ref_scan(game_dir: &Path, target: &[u8], limit: usize) -> Result<()> {
    let archive_paths = collect_archive_files(game_dir)?;
    let mut rows = Vec::new();
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
                continue;
            }
            let current = script_index;
            script_index += 1;
            let summary = analyze_system_script(&decompressed)?;
            let program = match SystemProgram::parse(&decompressed) {
                Ok(program) => program,
                Err(_) => continue,
            };
            let mut cursor = program.code_offset();
            while cursor < program.code_end() {
                if !matches!(program.has_complete_min_instruction(cursor), Ok(true)) {
                    break;
                }
                let instruction = match program.decode(cursor) {
                    Ok(instruction) => instruction,
                    Err(_) => break,
                };
                if let SystemInstructionKind::GetString {
                    bytes: Some(bytes), ..
                } = &instruction.kind
                {
                    if bytes == &target {
                        rows.push(SystemStringRefRow {
                            script_index: current,
                            script_hash: fnv1a64(&decompressed),
                            instruction_offset: instruction.offset,
                            code_bytes: summary.reachable_code_bytes,
                            user_load: summary.user_script_load_count,
                            user_dispatch: summary.user_script_dispatch_count,
                            graph88: summary.graphcall_service_counts[0x88],
                            graph9c: summary.graphcall_service_counts[0x9c],
                            sound: summary.soundcall_count,
                            excerpt: format_string_excerpt(bytes, 48),
                        });
                    }
                }
                if instruction.next_offset <= cursor {
                    break;
                }
                cursor = instruction.next_offset;
            }
        }
    }

    rows.sort_by(|left, right| {
        left.script_index
            .cmp(&right.script_index)
            .then_with(|| left.instruction_offset.cmp(&right.instruction_offset))
    });

    println!("system_string_ref_scan_version=1");
    println!("target={}", format_string_excerpt(target, 48));
    println!("match_count={}", rows.len());
    for row in rows.into_iter().take(limit) {
        println!(
            "script_index={} hash={:016x} offset=0x{:x} code_bytes={} user_load={} user_dispatch={} graph88={} graph9c={} sound={} string={}",
            row.script_index,
            row.script_hash,
            row.instruction_offset,
            row.code_bytes,
            row.user_load,
            row.user_dispatch,
            row.graph88,
            row.graph9c,
            row.sound,
            row.excerpt,
        );
    }
    Ok(())
}

fn list_system_scripts(game_dir: &Path, limit: usize, start_system_index: usize) -> Result<()> {
    let archive_paths = collect_archive_files(game_dir)?;
    let mut runtime_index = 0usize;
    let mut system_index = 0usize;
    let mut emitted = 0usize;

    println!("system_script_list_version=1");
    for path in &archive_paths {
        let data = fs::read(path)?;
        let archive = ArcArchive::parse(&data)?;
        for entry in archive.entries() {
            let payload = archive.entry_data(entry)?;
            if sniff_payload(payload) != PayloadKind::Dsc {
                continue;
            }
            let decompressed = decompress_dsc(payload)?;
            let kind = classify_dsc_script(entry.name.as_bytes(), &decompressed);
            let current_runtime_index = runtime_index;
            runtime_index += 1;
            if kind != Some(LoadedScriptKind::System) {
                continue;
            }
            let current_system_index = system_index;
            system_index += 1;
            if current_system_index < start_system_index {
                continue;
            }
            println!(
                "system_index={} runtime_index={} hash={:016x} name={} code_bytes={}",
                current_system_index,
                current_runtime_index,
                fnv1a64(&decompressed),
                format_string_excerpt(entry.name.as_bytes(), 64),
                decompressed.len(),
            );
            emitted += 1;
            if emitted >= limit {
                return Ok(());
            }
        }
    }
    Ok(())
}

fn runtime_step_probe(
    game_dir: &Path,
    script_name: &[u8],
    steps: usize,
    max_instructions: usize,
) -> Result<()> {
    let archive_paths = collect_archive_files(game_dir)?;
    let mut runtime = Runtime::new(RuntimeConfig::default());
    for path in &archive_paths {
        let data = fs::read(path)?;
        let archive_name = path
            .file_name()
            .and_then(OsStr::to_str)
            .map(|name| name.as_bytes().to_vec());
        runtime.mount_archive_data_named(data, archive_name.as_deref())?;
    }
    let script_index = runtime.script_index_by_name(script_name).ok_or_else(|| {
        SakuraError::InvalidRuntime(format!(
            "system probe script is missing: {}",
            String::from_utf8_lossy(script_name)
        ))
    })?;
    let scripts = runtime.scripts();
    let entry = scripts.id_from_index(script_index).ok_or_else(|| {
        SakuraError::InvalidRuntime("runtime step probe script index is invalid".to_owned())
    })?;
    let host = SystemHost::with_runtime(&runtime);
    let mut system_runtime = sakura_core::SystemRuntime::new(scripts, host);
    system_runtime.push_script(entry, Vec::new())?;

    println!("runtime_step_probe_version=1");
    println!("script_name={}", format_string_excerpt(script_name, 64));
    println!("script_index={script_index}");
    for step in 0..steps {
        let (summary, trace) = system_runtime.run_with_service_trace(1, max_instructions, 8)?;
        let frame = system_runtime.current_frame_state().unwrap_or_default();
        let frame_name = scripts
            .id_from_index(frame.script_index)
            .and_then(|id| scripts.name_by_id(id))
            .map(|name| format_string_excerpt(name, 64))
            .unwrap_or_else(|| "none".to_owned());
        let local32 = system_runtime
            .current_frame_local_integer(32, 2)
            .unwrap_or(0);
        let local36 = system_runtime
            .current_frame_local_integer(36, 2)
            .unwrap_or(0);
        let local40 = system_runtime
            .current_frame_local_integer(40, 2)
            .unwrap_or(0);
        let local44 = system_runtime
            .current_frame_local_integer(44, 2)
            .unwrap_or(0);
        let local48 = system_runtime
            .current_frame_local_integer(48, 2)
            .unwrap_or(0);
        let local52 = system_runtime
            .current_frame_local_integer(52, 2)
            .unwrap_or(0);
        let mem_ptr = frame.mem_ptr;
        let frame_local = |delta: u32| {
            mem_ptr
                .checked_sub(delta)
                .and_then(|offset| usize::try_from(offset).ok())
                .and_then(|offset| system_runtime.current_frame_local_integer(offset, 2))
                .unwrap_or(0)
        };
        let fp32 = frame_local(32);
        let fp36 = frame_local(36);
        let fp40 = frame_local(40);
        let fp44 = frame_local(44);
        let fp48 = frame_local(48);
        let fp52 = frame_local(52);
        let fp56 = frame_local(56);
        let fp60 = frame_local(60);
        let fp64 = frame_local(64);
        let fp68 = frame_local(68);
        let fp72 = frame_local(72);
        let read_head = |value: u64, offset: u32| {
            u32::try_from(value)
                .ok()
                .and_then(|base| base.checked_add(offset))
                .and_then(|address| system_runtime.current_frame_integer_raw(address, 2))
                .unwrap_or(0)
        };
        let fp64_head0 = read_head(fp64, 0);
        let fp64_head4 = read_head(fp64, 4);
        let fp68_head0 = read_head(fp68, 0);
        let fp68_head4 = read_head(fp68, 4);
        let fp72_head0 = read_head(fp72, 0);
        let fp72_head4 = read_head(fp72, 4);
        let local52_u32 = u32::try_from(local52).ok();
        let local52_head0 = local52_u32
            .and_then(|address| system_runtime.current_frame_integer_raw(address, 2))
            .unwrap_or(0);
        let local52_head4 = local52_u32
            .and_then(|address| {
                address
                    .checked_add(4)
                    .and_then(|offset| system_runtime.current_frame_integer_raw(offset, 2))
            })
            .unwrap_or(0);
        let global144576_26024 = system_runtime
            .current_frame_integer_raw(144576u32.saturating_add(26024), 2)
            .unwrap_or(0);
        let global144576_26028 = system_runtime
            .current_frame_integer_raw(144576u32.saturating_add(26028), 2)
            .unwrap_or(0);
        let global128600 = system_runtime
            .current_frame_integer_raw(128600, 2)
            .unwrap_or(0);
        let host = summary.host_state;
        let last_family = host.last_family.map(family_label_for_key).unwrap_or("none");
        let trace_head = format_service_trace_probe_head(&trace.recorded_services);
        let asset_name = if host.last_asset_string_len == 0 {
            "none".to_owned()
        } else {
            format_string_excerpt(system_runtime.host_last_asset_name(), 96)
        };
        println!(
            "step={} events={} services={} user_calls={} user_loads={} user_returns={} halted={} completed={} limited={} frame_script={} frame_name={} frame_cursor={} frame_last=0x{:x} mem_ptr=0x{:x} l32={} l36={} l40={} l44={} l48={} l52=0x{:x} fp32={} fp36={} fp40={} fp44={} fp48={} fp52={} fp56={} fp60={} fp64=0x{:x} fp68=0x{:x} fp72=0x{:x} fp64[0]=0x{:x} fp64[4]=0x{:x} fp68[0]=0x{:x} fp68[4]=0x{:x} fp72[0]=0x{:x} fp72[4]=0x{:x} g170600=0x{:x} g170604=0x{:x} g128600=0x{:x} m52[0]=0x{:x} m52[4]=0x{:x} sys1c={} sys49={} sys5f={} graphbf={} host_last={}:{:02x}:argc{}:top{} load40={} fileq={} graph88={} graph9c={} sound={} assetq={:02x}:found{} assetlen={} assetname={} scripthit={} trace_total={} trace_head={}",
            step,
            summary.event_count,
            summary.service_event_count,
            summary.user_call_event_count,
            summary.user_load_event_count,
            summary.user_return_event_count,
            summary.halted_event_count,
            u32::from(summary.completed),
            u32::from(summary.event_limited),
            frame.script_index,
            frame_name,
            frame.cursor,
            frame.last_instruction_offset,
            mem_ptr,
            local32,
            local36,
            local40,
            local44,
            local48,
            local52,
            fp32,
            fp36,
            fp40,
            fp44,
            fp48,
            fp52,
            fp56,
            fp60,
            fp64,
            fp68,
            fp72,
            fp64_head0,
            fp64_head4,
            fp68_head0,
            fp68_head4,
            fp72_head0,
            fp72_head4,
            global144576_26024,
            global144576_26028,
            global128600,
            local52_head0,
            local52_head4,
            summary.syscall_service_counts[0x1c],
            summary.syscall_service_counts[0x49],
            summary.syscall_service_counts[0x5f],
            summary.graphcall_service_counts[0xbf],
            last_family,
            host.last_service_id,
            host.last_arg_count,
            host.last_top_kind,
            host.load_program_count,
            host.file_query_count,
            host.graph_format_count,
            host.graph_render_text_count,
            host.sound_service_count,
            host.last_asset_query_service_id,
            u32::from(host.last_asset_found),
            host.last_asset_string_len,
            asset_name,
            u32::from(host.last_loaded_script_found),
            trace.total_service_count,
            trace_head,
        );
        if summary.completed {
            break;
        }
    }
    Ok(())
}

fn probe_install(game_dir: &Path) -> Result<()> {
    let files = collect_files(game_dir)?;
    let exe_count = files
        .iter()
        .filter(|path| path.file_name() == Some(OsStr::new("BGI.exe")))
        .count();
    let archive_paths = collect_archive_files(game_dir)?;

    let mut runtime = Runtime::new(RuntimeConfig::default());
    let mut total_entries = 0usize;
    let mut checked_archives = 0usize;
    let mut total_archive_bytes = 0u64;

    for path in &archive_paths {
        let data = fs::read(path)?;
        total_archive_bytes += data.len() as u64;
        let archive = ArcArchive::parse(&data)?;
        total_entries += archive.entries().len();
        let archive_name = path
            .file_name()
            .and_then(OsStr::to_str)
            .map(|name| name.as_bytes().to_vec());
        runtime.mount_archive_data_named(data, archive_name.as_deref())?;
        checked_archives += 1;
    }

    println!("install_probe_version=1");
    println!("bgi_exe_count={exe_count}");
    println!("arc20_archive_count={checked_archives}");
    println!("arc20_entry_count={total_entries}");
    println!("arc20_total_bytes={total_archive_bytes}");
    println!("dsc_payload_count={}", runtime.dsc_assets());
    println!("loaded_script_count={}", runtime.loaded_scripts());
    println!(
        "loaded_scenario_script_count={}",
        runtime.scripts().scenario_script_count()
    );
    println!(
        "loaded_system_script_count={}",
        runtime.scripts().system_script_count()
    );
    println!("media_payload_count={}", runtime.media_assets());
    println!(
        "unknown_payload_count={}",
        runtime.mounted_assets() - runtime.dsc_assets() - runtime.media_assets()
    );
    Ok(())
}

fn check_archive(path: &Path) -> Result<()> {
    let data = fs::read(path)?;
    let archive = ArcArchive::parse(&data)?;
    println!("archive_check_version=1");
    println!("kind=buriko_arc20");
    println!("entries={}", archive.entries().len());
    println!("bytes={}", data.len());
    Ok(())
}

fn payload_signatures(game_dir: &Path, limit: usize) -> Result<()> {
    let archive_paths = collect_archive_files(game_dir)?;
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();

    for path in &archive_paths {
        let data = fs::read(path)?;
        let archive = ArcArchive::parse(&data)?;
        for entry in archive.entries() {
            let payload = archive.entry_data(entry)?;
            let signature = hex_signature(payload, 16);
            *counts.entry(signature).or_default() += 1;
        }
    }

    let mut ranked: Vec<(String, usize)> = counts.into_iter().collect();
    ranked.sort_by(|(left_sig, left_count), (right_sig, right_count)| {
        right_count
            .cmp(left_count)
            .then_with(|| left_sig.cmp(right_sig))
    });

    println!("payload_signature_version=1");
    for (signature, count) in ranked.into_iter().take(limit) {
        println!("count={count} first16_hex={signature}");
    }
    Ok(())
}

fn dsc_signatures(game_dir: &Path, limit: usize) -> Result<()> {
    let archive_paths = collect_archive_files(game_dir)?;
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();

    for path in &archive_paths {
        let data = fs::read(path)?;
        let archive = ArcArchive::parse(&data)?;
        for entry in archive.entries() {
            let payload = archive.entry_data(entry)?;
            if sniff_payload(payload) != PayloadKind::Dsc {
                continue;
            }
            let decompressed = decompress_dsc(payload)?;
            let signature = hex_signature(&decompressed, 16);
            *counts.entry(signature).or_default() += 1;
        }
    }

    let mut ranked: Vec<(String, usize)> = counts.into_iter().collect();
    ranked.sort_by(|(left_sig, left_count), (right_sig, right_count)| {
        right_count
            .cmp(left_count)
            .then_with(|| left_sig.cmp(right_sig))
    });

    println!("dsc_signature_version=1");
    for (signature, count) in ranked.into_iter().take(limit) {
        println!("count={count} first16_hex={signature}");
    }
    Ok(())
}

fn validate_payloads(game_dir: &Path) -> Result<()> {
    let archive_paths = collect_archive_files(game_dir)?;
    let mut cbg_count = 0usize;
    let mut audio_count = 0usize;
    let mut dsc_count = 0usize;
    let mut dsc_decompressed_bytes = 0usize;
    let mut unknown_counts: BTreeMap<String, usize> = BTreeMap::new();
    let mut cbg_versions: BTreeMap<u16, usize> = BTreeMap::new();
    let mut cbg_bpp: BTreeMap<u32, usize> = BTreeMap::new();
    let mut min_width: Option<u16> = None;
    let mut max_width: Option<u16> = None;
    let mut min_height: Option<u16> = None;
    let mut max_height: Option<u16> = None;

    for path in &archive_paths {
        let data = fs::read(path)?;
        let archive = ArcArchive::parse(&data)?;
        for entry in archive.entries() {
            let payload = archive.entry_data(entry)?;
            match sniff_payload(payload) {
                PayloadKind::CompressedBg => {
                    let meta = read_cbg_metadata(payload)?;
                    cbg_count += 1;
                    *cbg_versions.entry(meta.version).or_default() += 1;
                    *cbg_bpp.entry(meta.bits_per_pixel).or_default() += 1;
                    min_width = Some(min_width.map_or(meta.width, |value| value.min(meta.width)));
                    max_width = Some(max_width.map_or(meta.width, |value| value.max(meta.width)));
                    min_height =
                        Some(min_height.map_or(meta.height, |value| value.min(meta.height)));
                    max_height =
                        Some(max_height.map_or(meta.height, |value| value.max(meta.height)));
                }
                PayloadKind::BgiAudio => {
                    read_bgi_audio_metadata(payload)?;
                    audio_count += 1;
                }
                PayloadKind::Dsc => {
                    let decompressed = decompress_dsc(payload)?;
                    dsc_decompressed_bytes += decompressed.len();
                    dsc_count += 1;
                }
                PayloadKind::MpegProgramStream
                | PayloadKind::MpegVideo
                | PayloadKind::OggVorbis
                | PayloadKind::Png
                | PayloadKind::Jpeg
                | PayloadKind::Wav => {}
                PayloadKind::Unknown => {
                    *unknown_counts
                        .entry(hex_signature(payload, 16))
                        .or_default() += 1;
                }
            }
        }
    }

    println!("payload_validate_version=1");
    println!("compressed_bg_count={cbg_count}");
    println!("bgi_audio_count={audio_count}");
    println!("dsc_count={dsc_count}");
    println!("dsc_decompressed_count={dsc_count}");
    println!("dsc_decompressed_bytes={dsc_decompressed_bytes}");
    println!("unknown_count={}", unknown_counts.values().sum::<usize>());
    println!(
        "compressed_bg_versions={}",
        format_u16_counts(&cbg_versions)
    );
    println!("compressed_bg_bpp={}", format_u32_counts(&cbg_bpp));
    if let (Some(min_w), Some(max_w), Some(min_h), Some(max_h)) =
        (min_width, max_width, min_height, max_height)
    {
        println!("compressed_bg_width_range={min_w}..{max_w}");
        println!("compressed_bg_height_range={min_h}..{max_h}");
    }
    for (signature, count) in unknown_counts {
        println!("unknown count={count} first16_hex={signature}");
    }
    Ok(())
}

fn validate_catalog(game_dir: &Path) -> Result<()> {
    let archive_paths = collect_archive_files(game_dir)?;
    let mut catalog = AssetCatalog::new();
    let mut archive_count = 0usize;
    let mut archive_bytes = 0u64;

    for path in &archive_paths {
        let data = fs::read(path)?;
        archive_bytes += data.len() as u64;
        let archive = ArcArchive::parse(&data)?;
        catalog.mount_archive(&archive)?;
        archive_count += 1;
    }

    println!("catalog_validate_version=1");
    println!("archive_count={archive_count}");
    println!("archive_bytes={archive_bytes}");
    println!("mounted_asset_count={}", catalog.asset_count());
    println!("canonical_asset_count={}", catalog.canonical_asset_count());
    println!("duplicate_asset_count={}", catalog.duplicate_assets());
    println!("dsc_asset_count={}", catalog.dsc_assets());
    println!("media_asset_count={}", catalog.media_assets());
    println!("unknown_asset_count={}", catalog.unknown_assets());
    Ok(())
}

fn image_info(game_dir: &Path, names: &[String]) -> Result<()> {
    let requested = names
        .iter()
        .map(|name| name.as_bytes().to_ascii_lowercase())
        .collect::<BTreeSet<_>>();
    let mut found = BTreeMap::<Vec<u8>, (PathBuf, Vec<u8>, usize, usize, PayloadKind)>::new();

    for path in collect_archive_files(game_dir)? {
        let data = fs::read(&path)?;
        let archive = ArcArchive::parse(&data)?;
        for entry in archive.entries() {
            let key = entry.name.as_bytes().to_ascii_lowercase();
            if !requested.contains(&key) {
                continue;
            }
            let payload = archive.entry_data(entry)?;
            let kind = sniff_payload(payload);
            let (width, height) = decode_image_dimensions(payload)?;
            found.insert(
                key,
                (
                    path.clone(),
                    entry.name.as_bytes().to_vec(),
                    width,
                    height,
                    kind,
                ),
            );
        }
    }

    println!("image_info_version=1");
    for name in names {
        let key = name.as_bytes().to_ascii_lowercase();
        if let Some((archive, actual_name, width, height, kind)) = found.get(&key) {
            println!(
                "name={} actual={} archive={} kind={kind:?} width={width} height={height}",
                name,
                String::from_utf8_lossy(actual_name),
                archive.display(),
            );
        } else {
            println!("name={name} missing=1");
        }
    }
    Ok(())
}

fn decode_image_dimensions(payload: &[u8]) -> Result<(usize, usize)> {
    let image = decode_local_image(payload)?;
    Ok((usize::from(image.width), usize::from(image.height)))
}

fn image_extract(game_dir: &Path, name: &str, output: &Path) -> Result<()> {
    let key = name.as_bytes().to_ascii_lowercase();
    let mut selected = None;
    for path in collect_archive_files(game_dir)? {
        let data = fs::read(&path)?;
        let archive = ArcArchive::parse(&data)?;
        for entry in archive.entries() {
            if entry.name.as_bytes().eq_ignore_ascii_case(&key) {
                selected = Some((path.clone(), archive.entry_data(entry)?.to_vec()));
            }
        }
    }
    let (archive, payload) = selected
        .ok_or_else(|| SakuraError::UnsupportedFormat(format!("image asset not found: {name}")))?;
    let image = decode_local_image(&payload)?;
    let rgba = cbg_to_rgba(&image)?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(output)?;
    write!(
        file,
        "P7\nWIDTH {}\nHEIGHT {}\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n",
        image.width, image.height
    )?;
    file.write_all(&rgba)?;
    println!("image_extract_version=1");
    println!("name={name}");
    println!("archive={}", archive.display());
    println!("width={}", image.width);
    println!("height={}", image.height);
    println!("rgba_bytes={}", rgba.len());
    println!("output={}", output.display());
    Ok(())
}

fn decode_local_image(payload: &[u8]) -> Result<sakura_core::CbgImage> {
    if let Ok(image) = decode_cbg(payload) {
        return Ok(image);
    }
    if let Ok(image) = decode_raw_bitmap(payload) {
        return Ok(image);
    }
    let decompressed = decompress_dsc(payload)?;
    if let Ok(image) = decode_cbg(&decompressed) {
        return Ok(image);
    }
    Ok(decode_raw_bitmap(&decompressed)?)
}

fn validate_scripts(game_dir: &Path) -> Result<()> {
    let archive_paths = collect_archive_files(game_dir)?;
    let mut dsc_count = 0usize;
    let mut v1_count = 0usize;
    let mut non_v1_count = 0usize;
    let mut system_instruction_count = 0usize;
    let mut system_code_bytes = 0usize;
    let mut system_string_operands = 0usize;
    let mut system_jumps = 0usize;
    let mut system_conditional_jumps = 0usize;
    let mut system_calls = 0usize;
    let mut system_returns = 0usize;
    let mut system_syscalls = 0usize;
    let mut system_graphcalls = 0usize;
    let mut system_soundcalls = 0usize;
    let mut system_extcalls = 0usize;
    let mut system_user_script_calls = 0usize;
    let mut system_truncated_tail_blocks = 0usize;
    let mut system_invalid_opcode_blocks = 0usize;
    let mut system_invalid_target_blocks = 0usize;
    let mut system_invalid_jump_blocks = 0usize;
    let mut system_invalid_string_target_blocks = 0usize;
    let mut referenced_scripts = 0usize;
    let mut labels = 0usize;
    let mut instructions = 0usize;
    let mut code_bytes = 0usize;
    let mut code_addresses = 0usize;
    let mut string_addresses = 0usize;
    let mut messages = 0usize;
    let mut character_names = 0usize;
    let mut choices = 0usize;
    let mut choice_function_calls = 0usize;
    let mut internal_strings = 0usize;
    let mut user_function_calls = 0usize;
    let mut user_function_string_args = 0usize;
    let mut max_user_function_string_args = 0usize;
    let mut max_stack_depth = 0usize;
    let mut largest_code_address = 0usize;

    for path in &archive_paths {
        let data = fs::read(path)?;
        let archive = ArcArchive::parse(&data)?;
        for entry in archive.entries() {
            let payload = archive.entry_data(entry)?;
            if sniff_payload(payload) != PayloadKind::Dsc {
                continue;
            }
            dsc_count += 1;
            let decompressed = decompress_dsc(payload)?;
            if !is_buriko_script_v1(&decompressed) {
                let summary = analyze_system_script(&decompressed)?;
                non_v1_count += 1;
                system_instruction_count += summary.instruction_count;
                system_code_bytes += summary.reachable_code_bytes;
                system_string_operands += summary.string_operands;
                system_jumps += summary.jump_count;
                system_conditional_jumps += summary.conditional_jump_count;
                system_calls += summary.call_count;
                system_returns += summary.return_count;
                system_syscalls += summary.syscall_count;
                system_graphcalls += summary.graphcall_count;
                system_soundcalls += summary.soundcall_count;
                system_extcalls += summary.extcall_count;
                system_user_script_calls += summary.user_script_call_count;
                system_truncated_tail_blocks += summary.truncated_tail_blocks;
                system_invalid_opcode_blocks += summary.invalid_opcode_blocks;
                system_invalid_target_blocks += summary.invalid_target_blocks;
                system_invalid_jump_blocks += summary.invalid_jump_blocks;
                system_invalid_string_target_blocks += summary.invalid_string_target_blocks;
                continue;
            }

            let summary = analyze_scenario_script(&decompressed)?;
            v1_count += 1;
            referenced_scripts += summary.referenced_script_count;
            labels += summary.label_count;
            instructions += summary.instruction_count;
            code_bytes += summary.code_length;
            code_addresses += summary.code_address_operands;
            string_addresses += summary.string_address_operands;
            messages += summary.message_string_operands;
            character_names += summary.character_name_string_operands;
            choices += summary.choice_string_operands;
            choice_function_calls += summary.choice_function_call_count;
            internal_strings += summary.internal_string_operands;
            user_function_calls += summary.user_function_call_count;
            user_function_string_args += summary.user_function_string_arg_operands;
            max_user_function_string_args =
                max_user_function_string_args.max(summary.max_user_function_string_args);
            max_stack_depth = max_stack_depth.max(summary.max_string_stack_depth);
            largest_code_address = largest_code_address.max(summary.largest_code_address);
        }
    }

    println!("script_validate_version=1");
    println!("dsc_payload_count={dsc_count}");
    println!("v1_script_count={v1_count}");
    println!("system_script_count={non_v1_count}");
    println!("referenced_script_count={referenced_scripts}");
    println!("label_count={labels}");
    println!("instruction_count={instructions}");
    println!("code_bytes={code_bytes}");
    println!("code_address_operand_count={code_addresses}");
    println!("string_address_operand_count={string_addresses}");
    println!("message_string_operand_count={messages}");
    println!("character_name_string_operand_count={character_names}");
    println!("choice_string_operand_count={choices}");
    println!("choice_function_call_count={choice_function_calls}");
    println!("internal_string_operand_count={internal_strings}");
    println!("user_function_call_count={user_function_calls}");
    println!("user_function_string_arg_operand_count={user_function_string_args}");
    println!("max_user_function_string_args={max_user_function_string_args}");
    println!("max_string_stack_depth={max_stack_depth}");
    println!("largest_code_address={largest_code_address}");
    println!("system_instruction_count={system_instruction_count}");
    println!("system_reachable_code_bytes={system_code_bytes}");
    println!("system_string_operand_count={system_string_operands}");
    println!("system_jump_count={system_jumps}");
    println!("system_conditional_jump_count={system_conditional_jumps}");
    println!("system_call_count={system_calls}");
    println!("system_return_count={system_returns}");
    println!("system_syscall_count={system_syscalls}");
    println!("system_graphcall_count={system_graphcalls}");
    println!("system_soundcall_count={system_soundcalls}");
    println!("system_extcall_count={system_extcalls}");
    println!("system_user_script_call_count={system_user_script_calls}");
    println!("system_truncated_tail_block_count={system_truncated_tail_blocks}");
    println!("system_invalid_opcode_block_count={system_invalid_opcode_blocks}");
    println!("system_invalid_target_block_count={system_invalid_target_blocks}");
    println!("system_invalid_jump_block_count={system_invalid_jump_blocks}");
    println!("system_invalid_string_target_block_count={system_invalid_string_target_blocks}");
    Ok(())
}

fn audit_scenario_opcodes(game_dir: &Path, prefix: Option<&str>) -> Result<()> {
    let archive_paths = collect_archive_files(game_dir)?;
    let mut canonical = BTreeMap::<Vec<u8>, Vec<u8>>::new();
    let normalized_prefix = prefix.map(|value| value.as_bytes().to_ascii_lowercase());

    for path in &archive_paths {
        let data = fs::read(path)?;
        let archive = ArcArchive::parse(&data)?;
        for entry in archive.entries() {
            let name = entry.name.as_bytes();
            if normalized_prefix
                .as_deref()
                .is_some_and(|want| !name.to_ascii_lowercase().starts_with(want))
            {
                continue;
            }
            let payload = archive.entry_data(entry)?;
            if sniff_payload(payload) != PayloadKind::Dsc {
                continue;
            }
            let decompressed = decompress_dsc(payload)?;
            if is_buriko_script_v1(&decompressed) {
                canonical.insert(name.to_ascii_lowercase(), decompressed);
            }
        }
    }

    let mut aggregate = BTreeMap::<u32, usize>::new();
    let mut error_count = 0usize;
    let mut function_library_count = 0usize;
    println!("scenario_opcode_audit_version=1");
    println!("scenario_count={}", canonical.len());
    for (name, data) in canonical {
        let program = match ScenarioProgram::parse(&data) {
            Ok(program) => program,
            Err(error) => {
                error_count += 1;
                println!("scenario={} error={error}", String::from_utf8_lossy(&name));
                continue;
            }
        };
        if name.eq_ignore_ascii_case(b"yuzu_2g") {
            function_library_count += 1;
            println!(
                "scenario={} kind=function-library labels={}",
                String::from_utf8_lossy(&name),
                program.labels()?.len()
            );
            continue;
        }
        let histogram = match ScenarioVm::new(program).opcode_histogram() {
            Ok(histogram) => histogram,
            Err(error) => {
                error_count += 1;
                println!("scenario={} error={error}", String::from_utf8_lossy(&name));
                continue;
            }
        };
        let commands = histogram
            .iter()
            .filter(|(opcode, _)| (0x0100..=0x03ff).contains(*opcode))
            .map(|(opcode, count)| {
                *aggregate.entry(*opcode).or_default() += count;
                format!("0x{opcode:04x}:{count}")
            })
            .collect::<Vec<_>>()
            .join(",");
        println!(
            "scenario={} commands={commands}",
            String::from_utf8_lossy(&name)
        );
    }
    println!("scenario_function_library_count={function_library_count}");
    println!("scenario_error_count={error_count}");
    let aggregate = aggregate
        .into_iter()
        .map(|(opcode, count)| format!("0x{opcode:04x}:{count}"))
        .collect::<Vec<_>>()
        .join(",");
    println!("aggregate_commands={aggregate}");
    Ok(())
}

fn audit_scenario_command(game_dir: &Path, scenario_name: &str, opcode: u32) -> Result<()> {
    if !(0x0100..=0x03ff).contains(&opcode) {
        return Err(SakuraError::UnsupportedFormat(
            "scenario command opcode must be in 0x0100..=0x03ff".to_owned(),
        )
        .into());
    }
    let script = load_scenario_script(game_dir, scenario_name)?;
    let program = ScenarioProgram::parse(&script)?;
    let mut vm = ScenarioVm::new(program);
    let mut event_index = 0usize;
    let mut match_count = 0usize;
    println!("scenario_command_audit_version=2");
    println!("scenario={scenario_name}");
    println!("opcode=0x{opcode:04x}");
    loop {
        let event = vm.next_event()?;
        event_index += 1;
        match &event {
            ScenarioEvent::Graph(command) if command.opcode == opcode => {
                print_scenario_command_match(
                    match_count,
                    event_index,
                    command.offset,
                    &command.int_args,
                    &command.string_args,
                    &command.array_args,
                );
                match_count += 1;
            }
            ScenarioEvent::Sound(command) if command.opcode == opcode => {
                print_scenario_command_match(
                    match_count,
                    event_index,
                    command.offset,
                    &command.int_args,
                    &command.string_args,
                    &[],
                );
                match_count += 1;
            }
            ScenarioEvent::Halted => break,
            _ => {}
        }
    }
    println!("match_count={match_count}");
    Ok(())
}

fn audit_scenario_controls(game_dir: &Path, scenario_name: &str) -> Result<()> {
    let script = load_scenario_script(game_dir, scenario_name)?;
    let program = ScenarioProgram::parse(&script)?;
    let commands = ScenarioVm::new(program).control_command_trace()?;
    println!("scenario_control_audit_version=1");
    println!("scenario={scenario_name}");
    println!("command_count={}", commands.len());
    for (index, command) in commands.iter().enumerate() {
        println!(
            "command={index} opcode=0x{:04x} offset=0x{:x} ints=[{}] strings=[{}]",
            command.opcode,
            command.offset,
            format_i32_args(&command.int_args),
            format_string_args(&command.string_args),
        );
    }
    Ok(())
}

fn scenario_byte_window(
    game_dir: &Path,
    scenario_name: &str,
    offset: usize,
    word_count: usize,
) -> Result<()> {
    let script = load_scenario_script(game_dir, scenario_name)?;
    if offset >= script.len() {
        return Err(SakuraError::UnsupportedFormat(format!(
            "scenario offset 0x{offset:x} is outside {} bytes",
            script.len()
        ))
        .into());
    }
    let half = word_count / 2;
    let start = offset.saturating_sub(half * 4) & !3;
    let end = start.saturating_add(word_count * 4).min(script.len() & !3);
    println!("scenario_byte_window_version=1");
    println!("scenario={scenario_name}");
    println!("target=0x{offset:x}");
    println!("start=0x{start:x}");
    println!("end=0x{end:x}");
    for cursor in (start..end).step_by(4) {
        let value = u32::from_le_bytes([
            script[cursor],
            script[cursor + 1],
            script[cursor + 2],
            script[cursor + 3],
        ]);
        let marker = if cursor == offset { "*" } else { " " };
        println!("{marker}0x{cursor:08x}: 0x{value:08x}");
    }
    Ok(())
}

fn scenario_event_window(
    game_dir: &Path,
    scenario_name: &str,
    start_event: usize,
    count: usize,
) -> Result<()> {
    let script = load_scenario_script(game_dir, scenario_name)?;
    let program = ScenarioProgram::parse(&script)?;
    let mut vm = ScenarioVm::new(program);
    let end_event = start_event.saturating_add(count);
    let mut event_index = 0usize;
    println!("scenario_event_window_version=1");
    println!("scenario={scenario_name}");
    println!("start_event={start_event}");
    println!("count={count}");
    loop {
        let event = vm.next_event()?;
        event_index += 1;
        if event_index >= start_event && event_index < end_event {
            match &event {
                ScenarioEvent::Message(message) => println!(
                    "event={event_index} kind=message opcode=0x{:04x} offset=0x{:x} ints=[{}] name={} text={}",
                    message.opcode,
                    message.offset,
                    format_i32_args(&message.int_args),
                    message
                        .name
                        .map(|value| format_string_excerpt(value, 32))
                        .unwrap_or_else(|| "\"\"".to_owned()),
                    format_string_excerpt(message.text, 72),
                ),
                ScenarioEvent::Choice(choice) => println!(
                    "event={event_index} kind=choice opcode=0x{:04x} offset=0x{:x} ints=[{}] options={}",
                    choice.opcode,
                    choice.offset,
                    format_i32_args(&choice.int_args),
                    format_string_args(&choice.options),
                ),
                ScenarioEvent::UserFunction(function) => println!(
                    "event={event_index} kind=user offset=0x{:x} ints=[{}] name={} strings=[{}]",
                    function.offset,
                    format_i32_args(&function.int_args),
                    format_string_excerpt(function.name, 48),
                    format_string_args(&function.string_args),
                ),
                ScenarioEvent::Graph(command) => println!(
                    "event={event_index} kind=graph opcode=0x{:04x} offset=0x{:x} ints=[{}] strings=[{}] arrays={}",
                    command.opcode,
                    command.offset,
                    format_i32_args(&command.int_args),
                    format_string_args(&command.string_args),
                    command.array_args.len(),
                ),
                ScenarioEvent::Sound(command) => println!(
                    "event={event_index} kind=sound opcode=0x{:04x} offset=0x{:x} ints=[{}] strings=[{}]",
                    command.opcode,
                    command.offset,
                    format_i32_args(&command.int_args),
                    format_string_args(&command.string_args),
                ),
                ScenarioEvent::Wait(wait) => println!(
                    "event={event_index} kind=wait opcode=0x{:04x} offset=0x{:x} duration_ms={}",
                    wait.opcode, wait.offset, wait.duration_ms,
                ),
                ScenarioEvent::MessageControl(control) => println!(
                    "event={event_index} kind=message-control opcode=0x{:04x} offset=0x{:x} duration_ms={}",
                    control.opcode, control.offset, control.duration_ms,
                ),
                ScenarioEvent::Halted => println!("event={event_index} kind=halted"),
            }
        }
        if matches!(event, ScenarioEvent::Halted) || event_index + 1 >= end_event {
            break;
        }
    }
    Ok(())
}

fn audit_scenario_labels(
    game_dir: &Path,
    scenario_name: &str,
    name_filter: Option<&str>,
) -> Result<()> {
    let script = load_scenario_script(game_dir, scenario_name)?;
    let program = ScenarioProgram::parse(&script)?;
    let normalized_filter = name_filter.map(|value| value.to_ascii_lowercase());
    let labels = program.labels()?;
    println!("scenario_label_audit_version=1");
    println!("scenario={scenario_name}");
    println!("label_count={}", labels.len());
    for label in labels {
        let printable = String::from_utf8_lossy(label.name);
        if normalized_filter
            .as_deref()
            .is_some_and(|filter| !printable.to_ascii_lowercase().contains(filter))
        {
            continue;
        }
        println!(
            "label={} offset=0x{:x} file_offset=0x{:x}",
            printable,
            label.offset,
            program.entry_offset() + label.offset
        );
    }
    Ok(())
}

fn load_scenario_script(game_dir: &Path, scenario_name: &str) -> Result<Vec<u8>> {
    let wanted = scenario_name.as_bytes().to_ascii_lowercase();
    let mut script = None;
    for path in collect_archive_files(game_dir)? {
        let data = fs::read(path)?;
        let archive = ArcArchive::parse(&data)?;
        for entry in archive.entries() {
            if entry.name.as_bytes().to_ascii_lowercase() != wanted {
                continue;
            }
            let payload = archive.entry_data(entry)?;
            if sniff_payload(payload) != PayloadKind::Dsc {
                continue;
            }
            let decompressed = decompress_dsc(payload)?;
            if is_buriko_script_v1(&decompressed) {
                script = Some(decompressed);
            }
        }
    }
    script.ok_or_else(|| {
        SakuraError::UnsupportedFormat(format!("scenario script not found: {scenario_name}")).into()
    })
}

fn format_i32_args(values: &[i32]) -> String {
    values
        .iter()
        .map(i32::to_string)
        .collect::<Vec<_>>()
        .join(",")
}

fn format_string_args(values: &[&[u8]]) -> String {
    values
        .iter()
        .map(|value| format_string_excerpt(value, 64))
        .collect::<Vec<_>>()
        .join(",")
}

fn print_scenario_command_match(
    match_index: usize,
    event_index: usize,
    offset: usize,
    int_args: &[i32],
    string_args: &[&[u8]],
    array_args: &[ScenarioArrayArg],
) {
    let ints = format_i32_args(int_args);
    let strings = format_string_args(string_args);
    println!(
        "match={match_index} event={event_index} offset=0x{offset:x} ints=[{ints}] strings=[{strings}] arrays={}",
        array_args.len()
    );
    for (array_index, array) in array_args.iter().enumerate() {
        println!(
            " array={array_index} arg_index={} address=0x{:08x} bytes={}",
            array.index,
            array.address,
            array.bytes.len()
        );
        for (motion_index, motion) in array.bytes.chunks_exact(0x120).enumerate() {
            let coordinate_count = read_i32_slice(motion, 0).unwrap_or(0).clamp(0, 16) as usize;
            let field04 = read_i32_slice(motion, 0x04).unwrap_or(0);
            let field08 = read_i32_slice(motion, 0x08).unwrap_or(0);
            let field0c = read_i32_slice(motion, 0x0c).unwrap_or(0);
            let opacity = read_i32_slice(motion, 0x10).unwrap_or(0);
            let movement_mode = read_i32_slice(motion, 0x14).unwrap_or(0);
            let rotation_mode = read_i32_slice(motion, 0x18).unwrap_or(0);
            let duration_ms = read_i32_slice(motion, 0x1c).unwrap_or(0);
            let coordinates = (0..coordinate_count)
                .map(|coordinate_index| {
                    let base = 0x20 + coordinate_index * 0x10;
                    format!(
                        "{{x={},y={},z={},hold_ms={}}}",
                        read_i32_slice(motion, base).unwrap_or(0),
                        read_i32_slice(motion, base + 4).unwrap_or(0),
                        read_i32_slice(motion, base + 8).unwrap_or(0),
                        read_i32_slice(motion, base + 12).unwrap_or(0),
                    )
                })
                .collect::<Vec<_>>()
                .join(",");
            println!(
                "  motion={motion_index} coordinates={coordinate_count} field04={field04} field08={field08} field0c={field0c} transparency={opacity} movement_mode={movement_mode} rotation_mode={rotation_mode} duration_ms={duration_ms} points=[{coordinates}]"
            );
        }
    }
}

fn read_i32_slice(data: &[u8], offset: usize) -> Option<i32> {
    let bytes = data.get(offset..offset + 4)?;
    Some(i32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

fn parse_u32_arg(value: &str) -> Option<u32> {
    let trimmed = value.trim();
    if let Some(hex) = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
    {
        u32::from_str_radix(hex, 16).ok()
    } else {
        trimmed.parse::<u32>().ok()
    }
}

fn validate_cbg_streams(game_dir: &Path) -> Result<()> {
    let archive_paths = collect_archive_files(game_dir)?;
    let mut count = 0usize;
    let mut decoded_bytes = 0usize;

    for path in &archive_paths {
        let data = fs::read(path)?;
        let archive = ArcArchive::parse(&data)?;
        for entry in archive.entries() {
            let payload = archive.entry_data(entry)?;
            if sniff_payload(payload) != PayloadKind::CompressedBg {
                continue;
            }
            let decoded = decrypt_cbg_stream(payload)?;
            decoded_bytes += decoded.len();
            count += 1;
        }
    }

    println!("cbg_stream_validate_version=1");
    println!("compressed_bg_decrypted_count={count}");
    println!("compressed_bg_decrypted_bytes={decoded_bytes}");
    Ok(())
}

fn validate_cbg_v1_decode(game_dir: &Path) -> Result<()> {
    let archive_paths = collect_archive_files(game_dir)?;
    let mut count = 0usize;
    let mut pixel_bytes = 0usize;

    for path in &archive_paths {
        let data = fs::read(path)?;
        let archive = ArcArchive::parse(&data)?;
        for entry in archive.entries() {
            let payload = archive.entry_data(entry)?;
            if sniff_payload(payload) != PayloadKind::CompressedBg {
                continue;
            }
            let meta = read_cbg_metadata(payload)?;
            if meta.version >= 2 {
                continue;
            }
            let image = decode_cbg(payload)?;
            pixel_bytes += image.pixels.len();
            count += 1;
        }
    }

    println!("cbg_v1_decode_validate_version=1");
    println!("compressed_bg_v1_decoded_count={count}");
    println!("compressed_bg_v1_pixel_bytes={pixel_bytes}");
    Ok(())
}

fn validate_cbg_v2_decode(
    game_dir: &Path,
    limit: Option<usize>,
    progress_every: Option<usize>,
) -> Result<()> {
    let archive_paths = collect_archive_files(game_dir)?;
    let mut count = 0usize;
    let mut pixel_bytes = 0usize;

    'archives: for path in &archive_paths {
        let data = fs::read(path)?;
        let archive = ArcArchive::parse(&data)?;
        for entry in archive.entries() {
            let payload = archive.entry_data(entry)?;
            if sniff_payload(payload) != PayloadKind::CompressedBg {
                continue;
            }
            let meta = read_cbg_metadata(payload)?;
            if meta.version != 2 {
                continue;
            }
            let image = decode_cbg(payload)?;
            pixel_bytes += image.pixels.len();
            count += 1;
            if progress_every.is_some_and(|every| every > 0 && count % every == 0) {
                println!("progress_decoded_count={count}");
                println!("progress_pixel_bytes={pixel_bytes}");
            }
            if limit.is_some_and(|limit| count >= limit) {
                break 'archives;
            }
        }
    }

    println!("cbg_v2_decode_validate_version=1");
    println!("compressed_bg_v2_decoded_count={count}");
    println!("compressed_bg_v2_pixel_bytes={pixel_bytes}");
    if let Some(limit) = limit {
        println!("limit={limit}");
    }
    if let Some(progress_every) = progress_every {
        println!("progress_every={progress_every}");
    }
    Ok(())
}

fn validate_cbg_rgba(
    game_dir: &Path,
    limit: Option<usize>,
    progress_every: Option<usize>,
) -> Result<()> {
    let archive_paths = collect_archive_files(game_dir)?;
    let mut count = 0usize;
    let mut rgba_bytes = 0usize;
    let mut v1_count = 0usize;
    let mut v2_count = 0usize;

    'archives: for path in &archive_paths {
        let data = fs::read(path)?;
        let archive = ArcArchive::parse(&data)?;
        for entry in archive.entries() {
            let payload = archive.entry_data(entry)?;
            if sniff_payload(payload) != PayloadKind::CompressedBg {
                continue;
            }
            let meta = read_cbg_metadata(payload)?;
            let image = decode_cbg(payload)?;
            let rgba = cbg_to_rgba(&image)?;
            rgba_bytes += rgba.len();
            count += 1;
            if meta.version >= 2 {
                v2_count += 1;
            } else {
                v1_count += 1;
            }
            if progress_every.is_some_and(|every| every > 0 && count % every == 0) {
                println!("progress_rgba_decoded_count={count}");
                println!("progress_rgba_bytes={rgba_bytes}");
            }
            if limit.is_some_and(|limit| count >= limit) {
                break 'archives;
            }
        }
    }

    println!("cbg_rgba_validate_version=1");
    println!("compressed_bg_rgba_decoded_count={count}");
    println!("compressed_bg_rgba_v1_count={v1_count}");
    println!("compressed_bg_rgba_v2_count={v2_count}");
    println!("compressed_bg_rgba_bytes={rgba_bytes}");
    if let Some(limit) = limit {
        println!("limit={limit}");
    }
    if let Some(progress_every) = progress_every {
        println!("progress_every={progress_every}");
    }
    Ok(())
}

fn collect_files(root: &Path) -> Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    collect_files_inner(root, &mut files)?;
    files.sort();
    Ok(files)
}

fn collect_archive_files(root: &Path) -> Result<Vec<PathBuf>> {
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
    let hvl_path = root.join("BGI.hvl");
    if let Ok(data) = fs::read(hvl_path) {
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

fn collect_files_inner(path: &Path, files: &mut Vec<PathBuf>) -> Result<()> {
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

fn hex_signature(data: &[u8], width: usize) -> String {
    let mut out = String::with_capacity(width * 2);
    for byte in data.iter().take(width) {
        out.push(hex_digit(byte >> 4));
        out.push(hex_digit(byte & 0x0f));
    }
    out
}

fn hex_digit(nibble: u8) -> char {
    match nibble {
        0..=9 => (b'0' + nibble) as char,
        10..=15 => (b'a' + (nibble - 10)) as char,
        _ => '?',
    }
}

fn fnv1a64(data: &[u8]) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for byte in data {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

fn parse_hex_or_decimal(value: &str) -> std::result::Result<usize, std::num::ParseIntError> {
    if let Some(value) = value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))
    {
        usize::from_str_radix(value, 16)
    } else {
        value.parse()
    }
}

fn format_optional_offset(offset: usize) -> String {
    if offset == usize::MAX {
        "none".to_owned()
    } else {
        format!("0x{offset:x}")
    }
}

fn min_offset(offsets: &[usize; 256]) -> usize {
    offsets.iter().copied().min().unwrap_or(usize::MAX)
}

fn safe_instruction_label(kind: &SystemInstructionKind<'_>) -> String {
    match kind {
        SystemInstructionKind::PushU8(value) => format!("push8:{value}"),
        SystemInstructionKind::PushU16(value) => format!("push16:{value}"),
        SystemInstructionKind::PushU32(value) => format!("push32:{value}"),
        SystemInstructionKind::PushU64(_) => "push64".to_owned(),
        SystemInstructionKind::GetVariablePointer(offset) => format!("getvarptr:{}", offset),
        SystemInstructionKind::GetString { bytes, .. } => {
            format!("getstring:len{}", bytes.map_or(0, |bytes| bytes.len()))
        }
        SystemInstructionKind::GetCodeOffset { target, .. } => {
            format!("codeoffset:{}", format_optional_target(*target))
        }
        SystemInstructionKind::Branch { kind } => format!("branch:{kind:?}"),
        SystemInstructionKind::WidthOperand { width } => format!("width:{width}"),
        SystemInstructionKind::ArrayOperand { bytes } => format!("array:len{}", bytes.len()),
        SystemInstructionKind::ShortOperand(value) => {
            format!("short:width{}:count{}", value & 0xff, value >> 8)
        }
        SystemInstructionKind::ServiceCall {
            family, service_id, ..
        } => {
            format!("service:{family:?}:{service_id:02x}")
        }
        SystemInstructionKind::UserScript(op) => format!("userscript:{op:?}"),
        SystemInstructionKind::Return => "return".to_owned(),
        SystemInstructionKind::NoOperand => "op".to_owned(),
    }
}

fn instruction_string_excerpt(kind: &SystemInstructionKind<'_>) -> String {
    match kind {
        SystemInstructionKind::GetString { bytes, .. } => bytes.map_or_else(
            || "none".to_owned(),
            |bytes| format_string_excerpt(bytes, 48),
        ),
        _ => "none".to_owned(),
    }
}

fn format_string_excerpt(bytes: &[u8], limit: usize) -> String {
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
    format!("\"{text}\"#{}", fnv1a64(bytes))
}

fn format_optional_target(target: Option<usize>) -> String {
    target.map_or_else(|| "none".to_owned(), |target| format!("0x{target:x}"))
}

fn format_u16_counts(counts: &BTreeMap<u16, usize>) -> String {
    counts
        .iter()
        .map(|(key, value)| format!("{key}:{value}"))
        .collect::<Vec<_>>()
        .join(",")
}

fn format_u32_counts(counts: &BTreeMap<u32, usize>) -> String {
    counts
        .iter()
        .map(|(key, value)| format!("{key}:{value}"))
        .collect::<Vec<_>>()
        .join(",")
}
