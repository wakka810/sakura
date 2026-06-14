use crate::archive::{ArcArchive, ArcIndex, ArcName, ArchiveKind};
use crate::error::{Result, SakuraError};
use crate::sniff::{sniff_payload, PayloadKind};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum DuplicatePolicy {
    Reject,
    #[default]
    LaterMountWins,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ArchiveId(usize);

impl ArchiveId {
    pub fn index(self) -> usize {
        self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AssetLocation {
    pub archive_id: ArchiveId,
    pub entry_index: usize,
    pub offset: u32,
    pub size: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArchiveSummary {
    id: ArchiveId,
    name: Option<ArcName>,
    kind: ArchiveKind,
    archive_len: usize,
    data_start: usize,
    entry_count: usize,
}

impl ArchiveSummary {
    pub fn id(&self) -> ArchiveId {
        self.id
    }

    pub fn kind(&self) -> ArchiveKind {
        self.kind
    }

    pub fn name(&self) -> Option<&ArcName> {
        self.name.as_ref()
    }

    pub fn archive_len(&self) -> usize {
        self.archive_len
    }

    pub fn data_start(&self) -> usize {
        self.data_start
    }

    pub fn entry_count(&self) -> usize {
        self.entry_count
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssetRecord {
    name: ArcName,
    location: AssetLocation,
    kind: PayloadKind,
    canonical: bool,
}

impl AssetRecord {
    pub fn name(&self) -> &ArcName {
        &self.name
    }

    pub fn location(&self) -> AssetLocation {
        self.location
    }

    pub fn kind(&self) -> PayloadKind {
        self.kind
    }

    pub fn is_canonical(&self) -> bool {
        self.canonical
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct AssetCatalog {
    duplicate_policy: DuplicatePolicy,
    archives: Vec<ArchiveSummary>,
    assets: Vec<AssetRecord>,
    by_name: BTreeMap<Vec<u8>, usize>,
    archive_by_name: BTreeMap<Vec<u8>, usize>,
    dsc_assets: usize,
    media_assets: usize,
    unknown_assets: usize,
    duplicate_assets: usize,
}

impl AssetCatalog {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_duplicate_policy(duplicate_policy: DuplicatePolicy) -> Self {
        Self {
            duplicate_policy,
            ..Self::default()
        }
    }

    pub fn duplicate_policy(&self) -> DuplicatePolicy {
        self.duplicate_policy
    }

    pub fn mount_archive(&mut self, archive: &ArcArchive<'_>) -> Result<ArchiveId> {
        self.mount_archive_named(archive, None)
    }

    pub fn mount_archive_named(
        &mut self,
        archive: &ArcArchive<'_>,
        archive_name: Option<&[u8]>,
    ) -> Result<ArchiveId> {
        self.mount_index_with_kind(archive.index(), archive_name, |entry_index| {
            let entry = &archive.entries()[entry_index];
            Ok(sniff_payload(archive.entry_data(entry)?))
        })
    }

    pub fn mount_archive_index(&mut self, index: &ArcIndex) -> Result<ArchiveId> {
        self.mount_archive_index_named(index, None)
    }

    pub fn mount_archive_index_named(
        &mut self,
        index: &ArcIndex,
        archive_name: Option<&[u8]>,
    ) -> Result<ArchiveId> {
        self.mount_index_with_kind(index, archive_name, |_| Ok(PayloadKind::Unknown))
    }

    pub fn archives(&self) -> &[ArchiveSummary] {
        &self.archives
    }

    pub fn assets(&self) -> &[AssetRecord] {
        &self.assets
    }

    pub fn find_by_name_bytes(&self, name: &[u8]) -> Option<&AssetRecord> {
        self.by_name
            .get(name)
            .and_then(|asset_index| self.assets.get(*asset_index))
    }

    pub fn find_by_query_name_bytes(&self, query: &[u8]) -> Option<&AssetRecord> {
        self.find_by_name_bytes(query).or_else(|| {
            self.assets
                .iter()
                .rev()
                .find(|asset| asset_name_matches(query, asset.name().as_bytes()))
        })
    }

    pub fn find_archive_by_name_bytes(&self, name: &[u8]) -> Option<&ArchiveSummary> {
        self.archive_by_name
            .get(name)
            .and_then(|archive_index| self.archives.get(*archive_index))
    }

    pub fn find_archive_by_query_name_bytes(&self, query: &[u8]) -> Option<&ArchiveSummary> {
        self.find_archive_by_name_bytes(query).or_else(|| {
            if !query.iter().any(|byte| matches!(*byte, b'x' | b'X')) {
                return None;
            }
            self.archives.iter().find(|archive| {
                archive
                    .name()
                    .is_some_and(|name| archive_query_matches(query, name.as_bytes()))
            })
        })
    }

    pub fn asset_count(&self) -> usize {
        self.assets.len()
    }

    pub fn canonical_asset_count(&self) -> usize {
        self.by_name.len()
    }

    pub fn dsc_assets(&self) -> usize {
        self.dsc_assets
    }

    pub fn media_assets(&self) -> usize {
        self.media_assets
    }

    pub fn unknown_assets(&self) -> usize {
        self.unknown_assets
    }

    pub fn duplicate_assets(&self) -> usize {
        self.duplicate_assets
    }

    fn mount_index_with_kind<F>(
        &mut self,
        index: &ArcIndex,
        archive_name: Option<&[u8]>,
        mut kind_for: F,
    ) -> Result<ArchiveId>
    where
        F: FnMut(usize) -> Result<PayloadKind>,
    {
        let archive_id = ArchiveId(self.archives.len());
        let archive_name = archive_name.map(ArcName::from_bytes).transpose()?;
        let mut staged_names = BTreeSet::new();
        let mut staged_records = Vec::with_capacity(index.entries().len());
        let mut staged_dsc = 0usize;
        let mut staged_media = 0usize;
        let mut staged_unknown = 0usize;

        if self.duplicate_policy == DuplicatePolicy::Reject
            && archive_name
                .as_ref()
                .is_some_and(|name| self.archive_by_name.contains_key(name.as_bytes()))
        {
            return Err(SakuraError::InvalidArchive(
                "duplicate archive file name".to_owned(),
            ));
        }

        for (entry_index, entry) in index.entries().iter().enumerate() {
            let name = entry.name.as_bytes().to_vec();
            if self.duplicate_policy == DuplicatePolicy::Reject
                && (self.by_name.contains_key(&name) || !staged_names.insert(name))
            {
                return Err(SakuraError::InvalidArchive(
                    "duplicate logical asset name".to_owned(),
                ));
            }

            let kind = kind_for(entry_index)?;
            match kind {
                PayloadKind::Dsc => staged_dsc += 1,
                PayloadKind::CompressedBg
                | PayloadKind::BgiAudio
                | PayloadKind::MpegProgramStream
                | PayloadKind::MpegVideo
                | PayloadKind::OggVorbis
                | PayloadKind::Png
                | PayloadKind::Jpeg
                | PayloadKind::Wav => staged_media += 1,
                PayloadKind::Unknown => staged_unknown += 1,
            }

            staged_records.push(AssetRecord {
                name: entry.name.clone(),
                location: AssetLocation {
                    archive_id,
                    entry_index,
                    offset: entry.offset,
                    size: entry.size,
                },
                kind,
                canonical: true,
            });
        }

        self.archives.push(ArchiveSummary {
            id: archive_id,
            name: archive_name.clone(),
            kind: index.kind(),
            archive_len: index.archive_len(),
            data_start: index.data_start(),
            entry_count: index.entries().len(),
        });
        if let Some(name) = archive_name {
            self.archive_by_name
                .insert(name.as_bytes().to_vec(), archive_id.index());
        }
        for record in staged_records {
            let asset_index = self.assets.len();
            if let Some(previous) = self
                .by_name
                .insert(record.name.as_bytes().to_vec(), asset_index)
            {
                self.assets[previous].canonical = false;
                self.duplicate_assets += 1;
            }
            self.assets.push(record);
        }
        self.dsc_assets += staged_dsc;
        self.media_assets += staged_media;
        self.unknown_assets += staged_unknown;

        Ok(archive_id)
    }
}

fn archive_query_matches(query: &[u8], candidate: &[u8]) -> bool {
    query.len() == candidate.len()
        && query
            .iter()
            .zip(candidate)
            .all(|(left, right)| match *left {
                b'x' | b'X' => right.is_ascii_digit(),
                _ => left.eq_ignore_ascii_case(right),
            })
}

fn asset_name_matches(query: &[u8], candidate: &[u8]) -> bool {
    query.len() == candidate.len()
        && query
            .iter()
            .zip(candidate)
            .all(|(left, right)| left.eq_ignore_ascii_case(right))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mounts_archive_and_classifies_assets() -> Result<()> {
        let archive_data = build_arc20(&[
            ("script", b"DSC FORMAT 1.00\0\x00\x00"),
            ("voice", b"OggS\x00\x02synthetic"),
            ("blob", b"\x01\x02\x03"),
        ]);
        let archive = ArcArchive::parse(&archive_data)?;
        let mut catalog = AssetCatalog::new();
        let archive_id = catalog.mount_archive(&archive)?;

        assert_eq!(archive_id.index(), 0);
        assert_eq!(catalog.archives().len(), 1);
        assert_eq!(catalog.asset_count(), 3);
        assert_eq!(catalog.canonical_asset_count(), 3);
        assert_eq!(catalog.dsc_assets(), 1);
        assert_eq!(catalog.media_assets(), 1);
        assert_eq!(catalog.unknown_assets(), 1);
        assert_eq!(
            catalog.find_by_name_bytes(b"voice").map(AssetRecord::kind),
            Some(PayloadKind::OggVorbis)
        );
        Ok(())
    }

    #[test]
    fn mounts_prefix_index_without_reading_payloads() -> Result<()> {
        let archive_data = build_arc20(&[("one", b"alpha"), ("two", b"beta")]);
        let archive = ArcArchive::parse(&archive_data)?;
        let prefix = &archive_data[..archive.index().data_start()];
        let index = ArcIndex::parse_prefix(prefix, archive_data.len())?;
        let mut catalog = AssetCatalog::new();

        catalog.mount_archive_index_named(&index, Some(b"named.arc"))?;

        assert_eq!(catalog.asset_count(), 2);
        assert_eq!(catalog.canonical_asset_count(), 2);
        assert_eq!(catalog.unknown_assets(), 2);
        assert_eq!(
            catalog
                .find_by_name_bytes(b"one")
                .map(|asset| asset.location().size),
            Some(5)
        );
        assert_eq!(
            catalog
                .find_archive_by_name_bytes(b"named.arc")
                .map(ArchiveSummary::archive_len),
            Some(archive_data.len())
        );
        Ok(())
    }

    #[test]
    fn rejects_duplicate_names_in_one_archive() -> Result<()> {
        let archive_data = build_arc20(&[("same", b"alpha"), ("same", b"beta")]);
        let archive = ArcArchive::parse(&archive_data)?;
        let mut catalog = AssetCatalog::with_duplicate_policy(DuplicatePolicy::Reject);

        let error = catalog.mount_archive(&archive).err();

        assert!(matches!(error, Some(SakuraError::InvalidArchive(_))));
        assert_eq!(catalog.asset_count(), 0);
        Ok(())
    }

    #[test]
    fn rejects_duplicate_names_across_archives() -> Result<()> {
        let first_data = build_arc20(&[("same", b"alpha")]);
        let second_data = build_arc20(&[("same", b"beta")]);
        let first = ArcArchive::parse(&first_data)?;
        let second = ArcArchive::parse(&second_data)?;
        let mut catalog = AssetCatalog::with_duplicate_policy(DuplicatePolicy::Reject);

        catalog.mount_archive(&first)?;
        let error = catalog.mount_archive(&second).err();

        assert!(matches!(error, Some(SakuraError::InvalidArchive(_))));
        assert_eq!(catalog.asset_count(), 1);
        Ok(())
    }

    #[test]
    fn later_mount_wins_keeps_one_canonical_record() -> Result<()> {
        let first_data = build_arc20(&[("same", b"alpha")]);
        let second_data = build_arc20(&[("same", b"beta-data")]);
        let first = ArcArchive::parse(&first_data)?;
        let second = ArcArchive::parse(&second_data)?;
        let mut catalog = AssetCatalog::new();

        catalog.mount_archive(&first)?;
        catalog.mount_archive(&second)?;

        let canonical = catalog
            .find_by_name_bytes(b"same")
            .ok_or_else(|| SakuraError::InvalidArchive("canonical record missing".to_owned()))?;
        assert_eq!(catalog.asset_count(), 2);
        assert_eq!(catalog.canonical_asset_count(), 1);
        assert_eq!(catalog.duplicate_assets(), 1);
        assert_eq!(canonical.location().archive_id.index(), 1);
        assert_eq!(canonical.location().size, 9);
        assert!(!catalog.assets()[0].is_canonical());
        assert!(catalog.assets()[1].is_canonical());
        Ok(())
    }

    #[test]
    fn query_name_lookup_matches_assets_case_insensitively() -> Result<()> {
        let archive_data = build_arc20(&[("makerlogo", b"image-data")]);
        let archive = ArcArchive::parse(&archive_data)?;
        let mut catalog = AssetCatalog::new();

        catalog.mount_archive_named(&archive, Some(b"data01999.arc"))?;

        let record = catalog
            .find_by_query_name_bytes(b"MakerLogo")
            .ok_or_else(|| SakuraError::InvalidArchive("query asset missing".to_owned()))?;
        assert_eq!(record.name().as_bytes(), b"makerlogo");
        assert_eq!(record.location().size, 10);
        Ok(())
    }

    fn build_arc20(files: &[(&str, &[u8])]) -> Vec<u8> {
        const HEADER_LEN: usize = 16;
        const ENTRY_LEN: usize = 128;
        const NAME_LEN: usize = 96;

        let index_len = files.len() * ENTRY_LEN;
        let mut data = Vec::new();
        data.extend_from_slice(b"BURIKO ARC20");
        data.extend_from_slice(&(files.len() as u32).to_le_bytes());
        data.resize(HEADER_LEN + index_len, 0);

        let mut next_offset = 0usize;
        for (index, (name, payload)) in files.iter().enumerate() {
            let entry_offset = HEADER_LEN + index * ENTRY_LEN;
            data[entry_offset..entry_offset + name.len()].copy_from_slice(name.as_bytes());
            data[entry_offset + NAME_LEN..entry_offset + NAME_LEN + 4]
                .copy_from_slice(&(next_offset as u32).to_le_bytes());
            data[entry_offset + NAME_LEN + 4..entry_offset + NAME_LEN + 8]
                .copy_from_slice(&(payload.len() as u32).to_le_bytes());
            next_offset += payload.len();
        }

        for (_, payload) in files {
            data.extend_from_slice(payload);
        }
        data
    }
}
