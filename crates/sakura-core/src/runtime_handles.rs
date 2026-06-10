use std::collections::BTreeMap;
use std::sync::{Mutex, OnceLock};

use crate::archive::{ArcEntry, ArcIndex, ArcName};
use crate::error::{Result, SakuraError};
use crate::runtime::{Runtime, RuntimeConfig};
use crate::runtime_graph::{write_graph_queue_packet, RUNTIME_GRAPH_QUEUE_PACKET_LEN};
use crate::runtime_input::RuntimeInputState;
use crate::runtime_sound::{write_sound_queue_packet, RUNTIME_SOUND_QUEUE_PACKET_LEN};
use crate::system_host::{SystemAssetRequest, SystemHost};
use crate::system_runtime::{
    SystemRuntime, SystemRuntimePendingAsset, SystemRuntimeSnapshot, SystemServiceTrace,
    SystemVmEventOwned,
};

pub const RUNTIME_BOOT_PACKET_LEN: usize = 176;
pub const RUNTIME_SYSTEM_PROBE_PACKET_LEN: usize = 180;
pub const RUNTIME_SESSION_STEP_PACKET_LEN: usize = 240;
pub const RUNTIME_SERVICE_TRACE_EVENT_LEN: usize = 52;
pub const RUNTIME_SERVICE_TRACE_MAX_EVENTS: usize = 32;
const RUNTIME_HOST_STATE_PACKET_LEN: usize = 100;
const RUNTIME_SERVICE_TRACE_HOST_STATE_OFFSET: usize =
    40 + RUNTIME_SERVICE_TRACE_EVENT_LEN * RUNTIME_SERVICE_TRACE_MAX_EVENTS;
pub const RUNTIME_SERVICE_TRACE_PACKET_LEN: usize =
    RUNTIME_SERVICE_TRACE_HOST_STATE_OFFSET + RUNTIME_HOST_STATE_PACKET_LEN;
const MAX_BOOT_EVENTS: usize = 4096;
const MAX_SYSTEM_PROBE_EVENTS: usize = 4096;
const MAX_BOOT_INSTRUCTIONS_PER_EVENT: usize = 100_000;
const RUNTIME_QUEUE_TRACE_RECORD_LIMIT: usize = MAX_SYSTEM_PROBE_EVENTS;
const FFI_SIZE_ERROR: usize = usize::MAX;

static RUNTIME_STORE: OnceLock<Mutex<RuntimeStore>> = OnceLock::new();

#[derive(Debug)]
struct RuntimeStore {
    next_handle: u32,
    runtimes: BTreeMap<u32, Runtime>,
    bootstrap_states: BTreeMap<u32, SystemRuntimeSnapshot>,
    next_session_handle: u32,
    sessions: BTreeMap<u32, RuntimeSession>,
}

impl Default for RuntimeStore {
    fn default() -> Self {
        Self {
            next_handle: 1,
            runtimes: BTreeMap::new(),
            bootstrap_states: BTreeMap::new(),
            next_session_handle: 1,
            sessions: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RuntimeSession {
    runtime_handle: u32,
    state: SystemRuntimeSnapshot,
    last_service_trace_packet: Vec<u8>,
    last_sound_queue_packet: Vec<u8>,
    last_graph_queue_packet: Vec<u8>,
    pending_asset: Option<SystemAssetRequest>,
    pending_event: Option<SystemVmEventOwned>,
}

#[no_mangle]
pub extern "C" fn sakura_runtime_create() -> u32 {
    let Ok(mut store) = lock_store() else {
        return 0;
    };
    store
        .insert(Runtime::new(RuntimeConfig::default()))
        .unwrap_or(0)
}

#[no_mangle]
pub extern "C" fn sakura_runtime_destroy(handle: u32) -> u32 {
    let Ok(mut store) = lock_store() else {
        return 0;
    };
    store.bootstrap_states.remove(&handle);
    store.runtimes.remove(&handle).map_or(0, |_| 1)
}

#[no_mangle]
pub unsafe extern "C" fn sakura_runtime_mount_archive_manifest(
    handle: u32,
    name_ptr: *const u8,
    name_len: usize,
    ptr: *const u8,
    len: usize,
    archive_len: usize,
) -> u32 {
    let archive_name = if name_len == 0 {
        None
    } else {
        unsafe { slice_from_abi(name_ptr, name_len) }
    };
    let Some(data) = (unsafe { slice_from_abi(ptr, len) }) else {
        return 0;
    };
    mount_archive_manifest(handle, archive_name, data, archive_len).map_or(0, |_| 1)
}

#[no_mangle]
pub unsafe extern "C" fn sakura_runtime_mount_archive_data(
    handle: u32,
    name_ptr: *const u8,
    name_len: usize,
    ptr: *const u8,
    len: usize,
) -> u32 {
    let archive_name = if name_len == 0 {
        None
    } else {
        unsafe { slice_from_abi(name_ptr, name_len) }
    };
    let Some(data) = (unsafe { slice_from_abi(ptr, len) }) else {
        return 0;
    };
    mount_archive_data(handle, archive_name, data).map_or(0, |_| 1)
}

#[no_mangle]
pub unsafe extern "C" fn sakura_runtime_mount_dsc_script(
    handle: u32,
    name_ptr: *const u8,
    name_len: usize,
    payload_ptr: *const u8,
    payload_len: usize,
) -> u32 {
    let Some(name) = (unsafe { slice_from_abi(name_ptr, name_len) }) else {
        return 0;
    };
    let Some(payload) = (unsafe { slice_from_abi(payload_ptr, payload_len) }) else {
        return 0;
    };
    mount_dsc_script(handle, name, payload).map_or(0, |id| id.index() as u32 + 1)
}

#[no_mangle]
pub extern "C" fn sakura_runtime_boot_packet_len() -> usize {
    RUNTIME_BOOT_PACKET_LEN
}

#[no_mangle]
pub unsafe extern "C" fn sakura_runtime_script_index_by_name(
    handle: u32,
    name_ptr: *const u8,
    name_len: usize,
) -> u32 {
    let Some(name) = (unsafe { slice_from_abi(name_ptr, name_len) }) else {
        return 0;
    };
    let Ok(store) = lock_store() else {
        return 0;
    };
    let Ok(runtime) = store.runtime(handle) else {
        return 0;
    };
    runtime
        .script_index_by_name(name)
        .and_then(|index| u32::try_from(index).ok())
        .map_or(0, |index| index.saturating_add(1))
}

#[no_mangle]
pub unsafe extern "C" fn sakura_runtime_boot_write(
    handle: u32,
    out_ptr: *mut u8,
    out_len: usize,
) -> usize {
    let Some(out) = (unsafe { mutable_slice_from_abi(out_ptr, out_len) }) else {
        return FFI_SIZE_ERROR;
    };
    if out.len() < RUNTIME_BOOT_PACKET_LEN {
        return FFI_SIZE_ERROR;
    }
    let Ok(()) = write_boot_packet(handle, out) else {
        return FFI_SIZE_ERROR;
    };
    RUNTIME_BOOT_PACKET_LEN
}

#[no_mangle]
pub extern "C" fn sakura_runtime_system_probe_packet_len() -> usize {
    RUNTIME_SYSTEM_PROBE_PACKET_LEN
}

#[no_mangle]
pub unsafe extern "C" fn sakura_runtime_system_probe_write(
    handle: u32,
    script_index: usize,
    offset: usize,
    out_ptr: *mut u8,
    out_len: usize,
) -> usize {
    let Some(out) = (unsafe { mutable_slice_from_abi(out_ptr, out_len) }) else {
        return FFI_SIZE_ERROR;
    };
    if out.len() < RUNTIME_SYSTEM_PROBE_PACKET_LEN {
        return FFI_SIZE_ERROR;
    }
    let Ok(()) = write_system_probe_packet(handle, script_index, offset, out) else {
        return FFI_SIZE_ERROR;
    };
    RUNTIME_SYSTEM_PROBE_PACKET_LEN
}

#[no_mangle]
pub extern "C" fn sakura_runtime_service_trace_packet_len() -> usize {
    RUNTIME_SERVICE_TRACE_PACKET_LEN
}

#[no_mangle]
pub unsafe extern "C" fn sakura_runtime_service_trace_write(
    handle: u32,
    script_index: usize,
    offset: usize,
    max_services: usize,
    out_ptr: *mut u8,
    out_len: usize,
) -> usize {
    let Some(out) = (unsafe { mutable_slice_from_abi(out_ptr, out_len) }) else {
        return FFI_SIZE_ERROR;
    };
    if out.len() < RUNTIME_SERVICE_TRACE_PACKET_LEN {
        return FFI_SIZE_ERROR;
    }
    let Ok(()) = write_service_trace_packet(handle, script_index, offset, max_services, out) else {
        return FFI_SIZE_ERROR;
    };
    RUNTIME_SERVICE_TRACE_PACKET_LEN
}

#[no_mangle]
pub extern "C" fn sakura_runtime_sound_queue_packet_len() -> usize {
    RUNTIME_SOUND_QUEUE_PACKET_LEN
}

#[no_mangle]
pub extern "C" fn sakura_runtime_graph_queue_packet_len() -> usize {
    RUNTIME_GRAPH_QUEUE_PACKET_LEN
}

#[no_mangle]
pub unsafe extern "C" fn sakura_runtime_sound_queue_write(
    handle: u32,
    script_index: usize,
    offset: usize,
    out_ptr: *mut u8,
    out_len: usize,
) -> usize {
    let Some(out) = (unsafe { mutable_slice_from_abi(out_ptr, out_len) }) else {
        return FFI_SIZE_ERROR;
    };
    if out.len() < RUNTIME_SOUND_QUEUE_PACKET_LEN {
        return FFI_SIZE_ERROR;
    }
    let Ok(()) = write_runtime_sound_queue_packet(handle, script_index, offset, out) else {
        return FFI_SIZE_ERROR;
    };
    RUNTIME_SOUND_QUEUE_PACKET_LEN
}

#[no_mangle]
pub unsafe extern "C" fn sakura_runtime_graph_queue_write(
    handle: u32,
    script_index: usize,
    offset: usize,
    out_ptr: *mut u8,
    out_len: usize,
) -> usize {
    let Some(out) = (unsafe { mutable_slice_from_abi(out_ptr, out_len) }) else {
        return FFI_SIZE_ERROR;
    };
    if out.len() < RUNTIME_GRAPH_QUEUE_PACKET_LEN {
        return FFI_SIZE_ERROR;
    }
    let Ok(()) = write_runtime_graph_queue_packet(handle, script_index, offset, out) else {
        return FFI_SIZE_ERROR;
    };
    RUNTIME_GRAPH_QUEUE_PACKET_LEN
}

#[no_mangle]
pub extern "C" fn sakura_runtime_session_step_packet_len() -> usize {
    RUNTIME_SESSION_STEP_PACKET_LEN
}

#[no_mangle]
pub extern "C" fn sakura_runtime_set_input(
    handle: u32,
    click_count: u32,
    key_press_count: u32,
    pointer_x: u32,
    pointer_y: u32,
    pointer_button: u32,
    pointer_valid: u32,
    key_enter_down: u32,
    key_space_down: u32,
    key_up_down: u32,
    key_down_down: u32,
    key_left_down: u32,
    key_right_down: u32,
) -> u32 {
    let Ok(mut store) = lock_store() else {
        return 0;
    };
    let Ok(runtime) = store.runtime_mut(handle) else {
        return 0;
    };
    runtime.set_input(RuntimeInputState {
        click_count,
        key_press_count,
        pointer_x,
        pointer_y,
        pointer_button,
        pointer_valid: pointer_valid != 0,
        key_enter_down: key_enter_down != 0,
        key_space_down: key_space_down != 0,
        key_up_down: key_up_down != 0,
        key_down_down: key_down_down != 0,
        key_left_down: key_left_down != 0,
        key_right_down: key_right_down != 0,
    });
    1
}

#[no_mangle]
pub extern "C" fn sakura_runtime_session_destroy(handle: u32) -> u32 {
    let Ok(mut store) = lock_store() else {
        return 0;
    };
    store.sessions.remove(&handle).map_or(0, |_| 1)
}

#[no_mangle]
pub extern "C" fn sakura_runtime_session_create(
    runtime_handle: u32,
    script_index: usize,
    offset: usize,
) -> u32 {
    let Ok(mut store) = lock_store() else {
        return 0;
    };
    let state = {
        let Some(runtime) = store.runtimes.get(&runtime_handle) else {
            return 0;
        };
        let scripts = runtime.scripts();
        let Some(entry) = scripts.id_from_index(script_index) else {
            return 0;
        };
        let mut system_runtime = match store.bootstrap_states.get(&runtime_handle).cloned() {
            Some(snapshot) => match SystemRuntime::restore(runtime, snapshot) {
                Ok(runtime) => runtime,
                Err(_) => {
                    let host = SystemHost::with_runtime(runtime);
                    SystemRuntime::new(scripts, host)
                }
            },
            None => {
                let host = SystemHost::with_runtime(runtime);
                SystemRuntime::new(scripts, host)
            }
        };
        let offset = if offset == usize::MAX {
            None
        } else {
            Some(offset)
        };
        if system_runtime
            .push_script_at(entry, offset, Vec::new())
            .is_err()
        {
            return 0;
        }
        system_runtime.snapshot()
    };
    let sound_queue_packet = empty_runtime_sound_queue_packet(
        script_index,
        if offset == usize::MAX {
            None
        } else {
            Some(offset)
        },
    );
    let service_trace_packet = empty_runtime_service_trace_packet(
        script_index,
        if offset == usize::MAX {
            None
        } else {
            Some(offset)
        },
    );
    let graph_queue_packet = empty_runtime_graph_queue_packet(
        script_index,
        if offset == usize::MAX {
            None
        } else {
            Some(offset)
        },
    );
    let Ok(handle) = store.insert_session(RuntimeSession {
        runtime_handle,
        state,
        last_service_trace_packet: service_trace_packet,
        last_sound_queue_packet: sound_queue_packet,
        last_graph_queue_packet: graph_queue_packet,
        pending_asset: None,
        pending_event: None,
    }) else {
        return 0;
    };
    handle
}

#[no_mangle]
pub extern "C" fn sakura_runtime_session_pending_asset_len(handle: u32) -> usize {
    let Ok(store) = lock_store() else {
        return 0;
    };
    let Some(session) = store.sessions.get(&handle) else {
        return 0;
    };
    session
        .pending_asset
        .as_ref()
        .map_or(0, |request| 16usize.saturating_add(request.name.len()))
}

#[no_mangle]
pub unsafe extern "C" fn sakura_runtime_session_pending_asset_write(
    handle: u32,
    out_ptr: *mut u8,
    out_len: usize,
) -> usize {
    let Some(out) = (unsafe { mutable_slice_from_abi(out_ptr, out_len) }) else {
        return FFI_SIZE_ERROR;
    };
    let Ok(store) = lock_store() else {
        return FFI_SIZE_ERROR;
    };
    let Some(session) = store.sessions.get(&handle) else {
        return FFI_SIZE_ERROR;
    };
    let Some(request) = session.pending_asset.as_ref() else {
        return 0;
    };
    let packet_len = 16usize.saturating_add(request.name.len());
    if out.len() < packet_len {
        return FFI_SIZE_ERROR;
    }
    out[..packet_len].fill(0);
    write_u32(out, 0, 1);
    write_u32(out, 4, u32::from(request.service_id));
    write_u32(out, 8, request.size);
    write_u32(out, 12, request.name.len().min(u32::MAX as usize) as u32);
    out[16..16 + request.name.len()].copy_from_slice(&request.name);
    packet_len
}

#[no_mangle]
pub unsafe extern "C" fn sakura_runtime_session_supply_asset(
    handle: u32,
    name_ptr: *const u8,
    name_len: usize,
    payload_ptr: *const u8,
    payload_len: usize,
) -> u32 {
    let Some(name) = (unsafe { slice_from_abi(name_ptr, name_len) }) else {
        return 0;
    };
    let Some(payload) = (unsafe { slice_from_abi(payload_ptr, payload_len) }) else {
        return 0;
    };
    let Ok(mut store) = lock_store() else {
        return 0;
    };
    let session = match store.sessions.get(&handle).cloned() {
        Some(session) => session,
        None => return 0,
    };
    let Some(request) = session.pending_asset.as_ref() else {
        return 0;
    };
    if request.name.as_slice() != name {
        return 0;
    }
    let Some(pending_event) = session.pending_event.clone() else {
        return 0;
    };
    if request.service_id == 0x40 {
        let runtime = match store.runtime_mut(session.runtime_handle) {
            Ok(runtime) => runtime,
            Err(_) => return 0,
        };
        if runtime.mount_dsc_script_payload(name, payload).is_err() {
            return 0;
        }
    }
    let runtime = match store.runtime(session.runtime_handle) {
        Ok(runtime) => runtime,
        Err(_) => return 0,
    };
    let mut system_runtime = match SystemRuntime::restore(runtime, session.state.clone()) {
        Ok(runtime) => runtime,
        Err(_) => return 0,
    };
    if request.service_id != 0x40 {
        system_runtime
            .host_mut_for_session_supply()
            .cache_asset_bytes(name, payload.to_vec());
    }
    if system_runtime.resume_pending_event(pending_event).is_err() {
        return 0;
    }
    let snapshot = system_runtime.snapshot();
    let Some(session_mut) = store.sessions.get_mut(&handle) else {
        return 0;
    };
    session_mut.state = snapshot;
    session_mut.pending_asset = None;
    session_mut.pending_event = None;
    1
}

#[no_mangle]
pub unsafe extern "C" fn sakura_runtime_session_step_write(
    handle: u32,
    max_events: usize,
    max_instructions_per_event: usize,
    out_ptr: *mut u8,
    out_len: usize,
) -> usize {
    let Some(out) = (unsafe { mutable_slice_from_abi(out_ptr, out_len) }) else {
        return FFI_SIZE_ERROR;
    };
    if out.len() < RUNTIME_SESSION_STEP_PACKET_LEN {
        return FFI_SIZE_ERROR;
    }
    let Ok(()) =
        write_runtime_session_step_packet(handle, max_events, max_instructions_per_event, out)
    else {
        return FFI_SIZE_ERROR;
    };
    RUNTIME_SESSION_STEP_PACKET_LEN
}

#[no_mangle]
pub unsafe extern "C" fn sakura_runtime_session_sound_queue_write(
    handle: u32,
    out_ptr: *mut u8,
    out_len: usize,
) -> usize {
    let Some(out) = (unsafe { mutable_slice_from_abi(out_ptr, out_len) }) else {
        return FFI_SIZE_ERROR;
    };
    if out.len() < RUNTIME_SOUND_QUEUE_PACKET_LEN {
        return FFI_SIZE_ERROR;
    }
    let Ok(store) = lock_store() else {
        return FFI_SIZE_ERROR;
    };
    let Some(session) = store.sessions.get(&handle) else {
        return FFI_SIZE_ERROR;
    };
    if session.last_sound_queue_packet.len() != RUNTIME_SOUND_QUEUE_PACKET_LEN {
        return FFI_SIZE_ERROR;
    }
    out[..RUNTIME_SOUND_QUEUE_PACKET_LEN].copy_from_slice(&session.last_sound_queue_packet);
    RUNTIME_SOUND_QUEUE_PACKET_LEN
}

#[no_mangle]
pub unsafe extern "C" fn sakura_runtime_session_service_trace_write(
    handle: u32,
    out_ptr: *mut u8,
    out_len: usize,
) -> usize {
    let Some(out) = (unsafe { mutable_slice_from_abi(out_ptr, out_len) }) else {
        return FFI_SIZE_ERROR;
    };
    if out.len() < RUNTIME_SERVICE_TRACE_PACKET_LEN {
        return FFI_SIZE_ERROR;
    }
    let Ok(store) = lock_store() else {
        return FFI_SIZE_ERROR;
    };
    let Some(session) = store.sessions.get(&handle) else {
        return FFI_SIZE_ERROR;
    };
    if session.last_service_trace_packet.len() != RUNTIME_SERVICE_TRACE_PACKET_LEN {
        return FFI_SIZE_ERROR;
    }
    out[..RUNTIME_SERVICE_TRACE_PACKET_LEN].copy_from_slice(&session.last_service_trace_packet);
    RUNTIME_SERVICE_TRACE_PACKET_LEN
}

#[no_mangle]
pub unsafe extern "C" fn sakura_runtime_session_graph_queue_write(
    handle: u32,
    out_ptr: *mut u8,
    out_len: usize,
) -> usize {
    let Some(out) = (unsafe { mutable_slice_from_abi(out_ptr, out_len) }) else {
        return FFI_SIZE_ERROR;
    };
    if out.len() < RUNTIME_GRAPH_QUEUE_PACKET_LEN {
        return FFI_SIZE_ERROR;
    }
    let Ok(store) = lock_store() else {
        return FFI_SIZE_ERROR;
    };
    let Some(session) = store.sessions.get(&handle) else {
        return FFI_SIZE_ERROR;
    };
    if session.last_graph_queue_packet.len() != RUNTIME_GRAPH_QUEUE_PACKET_LEN {
        return FFI_SIZE_ERROR;
    }
    out[..RUNTIME_GRAPH_QUEUE_PACKET_LEN].copy_from_slice(&session.last_graph_queue_packet);
    RUNTIME_GRAPH_QUEUE_PACKET_LEN
}

#[no_mangle]
pub extern "C" fn sakura_runtime_session_memory_len(handle: u32, address: u32, len: usize) -> usize {
    runtime_session_memory(handle, address, len).map_or(0, |bytes| bytes.len())
}

#[no_mangle]
pub unsafe extern "C" fn sakura_runtime_session_memory_write(
    handle: u32,
    address: u32,
    len: usize,
    out_ptr: *mut u8,
    out_len: usize,
) -> usize {
    let Some(out) = (unsafe { mutable_slice_from_abi(out_ptr, out_len) }) else {
        return FFI_SIZE_ERROR;
    };
    let Some(bytes) = runtime_session_memory(handle, address, len) else {
        return FFI_SIZE_ERROR;
    };
    if out.len() < bytes.len() {
        return FFI_SIZE_ERROR;
    }
    out[..bytes.len()].copy_from_slice(&bytes);
    bytes.len()
}

fn mount_archive_manifest(
    handle: u32,
    archive_name: Option<&[u8]>,
    manifest: &[u8],
    archive_len: usize,
) -> Result<()> {
    let mut store = lock_store()?;
    let runtime = store.runtime_mut(handle)?;
    let index = parse_archive_manifest(manifest, archive_len)?;
    runtime.mount_archive_index_named(index, archive_name)?;
    Ok(())
}

fn mount_archive_data(handle: u32, archive_name: Option<&[u8]>, data: &[u8]) -> Result<()> {
    let mut store = lock_store()?;
    let runtime = store.runtime_mut(handle)?;
    runtime.mount_archive_data_named(data.to_vec(), archive_name)?;
    Ok(())
}

fn mount_dsc_script(handle: u32, name: &[u8], payload: &[u8]) -> Result<crate::ScriptId> {
    let mut store = lock_store()?;
    let runtime = store.runtime_mut(handle)?;
    runtime.mount_dsc_script_payload(name, payload)
}

fn write_boot_packet(handle: u32, out: &mut [u8]) -> Result<()> {
    let runtime = {
        let store = lock_store()?;
        store.runtime(handle)?.clone()
    };
    let scripts = runtime.scripts();
    let entry = scripts.find_by_name_bytes(b"ipl._bp").ok_or_else(|| {
        SakuraError::InvalidRuntime("runtime bootstrap script ipl._bp is missing".to_owned())
    })?;
    let host = SystemHost::with_runtime(&runtime);
    let mut system_runtime = SystemRuntime::new(scripts, host);
    system_runtime.push_script(entry, Vec::new())?;
    let summary = system_runtime.run(MAX_BOOT_EVENTS, MAX_BOOT_INSTRUCTIONS_PER_EVENT)?;
    let snapshot = system_runtime.snapshot();

    {
        let mut store = lock_store()?;
        store.bootstrap_states.insert(handle, snapshot);
    }

    out[..RUNTIME_BOOT_PACKET_LEN].fill(0);
    write_u32(out, 0, 1);
    write_u32(out, 4, entry.index() as u32);
    write_u32(out, 8, scripts.script_count() as u32);
    write_u32(out, 12, scripts.system_script_count() as u32);
    write_u32(out, 16, scripts.scenario_script_count() as u32);
    write_u32(out, 20, runtime.catalog().asset_count() as u32);
    write_u32(out, 24, runtime.catalog().canonical_asset_count() as u32);
    write_u32(out, 28, summary.event_count as u32);
    write_u32(out, 32, summary.service_event_count as u32);
    write_u32(out, 36, summary.user_call_event_count as u32);
    write_u32(out, 40, summary.user_load_event_count as u32);
    write_u32(out, 44, summary.user_return_event_count as u32);
    write_u32(out, 48, u32::from(summary.completed));
    write_u32(out, 52, u32::from(summary.event_limited));
    write_u32(out, 56, summary.max_call_depth as u32);
    write_u32(out, 60, summary.syscall_service_counts[0x40] as u32);
    write_u32(out, 64, summary.graphcall_service_counts[0x88] as u32);
    write_u32(out, 68, summary.graphcall_service_counts[0x9c] as u32);
    write_u32(
        out,
        72,
        summary.soundcall_service_counts.iter().sum::<usize>() as u32,
    );
    write_host_state(out, 76, &summary.host_state);
    Ok(())
}

fn write_system_probe_packet(
    handle: u32,
    script_index: usize,
    offset: usize,
    out: &mut [u8],
) -> Result<()> {
    let store = lock_store()?;
    let runtime = store.runtime(handle)?;
    let scripts = runtime.scripts();
    let entry = scripts.id_from_index(script_index).ok_or_else(|| {
        SakuraError::InvalidRuntime("runtime system probe script index is invalid".to_owned())
    })?;
    let host = SystemHost::with_runtime(runtime);
    let mut system_runtime = SystemRuntime::new(scripts, host);
    system_runtime.push_script_at(entry, Some(offset), Vec::new())?;
    let summary = system_runtime.run(MAX_SYSTEM_PROBE_EVENTS, MAX_BOOT_INSTRUCTIONS_PER_EVENT)?;

    out[..RUNTIME_SYSTEM_PROBE_PACKET_LEN].fill(0);
    write_u32(out, 0, 1);
    write_u32(out, 4, script_index as u32);
    write_u32(out, 8, offset as u32);
    write_u32(out, 12, scripts.script_count() as u32);
    write_u32(out, 16, scripts.system_script_count() as u32);
    write_u32(out, 20, scripts.scenario_script_count() as u32);
    write_u32(out, 24, summary.event_count as u32);
    write_u32(out, 28, summary.service_event_count as u32);
    write_u32(out, 32, summary.user_call_event_count as u32);
    write_u32(out, 36, summary.user_return_event_count as u32);
    write_u32(out, 40, u32::from(summary.completed));
    write_u32(out, 44, u32::from(summary.event_limited));
    write_u32(out, 48, summary.graphcall_service_counts[0x88] as u32);
    write_u32(out, 52, summary.graphcall_service_counts[0x9c] as u32);
    write_u32(
        out,
        56,
        summary.soundcall_service_counts.iter().sum::<usize>() as u32,
    );
    write_u32(out, 60, summary.max_call_depth as u32);
    write_u32(out, 64, summary.first_graph88_arg_count as u32);
    write_u32(out, 68, u32::from(summary.first_graph88_top_kind));
    write_u32(out, 72, summary.first_graph9c_arg_count as u32);
    write_u32(out, 76, u32::from(summary.first_graph9c_top_kind));
    write_host_state(out, 80, &summary.host_state);
    Ok(())
}

fn write_service_trace_packet(
    handle: u32,
    script_index: usize,
    offset: usize,
    max_services: usize,
    out: &mut [u8],
) -> Result<()> {
    let store = lock_store()?;
    let runtime = store.runtime(handle)?;
    let scripts = runtime.scripts();
    let entry = scripts.id_from_index(script_index).ok_or_else(|| {
        SakuraError::InvalidRuntime("runtime service trace script index is invalid".to_owned())
    })?;
    let host = SystemHost::with_runtime(runtime);
    let mut system_runtime = SystemRuntime::new(scripts, host);
    let offset = if offset == usize::MAX {
        None
    } else {
        Some(offset)
    };
    system_runtime.push_script_at(entry, offset, Vec::new())?;
    let record_limit = max_services.min(RUNTIME_SERVICE_TRACE_MAX_EVENTS);
    let (summary, trace) = system_runtime.run_with_service_trace(
        MAX_SYSTEM_PROBE_EVENTS,
        MAX_BOOT_INSTRUCTIONS_PER_EVENT,
        record_limit,
    )?;
    write_service_trace_summary(out, script_index, offset, record_limit, &summary, &trace);
    Ok(())
}

fn write_runtime_sound_queue_packet(
    handle: u32,
    script_index: usize,
    offset: usize,
    out: &mut [u8],
) -> Result<()> {
    let store = lock_store()?;
    let runtime = store.runtime(handle)?;
    let scripts = runtime.scripts();
    let entry = scripts.id_from_index(script_index).ok_or_else(|| {
        SakuraError::InvalidRuntime("runtime sound queue script index is invalid".to_owned())
    })?;
    let host = SystemHost::with_runtime(runtime);
    let mut system_runtime = SystemRuntime::new(scripts, host);
    let offset = if offset == usize::MAX {
        None
    } else {
        Some(offset)
    };
    system_runtime.push_script_at(entry, offset, Vec::new())?;
    let (_summary, trace) = system_runtime.run_with_service_trace(
        MAX_SYSTEM_PROBE_EVENTS,
        MAX_BOOT_INSTRUCTIONS_PER_EVENT,
        RUNTIME_QUEUE_TRACE_RECORD_LIMIT,
    )?;
    write_sound_queue_packet(
        out,
        script_index,
        offset,
        RUNTIME_QUEUE_TRACE_RECORD_LIMIT,
        &trace,
    );
    Ok(())
}

fn write_runtime_graph_queue_packet(
    handle: u32,
    script_index: usize,
    offset: usize,
    out: &mut [u8],
) -> Result<()> {
    let store = lock_store()?;
    let runtime = store.runtime(handle)?;
    let scripts = runtime.scripts();
    let entry = scripts.id_from_index(script_index).ok_or_else(|| {
        SakuraError::InvalidRuntime("runtime graph queue script index is invalid".to_owned())
    })?;
    let host = SystemHost::with_runtime(runtime);
    let mut system_runtime = SystemRuntime::new(scripts, host);
    let offset = if offset == usize::MAX {
        None
    } else {
        Some(offset)
    };
    system_runtime.push_script_at(entry, offset, Vec::new())?;
    let (_summary, trace) = system_runtime.run_with_service_trace(
        MAX_SYSTEM_PROBE_EVENTS,
        MAX_BOOT_INSTRUCTIONS_PER_EVENT,
        RUNTIME_QUEUE_TRACE_RECORD_LIMIT,
    )?;
    write_graph_queue_packet(
        out,
        script_index,
        offset,
        RUNTIME_QUEUE_TRACE_RECORD_LIMIT,
        &trace,
    );
    Ok(())
}

fn runtime_session_memory(handle: u32, address: u32, len: usize) -> Option<Vec<u8>> {
    let store = lock_store().ok()?;
    let session = store.sessions.get(&handle)?;
    let runtime = store.runtime(session.runtime_handle).ok()?;
    let system_runtime = SystemRuntime::restore(runtime, session.state.clone()).ok()?;
    system_runtime.current_frame_bytes_raw(address, len)
}

fn write_runtime_session_step_packet(
    handle: u32,
    max_events: usize,
    max_instructions_per_event: usize,
    out: &mut [u8],
) -> Result<()> {
    let mut store = lock_store()?;
    let session = store.sessions.get(&handle).cloned().ok_or_else(|| {
        SakuraError::InvalidRuntime("runtime session handle is invalid".to_owned())
    })?;
    let runtime = store.runtime(session.runtime_handle)?;
    let mut system_runtime = SystemRuntime::restore(runtime, session.state)?;
    let (summary, trace, pending_asset) = if session.pending_asset.is_some() {
        (
            crate::SystemRuntimeSummary {
                host_state: system_runtime.host_state(),
                ..crate::SystemRuntimeSummary::default()
            },
            SystemServiceTrace {
                total_service_count: 0,
                recorded_services: Vec::new(),
            },
            session.pending_asset.clone().zip(session.pending_event.clone()).map(
                |(request, event)| SystemRuntimePendingAsset { request, event },
            ),
        )
    } else {
        system_runtime.run_with_service_trace_until_asset(
            max_events,
            max_instructions_per_event,
            RUNTIME_QUEUE_TRACE_RECORD_LIMIT,
        )?
    };
    let frame = system_runtime.current_frame_state().unwrap_or_default();
    let queue_script_index = frame.script_index;
    let queue_offset = Some(frame.last_instruction_offset);
    let snapshot = system_runtime.snapshot();
    let session_mut = store.sessions.get_mut(&handle).ok_or_else(|| {
        SakuraError::InvalidRuntime("runtime session handle disappeared".to_owned())
    })?;
    session_mut.state = snapshot;
    session_mut.last_service_trace_packet =
        runtime_service_trace_packet(queue_script_index, queue_offset, &summary, &trace);
    session_mut.last_sound_queue_packet =
        runtime_sound_queue_packet(queue_script_index, queue_offset, &trace);
    session_mut.last_graph_queue_packet =
        runtime_graph_queue_packet(queue_script_index, queue_offset, &trace);
    session_mut.pending_asset = pending_asset.as_ref().map(|pending| pending.request.clone());
    session_mut.pending_event = pending_asset.as_ref().map(|pending| pending.event.clone());

    out[..RUNTIME_SESSION_STEP_PACKET_LEN].fill(0);
    write_u32(out, 0, 1);
    write_u32(out, 4, handle);
    write_u32(out, 8, summary.event_count as u32);
    write_u32(out, 12, summary.service_event_count as u32);
    write_u32(out, 16, summary.user_call_event_count as u32);
    write_u32(out, 20, summary.user_load_event_count as u32);
    write_u32(out, 24, summary.user_free_event_count as u32);
    write_u32(out, 28, summary.user_return_event_count as u32);
    write_u32(out, 32, summary.halted_event_count as u32);
    write_u32(out, 36, u32::from(summary.completed));
    write_u32(out, 40, u32::from(summary.event_limited));
    write_u32(out, 44, summary.max_call_depth as u32);
    write_u32(
        out,
        48,
        u32::from(family_code(
            summary
                .host_state
                .last_family
                .unwrap_or(crate::SystemCallFamily::System),
        )),
    );
    write_u32(out, 52, u32::from(summary.host_state.last_service_id));
    write_u32(out, 56, summary.host_state.last_arg_count as u32);
    write_u32(out, 60, u32::from(summary.host_state.last_top_kind));
    write_u32(out, 64, summary.host_state.service_count as u32);
    write_u32(out, 68, summary.host_state.file_query_count as u32);
    write_u32(out, 72, summary.host_state.graph_format_count as u32);
    write_u32(out, 76, summary.host_state.graph_render_text_count as u32);
    write_u32(out, 80, summary.host_state.sound_service_count as u32);
    write_u32(
        out,
        84,
        summary.host_state.last_asset_query_service_id as u32,
    );
    write_u32(out, 88, u32::from(summary.host_state.last_asset_found));
    write_u32(
        out,
        92,
        summary.host_state.last_loaded_script_string_len as u32,
    );
    write_u32(
        out,
        96,
        u32::from(summary.host_state.last_loaded_script_found),
    );
    write_u32(
        out,
        100,
        summary.host_state.sound_after_asset_query_count as u32,
    );
    write_u32(out, 104, summary.syscall_service_counts[0x1c] as u32);
    write_u32(out, 108, summary.syscall_service_counts[0x49] as u32);
    write_u32(out, 112, summary.syscall_service_counts[0x5f] as u32);
    write_u32(out, 116, summary.graphcall_service_counts[0xbf] as u32);
    write_u32(out, 120, frame.script_index as u32);
    write_u32(out, 124, frame.cursor as u32);
    write_u32(out, 128, frame.last_instruction_offset as u32);
    write_u32(out, 132, frame.local_44 as u32);
    write_u32(out, 136, frame.local_48 as u32);
    write_u32(out, 140, frame.local_56 as u32);
    write_u32(out, 144, frame.local_60 as u32);
    write_u32(out, 148, frame.local_64 as u32);
    write_u32(out, 152, frame.local_68 as u32);
    write_u32(out, 156, frame.local_72 as u32);
    write_u32(out, 160, frame.local_76 as u32);
    write_u32(out, 164, frame.local_1076 as u32);
    write_u32(out, 168, frame.local_1152 as u32);
    write_u32(out, 172, frame.local_3952 as u32);
    write_u32(out, 176, frame.local_3956 as u32);
    write_u32(out, 180, frame.local_3980 as u32);
    write_u32(out, 184, frame.local_3992 as u32);
    write_u32(out, 188, frame.local_3996 as u32);
    write_u32(out, 192, frame.local_4024 as u32);
    write_u32(out, 196, frame.local_4028 as u32);
    write_u32(out, 200, frame.local_4076 as u32);
    write_u32(out, 204, frame.local_7100 as u32);
    write_u32(out, 208, frame.local_7104 as u32);
    write_u32(out, 212, frame.local_7108 as u32);
    write_u32(out, 216, frame.local_7112 as u32);
    write_u32(out, 220, u32::from(session_mut.pending_asset.is_some()));
    write_u32(
        out,
        224,
        session_mut
            .pending_asset
            .as_ref()
            .map_or(0, |request| u32::from(request.service_id)),
    );
    write_u32(
        out,
        228,
        session_mut.pending_asset.as_ref().map_or(0, |request| request.size),
    );
    write_u32(
        out,
        232,
        session_mut
            .pending_asset
            .as_ref()
            .map_or(0, |request| request.name.len().min(u32::MAX as usize) as u32),
    );
    write_u32(out, 236, u32::from(session_mut.pending_asset.is_some()));
    Ok(())
}

fn empty_runtime_sound_queue_packet(script_index: usize, offset: Option<usize>) -> Vec<u8> {
    runtime_sound_queue_packet(
        script_index,
        offset,
        &SystemServiceTrace {
            total_service_count: 0,
            recorded_services: Vec::new(),
        },
    )
}

fn empty_runtime_service_trace_packet(script_index: usize, offset: Option<usize>) -> Vec<u8> {
    runtime_service_trace_packet(
        script_index,
        offset,
        &crate::SystemRuntimeSummary::default(),
        &SystemServiceTrace {
            total_service_count: 0,
            recorded_services: Vec::new(),
        },
    )
}

fn empty_runtime_graph_queue_packet(script_index: usize, offset: Option<usize>) -> Vec<u8> {
    runtime_graph_queue_packet(
        script_index,
        offset,
        &SystemServiceTrace {
            total_service_count: 0,
            recorded_services: Vec::new(),
        },
    )
}

fn runtime_sound_queue_packet(
    script_index: usize,
    offset: Option<usize>,
    trace: &SystemServiceTrace,
) -> Vec<u8> {
    let mut packet = vec![0; RUNTIME_SOUND_QUEUE_PACKET_LEN];
    write_sound_queue_packet(
        &mut packet,
        script_index,
        offset,
        RUNTIME_QUEUE_TRACE_RECORD_LIMIT,
        trace,
    );
    packet
}

fn runtime_service_trace_packet(
    script_index: usize,
    offset: Option<usize>,
    summary: &crate::SystemRuntimeSummary,
    trace: &SystemServiceTrace,
) -> Vec<u8> {
    let mut packet = vec![0; RUNTIME_SERVICE_TRACE_PACKET_LEN];
    write_service_trace_summary(&mut packet, script_index, offset, RUNTIME_QUEUE_TRACE_RECORD_LIMIT, summary, trace);
    packet
}

fn runtime_graph_queue_packet(
    script_index: usize,
    offset: Option<usize>,
    trace: &SystemServiceTrace,
) -> Vec<u8> {
    let mut packet = vec![0; RUNTIME_GRAPH_QUEUE_PACKET_LEN];
    write_graph_queue_packet(
        &mut packet,
        script_index,
        offset,
        RUNTIME_QUEUE_TRACE_RECORD_LIMIT,
        trace,
    );
    packet
}

fn write_service_trace_summary(
    out: &mut [u8],
    script_index: usize,
    offset: Option<usize>,
    record_limit: usize,
    summary: &crate::SystemRuntimeSummary,
    trace: &SystemServiceTrace,
) {
    out[..RUNTIME_SERVICE_TRACE_PACKET_LEN].fill(0);
    write_u32(out, 0, 1);
    write_u32(out, 4, script_index as u32);
    write_u32(out, 8, offset.unwrap_or(u32::MAX as usize) as u32);
    write_u32(out, 12, summary.event_count as u32);
    write_u32(out, 16, summary.service_event_count as u32);
    write_u32(out, 20, trace.total_service_count as u32);
    write_u32(out, 24, trace.recorded_services.len() as u32);
    write_u32(out, 28, record_limit as u32);
    write_u32(out, 32, u32::from(summary.completed));
    write_u32(out, 36, u32::from(summary.event_limited));

    let mut cursor = 40usize;
    for event in &trace.recorded_services {
        write_u32(out, cursor, event.event_index as u32);
        write_u32(out, cursor + 4, event.depth as u32);
        write_u32(out, cursor + 8, family_code(event.family).into());
        write_u32(out, cursor + 12, event.service_id.into());
        write_u32(
            out,
            cursor + 16,
            event.arg_count.min(u32::MAX as usize) as u32,
        );
        write_u32(out, cursor + 20, event.top_kind.into());
        write_u32(
            out,
            cursor + 24,
            event.integer_arg_count.min(u32::MAX as usize) as u32,
        );
        write_u32(
            out,
            cursor + 28,
            event.min_integer_arg.min(u32::MAX.into()) as u32,
        );
        write_u32(
            out,
            cursor + 32,
            event.max_integer_arg.min(u32::MAX.into()) as u32,
        );
        write_u32(
            out,
            cursor + 36,
            event.string_arg_count.min(u32::MAX as usize) as u32,
        );
        write_u32(
            out,
            cursor + 40,
            event.first_string_len.min(u32::MAX as usize) as u32,
        );
        write_u32(out, cursor + 44, event.first_string_hash as u32);
        write_u32(out, cursor + 48, event.instruction_offset as u32);
        cursor += RUNTIME_SERVICE_TRACE_EVENT_LEN;
    }
    write_host_state(
        out,
        RUNTIME_SERVICE_TRACE_HOST_STATE_OFFSET,
        &summary.host_state,
    );
}

fn family_code(family: crate::SystemCallFamily) -> u8 {
    match family {
        crate::SystemCallFamily::System => 0,
        crate::SystemCallFamily::Graph => 1,
        crate::SystemCallFamily::Sound => 2,
        crate::SystemCallFamily::External => 3,
    }
}

fn write_host_state(out: &mut [u8], offset: usize, state: &crate::SystemHostServiceState) {
    write_u32(out, offset, state.service_count as u32);
    write_u32(
        out,
        offset + 4,
        state
            .last_family
            .map_or(u32::MAX, |family| u32::from(family_code(family))),
    );
    write_u32(out, offset + 8, u32::from(state.last_service_id));
    write_u32(out, offset + 12, state.last_arg_count as u32);
    write_u32(out, offset + 16, u32::from(state.last_top_kind));
    write_u32(out, offset + 20, state.load_program_count as u32);
    write_u32(out, offset + 24, state.file_query_count as u32);
    write_u32(out, offset + 28, state.graph_format_count as u32);
    write_u32(out, offset + 32, state.graph_render_text_count as u32);
    write_u32(out, offset + 36, state.sound_play_count as u32);
    write_u32(out, offset + 40, state.sound_service_count as u32);
    write_u32(out, offset + 44, u32::from(state.last_sound_service_id));
    write_u32(out, offset + 48, state.last_sound_arg_count as u32);
    write_u32(out, offset + 52, u32::from(state.last_sound_top_kind));
    write_u32(out, offset + 56, state.last_sound_integer_arg_count as u32);
    write_u32(
        out,
        offset + 60,
        state.last_sound_min_integer_arg.min(u32::MAX.into()) as u32,
    );
    write_u32(
        out,
        offset + 64,
        state.last_sound_max_integer_arg.min(u32::MAX.into()) as u32,
    );
    write_u32(
        out,
        offset + 68,
        state.last_asset_string_len.min(u32::MAX as usize) as u32,
    );
    write_u32(out, offset + 72, state.last_asset_string_hash as u32);
    write_u32(
        out,
        offset + 76,
        u32::from(state.last_asset_query_service_id),
    );
    write_u32(out, offset + 80, u32::from(state.last_asset_found));
    write_u32(
        out,
        offset + 84,
        state.last_loaded_script_string_len.min(u32::MAX as usize) as u32,
    );
    write_u32(
        out,
        offset + 88,
        state.last_loaded_script_string_hash as u32,
    );
    write_u32(out, offset + 92, u32::from(state.last_loaded_script_found));
    write_u32(out, offset + 96, state.sound_after_asset_query_count as u32);
}
#[cfg(test)]
fn current_session_raw_integer(
    session_handle: u32,
    address: u32,
    width: u8,
) -> Result<Option<u64>> {
    let store = lock_store()?;
    let session = store.sessions.get(&session_handle).ok_or_else(|| {
        SakuraError::InvalidRuntime("runtime session handle is invalid".to_owned())
    })?;
    let runtime = store.runtime(session.runtime_handle)?;
    let system_runtime = SystemRuntime::restore(runtime, session.state.clone())?;
    Ok(system_runtime.current_frame_integer_raw(address, width))
}

#[cfg(test)]
fn describe_snapshot_value(value: &crate::system_vm::SystemValueSnapshot) -> String {
    match value {
        crate::system_vm::SystemValueSnapshot::Integer(value) => format!("i:{value:08x}"),
        crate::system_vm::SystemValueSnapshot::String(bytes) => format!("s:{}", bytes.len()),
        crate::system_vm::SystemValueSnapshot::LocalStringPointer { address, bytes } => {
            format!("ls:{address:08x}/{}", bytes.len())
        }
        crate::system_vm::SystemValueSnapshot::Code(offset) => format!("c:{offset:08x}"),
        crate::system_vm::SystemValueSnapshot::CodeInScript {
            script_index,
            offset,
        } => format!("cs:{script_index}:{offset:08x}"),
        crate::system_vm::SystemValueSnapshot::VariablePointer(address) => {
            format!("p:{address:08x}")
        }
        crate::system_vm::SystemValueSnapshot::UserScriptHandle(handle) => {
            format!("h:{handle:08x}")
        }
        crate::system_vm::SystemValueSnapshot::UserScriptResult(service_id) => {
            format!("ur:{service_id:02x}")
        }
        crate::system_vm::SystemValueSnapshot::Unknown => "u".to_owned(),
    }
}

#[cfg(test)]
fn family_label(family: crate::SystemCallFamily) -> &'static str {
    match family {
        crate::SystemCallFamily::System => "sys",
        crate::SystemCallFamily::Graph => "graph",
        crate::SystemCallFamily::Sound => "sound",
        crate::SystemCallFamily::External => "ext",
    }
}

#[cfg(test)]
fn format_trace_args(event: &crate::SystemServiceTraceEvent) -> String {
    event
        .arg_slots
        .iter()
        .take(event.arg_count.min(event.arg_slots.len()))
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

#[cfg(test)]
fn format_trace_head(event: Option<&crate::SystemServiceTraceEvent>) -> String {
    let Some(event) = event else {
        return "none".to_owned();
    };
    format!(
        "{}:{:02x}@s{}:0x{:x}:argc{}:top{}:ints{}:{}-{}:args{}",
        family_label(event.family),
        event.service_id,
        event.script_index,
        event.instruction_offset,
        event.arg_count,
        event.top_kind,
        event.integer_arg_count,
        event.min_integer_arg.min(u32::MAX.into()),
        event.max_integer_arg.min(u32::MAX.into()),
        format_trace_args(event)
    )
}

#[cfg(test)]
fn dump_scrdrv_stuck_replay(
    runtime: &Runtime,
    snapshot: crate::system_runtime::SystemRuntimeSnapshot,
) -> Result<()> {
    let mut replay = SystemRuntime::restore(runtime, snapshot)?;
    for replay_step in 0..8usize {
        let before = replay.snapshot();
        let (summary, trace) = replay.run_with_service_trace(1, 100_000, 4)?;
        let frame = replay.current_frame_state();
        println!(
                "runtime_handles_scrdrv_session_replay_step={} events={} services={} user_calls={} halted={} completed={} limited={} frame_script={} frame_cursor={} frame_last=0x{:x} raw144556={} raw123420={} raw123424={} raw128560={} raw128564={} raw128576={} trace_total={} trace_head={}",
                replay_step,
                summary.event_count,
                summary.service_event_count,
                summary.user_call_event_count,
                summary.halted_event_count,
                u8::from(summary.completed),
                u8::from(summary.event_limited),
                frame.as_ref().map_or(usize::MAX, |frame| frame.script_index),
                frame.as_ref().map_or(usize::MAX, |frame| frame.cursor),
                frame.as_ref().map_or(0, |frame| frame.last_instruction_offset),
                replay.current_frame_integer_raw(144556, 2).unwrap_or(0),
                replay.current_frame_integer_raw(123420, 2).unwrap_or(0),
                replay.current_frame_integer_raw(123424, 2).unwrap_or(0),
                replay.current_frame_integer_raw(128560, 2).unwrap_or(0),
                replay.current_frame_integer_raw(128564, 2).unwrap_or(0),
                replay.current_frame_integer_raw(128576, 2).unwrap_or(0),
                trace.total_service_count,
                format_trace_head(trace.recorded_services.first()),
            );
        for (frame_index, frame) in before.frames.iter().enumerate() {
            let script_name = runtime
                .scripts()
                .id_from_index(frame.script_index)
                .and_then(|id| runtime.scripts().name_by_id(id))
                .map(|name| String::from_utf8_lossy(name).into_owned())
                .unwrap_or_else(|| "<unknown>".to_owned());
            println!(
                    "runtime_handles_scrdrv_session_replay_before replay={} index={} script={} name={} cursor={} last=0x{:x} mem_ptr=0x{:x} stack={} return={}",
                    replay_step,
                    frame_index,
                    frame.script_index,
                    script_name,
                    frame.vm.cursor,
                    frame.vm.last_instruction_offset.unwrap_or(0),
                    frame.vm.mem_ptr,
                    format_snapshot_stack(&frame.vm.stack),
                    frame
                        .return_value
                        .as_ref()
                        .map(describe_snapshot_value)
                        .unwrap_or_else(|| "none".to_owned()),
                );
        }
    }

    let stuck_snapshot = replay.snapshot();
    let mut single = SystemRuntime::restore(runtime, stuck_snapshot)?;
    for single_step in 0..12usize {
        match single.run_with_service_trace(1, 100_000, 4) {
            Ok((single_summary, single_trace)) => {
                let before = single.snapshot();
                let single_frame = single.current_frame_state();
                println!(
                        "runtime_handles_scrdrv_session_single_step={} events={} services={} user_calls={} halted={} completed={} limited={} frame_script={} frame_cursor={} frame_last=0x{:x} raw144556={} l20={} l1264={} l1268={} l1272={} l1276={} trace_head={}",
                        single_step,
                        single_summary.event_count,
                        single_summary.service_event_count,
                        single_summary.user_call_event_count,
                        single_summary.halted_event_count,
                        u8::from(single_summary.completed),
                        u8::from(single_summary.event_limited),
                        single_frame
                            .as_ref()
                            .map_or(usize::MAX, |frame| frame.script_index),
                        single_frame
                            .as_ref()
                            .map_or(usize::MAX, |frame| frame.cursor),
                        single_frame
                            .as_ref()
                            .map_or(0, |frame| frame.last_instruction_offset),
                        single.current_frame_integer_raw(144556, 2).unwrap_or(0),
                        single.current_frame_local_integer(20, 2).unwrap_or(0),
                        single.current_frame_local_integer(1264, 2).unwrap_or(0),
                        single.current_frame_local_integer(1268, 2).unwrap_or(0),
                        single.current_frame_local_integer(1272, 2).unwrap_or(0),
                        single.current_frame_local_integer(1276, 2).unwrap_or(0),
                        format_trace_head(single_trace.recorded_services.first()),
                    );
                for (frame_index, frame) in before.frames.iter().enumerate() {
                    let script_name = runtime
                        .scripts()
                        .id_from_index(frame.script_index)
                        .and_then(|id| runtime.scripts().name_by_id(id))
                        .map(|name| String::from_utf8_lossy(name).into_owned())
                        .unwrap_or_else(|| "<unknown>".to_owned());
                    println!(
                            "runtime_handles_scrdrv_session_single_before step={} index={} script={} name={} cursor={} last=0x{:x} mem_ptr=0x{:x} stack={} return={}",
                            single_step,
                            frame_index,
                            frame.script_index,
                            script_name,
                            frame.vm.cursor,
                            frame.vm.last_instruction_offset.unwrap_or(0),
                            frame.vm.mem_ptr,
                            format_snapshot_stack(&frame.vm.stack),
                            frame
                                .return_value
                                .as_ref()
                                .map(describe_snapshot_value)
                                .unwrap_or_else(|| "none".to_owned()),
                        );
                }
            }
            Err(single_error) => {
                let single_frame = single.current_frame_state();
                println!(
                        "runtime_handles_scrdrv_session_single_error step={} error={single_error:?} frame_script={} frame_cursor={} frame_last=0x{:x}",
                        single_step,
                        single_frame
                            .as_ref()
                            .map_or(usize::MAX, |frame| frame.script_index),
                        single_frame
                            .as_ref()
                            .map_or(usize::MAX, |frame| frame.cursor),
                        single_frame
                            .as_ref()
                            .map_or(0, |frame| frame.last_instruction_offset),
                    );
                break;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
fn describe_vm_value(value: &crate::system_vm::SystemValue<'_>) -> String {
    match value {
        crate::system_vm::SystemValue::Integer(value) => format!("i:{value:08x}"),
        crate::system_vm::SystemValue::String(bytes) => format!("s:{}", bytes.len()),
        crate::system_vm::SystemValue::OwnedString(bytes) => format!("os:{}", bytes.len()),
        crate::system_vm::SystemValue::LocalStringPointer { address, bytes } => {
            format!("ls:{address:08x}/{}", bytes.len())
        }
        crate::system_vm::SystemValue::Code(offset) => format!("c:{offset:08x}"),
        crate::system_vm::SystemValue::CodeInScript {
            script_index,
            offset,
        } => format!("cs:{script_index}:{offset:08x}"),
        crate::system_vm::SystemValue::VariablePointer(address) => {
            format!("p:{address:08x}")
        }
        crate::system_vm::SystemValue::UserScriptHandle(handle) => {
            format!("h:{handle:08x}")
        }
        crate::system_vm::SystemValue::UserScriptResult(service_id) => {
            format!("ur:{service_id:02x}")
        }
        crate::system_vm::SystemValue::Unknown => "u".to_owned(),
    }
}

#[cfg(test)]
fn format_vm_stack(values: &[crate::system_vm::SystemValue<'_>]) -> String {
    values
        .iter()
        .map(describe_vm_value)
        .collect::<Vec<_>>()
        .join("|")
}

#[cfg(test)]
fn format_snapshot_stack(values: &[crate::system_vm::SystemValueSnapshot]) -> String {
    values
        .iter()
        .map(describe_snapshot_value)
        .collect::<Vec<_>>()
        .join("|")
}

fn parse_archive_manifest(manifest: &[u8], archive_len: usize) -> Result<ArcIndex> {
    if manifest.len() < 12 {
        return Err(SakuraError::UnexpectedEof {
            offset: 0,
            needed: 12,
            available: manifest.len(),
        });
    }
    let count = read_u32(manifest, 0)? as usize;
    let data_start = read_u64(manifest, 4)? as usize;
    let mut cursor = 12usize;
    let mut entries = Vec::with_capacity(count);
    for _ in 0..count {
        if cursor + 10 > manifest.len() {
            return Err(SakuraError::UnexpectedEof {
                offset: cursor,
                needed: 10,
                available: manifest.len().saturating_sub(cursor),
            });
        }
        let name_len = read_u16(manifest, cursor)? as usize;
        let offset = read_u32(manifest, cursor + 2)?;
        let size = read_u32(manifest, cursor + 6)?;
        cursor += 10;
        if cursor + name_len > manifest.len() {
            return Err(SakuraError::UnexpectedEof {
                offset: cursor,
                needed: name_len,
                available: manifest.len().saturating_sub(cursor),
            });
        }
        let name = ArcName::from_bytes(&manifest[cursor..cursor + name_len])?;
        cursor += name_len;
        entries.push(ArcEntry { name, offset, size });
    }
    ArcIndex::from_entries(archive_len, data_start, entries)
}

impl RuntimeStore {
    fn insert(&mut self, runtime: Runtime) -> Result<u32> {
        for _ in 0..u32::MAX {
            let handle = self.next_handle;
            self.next_handle = self.next_handle.wrapping_add(1).max(1);
            if handle != 0 && !self.runtimes.contains_key(&handle) {
                self.runtimes.insert(handle, runtime);
                return Ok(handle);
            }
        }
        Err(SakuraError::InvalidRuntime(
            "runtime handle space is exhausted".to_owned(),
        ))
    }

    fn runtime(&self, handle: u32) -> Result<&Runtime> {
        self.runtimes
            .get(&handle)
            .ok_or_else(|| SakuraError::InvalidRuntime("runtime handle is invalid".to_owned()))
    }

    fn runtime_mut(&mut self, handle: u32) -> Result<&mut Runtime> {
        self.runtimes
            .get_mut(&handle)
            .ok_or_else(|| SakuraError::InvalidRuntime("runtime handle is invalid".to_owned()))
    }

    fn insert_session(&mut self, session: RuntimeSession) -> Result<u32> {
        for _ in 0..u32::MAX {
            let handle = self.next_session_handle;
            self.next_session_handle = self.next_session_handle.wrapping_add(1).max(1);
            if handle != 0 && !self.sessions.contains_key(&handle) {
                self.sessions.insert(handle, session);
                return Ok(handle);
            }
        }
        Err(SakuraError::InvalidRuntime(
            "runtime session handle space is exhausted".to_owned(),
        ))
    }
}

#[cfg(test)]
fn insert_runtime_for_test(runtime: Runtime) -> Result<u32> {
    let mut store = lock_store()?;
    store.insert(runtime)
}

fn lock_store() -> Result<std::sync::MutexGuard<'static, RuntimeStore>> {
    RUNTIME_STORE
        .get_or_init(|| Mutex::new(RuntimeStore::default()))
        .lock()
        .map_err(|_| SakuraError::InvalidRuntime("runtime store lock is poisoned".to_owned()))
}

fn read_u16(data: &[u8], offset: usize) -> Result<u16> {
    let bytes = data
        .get(offset..offset + 2)
        .ok_or(SakuraError::UnexpectedEof {
            offset,
            needed: 2,
            available: data.len().saturating_sub(offset),
        })?;
    Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
}

fn read_u32(data: &[u8], offset: usize) -> Result<u32> {
    let bytes = data
        .get(offset..offset + 4)
        .ok_or(SakuraError::UnexpectedEof {
            offset,
            needed: 4,
            available: data.len().saturating_sub(offset),
        })?;
    Ok(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

fn read_u64(data: &[u8], offset: usize) -> Result<u64> {
    let bytes = data
        .get(offset..offset + 8)
        .ok_or(SakuraError::UnexpectedEof {
            offset,
            needed: 8,
            available: data.len().saturating_sub(offset),
        })?;
    Ok(u64::from_le_bytes([
        bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
    ]))
}

fn write_u32(out: &mut [u8], offset: usize, value: u32) {
    out[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

unsafe fn slice_from_abi<'a>(ptr: *const u8, len: usize) -> Option<&'a [u8]> {
    if ptr.is_null() && len != 0 {
        return None;
    }
    Some(unsafe { std::slice::from_raw_parts(ptr, len) })
}

unsafe fn mutable_slice_from_abi<'a>(ptr: *mut u8, len: usize) -> Option<&'a mut [u8]> {
    if ptr.is_null() && len != 0 {
        return None;
    }
    Some(unsafe { std::slice::from_raw_parts_mut(ptr, len) })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::archive::ArcName;
    use crate::runtime_graph::{RUNTIME_GRAPH_EVENT_LEN, RUNTIME_GRAPH_QUEUE_PACKET_LEN};
    use crate::system_runtime::{
        SYSTEM_SERVICE_TRACE_ARG_SLOTS, SYSTEM_SERVICE_TRACE_INLINE_STRING_MAX_BYTES,
    };
    use crate::InstallManifest;
    use std::collections::{BTreeMap, BTreeSet};
    use std::env;
    use std::ffi::OsStr;
    use std::fs;
    use std::path::{Path, PathBuf};

    #[test]
    fn rejects_missing_bootstrap() {
        let handle = sakura_runtime_create();
        assert_ne!(handle, 0);
        let mut packet = vec![0; RUNTIME_BOOT_PACKET_LEN];
        let written =
            unsafe { sakura_runtime_boot_write(handle, packet.as_mut_ptr(), packet.len()) };
        assert_eq!(written, FFI_SIZE_ERROR);
        assert_eq!(sakura_runtime_destroy(handle), 1);
    }

    #[test]
    fn parses_archive_manifest_packet() -> Result<()> {
        let mut manifest = Vec::new();
        manifest.extend_from_slice(&1u32.to_le_bytes());
        manifest.extend_from_slice(&32u64.to_le_bytes());
        manifest.extend_from_slice(&3u16.to_le_bytes());
        manifest.extend_from_slice(&0u32.to_le_bytes());
        manifest.extend_from_slice(&4u32.to_le_bytes());
        manifest.extend_from_slice(b"one");

        let index = parse_archive_manifest(&manifest, 36)?;
        assert_eq!(index.entries().len(), 1);
        assert_eq!(index.entries()[0].name, ArcName::from_bytes(b"one")?);
        Ok(())
    }

    #[test]
    fn probes_mounted_system_script_by_index_and_offset() -> Result<()> {
        let handle = sakura_runtime_create();
        assert_ne!(handle, 0);
        let payload = build_synthetic_dsc(&{
            let mut script = vec![0u8; 0x10];
            script.extend_from_slice(&[0x17, 0x91, 0x88, 0x91, 0x9c, 0x00, 0x03, 0xa0, 0x46, 0x17]);
            script
        });
        assert_eq!(mount_dsc_script(handle, b"probe._bp", &payload)?.index(), 0);
        let mut packet = vec![0; RUNTIME_SYSTEM_PROBE_PACKET_LEN];
        let written = unsafe {
            sakura_runtime_system_probe_write(handle, 0, 0x11, packet.as_mut_ptr(), packet.len())
        };

        assert_eq!(written, RUNTIME_SYSTEM_PROBE_PACKET_LEN);
        assert_eq!(read_u32(&packet, 0)?, 1);
        assert_eq!(read_u32(&packet, 4)?, 0);
        assert_eq!(read_u32(&packet, 8)?, 0x11);
        assert_eq!(read_u32(&packet, 24)?, 4);
        assert_eq!(read_u32(&packet, 28)?, 3);
        assert_eq!(read_u32(&packet, 48)?, 1);
        assert_eq!(read_u32(&packet, 52)?, 1);
        assert_eq!(read_u32(&packet, 56)?, 1);
        assert_eq!(read_u32(&packet, 64)?, 0);
        assert_eq!(read_u32(&packet, 68)?, 0);
        assert_eq!(read_u32(&packet, 72)?, 0);
        assert_eq!(read_u32(&packet, 76)?, 0);
        assert_eq!(read_u32(&packet, 80)?, 3);
        assert_eq!(read_u32(&packet, 104)?, 0);
        assert_eq!(read_u32(&packet, 108)?, 1);
        assert_eq!(read_u32(&packet, 112)?, 1);
        assert_eq!(read_u32(&packet, 116)?, 1);
        assert_eq!(read_u32(&packet, 120)?, 1);
        assert_eq!(read_u32(&packet, 124)?, 0x46);
        assert_eq!(read_u32(&packet, 128)?, 1);
        assert_eq!(read_u32(&packet, 132)?, 1);
        assert_eq!(read_u32(&packet, 136)?, 1);
        assert_eq!(read_u32(&packet, 140)?, 3);
        assert_eq!(read_u32(&packet, 144)?, 3);
        assert_eq!(read_u32(&packet, 148)?, 0);
        assert_eq!(sakura_runtime_destroy(handle), 1);
        Ok(())
    }

    #[test]
    fn writes_runtime_service_trace_packet() -> Result<()> {
        let handle = sakura_runtime_create();
        assert_ne!(handle, 0);
        let payload = build_synthetic_dsc(&{
            let mut script = vec![0u8; 0x10];
            script.extend_from_slice(&[0x00, 0x2a, 0x00, 0x2b, 0x91, 0x88, 0x17]);
            script
        });
        assert_eq!(mount_dsc_script(handle, b"trace._bp", &payload)?.index(), 0);
        let mut packet = vec![0; RUNTIME_SERVICE_TRACE_PACKET_LEN];
        let written = unsafe {
            sakura_runtime_service_trace_write(
                handle,
                0,
                usize::MAX,
                4,
                packet.as_mut_ptr(),
                packet.len(),
            )
        };

        assert_eq!(written, RUNTIME_SERVICE_TRACE_PACKET_LEN);
        assert_eq!(read_u32(&packet, 0)?, 1);
        assert_eq!(read_u32(&packet, 4)?, 0);
        assert_eq!(read_u32(&packet, 8)?, u32::MAX);
        assert_eq!(read_u32(&packet, 16)?, 1);
        assert_eq!(read_u32(&packet, 20)?, 1);
        assert_eq!(read_u32(&packet, 24)?, 1);
        assert_eq!(read_u32(&packet, 28)?, 4);
        assert_eq!(read_u32(&packet, 40)?, 1);
        assert_eq!(read_u32(&packet, 48)?, 1);
        assert_eq!(read_u32(&packet, 52)?, 0x88);
        assert_eq!(read_u32(&packet, 56)?, 2);
        assert_eq!(read_u32(&packet, 60)?, 1);
        assert_eq!(read_u32(&packet, 64)?, 2);
        assert_eq!(read_u32(&packet, 68)?, 0x2a);
        assert_eq!(read_u32(&packet, 72)?, 0x2b);
        assert_eq!(read_u32(&packet, 76)?, 0);
        assert_eq!(read_u32(&packet, 80)?, 0);
        assert_eq!(read_u32(&packet, 84)?, 0);
        assert_eq!(
            read_u32(&packet, RUNTIME_SERVICE_TRACE_HOST_STATE_OFFSET)?,
            1
        );
        assert_eq!(
            read_u32(&packet, RUNTIME_SERVICE_TRACE_HOST_STATE_OFFSET + 4)?,
            1
        );
        assert_eq!(
            read_u32(&packet, RUNTIME_SERVICE_TRACE_HOST_STATE_OFFSET + 8)?,
            0x88
        );
        assert_eq!(
            read_u32(&packet, RUNTIME_SERVICE_TRACE_HOST_STATE_OFFSET + 28)?,
            1
        );
        assert_eq!(
            read_u32(&packet, RUNTIME_SERVICE_TRACE_HOST_STATE_OFFSET + 40)?,
            0
        );
        assert_eq!(sakura_runtime_destroy(handle), 1);
        Ok(())
    }

    #[test]
    fn writes_runtime_sound_queue_packet() -> Result<()> {
        let handle = sakura_runtime_create();
        assert_ne!(handle, 0);
        let payload = build_synthetic_dsc(&{
            let mut script = vec![0u8; 0x10];
            script.extend_from_slice(&[0x00, 0x03, 0xa0, 0x70, 0x91, 0x88, 0xa0, 0x71, 0x17]);
            script
        });
        assert_eq!(mount_dsc_script(handle, b"sound._bp", &payload)?.index(), 0);
        let mut packet = vec![0; RUNTIME_SOUND_QUEUE_PACKET_LEN];
        let written = unsafe {
            sakura_runtime_sound_queue_write(
                handle,
                0,
                usize::MAX,
                packet.as_mut_ptr(),
                packet.len(),
            )
        };

        assert_eq!(written, RUNTIME_SOUND_QUEUE_PACKET_LEN);
        assert_eq!(read_u32(&packet, 0)?, 1);
        assert_eq!(read_u32(&packet, 4)?, 0);
        assert_eq!(read_u32(&packet, 8)?, u32::MAX);
        assert_eq!(read_u32(&packet, 12)?, 3);
        assert_eq!(read_u32(&packet, 16)?, 3);
        assert_eq!(
            read_u32(&packet, 20)?,
            RUNTIME_QUEUE_TRACE_RECORD_LIMIT as u32
        );
        assert_eq!(read_u32(&packet, 24)?, 2);
        assert_eq!(read_u32(&packet, 32)?, 1);
        assert_eq!(read_u32(&packet, 40)?, 0x70);
        assert_eq!(read_u32(&packet, 44)?, 1);
        assert_eq!(read_u32(&packet, 48)?, 2);
        assert_eq!(read_u32(&packet, 52)?, 1);
        assert_eq!(read_u32(&packet, 84)?, 1);
        assert_eq!(read_u32(&packet, 88)?, 3);
        assert_eq!(
            read_u32(&packet, 32 + crate::runtime_sound::RUNTIME_SOUND_EVENT_LEN)?,
            3
        );
        assert_eq!(
            read_u32(&packet, 40 + crate::runtime_sound::RUNTIME_SOUND_EVENT_LEN)?,
            0x71
        );
        assert_eq!(sakura_runtime_destroy(handle), 1);
        Ok(())
    }

    #[test]
    fn writes_runtime_sound_queue_packet_for_late_sound_events() -> Result<()> {
        let handle = sakura_runtime_create();
        assert_ne!(handle, 0);
        let payload = build_synthetic_dsc(&{
            let mut script = vec![0u8; 0x10];
            for value in 0..80u8 {
                script.extend_from_slice(&[0x00, value, 0x91, 0x88]);
            }
            script.extend_from_slice(&[0x00, 0x03, 0xa0, 0x24, 0x17]);
            script
        });
        assert_eq!(
            mount_dsc_script(handle, b"late-sound._bp", &payload)?.index(),
            0
        );
        let mut packet = vec![0; RUNTIME_SOUND_QUEUE_PACKET_LEN];
        let written = unsafe {
            sakura_runtime_sound_queue_write(
                handle,
                0,
                usize::MAX,
                packet.as_mut_ptr(),
                packet.len(),
            )
        };

        assert_eq!(written, RUNTIME_SOUND_QUEUE_PACKET_LEN);
        assert_eq!(read_u32(&packet, 12)?, 81);
        assert_eq!(read_u32(&packet, 16)?, 81);
        assert_eq!(
            read_u32(&packet, 20)?,
            RUNTIME_QUEUE_TRACE_RECORD_LIMIT as u32
        );
        assert_eq!(read_u32(&packet, 24)?, 1);
        assert_eq!(read_u32(&packet, 32)?, 81);
        assert_eq!(read_u32(&packet, 40)?, 0x24);
        assert_eq!(read_u32(&packet, 44)?, 1);
        assert_eq!(read_u32(&packet, 48)?, 2);
        assert_eq!(read_u32(&packet, 84)?, 1);
        assert_eq!(read_u32(&packet, 88)?, 3);
        assert_eq!(sakura_runtime_destroy(handle), 1);
        Ok(())
    }

    #[test]
    fn writes_runtime_graph_queue_packet() -> Result<()> {
        let handle = sakura_runtime_create();
        assert_ne!(handle, 0);
        let payload = build_synthetic_dsc(&{
            let mut script = vec![0u8; 0x10];
            script.extend_from_slice(&[0xa0, 0x70, 0x91, 0x68, 0x00, 0x03, 0x91, 0x64, 0x17]);
            script
        });
        assert_eq!(mount_dsc_script(handle, b"graph._bp", &payload)?.index(), 0);
        let mut packet = vec![0; RUNTIME_GRAPH_QUEUE_PACKET_LEN];
        let written = unsafe {
            sakura_runtime_graph_queue_write(
                handle,
                0,
                usize::MAX,
                packet.as_mut_ptr(),
                packet.len(),
            )
        };

        assert_eq!(written, RUNTIME_GRAPH_QUEUE_PACKET_LEN);
        assert_eq!(read_u32(&packet, 0)?, 1);
        assert_eq!(read_u32(&packet, 4)?, 0);
        assert_eq!(read_u32(&packet, 8)?, u32::MAX);
        assert_eq!(read_u32(&packet, 12)?, 3);
        assert_eq!(read_u32(&packet, 16)?, 3);
        assert_eq!(
            read_u32(&packet, 20)?,
            RUNTIME_QUEUE_TRACE_RECORD_LIMIT as u32
        );
        assert_eq!(read_u32(&packet, 24)?, 2);
        assert_eq!(read_u32(&packet, 32)?, 2);
        assert_eq!(read_u32(&packet, 40)?, 0x68);
        assert_eq!(read_u32(&packet, 44)?, 0);
        assert_eq!(read_u32(&packet, 48)?, 1);
        assert_eq!(read_u32(&packet, 52)?, 0);
        assert_eq!(
            read_u32(&packet, 32 + crate::runtime_graph::RUNTIME_GRAPH_EVENT_LEN)?,
            3
        );
        assert_eq!(
            read_u32(&packet, 40 + crate::runtime_graph::RUNTIME_GRAPH_EVENT_LEN)?,
            0x64
        );
        assert_eq!(
            read_u32(&packet, 84 + crate::runtime_graph::RUNTIME_GRAPH_EVENT_LEN)?,
            1
        );
        assert_eq!(
            read_u32(&packet, 88 + crate::runtime_graph::RUNTIME_GRAPH_EVENT_LEN)?,
            3
        );
        assert_eq!(sakura_runtime_destroy(handle), 1);
        Ok(())
    }

    #[test]
    fn steps_runtime_session_without_restarting_from_entry() -> Result<()> {
        let handle = sakura_runtime_create();
        assert_ne!(handle, 0);
        let payload = build_synthetic_dsc(&{
            let mut script = vec![0u8; 0x10];
            script.extend_from_slice(&[
                0x00, 0x01, 0x80, 0x1c, 0x00, 0x02, 0x80, 0x1c, 0x00, 0x03, 0x80, 0x49, 0x17,
            ]);
            script
        });
        assert_eq!(
            mount_dsc_script(handle, b"session._bp", &payload)?.index(),
            0
        );
        let session = sakura_runtime_session_create(handle, 0, usize::MAX);
        assert_ne!(session, 0);

        let mut packet = vec![0; RUNTIME_SESSION_STEP_PACKET_LEN];
        let written = unsafe {
            sakura_runtime_session_step_write(session, 1, 64, packet.as_mut_ptr(), packet.len())
        };
        assert_eq!(written, RUNTIME_SESSION_STEP_PACKET_LEN);
        assert_eq!(read_u32(&packet, 8)?, 1);
        assert_eq!(read_u32(&packet, 104)?, 1);
        assert_eq!(read_u32(&packet, 108)?, 0);

        let written = unsafe {
            sakura_runtime_session_step_write(session, 1, 64, packet.as_mut_ptr(), packet.len())
        };
        assert_eq!(written, RUNTIME_SESSION_STEP_PACKET_LEN);
        assert_eq!(read_u32(&packet, 8)?, 1);
        assert_eq!(read_u32(&packet, 104)?, 1);
        assert_eq!(read_u32(&packet, 108)?, 0);
        assert_eq!(read_u32(&packet, 64)?, 2);

        let written = unsafe {
            sakura_runtime_session_step_write(session, 4, 64, packet.as_mut_ptr(), packet.len())
        };
        assert_eq!(written, RUNTIME_SESSION_STEP_PACKET_LEN);
        assert_eq!(read_u32(&packet, 108)?, 1);
        assert_eq!(read_u32(&packet, 36)?, 1);
        assert_eq!(sakura_runtime_session_destroy(session), 1);
        assert_eq!(sakura_runtime_destroy(handle), 1);
        Ok(())
    }

    #[test]
    fn resolves_pending_asset_for_manifest_only_runtime_session() -> Result<()> {
        let handle = sakura_runtime_create();
        assert_ne!(handle, 0);

        let asset_payload = b"asset-bytes";
        let archive_data = build_arc20(&[("asset.bin", asset_payload.as_slice())]);
        let manifest = build_archive_manifest(&[("asset.bin", asset_payload.len() as u32)]);
        assert_eq!(
            mount_archive_manifest(handle, Some(b"pending.arc"), &manifest, archive_data.len())?,
            ()
        );

        let payload = build_synthetic_dsc(&{
            let mut script = vec![0u8; 0x10];
            script.push(0x05);
            script.extend_from_slice(&14i16.to_le_bytes());
            script.extend_from_slice(&[
                0x00, 0x00, 0x04, 0x00, 0x20, 0x11, 0x80, 0x30, 0x80, 0x46, 0x17,
            ]);
            script.extend_from_slice(b"asset.bin\0");
            script
        });
        assert_eq!(
            mount_dsc_script(handle, b"pending._bp", &payload)?.index(),
            0
        );
        let session = sakura_runtime_session_create(handle, 0, usize::MAX);
        assert_ne!(session, 0);

        let mut packet = vec![0; RUNTIME_SESSION_STEP_PACKET_LEN];
        let written = unsafe {
            sakura_runtime_session_step_write(session, 1, 64, packet.as_mut_ptr(), packet.len())
        };
        assert_eq!(written, RUNTIME_SESSION_STEP_PACKET_LEN);
        assert_eq!(read_u32(&packet, 220)?, 1);
        assert_eq!(read_u32(&packet, 224)?, 0x30);
        assert_eq!(read_u32(&packet, 228)?, asset_payload.len() as u32);
        assert_eq!(read_u32(&packet, 232)?, 9);

        let pending_len = sakura_runtime_session_pending_asset_len(session);
        assert_eq!(pending_len, 25);
        let mut pending_packet = vec![0; pending_len];
        let pending_written = unsafe {
            sakura_runtime_session_pending_asset_write(
                session,
                pending_packet.as_mut_ptr(),
                pending_packet.len(),
            )
        };
        assert_eq!(pending_written, pending_len);
        assert_eq!(read_u32(&pending_packet, 0)?, 1);
        assert_eq!(read_u32(&pending_packet, 4)?, 0x30);
        assert_eq!(read_u32(&pending_packet, 8)?, asset_payload.len() as u32);
        assert_eq!(read_u32(&pending_packet, 12)?, 9);
        assert_eq!(&pending_packet[16..25], b"asset.bin");

        let supplied = unsafe {
            sakura_runtime_session_supply_asset(
                session,
                pending_packet[16..25].as_ptr(),
                9,
                asset_payload.as_ptr(),
                asset_payload.len(),
            )
        };
        assert_eq!(supplied, 1);
        assert_eq!(sakura_runtime_session_pending_asset_len(session), 0);

        let written = unsafe {
            sakura_runtime_session_step_write(session, 1, 64, packet.as_mut_ptr(), packet.len())
        };
        assert_eq!(written, RUNTIME_SESSION_STEP_PACKET_LEN);
        assert_eq!(read_u32(&packet, 220)?, 0);
        assert_eq!(read_u32(&packet, 80)?, 0);
        assert_eq!(read_u32(&packet, 84)?, 0x30);
        assert_eq!(read_u32(&packet, 88)?, 1);

        assert_eq!(sakura_runtime_session_destroy(session), 1);
        assert_eq!(sakura_runtime_destroy(handle), 1);
        Ok(())
    }

    #[test]
    fn resolves_pending_archive_for_manifest_only_runtime_session() -> Result<()> {
        let handle = sakura_runtime_create();
        assert_ne!(handle, 0);

        let archive_payload = build_arc20(&[("payload.bin", b"archive-bytes")]);
        let archive_name = b"data01999.arc";
        let manifest = build_archive_manifest(&[("payload.bin", 12)]);
        assert_eq!(
            mount_archive_manifest(handle, Some(archive_name), &manifest, archive_payload.len())?,
            ()
        );

        let payload = build_synthetic_dsc(&{
            let mut script = vec![0u8; 0x10];
            script.push(0x05);
            script.extend_from_slice(&11i16.to_le_bytes());
            script.extend_from_slice(&[
                0x00, 0x00, 0x04, 0x00, 0x20, 0x11, 0x80, 0x30,
            ]);
            script.extend_from_slice(b"data01xxx.arc\0");
            script
        });
        assert_eq!(
            mount_dsc_script(handle, b"pending_archive._bp", &payload)?.index(),
            0
        );
        let session = sakura_runtime_session_create(handle, 0, usize::MAX);
        assert_ne!(session, 0);

        let mut packet = vec![0; RUNTIME_SESSION_STEP_PACKET_LEN];
        let written = unsafe {
            sakura_runtime_session_step_write(session, 1, 64, packet.as_mut_ptr(), packet.len())
        };
        assert_eq!(written, RUNTIME_SESSION_STEP_PACKET_LEN);
        assert_eq!(read_u32(&packet, 220)?, 1);
        assert_eq!(read_u32(&packet, 224)?, 0x30);
        assert_eq!(read_u32(&packet, 228)?, archive_payload.len() as u32);
        assert_eq!(read_u32(&packet, 232)?, 13);

        let pending_len = sakura_runtime_session_pending_asset_len(session);
        assert_eq!(pending_len, 29);
        let mut pending_packet = vec![0; pending_len];
        let pending_written = unsafe {
            sakura_runtime_session_pending_asset_write(
                session,
                pending_packet.as_mut_ptr(),
                pending_packet.len(),
            )
        };
        assert_eq!(pending_written, pending_len);
        assert_eq!(&pending_packet[16..29], archive_name);

        let supplied = unsafe {
            sakura_runtime_session_supply_asset(
                session,
                pending_packet[16..29].as_ptr(),
                13,
                archive_payload.as_ptr(),
                archive_payload.len(),
            )
        };
        assert_eq!(supplied, 1);

        let written = unsafe {
            sakura_runtime_session_step_write(session, 1, 64, packet.as_mut_ptr(), packet.len())
        };
        assert_eq!(written, RUNTIME_SESSION_STEP_PACKET_LEN);
        assert_eq!(read_u32(&packet, 220)?, 0);

        assert_eq!(sakura_runtime_session_destroy(session), 1);
        assert_eq!(sakura_runtime_destroy(handle), 1);
        Ok(())
    }

    #[test]
    fn resolves_pending_script_for_manifest_only_runtime_session() -> Result<()> {
        let handle = sakura_runtime_create();
        assert_ne!(handle, 0);

        let callee_payload = build_synthetic_dsc(&{
            let mut script = vec![0u8; 0x10];
            script.extend_from_slice(&[0x80, 0x46, 0xff, 0xf8]);
            script
        });
        let caller_payload = build_synthetic_dsc(&{
            let mut script = vec![0u8; 0x10];
            script.push(0x05);
            script.extend_from_slice(&8i16.to_le_bytes());
            script.extend_from_slice(&[0x80, 0x40, 0xff, 0x00, 0x17]);
            script.extend_from_slice(b"callee._bp\0");
            script
        });
        let archive_data = build_arc20(&[
            ("callee._bp", callee_payload.as_slice()),
            ("caller._bp", caller_payload.as_slice()),
        ]);
        let manifest = build_archive_manifest(&[
            ("callee._bp", callee_payload.len() as u32),
            ("caller._bp", caller_payload.len() as u32),
        ]);
        mount_archive_manifest(handle, Some(b"scripts.arc"), &manifest, archive_data.len())?;
        assert_eq!(mount_dsc_script(handle, b"caller._bp", &caller_payload)?.index(), 0);

        let session = sakura_runtime_session_create(handle, 0, usize::MAX);
        assert_ne!(session, 0);

        let mut packet = vec![0; RUNTIME_SESSION_STEP_PACKET_LEN];
        let written = unsafe {
            sakura_runtime_session_step_write(session, 1, 64, packet.as_mut_ptr(), packet.len())
        };
        assert_eq!(written, RUNTIME_SESSION_STEP_PACKET_LEN);
        assert_eq!(read_u32(&packet, 220)?, 1);
        assert_eq!(read_u32(&packet, 224)?, 0x40);
        assert_eq!(read_u32(&packet, 228)?, callee_payload.len() as u32);
        assert_eq!(read_u32(&packet, 232)?, 10);

        let pending_len = sakura_runtime_session_pending_asset_len(session);
        assert_eq!(pending_len, 26);
        let mut pending_packet = vec![0; pending_len];
        let pending_written = unsafe {
            sakura_runtime_session_pending_asset_write(
                session,
                pending_packet.as_mut_ptr(),
                pending_packet.len(),
            )
        };
        assert_eq!(pending_written, pending_len);
        assert_eq!(read_u32(&pending_packet, 4)?, 0x40);
        assert_eq!(read_u32(&pending_packet, 8)?, callee_payload.len() as u32);
        assert_eq!(&pending_packet[16..26], b"callee._bp");

        let supplied = unsafe {
            sakura_runtime_session_supply_asset(
                session,
                pending_packet[16..26].as_ptr(),
                10,
                callee_payload.as_ptr(),
                callee_payload.len(),
            )
        };
        assert_eq!(supplied, 1);
        assert_eq!(sakura_runtime_session_pending_asset_len(session), 0);

        let mut completed = false;
        for _ in 0..4 {
            let written = unsafe {
                sakura_runtime_session_step_write(session, 4, 64, packet.as_mut_ptr(), packet.len())
            };
            assert_eq!(written, RUNTIME_SESSION_STEP_PACKET_LEN);
            assert_eq!(read_u32(&packet, 220)?, 0);
            assert_eq!(read_u32(&packet, 84)?, 0);
            assert_eq!(read_u32(&packet, 92)?, 10);
            assert_eq!(read_u32(&packet, 96)?, 1);
            if read_u32(&packet, 36)? == 1 {
                completed = true;
                break;
            }
        }
        assert!(completed);

        assert_eq!(sakura_runtime_session_destroy(session), 1);
        assert_eq!(sakura_runtime_destroy(handle), 1);
        Ok(())
    }

    #[test]
    #[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
    fn steps_real_logwnd_runtime_session_without_early_completion() -> Result<()> {
        let game_dir = env::var_os("SAKURA_INSTALL_DIR")
            .map(PathBuf::from)
            .ok_or_else(|| {
                SakuraError::InvalidRuntime(
                    "SAKURA_INSTALL_DIR is required for this ignored local-install probe"
                        .to_owned(),
                )
            })?;
        let mut runtime = Runtime::new(RuntimeConfig::default());
        for path in collect_archive_files(&game_dir)? {
            let data = fs::read(&path).map_err(|error| {
                SakuraError::InvalidRuntime(format!("failed to read archive for test: {error}"))
            })?;
            runtime.mount_archive_data_named(data, path.file_name().and_then(OsStr::to_str).map(|name| name.as_bytes().to_vec()).as_deref())?;
        }
        let entry_index = runtime
            .script_index_by_name(b"logwnd._bp")
            .ok_or_else(|| SakuraError::InvalidRuntime("logwnd._bp is missing".to_owned()))?;
        let handle = insert_runtime_for_test(runtime)?;
        let session = sakura_runtime_session_create(handle, entry_index, usize::MAX);
        assert_ne!(session, 0);

        let mut packet = vec![0; RUNTIME_SESSION_STEP_PACKET_LEN];
        for step in 0..4usize {
            let written = unsafe {
                sakura_runtime_session_step_write(
                    session,
                    64,
                    100_000,
                    packet.as_mut_ptr(),
                    packet.len(),
                )
            };
            assert_eq!(written, RUNTIME_SESSION_STEP_PACKET_LEN);
            let completed = read_u32(&packet, 36)?;
            let limited = read_u32(&packet, 40)?;
            println!(
                "runtime_handles_real_session_step={} events={} completed={} limited={} sys1c={} sys49={} sys5f={} graphbf={} frame_script={} frame_cursor={} frame_last=0x{:x}",
                step,
                read_u32(&packet, 8)?,
                completed,
                limited,
                read_u32(&packet, 104)?,
                read_u32(&packet, 108)?,
                read_u32(&packet, 112)?,
                read_u32(&packet, 116)?,
                read_u32(&packet, 120)?,
                read_u32(&packet, 124)?,
                read_u32(&packet, 128)?,
            );
            assert_eq!(
                completed, 0,
                "real logwnd session completed too early at step {step}"
            );
            assert_eq!(
                limited, 1,
                "real logwnd session should still be event-limited at step {step}"
            );
        }

        assert_eq!(sakura_runtime_session_destroy(session), 1);
        assert_eq!(sakura_runtime_destroy(handle), 1);
        Ok(())
    }

    #[test]
    #[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
    fn steps_real_logwnd_runtime_session_with_click_input_probe() -> Result<()> {
        let game_dir = env::var_os("SAKURA_INSTALL_DIR")
            .map(PathBuf::from)
            .ok_or_else(|| {
                SakuraError::InvalidRuntime(
                    "SAKURA_INSTALL_DIR is required for this ignored local-install probe"
                        .to_owned(),
                )
            })?;
        let mut runtime = Runtime::new(RuntimeConfig::default());
        for path in collect_archive_files(&game_dir)? {
            let data = fs::read(&path).map_err(|error| {
                SakuraError::InvalidRuntime(format!("failed to read archive for test: {error}"))
            })?;
            runtime.mount_archive_data_named(data, path.file_name().and_then(OsStr::to_str).map(|name| name.as_bytes().to_vec()).as_deref())?;
        }
        let entry_index = runtime
            .script_index_by_name(b"logwnd._bp")
            .ok_or_else(|| SakuraError::InvalidRuntime("logwnd._bp is missing".to_owned()))?;
        let handle = insert_runtime_for_test(runtime)?;
        let session = sakura_runtime_session_create(handle, entry_index, usize::MAX);
        assert_ne!(session, 0);

        let mut packet = vec![0; RUNTIME_SESSION_STEP_PACKET_LEN];
        let written = unsafe {
            sakura_runtime_session_step_write(
                session,
                64,
                100_000,
                packet.as_mut_ptr(),
                packet.len(),
            )
        };
        assert_eq!(written, RUNTIME_SESSION_STEP_PACKET_LEN);
        println!(
            "runtime_handles_click_probe_step=0 events={} completed={} limited={} sys1c={} sys49={} sys5f={} graphbf={} frame_script={} frame_cursor={} frame_last=0x{:x}",
            read_u32(&packet, 8)?,
            read_u32(&packet, 36)?,
            read_u32(&packet, 40)?,
            read_u32(&packet, 104)?,
            read_u32(&packet, 108)?,
            read_u32(&packet, 112)?,
            read_u32(&packet, 116)?,
            read_u32(&packet, 120)?,
            read_u32(&packet, 124)?,
            read_u32(&packet, 128)?,
        );

        assert_eq!(
            sakura_runtime_set_input(handle, 1, 0, 640, 360, 1, 1, 0, 0, 0, 0, 0, 0),
            1
        );
        let written = unsafe {
            sakura_runtime_session_step_write(
                session,
                64,
                100_000,
                packet.as_mut_ptr(),
                packet.len(),
            )
        };
        assert_eq!(written, RUNTIME_SESSION_STEP_PACKET_LEN);
        println!(
            "runtime_handles_click_probe_step=1 events={} completed={} limited={} halted={} sys1c={} sys49={} sys5f={} graphbf={} frame_script={} frame_cursor={} frame_last=0x{:x} last_family={} last_id={}",
            read_u32(&packet, 8)?,
            read_u32(&packet, 36)?,
            read_u32(&packet, 40)?,
            read_u32(&packet, 32)?,
            read_u32(&packet, 104)?,
            read_u32(&packet, 108)?,
            read_u32(&packet, 112)?,
            read_u32(&packet, 116)?,
            read_u32(&packet, 120)?,
            read_u32(&packet, 124)?,
            read_u32(&packet, 128)?,
            read_u32(&packet, 48)?,
            read_u32(&packet, 52)?,
        );

        assert_eq!(sakura_runtime_session_destroy(session), 1);
        assert_eq!(sakura_runtime_destroy(handle), 1);
        Ok(())
    }

    #[test]
    #[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
    fn reproduces_real_scrdrv_runtime_session_step_error() -> Result<()> {
        let game_dir = env::var_os("SAKURA_INSTALL_DIR")
            .map(PathBuf::from)
            .ok_or_else(|| {
                SakuraError::InvalidRuntime(
                    "SAKURA_INSTALL_DIR is required for this ignored local-install probe"
                        .to_owned(),
                )
            })?;
        let mut runtime = Runtime::new(RuntimeConfig::default());
        for path in collect_archive_files(&game_dir)? {
            let data = fs::read(&path).map_err(|error| {
                SakuraError::InvalidRuntime(format!("failed to read archive for test: {error}"))
            })?;
            runtime.mount_archive_data_named(data, path.file_name().and_then(OsStr::to_str).map(|name| name.as_bytes().to_vec()).as_deref())?;
        }
        let entry_index = runtime
            .script_index_by_name(b"scrdrv._bp")
            .ok_or_else(|| SakuraError::InvalidRuntime("scrdrv._bp is missing".to_owned()))?;
        let handle = insert_runtime_for_test(runtime)?;
        let session = sakura_runtime_session_create(handle, entry_index, usize::MAX);
        assert_ne!(session, 0);

        let mut packet = vec![0; RUNTIME_SESSION_STEP_PACKET_LEN];
        let mut dumped_stuck_replay = false;
        for step in 0..8usize {
            let written = unsafe {
                sakura_runtime_session_step_write(
                    session,
                    64,
                    100_000,
                    packet.as_mut_ptr(),
                    packet.len(),
                )
            };
            if written != RUNTIME_SESSION_STEP_PACKET_LEN {
                let error = write_runtime_session_step_packet(session, 64, 100_000, &mut packet)
                    .err()
                    .ok_or_else(|| {
                        SakuraError::InvalidRuntime(
                            "scrdrv session step packet unexpectedly succeeded after ffi failure"
                                .to_owned(),
                        )
                    })?;
                let store = lock_store()?;
                let session_state = store.sessions.get(&session).ok_or_else(|| {
                    SakuraError::InvalidRuntime(
                        "runtime session snapshot is missing after scrdrv probe failure".to_owned(),
                    )
                })?;
                let snapshot = session_state.state.clone();
                let runtime_handle = session_state.runtime_handle;
                let runtime_ref = store.runtime(runtime_handle)?;
                println!(
                    "runtime_handles_scrdrv_session_failure step={} error={error:?} frames={}",
                    step,
                    session_state.state.frames.len(),
                );
                for (frame_index, frame) in session_state.state.frames.iter().enumerate() {
                    let script_name = runtime_ref
                        .scripts()
                        .id_from_index(frame.script_index)
                        .and_then(|id| runtime_ref.scripts().name_by_id(id))
                        .map(|name| String::from_utf8_lossy(name).into_owned())
                        .unwrap_or_else(|| "<unknown>".to_owned());
                    println!(
                        "runtime_handles_scrdrv_session_frame index={} script={} name={} cursor={} mem_ptr=0x{:x} probe_entry={} halted={} last=0x{:x} mode={} return={}",
                        frame_index,
                        frame.script_index,
                        script_name,
                        frame.vm.cursor,
                        frame.vm.mem_ptr,
                        u8::from(frame.vm.probe_entry),
                        u8::from(frame.vm.halted),
                        frame.vm.last_instruction_offset.unwrap_or(0),
                        frame.mode,
                        frame
                            .return_value
                            .as_ref()
                            .map(describe_snapshot_value)
                            .unwrap_or_else(|| "none".to_owned()),
                    );
                }
                drop(store);
                let store = lock_store()?;
                let runtime = store.runtime(runtime_handle)?;
                let mut replay = SystemRuntime::restore(runtime, snapshot)?;
                for replay_step in 0..16usize {
                    match replay.run_with_service_trace(1, 100_000, 4) {
                        Ok((summary, trace)) => {
                            let frame = replay.current_frame_state();
                            println!(
                                "runtime_handles_scrdrv_session_replay_step={} events={} services={} user_calls={} halted={} completed={} limited={} frame_script={} frame_cursor={} frame_last=0x{:x} raw144556={} raw123420={} raw123424={} raw128560={} raw128564={} raw128576={} trace_total={} trace_head={}",
                                replay_step,
                                summary.event_count,
                                summary.service_event_count,
                                summary.user_call_event_count,
                                summary.halted_event_count,
                                u8::from(summary.completed),
                                u8::from(summary.event_limited),
                                frame.as_ref().map_or(usize::MAX, |frame| frame.script_index),
                                frame.as_ref().map_or(usize::MAX, |frame| frame.cursor),
                                frame.as_ref().map_or(0, |frame| frame.last_instruction_offset),
                                replay.current_frame_integer_raw(144556, 2).unwrap_or(0),
                                replay.current_frame_integer_raw(123420, 2).unwrap_or(0),
                                replay.current_frame_integer_raw(123424, 2).unwrap_or(0),
                                replay.current_frame_integer_raw(128560, 2).unwrap_or(0),
                                replay.current_frame_integer_raw(128564, 2).unwrap_or(0),
                                replay.current_frame_integer_raw(128576, 2).unwrap_or(0),
                                trace.total_service_count,
                                format_trace_head(trace.recorded_services.first()),
                            );
                            if frame
                                .as_ref()
                                .is_some_and(|frame| frame.last_instruction_offset == 0x36e)
                            {
                                let host = summary.host_state;
                                println!(
                                    "runtime_handles_scrdrv_session_stuck_host replay_step={} last_family={} last_id={:02x} last_arg_count={} last_top_kind={} graph_cursor={} raw144556={} l20={} l1264={} l1268={} l1272={} l1276={}",
                                    replay_step,
                                    host.last_family
                                        .map(family_label)
                                        .unwrap_or("none"),
                                    host.last_service_id,
                                    host.last_arg_count,
                                    host.last_top_kind,
                                    replay.snapshot().host.graph_cursor,
                                    replay.current_frame_integer_raw(144556, 2).unwrap_or(0),
                                    replay.current_frame_local_integer(20, 2).unwrap_or(0),
                                    replay.current_frame_local_integer(1264, 2).unwrap_or(0),
                                    replay.current_frame_local_integer(1268, 2).unwrap_or(0),
                                    replay.current_frame_local_integer(1272, 2).unwrap_or(0),
                                    replay.current_frame_local_integer(1276, 2).unwrap_or(0),
                                );
                                let stuck_snapshot = replay.snapshot();
                                let mut single = SystemRuntime::restore(runtime, stuck_snapshot)?;
                                for single_step in 0..12usize {
                                    match single.run_with_service_trace(1, 100_000, 4) {
                                        Ok((single_summary, single_trace)) => {
                                            let single_frame = single.current_frame_state();
                                            println!(
                                                "runtime_handles_scrdrv_session_single_step={} events={} services={} user_calls={} halted={} completed={} limited={} frame_script={} frame_cursor={} frame_last=0x{:x} raw144556={} l20={} l1264={} l1268={} l1272={} l1276={} trace_head={}",
                                                single_step,
                                                single_summary.event_count,
                                                single_summary.service_event_count,
                                                single_summary.user_call_event_count,
                                                single_summary.halted_event_count,
                                                u8::from(single_summary.completed),
                                                u8::from(single_summary.event_limited),
                                                single_frame
                                                    .as_ref()
                                                    .map_or(usize::MAX, |frame| frame.script_index),
                                                single_frame
                                                    .as_ref()
                                                    .map_or(usize::MAX, |frame| frame.cursor),
                                                single_frame
                                                    .as_ref()
                                                    .map_or(0, |frame| frame.last_instruction_offset),
                                                single.current_frame_integer_raw(144556, 2).unwrap_or(0),
                                                single.current_frame_local_integer(20, 2).unwrap_or(0),
                                                single.current_frame_local_integer(1264, 2).unwrap_or(0),
                                                single.current_frame_local_integer(1268, 2).unwrap_or(0),
                                                single.current_frame_local_integer(1272, 2).unwrap_or(0),
                                                single.current_frame_local_integer(1276, 2).unwrap_or(0),
                                                format_trace_head(single_trace.recorded_services.first()),
                                            );
                                        }
                                        Err(single_error) => {
                                            let single_frame = single.current_frame_state();
                                            println!(
                                                "runtime_handles_scrdrv_session_single_error step={} error={single_error:?} frame_script={} frame_cursor={} frame_last=0x{:x}",
                                                single_step,
                                                single_frame
                                                    .as_ref()
                                                    .map_or(usize::MAX, |frame| frame.script_index),
                                                single_frame
                                                    .as_ref()
                                                    .map_or(usize::MAX, |frame| frame.cursor),
                                                single_frame
                                                    .as_ref()
                                                    .map_or(0, |frame| frame.last_instruction_offset),
                                            );
                                            break;
                                        }
                                    }
                                }
                                break;
                            }
                        }
                        Err(replay_error) => {
                            let frame = replay.current_frame_state();
                            println!(
                                "runtime_handles_scrdrv_session_replay_error step={} error={replay_error:?} frame_script={} frame_cursor={} frame_last=0x{:x}",
                                replay_step,
                                frame.as_ref().map_or(usize::MAX, |frame| frame.script_index),
                                frame.as_ref().map_or(usize::MAX, |frame| frame.cursor),
                                frame.as_ref().map_or(0, |frame| frame.last_instruction_offset),
                            );
                            break;
                        }
                    }
                }
                assert_eq!(sakura_runtime_session_destroy(session), 1);
                assert_eq!(sakura_runtime_destroy(handle), 1);
                return Err(error);
            }
            println!(
                "runtime_handles_scrdrv_session_step={} events={} completed={} limited={} services={} sys1c={} sys49={} sys5f={} graphbf={} frame_script={} frame_cursor={} frame_last=0x{:x} local64={} local68={} local3956={} local4024={} local7100={} local7108={} raw144556={} raw123420={} raw123424={} raw128560={} raw128564={} raw128576={}",
                step,
                read_u32(&packet, 8)?,
                read_u32(&packet, 36)?,
                read_u32(&packet, 40)?,
                read_u32(&packet, 12)?,
                read_u32(&packet, 104)?,
                read_u32(&packet, 108)?,
                read_u32(&packet, 112)?,
                read_u32(&packet, 116)?,
                read_u32(&packet, 120)?,
                read_u32(&packet, 124)?,
                read_u32(&packet, 128)?,
                read_u32(&packet, 148)?,
                read_u32(&packet, 152)?,
                read_u32(&packet, 176)?,
                read_u32(&packet, 192)?,
                read_u32(&packet, 204)?,
                read_u32(&packet, 212)?,
                current_session_raw_integer(session, 144556, 2).ok().flatten().unwrap_or(0),
                current_session_raw_integer(session, 123420, 2).ok().flatten().unwrap_or(0),
                current_session_raw_integer(session, 123424, 2).ok().flatten().unwrap_or(0),
                current_session_raw_integer(session, 128560, 2).ok().flatten().unwrap_or(0),
                current_session_raw_integer(session, 128564, 2).ok().flatten().unwrap_or(0),
                current_session_raw_integer(session, 128576, 2).ok().flatten().unwrap_or(0),
            );
            if !dumped_stuck_replay
                && read_u32(&packet, 120)? == 6
                && read_u32(&packet, 128)? == 0x36e
            {
                let store = lock_store()?;
                let session_state = store.sessions.get(&session).ok_or_else(|| {
                    SakuraError::InvalidRuntime(
                        "runtime session snapshot is missing for scrdrv stuck replay".to_owned(),
                    )
                })?;
                let snapshot = session_state.state.clone();
                let runtime = store.runtime(session_state.runtime_handle)?;
                dump_scrdrv_stuck_replay(runtime, snapshot)?;
                dumped_stuck_replay = true;
            }
        }

        assert_eq!(sakura_runtime_session_destroy(session), 1);
        assert_eq!(sakura_runtime_destroy(handle), 1);
        Ok(())
    }

    #[test]
    #[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
    fn probes_real_scrdrv_runtime_graph_queue_memory() -> Result<()> {
        let game_dir = env::var_os("SAKURA_INSTALL_DIR")
            .map(PathBuf::from)
            .ok_or_else(|| {
                SakuraError::InvalidRuntime(
                    "SAKURA_INSTALL_DIR is required for this ignored local-install probe"
                        .to_owned(),
                )
            })?;
        let mut runtime = Runtime::new(RuntimeConfig::default());
        for path in collect_archive_files(&game_dir)? {
            let data = fs::read(&path).map_err(|error| {
                SakuraError::InvalidRuntime(format!("failed to read archive for test: {error}"))
            })?;
            runtime.mount_archive_data_named(
                data,
                path.file_name()
                    .and_then(OsStr::to_str)
                    .map(|name| name.as_bytes().to_vec())
                    .as_deref(),
            )?;
        }
        let entry_index = runtime
            .script_index_by_name(b"scrdrv._bp")
            .ok_or_else(|| SakuraError::InvalidRuntime("scrdrv._bp is missing".to_owned()))?;
        let handle = insert_runtime_for_test(runtime)?;
        let session = sakura_runtime_session_create(handle, entry_index, usize::MAX);
        assert_ne!(session, 0);

        let mut packet = vec![0; RUNTIME_SESSION_STEP_PACKET_LEN];
        println!("runtime_handles_scrdrv_graph_probe_version=1");
        let mut previous_graph_recorded = 0u32;
        for step in 0..24usize {
            let written = unsafe {
                sakura_runtime_session_step_write(
                    session,
                    8,
                    100_000,
                    packet.as_mut_ptr(),
                    packet.len(),
                )
            };
            assert_eq!(written, RUNTIME_SESSION_STEP_PACKET_LEN);
            let graph_len = RUNTIME_GRAPH_QUEUE_PACKET_LEN;
            let mut graph_packet = vec![0; graph_len];
            let graph_written = unsafe {
                sakura_runtime_session_graph_queue_write(
                    session,
                    graph_packet.as_mut_ptr(),
                    graph_packet.len(),
                )
            };
            assert_eq!(graph_written, graph_len);
            let graph_recorded = read_u32(&graph_packet, 24)?;
            let should_dump = graph_recorded > previous_graph_recorded
                || matches!(step, 0 | 1 | 2 | 3 | 7 | 11 | 15 | 23);
            previous_graph_recorded = graph_recorded;
            if !should_dump {
                continue;
            }
            println!(
                "runtime_handles_scrdrv_graph_probe_step={} events={} services={} completed={} limited={} frame_script={} frame_last=0x{:x} graph_recorded={}",
                step,
                read_u32(&packet, 8)?,
                read_u32(&packet, 12)?,
                read_u32(&packet, 36)?,
                read_u32(&packet, 40)?,
                read_u32(&packet, 120)?,
                read_u32(&packet, 128)?,
                graph_recorded,
            );
            for event_index in 0..graph_recorded.min(6) {
                let base = 32 + event_index as usize * RUNTIME_GRAPH_EVENT_LEN;
                let service_id = read_u32(&graph_packet, base + 8)?;
                let arg_count = read_u32(&graph_packet, base + 12)? as usize;
                let instruction_offset = read_u32(&graph_packet, base + 48)?;
                println!(
                    "runtime_handles_scrdrv_graph_probe_event step={} index={} service_id={:02x} args={} offset=0x{:x}",
                    step,
                    event_index,
                    service_id,
                    arg_count,
                    instruction_offset,
                );
                for arg_index in 0..arg_count.min(6) {
                    let arg_base = base + 52 + arg_index * 16;
                    let kind = read_u32(&graph_packet, arg_base)?;
                    let value = read_u32(&graph_packet, arg_base + 4)?;
                    let len = read_u32(&graph_packet, arg_base + 8)?;
                    let hash = read_u32(&graph_packet, arg_base + 12)?;
                    println!(
                        "runtime_handles_scrdrv_graph_probe_arg step={} event={} arg={} kind={} value=0x{:x} len={} hash=0x{:x}",
                        step,
                        event_index,
                        arg_index,
                        kind,
                        value,
                        len,
                        hash,
                    );
                    let mut candidate_addresses = Vec::new();
                    if kind == 6 {
                        candidate_addresses.push(0x1200_0000u32 | (value & 0x01ff_ffff));
                    } else if kind == 1 {
                        if value >= 0x1200_0000 {
                            candidate_addresses.push(value);
                        } else if value > 0 && value <= 0x01ff_ffff {
                            candidate_addresses.push(0x1200_0000u32 | value);
                        }
                    }
                    for address in candidate_addresses {
                        let mem_len = sakura_runtime_session_memory_len(session, address, 32);
                        if mem_len == 0 {
                            continue;
                        }
                        let mut mem = vec![0; mem_len];
                        let mem_written = unsafe {
                            sakura_runtime_session_memory_write(
                                session,
                                address,
                                32,
                                mem.as_mut_ptr(),
                                mem.len(),
                            )
                        };
                        println!(
                            "runtime_handles_scrdrv_graph_probe_mem step={} event={} arg={} address=0x{:x} written={} bytes={}",
                            step,
                            event_index,
                            arg_index,
                            address,
                            mem_written,
                            format_bytes_hex(&mem[..mem_written.min(mem.len())]),
                        );
                    }
                }
            }
        }

        assert_eq!(sakura_runtime_session_destroy(session), 1);
        assert_eq!(sakura_runtime_destroy(handle), 1);
        Ok(())
    }


    #[test]
    #[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
    fn traces_real_scrdrv_session_chunk_progression() -> Result<()> {
        let game_dir = env::var_os("SAKURA_INSTALL_DIR")
            .map(PathBuf::from)
            .ok_or_else(|| {
                SakuraError::InvalidRuntime(
                    "SAKURA_INSTALL_DIR is required for this ignored local-install probe"
                        .to_owned(),
                )
            })?;
        let mut runtime = Runtime::new(RuntimeConfig::default());
        for path in collect_archive_files(&game_dir)? {
            let data = fs::read(&path).map_err(|error| {
                SakuraError::InvalidRuntime(format!("failed to read archive for test: {error}"))
            })?;
            runtime.mount_archive_data_named(data, path.file_name().and_then(OsStr::to_str).map(|name| name.as_bytes().to_vec()).as_deref())?;
        }
        let entry_index = runtime
            .script_index_by_name(b"scrdrv._bp")
            .ok_or_else(|| SakuraError::InvalidRuntime("scrdrv._bp is missing".to_owned()))?;
        let handle = insert_runtime_for_test(runtime)?;
        let session = sakura_runtime_session_create(handle, entry_index, usize::MAX);
        assert_ne!(session, 0);

        println!("runtime_handles_scrdrv_session_chunk_progress_version=1");
        let mut packet = vec![0; RUNTIME_SESSION_STEP_PACKET_LEN];
        for chunk in 0..16usize {
            let written = unsafe {
                sakura_runtime_session_step_write(
                    session,
                    64,
                    100_000,
                    packet.as_mut_ptr(),
                    packet.len(),
                )
            };
            if written != RUNTIME_SESSION_STEP_PACKET_LEN {
                let error = write_runtime_session_step_packet(session, 64, 100_000, &mut packet)
                    .err()
                    .ok_or_else(|| {
                        SakuraError::InvalidRuntime(
                            "scrdrv session progression probe unexpectedly succeeded after ffi failure"
                                .to_owned(),
                        )
                    })?;
                assert_eq!(sakura_runtime_session_destroy(session), 1);
                assert_eq!(sakura_runtime_destroy(handle), 1);
                return Err(error);
            }

            let store = lock_store()?;
            let session_state = store.sessions.get(&session).ok_or_else(|| {
                SakuraError::InvalidRuntime(
                    "runtime session snapshot is missing for scrdrv progression probe".to_owned(),
                )
            })?;
            let snapshot = session_state.state.clone();
            let runtime = store.runtime(session_state.runtime_handle)?;
            let mut replay = SystemRuntime::restore(runtime, snapshot)?;
            let frame = replay.current_frame_state().unwrap_or_default();
            let l12 = replay.current_frame_local_integer(12, 2).unwrap_or(0);
            let l16 = replay.current_frame_local_integer(16, 2).unwrap_or(0);
            let l20 = replay.current_frame_local_integer(20, 2).unwrap_or(0);
            let l1264 = replay.current_frame_local_integer(1264, 2).unwrap_or(0);
            let l1268 = replay.current_frame_local_integer(1268, 2).unwrap_or(0);
            let l1272 = replay.current_frame_local_integer(1272, 2).unwrap_or(0);
            let l1276 = replay.current_frame_local_integer(1276, 2).unwrap_or(0);
            let next = replay.run_with_service_trace(1, 100_000, 4)?;
            let next_frame = replay.current_frame_state().unwrap_or_default();
            println!(
                "runtime_handles_scrdrv_session_chunk chunk={} packet_events={} packet_services={} packet_frame_script={} packet_frame_cursor={} packet_frame_last=0x{:x} before_script={} before_cursor={} before_last=0x{:x} l12={} l16={} l20={} l1264={} l1268={} l1272={} l1276={} next_events={} next_services={} next_user_calls={} next_frame_script={} next_frame_cursor={} next_frame_last=0x{:x} next_trace_head={}",
                chunk,
                read_u32(&packet, 8)?,
                read_u32(&packet, 12)?,
                read_u32(&packet, 120)?,
                read_u32(&packet, 124)?,
                read_u32(&packet, 128)?,
                frame.script_index,
                frame.cursor,
                frame.last_instruction_offset,
                l12,
                l16,
                l20,
                l1264,
                l1268,
                l1272,
                l1276,
                next.0.event_count,
                next.0.service_event_count,
                next.0.user_call_event_count,
                next_frame.script_index,
                next_frame.cursor,
                next_frame.last_instruction_offset,
                format_trace_head(next.1.recorded_services.first()),
            );
        }

        assert_eq!(sakura_runtime_session_destroy(session), 1);
        assert_eq!(sakura_runtime_destroy(handle), 1);
        Ok(())
    }

    #[test]
    #[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
    fn traces_real_scrdrv_session_graph_inline_strings() -> Result<()> {
        let game_dir = env::var_os("SAKURA_INSTALL_DIR")
            .map(PathBuf::from)
            .ok_or_else(|| {
                SakuraError::InvalidRuntime(
                    "SAKURA_INSTALL_DIR is required for this ignored local-install probe"
                        .to_owned(),
                )
            })?;
        let mut runtime = Runtime::new(RuntimeConfig::default());
        for path in collect_archive_files(&game_dir)? {
            let data = fs::read(&path).map_err(|error| {
                SakuraError::InvalidRuntime(format!("failed to read archive for test: {error}"))
            })?;
            runtime.mount_archive_data_named(
                data,
                path.file_name()
                    .and_then(OsStr::to_str)
                    .map(|name| name.as_bytes().to_vec())
                    .as_deref(),
            )?;
        }
        let entry_index = runtime
            .script_index_by_name(b"scrdrv._bp")
            .ok_or_else(|| SakuraError::InvalidRuntime("scrdrv._bp is missing".to_owned()))?;
        let handle = insert_runtime_for_test(runtime)?;
        let mut packet = vec![0; RUNTIME_SESSION_STEP_PACKET_LEN];
        let mut graph_packet = vec![0; RUNTIME_GRAPH_QUEUE_PACKET_LEN];
        println!("runtime_handles_scrdrv_session_graph_inline_probe_version=2");
        for max_events in [1usize, 2, 4, 8, 16] {
            let session = sakura_runtime_session_create(handle, entry_index, usize::MAX);
            assert_ne!(session, 0);
            println!(
                "runtime_handles_scrdrv_session_graph_inline_batch max_events={}",
                max_events
            );
            for step in 0..220usize {
                let written = unsafe {
                    sakura_runtime_session_step_write(
                        session,
                        max_events,
                        100_000,
                        packet.as_mut_ptr(),
                        packet.len(),
                    )
                };
                assert_eq!(written, RUNTIME_SESSION_STEP_PACKET_LEN);
                let pending_len = sakura_runtime_session_pending_asset_len(session);
                let graph_written = unsafe {
                    sakura_runtime_session_graph_queue_write(
                        session,
                        graph_packet.as_mut_ptr(),
                        graph_packet.len(),
                    )
                };
                assert_eq!(graph_written, RUNTIME_GRAPH_QUEUE_PACKET_LEN);

                let frame_script = read_u32(&packet, 120)?;
                let frame_last = read_u32(&packet, 128)?;
                let graph_recorded = read_u32(&graph_packet, 24)?;
                let mut printed = false;
                for event_index in 0..graph_recorded {
                    let base = 32 + event_index as usize * RUNTIME_GRAPH_EVENT_LEN;
                    let service_id = read_u32(&graph_packet, base + 8)?;
                    let offset = read_u32(&graph_packet, base + 48)?;
                    let inline_count = read_u32(
                        &graph_packet,
                        base + 52 + SYSTEM_SERVICE_TRACE_ARG_SLOTS * 16,
                    )?;
                    if inline_count == 0 {
                        continue;
                    }
                    printed = true;
                    println!(
                        "runtime_handles_scrdrv_session_graph_inline step={} max_events={} frame_script={} frame_last=0x{:x} packet_events={} packet_services={} pending_len={} graph_recorded={} event={} service={:02x} offset=0x{:x} inline_count={}",
                        step,
                        max_events,
                        frame_script,
                        frame_last,
                        read_u32(&packet, 8)?,
                        read_u32(&packet, 12)?,
                        pending_len,
                        graph_recorded,
                        event_index,
                        service_id,
                        offset,
                        inline_count,
                    );
                    let mut cursor = base + 52 + SYSTEM_SERVICE_TRACE_ARG_SLOTS * 16 + 16;
                    for inline_index in 0..inline_count.min(4) {
                        let arg_index = read_u32(&graph_packet, cursor)?;
                        let byte_len = read_u32(&graph_packet, cursor + 4)? as usize;
                        let full_len = read_u32(&graph_packet, cursor + 8)?;
                        let hash = read_u32(&graph_packet, cursor + 12)?;
                        let bytes = &graph_packet[cursor + 16..cursor + 16 + byte_len.min(64)];
                        let text_end =
                            bytes.iter().position(|byte| *byte == 0).unwrap_or(bytes.len());
                        let text = String::from_utf8_lossy(&bytes[..text_end]);
                        println!(
                            "runtime_handles_scrdrv_session_graph_inline_slot step={} max_events={} event={} inline={} arg={} byte_len={} full_len={} hash=0x{:08x} text={}",
                            step,
                            max_events,
                            event_index,
                            inline_index,
                            arg_index,
                            byte_len,
                            full_len,
                            hash,
                            text,
                        );
                        cursor += 16 + SYSTEM_SERVICE_TRACE_INLINE_STRING_MAX_BYTES;
                    }
                }
                if printed {
                    assert_eq!(sakura_runtime_session_destroy(session), 1);
                    assert_eq!(sakura_runtime_destroy(handle), 1);
                    return Ok(());
                }
            }
            assert_eq!(sakura_runtime_session_destroy(session), 1);
        }

        assert_eq!(sakura_runtime_destroy(handle), 1);
        Err(SakuraError::InvalidRuntime(
            "no runtime session graph inline strings were observed from scrdrv".to_owned(),
        ))
    }

    #[test]
    #[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
    fn traces_real_scrdrv_bitmap_loaded_call_context() -> Result<()> {
        let game_dir = env::var_os("SAKURA_INSTALL_DIR")
            .map(PathBuf::from)
            .ok_or_else(|| {
                SakuraError::InvalidRuntime(
                    "SAKURA_INSTALL_DIR is required for this ignored local-install probe"
                        .to_owned(),
                )
            })?;
        let mut runtime = Runtime::new(RuntimeConfig::default());
        for path in collect_archive_files(&game_dir)? {
            let data = fs::read(&path).map_err(|error| {
                SakuraError::InvalidRuntime(format!("failed to read archive for test: {error}"))
            })?;
            runtime.mount_archive_data_named(
                data,
                path.file_name()
                    .and_then(OsStr::to_str)
                    .map(|name| name.as_bytes().to_vec())
                    .as_deref(),
            )?;
        }
        let entry_index = runtime
            .script_index_by_name(b"scrdrv._bp")
            .ok_or_else(|| SakuraError::InvalidRuntime("scrdrv._bp is missing".to_owned()))?;
        let scripts = runtime.scripts();
        let entry = scripts
            .id_from_index(entry_index)
            .ok_or_else(|| SakuraError::InvalidRuntime("scrdrv entry is invalid".to_owned()))?;
        let host = SystemHost::with_runtime(&runtime);
        let mut system_runtime = SystemRuntime::new(scripts, host);
        system_runtime.push_script_at(entry, None, Vec::new())?;

        println!("runtime_handles_scrdrv_bitmap_loaded_call_context_version=1");
        for step in 0..160usize {
            let before = system_runtime.snapshot();
            let before_frame = system_runtime.current_frame_state().unwrap_or_default();
            let (summary, trace) =
                system_runtime.run_with_service_trace(1, 100_000, 8)?;
            let after = system_runtime.snapshot();
            let after_frame = system_runtime.current_frame_state().unwrap_or_default();
            println!(
                "runtime_handles_scrdrv_bitmap_loaded_call_step={} before_script={} before_last=0x{:x} after_script={} after_last=0x{:x} completed={} limited={} trace={}",
                step,
                before_frame.script_index,
                before_frame.last_instruction_offset,
                after_frame.script_index,
                after_frame.last_instruction_offset,
                u8::from(summary.completed),
                u8::from(summary.event_limited),
                format_trace_head(trace.recorded_services.first()),
            );
            if after_frame.script_index == 5 && after_frame.last_instruction_offset == 0 {
                println!(
                    "runtime_handles_scrdrv_bitmap_loaded_call_before_frames={}",
                    before
                        .frames
                        .iter()
                        .enumerate()
                        .map(|(index, frame)| {
                            format!(
                                "{}:{}:cursor={}:last=0x{:x}:mem=0x{:x}:stack={}:return={}",
                                index,
                                frame.script_index,
                                frame.vm.cursor,
                                frame.vm.last_instruction_offset.unwrap_or(0),
                                frame.vm.mem_ptr,
                                format_snapshot_stack(&frame.vm.stack),
                                frame
                                    .return_value
                                    .as_ref()
                                    .map(describe_snapshot_value)
                                    .unwrap_or_else(|| "none".to_owned()),
                            )
                        })
                        .collect::<Vec<_>>()
                        .join(" || ")
                );
                println!(
                    "runtime_handles_scrdrv_bitmap_loaded_call_after_frames={}",
                    after
                        .frames
                        .iter()
                        .enumerate()
                        .map(|(index, frame)| {
                            format!(
                                "{}:{}:cursor={}:last=0x{:x}:mem=0x{:x}:stack={}:return={}",
                                index,
                                frame.script_index,
                                frame.vm.cursor,
                                frame.vm.last_instruction_offset.unwrap_or(0),
                                frame.vm.mem_ptr,
                                format_snapshot_stack(&frame.vm.stack),
                                frame
                                    .return_value
                                    .as_ref()
                                    .map(describe_snapshot_value)
                                    .unwrap_or_else(|| "none".to_owned()),
                            )
                        })
                        .collect::<Vec<_>>()
                        .join(" || ")
                );
                let next = system_runtime.run_with_service_trace(1, 100_000, 8)?;
                let next_frame = system_runtime.current_frame_state().unwrap_or_default();
                println!(
                    "runtime_handles_scrdrv_bitmap_loaded_call_next after_script={} after_last=0x{:x} next_trace={}",
                    next_frame.script_index,
                    next_frame.last_instruction_offset,
                    format_trace_head(next.1.recorded_services.first()),
                );
                return Ok(());
            }
        }
        Err(SakuraError::InvalidRuntime(
            "scrdrv did not enter bitmap._bp during probe window".to_owned(),
        ))
    }

    #[test]
    #[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
    fn traces_real_scrdrv_code_pointer_seed_transition() -> Result<()> {
        let game_dir = env::var_os("SAKURA_INSTALL_DIR")
            .map(PathBuf::from)
            .ok_or_else(|| {
                SakuraError::InvalidRuntime(
                    "SAKURA_INSTALL_DIR is required for this ignored local-install probe"
                        .to_owned(),
                )
            })?;
        let mut runtime = Runtime::new(RuntimeConfig::default());
        for path in collect_archive_files(&game_dir)? {
            let data = fs::read(&path).map_err(|error| {
                SakuraError::InvalidRuntime(format!("failed to read archive for test: {error}"))
            })?;
            runtime.mount_archive_data_named(data, path.file_name().and_then(OsStr::to_str).map(|name| name.as_bytes().to_vec()).as_deref())?;
        }
        let entry_index = runtime
            .script_index_by_name(b"scrdrv._bp")
            .ok_or_else(|| SakuraError::InvalidRuntime("scrdrv._bp is missing".to_owned()))?;
        let scripts = runtime.scripts();
        let entry = scripts
            .id_from_index(entry_index)
            .ok_or_else(|| SakuraError::InvalidRuntime("scrdrv entry is invalid".to_owned()))?;
        let host = SystemHost::with_runtime(&runtime);
        let mut system_runtime = SystemRuntime::new(scripts, host);
        system_runtime.push_script_at(entry, None, Vec::new())?;

        let watched = [
            123420u32, 123424, 128560, 128564, 128576, 128724, 128728, 128732, 128736, 128740,
            128744, 128748, 128752, 128756, 144560, 144964, 144976, 144980, 144984, 146016, 146020,
        ];
        let key_seeded = [123420u32, 123424, 128560, 128564, 128576];
        let mut previous = watched
            .iter()
            .map(|address| {
                system_runtime
                    .current_frame_integer_raw(*address, 2)
                    .unwrap_or(0)
            })
            .collect::<Vec<_>>();
        println!("runtime_handles_scrdrv_codeptr_seed_probe_version=1");
        println!(
            "runtime_handles_scrdrv_codeptr_seed_initial frame_script={} frame_cursor={} frame_last=0x{:x} values={}",
            system_runtime
                .current_frame_state()
                .as_ref()
                .map_or(usize::MAX, |frame| frame.script_index),
            system_runtime
                .current_frame_state()
                .as_ref()
                .map_or(usize::MAX, |frame| frame.cursor),
            system_runtime
                .current_frame_state()
                .as_ref()
                .map_or(0, |frame| frame.last_instruction_offset),
            format_watched_values(&watched, &previous),
        );

        let mut first_all_seeded = None;
        for step in 0..256usize {
            let (summary, trace) = system_runtime.run_with_service_trace(1, 100_000, 4)?;
            let frame = system_runtime.current_frame_state();
            let current = watched
                .iter()
                .map(|address| {
                    system_runtime
                        .current_frame_integer_raw(*address, 2)
                        .unwrap_or(0)
                })
                .collect::<Vec<_>>();
            let changes = watched
                .iter()
                .zip(previous.iter().zip(current.iter()))
                .filter_map(|(address, (before, after))| {
                    (before != after)
                        .then_some(format!("0x{address:x}:{before:#010x}->{after:#010x}"))
                })
                .collect::<Vec<_>>();
            if !changes.is_empty() {
                println!(
                    "runtime_handles_scrdrv_codeptr_seed_change step={} events={} services={} user_calls={} frame_script={} frame_cursor={} frame_last=0x{:x} trace_head={} changes={}",
                    step,
                    summary.event_count,
                    summary.service_event_count,
                    summary.user_call_event_count,
                    frame.as_ref().map_or(usize::MAX, |state| state.script_index),
                    frame.as_ref().map_or(usize::MAX, |state| state.cursor),
                    frame.as_ref().map_or(0, |state| state.last_instruction_offset),
                    format_trace_head(trace.recorded_services.first()),
                    changes.join(","),
                );
            }
            if first_all_seeded.is_none()
                && key_seeded.iter().all(|address| {
                    system_runtime
                        .current_frame_integer_raw(*address, 2)
                        .unwrap_or(0)
                        != 0
                })
            {
                first_all_seeded = Some(step);
                println!(
                    "runtime_handles_scrdrv_codeptr_seed_ready step={} frame_script={} frame_cursor={} frame_last=0x{:x} trace_head={} values={}",
                    step,
                    frame.as_ref().map_or(usize::MAX, |state| state.script_index),
                    frame.as_ref().map_or(usize::MAX, |state| state.cursor),
                    frame.as_ref().map_or(0, |state| state.last_instruction_offset),
                    format_trace_head(trace.recorded_services.first()),
                    format_watched_values(&watched, &current),
                );
                break;
            }
            previous = current;
        }

        assert!(first_all_seeded.is_some());
        Ok(())
    }

    #[test]
    #[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
    fn traces_real_scrdrv_code_pointer_seed_boundary() -> Result<()> {
        let game_dir = env::var_os("SAKURA_INSTALL_DIR")
            .map(PathBuf::from)
            .ok_or_else(|| {
                SakuraError::InvalidRuntime(
                    "SAKURA_INSTALL_DIR is required for this ignored local-install probe"
                        .to_owned(),
                )
            })?;
        let mut runtime = Runtime::new(RuntimeConfig::default());
        for path in collect_archive_files(&game_dir)? {
            let data = fs::read(&path).map_err(|error| {
                SakuraError::InvalidRuntime(format!("failed to read archive for test: {error}"))
            })?;
            runtime.mount_archive_data_named(data, path.file_name().and_then(OsStr::to_str).map(|name| name.as_bytes().to_vec()).as_deref())?;
        }
        let entry_index = runtime
            .script_index_by_name(b"scrdrv._bp")
            .ok_or_else(|| SakuraError::InvalidRuntime("scrdrv._bp is missing".to_owned()))?;
        let scripts = runtime.scripts();
        let entry = scripts
            .id_from_index(entry_index)
            .ok_or_else(|| SakuraError::InvalidRuntime("scrdrv entry is invalid".to_owned()))?;
        let host = SystemHost::with_runtime(&runtime);
        let mut system_runtime = SystemRuntime::new(scripts, host);
        system_runtime.push_script_at(entry, None, Vec::new())?;

        let watched = [123420u32, 123424, 128560, 128564, 128576];
        let mut pre_seed_snapshot = None;
        println!("runtime_handles_scrdrv_codeptr_seed_boundary_version=1");
        for step in 0..64usize {
            let before_snapshot = system_runtime.snapshot();
            let before_values = watched
                .iter()
                .map(|address| {
                    system_runtime
                        .current_frame_integer_raw(*address, 2)
                        .unwrap_or(0)
                })
                .collect::<Vec<_>>();
            let (summary, trace) = system_runtime.run_with_service_trace(1, 100_000, 4)?;
            let after_values = watched
                .iter()
                .map(|address| {
                    system_runtime
                        .current_frame_integer_raw(*address, 2)
                        .unwrap_or(0)
                })
                .collect::<Vec<_>>();
            if before_values.iter().all(|value| *value == 0)
                && after_values.iter().any(|value| *value != 0)
            {
                let frame = system_runtime.current_frame_state();
                println!(
                    "runtime_handles_scrdrv_codeptr_seed_event step={} events={} services={} user_calls={} frame_script={} frame_cursor={} frame_last=0x{:x} trace_head={} before={} after={}",
                    step,
                    summary.event_count,
                    summary.service_event_count,
                    summary.user_call_event_count,
                    frame.as_ref().map_or(usize::MAX, |state| state.script_index),
                    frame.as_ref().map_or(usize::MAX, |state| state.cursor),
                    frame.as_ref().map_or(0, |state| state.last_instruction_offset),
                    format_trace_head(trace.recorded_services.first()),
                    format_watched_values(&watched, &before_values),
                    format_watched_values(&watched, &after_values),
                );
                pre_seed_snapshot = Some(before_snapshot);
                break;
            }
        }
        let pre_seed_snapshot = pre_seed_snapshot.ok_or_else(|| {
            SakuraError::InvalidRuntime("failed to capture pre-seed snapshot".to_owned())
        })?;

        for limit in [
            1usize, 2, 4, 8, 16, 24, 32, 48, 64, 96, 128, 256, 512, 1024, 2048,
        ] {
            let mut replay = SystemRuntime::restore(&runtime, pre_seed_snapshot.clone())?;
            let result = replay.run_with_service_trace(1, limit, 4);
            match result {
                Ok((summary, trace)) => {
                    let frame = replay.current_frame_state();
                    let values = watched
                        .iter()
                        .map(|address| replay.current_frame_integer_raw(*address, 2).unwrap_or(0))
                        .collect::<Vec<_>>();
                    println!(
                        "runtime_handles_scrdrv_codeptr_seed_limit limit={} ok events={} services={} user_calls={} halted={} completed={} limited={} frame_script={} frame_cursor={} frame_last=0x{:x} trace_head={} values={}",
                        limit,
                        summary.event_count,
                        summary.service_event_count,
                        summary.user_call_event_count,
                        summary.halted_event_count,
                        u8::from(summary.completed),
                        u8::from(summary.event_limited),
                        frame.as_ref().map_or(usize::MAX, |state| state.script_index),
                        frame.as_ref().map_or(usize::MAX, |state| state.cursor),
                        frame.as_ref().map_or(0, |state| state.last_instruction_offset),
                        format_trace_head(trace.recorded_services.first()),
                        format_watched_values(&watched, &values),
                    );
                }
                Err(error) => {
                    let frame = replay.current_frame_state();
                    let values = watched
                        .iter()
                        .map(|address| replay.current_frame_integer_raw(*address, 2).unwrap_or(0))
                        .collect::<Vec<_>>();
                    println!(
                        "runtime_handles_scrdrv_codeptr_seed_limit limit={} err={error:?} frame_script={} frame_cursor={} frame_last=0x{:x} values={}",
                        limit,
                        frame.as_ref().map_or(usize::MAX, |state| state.script_index),
                        frame.as_ref().map_or(usize::MAX, |state| state.cursor),
                        frame.as_ref().map_or(0, |state| state.last_instruction_offset),
                        format_watched_values(&watched, &values),
                    );
                }
            }
        }
        Ok(())
    }

    #[test]
    #[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
    fn experiments_real_scrdrv_scrmain_post_8a_stack_patch() -> Result<()> {
        let game_dir = env::var_os("SAKURA_INSTALL_DIR")
            .map(PathBuf::from)
            .ok_or_else(|| {
                SakuraError::InvalidRuntime(
                    "SAKURA_INSTALL_DIR is required for this ignored local-install probe"
                        .to_owned(),
                )
            })?;
        let mut runtime = Runtime::new(RuntimeConfig::default());
        for path in collect_archive_files(&game_dir)? {
            let data = fs::read(&path).map_err(|error| {
                SakuraError::InvalidRuntime(format!("failed to read archive for test: {error}"))
            })?;
            runtime.mount_archive_data_named(data, path.file_name().and_then(OsStr::to_str).map(|name| name.as_bytes().to_vec()).as_deref())?;
        }
        let entry_index = runtime
            .script_index_by_name(b"scrdrv._bp")
            .ok_or_else(|| SakuraError::InvalidRuntime("scrdrv._bp is missing".to_owned()))?;
        let scripts = runtime.scripts();
        let entry = scripts
            .id_from_index(entry_index)
            .ok_or_else(|| SakuraError::InvalidRuntime("scrdrv entry is invalid".to_owned()))?;
        let host = SystemHost::with_runtime(&runtime);
        let mut system_runtime = SystemRuntime::new(scripts, host);
        system_runtime.push_script_at(entry, None, Vec::new())?;

        let mut seeded_snapshot = None;
        for _step in 0..256usize {
            let (_summary, _trace) = system_runtime.run_with_service_trace(1, 100_000, 4)?;
            let frame = system_runtime.current_frame_state();
            if frame.as_ref().is_some_and(|state| {
                state.script_index == 6
                    && state.cursor == 0x370
                    && state.last_instruction_offset == 0x36e
            }) {
                seeded_snapshot = Some(system_runtime.snapshot());
                break;
            }
        }
        let seeded_snapshot = seeded_snapshot.ok_or_else(|| {
            SakuraError::InvalidRuntime("failed to reach post-8a scrmain snapshot".to_owned())
        })?;

        println!("runtime_handles_scrmain_post_8a_patch_probe_version=1");
        for patched_value in [0u64, 1u64] {
            let mut patched = seeded_snapshot.clone();
            let stack = &mut patched
                .frames
                .last_mut()
                .ok_or_else(|| {
                    SakuraError::InvalidRuntime(
                        "patched snapshot frame stack is missing".to_owned(),
                    )
                })?
                .vm
                .stack;
            let top = stack.last_mut().ok_or_else(|| {
                SakuraError::InvalidRuntime("patched snapshot stack top is missing".to_owned())
            })?;
            *top = crate::system_vm::SystemValueSnapshot::Integer(patched_value);

            let mut replay = SystemRuntime::restore(&runtime, patched)?;
            for replay_step in 0..8usize {
                let (summary, trace) = replay.run_with_service_trace(1, 100_000, 4)?;
                let frame = replay.current_frame_state();
                let stack_snapshot = replay.snapshot();
                println!(
                    "runtime_handles_scrmain_post_8a_patch value={} replay_step={} events={} services={} user_calls={} halted={} completed={} limited={} frame_script={} frame_cursor={} frame_last=0x{:x} l20={} stack={} trace_head={}",
                    patched_value,
                    replay_step,
                    summary.event_count,
                    summary.service_event_count,
                    summary.user_call_event_count,
                    summary.halted_event_count,
                    u8::from(summary.completed),
                    u8::from(summary.event_limited),
                    frame.as_ref().map_or(usize::MAX, |state| state.script_index),
                    frame.as_ref().map_or(usize::MAX, |state| state.cursor),
                    frame.as_ref().map_or(0, |state| state.last_instruction_offset),
                    replay.current_frame_local_integer(20, 2).unwrap_or(0),
                    stack_snapshot
                        .frames
                        .last()
                        .map(|state| format_snapshot_stack(&state.vm.stack))
                        .unwrap_or_else(|| "none".to_owned()),
                    format_trace_head(trace.recorded_services.first()),
                );
            }
        }
        Ok(())
    }

    #[test]
    #[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
    fn traces_real_scrdrv_code_pointer_slot_metadata() -> Result<()> {
        let game_dir = env::var_os("SAKURA_INSTALL_DIR")
            .map(PathBuf::from)
            .ok_or_else(|| {
                SakuraError::InvalidRuntime(
                    "SAKURA_INSTALL_DIR is required for this ignored local-install probe"
                        .to_owned(),
                )
            })?;
        let mut runtime = Runtime::new(RuntimeConfig::default());
        for path in collect_archive_files(&game_dir)? {
            let data = fs::read(&path).map_err(|error| {
                SakuraError::InvalidRuntime(format!("failed to read archive for test: {error}"))
            })?;
            runtime.mount_archive_data_named(data, path.file_name().and_then(OsStr::to_str).map(|name| name.as_bytes().to_vec()).as_deref())?;
        }
        let entry_index = runtime
            .script_index_by_name(b"scrdrv._bp")
            .ok_or_else(|| SakuraError::InvalidRuntime("scrdrv._bp is missing".to_owned()))?;
        let scripts = runtime.scripts();
        let entry = scripts
            .id_from_index(entry_index)
            .ok_or_else(|| SakuraError::InvalidRuntime("scrdrv entry is invalid".to_owned()))?;
        let host = SystemHost::with_runtime(&runtime);
        let mut system_runtime = SystemRuntime::new(scripts, host);
        system_runtime.push_script_at(entry, None, Vec::new())?;

        let watched = [123420u32, 123424, 128560, 128564, 128576];
        let mut previous = watched
            .iter()
            .map(|address| {
                let snapshot = system_runtime.snapshot();
                describe_global_slot_value(&runtime, &snapshot, *address)
            })
            .collect::<Vec<_>>();
        println!("runtime_handles_scrdrv_codeptr_slot_probe_version=1");
        println!(
            "runtime_handles_scrdrv_codeptr_slot_initial values={}",
            watched
                .iter()
                .zip(previous.iter())
                .map(|(address, value)| format!("0x{address:x}={value}"))
                .collect::<Vec<_>>()
                .join(",")
        );
        for step in 0..240usize {
            let (summary, trace) = system_runtime.run_with_service_trace(1, 100_000, 4)?;
            let snapshot = system_runtime.snapshot();
            let current = watched
                .iter()
                .map(|address| describe_global_slot_value(&runtime, &snapshot, *address))
                .collect::<Vec<_>>();
            let changes = watched
                .iter()
                .zip(previous.iter().zip(current.iter()))
                .filter_map(|(address, (before, after))| {
                    (before != after).then_some(format!("0x{address:x}:{before}->{after}"))
                })
                .collect::<Vec<_>>();
            if !changes.is_empty() {
                let frame = system_runtime.current_frame_state();
                println!(
                    "runtime_handles_scrdrv_codeptr_slot_change step={} events={} services={} user_calls={} frame_script={} frame_cursor={} frame_last=0x{:x} trace_head={} changes={}",
                    step,
                    summary.event_count,
                    summary.service_event_count,
                    summary.user_call_event_count,
                    frame.as_ref().map_or(usize::MAX, |state| state.script_index),
                    frame.as_ref().map_or(usize::MAX, |state| state.cursor),
                    frame.as_ref().map_or(0, |state| state.last_instruction_offset),
                    format_trace_head(trace.recorded_services.first()),
                    changes.join(","),
                );
            }
            previous = current;
        }
        Ok(())
    }

    #[test]
    #[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
    fn traces_real_scrmain_current_code_pointer_selection() -> Result<()> {
        let game_dir = env::var_os("SAKURA_INSTALL_DIR")
            .map(PathBuf::from)
            .ok_or_else(|| {
                SakuraError::InvalidRuntime(
                    "SAKURA_INSTALL_DIR is required for this ignored local-install probe"
                        .to_owned(),
                )
            })?;
        let mut runtime = Runtime::new(RuntimeConfig::default());
        for path in collect_archive_files(&game_dir)? {
            let data = fs::read(&path).map_err(|error| {
                SakuraError::InvalidRuntime(format!("failed to read archive for test: {error}"))
            })?;
            runtime.mount_archive_data_named(data, path.file_name().and_then(OsStr::to_str).map(|name| name.as_bytes().to_vec()).as_deref())?;
        }
        let entry_index = runtime
            .script_index_by_name(b"scrdrv._bp")
            .ok_or_else(|| SakuraError::InvalidRuntime("scrdrv._bp is missing".to_owned()))?;
        let scripts = runtime.scripts();
        let entry = scripts
            .id_from_index(entry_index)
            .ok_or_else(|| SakuraError::InvalidRuntime("scrdrv entry is invalid".to_owned()))?;
        let host = SystemHost::with_runtime(&runtime);
        let mut system_runtime = SystemRuntime::new(scripts, host);
        system_runtime.push_script_at(entry, None, Vec::new())?;

        let mut seeded_snapshot = None;
        for _step in 0..256usize {
            let (_summary, _trace) = system_runtime.run_with_service_trace(1, 100_000, 4)?;
            let frame = system_runtime.current_frame_state();
            if frame.as_ref().is_some_and(|state| {
                state.script_index == 6 && state.last_instruction_offset == 0x36e
            }) {
                seeded_snapshot = Some(system_runtime.snapshot());
                break;
            }
        }
        let mut replay = SystemRuntime::restore(
            &runtime,
            seeded_snapshot.ok_or_else(|| {
                SakuraError::InvalidRuntime("failed to reach seeded scrmain loop".to_owned())
            })?,
        )?;
        println!("runtime_handles_scrmain_current_codeptr_probe_version=1");
        for cycle in 0..16usize {
            let before = replay.snapshot();
            let l4 = replay.current_frame_local_integer(4, 2).unwrap_or(0) as u32;
            let address = 123420u32.saturating_add(l4.saturating_mul(4));
            let selected = describe_global_slot_value(&runtime, &before, address);
            let frame = replay.current_frame_state().unwrap_or_default();
            println!(
                "runtime_handles_scrmain_current_codeptr cycle={} before_script={} before_cursor={} before_last=0x{:x} l4={} addr=0x{:x} raw={:#010x} slot={}",
                cycle,
                frame.script_index,
                frame.cursor,
                frame.last_instruction_offset,
                l4,
                address,
                replay.current_frame_integer_raw(address, 2).unwrap_or(0),
                selected,
            );
            for event in 0..4usize {
                let (summary, trace) = replay.run_with_service_trace(1, 100_000, 4)?;
                let after = replay.snapshot();
                let top_stack = after
                    .frames
                    .last()
                    .map(|state| format_snapshot_stack(&state.vm.stack))
                    .unwrap_or_else(|| "none".to_owned());
                let current = replay.current_frame_state().unwrap_or_default();
                println!(
                    "runtime_handles_scrmain_current_codeptr cycle={} event={} events={} services={} user_calls={} halted={} completed={} limited={} frame_script={} frame_cursor={} frame_last=0x{:x} l4={} l20={} trace_head={} stack={}",
                    cycle,
                    event,
                    summary.event_count,
                    summary.service_event_count,
                    summary.user_call_event_count,
                    summary.halted_event_count,
                    u8::from(summary.completed),
                    u8::from(summary.event_limited),
                    current.script_index,
                    current.cursor,
                    current.last_instruction_offset,
                    replay.current_frame_local_integer(4, 2).unwrap_or(0),
                    replay.current_frame_local_integer(20, 2).unwrap_or(0),
                    format_trace_head(trace.recorded_services.first()),
                    top_stack,
                );
            }
        }
        Ok(())
    }

    #[test]
    #[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
    fn traces_real_scrmain_loop_state_cycle() -> Result<()> {
        let game_dir = env::var_os("SAKURA_INSTALL_DIR")
            .map(PathBuf::from)
            .ok_or_else(|| {
                SakuraError::InvalidRuntime(
                    "SAKURA_INSTALL_DIR is required for this ignored local-install probe"
                        .to_owned(),
                )
            })?;
        let mut runtime = Runtime::new(RuntimeConfig::default());
        for path in collect_archive_files(&game_dir)? {
            let data = fs::read(&path).map_err(|error| {
                SakuraError::InvalidRuntime(format!("failed to read archive for test: {error}"))
            })?;
            runtime.mount_archive_data_named(data, path.file_name().and_then(OsStr::to_str).map(|name| name.as_bytes().to_vec()).as_deref())?;
        }
        let entry_index = runtime
            .script_index_by_name(b"scrdrv._bp")
            .ok_or_else(|| SakuraError::InvalidRuntime("scrdrv._bp is missing".to_owned()))?;
        let scripts = runtime.scripts();
        let entry = scripts
            .id_from_index(entry_index)
            .ok_or_else(|| SakuraError::InvalidRuntime("scrdrv entry is invalid".to_owned()))?;
        let host = SystemHost::with_runtime(&runtime);
        let mut system_runtime = SystemRuntime::new(scripts, host);
        system_runtime.push_script_at(entry, None, Vec::new())?;

        let mut seeded_snapshot = None;
        for _step in 0..256usize {
            let (_summary, _trace) = system_runtime.run_with_service_trace(1, 100_000, 4)?;
            let frame = system_runtime.current_frame_state();
            if frame.as_ref().is_some_and(|state| {
                state.script_index == 6 && state.last_instruction_offset == 0x36e
            }) {
                seeded_snapshot = Some(system_runtime.snapshot());
                break;
            }
        }
        let watched = [
            123420u32, 123424, 128560, 128564, 128576, 144560, 144964, 144976, 144980, 144984,
            146016, 146020,
        ];
        let mut replay = SystemRuntime::restore(
            &runtime,
            seeded_snapshot.ok_or_else(|| {
                SakuraError::InvalidRuntime("failed to reach seeded scrmain loop".to_owned())
            })?,
        )?;

        println!("runtime_handles_scrmain_loop_state_cycle_probe_version=1");
        for cycle in 0..8usize {
            let before = replay.snapshot();
            let frame = replay.current_frame_state().unwrap_or_default();
            let l4 = replay.current_frame_local_integer(4, 2).unwrap_or(0) as u32;
            let selected_address = 123420u32.saturating_add(l4.saturating_mul(4));
            let before_values = collect_runtime_raw_values(&replay, &watched);
            println!(
                "runtime_handles_scrmain_loop_state_cycle cycle={} phase=before frame_script={} frame_cursor={} frame_last=0x{:x} l4={} l20={} selected_addr=0x{:x} selected_slot={} values={} stack={}",
                cycle,
                frame.script_index,
                frame.cursor,
                frame.last_instruction_offset,
                l4,
                replay.current_frame_local_integer(20, 2).unwrap_or(0),
                selected_address,
                describe_global_slot_value(&runtime, &before, selected_address),
                format_watched_values(&watched, &before_values),
                before
                    .frames
                    .last()
                    .map(|state| format_snapshot_stack(&state.vm.stack))
                    .unwrap_or_else(|| "none".to_owned()),
            );
            for event in 0..4usize {
                let before_values = collect_runtime_raw_values(&replay, &watched);
                let before_state = replay.current_frame_state().unwrap_or_default();
                let (summary, trace) = replay.run_with_service_trace(1, 100_000, 4)?;
                let after = replay.snapshot();
                let after_values = collect_runtime_raw_values(&replay, &watched);
                let current = replay.current_frame_state().unwrap_or_default();
                let l4_after = replay.current_frame_local_integer(4, 2).unwrap_or(0) as u32;
                let selected_after = 123420u32.saturating_add(l4_after.saturating_mul(4));
                println!(
                    "runtime_handles_scrmain_loop_state_cycle cycle={} event={} events={} services={} user_calls={} halted={} completed={} limited={} before_script={} before_cursor={} before_last=0x{:x} after_script={} after_cursor={} after_last=0x{:x} l4={} l20={} selected_addr=0x{:x} selected_slot={} trace_head={} values={} changes={} stack={}",
                    cycle,
                    event,
                    summary.event_count,
                    summary.service_event_count,
                    summary.user_call_event_count,
                    summary.halted_event_count,
                    u8::from(summary.completed),
                    u8::from(summary.event_limited),
                    before_state.script_index,
                    before_state.cursor,
                    before_state.last_instruction_offset,
                    current.script_index,
                    current.cursor,
                    current.last_instruction_offset,
                    l4_after,
                    replay.current_frame_local_integer(20, 2).unwrap_or(0),
                    selected_after,
                    describe_global_slot_value(&runtime, &after, selected_after),
                    format_trace_head(trace.recorded_services.first()),
                    format_watched_values(&watched, &after_values),
                    format_value_changes(&watched, &before_values, &after_values),
                    after
                        .frames
                        .last()
                        .map(|state| format_snapshot_stack(&state.vm.stack))
                        .unwrap_or_else(|| "none".to_owned()),
                );
            }
        }
        Ok(())
    }

    #[test]
    #[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
    fn experiments_real_scrmain_loop_state_perturbations() -> Result<()> {
        let game_dir = env::var_os("SAKURA_INSTALL_DIR")
            .map(PathBuf::from)
            .ok_or_else(|| {
                SakuraError::InvalidRuntime(
                    "SAKURA_INSTALL_DIR is required for this ignored local-install probe"
                        .to_owned(),
                )
            })?;
        let mut runtime = Runtime::new(RuntimeConfig::default());
        for path in collect_archive_files(&game_dir)? {
            let data = fs::read(&path).map_err(|error| {
                SakuraError::InvalidRuntime(format!("failed to read archive for test: {error}"))
            })?;
            runtime.mount_archive_data_named(data, path.file_name().and_then(OsStr::to_str).map(|name| name.as_bytes().to_vec()).as_deref())?;
        }
        let entry_index = runtime
            .script_index_by_name(b"scrdrv._bp")
            .ok_or_else(|| SakuraError::InvalidRuntime("scrdrv._bp is missing".to_owned()))?;
        let scripts = runtime.scripts();
        let entry = scripts
            .id_from_index(entry_index)
            .ok_or_else(|| SakuraError::InvalidRuntime("scrdrv entry is invalid".to_owned()))?;
        let host = SystemHost::with_runtime(&runtime);
        let mut system_runtime = SystemRuntime::new(scripts, host);
        system_runtime.push_script_at(entry, None, Vec::new())?;

        let mut seeded_snapshot = None;
        for _step in 0..256usize {
            let (_summary, _trace) = system_runtime.run_with_service_trace(1, 100_000, 4)?;
            let frame = system_runtime.current_frame_state();
            if frame.as_ref().is_some_and(|state| {
                state.script_index == 6 && state.last_instruction_offset == 0x36e
            }) {
                seeded_snapshot = Some(system_runtime.snapshot());
                break;
            }
        }
        let seeded_snapshot = seeded_snapshot.ok_or_else(|| {
            SakuraError::InvalidRuntime("failed to reach seeded scrmain loop".to_owned())
        })?;
        let watched = [
            123420u32, 123424, 128560, 128564, 128576, 144560, 144964, 144976, 144980, 144984,
            146016, 146020,
        ];
        let baseline = SystemRuntime::restore(&runtime, seeded_snapshot.clone())?;
        let baseline_values = collect_runtime_raw_values(&baseline, &watched);
        println!("runtime_handles_scrmain_loop_perturb_probe_version=1");
        println!(
            "runtime_handles_scrmain_loop_perturb_baseline values={}",
            format_watched_values(&watched, &baseline_values),
        );

        let candidate_addresses = [144560u32, 144964, 144976, 144980, 144984, 146016, 146020];
        let mut cases = vec![
            ("baseline".to_owned(), Vec::<(u32, u32)>::new()),
            (
                "ring_zero".to_owned(),
                vec![(144976u32, 0), (144980u32, 0), (144984u32, 0)],
            ),
            (
                "gate_clear".to_owned(),
                vec![(146016u32, 0), (146020u32, 0)],
            ),
            ("gate_high".to_owned(), vec![(146020u32, 0x0040_0000)]),
        ];
        for address in candidate_addresses {
            let baseline_value = baseline.current_frame_integer_raw(address, 2).unwrap_or(0) as u32;
            let mut candidates = vec![0u32, 1u32, baseline_value.wrapping_add(1)];
            if address == 146020 {
                candidates.push(0x0040_0000);
            }
            candidates.sort_unstable();
            candidates.dedup();
            for value in candidates {
                if value == baseline_value {
                    continue;
                }
                cases.push((
                    format!("patch_0x{address:x}_{value:#010x}"),
                    vec![(address, value)],
                ));
            }
        }

        for (case_name, writes) in cases {
            let mut patched = seeded_snapshot.clone();
            for (address, value) in writes.iter().copied() {
                write_snapshot_global_u32(&mut patched, address, value)?;
            }
            let mut replay = SystemRuntime::restore(&runtime, patched)?;
            println!(
                "runtime_handles_scrmain_loop_perturb_case name={} writes={}",
                case_name,
                if writes.is_empty() {
                    "none".to_owned()
                } else {
                    writes
                        .iter()
                        .map(|(address, value)| format!("0x{address:x}={value:#010x}"))
                        .collect::<Vec<_>>()
                        .join(",")
                },
            );
            for replay_step in 0..8usize {
                let before_state = replay.current_frame_state().unwrap_or_default();
                let before_values = collect_runtime_raw_values(&replay, &watched);
                let (summary, trace) = replay.run_with_service_trace(1, 100_000, 4)?;
                let after = replay.snapshot();
                let after_values = collect_runtime_raw_values(&replay, &watched);
                let current = replay.current_frame_state().unwrap_or_default();
                let l4 = replay.current_frame_local_integer(4, 2).unwrap_or(0) as u32;
                let selected_address = 123420u32.saturating_add(l4.saturating_mul(4));
                println!(
                    "runtime_handles_scrmain_loop_perturb_case_step name={} step={} events={} services={} user_calls={} halted={} completed={} limited={} before_script={} before_cursor={} before_last=0x{:x} after_script={} after_cursor={} after_last=0x{:x} l4={} l20={} selected_addr=0x{:x} selected_slot={} trace_head={} values={} changes={} stack={}",
                    case_name,
                    replay_step,
                    summary.event_count,
                    summary.service_event_count,
                    summary.user_call_event_count,
                    summary.halted_event_count,
                    u8::from(summary.completed),
                    u8::from(summary.event_limited),
                    before_state.script_index,
                    before_state.cursor,
                    before_state.last_instruction_offset,
                    current.script_index,
                    current.cursor,
                    current.last_instruction_offset,
                    l4,
                    replay.current_frame_local_integer(20, 2).unwrap_or(0),
                    selected_address,
                    describe_global_slot_value(&runtime, &after, selected_address),
                    format_trace_head(trace.recorded_services.first()),
                    format_watched_values(&watched, &after_values),
                    format_value_changes(&watched, &before_values, &after_values),
                    after
                        .frames
                        .last()
                        .map(|state| format_snapshot_stack(&state.vm.stack))
                        .unwrap_or_else(|| "none".to_owned()),
                );
            }
        }
        Ok(())
    }

    #[test]
    #[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
    fn traces_real_scrmain_loop_buffer_bytes() -> Result<()> {
        let game_dir = env::var_os("SAKURA_INSTALL_DIR")
            .map(PathBuf::from)
            .ok_or_else(|| {
                SakuraError::InvalidRuntime(
                    "SAKURA_INSTALL_DIR is required for this ignored local-install probe"
                        .to_owned(),
                )
            })?;
        let mut runtime = Runtime::new(RuntimeConfig::default());
        for path in collect_archive_files(&game_dir)? {
            let data = fs::read(&path).map_err(|error| {
                SakuraError::InvalidRuntime(format!("failed to read archive for test: {error}"))
            })?;
            runtime.mount_archive_data_named(data, path.file_name().and_then(OsStr::to_str).map(|name| name.as_bytes().to_vec()).as_deref())?;
        }
        let entry_index = runtime
            .script_index_by_name(b"scrdrv._bp")
            .ok_or_else(|| SakuraError::InvalidRuntime("scrdrv._bp is missing".to_owned()))?;
        let scripts = runtime.scripts();
        let entry = scripts
            .id_from_index(entry_index)
            .ok_or_else(|| SakuraError::InvalidRuntime("scrdrv entry is invalid".to_owned()))?;
        let host = SystemHost::with_runtime(&runtime);
        let mut system_runtime = SystemRuntime::new(scripts, host);
        system_runtime.push_script_at(entry, None, Vec::new())?;

        let mut seeded_snapshot = None;
        for _step in 0..256usize {
            let (_summary, _trace) = system_runtime.run_with_service_trace(1, 100_000, 4)?;
            let frame = system_runtime.current_frame_state();
            if frame.as_ref().is_some_and(|state| {
                state.script_index == 6 && state.last_instruction_offset == 0x36e
            }) {
                seeded_snapshot = Some(system_runtime.snapshot());
                break;
            }
        }
        let mut replay = SystemRuntime::restore(
            &runtime,
            seeded_snapshot.ok_or_else(|| {
                SakuraError::InvalidRuntime("failed to reach seeded scrmain loop".to_owned())
            })?,
        )?;

        println!("runtime_handles_scrmain_loop_buffer_probe_version=1");
        for cycle in 0..4usize {
            let before = replay.snapshot();
            let queue_offset = replay.current_frame_integer_raw(144964, 2).unwrap_or(0) as usize;
            println!(
                "runtime_handles_scrmain_loop_buffer cycle={} phase=before queue_offset=0x{:x} queue_entry={} global29a6c={} aux0={}",
                cycle,
                queue_offset,
                read_snapshot_aux_u32(&before, 0, queue_offset),
                format_snapshot_global_bytes(&before, 0x29a6c, 32),
                format_snapshot_aux_bytes(&before, 0, 0, 64),
            );
            for event in 0..4usize {
                let (summary, trace) = replay.run_with_service_trace(1, 100_000, 4)?;
                let after = replay.snapshot();
                let queue_offset =
                    replay.current_frame_integer_raw(144964, 2).unwrap_or(0) as usize;
                println!(
                    "runtime_handles_scrmain_loop_buffer cycle={} event={} events={} services={} user_calls={} frame_script={} frame_cursor={} frame_last=0x{:x} trace_head={} queue_offset=0x{:x} queue_entry={} global29a6c={} aux0={}",
                    cycle,
                    event,
                    summary.event_count,
                    summary.service_event_count,
                    summary.user_call_event_count,
                    replay.current_frame_state().as_ref().map_or(usize::MAX, |frame| frame.script_index),
                    replay.current_frame_state().as_ref().map_or(usize::MAX, |frame| frame.cursor),
                    replay.current_frame_state().as_ref().map_or(0, |frame| frame.last_instruction_offset),
                    format_trace_head(trace.recorded_services.first()),
                    queue_offset,
                    read_snapshot_aux_u32(&after, 0, queue_offset),
                    format_snapshot_global_bytes(&after, 0x29a6c, 32),
                    format_snapshot_aux_bytes(&after, 0, 0, 64),
                );
            }
        }
        Ok(())
    }

    #[test]
    #[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
    fn traces_real_scrmain_loop_system_8a_8b_args() -> Result<()> {
        let game_dir = env::var_os("SAKURA_INSTALL_DIR")
            .map(PathBuf::from)
            .ok_or_else(|| {
                SakuraError::InvalidRuntime(
                    "SAKURA_INSTALL_DIR is required for this ignored local-install probe"
                        .to_owned(),
                )
            })?;
        let mut runtime = Runtime::new(RuntimeConfig::default());
        for path in collect_archive_files(&game_dir)? {
            let data = fs::read(&path).map_err(|error| {
                SakuraError::InvalidRuntime(format!("failed to read archive for test: {error}"))
            })?;
            runtime.mount_archive_data_named(data, path.file_name().and_then(OsStr::to_str).map(|name| name.as_bytes().to_vec()).as_deref())?;
        }
        let entry_index = runtime
            .script_index_by_name(b"scrdrv._bp")
            .ok_or_else(|| SakuraError::InvalidRuntime("scrdrv._bp is missing".to_owned()))?;
        let scripts = runtime.scripts();
        let entry = scripts
            .id_from_index(entry_index)
            .ok_or_else(|| SakuraError::InvalidRuntime("scrdrv entry is invalid".to_owned()))?;
        let host = SystemHost::with_runtime(&runtime);
        let mut system_runtime = SystemRuntime::new(scripts, host);
        system_runtime.push_script_at(entry, None, Vec::new())?;

        let mut seeded_snapshot = None;
        for _step in 0..256usize {
            let (_summary, _trace) = system_runtime.run_with_service_trace(1, 100_000, 8)?;
            let frame = system_runtime.current_frame_state();
            if frame.as_ref().is_some_and(|state| {
                state.script_index == 6 && state.last_instruction_offset == 0x36e
            }) {
                seeded_snapshot = Some(system_runtime.snapshot());
                break;
            }
        }
        let mut replay = SystemRuntime::restore(
            &runtime,
            seeded_snapshot.ok_or_else(|| {
                SakuraError::InvalidRuntime("failed to reach seeded scrmain loop".to_owned())
            })?,
        )?;

        println!("runtime_handles_scrmain_loop_system_8a_8b_args_probe_version=1");
        for step in 0..16usize {
            let (summary, trace) = replay.run_with_service_trace(1, 100_000, 8)?;
            let frame = replay.current_frame_state().unwrap_or_default();
            println!(
                "runtime_handles_scrmain_loop_system_8a_8b_args step={} events={} services={} user_calls={} frame_script={} frame_cursor={} frame_last=0x{:x}",
                step,
                summary.event_count,
                summary.service_event_count,
                summary.user_call_event_count,
                frame.script_index,
                frame.cursor,
                frame.last_instruction_offset,
            );
            for (index, event) in trace.recorded_services.iter().enumerate() {
                if event.family == crate::SystemCallFamily::System
                    && matches!(event.service_id, 0x8a | 0x8b)
                {
                    println!(
                        "runtime_handles_scrmain_loop_system_8a_8b_args event_index={} service={:02x} instruction=0x{:x} argc={} top={} ints={} min={} max={} args={}",
                        index,
                        event.service_id,
                        event.instruction_offset,
                        event.arg_count,
                        event.top_kind,
                        event.integer_arg_count,
                        event.min_integer_arg.min(u32::MAX.into()),
                        event.max_integer_arg.min(u32::MAX.into()),
                        format_trace_args(event),
                    );
                }
            }
        }
        Ok(())
    }

    #[test]
    #[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
    fn traces_real_scrmain_loop_system_6a_message_path() -> Result<()> {
        let game_dir = env::var_os("SAKURA_INSTALL_DIR")
            .map(PathBuf::from)
            .ok_or_else(|| {
                SakuraError::InvalidRuntime(
                    "SAKURA_INSTALL_DIR is required for this ignored local-install probe"
                        .to_owned(),
                )
            })?;
        let mut runtime = Runtime::new(RuntimeConfig::default());
        for path in collect_archive_files(&game_dir)? {
            let data = fs::read(&path).map_err(|error| {
                SakuraError::InvalidRuntime(format!("failed to read archive for test: {error}"))
            })?;
            runtime.mount_archive_data_named(data, path.file_name().and_then(OsStr::to_str).map(|name| name.as_bytes().to_vec()).as_deref())?;
        }
        let entry_index = runtime
            .script_index_by_name(b"scrdrv._bp")
            .ok_or_else(|| SakuraError::InvalidRuntime("scrdrv._bp is missing".to_owned()))?;
        let scripts = runtime.scripts();
        let entry = scripts
            .id_from_index(entry_index)
            .ok_or_else(|| SakuraError::InvalidRuntime("scrdrv entry is invalid".to_owned()))?;
        let host = SystemHost::with_runtime(&runtime);
        let mut system_runtime = SystemRuntime::new(scripts, host);
        system_runtime.push_script_at(entry, None, Vec::new())?;

        let mut seeded_snapshot = None;
        for _step in 0..256usize {
            let (_summary, trace) = system_runtime.run_with_service_trace(1, 100_000, 10)?;
            if trace.recorded_services.iter().any(|event| {
                event.family == crate::SystemCallFamily::System
                    && event.service_id == 0x6a
                    && event.script_index == 5
                    && event.instruction_offset == 0x737
            }) {
                seeded_snapshot = Some(system_runtime.snapshot());
                break;
            }
        }
        let mut replay = SystemRuntime::restore(
            &runtime,
            seeded_snapshot.ok_or_else(|| {
                SakuraError::InvalidRuntime("failed to reach bitmap message syscall".to_owned())
            })?,
        )?;

        println!("runtime_handles_scrmain_loop_system_6a_probe_version=1");
        for step in 0..6usize {
            let before = replay.snapshot();
            let before_frame = replay.current_frame_state().unwrap_or_default();
            let before_stack = before
                .frames
                .last()
                .map(|state| format_snapshot_stack(&state.vm.stack))
                .unwrap_or_else(|| "none".to_owned());
            println!(
                "runtime_handles_scrmain_loop_system_6a before_step={} frame_script={} frame_cursor={} frame_last=0x{:x} l4={} l20={} l24={} l28={} l32={} l36={} l40={} l44={} global29a6c={} aux0={} stack={}",
                step,
                before_frame.script_index,
                before_frame.cursor,
                before_frame.last_instruction_offset,
                replay.current_frame_local_integer(4, 2).unwrap_or(0),
                replay.current_frame_local_integer(20, 2).unwrap_or(0),
                replay.current_frame_local_integer(24, 2).unwrap_or(0),
                replay.current_frame_local_integer(28, 2).unwrap_or(0),
                replay.current_frame_local_integer(32, 2).unwrap_or(0),
                replay.current_frame_local_integer(36, 2).unwrap_or(0),
                replay.current_frame_local_integer(40, 2).unwrap_or(0),
                replay.current_frame_local_integer(44, 2).unwrap_or(0),
                format_snapshot_global_bytes(&before, 0x29a6c, 32),
                format_snapshot_aux_bytes(&before, 0, 0, 64),
                before_stack,
            );
            let (summary, trace) = replay.run_with_service_trace(1, 100_000, 10)?;
            let after = replay.snapshot();
            let after_frame = replay.current_frame_state().unwrap_or_default();
            let after_stack = after
                .frames
                .last()
                .map(|state| format_snapshot_stack(&state.vm.stack))
                .unwrap_or_else(|| "none".to_owned());
            let service_6a = trace.recorded_services.iter().find(|event| {
                event.family == crate::SystemCallFamily::System && event.service_id == 0x6a
            });
            println!(
                "runtime_handles_scrmain_loop_system_6a after_step={} events={} services={} user_calls={} halted={} completed={} limited={} frame_script={} frame_cursor={} frame_last=0x{:x} trace_head={} sixa={} l4={} l20={} l24={} l28={} l32={} l36={} l40={} l44={} global29a6c={} aux0={} stack={}",
                step,
                summary.event_count,
                summary.service_event_count,
                summary.user_call_event_count,
                summary.halted_event_count,
                u8::from(summary.completed),
                u8::from(summary.event_limited),
                after_frame.script_index,
                after_frame.cursor,
                after_frame.last_instruction_offset,
                format_trace_head(trace.recorded_services.first()),
                service_6a.map(format_trace_args).unwrap_or_else(|| "none".to_owned()),
                replay.current_frame_local_integer(4, 2).unwrap_or(0),
                replay.current_frame_local_integer(20, 2).unwrap_or(0),
                replay.current_frame_local_integer(24, 2).unwrap_or(0),
                replay.current_frame_local_integer(28, 2).unwrap_or(0),
                replay.current_frame_local_integer(32, 2).unwrap_or(0),
                replay.current_frame_local_integer(36, 2).unwrap_or(0),
                replay.current_frame_local_integer(40, 2).unwrap_or(0),
                replay.current_frame_local_integer(44, 2).unwrap_or(0),
                format_snapshot_global_bytes(&after, 0x29a6c, 32),
                format_snapshot_aux_bytes(&after, 0, 0, 64),
                after_stack,
            );
        }
        Ok(())
    }

    #[test]
    #[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
    fn traces_real_scrmain_loop_system_17_args() -> Result<()> {
        let game_dir = env::var_os("SAKURA_INSTALL_DIR")
            .map(PathBuf::from)
            .ok_or_else(|| {
                SakuraError::InvalidRuntime(
                    "SAKURA_INSTALL_DIR is required for this ignored local-install probe"
                        .to_owned(),
                )
            })?;
        let mut runtime = Runtime::new(RuntimeConfig::default());
        for path in collect_archive_files(&game_dir)? {
            let data = fs::read(&path).map_err(|error| {
                SakuraError::InvalidRuntime(format!("failed to read archive for test: {error}"))
            })?;
            runtime.mount_archive_data_named(data, path.file_name().and_then(OsStr::to_str).map(|name| name.as_bytes().to_vec()).as_deref())?;
        }
        let entry_index = runtime
            .script_index_by_name(b"scrdrv._bp")
            .ok_or_else(|| SakuraError::InvalidRuntime("scrdrv._bp is missing".to_owned()))?;
        let scripts = runtime.scripts();
        let entry = scripts
            .id_from_index(entry_index)
            .ok_or_else(|| SakuraError::InvalidRuntime("scrdrv entry is invalid".to_owned()))?;
        let host = SystemHost::with_runtime(&runtime);
        let mut system_runtime = SystemRuntime::new(scripts, host);
        system_runtime.push_script_at(entry, None, Vec::new())?;

        println!("runtime_handles_scrmain_loop_system_17_probe_version=1");
        for step in 0..256usize {
            let (summary, trace) = system_runtime.run_with_service_trace(1, 100_000, 10)?;
            let frame = system_runtime.current_frame_state().unwrap_or_default();
            println!(
                "runtime_handles_scrmain_loop_system_17 step={} events={} services={} user_calls={} frame_script={} frame_cursor={} frame_last=0x{:x} trace_head={}",
                step,
                summary.event_count,
                summary.service_event_count,
                summary.user_call_event_count,
                frame.script_index,
                frame.cursor,
                frame.last_instruction_offset,
                format_trace_head(trace.recorded_services.first()),
            );
            for (index, event) in trace.recorded_services.iter().enumerate() {
                if event.family == crate::SystemCallFamily::System && event.service_id == 0x17 {
                    println!(
                        "runtime_handles_scrmain_loop_system_17 event_index={} script={} instruction=0x{:x} argc={} top={} ints={} min={} max={} args={}",
                        index,
                        event.script_index,
                        event.instruction_offset,
                        event.arg_count,
                        event.top_kind,
                        event.integer_arg_count,
                        event.min_integer_arg.min(u32::MAX.into()),
                        event.max_integer_arg.min(u32::MAX.into()),
                        format_trace_args(event),
                    );
                    return Ok(());
                }
            }
        }
        Err(SakuraError::InvalidRuntime(
            "failed to observe System:17 in scrmain loop".to_owned(),
        ))
    }

    #[test]
    #[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
    fn experiments_real_scrmain_loop_aux_queue_perturbations() -> Result<()> {
        let game_dir = env::var_os("SAKURA_INSTALL_DIR")
            .map(PathBuf::from)
            .ok_or_else(|| {
                SakuraError::InvalidRuntime(
                    "SAKURA_INSTALL_DIR is required for this ignored local-install probe"
                        .to_owned(),
                )
            })?;
        let mut runtime = Runtime::new(RuntimeConfig::default());
        for path in collect_archive_files(&game_dir)? {
            let data = fs::read(&path).map_err(|error| {
                SakuraError::InvalidRuntime(format!("failed to read archive for test: {error}"))
            })?;
            runtime.mount_archive_data_named(data, path.file_name().and_then(OsStr::to_str).map(|name| name.as_bytes().to_vec()).as_deref())?;
        }
        let entry_index = runtime
            .script_index_by_name(b"scrdrv._bp")
            .ok_or_else(|| SakuraError::InvalidRuntime("scrdrv._bp is missing".to_owned()))?;
        let scripts = runtime.scripts();
        let entry = scripts
            .id_from_index(entry_index)
            .ok_or_else(|| SakuraError::InvalidRuntime("scrdrv entry is invalid".to_owned()))?;
        let host = SystemHost::with_runtime(&runtime);
        let mut system_runtime = SystemRuntime::new(scripts, host);
        system_runtime.push_script_at(entry, None, Vec::new())?;

        let mut seeded_snapshot = None;
        for _step in 0..256usize {
            let (_summary, _trace) = system_runtime.run_with_service_trace(1, 100_000, 4)?;
            let frame = system_runtime.current_frame_state();
            if frame.as_ref().is_some_and(|state| {
                state.script_index == 6 && state.last_instruction_offset == 0x36e
            }) {
                seeded_snapshot = Some(system_runtime.snapshot());
                break;
            }
        }
        let seeded_snapshot = seeded_snapshot.ok_or_else(|| {
            SakuraError::InvalidRuntime("failed to reach seeded scrmain loop".to_owned())
        })?;

        let cases = [
            ("aux8_1", vec![(8usize, 1u32)]),
            ("aux8_ff", vec![(8usize, 0xffff_ffffu32)]),
            ("aux8_ready", vec![(8usize, 0x1000_0006u32)]),
            (
                "aux8_12_ready",
                vec![(8usize, 0x1000_0006u32), (12usize, 0x1000_0006u32)],
            ),
            (
                "aux8_12_16_seq",
                vec![(8usize, 1u32), (12usize, 2u32), (16usize, 3u32)],
            ),
            ("buf29a6c_word1", vec![(8usize, 1u32)]),
            ("buf29a6c_plus8_word1", vec![(8usize, 1u32)]),
            ("buf29a6c_plus8_pair", vec![(8usize, 1u32), (12usize, 8u32)]),
        ];
        let watched = [144964u32, 144976, 144980, 144984];

        println!("runtime_handles_scrmain_loop_aux_perturb_probe_version=1");
        for (case_name, aux_writes) in cases {
            let mut patched = seeded_snapshot.clone();
            if case_name == "buf29a6c_word1" {
                write_snapshot_global_u32(&mut patched, 0x29a6c, 1)?;
                write_snapshot_global_u32(&mut patched, 0x29a70, 2)?;
                write_snapshot_global_u32(&mut patched, 0x29a74, 3)?;
                write_snapshot_global_u32(&mut patched, 0x29a78, 4)?;
            } else if case_name == "buf29a6c_plus8_word1" {
                write_snapshot_global_u32(&mut patched, 0x29a74, 1)?;
            } else if case_name == "buf29a6c_plus8_pair" {
                write_snapshot_global_u32(&mut patched, 0x29a74, 1)?;
                write_snapshot_global_u32(&mut patched, 0x29a78, 8)?;
            } else {
                for (offset, value) in aux_writes.iter().copied() {
                    write_snapshot_aux_u32(&mut patched, 0, offset, value)?;
                }
            }
            let mut replay = SystemRuntime::restore(&runtime, patched)?;
            println!(
                "runtime_handles_scrmain_loop_aux_perturb_case name={} aux0={} global29a6c={}",
                case_name,
                format_snapshot_aux_bytes(&replay.snapshot(), 0, 0, 32),
                format_snapshot_global_bytes(&replay.snapshot(), 0x29a6c, 32),
            );
            for replay_step in 0..8usize {
                let before_values = collect_runtime_raw_values(&replay, &watched);
                match replay.run_with_service_trace(1, 100_000, 4) {
                    Ok((summary, trace)) => {
                        let after = replay.snapshot();
                        let after_values = collect_runtime_raw_values(&replay, &watched);
                        println!(
                            "runtime_handles_scrmain_loop_aux_perturb_case_step name={} step={} events={} services={} user_calls={} frame_script={} frame_cursor={} frame_last=0x{:x} trace_head={} watched={} changes={} aux0={} global29a6c={}",
                            case_name,
                            replay_step,
                            summary.event_count,
                            summary.service_event_count,
                            summary.user_call_event_count,
                            replay.current_frame_state().as_ref().map_or(usize::MAX, |frame| frame.script_index),
                            replay.current_frame_state().as_ref().map_or(usize::MAX, |frame| frame.cursor),
                            replay.current_frame_state().as_ref().map_or(0, |frame| frame.last_instruction_offset),
                            format_trace_head(trace.recorded_services.first()),
                            format_watched_values(&watched, &after_values),
                            format_value_changes(&watched, &before_values, &after_values),
                            format_snapshot_aux_bytes(&after, 0, 0, 32),
                            format_snapshot_global_bytes(&after, 0x29a6c, 32),
                        );
                    }
                    Err(error) => {
                        let after = replay.snapshot();
                        let after_values = collect_runtime_raw_values(&replay, &watched);
                        println!(
                            "runtime_handles_scrmain_loop_aux_perturb_case_error name={} step={} error={error:?} frame_script={} frame_cursor={} frame_last=0x{:x} watched={} aux0={} global29a6c={}",
                            case_name,
                            replay_step,
                            replay.current_frame_state().as_ref().map_or(usize::MAX, |frame| frame.script_index),
                            replay.current_frame_state().as_ref().map_or(usize::MAX, |frame| frame.cursor),
                            replay.current_frame_state().as_ref().map_or(0, |frame| frame.last_instruction_offset),
                            format_watched_values(&watched, &after_values),
                            format_snapshot_aux_bytes(&after, 0, 0, 32),
                            format_snapshot_global_bytes(&after, 0x29a6c, 32),
                        );
                        break;
                    }
                }
            }
        }
        Ok(())
    }

    #[test]
    #[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
    fn inspects_real_scrdrv_loaded_program_return_shape_at_scrmain_loop() -> Result<()> {
        let game_dir = env::var_os("SAKURA_INSTALL_DIR")
            .map(PathBuf::from)
            .ok_or_else(|| {
                SakuraError::InvalidRuntime(
                    "SAKURA_INSTALL_DIR is required for this ignored local-install probe"
                        .to_owned(),
                )
            })?;
        let mut runtime = Runtime::new(RuntimeConfig::default());
        for path in collect_archive_files(&game_dir)? {
            let data = fs::read(&path).map_err(|error| {
                SakuraError::InvalidRuntime(format!("failed to read archive for test: {error}"))
            })?;
            runtime.mount_archive_data_named(data, path.file_name().and_then(OsStr::to_str).map(|name| name.as_bytes().to_vec()).as_deref())?;
        }
        let entry_index = runtime
            .script_index_by_name(b"scrdrv._bp")
            .ok_or_else(|| SakuraError::InvalidRuntime("scrdrv._bp is missing".to_owned()))?;
        let scripts = runtime.scripts();
        let entry = scripts
            .id_from_index(entry_index)
            .ok_or_else(|| SakuraError::InvalidRuntime("scrdrv entry is invalid".to_owned()))?;
        let host = SystemHost::with_runtime(&runtime);
        let mut system_runtime = SystemRuntime::new(scripts, host);
        system_runtime.push_script_at(entry, None, Vec::new())?;

        let mut seeded_snapshot = None;
        for step in 0..64usize {
            let (_summary, _trace) = system_runtime.run_with_service_trace(1, 100_000, 4)?;
            let frame = system_runtime.current_frame_state();
            println!(
                "runtime_handles_loaded_return_probe_step={} frame_script={} frame_cursor={} frame_last=0x{:x} l20={} raw123420={} raw123424={} raw128560={} raw128564={} raw128576={}",
                step,
                frame.as_ref().map_or(usize::MAX, |frame| frame.script_index),
                frame.as_ref().map_or(usize::MAX, |frame| frame.cursor),
                frame.as_ref().map_or(0, |frame| frame.last_instruction_offset),
                system_runtime.current_frame_local_integer(20, 2).unwrap_or(0),
                system_runtime.current_frame_integer_raw(123420, 2).unwrap_or(0),
                system_runtime.current_frame_integer_raw(123424, 2).unwrap_or(0),
                system_runtime.current_frame_integer_raw(128560, 2).unwrap_or(0),
                system_runtime.current_frame_integer_raw(128564, 2).unwrap_or(0),
                system_runtime.current_frame_integer_raw(128576, 2).unwrap_or(0),
            );
            if frame.as_ref().is_some_and(|frame| {
                frame.script_index == 6 && frame.last_instruction_offset == 0x36e
            }) {
                seeded_snapshot = Some(system_runtime.snapshot());
                break;
            }
        }
        let seeded_snapshot = seeded_snapshot.ok_or_else(|| {
            SakuraError::InvalidRuntime("failed to reach scrmain loop snapshot".to_owned())
        })?;

        let mut replay = SystemRuntime::restore(&runtime, seeded_snapshot)?;
        for replay_step in 0..8usize {
            let before = replay.snapshot();
            let child_before = before.frames.last().and_then(|parent| {
                let vm = crate::system_vm::SystemVm::restore(
                    runtime
                        .scripts()
                        .id_from_index(parent.script_index)
                        .and_then(|id| runtime.scripts().system_vm(id).ok().flatten())
                        .ok_or_else(|| {
                            SakuraError::InvalidRuntime(
                                "parent frame program missing during loaded return probe"
                                    .to_owned(),
                            )
                        })
                        .ok()?
                        .program()
                        .clone(),
                    parent.vm.clone(),
                )
                .ok()?;
                Some(vm)
            });
            let (summary, trace) = replay.run_with_service_trace(1, 100_000, 4)?;
            let after = replay.snapshot();
            println!(
                "runtime_handles_loaded_return_probe_replay={} events={} services={} user_calls={} halted={} completed={} limited={} trace_head={}",
                replay_step,
                summary.event_count,
                summary.service_event_count,
                summary.user_call_event_count,
                summary.halted_event_count,
                u8::from(summary.completed),
                u8::from(summary.event_limited),
                format_trace_head(trace.recorded_services.first()),
            );
            if let Some(frame) = child_before.as_ref() {
                println!(
                    "runtime_handles_loaded_return_probe_before_stack replay={} script_index={} cursor={} last=0x{:x} mem_ptr=0x{:x} stack={}",
                    replay_step,
                    frame.code_script_index(),
                    frame.cursor(),
                    frame.last_instruction_offset().unwrap_or(0),
                    frame.mem_ptr(),
                    format_vm_stack(frame.stack()),
                );
            }
            for (frame_index, frame) in after.frames.iter().enumerate() {
                let script_name = runtime
                    .scripts()
                    .id_from_index(frame.script_index)
                    .and_then(|id| runtime.scripts().name_by_id(id))
                    .map(|name| String::from_utf8_lossy(name).into_owned())
                    .unwrap_or_else(|| "<unknown>".to_owned());
                println!(
                    "runtime_handles_loaded_return_probe_after_frame replay={} index={} script={} name={} cursor={} last=0x{:x} mem_ptr=0x{:x} return={}",
                    replay_step,
                    frame_index,
                    frame.script_index,
                    script_name,
                    frame.vm.cursor,
                    frame.vm.last_instruction_offset.unwrap_or(0),
                    frame.vm.mem_ptr,
                    frame
                        .return_value
                        .as_ref()
                        .map(describe_snapshot_value)
                        .unwrap_or_else(|| "none".to_owned()),
                );
            }
            println!(
                "runtime_handles_loaded_return_probe_after_state replay={} current_script={} current_cursor={} current_last=0x{:x} local20={} stack_top_frame_len={}",
                replay_step,
                replay.current_frame_state().as_ref().map_or(usize::MAX, |frame| frame.script_index),
                replay.current_frame_state().as_ref().map_or(usize::MAX, |frame| frame.cursor),
                replay.current_frame_state().as_ref().map_or(0, |frame| frame.last_instruction_offset),
                replay.current_frame_local_integer(20, 2).unwrap_or(0),
                after.frames.last().map_or(0, |frame| frame.vm.stack.len()),
            );
        }

        Ok(())
    }

    #[test]
    #[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
    fn traces_scrmain_snapshot_progress_after_sys8b() -> Result<()> {
        let game_dir = env::var_os("SAKURA_INSTALL_DIR")
            .map(PathBuf::from)
            .ok_or_else(|| {
                SakuraError::InvalidRuntime(
                    "SAKURA_INSTALL_DIR is required for this ignored local-install probe"
                        .to_owned(),
                )
            })?;
        let mut runtime = Runtime::new(RuntimeConfig::default());
        for path in collect_archive_files(&game_dir)? {
            let data = fs::read(&path).map_err(|error| {
                SakuraError::InvalidRuntime(format!("failed to read archive for test: {error}"))
            })?;
            runtime.mount_archive_data_named(data, path.file_name().and_then(OsStr::to_str).map(|name| name.as_bytes().to_vec()).as_deref())?;
        }
        let entry_index = runtime
            .script_index_by_name(b"scrmain._bp")
            .ok_or_else(|| SakuraError::InvalidRuntime("scrmain._bp is missing".to_owned()))?;
        let scripts = runtime.scripts();
        let entry = scripts
            .id_from_index(entry_index)
            .ok_or_else(|| SakuraError::InvalidRuntime("scrmain entry is invalid".to_owned()))?;
        let host = SystemHost::with_runtime(&runtime);
        let mut system_runtime = SystemRuntime::new(scripts, host);
        system_runtime.push_script_at(entry, None, Vec::new())?;
        let (_summary, _trace) = system_runtime.run_with_service_trace(1, 100_000, 4)?;
        let mut snapshot = system_runtime.snapshot();

        println!("runtime_handles_scrmain_snapshot_probe_version=1");
        for limit in [1usize, 2, 4, 8, 16, 24, 32, 40, 48] {
            let mut restored = SystemRuntime::restore(&runtime, snapshot.clone())?;
            let result = restored.run_with_service_trace(1, limit, 4);
            match result {
                Ok((summary, trace)) => {
                    let frame = restored.current_frame_state();
                    println!(
                        "runtime_handles_scrmain_snapshot limit={} events={} services={} halted={} completed={} limited={} frame_cursor={} frame_last=0x{:x} l4={} l12={} l16={} l20={} l1264={} l1268={} l1272={} l1276={} raw603624={} raw603628={} raw603632={} trace_total={}",
                        limit,
                        summary.event_count,
                        summary.service_event_count,
                        summary.halted_event_count,
                        u8::from(summary.completed),
                        u8::from(summary.event_limited),
                        frame.as_ref().map_or(usize::MAX, |f| f.cursor),
                        frame.as_ref().map_or(0, |f| f.last_instruction_offset),
                        restored.current_frame_local_integer(4, 2).unwrap_or(0),
                        restored.current_frame_local_integer(12, 2).unwrap_or(0),
                        restored.current_frame_local_integer(16, 2).unwrap_or(0),
                        restored.current_frame_local_integer(20, 2).unwrap_or(0),
                        restored.current_frame_local_integer(1264, 2).unwrap_or(0),
                        restored.current_frame_local_integer(1268, 2).unwrap_or(0),
                        restored.current_frame_local_integer(1272, 2).unwrap_or(0),
                        restored.current_frame_local_integer(1276, 2).unwrap_or(0),
                        restored.current_frame_integer_raw(603624, 2).unwrap_or(0),
                        restored.current_frame_integer_raw(603628, 2).unwrap_or(0),
                        restored.current_frame_integer_raw(603632, 2).unwrap_or(0),
                        trace.total_service_count,
                    );
                    snapshot = restored.snapshot();
                }
                Err(error) => {
                    let frame = restored.current_frame_state();
                    println!(
                        "runtime_handles_scrmain_snapshot_error limit={} error={error:?} frame_cursor={} frame_last=0x{:x} l4={} l12={} l16={} l20={} l1264={} l1268={} l1272={} l1276={} raw603624={} raw603628={} raw603632={}",
                        limit,
                        frame.as_ref().map_or(usize::MAX, |f| f.cursor),
                        frame.as_ref().map_or(0, |f| f.last_instruction_offset),
                        restored.current_frame_local_integer(4, 2).unwrap_or(0),
                        restored.current_frame_local_integer(12, 2).unwrap_or(0),
                        restored.current_frame_local_integer(16, 2).unwrap_or(0),
                        restored.current_frame_local_integer(20, 2).unwrap_or(0),
                        restored.current_frame_local_integer(1264, 2).unwrap_or(0),
                        restored.current_frame_local_integer(1268, 2).unwrap_or(0),
                        restored.current_frame_local_integer(1272, 2).unwrap_or(0),
                        restored.current_frame_local_integer(1276, 2).unwrap_or(0),
                        restored.current_frame_integer_raw(603624, 2).unwrap_or(0),
                        restored.current_frame_integer_raw(603628, 2).unwrap_or(0),
                        restored.current_frame_integer_raw(603632, 2).unwrap_or(0),
                    );
                }
            }
        }
        Ok(())
    }

    #[test]
    #[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
    fn compares_scrmain_live_vs_restored_progress_after_sys8b() -> Result<()> {
        let game_dir = env::var_os("SAKURA_INSTALL_DIR")
            .map(PathBuf::from)
            .ok_or_else(|| {
                SakuraError::InvalidRuntime(
                    "SAKURA_INSTALL_DIR is required for this ignored local-install probe"
                        .to_owned(),
                )
            })?;
        let mut runtime = Runtime::new(RuntimeConfig::default());
        for path in collect_archive_files(&game_dir)? {
            let data = fs::read(&path).map_err(|error| {
                SakuraError::InvalidRuntime(format!("failed to read archive for test: {error}"))
            })?;
            runtime.mount_archive_data_named(data, path.file_name().and_then(OsStr::to_str).map(|name| name.as_bytes().to_vec()).as_deref())?;
        }
        let scripts = runtime.scripts();
        let entry_index = runtime
            .script_index_by_name(b"scrmain._bp")
            .ok_or_else(|| SakuraError::InvalidRuntime("scrmain._bp is missing".to_owned()))?;
        let entry = scripts
            .id_from_index(entry_index)
            .ok_or_else(|| SakuraError::InvalidRuntime("scrmain entry is invalid".to_owned()))?;

        let host = SystemHost::with_runtime(&runtime);
        let mut live = SystemRuntime::new(scripts, host);
        live.push_script_at(entry, None, Vec::new())?;
        let (_seed_summary, _seed_trace) = live.run_with_service_trace(1, 100_000, 4)?;
        let seeded_snapshot = live.snapshot();

        let live_err = live.run_with_service_trace(1, 32, 4).unwrap_err();
        let live_snapshot = live.snapshot();
        let live_frame = live.current_frame_state();
        println!(
            "runtime_handles_scrmain_live_after_limit32 error={live_err:?} frame_cursor={} frame_last=0x{:x} stack_len={} l4={} l12={} l16={} l20={} l1264={} l1268={} l1272={} l1276={}",
            live_frame.as_ref().map_or(usize::MAX, |f| f.cursor),
            live_frame.as_ref().map_or(0, |f| f.last_instruction_offset),
            live_snapshot.frames.last().map_or(0, |f| f.vm.stack.len()),
            live.current_frame_local_integer(4, 2).unwrap_or(0),
            live.current_frame_local_integer(12, 2).unwrap_or(0),
            live.current_frame_local_integer(16, 2).unwrap_or(0),
            live.current_frame_local_integer(20, 2).unwrap_or(0),
            live.current_frame_local_integer(1264, 2).unwrap_or(0),
            live.current_frame_local_integer(1268, 2).unwrap_or(0),
            live.current_frame_local_integer(1272, 2).unwrap_or(0),
            live.current_frame_local_integer(1276, 2).unwrap_or(0),
        );

        let mut restored = SystemRuntime::restore(&runtime, seeded_snapshot)?;
        let restored_err = restored.run_with_service_trace(1, 32, 4).unwrap_err();
        let restored_snapshot = restored.snapshot();
        let restored_frame = restored.current_frame_state();
        println!(
            "runtime_handles_scrmain_restored_after_limit32 error={restored_err:?} frame_cursor={} frame_last=0x{:x} stack_len={} l4={} l12={} l16={} l20={} l1264={} l1268={} l1272={} l1276={}",
            restored_frame.as_ref().map_or(usize::MAX, |f| f.cursor),
            restored_frame.as_ref().map_or(0, |f| f.last_instruction_offset),
            restored_snapshot.frames.last().map_or(0, |f| f.vm.stack.len()),
            restored.current_frame_local_integer(4, 2).unwrap_or(0),
            restored.current_frame_local_integer(12, 2).unwrap_or(0),
            restored.current_frame_local_integer(16, 2).unwrap_or(0),
            restored.current_frame_local_integer(20, 2).unwrap_or(0),
            restored.current_frame_local_integer(1264, 2).unwrap_or(0),
            restored.current_frame_local_integer(1268, 2).unwrap_or(0),
            restored.current_frame_local_integer(1272, 2).unwrap_or(0),
            restored.current_frame_local_integer(1276, 2).unwrap_or(0),
        );

        println!(
            "runtime_handles_scrmain_compare live_stack={:?} restored_stack={:?}",
            live_snapshot.frames.last().map(|frame| &frame.vm.stack),
            restored_snapshot.frames.last().map(|frame| &frame.vm.stack),
        );
        Ok(())
    }

    #[test]
    #[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
    fn traces_scrmain_cumulative_internal_progress_after_sys8b() -> Result<()> {
        let game_dir = env::var_os("SAKURA_INSTALL_DIR")
            .map(PathBuf::from)
            .ok_or_else(|| {
                SakuraError::InvalidRuntime(
                    "SAKURA_INSTALL_DIR is required for this ignored local-install probe"
                        .to_owned(),
                )
            })?;
        let mut runtime = Runtime::new(RuntimeConfig::default());
        for path in collect_archive_files(&game_dir)? {
            let data = fs::read(&path).map_err(|error| {
                SakuraError::InvalidRuntime(format!("failed to read archive for test: {error}"))
            })?;
            runtime.mount_archive_data_named(data, path.file_name().and_then(OsStr::to_str).map(|name| name.as_bytes().to_vec()).as_deref())?;
        }
        let scripts = runtime.scripts();
        let entry_index = runtime
            .script_index_by_name(b"scrmain._bp")
            .ok_or_else(|| SakuraError::InvalidRuntime("scrmain._bp is missing".to_owned()))?;
        let entry = scripts
            .id_from_index(entry_index)
            .ok_or_else(|| SakuraError::InvalidRuntime("scrmain entry is invalid".to_owned()))?;
        let host = SystemHost::with_runtime(&runtime);
        let mut seeded = SystemRuntime::new(scripts, host);
        seeded.push_script_at(entry, None, Vec::new())?;
        let (_summary, _trace) = seeded.run_with_service_trace(1, 100_000, 4)?;
        let mut snapshot = seeded.snapshot();

        println!("runtime_handles_scrmain_cumulative_probe_version=1");
        for chunk in 0..160usize {
            let mut restored = SystemRuntime::restore(&runtime, snapshot.clone())?;
            let result = restored.run_with_service_trace(1, 2, 4);
            let frame = restored.current_frame_state();
            let state = restored.snapshot();
            let stack = state
                .frames
                .last()
                .map(|frame| frame.vm.stack.clone())
                .unwrap_or_default();
            match result {
                Ok((summary, trace)) => {
                    println!(
                        "runtime_handles_scrmain_cumulative chunk={} ok events={} services={} halted={} completed={} limited={} frame_cursor={} frame_last=0x{:x} l4={} l12={} l16={} l20={} l1264={} l1268={} l1272={} l1276={} raw123420={} raw123424={} raw128560={} raw128564={} raw128576={} stack={:?} trace_total={}",
                        chunk,
                        summary.event_count,
                        summary.service_event_count,
                        summary.halted_event_count,
                        u8::from(summary.completed),
                        u8::from(summary.event_limited),
                        frame.as_ref().map_or(usize::MAX, |f| f.cursor),
                        frame.as_ref().map_or(0, |f| f.last_instruction_offset),
                        restored.current_frame_local_integer(4, 2).unwrap_or(0),
                        restored.current_frame_local_integer(12, 2).unwrap_or(0),
                        restored.current_frame_local_integer(16, 2).unwrap_or(0),
                        restored.current_frame_local_integer(20, 2).unwrap_or(0),
                        restored.current_frame_local_integer(1264, 2).unwrap_or(0),
                        restored.current_frame_local_integer(1268, 2).unwrap_or(0),
                        restored.current_frame_local_integer(1272, 2).unwrap_or(0),
                        restored.current_frame_local_integer(1276, 2).unwrap_or(0),
                        restored.current_frame_integer_raw(123420, 2).unwrap_or(0),
                        restored.current_frame_integer_raw(123424, 2).unwrap_or(0),
                        restored.current_frame_integer_raw(128560, 2).unwrap_or(0),
                        restored.current_frame_integer_raw(128564, 2).unwrap_or(0),
                        restored.current_frame_integer_raw(128576, 2).unwrap_or(0),
                        stack,
                        trace.total_service_count,
                    );
                }
                Err(error) => {
                    println!(
                        "runtime_handles_scrmain_cumulative chunk={} err={error:?} frame_cursor={} frame_last=0x{:x} l4={} l12={} l16={} l20={} l1264={} l1268={} l1272={} l1276={} raw123420={} raw123424={} raw128560={} raw128564={} raw128576={} stack={:?}",
                        chunk,
                        frame.as_ref().map_or(usize::MAX, |f| f.cursor),
                        frame.as_ref().map_or(0, |f| f.last_instruction_offset),
                        restored.current_frame_local_integer(4, 2).unwrap_or(0),
                        restored.current_frame_local_integer(12, 2).unwrap_or(0),
                        restored.current_frame_local_integer(16, 2).unwrap_or(0),
                        restored.current_frame_local_integer(20, 2).unwrap_or(0),
                        restored.current_frame_local_integer(1264, 2).unwrap_or(0),
                        restored.current_frame_local_integer(1268, 2).unwrap_or(0),
                        restored.current_frame_local_integer(1272, 2).unwrap_or(0),
                        restored.current_frame_local_integer(1276, 2).unwrap_or(0),
                        restored.current_frame_integer_raw(123420, 2).unwrap_or(0),
                        restored.current_frame_integer_raw(123424, 2).unwrap_or(0),
                        restored.current_frame_integer_raw(128560, 2).unwrap_or(0),
                        restored.current_frame_integer_raw(128564, 2).unwrap_or(0),
                        restored.current_frame_integer_raw(128576, 2).unwrap_or(0),
                        stack,
                    );
                }
            }
            snapshot = state;
            if frame
                .as_ref()
                .is_some_and(|f| f.last_instruction_offset == 0x31c)
            {
                break;
            }
        }
        Ok(())
    }

    #[test]
    #[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
    fn traces_scrmain_call_target_shape_at_31c() -> Result<()> {
        let game_dir = env::var_os("SAKURA_INSTALL_DIR")
            .map(PathBuf::from)
            .ok_or_else(|| {
                SakuraError::InvalidRuntime(
                    "SAKURA_INSTALL_DIR is required for this ignored local-install probe"
                        .to_owned(),
                )
            })?;
        let mut runtime = Runtime::new(RuntimeConfig::default());
        for path in collect_archive_files(&game_dir)? {
            let data = fs::read(&path).map_err(|error| {
                SakuraError::InvalidRuntime(format!("failed to read archive for test: {error}"))
            })?;
            runtime.mount_archive_data_named(data, path.file_name().and_then(OsStr::to_str).map(|name| name.as_bytes().to_vec()).as_deref())?;
        }
        let scripts = runtime.scripts();
        let entry_index = runtime
            .script_index_by_name(b"scrmain._bp")
            .ok_or_else(|| SakuraError::InvalidRuntime("scrmain._bp is missing".to_owned()))?;
        let entry = scripts
            .id_from_index(entry_index)
            .ok_or_else(|| SakuraError::InvalidRuntime("scrmain entry is invalid".to_owned()))?;
        let host = SystemHost::with_runtime(&runtime);
        let mut system_runtime = SystemRuntime::new(scripts, host);
        system_runtime.push_script_at(entry, None, Vec::new())?;
        let (_summary, _trace) = system_runtime.run_with_service_trace(1, 100_000, 4)?;

        let mut snapshot = system_runtime.snapshot();
        println!("runtime_handles_scrmain_call_target_shape_probe_version=1");
        for chunk in 0..160usize {
            let mut replay = SystemRuntime::restore(&runtime, snapshot.clone())?;
            let before = replay.snapshot();
            let before_frame = replay.current_frame_state().unwrap_or_default();
            let l4 = replay.current_frame_local_integer(4, 2).unwrap_or(0) as u32;
            let selected_address = 123420u32.saturating_add(l4.saturating_mul(4));
            let before_stack = before
                .frames
                .last()
                .map(|frame| format_snapshot_stack(&frame.vm.stack))
                .unwrap_or_else(|| "none".to_owned());
            let before_slot = describe_global_slot_value(&runtime, &before, selected_address);
            let result = replay.run_with_service_trace(1, 2, 4);
            let after = replay.snapshot();
            let after_frame = replay.current_frame_state().unwrap_or_default();
            let after_stack = after
                .frames
                .last()
                .map(|frame| format_snapshot_stack(&frame.vm.stack))
                .unwrap_or_else(|| "none".to_owned());
            println!(
                "runtime_handles_scrmain_call_target_shape chunk={} before_script={} before_cursor={} before_last=0x{:x} l4={} selected_addr=0x{:x} raw={:#010x} slot={} before_stack={} after_script={} after_cursor={} after_last=0x{:x} after_stack={} result={:?}",
                chunk,
                before_frame.script_index,
                before_frame.cursor,
                before_frame.last_instruction_offset,
                l4,
                selected_address,
                replay.current_frame_integer_raw(selected_address, 2).unwrap_or(0),
                before_slot,
                before_stack,
                after_frame.script_index,
                after_frame.cursor,
                after_frame.last_instruction_offset,
                after_stack,
                result.as_ref().map(|(summary, _trace)| (
                    summary.event_count,
                    summary.service_event_count,
                    summary.user_call_event_count,
                    summary.halted_event_count,
                    summary.completed,
                    summary.event_limited,
                )),
            );
            if let Err(error) = result {
                println!(
                    "runtime_handles_scrmain_call_target_shape chunk={} error={error:?}",
                    chunk,
                );
                break;
            }
            if after_frame.last_instruction_offset == 0x31c {
                let l4_after = replay.current_frame_local_integer(4, 2).unwrap_or(0) as u32;
                let selected_after = 123420u32.saturating_add(l4_after.saturating_mul(4));
                println!(
                    "runtime_handles_scrmain_call_target_shape reached_31c chunk={} selected_addr=0x{:x} raw={:#010x} slot={} stack={}",
                    chunk,
                    selected_after,
                    replay.current_frame_integer_raw(selected_after, 2).unwrap_or(0),
                    describe_global_slot_value(&runtime, &after, selected_after),
                    after_stack,
                );
                break;
            }
            snapshot = after;
        }
        Ok(())
    }

    fn format_watched_values(addresses: &[u32], values: &[u64]) -> String {
        addresses
            .iter()
            .zip(values.iter())
            .map(|(address, value)| format!("0x{address:x}={value:#010x}"))
            .collect::<Vec<_>>()
            .join(",")
    }

    #[test]
    #[ignore = "requires SAKURA_INSTALL_DIR pointing at the user-owned local install"]
    fn experiments_scrdrv_sys33_void_override() -> Result<()> {
        let game_dir = env::var_os("SAKURA_INSTALL_DIR")
            .map(PathBuf::from)
            .ok_or_else(|| {
                SakuraError::InvalidRuntime(
                    "SAKURA_INSTALL_DIR is required for this ignored local-install probe"
                        .to_owned(),
                )
            })?;
        let mut runtime = Runtime::new(RuntimeConfig::default());
        for path in collect_archive_files(&game_dir)? {
            let data = fs::read(&path).map_err(|error| {
                SakuraError::InvalidRuntime(format!("failed to read archive for test: {error}"))
            })?;
            runtime.mount_archive_data_named(
                data,
                path.file_name()
                    .and_then(OsStr::to_str)
                    .map(|name| name.as_bytes().to_vec())
                    .as_deref(),
            )?;
        }
        let scripts = runtime.scripts();
        let entry_index = runtime
            .script_index_by_name(b"scrdrv._bp")
            .ok_or_else(|| SakuraError::InvalidRuntime("scrdrv._bp is missing".to_owned()))?;
        let entry = scripts
            .id_from_index(entry_index)
            .ok_or_else(|| SakuraError::InvalidRuntime("scrdrv entry is invalid".to_owned()))?;
        let mut host = SystemHost::with_runtime(&runtime);
        let mut vm = scripts
            .system_vm(entry)?
            .ok_or_else(|| SakuraError::InvalidRuntime("scrdrv._bp is not a system script".to_owned()))?;

        println!("runtime_handles_scrdrv_sys33_void_override_probe_version=1");
        for step in 0..28usize {
            let event = vm.next_event()?;
            let before_stack = format_vm_stack(vm.stack());
            let frame = format!("{}:0x{:x}", entry.index(), vm.last_instruction_offset().unwrap_or(0));
            let event_desc = match &event {
                crate::system_vm::SystemVmEvent::ServiceCall {
                    family,
                    service_id,
                    args,
                } => format!(
                    "{}:{:02x}:argc{}:{}",
                    family_label(*family),
                    service_id,
                    args.len(),
                    format_vm_stack(args)
                ),
                crate::system_vm::SystemVmEvent::LoadedProgramCall { handle, args, .. } => {
                    format!("loaded:{}:argc{}:{}", handle, args.len(), format_vm_stack(args))
                }
                crate::system_vm::SystemVmEvent::UserScriptCall {
                    service_id,
                    args,
                } => format!("user:{service_id:02x}:argc{}:{}", args.len(), format_vm_stack(args)),
                crate::system_vm::SystemVmEvent::UserScriptLoad => "user-load".to_owned(),
                crate::system_vm::SystemVmEvent::UserScriptFree { args } => {
                    format!("user-free:argc{}:{}", args.len(), format_vm_stack(args))
                }
                crate::system_vm::SystemVmEvent::UserScriptReturn => "user-return".to_owned(),
                crate::system_vm::SystemVmEvent::Halted => "halted".to_owned(),
            };
            let result = match &event {
                crate::system_vm::SystemVmEvent::ServiceCall {
                    family: crate::SystemCallFamily::System,
                    service_id: 0x33,
                    ..
                } => Some(crate::system_host::SystemHostResult::Void),
                _ => host.event_result(&event),
            };
            println!(
                "runtime_handles_scrdrv_sys33_void_override_step={} frame={} event={} before_stack={} l32={} l36={} l40={} l44={} l48={}",
                step,
                frame,
                event_desc,
                before_stack,
                vm.host_local_integer(32, 2).unwrap_or(0),
                vm.host_local_integer(36, 2).unwrap_or(0),
                vm.host_local_integer(40, 2).unwrap_or(0),
                vm.host_local_integer(44, 2).unwrap_or(0),
                vm.host_local_integer(48, 2).unwrap_or(0),
            );
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
            println!(
                "runtime_handles_scrdrv_sys33_void_override_after_step={} after_stack={} mem_ptr=0x{:x} l32={} l36={} l40={} l44={} l48={}",
                step,
                format_vm_stack(vm.stack()),
                vm.mem_ptr(),
                vm.host_local_integer(32, 2).unwrap_or(0),
                vm.host_local_integer(36, 2).unwrap_or(0),
                vm.host_local_integer(40, 2).unwrap_or(0),
                vm.host_local_integer(44, 2).unwrap_or(0),
                vm.host_local_integer(48, 2).unwrap_or(0),
            );
        }
        Ok(())
    }

    fn format_value_changes(addresses: &[u32], before: &[u64], after: &[u64]) -> String {
        addresses
            .iter()
            .zip(before.iter().zip(after.iter()))
            .filter_map(|(address, (before, after))| {
                (before != after).then_some(format!("0x{address:x}:{before:#010x}->{after:#010x}"))
            })
            .collect::<Vec<_>>()
            .join(",")
    }

    fn collect_runtime_raw_values(runtime: &SystemRuntime<'_>, addresses: &[u32]) -> Vec<u64> {
        addresses
            .iter()
            .map(|address| runtime.current_frame_integer_raw(*address, 2).unwrap_or(0))
            .collect()
    }

    fn write_snapshot_global_u32(
        snapshot: &mut crate::system_runtime::SystemRuntimeSnapshot,
        address: u32,
        value: u32,
    ) -> Result<()> {
        let frame = snapshot.frames.last_mut().ok_or_else(|| {
            SakuraError::InvalidRuntime("snapshot frame is missing for global patch".to_owned())
        })?;
        let offset = address as usize;
        let global_mem = frame.vm.global_mem.first_mut().ok_or_else(|| {
            SakuraError::InvalidRuntime("snapshot global memory slot 0 is missing".to_owned())
        })?;
        if offset + 4 > global_mem.len() {
            return Err(SakuraError::InvalidRuntime(format!(
                "snapshot global patch address 0x{address:x} is out of range"
            )));
        }
        global_mem[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
        let global_slots = frame.vm.global_slots.first_mut().ok_or_else(|| {
            SakuraError::InvalidRuntime("snapshot global slot 0 is missing".to_owned())
        })?;
        global_slots.insert(
            offset,
            crate::system_vm::SystemValueSnapshot::Integer(value.into()),
        );
        Ok(())
    }

    fn format_snapshot_global_bytes(
        snapshot: &crate::system_runtime::SystemRuntimeSnapshot,
        offset: usize,
        len: usize,
    ) -> String {
        snapshot
            .frames
            .last()
            .and_then(|frame| frame.vm.global_mem.first())
            .and_then(|mem| mem.get(offset..offset.saturating_add(len)))
            .map(format_bytes_hex)
            .unwrap_or_else(|| "none".to_owned())
    }

    fn format_snapshot_aux_bytes(
        snapshot: &crate::system_runtime::SystemRuntimeSnapshot,
        slot: usize,
        offset: usize,
        len: usize,
    ) -> String {
        snapshot
            .frames
            .last()
            .and_then(|frame| frame.vm.aux_mem.get(slot))
            .and_then(|mem| mem.get(offset..offset.saturating_add(len)))
            .map(format_bytes_hex)
            .unwrap_or_else(|| "none".to_owned())
    }

    fn read_snapshot_aux_u32(
        snapshot: &crate::system_runtime::SystemRuntimeSnapshot,
        slot: usize,
        offset: usize,
    ) -> String {
        snapshot
            .frames
            .last()
            .and_then(|frame| frame.vm.aux_mem.get(slot))
            .and_then(|mem| mem.get(offset..offset.saturating_add(4)))
            .map(|bytes| {
                let value = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
                format!("{value:#010x}")
            })
            .unwrap_or_else(|| "none".to_owned())
    }

    fn write_snapshot_aux_u32(
        snapshot: &mut crate::system_runtime::SystemRuntimeSnapshot,
        slot: usize,
        offset: usize,
        value: u32,
    ) -> Result<()> {
        let frame = snapshot.frames.last_mut().ok_or_else(|| {
            SakuraError::InvalidRuntime("snapshot frame is missing for aux patch".to_owned())
        })?;
        let aux_mem = frame.vm.aux_mem.get_mut(slot).ok_or_else(|| {
            SakuraError::InvalidRuntime(format!("snapshot aux slot {slot} is missing"))
        })?;
        if offset + 4 > aux_mem.len() {
            return Err(SakuraError::InvalidRuntime(format!(
                "snapshot aux patch offset 0x{offset:x} is out of range"
            )));
        }
        aux_mem[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
        if let Some(aux_slots) = frame.vm.aux_slots.get_mut(slot) {
            aux_slots.insert(
                offset,
                crate::system_vm::SystemValueSnapshot::Integer(value.into()),
            );
        }
        Ok(())
    }

    fn format_bytes_hex(bytes: &[u8]) -> String {
        bytes
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<Vec<_>>()
            .join("")
    }

    fn describe_global_slot_value(
        runtime: &Runtime,
        snapshot: &crate::system_runtime::SystemRuntimeSnapshot,
        address: u32,
    ) -> String {
        let Some(frame) = snapshot.frames.last() else {
            return "noframe".to_owned();
        };
        let slot = frame
            .vm
            .global_slots
            .first()
            .and_then(|slots| slots.get(&(address as usize)));
        match slot {
            Some(crate::system_vm::SystemValueSnapshot::CodeInScript {
                script_index,
                offset,
            }) => {
                let script_name = runtime
                    .scripts()
                    .id_from_index(*script_index)
                    .and_then(|id| runtime.scripts().name_by_id(id))
                    .map(|name| String::from_utf8_lossy(name).into_owned())
                    .unwrap_or_else(|| "<unknown>".to_owned());
                format!("code:{script_index}:{offset:#x}:{script_name}")
            }
            Some(crate::system_vm::SystemValueSnapshot::Code(offset)) => {
                format!("code-local:{offset:#x}")
            }
            Some(crate::system_vm::SystemValueSnapshot::Integer(value)) => {
                format!("int:{value:#010x}")
            }
            Some(crate::system_vm::SystemValueSnapshot::VariablePointer(value)) => {
                format!("ptr:{value:#010x}")
            }
            Some(other) => describe_snapshot_value(other),
            None => "none".to_owned(),
        }
    }

    fn build_synthetic_dsc(plain: &[u8]) -> Vec<u8> {
        let hash = 0x1234_5678u32;
        let tree_len = 512usize;
        let header_len = 32usize;
        let mut dsc = vec![0u8; header_len + tree_len + plain.len()];
        dsc[..16].copy_from_slice(b"DSC FORMAT 1.00\0");
        dsc[16..20].copy_from_slice(&hash.to_le_bytes());
        dsc[20..24].copy_from_slice(&(plain.len() as u32).to_le_bytes());
        let mut current = hash;
        for symbol in 0..tree_len {
            let (next, mask) = next_dsc_mask(current);
            current = next;
            let depth = if symbol < 256 { 8u8 } else { 0u8 };
            dsc[header_len + symbol] = depth.wrapping_add(mask);
        }
        dsc[header_len + tree_len..].copy_from_slice(plain);
        dsc
    }

    fn next_dsc_mask(hash: u32) -> (u32, u8) {
        let edx = 20021u32.wrapping_mul(hash & 0xffff);
        let eax = 20021u32
            .wrapping_mul((hash >> 16) & 0xffff)
            .wrapping_add(346u32.wrapping_mul(hash))
            .wrapping_add((edx >> 16) & 0xffff);
        let next = ((eax & 0xffff) << 16)
            .wrapping_add(edx & 0xffff)
            .wrapping_add(1);
        (next, (eax & 0xff) as u8)
    }

    fn build_arc20(files: &[(&str, &[u8])]) -> Vec<u8> {
        const HEADER_LEN: usize = 16;
        const ENTRY_LEN: usize = 128;
        const NAME_LEN: usize = 96;

        let mut data = Vec::new();
        data.extend_from_slice(b"BURIKO ARC20");
        data.extend_from_slice(&(files.len() as u32).to_le_bytes());
        data.resize(HEADER_LEN + files.len() * ENTRY_LEN, 0);

        let mut next_offset = 0usize;
        for (index, (name, payload)) in files.iter().enumerate() {
            let entry_offset = HEADER_LEN + index * ENTRY_LEN;
            data[entry_offset..entry_offset + name.len()].copy_from_slice(name.as_bytes());
            data[entry_offset + NAME_LEN..entry_offset + NAME_LEN + 4]
                .copy_from_slice(&(next_offset as u32).to_le_bytes());
            data[entry_offset + NAME_LEN + 4..entry_offset + NAME_LEN + 8]
                .copy_from_slice(&(payload.len() as u32).to_le_bytes());
            next_offset += payload.len();
        }
        for (_, payload) in files {
            data.extend_from_slice(payload);
        }
        data
    }

    fn build_archive_manifest(files: &[(&str, u32)]) -> Vec<u8> {
        let data_start = 16usize + files.len() * 128;
        let mut manifest = Vec::new();
        manifest.extend_from_slice(&(files.len() as u32).to_le_bytes());
        manifest.extend_from_slice(&(data_start as u64).to_le_bytes());
        let mut next_offset = 0u32;
        for (name, size) in files {
            manifest.extend_from_slice(&(name.len() as u16).to_le_bytes());
            manifest.extend_from_slice(&next_offset.to_le_bytes());
            manifest.extend_from_slice(&size.to_le_bytes());
            manifest.extend_from_slice(name.as_bytes());
            next_offset = next_offset.saturating_add(*size);
        }
        manifest
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

    fn collect_files(root: &Path) -> Result<Vec<PathBuf>> {
        let mut files = Vec::new();
        collect_files_inner(root, &mut files)?;
        files.sort();
        Ok(files)
    }

    fn collect_files_inner(path: &Path, files: &mut Vec<PathBuf>) -> Result<()> {
        let entries = fs::read_dir(path).map_err(|error| {
            SakuraError::InvalidRuntime(format!("failed to read directory for test: {error}"))
        })?;
        for entry in entries {
            let entry = entry.map_err(|error| {
                SakuraError::InvalidRuntime(format!(
                    "failed to read directory entry for test: {error}"
                ))
            })?;
            let path = entry.path();
            let file_type = entry.file_type().map_err(|error| {
                SakuraError::InvalidRuntime(format!("failed to read file type for test: {error}"))
            })?;
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
}
