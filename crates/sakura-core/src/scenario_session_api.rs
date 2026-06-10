use std::collections::{BTreeMap, VecDeque};
use std::sync::{Mutex, OnceLock};

use crate::dsc::decompress_dsc;
use crate::error::{Result, SakuraError};
use crate::scenario::ScenarioProgram;
use crate::scenario_snapshot::{
    parse_snapshot, snapshot_len as serialized_snapshot_len, write_snapshot,
};
use crate::session::{
    BacklogEntry, PlayerConfig, ScenarioSession, SessionEvent, SessionMode, SessionSnapshot,
};

pub const SCENARIO_SESSION_STEP_PACKET_LEN: usize = 40;
const FFI_SIZE_ERROR: usize = usize::MAX;

static SESSION_STORE: OnceLock<Mutex<SessionStore>> = OnceLock::new();

#[derive(Debug, Clone)]
struct StoredScenarioSession {
    data: Vec<u8>,
    snapshot: Option<SessionSnapshot>,
    config: PlayerConfig,
    backlog: VecDeque<BacklogEntry>,
    current_payload: Vec<u8>,
}

#[derive(Debug)]
struct SessionStore {
    next_handle: u32,
    sessions: BTreeMap<u32, StoredScenarioSession>,
}

impl Default for SessionStore {
    fn default() -> Self {
        Self {
            next_handle: 1,
            sessions: BTreeMap::new(),
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn sakura_scenario_session_create_from_dsc(
    ptr: *const u8,
    len: usize,
) -> u32 {
    let Some(data) = (unsafe { slice_from_abi(ptr, len) }) else {
        return 0;
    };
    create_session_from_dsc_payload(data).unwrap_or(0)
}

#[no_mangle]
pub extern "C" fn sakura_scenario_session_destroy(handle: u32) -> u32 {
    destroy_session(handle).map_or(0, |_| 1)
}

#[no_mangle]
pub extern "C" fn sakura_scenario_session_clone(handle: u32) -> u32 {
    clone_session(handle).unwrap_or(0)
}

#[no_mangle]
pub extern "C" fn sakura_scenario_session_mode(handle: u32) -> u32 {
    session_mode(handle).unwrap_or(0)
}

#[no_mangle]
pub extern "C" fn sakura_scenario_session_snapshot_len(handle: u32) -> usize {
    snapshot_len(handle).unwrap_or(FFI_SIZE_ERROR)
}

#[no_mangle]
pub unsafe extern "C" fn sakura_scenario_session_snapshot_write(
    handle: u32,
    out_ptr: *mut u8,
    out_len: usize,
) -> usize {
    let Some(out) = (unsafe { mutable_slice_from_abi(out_ptr, out_len) }) else {
        return FFI_SIZE_ERROR;
    };
    snapshot_write(handle, out).unwrap_or(FFI_SIZE_ERROR)
}

#[no_mangle]
pub unsafe extern "C" fn sakura_scenario_session_restore_snapshot(
    handle: u32,
    ptr: *const u8,
    len: usize,
) -> u32 {
    let Some(data) = (unsafe { slice_from_abi(ptr, len) }) else {
        return 0;
    };
    restore_snapshot(handle, data).map_or(0, |_| 1)
}

#[no_mangle]
pub extern "C" fn sakura_scenario_session_step_packet_len() -> usize {
    SCENARIO_SESSION_STEP_PACKET_LEN
}

#[no_mangle]
pub unsafe extern "C" fn sakura_scenario_session_step_write(
    handle: u32,
    out_ptr: *mut u8,
    out_len: usize,
) -> usize {
    let Some(out) = (unsafe { mutable_slice_from_abi(out_ptr, out_len) }) else {
        return FFI_SIZE_ERROR;
    };
    if out.len() < SCENARIO_SESSION_STEP_PACKET_LEN {
        return FFI_SIZE_ERROR;
    }
    step_session(handle, out).unwrap_or(FFI_SIZE_ERROR)
}

#[no_mangle]
pub extern "C" fn sakura_scenario_session_advance_message(handle: u32) -> u32 {
    advance_message(handle).map_or(0, |_| 1)
}

#[no_mangle]
pub extern "C" fn sakura_scenario_session_select_choice(handle: u32, index: usize) -> u32 {
    select_choice(handle, index).map_or(0, |_| 1)
}

#[no_mangle]
pub extern "C" fn sakura_scenario_session_current_payload_len(handle: u32) -> usize {
    current_payload_len(handle).unwrap_or(0)
}

#[no_mangle]
pub unsafe extern "C" fn sakura_scenario_session_current_payload_write(
    handle: u32,
    out_ptr: *mut u8,
    out_len: usize,
) -> usize {
    let Some(out) = (unsafe { mutable_slice_from_abi(out_ptr, out_len) }) else {
        return FFI_SIZE_ERROR;
    };
    current_payload_write(handle, out).unwrap_or(FFI_SIZE_ERROR)
}

fn create_session_from_dsc_payload(payload: &[u8]) -> Result<u32> {
    let data = decompress_dsc(payload)?;
    ScenarioProgram::parse(&data)?;
    let session = StoredScenarioSession {
        data,
        snapshot: None,
        config: PlayerConfig::default(),
        backlog: VecDeque::new(),
        current_payload: Vec::new(),
    };
    let mut store = lock_store()?;
    store.insert(session)
}

fn destroy_session(handle: u32) -> Result<()> {
    let mut store = lock_store()?;
    store.sessions.remove(&handle).ok_or_else(|| {
        SakuraError::InvalidRuntime("scenario session handle is invalid".to_owned())
    })?;
    Ok(())
}

fn clone_session(handle: u32) -> Result<u32> {
    let mut store = lock_store()?;
    let session = store.session(handle)?.clone();
    store.insert(session)
}

fn session_mode(handle: u32) -> Result<u32> {
    let store = lock_store()?;
    let session = store.session(handle)?;
    Ok(session
        .snapshot
        .as_ref()
        .map_or(1, |snapshot| session_mode_code(snapshot.mode())))
}

fn step_session(handle: u32, out: &mut [u8]) -> Result<usize> {
    let mut store = lock_store()?;
    let stored = store.session_mut(handle)?;
    let (payload, backlog_entry, backlog_limit, snapshot) = {
        let mut session = stored.restore_session()?;
        let event = session.step()?;
        let payload = event_payload(&event);
        out[..SCENARIO_SESSION_STEP_PACKET_LEN].fill(0);
        write_u32(out, 0, 1);
        write_u32(out, 4, session_event_code(&event));
        write_u32(out, 8, session_mode_code(session.mode()));
        write_u32(out, 12, saturating_u64(session.event_count()));
        write_event_lengths(out, &event, payload.len());
        let backlog_entry = match &event {
            SessionEvent::Message {
                event_index,
                name,
                text,
            } => Some(BacklogEntry {
                event_index: *event_index,
                name: name.map(Vec::from),
                text: Vec::from(*text),
            }),
            _ => None,
        };
        (
            payload,
            backlog_entry,
            session.config().backlog_limit,
            session.snapshot(),
        )
    };
    if let Some(entry) = backlog_entry {
        stored.backlog.push_back(entry);
        trim_backlog(&mut stored.backlog, backlog_limit);
    }
    write_u32(out, 36, saturating_u32(stored.backlog.len()));
    stored.current_payload = payload;
    stored.snapshot = Some(snapshot);
    Ok(SCENARIO_SESSION_STEP_PACKET_LEN)
}

fn advance_message(handle: u32) -> Result<()> {
    let mut store = lock_store()?;
    let stored = store.session_mut(handle)?;
    let mut session = stored.restore_session()?;
    session.advance_message()?;
    stored.snapshot = Some(session.snapshot());
    Ok(())
}

fn select_choice(handle: u32, index: usize) -> Result<()> {
    let mut store = lock_store()?;
    let stored = store.session_mut(handle)?;
    let mut session = stored.restore_session()?;
    session.select_choice(index)?;
    stored.snapshot = Some(session.snapshot());
    Ok(())
}

fn current_payload_len(handle: u32) -> Result<usize> {
    let store = lock_store()?;
    Ok(store.session(handle)?.current_payload.len())
}

fn current_payload_write(handle: u32, out: &mut [u8]) -> Result<usize> {
    let store = lock_store()?;
    let payload = &store.session(handle)?.current_payload;
    if out.len() < payload.len() {
        return Err(SakuraError::InvalidRuntime(
            "scenario session payload buffer is too small".to_owned(),
        ));
    }
    out[..payload.len()].copy_from_slice(payload);
    Ok(payload.len())
}

fn snapshot_len(handle: u32) -> Result<usize> {
    let store = lock_store()?;
    let stored = store.session(handle)?;
    let snapshot = stored.materialized_snapshot()?;
    serialized_snapshot_len(&snapshot)
}

fn snapshot_write(handle: u32, out: &mut [u8]) -> Result<usize> {
    let store = lock_store()?;
    let stored = store.session(handle)?;
    let snapshot = stored.materialized_snapshot()?;
    write_snapshot(&snapshot, out)
}

fn restore_snapshot(handle: u32, data: &[u8]) -> Result<()> {
    let parsed = parse_snapshot(data)?;
    let mut store = lock_store()?;
    let stored = store.session_mut(handle)?;
    let program = ScenarioProgram::parse(&stored.data)?;
    let session = ScenarioSession::restore(program, parsed)?;
    stored.config = session.config().clone();
    stored.snapshot = Some(session.snapshot());
    stored.backlog.clear();
    stored.current_payload.clear();
    Ok(())
}

impl StoredScenarioSession {
    fn restore_session(&self) -> Result<ScenarioSession<'_>> {
        let program = ScenarioProgram::parse(&self.data)?;
        match &self.snapshot {
            Some(snapshot) => ScenarioSession::restore(program, snapshot.clone()),
            None => ScenarioSession::new(program, self.config.clone()),
        }
    }

    fn materialized_snapshot(&self) -> Result<SessionSnapshot> {
        match &self.snapshot {
            Some(snapshot) => Ok(snapshot.clone()),
            None => {
                let program = ScenarioProgram::parse(&self.data)?;
                Ok(ScenarioSession::new(program, self.config.clone())?.snapshot())
            }
        }
    }
}

impl SessionStore {
    fn insert(&mut self, session: StoredScenarioSession) -> Result<u32> {
        for _ in 0..u32::MAX {
            let handle = self.next_handle;
            self.next_handle = self.next_handle.wrapping_add(1).max(1);
            if handle != 0 && !self.sessions.contains_key(&handle) {
                self.sessions.insert(handle, session);
                return Ok(handle);
            }
        }
        Err(SakuraError::InvalidRuntime(
            "scenario session handle space is exhausted".to_owned(),
        ))
    }

    fn session(&self, handle: u32) -> Result<&StoredScenarioSession> {
        self.sessions.get(&handle).ok_or_else(|| {
            SakuraError::InvalidRuntime("scenario session handle is invalid".to_owned())
        })
    }

    fn session_mut(&mut self, handle: u32) -> Result<&mut StoredScenarioSession> {
        self.sessions.get_mut(&handle).ok_or_else(|| {
            SakuraError::InvalidRuntime("scenario session handle is invalid".to_owned())
        })
    }
}

fn event_payload(event: &SessionEvent<'_>) -> Vec<u8> {
    let mut payload = Vec::new();
    match event {
        SessionEvent::Message { name, text, .. } => {
            if let Some(name) = name {
                payload.extend_from_slice(name);
            }
            payload.extend_from_slice(text);
        }
        SessionEvent::Choice { options, .. } => {
            for option in options {
                write_len_prefixed(&mut payload, option);
            }
        }
        SessionEvent::UserFunction { function, .. } => {
            payload.extend_from_slice(function.name);
            for arg in &function.string_args {
                write_len_prefixed(&mut payload, arg);
            }
        }
        SessionEvent::Halted => {}
    }
    payload
}

fn write_event_lengths(out: &mut [u8], event: &SessionEvent<'_>, payload_len: usize) {
    match event {
        SessionEvent::Message { name, text, .. } => {
            write_u32(out, 16, name.map_or(0, |value| saturating_u32(value.len())));
            write_u32(out, 20, saturating_u32(text.len()));
        }
        SessionEvent::Choice { options, .. } => write_u32(out, 24, saturating_u32(options.len())),
        SessionEvent::UserFunction { function, .. } => {
            write_u32(out, 16, saturating_u32(function.name.len()));
            write_u32(out, 28, saturating_u32(function.string_args.len()));
        }
        SessionEvent::Halted => {}
    }
    write_u32(out, 32, saturating_u32(payload_len));
}

fn write_len_prefixed(out: &mut Vec<u8>, value: &[u8]) {
    out.extend_from_slice(&saturating_u32(value.len()).to_le_bytes());
    out.extend_from_slice(value);
}

fn trim_backlog(backlog: &mut VecDeque<BacklogEntry>, limit: usize) {
    while backlog.len() > limit {
        backlog.pop_front();
    }
}

fn session_event_code(event: &SessionEvent<'_>) -> u32 {
    match event {
        SessionEvent::Message { .. } => 1,
        SessionEvent::Choice { .. } => 2,
        SessionEvent::UserFunction { .. } => 3,
        SessionEvent::Halted => 4,
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

fn lock_store() -> Result<std::sync::MutexGuard<'static, SessionStore>> {
    SESSION_STORE
        .get_or_init(|| Mutex::new(SessionStore::default()))
        .lock()
        .map_err(|_| SakuraError::InvalidRuntime("scenario session store is poisoned".to_owned()))
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
    use crate::scenario_snapshot::SNAPSHOT_MAGIC;
    use crate::script::BURIKO_SCRIPT_V1_MAGIC;

    #[test]
    fn wasm_session_handle_steps_messages_choices_and_payloads() -> Result<()> {
        let handle = create_session_from_dsc_payload(&build_synthetic_dsc(&synthetic_script()))?;
        let mut packet = vec![0; SCENARIO_SESSION_STEP_PACKET_LEN];

        step_session(handle, &mut packet)?;
        assert_eq!(read_u32(&packet, 4)?, 1);
        assert_eq!(read_u32(&packet, 8)?, 2);
        assert_eq!(current_payload(handle)?, b"first");
        assert!(step_session(handle, &mut packet).is_err());

        advance_message(handle)?;
        step_session(handle, &mut packet)?;
        assert_eq!(read_u32(&packet, 4)?, 2);
        assert_eq!(read_u32(&packet, 8)?, 3);
        assert_eq!(read_u32(&packet, 24)?, 2);
        assert!(select_choice(handle, 2).is_err());
        select_choice(handle, 1)?;

        step_session(handle, &mut packet)?;
        assert_eq!(read_u32(&packet, 4)?, 1);
        assert_eq!(read_u32(&packet, 36)?, 2);
        assert_eq!(current_payload(handle)?, b"second");
        let cloned = clone_session(handle)?;
        assert_eq!(session_mode(cloned)?, 2);
        assert_eq!(current_payload(cloned)?, b"second");
        destroy_session(cloned)?;
        destroy_session(handle)?;
        assert!(session_mode(handle).is_err());
        Ok(())
    }

    #[test]
    fn snapshots_restore_without_payload_or_backlog_text() -> Result<()> {
        let handle = create_session_from_dsc_payload(&build_synthetic_dsc(&synthetic_script()))?;
        let mut packet = vec![0; SCENARIO_SESSION_STEP_PACKET_LEN];

        step_session(handle, &mut packet)?;
        advance_message(handle)?;
        step_session(handle, &mut packet)?;
        assert_eq!(read_u32(&packet, 4)?, 2);
        assert_eq!(read_u32(&packet, 24)?, 2);

        let len = snapshot_len(handle)?;
        let mut snapshot = vec![0; len];
        assert_eq!(snapshot_write(handle, &mut snapshot)?, len);
        assert_eq!(snapshot.get(..8), Some(SNAPSHOT_MAGIC.as_slice()));
        assert_eq!(read_u32(&snapshot, 12)?, 3);
        assert_eq!(read_u32(&snapshot, 60)?, 2);
        assert_eq!(
            snapshot
                .windows(b"left".len())
                .position(|win| win == b"left"),
            None
        );
        assert_eq!(
            snapshot
                .windows(b"first".len())
                .position(|win| win == b"first"),
            None
        );

        let restored = create_session_from_dsc_payload(&build_synthetic_dsc(&synthetic_script()))?;
        restore_snapshot(restored, &snapshot)?;
        assert_eq!(session_mode(restored)?, 3);
        select_choice(restored, 1)?;
        step_session(restored, &mut packet)?;
        assert_eq!(read_u32(&packet, 4)?, 1);
        assert_eq!(current_payload(restored)?, b"second");
        destroy_session(restored)?;
        destroy_session(handle)?;
        Ok(())
    }

    fn current_payload(handle: u32) -> Result<Vec<u8>> {
        let mut out = vec![0; current_payload_len(handle)?];
        current_payload_write(handle, &mut out)?;
        Ok(out)
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

    fn synthetic_script() -> Vec<u8> {
        let mut script = synthetic_v1_header();
        append_push_string(&mut script, 48);
        append_opcode(&mut script, 0x0140);
        append_push_string(&mut script, 54);
        append_push_string(&mut script, 59);
        append_opcode(&mut script, 0x0160);
        append_push_string(&mut script, 65);
        append_opcode(&mut script, 0x0140);
        append_opcode(&mut script, 0x001b);
        script.extend_from_slice(b"first\0left\0right\0second\0");
        script
    }

    fn synthetic_v1_header() -> Vec<u8> {
        let mut script = Vec::new();
        script.extend_from_slice(BURIKO_SCRIPT_V1_MAGIC);
        script.extend_from_slice(&12i32.to_le_bytes());
        script.extend_from_slice(&0i32.to_le_bytes());
        script.extend_from_slice(&0i32.to_le_bytes());
        script
    }

    fn append_push_string(script: &mut Vec<u8>, address: i32) {
        append_opcode(script, 0x0003);
        script.extend_from_slice(&address.to_le_bytes());
    }

    fn append_opcode(script: &mut Vec<u8>, opcode: u32) {
        script.extend_from_slice(&opcode.to_le_bytes());
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
}
