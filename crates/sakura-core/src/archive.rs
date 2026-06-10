use crate::bytes::{read_exact, read_u32_le};
use crate::error::{Result, SakuraError};

pub const ARC20_MAGIC: &[u8; 12] = b"BURIKO ARC20";
const ARC20_HEADER_LEN: usize = 16;
const ARC20_ENTRY_LEN: usize = 128;
const ARC20_NAME_LEN: usize = 96;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArchiveKind {
    BurikoArc20,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArcName {
    bytes: Vec<u8>,
}

impl ArcName {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        if bytes.is_empty()
            || bytes
                .iter()
                .any(|byte| matches!(*byte, b'/' | b'\\' | b':' | 0..=0x1f))
        {
            return Err(SakuraError::InvalidArchiveName);
        }
        Ok(Self {
            bytes: bytes.to_vec(),
        })
    }

    pub fn from_slot(slot: &[u8]) -> Result<Self> {
        let end = slot
            .iter()
            .position(|byte| *byte == 0)
            .unwrap_or(slot.len());
        Self::from_bytes(&slot[..end])
    }

    pub fn as_bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub fn ascii_label(&self) -> String {
        let mut label = String::new();
        for byte in &self.bytes {
            match *byte {
                b' '..=b'~' => label.push(*byte as char),
                _ => {
                    label.push('%');
                    label.push(nibble_to_hex(byte >> 4));
                    label.push(nibble_to_hex(byte & 0x0f));
                }
            }
        }
        label
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArcEntry {
    pub name: ArcName,
    pub offset: u32,
    pub size: u32,
}

impl ArcEntry {
    pub fn relative_end_offset(&self) -> Result<usize> {
        let offset = self.offset as usize;
        let size = self.size as usize;
        offset
            .checked_add(size)
            .ok_or_else(|| SakuraError::InvalidArchive("entry byte range overflows".to_owned()))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArcArchive<'a> {
    data: &'a [u8],
    index: ArcIndex,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArcIndex {
    kind: ArchiveKind,
    archive_len: usize,
    data_start: usize,
    entries: Vec<ArcEntry>,
}

impl ArcIndex {
    pub fn from_entries(
        archive_len: usize,
        data_start: usize,
        entries: Vec<ArcEntry>,
    ) -> Result<Self> {
        if data_start > archive_len {
            return Err(SakuraError::InvalidArchive(
                "archive index is larger than archive file".to_owned(),
            ));
        }
        for (index, entry) in entries.iter().enumerate() {
            let absolute_end = data_start
                .checked_add(entry.relative_end_offset()?)
                .ok_or_else(|| {
                    SakuraError::InvalidArchive("entry absolute byte range overflows".to_owned())
                })?;
            if absolute_end > archive_len {
                return Err(SakuraError::InvalidArchive(format!(
                    "entry #{index} points past archive end"
                )));
            }
        }
        Ok(Self {
            kind: ArchiveKind::BurikoArc20,
            archive_len,
            data_start,
            entries,
        })
    }

    pub fn parse_prefix(prefix: &[u8], archive_len: usize) -> Result<Self> {
        if prefix.len() < ARC20_HEADER_LEN {
            return Err(SakuraError::UnexpectedEof {
                offset: 0,
                needed: ARC20_HEADER_LEN,
                available: prefix.len(),
            });
        }
        if read_exact(prefix, 0, ARC20_MAGIC.len())? != ARC20_MAGIC {
            return Err(SakuraError::InvalidMagic {
                expected: "BURIKO ARC20",
            });
        }

        let count = read_u32_le(prefix, 12)? as usize;
        let index_len = count.checked_mul(ARC20_ENTRY_LEN).ok_or_else(|| {
            SakuraError::InvalidArchive("archive index length overflow".to_owned())
        })?;
        let data_start = ARC20_HEADER_LEN.checked_add(index_len).ok_or_else(|| {
            SakuraError::InvalidArchive("archive index offset overflow".to_owned())
        })?;
        if data_start > prefix.len() {
            return Err(SakuraError::UnexpectedEof {
                offset: ARC20_HEADER_LEN,
                needed: index_len,
                available: prefix.len().saturating_sub(ARC20_HEADER_LEN),
            });
        }
        if data_start > archive_len {
            return Err(SakuraError::InvalidArchive(
                "archive index is larger than archive file".to_owned(),
            ));
        }

        let mut entries = Vec::with_capacity(count);
        for index in 0..count {
            let entry_offset = ARC20_HEADER_LEN + index * ARC20_ENTRY_LEN;
            let name_slot = read_exact(prefix, entry_offset, ARC20_NAME_LEN)?;
            let offset = read_u32_le(prefix, entry_offset + ARC20_NAME_LEN)?;
            let size = read_u32_le(prefix, entry_offset + ARC20_NAME_LEN + 4)?;
            let entry = ArcEntry {
                name: ArcName::from_slot(name_slot)?,
                offset,
                size,
            };
            let relative_end = entry.relative_end_offset()?;
            let absolute_end = data_start.checked_add(relative_end).ok_or_else(|| {
                SakuraError::InvalidArchive("entry absolute byte range overflows".to_owned())
            })?;
            if absolute_end > archive_len {
                return Err(SakuraError::InvalidArchive(format!(
                    "entry #{index} points past archive end"
                )));
            }
            entries.push(entry);
        }

        Self::from_entries(archive_len, data_start, entries)
    }

    pub fn kind(&self) -> ArchiveKind {
        self.kind
    }

    pub fn archive_len(&self) -> usize {
        self.archive_len
    }

    pub fn data_start(&self) -> usize {
        self.data_start
    }

    pub fn entries(&self) -> &[ArcEntry] {
        &self.entries
    }

    pub fn find_by_name_bytes(&self, name: &[u8]) -> Option<&ArcEntry> {
        self.entries
            .iter()
            .find(|entry| entry.name.as_bytes() == name)
    }
}

impl<'a> ArcArchive<'a> {
    pub fn parse(data: &'a [u8]) -> Result<Self> {
        let index = ArcIndex::parse_prefix(data, data.len())?;
        Ok(Self { data, index })
    }

    pub fn kind(&self) -> ArchiveKind {
        self.index.kind()
    }

    pub fn index(&self) -> &ArcIndex {
        &self.index
    }

    pub fn entries(&self) -> &[ArcEntry] {
        self.index.entries()
    }

    pub fn entry_data(&self, entry: &ArcEntry) -> Result<&'a [u8]> {
        let start = self
            .index
            .data_start()
            .checked_add(entry.offset as usize)
            .ok_or_else(|| SakuraError::InvalidArchive("entry start overflows".to_owned()))?;
        let end = self
            .index
            .data_start()
            .checked_add(entry.relative_end_offset()?)
            .ok_or_else(|| SakuraError::InvalidArchive("entry end overflows".to_owned()))?;
        read_exact(self.data, start, end - start)
    }

    pub fn find_by_name_bytes(&self, name: &[u8]) -> Option<&ArcEntry> {
        self.index.find_by_name_bytes(name)
    }
}

fn nibble_to_hex(nibble: u8) -> char {
    match nibble {
        0..=9 => (b'0' + nibble) as char,
        10..=15 => (b'A' + (nibble - 10)) as char,
        _ => '?',
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_synthetic_arc20() -> Result<()> {
        let first = b"alpha";
        let second = b"beta-data";
        let archive = build_arc20(&[("one", first.as_slice()), ("two", second.as_slice())]);
        let parsed = ArcArchive::parse(&archive)?;

        assert_eq!(parsed.kind(), ArchiveKind::BurikoArc20);
        assert_eq!(parsed.entries().len(), 2);
        assert_eq!(parsed.entry_data(&parsed.entries()[0])?, first);
        assert_eq!(parsed.entry_data(&parsed.entries()[1])?, second);
        assert!(parsed.find_by_name_bytes(b"two").is_some());
        Ok(())
    }

    #[test]
    fn parses_synthetic_arc20_index_prefix() -> Result<()> {
        let archive = build_arc20(&[("one", b"alpha"), ("two", b"beta-data")]);
        let prefix_len = ARC20_HEADER_LEN + 2 * ARC20_ENTRY_LEN;
        let index = ArcIndex::parse_prefix(&archive[..prefix_len], archive.len())?;

        assert_eq!(index.kind(), ArchiveKind::BurikoArc20);
        assert_eq!(index.archive_len(), archive.len());
        assert_eq!(index.data_start(), prefix_len);
        assert_eq!(index.entries().len(), 2);
        assert!(index.find_by_name_bytes(b"one").is_some());
        Ok(())
    }

    #[test]
    fn rejects_out_of_bounds_entry() {
        let mut archive = build_arc20(&[("bad", b"data")]);
        let offset = ARC20_HEADER_LEN + ARC20_NAME_LEN;
        archive[offset..offset + 4].copy_from_slice(&999_999u32.to_le_bytes());
        let err = ArcArchive::parse(&archive).err();
        assert!(matches!(err, Some(SakuraError::InvalidArchive(_))));
    }

    #[test]
    fn rejects_path_like_names() {
        let archive = build_arc20(&[("../bad", b"data")]);
        let err = ArcArchive::parse(&archive).err();
        assert!(matches!(err, Some(SakuraError::InvalidArchiveName)));
    }

    fn build_arc20(files: &[(&str, &[u8])]) -> Vec<u8> {
        let index_len = files.len() * ARC20_ENTRY_LEN;
        let mut data = Vec::new();
        data.extend_from_slice(ARC20_MAGIC);
        data.extend_from_slice(&(files.len() as u32).to_le_bytes());
        data.resize(ARC20_HEADER_LEN + index_len, 0);

        let mut next_offset = 0usize;
        for (index, (name, payload)) in files.iter().enumerate() {
            let entry_offset = ARC20_HEADER_LEN + index * ARC20_ENTRY_LEN;
            let name_bytes = name.as_bytes();
            data[entry_offset..entry_offset + name_bytes.len()].copy_from_slice(name_bytes);
            data[entry_offset + ARC20_NAME_LEN..entry_offset + ARC20_NAME_LEN + 4]
                .copy_from_slice(&(next_offset as u32).to_le_bytes());
            data[entry_offset + ARC20_NAME_LEN + 4..entry_offset + ARC20_NAME_LEN + 8]
                .copy_from_slice(&(payload.len() as u32).to_le_bytes());
            next_offset += payload.len();
        }

        for (_, payload) in files {
            data.extend_from_slice(payload);
        }
        data
    }
}
