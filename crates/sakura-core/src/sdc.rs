//! SDC ("SDC FORMAT 1.00") decompression, ported faithfully from BGI.exe
//! (sub_48D5A0 / sub_48D510 / sub_48D400 / sub_48BF70 / sub_48BF80).
//!
//! Layout (little-endian):
//!   0x00  char[16]  "SDC FORMAT 1.00\0"
//!   0x10  u32       PRNG seed (low 16 bits used)
//!   0x14  u32       compressed (encrypted) payload length
//!   0x18  u32       decompressed length
//!   0x1c  u16       checksum: sum of the encrypted payload bytes (wrapping)
//!   0x1e  u16       checksum: xor of the encrypted payload bytes
//!   0x20  ..        encrypted + LZ-compressed payload
//!
//! Each payload byte is decrypted as `(byte - prng_next()) & 0xFF`. The decrypted
//! stream is an LZ77 variant: a control byte with the high bit clear is a literal
//! run of `(ctrl + 1)` bytes; otherwise it is a back-reference with
//! `count = ((ctrl >> 3) & 0xF) + 2` and `offset = next_byte + 2 + 256 * (ctrl & 7)`.

use crate::error::{Result, SakuraError};

pub const SDC_MAGIC: &[u8; 15] = b"SDC FORMAT 1.00";
const SDC_HEADER_LEN: usize = 32;

/// Linear-congruential PRNG used to (de)cipher the payload (BGI sub_48BF80).
struct SdcCipher {
    state: u32,
}

impl SdcCipher {
    fn new(seed: u32) -> Self {
        Self { state: seed }
    }

    fn next(&mut self) -> u32 {
        let v0 = (22_695_477u32.wrapping_mul(self.state) >> 16) as u16;
        self.state = (u32::from(v0) << 16)
            .wrapping_add(20_021u32.wrapping_mul(self.state) & 0xFFFF)
            .wrapping_add(1);
        u32::from(v0) & 0x7FFF
    }
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

/// Returns true if the payload carries the SDC magic.
pub fn is_sdc(data: &[u8]) -> bool {
    data.len() >= SDC_MAGIC.len() && &data[..SDC_MAGIC.len()] == SDC_MAGIC
}

/// Decompresses an "SDC FORMAT 1.00" payload (e.g. BGI.gdb).
pub fn decompress_sdc(data: &[u8]) -> Result<Vec<u8>> {
    if data.len() < SDC_HEADER_LEN {
        return Err(SakuraError::UnexpectedEof {
            offset: 0,
            needed: SDC_HEADER_LEN,
            available: data.len(),
        });
    }
    if &data[..SDC_MAGIC.len()] != SDC_MAGIC {
        return Err(SakuraError::InvalidMagic {
            expected: "SDC FORMAT 1.00",
        });
    }
    let seed = read_u32(data, 16)?;
    let compressed_len = read_u32(data, 20)? as usize;
    let decompressed_len = read_u32(data, 24)? as usize;
    let sum_expected = read_u16(data, 28)?;
    let xor_expected = read_u16(data, 30)?;

    let end = SDC_HEADER_LEN
        .checked_add(compressed_len)
        .ok_or_else(|| SakuraError::InvalidDsc("SDC compressed length overflows".to_owned()))?;
    let encrypted = data
        .get(SDC_HEADER_LEN..end)
        .ok_or(SakuraError::UnexpectedEof {
            offset: SDC_HEADER_LEN,
            needed: compressed_len,
            available: data.len().saturating_sub(SDC_HEADER_LEN),
        })?;

    // The checksum is computed over the encrypted payload bytes (BGI sub_48D510).
    let mut sum = 0u16;
    let mut xor = 0u16;
    for &byte in encrypted {
        sum = sum.wrapping_add(u16::from(byte));
        xor ^= u16::from(byte);
    }
    if sum != sum_expected || xor != xor_expected {
        return Err(SakuraError::InvalidDsc(format!(
            "SDC checksum mismatch: sum {sum:#06x}/{sum_expected:#06x} xor {xor:#06x}/{xor_expected:#06x}"
        )));
    }

    let mut cipher = SdcCipher::new(seed);
    let mut decrypted = Vec::with_capacity(compressed_len);
    for &byte in encrypted {
        let key = cipher.next() as i32;
        decrypted.push(((i32::from(byte) - key) & 0xFF) as u8);
    }

    let output = lz_decompress(&decrypted, decompressed_len)?;
    if output.len() != decompressed_len {
        return Err(SakuraError::InvalidDsc(format!(
            "SDC decompressed length mismatch: got {} expected {decompressed_len}",
            output.len()
        )));
    }
    Ok(output)
}

fn lz_decompress(input: &[u8], decompressed_len: usize) -> Result<Vec<u8>> {
    let mut out: Vec<u8> = Vec::with_capacity(decompressed_len);
    let mut cursor = 0usize;
    while cursor < input.len() {
        let control = input[cursor];
        if control & 0x80 == 0 {
            let count = usize::from(control) + 1;
            cursor += 1;
            let end = cursor
                .checked_add(count)
                .ok_or_else(|| SakuraError::InvalidDsc("SDC literal run overflows".to_owned()))?;
            let run = input
                .get(cursor..end)
                .ok_or_else(|| SakuraError::InvalidDsc("SDC literal run truncated".to_owned()))?;
            out.extend_from_slice(run);
            cursor = end;
        } else {
            let offset_byte = *input
                .get(cursor + 1)
                .ok_or_else(|| SakuraError::InvalidDsc("SDC back-reference truncated".to_owned()))?;
            let count = usize::from((control >> 3) & 0xF) + 2;
            let offset = usize::from(offset_byte) + 2 + 256 * usize::from(control & 7);
            if offset > out.len() {
                return Err(SakuraError::InvalidDsc(format!(
                    "SDC back-reference offset {offset} exceeds output {}",
                    out.len()
                )));
            }
            let start = out.len() - offset;
            for index in 0..count {
                let value = out[start + index];
                out.push(value);
            }
            cursor += 2;
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cipher_matches_reference_sequence() {
        // Reproduces BGI sub_48BF80 with seed 0.
        let mut cipher = SdcCipher::new(0);
        let first = cipher.next();
        // 22695477*0>>16 = 0; state = 0<<16 + 0 + 1 = 1; returns 0.
        assert_eq!(first, 0);
        let second = cipher.next();
        // 22695477*1>>16 = 346 (0x15A); returns 346.
        assert_eq!(second, (22_695_477u32 >> 16) & 0x7FFF);
    }

    #[test]
    fn decompresses_literal_only_stream() {
        // Build a synthetic SDC blob with seed 0 and a literal run "ABC".
        let plain = b"ABC";
        // control byte 0x02 = literal run of 3 bytes, then the 3 literals.
        let mut decompressed_stream = vec![0x02u8];
        decompressed_stream.extend_from_slice(plain);
        // Encrypt: encrypted = decrypted + prng_next().
        let mut cipher = SdcCipher::new(0);
        let encrypted: Vec<u8> = decompressed_stream
            .iter()
            .map(|&b| ((i32::from(b) + cipher.next() as i32) & 0xFF) as u8)
            .collect();
        let mut sum = 0u16;
        let mut xor = 0u16;
        for &b in &encrypted {
            sum = sum.wrapping_add(u16::from(b));
            xor ^= u16::from(b);
        }
        let mut blob = Vec::new();
        blob.extend_from_slice(SDC_MAGIC);
        blob.push(0); // magic NUL terminator (16 bytes total)
        blob.extend_from_slice(&0u32.to_le_bytes()); // seed
        blob.extend_from_slice(&(encrypted.len() as u32).to_le_bytes()); // compressed len
        blob.extend_from_slice(&(plain.len() as u32).to_le_bytes()); // decompressed len
        blob.extend_from_slice(&sum.to_le_bytes());
        blob.extend_from_slice(&xor.to_le_bytes());
        blob.extend_from_slice(&encrypted);
        assert_eq!(decompress_sdc(&blob).unwrap(), plain);
    }
}
