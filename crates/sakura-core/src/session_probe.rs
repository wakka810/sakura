use std::slice;

use crate::dsc::decompress_dsc;
use crate::error::Result;
use crate::scenario::ScenarioProgram;
use crate::session::{PlayerConfig, ScenarioSession, SessionEvent, SessionMode};

pub const SCENARIO_SESSION_PROBE_PACKET_LEN: usize = 40;
const FFI_SIZE_ERROR: usize = usize::MAX;

#[no_mangle]
pub extern "C" fn sakura_dsc_scenario_session_probe_packet_len() -> usize {
    SCENARIO_SESSION_PROBE_PACKET_LEN
}

#[no_mangle]
pub unsafe extern "C" fn sakura_dsc_scenario_session_probe_write(
    ptr: *const u8,
    len: usize,
    out_ptr: *mut u8,
    out_len: usize,
) -> usize {
    let Some(data) = (unsafe { slice_from_abi(ptr, len) }) else {
        return FFI_SIZE_ERROR;
    };
    let Some(out) = (unsafe { mutable_slice_from_abi(out_ptr, out_len) }) else {
        return FFI_SIZE_ERROR;
    };
    if out.len() < SCENARIO_SESSION_PROBE_PACKET_LEN {
        return FFI_SIZE_ERROR;
    }
    match write_scenario_session_probe_packet(data, out) {
        Ok(()) => SCENARIO_SESSION_PROBE_PACKET_LEN,
        Err(_) => FFI_SIZE_ERROR,
    }
}

pub fn write_scenario_session_probe_packet(payload: &[u8], out: &mut [u8]) -> Result<()> {
    let decompressed = decompress_dsc(payload)?;
    let program = ScenarioProgram::parse(&decompressed)?;
    let mut session = ScenarioSession::new(program, PlayerConfig::default())?;
    out[..SCENARIO_SESSION_PROBE_PACKET_LEN].fill(0);
    write_u32(out, 0, 1);

    let event = session.step()?;
    write_u32(out, 4, session_event_code(&event));
    if let SessionEvent::Choice { options, .. } = &event {
        write_u32(out, 20, saturating_u32(options.len()));
    }
    write_u32(out, 8, session_mode_code(session.mode()));
    write_u32(out, 12, saturating_u64(session.event_count()));
    write_u32(out, 16, saturating_u32(session.backlog().len()));

    let snapshot = session.snapshot();
    write_u32(out, 24, session_mode_code(snapshot.mode()));
    write_u32(out, 28, saturating_u64(snapshot.event_count()));
    let restored = ScenarioSession::restore(program, snapshot)?;
    write_u32(out, 32, session_mode_code(restored.mode()));
    write_u32(out, 36, saturating_u64(restored.event_count()));
    Ok(())
}

fn session_event_code(event: &SessionEvent<'_>) -> u32 {
    match event {
        SessionEvent::Message { .. } => 1,
        SessionEvent::Choice { .. } => 2,
        SessionEvent::UserFunction { .. } => 3,
        SessionEvent::Halted => 4,
        SessionEvent::Graph { .. } => 5,
        SessionEvent::Wait { .. } => 6,
        SessionEvent::Sound { .. } => 7,
        SessionEvent::MessageControl { .. } => 8,
    }
}

fn session_mode_code(mode: &SessionMode) -> u32 {
    match mode {
        SessionMode::Running => 1,
        SessionMode::WaitingForMessage => 2,
        SessionMode::WaitingForChoice { .. } => 3,
        SessionMode::Halted => 4,
    }
}

fn write_u32(out: &mut [u8], offset: usize, value: u32) {
    out[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

fn saturating_u32(value: usize) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

fn saturating_u64(value: u64) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

unsafe fn slice_from_abi<'a>(ptr: *const u8, len: usize) -> Option<&'a [u8]> {
    if ptr.is_null() && len != 0 {
        return None;
    }
    Some(unsafe { slice::from_raw_parts(ptr, len) })
}

unsafe fn mutable_slice_from_abi<'a>(ptr: *mut u8, len: usize) -> Option<&'a mut [u8]> {
    if ptr.is_null() && len != 0 {
        return None;
    }
    Some(unsafe { slice::from_raw_parts_mut(ptr, len) })
}
