//! CFlag named bit-flag database, ported faithfully from BGI.exe
//! (`sub_444F10` ensure, `sub_4450D0` set-range, `sub_445170` get-bit,
//! `sub_4453D0` find, `sub_4508D0` hash, `sub_444EA0/EB0/EC0` bit math).
//!
//! The engine stores game flags (route progression, seen-state, config) as a
//! registry of named bit-arrays. scrmain reads/writes these to choose the boot
//! flow (title vs continue vs route), so faithful behavior is required for the
//! script flow to match the original engine. Flags persist in `BGI.gdb`.
//!
//! Bit ordering is MSB-first within each byte: bit `i` lives in
//! `data[i >> 3]` at mask `0x80 >> (i & 7)`.

/// Name hash used to key flag arrays (BGI `sub_4508D0`): `h = c + 233*h` over
/// the bytes of the name, with `c` treated as a signed byte (matching the
/// engine's `char` arithmetic). Wrapping 32-bit.
pub fn flag_name_hash(name: &[u8]) -> i32 {
    let mut hash: i32 = 0;
    for &byte in name {
        let signed = byte as i8 as i32;
        hash = signed.wrapping_add(233i32.wrapping_mul(hash));
    }
    hash
}

#[inline]
fn byte_count_for_bits(bits: usize) -> usize {
    bits.saturating_add(7) >> 3
}

#[inline]
fn bit_byte_index(bit: usize) -> usize {
    bit >> 3
}

#[inline]
fn bit_mask(bit: usize) -> u8 {
    0x80u8 >> (bit & 7)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct FlagArray {
    hash: i32,
    name: Vec<u8>,
    bit_count: usize,
    data: Vec<u8>,
}

/// Result codes mirror the engine's negative status codes; callers map them to
/// the VM's pushed status as the original handlers do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FlagError {
    /// `0x80000002` — the named array does not exist.
    NotFound,
    /// `0x80000003` — the bit index/range is out of range.
    OutOfRange,
    /// `0x80000004` — the requested range length is invalid.
    BadLength,
}

/// A registry of named bit-arrays (BGI manager `dword_552080`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FlagDb {
    // Move-to-front list in the engine; a Vec preserves lookup behavior.
    arrays: Vec<FlagArray>,
}

impl FlagDb {
    pub fn new() -> Self {
        Self { arrays: Vec::new() }
    }

    fn position(&self, name: &[u8]) -> Option<usize> {
        let hash = flag_name_hash(name);
        self.arrays
            .iter()
            .position(|array| array.hash == hash && array.name == name)
    }

    /// Ensures a named bit-array of `bit_count` bits exists (BGI `sub_444F10`).
    /// Resizes (preserving content) if it already exists; creates it zeroed
    /// otherwise.
    pub fn ensure(&mut self, name: &[u8], bit_count: usize) {
        let bytes = byte_count_for_bits(bit_count);
        if let Some(index) = self.position(name) {
            let array = &mut self.arrays[index];
            let mut next = vec![0u8; bytes];
            let copy = next.len().min(array.data.len());
            next[..copy].copy_from_slice(&array.data[..copy]);
            array.data = next;
            array.bit_count = bit_count;
        } else {
            self.arrays.push(FlagArray {
                hash: flag_name_hash(name),
                name: name.to_vec(),
                bit_count,
                data: vec![0u8; bytes],
            });
        }
    }

    /// Reads a single flag bit (BGI `sub_445170`).
    pub fn get_bit(&self, name: &[u8], bit: usize) -> Result<bool, FlagError> {
        let array = self
            .position(name)
            .map(|index| &self.arrays[index])
            .ok_or(FlagError::NotFound)?;
        if bit >= array.bit_count {
            return Err(FlagError::OutOfRange);
        }
        let byte = array.data.get(bit_byte_index(bit)).copied().unwrap_or(0);
        Ok((byte & bit_mask(bit)) != 0)
    }

    /// Sets or clears a single flag bit (BGI `sub_445060`).
    pub fn set_bit(&mut self, name: &[u8], bit: usize, value: bool) -> Result<(), FlagError> {
        let index = self.position(name).ok_or(FlagError::NotFound)?;
        let array = &mut self.arrays[index];
        if bit >= array.bit_count {
            return Err(FlagError::OutOfRange);
        }
        let mask = bit_mask(bit);
        let slot = bit_byte_index(bit);
        if let Some(target) = array.data.get_mut(slot) {
            if value {
                *target |= mask;
            } else {
                *target &= !mask;
            }
        }
        Ok(())
    }

    /// Sets or clears a contiguous range of `count` flag bits starting at
    /// `start` (BGI `sub_4450D0`).
    pub fn set_range(
        &mut self,
        name: &[u8],
        start: usize,
        count: usize,
        value: bool,
    ) -> Result<(), FlagError> {
        let index = self.position(name).ok_or(FlagError::NotFound)?;
        let array = &mut self.arrays[index];
        if start >= array.bit_count {
            return Err(FlagError::OutOfRange);
        }
        if count == 0 || count > 0x1_0000 {
            return Err(FlagError::BadLength);
        }
        let end = start.checked_add(count).ok_or(FlagError::BadLength)?;
        if end > array.bit_count {
            return Err(FlagError::BadLength);
        }
        for bit in start..end {
            let mask = bit_mask(bit);
            if let Some(target) = array.data.get_mut(bit_byte_index(bit)) {
                if value {
                    *target |= mask;
                } else {
                    *target &= !mask;
                }
            }
        }
        Ok(())
    }

    /// Returns the number of registered flag arrays.
    pub fn len(&self) -> usize {
        self.arrays.len()
    }

    pub fn is_empty(&self) -> bool {
        self.arrays.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_matches_reference_recurrence() {
        // h = c + 233*h
        assert_eq!(flag_name_hash(b""), 0);
        assert_eq!(flag_name_hash(b"A"), i32::from(b'A'));
        let expected = i32::from(b'B').wrapping_add(233i32.wrapping_mul(i32::from(b'A')));
        assert_eq!(flag_name_hash(b"AB"), expected);
    }

    #[test]
    fn ensure_get_set_bits_msb_first() {
        let mut db = FlagDb::new();
        db.ensure(b"flag", 16);
        assert_eq!(db.get_bit(b"flag", 0), Ok(false));
        db.set_bit(b"flag", 0, true).unwrap();
        assert_eq!(db.get_bit(b"flag", 0), Ok(true));
        // bit 0 is the MSB of byte 0.
        db.set_bit(b"flag", 7, true).unwrap();
        assert_eq!(db.get_bit(b"flag", 7), Ok(true));
        assert_eq!(db.get_bit(b"flag", 1), Ok(false));
    }

    #[test]
    fn set_range_and_bounds() {
        let mut db = FlagDb::new();
        db.ensure(b"r", 32);
        db.set_range(b"r", 4, 8, true).unwrap();
        for bit in 0..32 {
            let want = (4..12).contains(&bit);
            assert_eq!(db.get_bit(b"r", bit), Ok(want), "bit {bit}");
        }
        assert_eq!(db.get_bit(b"r", 32), Err(FlagError::OutOfRange));
        assert_eq!(db.set_range(b"r", 30, 8, true), Err(FlagError::BadLength));
        assert_eq!(db.get_bit(b"missing", 0), Err(FlagError::NotFound));
    }

    #[test]
    fn ensure_resize_preserves_content() {
        let mut db = FlagDb::new();
        db.ensure(b"g", 8);
        db.set_bit(b"g", 3, true).unwrap();
        db.ensure(b"g", 64);
        assert_eq!(db.get_bit(b"g", 3), Ok(true));
        assert_eq!(db.get_bit(b"g", 40), Ok(false));
    }
}
