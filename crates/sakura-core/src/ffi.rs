use crate::archive::ArcIndex;
use crate::audio::unwrap_bgi_audio;
use crate::dsc::decompress_dsc;
use crate::image::{cbg_to_rgba, decode_cbg, read_cbg_metadata};
use crate::install_manifest::InstallManifest;
use crate::render::RgbaSurface;
use crate::scenario::summarize_scenario_events;
use crate::script::{analyze_scenario_script, is_buriko_script_v1};
use crate::sniff::{sniff_payload, PayloadKind};
use crate::system_host::{
    run_system_vm_with_default_host, SystemHostEventKind, SystemHostRunSummary,
};
use crate::system_script::analyze_system_script;
use crate::system_trace::{
    system_trace_unknown_source_label, trace_system_script, SystemTraceSummary,
};
use crate::system_vm::{SystemValue, SystemVm, SystemVmEvent};
use crate::ENGINE_ABI_VERSION;
use std::mem;
use std::ptr;
use std::slice;

pub const FFI_ERROR: u32 = u32::MAX;
pub const FFI_SIZE_ERROR: usize = usize::MAX;
const SCRIPT_SUMMARY_DISPATCH_COUNTS_OFFSET: usize = 88;
const SCRIPT_SUMMARY_PACKET_LEN: usize = SCRIPT_SUMMARY_DISPATCH_COUNTS_OFFSET + 256 * 4;
const SYSTEM_TRACE_BUCKETS: usize = 8;
const SYSTEM_TRACE_DISPATCH_ARG_BUCKETS_OFFSET: usize = 24;
const SYSTEM_TRACE_DISPATCH_FF_KINDS_OFFSET: usize =
    SYSTEM_TRACE_DISPATCH_ARG_BUCKETS_OFFSET + SYSTEM_TRACE_BUCKETS * 4;
const SYSTEM_TRACE_DISPATCH_00_KINDS_OFFSET: usize =
    SYSTEM_TRACE_DISPATCH_FF_KINDS_OFFSET + SYSTEM_TRACE_BUCKETS * 4;
const SYSTEM_TRACE_EXT_FF_KINDS_OFFSET: usize =
    SYSTEM_TRACE_DISPATCH_00_KINDS_OFFSET + SYSTEM_TRACE_BUCKETS * 4;
const SYSTEM_TRACE_EXT_FF_ARG_BUCKETS_OFFSET: usize =
    SYSTEM_TRACE_EXT_FF_KINDS_OFFSET + SYSTEM_TRACE_BUCKETS * 4;
const SYSTEM_TRACE_SOUND_00_KINDS_OFFSET: usize =
    SYSTEM_TRACE_EXT_FF_ARG_BUCKETS_OFFSET + SYSTEM_TRACE_BUCKETS * 4;
const SYSTEM_TRACE_SOUND_00_ARG_BUCKETS_OFFSET: usize =
    SYSTEM_TRACE_SOUND_00_KINDS_OFFSET + SYSTEM_TRACE_BUCKETS * 4;
const SYSTEM_TRACE_GRAPH_68_KINDS_OFFSET: usize =
    SYSTEM_TRACE_SOUND_00_ARG_BUCKETS_OFFSET + SYSTEM_TRACE_BUCKETS * 4;
const SYSTEM_TRACE_GRAPH_68_ARG_BUCKETS_OFFSET: usize =
    SYSTEM_TRACE_GRAPH_68_KINDS_OFFSET + SYSTEM_TRACE_BUCKETS * 4;
const SYSTEM_TRACE_PACKET_LEN: usize =
    SYSTEM_TRACE_GRAPH_68_ARG_BUCKETS_OFFSET + SYSTEM_TRACE_BUCKETS * 4;
const SYSTEM_VM_EVENT_ARG_KIND_OFFSET: usize = 24;
const SYSTEM_VM_EVENT_PACKET_LEN: usize =
    SYSTEM_VM_EVENT_ARG_KIND_OFFSET + SYSTEM_TRACE_BUCKETS * 4;
const SYSTEM_VM_DEFAULT_HOST_PACKET_LEN: usize = 44;
const SYSTEM_VM_DEFAULT_HOST_MAX_EVENTS: usize = 256;
const SYSTEM_VM_DEFAULT_HOST_MAX_INSTRUCTIONS_PER_EVENT: usize = 100_000;

#[no_mangle]
pub extern "C" fn sakura_engine_abi_version() -> u32 {
    ENGINE_ABI_VERSION
}

#[no_mangle]
pub extern "C" fn sakura_alloc(len: usize) -> *mut u8 {
    if len == 0 {
        return ptr::null_mut();
    }
    let mut buffer = Vec::<u8>::with_capacity(len);
    let ptr = buffer.as_mut_ptr();
    mem::forget(buffer);
    ptr
}

#[no_mangle]
pub unsafe extern "C" fn sakura_dealloc(ptr: *mut u8, len: usize) {
    if ptr.is_null() || len == 0 {
        return;
    }
    unsafe {
        drop(Vec::from_raw_parts(ptr, 0, len));
    }
}

#[no_mangle]
pub unsafe extern "C" fn sakura_arc20_index_entry_count(
    ptr: *const u8,
    len: usize,
    archive_len: usize,
) -> u32 {
    let Some(data) = (unsafe { slice_from_abi(ptr, len) }) else {
        return FFI_ERROR;
    };
    match ArcIndex::parse_prefix(data, archive_len) {
        Ok(index) => index.entries().len().try_into().unwrap_or(FFI_ERROR),
        Err(_) => FFI_ERROR,
    }
}

#[no_mangle]
pub unsafe extern "C" fn sakura_arc20_index_manifest_len(
    ptr: *const u8,
    len: usize,
    archive_len: usize,
) -> usize {
    let Some(data) = (unsafe { slice_from_abi(ptr, len) }) else {
        return FFI_SIZE_ERROR;
    };
    let Ok(index) = ArcIndex::parse_prefix(data, archive_len) else {
        return FFI_SIZE_ERROR;
    };
    manifest_len(&index).unwrap_or(FFI_SIZE_ERROR)
}

#[no_mangle]
pub unsafe extern "C" fn sakura_arc20_index_manifest_write(
    ptr: *const u8,
    len: usize,
    archive_len: usize,
    out_ptr: *mut u8,
    out_len: usize,
) -> usize {
    let Some(data) = (unsafe { slice_from_abi(ptr, len) }) else {
        return FFI_SIZE_ERROR;
    };
    let Some(out) = (unsafe { mutable_slice_from_abi(out_ptr, out_len) }) else {
        return FFI_SIZE_ERROR;
    };
    let Ok(index) = ArcIndex::parse_prefix(data, archive_len) else {
        return FFI_SIZE_ERROR;
    };
    let Some(required) = manifest_len(&index) else {
        return FFI_SIZE_ERROR;
    };
    if out.len() < required {
        return FFI_SIZE_ERROR;
    }

    write_u32(out, 0, index.entries().len() as u32);
    write_u64(out, 4, index.data_start() as u64);
    let mut cursor = 12usize;
    for entry in index.entries() {
        let name = entry.name.as_bytes();
        write_u16(out, cursor, name.len() as u16);
        write_u32(out, cursor + 2, entry.offset);
        write_u32(out, cursor + 6, entry.size);
        cursor += 10;
        out[cursor..cursor + name.len()].copy_from_slice(name);
        cursor += name.len();
    }
    required
}

#[no_mangle]
pub unsafe extern "C" fn sakura_hvl_manifest_len(ptr: *const u8, len: usize) -> usize {
    let Some(data) = (unsafe { slice_from_abi(ptr, len) }) else {
        return FFI_SIZE_ERROR;
    };
    let Ok(manifest) = InstallManifest::parse(data) else {
        return FFI_SIZE_ERROR;
    };
    manifest.manifest_len().unwrap_or(FFI_SIZE_ERROR)
}

#[no_mangle]
pub unsafe extern "C" fn sakura_hvl_manifest_write(
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
    let Ok(manifest) = InstallManifest::parse(data) else {
        return FFI_SIZE_ERROR;
    };
    manifest.write_manifest(out).unwrap_or(FFI_SIZE_ERROR)
}

#[no_mangle]
pub unsafe extern "C" fn sakura_cbg_rgba_len(ptr: *const u8, len: usize) -> usize {
    let Some(data) = (unsafe { slice_from_abi(ptr, len) }) else {
        return FFI_SIZE_ERROR;
    };
    let Ok(meta) = read_cbg_metadata(data) else {
        return FFI_SIZE_ERROR;
    };
    cbg_rgba_len(meta.width as usize, meta.height as usize).unwrap_or(FFI_SIZE_ERROR)
}

#[no_mangle]
pub unsafe extern "C" fn sakura_cbg_rgba_write(
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
    let Ok(image) = decode_cbg(data) else {
        return FFI_SIZE_ERROR;
    };
    let Ok(rgba) = cbg_to_rgba(&image) else {
        return FFI_SIZE_ERROR;
    };
    let Some(required) = 16usize.checked_add(rgba.len()) else {
        return FFI_SIZE_ERROR;
    };
    if out.len() < required {
        return FFI_SIZE_ERROR;
    }
    let Some(stride) = u32::from(image.width).checked_mul(4) else {
        return FFI_SIZE_ERROR;
    };
    let Ok(rgba_len) = u32::try_from(rgba.len()) else {
        return FFI_SIZE_ERROR;
    };

    write_u32(out, 0, image.width as u32);
    write_u32(out, 4, image.height as u32);
    write_u32(out, 8, stride);
    write_u32(out, 12, rgba_len);
    out[16..required].copy_from_slice(&rgba);
    required
}

#[no_mangle]
pub unsafe extern "C" fn sakura_image_rgba_len(ptr: *const u8, len: usize) -> usize {
    let Some(data) = (unsafe { slice_from_abi(ptr, len) }) else {
        return FFI_SIZE_ERROR;
    };
    let Ok((width, height)) = image_rgba_dimensions(data) else {
        return FFI_SIZE_ERROR;
    };
    cbg_rgba_len(width, height).unwrap_or(FFI_SIZE_ERROR)
}

#[no_mangle]
pub unsafe extern "C" fn sakura_image_rgba_write(
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
    let Ok(rgba) = decode_image_rgba(data) else {
        return FFI_SIZE_ERROR;
    };
    let Some(required) = 16usize.checked_add(rgba.pixels().len()) else {
        return FFI_SIZE_ERROR;
    };
    if out.len() < required {
        return FFI_SIZE_ERROR;
    }
    let Some(stride) = u32::try_from(rgba.stride()).ok() else {
        return FFI_SIZE_ERROR;
    };
    let Ok(rgba_len) = u32::try_from(rgba.pixels().len()) else {
        return FFI_SIZE_ERROR;
    };

    write_u32(out, 0, rgba.width());
    write_u32(out, 4, rgba.height());
    write_u32(out, 8, stride);
    write_u32(out, 12, rgba_len);
    out[16..required].copy_from_slice(rgba.pixels());
    required
}

#[no_mangle]
pub unsafe extern "C" fn sakura_bgi_audio_ogg_len(ptr: *const u8, len: usize) -> usize {
    let Some(data) = (unsafe { slice_from_abi(ptr, len) }) else {
        return FFI_SIZE_ERROR;
    };
    let Ok(ogg) = unwrap_bgi_audio(data) else {
        return FFI_SIZE_ERROR;
    };
    ogg.len()
}

#[no_mangle]
pub unsafe extern "C" fn sakura_bgi_audio_ogg_write(
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
    let Ok(ogg) = unwrap_bgi_audio(data) else {
        return FFI_SIZE_ERROR;
    };
    if out.len() < ogg.len() {
        return FFI_SIZE_ERROR;
    }
    out[..ogg.len()].copy_from_slice(ogg);
    ogg.len()
}

#[no_mangle]
pub extern "C" fn sakura_dsc_script_summary_packet_len() -> usize {
    SCRIPT_SUMMARY_PACKET_LEN
}

#[no_mangle]
pub unsafe extern "C" fn sakura_dsc_script_summary_write(
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
    if out.len() < SCRIPT_SUMMARY_PACKET_LEN {
        return FFI_SIZE_ERROR;
    }
    let Ok(decompressed) = decompress_dsc(data) else {
        return FFI_SIZE_ERROR;
    };
    out[..SCRIPT_SUMMARY_PACKET_LEN].fill(0);
    write_u32(out, 0, 1);
    write_u32(out, 8, saturating_u32(decompressed.len()));

    if is_buriko_script_v1(&decompressed) {
        let Ok(summary) = analyze_scenario_script(&decompressed) else {
            return FFI_SIZE_ERROR;
        };
        let Ok(events) = summarize_scenario_events(&decompressed) else {
            return FFI_SIZE_ERROR;
        };
        write_u32(out, 4, 1);
        write_u32(out, 12, saturating_u32(summary.instruction_count));
        write_u32(out, 16, saturating_u32(summary.message_string_operands));
        write_u32(
            out,
            20,
            saturating_u32(summary.character_name_string_operands),
        );
        write_u32(out, 24, saturating_u32(summary.choice_string_operands));
        write_u32(out, 28, saturating_u32(summary.user_function_call_count));
        write_u32(out, 32, saturating_u32(events.message_count));
        write_u32(out, 36, saturating_u32(events.choice_count));
    } else {
        let Ok(summary) = analyze_system_script(&decompressed) else {
            return FFI_SIZE_ERROR;
        };
        let invalid_blocks = summary
            .truncated_tail_blocks
            .saturating_add(summary.invalid_opcode_blocks)
            .saturating_add(summary.invalid_target_blocks)
            .saturating_add(summary.invalid_jump_blocks)
            .saturating_add(summary.invalid_string_target_blocks);
        write_u32(out, 4, 2);
        write_u32(out, 12, saturating_u32(summary.instruction_count));
        write_u32(out, 40, saturating_u32(summary.syscall_count));
        write_u32(out, 44, saturating_u32(summary.graphcall_count));
        write_u32(out, 48, saturating_u32(summary.soundcall_count));
        write_u32(out, 52, saturating_u32(summary.extcall_count));
        write_u32(out, 56, saturating_u32(summary.user_script_call_count));
        write_u32(out, 60, saturating_u32(summary.conditional_jump_count));
        write_u32(out, 64, saturating_u32(invalid_blocks));
        write_u32(out, 68, saturating_u32(summary.string_operands));
        write_u32(out, 72, saturating_u32(summary.user_script_load_count));
        write_u32(out, 76, saturating_u32(summary.user_script_free_count));
        write_u32(out, 80, saturating_u32(summary.user_script_return_count));
        write_u32(out, 84, saturating_u32(summary.user_script_dispatch_count));
        for (id, count) in summary.user_script_dispatch_counts.iter().enumerate() {
            write_u32(
                out,
                SCRIPT_SUMMARY_DISPATCH_COUNTS_OFFSET + id * 4,
                saturating_u32(*count),
            );
        }
    }
    SCRIPT_SUMMARY_PACKET_LEN
}

#[no_mangle]
pub extern "C" fn sakura_dsc_system_trace_packet_len() -> usize {
    SYSTEM_TRACE_PACKET_LEN
}

#[no_mangle]
pub unsafe extern "C" fn sakura_dsc_system_trace_write(
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
    if out.len() < SYSTEM_TRACE_PACKET_LEN {
        return FFI_SIZE_ERROR;
    }
    let Ok(decompressed) = decompress_dsc(data) else {
        return FFI_SIZE_ERROR;
    };
    if is_buriko_script_v1(&decompressed) {
        return FFI_SIZE_ERROR;
    }
    let Ok(trace) = trace_system_script(&decompressed) else {
        return FFI_SIZE_ERROR;
    };

    out[..SYSTEM_TRACE_PACKET_LEN].fill(0);
    write_u32(out, 0, 1);
    write_u32(out, 4, 2);
    write_u32(out, 8, saturating_u32(trace.instruction_count));
    write_u32(out, 12, saturating_u32(trace.service_call_count));
    write_u32(out, 16, saturating_u32(trace.user_script_dispatch_count));
    write_u32(out, 20, saturating_u32(trace.max_stack_depth));
    write_counts(
        out,
        SYSTEM_TRACE_DISPATCH_ARG_BUCKETS_OFFSET,
        &trace.dispatch_arg_count_buckets,
    );
    write_dispatch_kind_counts(out, SYSTEM_TRACE_DISPATCH_FF_KINDS_OFFSET, 0xff, &trace);
    write_dispatch_kind_counts(out, SYSTEM_TRACE_DISPATCH_00_KINDS_OFFSET, 0x00, &trace);
    write_service_value_counts(
        out,
        SYSTEM_TRACE_EXT_FF_KINDS_OFFSET,
        &trace.service_input_top_kinds,
        "ext:ff",
    );
    write_service_value_counts(
        out,
        SYSTEM_TRACE_EXT_FF_ARG_BUCKETS_OFFSET,
        &trace.service_input_arg_buckets,
        "ext:ff",
    );
    write_service_value_counts(
        out,
        SYSTEM_TRACE_SOUND_00_KINDS_OFFSET,
        &trace.service_input_top_kinds,
        "sound:00",
    );
    write_service_value_counts(
        out,
        SYSTEM_TRACE_SOUND_00_ARG_BUCKETS_OFFSET,
        &trace.service_input_arg_buckets,
        "sound:00",
    );
    write_service_value_counts(
        out,
        SYSTEM_TRACE_GRAPH_68_KINDS_OFFSET,
        &trace.service_input_top_kinds,
        "graph:68",
    );
    write_service_value_counts(
        out,
        SYSTEM_TRACE_GRAPH_68_ARG_BUCKETS_OFFSET,
        &trace.service_input_arg_buckets,
        "graph:68",
    );
    SYSTEM_TRACE_PACKET_LEN
}

#[no_mangle]
pub extern "C" fn sakura_dsc_system_vm_first_event_packet_len() -> usize {
    SYSTEM_VM_EVENT_PACKET_LEN
}

#[no_mangle]
pub unsafe extern "C" fn sakura_dsc_system_vm_first_event_write(
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
    if out.len() < SYSTEM_VM_EVENT_PACKET_LEN {
        return FFI_SIZE_ERROR;
    }
    let Ok(decompressed) = decompress_dsc(data) else {
        return FFI_SIZE_ERROR;
    };
    if is_buriko_script_v1(&decompressed) {
        return FFI_SIZE_ERROR;
    }
    let Ok(mut vm) = SystemVm::parse(&decompressed) else {
        return FFI_SIZE_ERROR;
    };
    let Ok(event) = vm.next_event() else {
        return FFI_SIZE_ERROR;
    };
    out[..SYSTEM_VM_EVENT_PACKET_LEN].fill(0);
    write_u32(out, 0, 1);
    write_vm_event(out, event);
    SYSTEM_VM_EVENT_PACKET_LEN
}

#[no_mangle]
pub extern "C" fn sakura_dsc_system_vm_default_host_packet_len() -> usize {
    SYSTEM_VM_DEFAULT_HOST_PACKET_LEN
}

#[no_mangle]
pub unsafe extern "C" fn sakura_dsc_system_vm_default_host_write(
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
    if out.len() < SYSTEM_VM_DEFAULT_HOST_PACKET_LEN {
        return FFI_SIZE_ERROR;
    }
    let Ok(decompressed) = decompress_dsc(data) else {
        return FFI_SIZE_ERROR;
    };
    if is_buriko_script_v1(&decompressed) {
        return FFI_SIZE_ERROR;
    }
    let Ok(mut vm) = SystemVm::parse(&decompressed) else {
        return FFI_SIZE_ERROR;
    };
    let Ok(summary) = run_system_vm_with_default_host(
        &mut vm,
        SYSTEM_VM_DEFAULT_HOST_MAX_EVENTS,
        SYSTEM_VM_DEFAULT_HOST_MAX_INSTRUCTIONS_PER_EVENT,
    ) else {
        return FFI_SIZE_ERROR;
    };
    out[..SYSTEM_VM_DEFAULT_HOST_PACKET_LEN].fill(0);
    write_u32(out, 0, 1);
    write_default_host_summary(out, &summary);
    SYSTEM_VM_DEFAULT_HOST_PACKET_LEN
}

#[no_mangle]
pub unsafe extern "C" fn sakura_rgba_blit_over(
    dst_ptr: *mut u8,
    dst_len: usize,
    dst_width: u32,
    dst_height: u32,
    src_ptr: *const u8,
    src_len: usize,
    src_width: u32,
    src_height: u32,
    x: i32,
    y: i32,
    opacity: u32,
) -> u32 {
    let Some(dst) = (unsafe { mutable_slice_from_abi(dst_ptr, dst_len) }) else {
        return FFI_ERROR;
    };
    let Some(src) = (unsafe { slice_from_abi(src_ptr, src_len) }) else {
        return FFI_ERROR;
    };
    let Ok(mut surface) = RgbaSurface::from_rgba(dst_width, dst_height, dst.to_vec()) else {
        return FFI_ERROR;
    };
    let Ok(layer) = RgbaSurface::from_rgba(src_width, src_height, src.to_vec()) else {
        return FFI_ERROR;
    };
    let Ok(opacity) = u8::try_from(opacity) else {
        return FFI_ERROR;
    };
    surface.blit_over(&layer, x, y, opacity);
    dst.copy_from_slice(surface.pixels());
    0
}

#[no_mangle]
pub unsafe extern "C" fn sakura_payload_kind(ptr: *const u8, len: usize) -> u32 {
    let Some(data) = (unsafe { slice_from_abi(ptr, len) }) else {
        return payload_kind_code(PayloadKind::Unknown);
    };
    payload_kind_code(sniff_payload(data))
}

unsafe fn slice_from_abi<'a>(ptr: *const u8, len: usize) -> Option<&'a [u8]> {
    if ptr.is_null() {
        return (len == 0).then_some(&[]);
    }
    Some(unsafe { slice::from_raw_parts(ptr, len) })
}

unsafe fn mutable_slice_from_abi<'a>(ptr: *mut u8, len: usize) -> Option<&'a mut [u8]> {
    if ptr.is_null() {
        return (len == 0).then_some(&mut []);
    }
    Some(unsafe { slice::from_raw_parts_mut(ptr, len) })
}

fn manifest_len(index: &ArcIndex) -> Option<usize> {
    index.entries().iter().try_fold(12usize, |sum, entry| {
        sum.checked_add(10 + entry.name.as_bytes().len())
    })
}

fn cbg_rgba_len(width: usize, height: usize) -> Option<usize> {
    width.checked_mul(height)?.checked_mul(4)?.checked_add(16)
}

fn image_rgba_dimensions(data: &[u8]) -> crate::Result<(usize, usize)> {
    if let Ok(meta) = read_cbg_metadata(data) {
        return Ok((meta.width as usize, meta.height as usize));
    }
    if let Ok(image) = crate::image::decode_raw_bitmap(data) {
        return Ok((image.width as usize, image.height as usize));
    }
    let decompressed = decompress_dsc(data)?;
    if let Ok(meta) = read_cbg_metadata(&decompressed) {
        return Ok((meta.width as usize, meta.height as usize));
    }
    let image = crate::image::decode_raw_bitmap(&decompressed)?;
    Ok((image.width as usize, image.height as usize))
}

fn decode_image_rgba(data: &[u8]) -> crate::Result<RgbaSurface> {
    if let Ok(image) = decode_cbg(data) {
        let rgba = cbg_to_rgba(&image)?;
        return RgbaSurface::from_rgba(u32::from(image.width), u32::from(image.height), rgba);
    }
    if let Ok(image) = crate::image::decode_raw_bitmap(data) {
        let rgba = cbg_to_rgba(&image)?;
        return RgbaSurface::from_rgba(u32::from(image.width), u32::from(image.height), rgba);
    }
    let decompressed = decompress_dsc(data)?;
    if let Ok(image) = decode_cbg(&decompressed) {
        let rgba = cbg_to_rgba(&image)?;
        return RgbaSurface::from_rgba(u32::from(image.width), u32::from(image.height), rgba);
    }
    let image = crate::image::decode_raw_bitmap(&decompressed)?;
    let rgba = cbg_to_rgba(&image)?;
    RgbaSurface::from_rgba(u32::from(image.width), u32::from(image.height), rgba)
}

fn write_u16(out: &mut [u8], offset: usize, value: u16) {
    out[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
}

fn write_u32(out: &mut [u8], offset: usize, value: u32) {
    out[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

fn write_u64(out: &mut [u8], offset: usize, value: u64) {
    out[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
}

fn write_counts(out: &mut [u8], offset: usize, counts: &[usize; SYSTEM_TRACE_BUCKETS]) {
    for (index, count) in counts.iter().enumerate() {
        write_u32(out, offset + index * 4, saturating_u32(*count));
    }
}

fn write_dispatch_kind_counts(
    out: &mut [u8],
    offset: usize,
    dispatch_id: usize,
    trace: &SystemTraceSummary,
) {
    let counts = [
        trace.dispatch_empty_stack_counts[dispatch_id],
        trace.dispatch_top_integer_counts[dispatch_id],
        trace.dispatch_top_string_counts[dispatch_id],
        trace.dispatch_top_code_counts[dispatch_id],
        trace.dispatch_top_handle_counts[dispatch_id],
        trace.dispatch_top_user_result_counts[dispatch_id],
        trace.dispatch_top_pointer_counts[dispatch_id],
        trace.dispatch_top_unknown_counts[dispatch_id],
    ];
    write_counts(out, offset, &counts);
}

fn write_service_value_counts(
    out: &mut [u8],
    offset: usize,
    counts: &[crate::system_trace::SystemTraceSourceValueCount],
    source_label: &str,
) {
    for count in counts {
        if count.value_code as usize >= SYSTEM_TRACE_BUCKETS {
            continue;
        }
        if system_trace_unknown_source_label(count.source_code) == source_label {
            write_u32(
                out,
                offset + usize::from(count.value_code) * 4,
                saturating_u32(count.count),
            );
        }
    }
}

fn write_vm_event(out: &mut [u8], event: SystemVmEvent<'_>) {
    match event {
        SystemVmEvent::ServiceCall {
            family,
            service_id,
            args,
        } => {
            write_u32(out, 4, 1);
            write_u32(out, 8, call_family_code(family));
            write_u32(out, 12, u32::from(service_id));
            write_vm_args(out, &args);
        }
        SystemVmEvent::UserScriptCall { service_id, args } => {
            write_u32(out, 4, 2);
            write_u32(out, 12, u32::from(service_id));
            write_vm_args(out, &args);
        }
        SystemVmEvent::LoadedProgramCall {
            handle,
            offset: _,
            args,
        } => {
            write_u32(out, 4, 2);
            write_u32(out, 12, handle);
            write_vm_args(out, &args);
        }
        SystemVmEvent::UserScriptLoad => write_u32(out, 4, 3),
        SystemVmEvent::UserScriptFree { args } => {
            write_u32(out, 4, 4);
            write_vm_args(out, &args);
        }
        SystemVmEvent::UserScriptReturn => write_u32(out, 4, 5),
        SystemVmEvent::Halted => write_u32(out, 4, 6),
    }
}

fn write_vm_args(out: &mut [u8], args: &[SystemValue<'_>]) {
    write_u32(out, 16, saturating_u32(args.len()));
    let top_kind = args
        .last()
        .map(system_vm_value_kind_code)
        .unwrap_or(VALUE_KIND_EMPTY);
    write_u32(out, 20, u32::from(top_kind));
    for value in args {
        let kind = system_vm_value_kind_code(value);
        if usize::from(kind) < SYSTEM_TRACE_BUCKETS {
            let offset = SYSTEM_VM_EVENT_ARG_KIND_OFFSET + usize::from(kind) * 4;
            let count = read_u32(out, offset).saturating_add(1);
            write_u32(out, offset, count);
        }
    }
}

fn write_default_host_summary(out: &mut [u8], summary: &SystemHostRunSummary) {
    write_u32(out, 4, saturating_u32(summary.event_count));
    write_u32(out, 8, saturating_u32(summary.service_event_count));
    write_u32(out, 12, saturating_u32(summary.user_call_event_count));
    write_u32(out, 16, saturating_u32(summary.user_load_event_count));
    write_u32(out, 20, saturating_u32(summary.user_free_event_count));
    write_u32(out, 24, saturating_u32(summary.user_return_event_count));
    write_u32(out, 28, saturating_u32(summary.halted_event_count));
    write_u32(out, 32, u32::from(summary.completed));
    write_u32(out, 36, u32::from(summary.event_limited));
    write_u32(
        out,
        40,
        system_host_event_kind_code(summary.last_event_kind),
    );
}

fn system_host_event_kind_code(kind: SystemHostEventKind) -> u32 {
    match kind {
        SystemHostEventKind::None => 0,
        SystemHostEventKind::Service => 1,
        SystemHostEventKind::UserCall => 2,
        SystemHostEventKind::UserLoad => 3,
        SystemHostEventKind::UserFree => 4,
        SystemHostEventKind::UserReturn => 5,
        SystemHostEventKind::Halted => 6,
    }
}

fn system_vm_value_kind_code(value: &SystemValue<'_>) -> u8 {
    match value {
        SystemValue::Integer(_) => VALUE_KIND_INTEGER,
        SystemValue::String(_)
        | SystemValue::OwnedString(_)
        | SystemValue::LocalStringPointer { .. } => VALUE_KIND_STRING,
        SystemValue::Code(_) | SystemValue::CodeInScript { .. } => VALUE_KIND_CODE,
        SystemValue::VariablePointer(_) => VALUE_KIND_POINTER,
        SystemValue::UserScriptHandle(_) => VALUE_KIND_HANDLE,
        SystemValue::UserScriptResult(_) => VALUE_KIND_USER_RESULT,
        SystemValue::Unknown => VALUE_KIND_UNKNOWN,
    }
}

fn call_family_code(family: crate::system_bytecode::SystemCallFamily) -> u32 {
    match family {
        crate::system_bytecode::SystemCallFamily::System => 0,
        crate::system_bytecode::SystemCallFamily::Graph => 1,
        crate::system_bytecode::SystemCallFamily::Sound => 2,
        crate::system_bytecode::SystemCallFamily::External => 3,
    }
}

fn read_u32(data: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes([
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3],
    ])
}

fn saturating_u32(value: usize) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

const VALUE_KIND_EMPTY: u8 = 0;
const VALUE_KIND_INTEGER: u8 = 1;
const VALUE_KIND_STRING: u8 = 2;
const VALUE_KIND_CODE: u8 = 3;
const VALUE_KIND_HANDLE: u8 = 4;
const VALUE_KIND_USER_RESULT: u8 = 5;
const VALUE_KIND_POINTER: u8 = 6;
const VALUE_KIND_UNKNOWN: u8 = 7;

fn payload_kind_code(kind: PayloadKind) -> u32 {
    match kind {
        PayloadKind::Unknown => 0,
        PayloadKind::Dsc => 1,
        PayloadKind::CompressedBg => 2,
        PayloadKind::BgiAudio => 3,
        PayloadKind::MpegProgramStream => 4,
        PayloadKind::MpegVideo => 5,
        PayloadKind::OggVorbis => 6,
        PayloadKind::Png => 7,
        PayloadKind::Jpeg => 8,
        PayloadKind::Wav => 9,
    }
}
