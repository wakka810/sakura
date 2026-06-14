pub mod archive;
pub mod audio;
mod bytes;
pub mod catalog;
pub mod dsc;
pub mod error;
mod ffi;
pub mod flagdb;
pub mod image;
pub mod install_manifest;
mod movie_decoder;
pub mod render;
pub mod runtime;
mod runtime_graph;
mod runtime_handles;
mod runtime_input;
mod runtime_sound;
pub mod scenario;
mod scenario_probe;
mod scenario_session_api;
mod scenario_snapshot;
pub mod script;
pub mod script_library;
pub mod sdc;
pub mod session;
mod session_probe;
pub mod sniff;
pub mod system_bytecode;
mod system_host;
mod system_runtime;
mod system_script;
pub mod system_trace;
pub mod system_vm;
mod system_vm_ops;

pub use archive::{ArcArchive, ArcEntry, ArcIndex, ArcName, ArchiveKind};
pub use audio::{read_bgi_audio_metadata, unwrap_bgi_audio, BgiAudioMetadata};
pub use catalog::{
    ArchiveId, ArchiveSummary, AssetCatalog, AssetLocation, AssetRecord, DuplicatePolicy,
};
pub use dsc::{decompress_dsc, DSC_MAGIC};
pub use error::{Result, SakuraError};
pub use flagdb::{flag_name_hash, FlagDb, FlagError};
pub use image::{
    cbg_to_rgba, decode_cbg, decode_raw_bitmap, decrypt_cbg_stream, read_cbg_metadata, CbgImage,
    CbgMetadata, CbgPixelFormat, COMPRESSED_BG_MAGIC,
};
pub use install_manifest::InstallManifest;
pub use render::RgbaSurface;
pub use runtime::{Runtime, RuntimeConfig};
pub use runtime_input::RuntimeInputState;
pub use scenario::{
    summarize_scenario_events, ScenarioArrayArg, ScenarioChoice, ScenarioControlCommand,
    ScenarioEvent, ScenarioEventSummary, ScenarioGraphCommand, ScenarioLabel, ScenarioMessage,
    ScenarioMessageControl, ScenarioProgram, ScenarioSoundCommand, ScenarioUserFunction,
    ScenarioVm, ScenarioWait,
};
pub use script::{
    analyze_scenario_script, is_buriko_script_v1, ScriptSummary, ScriptVersion,
    BURIKO_SCRIPT_V1_MAGIC,
};
pub use script_library::{
    classify_dsc_script, LoadedScript, LoadedScriptKind, ScriptId, ScriptLibrary,
};
pub use sdc::{decompress_sdc, is_sdc, SDC_MAGIC};
pub use session::{
    BacklogEntry, PlayerConfig, ScenarioSession, SessionEvent, SessionMode, SessionSnapshot,
};
pub use sniff::{sniff_payload, PayloadKind};
pub use system_bytecode::{
    SystemBranchKind, SystemCallFamily, SystemInstruction, SystemInstructionKind, SystemProgram,
    SystemUserScriptOp,
};
pub use system_host::{
    default_service_result, default_system_event_result, run_system_vm_with_default_host,
    run_system_vm_with_host, SystemHost, SystemHostEffect, SystemHostEventKind,
    SystemHostLocalWrite, SystemHostResult, SystemHostRunSummary, SystemHostServiceState,
    SystemHostValue, SystemHostWrite,
};
pub use system_runtime::{
    run_system_runtime_with_host, SystemRuntime, SystemRuntimePendingAsset, SystemRuntimeSummary,
    SystemServiceTrace, SystemServiceTraceEvent, SystemVmEventOwned,
};
pub use system_script::{analyze_system_script, SystemScriptSummary};
pub use system_trace::{
    system_trace_unknown_source_label, system_trace_value_kind_label, trace_system_script,
    SystemTraceSourceValueCount, SystemTraceSummary, SystemTraceUnknownSourceCount,
};
pub use system_vm::{SystemValue, SystemVm, SystemVmEvent};

pub const ENGINE_ABI_VERSION: u32 = 1;
