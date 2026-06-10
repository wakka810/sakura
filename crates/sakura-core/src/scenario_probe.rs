use crate::dsc::decompress_dsc;
use crate::error::Result;
use crate::scenario::{ScenarioEvent, ScenarioProgram, ScenarioVm};
use std::slice;

pub const SCENARIO_FIRST_EVENT_PACKET_LEN: usize = 32;
const FFI_SIZE_ERROR: usize = usize::MAX;

#[no_mangle]
pub extern "C" fn sakura_dsc_scenario_first_event_packet_len() -> usize {
    SCENARIO_FIRST_EVENT_PACKET_LEN
}

#[no_mangle]
pub unsafe extern "C" fn sakura_dsc_scenario_first_event_write(
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
    if out.len() < SCENARIO_FIRST_EVENT_PACKET_LEN {
        return FFI_SIZE_ERROR;
    }
    match write_scenario_first_event_packet(data, out) {
        Ok(()) => SCENARIO_FIRST_EVENT_PACKET_LEN,
        Err(_) => FFI_SIZE_ERROR,
    }
}

pub fn write_scenario_first_event_packet(payload: &[u8], out: &mut [u8]) -> Result<()> {
    let decompressed = decompress_dsc(payload)?;
    let mut vm = ScenarioVm::new(ScenarioProgram::parse(&decompressed)?);
    out[..SCENARIO_FIRST_EVENT_PACKET_LEN].fill(0);
    write_u32(out, 0, 1);
    match vm.next_event()? {
        ScenarioEvent::Message(message) => {
            write_u32(out, 4, 1);
            write_u32(out, 8, message.opcode);
            write_u32(out, 12, saturating_u32(message.offset));
            write_u32(
                out,
                16,
                message.name.map_or(0, |name| saturating_u32(name.len())),
            );
            write_u32(out, 20, saturating_u32(message.text.len()));
        }
        ScenarioEvent::Choice(choice) => {
            write_u32(out, 4, 2);
            write_u32(out, 8, choice.opcode);
            write_u32(out, 12, saturating_u32(choice.offset));
            write_u32(out, 24, saturating_u32(choice.options.len()));
        }
        ScenarioEvent::UserFunction(function) => {
            write_u32(out, 4, 3);
            write_u32(out, 12, saturating_u32(function.offset));
            write_u32(out, 16, saturating_u32(function.name.len()));
            write_u32(out, 28, saturating_u32(function.string_args.len()));
        }
        ScenarioEvent::Halted => write_u32(out, 4, 4),
    }
    Ok(())
}

fn write_u32(out: &mut [u8], offset: usize, value: u32) {
    out[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

fn saturating_u32(value: usize) -> u32 {
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
