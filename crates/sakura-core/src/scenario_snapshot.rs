use crate::error::{Result, SakuraError};
use crate::scenario::ScenarioVmCheckpoint;
use crate::session::{PlayerConfig, SessionMode, SessionSnapshot};

pub const SNAPSHOT_MAGIC: &[u8; 8] = b"SKRSLT1\0";
pub const SNAPSHOT_FIXED_LEN: usize = 64;

pub fn snapshot_len(snapshot: &SessionSnapshot) -> Result<usize> {
    SNAPSHOT_FIXED_LEN
        .checked_add(
            snapshot
                .checkpoint()
                .string_stack()
                .len()
                .checked_mul(4)
                .ok_or_else(|| {
                    SakuraError::InvalidRuntime("snapshot string stack length overflows".to_owned())
                })?,
        )
        .and_then(|len| len.checked_add(snapshot.choice_history().len().checked_mul(4)?))
        .ok_or_else(|| SakuraError::InvalidRuntime("snapshot length overflows".to_owned()))
}

pub fn write_snapshot(snapshot: &SessionSnapshot, out: &mut [u8]) -> Result<usize> {
    let required = snapshot_len(snapshot)?;
    if out.len() < required {
        return Err(SakuraError::InvalidRuntime(
            "scenario session snapshot buffer is too small".to_owned(),
        ));
    }

    out[..required].fill(0);
    out[..SNAPSHOT_MAGIC.len()].copy_from_slice(SNAPSHOT_MAGIC);
    write_u32(out, 8, 1);
    write_u32(out, 12, session_mode_code(snapshot.mode()));
    write_u64(out, 16, snapshot.event_count());
    write_u32(out, 24, checked_u32(snapshot.checkpoint().cursor())?);
    write_u32(
        out,
        28,
        checked_u32(snapshot.checkpoint().max_code_address())?,
    );
    write_u32(out, 32, u32::from(snapshot.checkpoint().is_halted()));
    let config = snapshot.config();
    write_u32(out, 36, checked_u32(config.backlog_limit)?);
    write_u32(out, 40, config.text_speed_cps);
    write_u32(out, 44, config.auto_advance_ms);
    out[48] = config.master_volume;
    out[49] = config.bgm_volume;
    out[50] = config.voice_volume;
    out[51] = config.sfx_volume;
    write_u32(
        out,
        52,
        checked_u32(snapshot.checkpoint().string_stack().len())?,
    );
    write_u32(out, 56, checked_u32(snapshot.choice_history().len())?);
    write_u32(out, 60, snapshot_mode_option_count(snapshot.mode())?);

    let mut cursor = SNAPSHOT_FIXED_LEN;
    for value in snapshot.checkpoint().string_stack() {
        out[cursor..cursor + 4].copy_from_slice(&value.to_le_bytes());
        cursor += 4;
    }
    for value in snapshot.choice_history() {
        write_u32(out, cursor, checked_u32(*value)?);
        cursor += 4;
    }
    Ok(required)
}

pub fn parse_snapshot(data: &[u8]) -> Result<SessionSnapshot> {
    if data.len() < SNAPSHOT_FIXED_LEN || data.get(..SNAPSHOT_MAGIC.len()) != Some(SNAPSHOT_MAGIC) {
        return Err(SakuraError::InvalidRuntime(
            "scenario snapshot magic is invalid".to_owned(),
        ));
    }
    if read_u32(data, 8)? != 1 {
        return Err(SakuraError::InvalidRuntime(
            "scenario snapshot version is unsupported".to_owned(),
        ));
    }
    let mode = parse_session_mode(read_u32(data, 12)?, usize_from_u32(read_u32(data, 60)?)?)?;
    let event_count = read_u64(data, 16)?;
    let cursor = usize_from_u32(read_u32(data, 24)?)?;
    let max_code_address = usize_from_u32(read_u32(data, 28)?)?;
    let halted = read_u32(data, 32)? != 0;
    let config = PlayerConfig {
        backlog_limit: usize_from_u32(read_u32(data, 36)?)?,
        text_speed_cps: read_u32(data, 40)?,
        auto_advance_ms: read_u32(data, 44)?,
        master_volume: data[48],
        bgm_volume: data[49],
        voice_volume: data[50],
        sfx_volume: data[51],
    }
    .validated()?;
    let string_stack_len = usize_from_u32(read_u32(data, 52)?)?;
    let choice_history_len = usize_from_u32(read_u32(data, 56)?)?;
    let required = SNAPSHOT_FIXED_LEN
        .checked_add(string_stack_len.checked_mul(4).ok_or_else(|| {
            SakuraError::InvalidRuntime("snapshot string stack length overflows".to_owned())
        })?)
        .and_then(|len| len.checked_add(choice_history_len.checked_mul(4)?))
        .ok_or_else(|| SakuraError::InvalidRuntime("snapshot length overflows".to_owned()))?;
    if data.len() != required {
        return Err(SakuraError::InvalidRuntime(
            "scenario snapshot length mismatch".to_owned(),
        ));
    }
    let mut cursor_offset = SNAPSHOT_FIXED_LEN;
    let mut string_stack = Vec::with_capacity(string_stack_len);
    for _ in 0..string_stack_len {
        string_stack.push(read_i32(data, cursor_offset)?);
        cursor_offset += 4;
    }
    let mut choice_history = Vec::with_capacity(choice_history_len);
    for _ in 0..choice_history_len {
        choice_history.push(usize_from_u32(read_u32(data, cursor_offset)?)?);
        cursor_offset += 4;
    }
    Ok(SessionSnapshot::from_parts_for_restore(
        ScenarioVmCheckpoint::from_parts(cursor, max_code_address, halted, string_stack),
        mode,
        config,
        event_count,
        choice_history,
    ))
}

fn snapshot_mode_option_count(mode: &SessionMode) -> Result<u32> {
    match mode {
        SessionMode::WaitingForChoice { option_count } => checked_u32(*option_count),
        _ => Ok(0),
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

fn parse_session_mode(code: u32, option_count: usize) -> Result<SessionMode> {
    match code {
        1 => Ok(SessionMode::Running),
        2 => Ok(SessionMode::WaitingForMessage),
        3 if option_count > 0 => Ok(SessionMode::WaitingForChoice { option_count }),
        3 => Err(SakuraError::InvalidRuntime(
            "scenario snapshot choice mode requires options".to_owned(),
        )),
        4 => Ok(SessionMode::Halted),
        _ => Err(SakuraError::InvalidRuntime(
            "scenario snapshot mode is invalid".to_owned(),
        )),
    }
}

fn write_u32(out: &mut [u8], offset: usize, value: u32) {
    out[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

fn write_u64(out: &mut [u8], offset: usize, value: u64) {
    out[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
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

fn read_i32(data: &[u8], offset: usize) -> Result<i32> {
    Ok(read_u32(data, offset)? as i32)
}

fn checked_u32(value: usize) -> Result<u32> {
    u32::try_from(value)
        .map_err(|_| SakuraError::InvalidRuntime("scenario snapshot value exceeds u32".to_owned()))
}

fn usize_from_u32(value: u32) -> Result<usize> {
    usize::try_from(value).map_err(|_| {
        SakuraError::InvalidRuntime("scenario snapshot value cannot fit usize".to_owned())
    })
}
