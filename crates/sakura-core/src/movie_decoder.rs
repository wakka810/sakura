use std::alloc::{alloc, dealloc, realloc, Layout};
use std::collections::BTreeMap;
use std::ffi::c_void;
use std::ptr;
use std::slice;
use std::sync::{Mutex, OnceLock};

// The retail opening movie `op.mpg` is 166,502,404 bytes. Keep a bounded cap
// above that asset while rejecting accidental archive-sized inputs.
const MAX_MOVIE_BYTES: usize = 192 * 1024 * 1024;
const MAX_MOVIE_DIMENSION: usize = 4096;
const ALLOCATION_HEADER_LEN: usize = 16;
const ALLOCATION_ALIGN: usize = 16;
const FFI_SIZE_ERROR: usize = usize::MAX;

static MOVIE_STORE: OnceLock<Mutex<MovieStore>> = OnceLock::new();

#[repr(C)]
struct PlmDecoder {
    _private: [u8; 0],
}

#[repr(C)]
struct PlmFrame {
    _private: [u8; 0],
}

unsafe extern "C" {
    fn sakura_plm_create(bytes: *const u8, len: usize) -> *mut PlmDecoder;
    fn sakura_plm_destroy(decoder: *mut PlmDecoder);
    fn sakura_plm_width(decoder: *const PlmDecoder) -> u32;
    fn sakura_plm_height(decoder: *const PlmDecoder) -> u32;
    fn sakura_plm_framerate(decoder: *const PlmDecoder) -> f64;
    fn sakura_plm_decode(decoder: *mut PlmDecoder) -> *const PlmFrame;
    fn sakura_plm_frame_y(frame: *const PlmFrame) -> *const u8;
    fn sakura_plm_frame_cb(frame: *const PlmFrame) -> *const u8;
    fn sakura_plm_frame_cr(frame: *const PlmFrame) -> *const u8;
    fn sakura_plm_frame_y_stride(frame: *const PlmFrame) -> u32;
    fn sakura_plm_frame_chroma_stride(frame: *const PlmFrame) -> u32;
}

struct MovieDecoder {
    payload: Vec<u8>,
    decoder: *mut PlmDecoder,
    current_frame: *const PlmFrame,
    width: usize,
    height: usize,
    frame_rate: f64,
    decoded_frames: u32,
}

// All decoder access is serialized through MOVIE_STORE.
unsafe impl Send for MovieDecoder {}

impl MovieDecoder {
    fn create(payload: &[u8]) -> Option<Self> {
        if payload.is_empty() || payload.len() > MAX_MOVIE_BYTES {
            return None;
        }
        let payload = payload.to_vec();
        let decoder = unsafe { sakura_plm_create(payload.as_ptr(), payload.len()) };
        if decoder.is_null() {
            return None;
        }
        let width = unsafe { sakura_plm_width(decoder) } as usize;
        let height = unsafe { sakura_plm_height(decoder) } as usize;
        let frame_rate = unsafe { sakura_plm_framerate(decoder) };
        if !valid_dimensions(width, height) || !frame_rate.is_finite() || frame_rate <= 0.0 {
            unsafe { sakura_plm_destroy(decoder) };
            return None;
        }
        Some(Self {
            payload,
            decoder,
            current_frame: ptr::null(),
            width,
            height,
            frame_rate,
            decoded_frames: 0,
        })
    }

    fn reset(&mut self) -> bool {
        unsafe { sakura_plm_destroy(self.decoder) };
        self.decoder = unsafe { sakura_plm_create(self.payload.as_ptr(), self.payload.len()) };
        self.current_frame = ptr::null();
        self.decoded_frames = 0;
        !self.decoder.is_null()
    }

    fn decode_next(&mut self) -> bool {
        if self.decoder.is_null() {
            return false;
        }
        let frame = unsafe { sakura_plm_decode(self.decoder) };
        if frame.is_null() {
            return false;
        }
        self.current_frame = frame;
        self.decoded_frames = self.decoded_frames.saturating_add(1);
        true
    }

    fn rgba_len(&self) -> Option<usize> {
        self.width.checked_mul(self.height)?.checked_mul(4)
    }

    fn write_rgba(&self, out: &mut [u8]) -> Option<usize> {
        if self.current_frame.is_null() {
            return None;
        }
        let required = self.rgba_len()?;
        if out.len() < required {
            return None;
        }
        let y_stride = unsafe { sakura_plm_frame_y_stride(self.current_frame) } as usize;
        let chroma_stride = unsafe { sakura_plm_frame_chroma_stride(self.current_frame) } as usize;
        if y_stride < self.width || chroma_stride < self.width.div_ceil(2) {
            return None;
        }
        let y_len = y_stride.checked_mul(self.height)?;
        let chroma_height = self.height.div_ceil(2);
        let chroma_len = chroma_stride.checked_mul(chroma_height)?;
        let y_ptr = unsafe { sakura_plm_frame_y(self.current_frame) };
        let cb_ptr = unsafe { sakura_plm_frame_cb(self.current_frame) };
        let cr_ptr = unsafe { sakura_plm_frame_cr(self.current_frame) };
        if y_ptr.is_null() || cb_ptr.is_null() || cr_ptr.is_null() {
            return None;
        }
        let y_plane = unsafe { slice::from_raw_parts(y_ptr, y_len) };
        let cb_plane = unsafe { slice::from_raw_parts(cb_ptr, chroma_len) };
        let cr_plane = unsafe { slice::from_raw_parts(cr_ptr, chroma_len) };
        yuv420_to_rgba(
            y_plane,
            cb_plane,
            cr_plane,
            y_stride,
            chroma_stride,
            self.width,
            self.height,
            &mut out[..required],
        );
        Some(required)
    }
}

impl Drop for MovieDecoder {
    fn drop(&mut self) {
        if !self.decoder.is_null() {
            unsafe { sakura_plm_destroy(self.decoder) };
        }
    }
}

#[derive(Default)]
struct MovieStore {
    next_handle: u32,
    decoders: BTreeMap<u32, MovieDecoder>,
}

impl MovieStore {
    fn insert(&mut self, decoder: MovieDecoder) -> Option<u32> {
        let start = self.next_handle.max(1);
        let mut handle = start;
        loop {
            if !self.decoders.contains_key(&handle) {
                self.decoders.insert(handle, decoder);
                self.next_handle = handle.wrapping_add(1).max(1);
                return Some(handle);
            }
            handle = handle.wrapping_add(1).max(1);
            if handle == start {
                return None;
            }
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn sakura_movie_decoder_create(ptr: *const u8, len: usize) -> u32 {
    if ptr.is_null() || len == 0 || len > MAX_MOVIE_BYTES {
        return 0;
    }
    let payload = unsafe { slice::from_raw_parts(ptr, len) };
    let Some(decoder) = MovieDecoder::create(payload) else {
        return 0;
    };
    let Ok(mut store) = movie_store().lock() else {
        return 0;
    };
    store.insert(decoder).unwrap_or(0)
}

#[no_mangle]
pub extern "C" fn sakura_movie_decoder_destroy(handle: u32) -> u32 {
    let Ok(mut store) = movie_store().lock() else {
        return 0;
    };
    store.decoders.remove(&handle).map_or(0, |_| 1)
}

#[no_mangle]
pub extern "C" fn sakura_movie_decoder_reset(handle: u32) -> u32 {
    let Ok(mut store) = movie_store().lock() else {
        return 0;
    };
    store
        .decoders
        .get_mut(&handle)
        .map_or(0, |decoder| if decoder.reset() { 1 } else { 0 })
}

#[no_mangle]
pub extern "C" fn sakura_movie_decoder_width(handle: u32) -> u32 {
    movie_store()
        .lock()
        .ok()
        .and_then(|store| {
            store
                .decoders
                .get(&handle)
                .map(|decoder| decoder.width as u32)
        })
        .unwrap_or(0)
}

#[no_mangle]
pub extern "C" fn sakura_movie_decoder_height(handle: u32) -> u32 {
    movie_store()
        .lock()
        .ok()
        .and_then(|store| {
            store
                .decoders
                .get(&handle)
                .map(|decoder| decoder.height as u32)
        })
        .unwrap_or(0)
}

#[no_mangle]
pub extern "C" fn sakura_movie_decoder_frame_rate_milli(handle: u32) -> u32 {
    movie_store()
        .lock()
        .ok()
        .and_then(|store| {
            store.decoders.get(&handle).map(|decoder| {
                (decoder.frame_rate * 1000.0)
                    .round()
                    .clamp(0.0, u32::MAX as f64) as u32
            })
        })
        .unwrap_or(0)
}

#[no_mangle]
pub extern "C" fn sakura_movie_decoder_decode_next(handle: u32) -> u32 {
    let Ok(mut store) = movie_store().lock() else {
        return 0;
    };
    store
        .decoders
        .get_mut(&handle)
        .map_or(0, |decoder| if decoder.decode_next() { 1 } else { 0 })
}

#[no_mangle]
pub extern "C" fn sakura_movie_decoder_decoded_frames(handle: u32) -> u32 {
    movie_store()
        .lock()
        .ok()
        .and_then(|store| {
            store
                .decoders
                .get(&handle)
                .map(|decoder| decoder.decoded_frames)
        })
        .unwrap_or(0)
}

#[no_mangle]
pub extern "C" fn sakura_movie_decoder_rgba_len(handle: u32) -> usize {
    movie_store()
        .lock()
        .ok()
        .and_then(|store| store.decoders.get(&handle).and_then(MovieDecoder::rgba_len))
        .unwrap_or(FFI_SIZE_ERROR)
}

#[no_mangle]
pub unsafe extern "C" fn sakura_movie_decoder_rgba_write(
    handle: u32,
    out_ptr: *mut u8,
    out_len: usize,
) -> usize {
    if out_ptr.is_null() || out_len == 0 {
        return FFI_SIZE_ERROR;
    }
    let out = unsafe { slice::from_raw_parts_mut(out_ptr, out_len) };
    let Ok(store) = movie_store().lock() else {
        return FFI_SIZE_ERROR;
    };
    store
        .decoders
        .get(&handle)
        .and_then(|decoder| decoder.write_rgba(out))
        .unwrap_or(FFI_SIZE_ERROR)
}

fn movie_store() -> &'static Mutex<MovieStore> {
    MOVIE_STORE.get_or_init(|| Mutex::new(MovieStore::default()))
}

fn valid_dimensions(width: usize, height: usize) -> bool {
    width > 0
        && height > 0
        && width <= MAX_MOVIE_DIMENSION
        && height <= MAX_MOVIE_DIMENSION
        && width
            .checked_mul(height)
            .and_then(|pixels| pixels.checked_mul(4))
            .is_some()
}

fn yuv420_to_rgba(
    y_plane: &[u8],
    cb_plane: &[u8],
    cr_plane: &[u8],
    y_stride: usize,
    chroma_stride: usize,
    width: usize,
    height: usize,
    rgba: &mut [u8],
) {
    for row in 0..height {
        for column in 0..width {
            let y = i32::from(y_plane[row * y_stride + column]) - 16;
            let cb = i32::from(cb_plane[(row / 2) * chroma_stride + column / 2]) - 128;
            let cr = i32::from(cr_plane[(row / 2) * chroma_stride + column / 2]) - 128;
            let offset = (row * width + column) * 4;
            rgba[offset] = clamp_u8((298 * y + 409 * cr + 128) >> 8);
            rgba[offset + 1] = clamp_u8((298 * y - 100 * cb - 208 * cr + 128) >> 8);
            rgba[offset + 2] = clamp_u8((298 * y + 516 * cb + 128) >> 8);
            rgba[offset + 3] = 255;
        }
    }
}

fn clamp_u8(value: i32) -> u8 {
    value.clamp(0, 255) as u8
}

#[no_mangle]
pub extern "C" fn sakura_movie_malloc(len: usize) -> *mut c_void {
    let Some(total) = len.checked_add(ALLOCATION_HEADER_LEN) else {
        return ptr::null_mut();
    };
    let Ok(layout) = Layout::from_size_align(total.max(1), ALLOCATION_ALIGN) else {
        return ptr::null_mut();
    };
    let base = unsafe { alloc(layout) };
    if base.is_null() {
        return ptr::null_mut();
    }
    unsafe {
        base.cast::<usize>().write(len);
        base.add(ALLOCATION_HEADER_LEN).cast()
    }
}

#[no_mangle]
pub unsafe extern "C" fn sakura_movie_realloc(ptr: *mut c_void, len: usize) -> *mut c_void {
    if ptr.is_null() {
        return sakura_movie_malloc(len);
    }
    if len == 0 {
        unsafe { sakura_movie_free(ptr) };
        return ptr::null_mut();
    }
    let base = unsafe { ptr.cast::<u8>().sub(ALLOCATION_HEADER_LEN) };
    let old_len = unsafe { base.cast::<usize>().read() };
    let Some(old_total) = old_len.checked_add(ALLOCATION_HEADER_LEN) else {
        return ptr::null_mut();
    };
    let Some(new_total) = len.checked_add(ALLOCATION_HEADER_LEN) else {
        return ptr::null_mut();
    };
    let Ok(old_layout) = Layout::from_size_align(old_total.max(1), ALLOCATION_ALIGN) else {
        return ptr::null_mut();
    };
    let new_base = unsafe { realloc(base, old_layout, new_total.max(1)) };
    if new_base.is_null() {
        return ptr::null_mut();
    }
    unsafe {
        new_base.cast::<usize>().write(len);
        new_base.add(ALLOCATION_HEADER_LEN).cast()
    }
}

#[no_mangle]
pub unsafe extern "C" fn sakura_movie_free(ptr: *mut c_void) {
    if ptr.is_null() {
        return;
    }
    let base = unsafe { ptr.cast::<u8>().sub(ALLOCATION_HEADER_LEN) };
    let len = unsafe { base.cast::<usize>().read() };
    let Some(total) = len.checked_add(ALLOCATION_HEADER_LEN) else {
        return;
    };
    let Ok(layout) = Layout::from_size_align(total.max(1), ALLOCATION_ALIGN) else {
        return;
    };
    unsafe { dealloc(base, layout) };
}

#[no_mangle]
pub unsafe extern "C" fn sakura_movie_memcpy(
    dest: *mut c_void,
    src: *const c_void,
    len: usize,
) -> *mut c_void {
    if len > 0 {
        unsafe { ptr::copy_nonoverlapping(src.cast::<u8>(), dest.cast::<u8>(), len) };
    }
    dest
}

#[no_mangle]
pub unsafe extern "C" fn sakura_movie_memmove(
    dest: *mut c_void,
    src: *const c_void,
    len: usize,
) -> *mut c_void {
    if len > 0 {
        unsafe { ptr::copy(src.cast::<u8>(), dest.cast::<u8>(), len) };
    }
    dest
}

#[no_mangle]
pub unsafe extern "C" fn sakura_movie_memset(
    dest: *mut c_void,
    value: i32,
    len: usize,
) -> *mut c_void {
    if len > 0 {
        unsafe { ptr::write_bytes(dest.cast::<u8>(), value as u8, len) };
    }
    dest
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn yuv420_conversion_uses_limited_range_bt601() {
        let y = [16, 235, 81, 145];
        let cb = [128];
        let cr = [128];
        let mut rgba = [0; 16];
        yuv420_to_rgba(&y, &cb, &cr, 2, 1, 2, 2, &mut rgba);
        assert_eq!(&rgba[0..4], &[0, 0, 0, 255]);
        assert_eq!(&rgba[4..8], &[255, 255, 255, 255]);
        assert_eq!(&rgba[8..12], &[76, 76, 76, 255]);
        assert_eq!(&rgba[12..16], &[150, 150, 150, 255]);
    }

    #[test]
    fn movie_allocator_preserves_bytes_across_reallocation() {
        let ptr = sakura_movie_malloc(8).cast::<u8>();
        assert!(!ptr.is_null());
        unsafe {
            for index in 0..8 {
                ptr.add(index).write(index as u8);
            }
            let grown = sakura_movie_realloc(ptr.cast(), 32).cast::<u8>();
            assert!(!grown.is_null());
            for index in 0..8 {
                assert_eq!(grown.add(index).read(), index as u8);
            }
            sakura_movie_free(grown.cast());
        }
    }
}
