//! Minimal `BURIKO GDB 3.00` sidecar parsing.
//!
//! The full file also stores flag arrays and engine state. For the browser host
//! we currently need the stable viewed-image table used by the Extra/Graphic UI:
//! `u32 count`, then `count` NUL-terminated asset basenames. The following bytes
//! start the flag-array section and are deliberately left uninterpreted here.

use crate::error::{Result, SakuraError};
use crate::sdc::{decompress_sdc, is_sdc};

pub const GDB_MAGIC: &[u8; 15] = b"BURIKO GDB 3.00";

const VIEWED_IMAGE_PREFIX: &[u8] = b"white\0makuralogo\0att01\0att02\0";
const VIEWED_IMAGE_MAX_COUNT: usize = 4096;
const VIEWED_IMAGE_MAX_NAME_LEN: usize = 96;

/// Returns true when the payload starts with the decompressed GDB magic.
pub fn is_gdb(data: &[u8]) -> bool {
    data.len() >= GDB_MAGIC.len() && &data[..GDB_MAGIC.len()] == GDB_MAGIC
}

/// Decompresses an SDC-wrapped `BGI.gdb` or validates and clones a raw GDB blob.
pub fn decode_gdb(data: &[u8]) -> Result<Vec<u8>> {
    let decoded = if is_sdc(data) {
        decompress_sdc(data)?
    } else {
        data.to_vec()
    };
    if !is_gdb(&decoded) {
        return Err(SakuraError::InvalidMagic {
            expected: "BURIKO GDB 3.00",
        });
    }
    Ok(decoded)
}

/// Extracts the viewed-image asset basenames from an SDC-wrapped or raw GDB.
pub fn gdb_viewed_image_names(data: &[u8]) -> Result<Vec<Vec<u8>>> {
    let decoded = decode_gdb(data)?;
    viewed_image_names_from_decoded_gdb(&decoded)
}

/// Returns the required NUL-separated byte length for `gdb_write_viewed_image_names`.
pub fn gdb_viewed_image_names_nul_len(data: &[u8]) -> Result<usize> {
    Ok(gdb_viewed_image_names(data)?
        .iter()
        .try_fold(0usize, |sum, name| sum.checked_add(name.len() + 1))
        .ok_or_else(|| {
            SakuraError::InvalidRuntime("GDB viewed-image list is too large".to_owned())
        })?)
}

/// Writes viewed-image names as `name\0name\0...`.
pub fn gdb_write_viewed_image_names(data: &[u8], out: &mut [u8]) -> Result<usize> {
    let names = gdb_viewed_image_names(data)?;
    let required = names
        .iter()
        .try_fold(0usize, |sum, name| sum.checked_add(name.len() + 1))
        .ok_or_else(|| {
            SakuraError::InvalidRuntime("GDB viewed-image list is too large".to_owned())
        })?;
    if out.len() < required {
        return Err(SakuraError::InvalidRuntime(format!(
            "GDB viewed-image output is too small: got {} need {required}",
            out.len()
        )));
    }
    let mut cursor = 0usize;
    for name in names {
        out[cursor..cursor + name.len()].copy_from_slice(&name);
        cursor += name.len();
        out[cursor] = 0;
        cursor += 1;
    }
    Ok(required)
}

fn viewed_image_names_from_decoded_gdb(data: &[u8]) -> Result<Vec<Vec<u8>>> {
    let Some(prefix_offset) = find_subslice(data, VIEWED_IMAGE_PREFIX) else {
        // A pristine or externally reset GDB can have no viewed-image entries.
        // Treat absence as an empty list rather than corrupting the mount.
        return Ok(Vec::new());
    };
    let Some(count_offset) = prefix_offset.checked_sub(4) else {
        return Ok(Vec::new());
    };
    let count = read_u32_le(data, count_offset)? as usize;
    if count == 0 || count > VIEWED_IMAGE_MAX_COUNT {
        return Err(SakuraError::InvalidRuntime(format!(
            "invalid GDB viewed-image count {count}"
        )));
    }

    let mut names = Vec::with_capacity(count);
    let mut cursor = prefix_offset;
    for _ in 0..count {
        let name = read_nul_terminated_asset_name(data, cursor)?;
        cursor = cursor.checked_add(name.len() + 1).ok_or_else(|| {
            SakuraError::InvalidRuntime("GDB viewed-image cursor overflows".to_owned())
        })?;
        names.push(name);
    }

    // The next section begins with a little-endian flag-array count. Requiring
    // four following bytes catches accidental matches inside unrelated strings.
    let _flag_count = read_u32_le(data, cursor)?;
    Ok(names)
}

fn read_nul_terminated_asset_name(data: &[u8], offset: usize) -> Result<Vec<u8>> {
    let tail = data.get(offset..).ok_or(SakuraError::UnexpectedEof {
        offset,
        needed: 1,
        available: 0,
    })?;
    let Some(length) = tail.iter().position(|byte| *byte == 0) else {
        return Err(SakuraError::UnexpectedEof {
            offset,
            needed: 1,
            available: tail.len(),
        });
    };
    if length == 0 || length > VIEWED_IMAGE_MAX_NAME_LEN {
        return Err(SakuraError::InvalidRuntime(format!(
            "invalid GDB viewed-image name length {length}"
        )));
    }
    let name = &tail[..length];
    if !name
        .iter()
        .all(|byte| byte.is_ascii_alphanumeric() || *byte == b'_')
    {
        return Err(SakuraError::InvalidRuntime(
            "GDB viewed-image name contains non-asset characters".to_owned(),
        ));
    }
    Ok(name.iter().map(u8::to_ascii_lowercase).collect())
}

fn read_u32_le(data: &[u8], offset: usize) -> Result<u32> {
    let bytes = data
        .get(offset..offset + 4)
        .ok_or(SakuraError::UnexpectedEof {
            offset,
            needed: 4,
            available: data.len().saturating_sub(offset),
        })?;
    Ok(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || needle.len() > haystack.len() {
        return None;
    }
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_viewed_image_names_from_decoded_gdb() -> Result<()> {
        let mut data = synthetic_gdb(&["white", "makuralogo", "att01", "att02", "sp0003a"]);

        let names = gdb_viewed_image_names(&data)?;
        assert_eq!(
            names,
            vec![
                b"white".to_vec(),
                b"makuralogo".to_vec(),
                b"att01".to_vec(),
                b"att02".to_vec(),
                b"sp0003a".to_vec(),
            ]
        );

        let required = gdb_viewed_image_names_nul_len(&data)?;
        let mut out = vec![0u8; required];
        assert_eq!(gdb_write_viewed_image_names(&data, &mut out)?, required);
        assert_eq!(out, b"white\0makuralogo\0att01\0att02\0sp0003a\0");

        data[0] = b'X';
        assert!(gdb_viewed_image_names(&data).is_err());
        Ok(())
    }

    #[test]
    fn missing_viewed_prefix_is_empty_not_corrupt() -> Result<()> {
        let mut data = Vec::new();
        data.extend_from_slice(GDB_MAGIC);
        data.push(0);
        data.resize(128, 0);
        assert_eq!(gdb_viewed_image_names(&data)?, Vec::<Vec<u8>>::new());
        assert_eq!(gdb_viewed_image_names_nul_len(&data)?, 0);
        Ok(())
    }

    fn synthetic_gdb(names: &[&str]) -> Vec<u8> {
        let mut data = Vec::new();
        data.extend_from_slice(GDB_MAGIC);
        data.push(0);
        data.resize(0x80, 0);
        data.extend_from_slice(&(names.len() as u32).to_le_bytes());
        for name in names {
            data.extend_from_slice(name.as_bytes());
            data.push(0);
        }
        data.extend_from_slice(&1u32.to_le_bytes());
        data.extend_from_slice(b"MakerLogo\0");
        data
    }
}
