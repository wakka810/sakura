use crate::error::{Result, SakuraError};

pub fn read_exact(data: &[u8], offset: usize, len: usize) -> Result<&[u8]> {
    let end = offset.checked_add(len).ok_or_else(|| {
        SakuraError::InvalidArchive("byte range overflow while reading".to_owned())
    })?;
    data.get(offset..end).ok_or(SakuraError::UnexpectedEof {
        offset,
        needed: len,
        available: data.len().saturating_sub(offset),
    })
}

pub fn read_u32_le(data: &[u8], offset: usize) -> Result<u32> {
    let bytes = read_exact(data, offset, 4)?;
    Ok(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}
