use crate::error::{Result, SakuraError};
use std::collections::BTreeSet;

const HVL_MAGIC: &[u8; 8] = b"BHV_____";
const HVL_ENTRY_SIZE: usize = 0x40;
const HVL_NAME_SIZE: usize = 0x38;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstallManifest {
    files: Vec<Vec<u8>>,
}

impl InstallManifest {
    pub fn parse(data: &[u8]) -> Result<Self> {
        if data.len() < 0x10 {
            return Err(SakuraError::UnexpectedEof {
                offset: 0,
                needed: 0x10,
                available: data.len(),
            });
        }
        if &data[..HVL_MAGIC.len()] != HVL_MAGIC {
            return Err(SakuraError::InvalidMagic {
                expected: "BHV_____",
            });
        }
        let count = u32::from_le_bytes([data[0x0c], data[0x0d], data[0x0e], data[0x0f]]) as usize;
        let table_len = count
            .checked_mul(HVL_ENTRY_SIZE)
            .and_then(|len| 0x10usize.checked_add(len))
            .ok_or_else(|| SakuraError::InvalidArchive("HVL table length overflows".to_owned()))?;
        if table_len > data.len() {
            return Err(SakuraError::UnexpectedEof {
                offset: 0x10,
                needed: table_len - 0x10,
                available: data.len().saturating_sub(0x10),
            });
        }

        let mut seen = BTreeSet::new();
        let mut files = Vec::with_capacity(count);
        for index in 0..count {
            let offset = 0x10 + index * HVL_ENTRY_SIZE;
            let slot = &data[offset..offset + HVL_NAME_SIZE];
            let Some(name) = parse_name_slot(slot) else {
                continue;
            };
            if seen.insert(name.clone()) {
                files.push(name);
            }
        }
        Ok(Self { files })
    }

    pub fn files(&self) -> &[Vec<u8>] {
        &self.files
    }

    pub fn archive_files(&self) -> impl Iterator<Item = &[u8]> {
        self.files
            .iter()
            .map(Vec::as_slice)
            .filter(|name| has_extension(name, b".arc"))
    }

    pub fn manifest_len(&self) -> Option<usize> {
        self.files
            .iter()
            .try_fold(4usize, |sum, name| sum.checked_add(2 + name.len()))
    }

    pub fn write_manifest(&self, out: &mut [u8]) -> Option<usize> {
        let required = self.manifest_len()?;
        if out.len() < required {
            return None;
        }
        out[..required].fill(0);
        out[..4].copy_from_slice(&(self.files.len() as u32).to_le_bytes());
        let mut cursor = 4usize;
        for name in &self.files {
            let len = u16::try_from(name.len()).ok()?;
            out[cursor..cursor + 2].copy_from_slice(&len.to_le_bytes());
            cursor += 2;
            out[cursor..cursor + name.len()].copy_from_slice(name);
            cursor += name.len();
        }
        Some(required)
    }
}

fn parse_name_slot(slot: &[u8]) -> Option<Vec<u8>> {
    let end = slot
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(slot.len());
    let name = &slot[..end];
    if name.is_empty()
        || name
            .iter()
            .any(|byte| matches!(*byte, b'/' | b'\\' | b':' | 0..=0x1f))
    {
        return None;
    }
    Some(name.to_vec())
}

fn has_extension(name: &[u8], extension: &[u8]) -> bool {
    name.len() >= extension.len()
        && name[name.len() - extension.len()..]
            .iter()
            .zip(extension)
            .all(|(left, right)| left.to_ascii_lowercase() == *right)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_hvl_order_without_exposing_names() -> Result<()> {
        let data = synthetic_hvl(&[b"BGI.exe".as_slice(), b"system.arc", b"data.arc"]);
        let manifest = InstallManifest::parse(&data)?;

        assert_eq!(manifest.files().len(), 3);
        assert_eq!(manifest.archive_files().count(), 2);
        Ok(())
    }

    #[test]
    fn writes_roundtrip_manifest_packet() -> Result<()> {
        let data = synthetic_hvl(&[b"system.arc".as_slice(), b"sysprg.arc"]);
        let manifest = InstallManifest::parse(&data)?;
        let len = manifest.manifest_len().ok_or_else(|| {
            SakuraError::InvalidArchive("synthetic manifest length missing".to_owned())
        })?;
        let mut out = vec![0; len];

        assert_eq!(manifest.write_manifest(&mut out), Some(len));
        assert_eq!(u32::from_le_bytes(out[..4].try_into().unwrap()), 2);
        assert!(len > 4);
        Ok(())
    }

    fn synthetic_hvl(names: &[&[u8]]) -> Vec<u8> {
        let mut data = vec![0; 0x10 + names.len() * HVL_ENTRY_SIZE];
        data[..HVL_MAGIC.len()].copy_from_slice(HVL_MAGIC);
        data[0x0c..0x10].copy_from_slice(&(names.len() as u32).to_le_bytes());
        for (index, name) in names.iter().enumerate() {
            let offset = 0x10 + index * HVL_ENTRY_SIZE;
            data[offset..offset + name.len()].copy_from_slice(name);
        }
        data
    }
}
