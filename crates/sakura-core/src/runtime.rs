use crate::archive::{ArcArchive, ArcIndex};
use crate::catalog::{ArchiveId, ArchiveSummary, AssetCatalog, AssetRecord};
use crate::error::{Result, SakuraError};
use crate::runtime_input::RuntimeInputState;
use crate::script_library::ScriptLibrary;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeConfig {
    pub viewport_width: u32,
    pub viewport_height: u32,
    pub target_fps: u32,
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self {
            viewport_width: 1280,
            viewport_height: 720,
            target_fps: 60,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Runtime {
    config: RuntimeConfig,
    catalog: AssetCatalog,
    scripts: ScriptLibrary,
    archive_data: Vec<Option<Vec<u8>>>,
    strings_db: Option<Vec<u8>>,
    input: RuntimeInputState,
}

impl Runtime {
    pub fn new(config: RuntimeConfig) -> Self {
        Self {
            config,
            catalog: AssetCatalog::new(),
            scripts: ScriptLibrary::new(),
            archive_data: Vec::new(),
            strings_db: None,
            input: RuntimeInputState::default(),
        }
    }

    pub fn config(&self) -> &RuntimeConfig {
        &self.config
    }

    pub fn catalog(&self) -> &AssetCatalog {
        &self.catalog
    }

    pub fn scripts(&self) -> &ScriptLibrary {
        &self.scripts
    }

    pub fn input(&self) -> RuntimeInputState {
        self.input
    }

    pub fn set_input(&mut self, input: RuntimeInputState) {
        self.input = input;
    }

    pub fn mounted_assets(&self) -> usize {
        self.catalog.asset_count()
    }

    pub fn dsc_assets(&self) -> usize {
        self.catalog.dsc_assets()
    }

    pub fn loaded_scripts(&self) -> usize {
        self.scripts.script_count()
    }

    pub fn script_index_by_name(&self, name: &[u8]) -> Option<usize> {
        self.scripts.find_by_name_bytes(name).map(|id| id.index())
    }

    pub fn media_assets(&self) -> usize {
        self.catalog.media_assets()
    }

    pub fn mount_archive_data(&mut self, data: Vec<u8>) -> Result<ArchiveId> {
        self.mount_archive_data_named(data, None)
    }

    pub fn mount_archive_data_named(
        &mut self,
        data: Vec<u8>,
        archive_name: Option<&[u8]>,
    ) -> Result<ArchiveId> {
        let archive = ArcArchive::parse(&data)?;
        let mut catalog = self.catalog.clone();
        let mut scripts = self.scripts.clone();
        let archive_id = catalog.mount_archive_named(&archive, archive_name)?;
        scripts.mount_archive(&archive)?;
        if archive_id.index() != self.archive_data.len() {
            return Err(SakuraError::InvalidArchive(
                "runtime archive storage is out of sync".to_owned(),
            ));
        }
        self.catalog = catalog;
        self.scripts = scripts;
        self.archive_data.push(Some(data));
        Ok(archive_id)
    }

    pub fn mount_archive_index(&mut self, index: ArcIndex) -> Result<ArchiveId> {
        self.mount_archive_index_named(index, None)
    }

    pub fn mount_archive_index_named(
        &mut self,
        index: ArcIndex,
        archive_name: Option<&[u8]>,
    ) -> Result<ArchiveId> {
        let mut catalog = self.catalog.clone();
        let archive_id = catalog.mount_archive_index_named(&index, archive_name)?;
        if archive_id.index() != self.archive_data.len() {
            return Err(SakuraError::InvalidArchive(
                "runtime archive storage is out of sync".to_owned(),
            ));
        }
        self.catalog = catalog;
        self.archive_data.push(None);
        Ok(archive_id)
    }

    pub fn mount_dsc_script_payload(
        &mut self,
        name: &[u8],
        payload: &[u8],
    ) -> Result<crate::ScriptId> {
        let mut scripts = self.scripts.clone();
        let id = scripts.mount_dsc_payload(name, payload)?;
        self.scripts = scripts;
        Ok(id)
    }

    pub fn asset_data_by_name(&self, name: &[u8]) -> Result<Option<&[u8]>> {
        let Some(record) = self.catalog.find_by_query_name_bytes(name) else {
            return Ok(None);
        };
        self.asset_data(record).map(Some)
    }

    pub fn asset_data(&self, record: &AssetRecord) -> Result<&[u8]> {
        let location = record.location();
        let Some(summary) = self.catalog.archives().get(location.archive_id.index()) else {
            return Err(SakuraError::InvalidArchive(
                "asset references missing archive summary".to_owned(),
            ));
        };
        let Some(data) = self.archive_data.get(location.archive_id.index()) else {
            return Err(SakuraError::InvalidArchive(
                "asset archive bytes are not mounted".to_owned(),
            ));
        };
        let Some(data) = data.as_deref() else {
            return Err(SakuraError::InvalidArchive(
                "asset archive bytes are not mounted".to_owned(),
            ));
        };
        let start = summary
            .data_start()
            .checked_add(location.offset as usize)
            .ok_or_else(|| SakuraError::InvalidArchive("asset start overflows".to_owned()))?;
        let end = start
            .checked_add(location.size as usize)
            .ok_or_else(|| SakuraError::InvalidArchive("asset end overflows".to_owned()))?;
        data.get(start..end)
            .ok_or_else(|| SakuraError::InvalidArchive("asset range is out of bounds".to_owned()))
    }

    pub fn archive_data_by_name(&self, name: &[u8]) -> Option<&[u8]> {
        let archive = self.catalog.find_archive_by_name_bytes(name)?;
        self.archive_data.get(archive.id().index())?.as_deref()
    }

    /// Mounts the standalone strings-database sidecar (the install's `BGI.gdb`,
    /// `SDC FORMAT` blob). Unlike scripts and media it is not packed inside an
    /// `*.arc` archive, so scrdrv's `StringsDB` file query is resolved against
    /// this blob rather than against the catalog.
    pub fn mount_strings_db(&mut self, data: Vec<u8>) {
        self.strings_db = Some(data);
    }

    pub fn strings_db(&self) -> Option<&[u8]> {
        self.strings_db.as_deref()
    }

    pub fn archive_len_by_name(&self, name: &[u8]) -> Option<usize> {
        self.catalog
            .find_archive_by_name_bytes(name)
            .map(ArchiveSummary::archive_len)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn has_bgi_default_timing_surface() {
        let runtime = Runtime::new(RuntimeConfig::default());
        assert_eq!(runtime.config().viewport_width, 1280);
        assert_eq!(runtime.config().viewport_height, 720);
        assert_eq!(runtime.config().target_fps, 60);
    }

    #[test]
    fn mount_archive_data_populates_script_library() -> Result<()> {
        let payload = build_synthetic_dsc(&synthetic_system_script());
        let archive_data = build_arc20(&[("script._bp", payload.as_slice()), ("blob", b"raw")]);
        let mut runtime = Runtime::new(RuntimeConfig::default());

        runtime.mount_archive_data(archive_data)?;

        assert_eq!(runtime.mounted_assets(), 2);
        assert_eq!(runtime.dsc_assets(), 1);
        assert_eq!(runtime.loaded_scripts(), 1);
        assert_eq!(runtime.scripts().system_script_count(), 1);
        assert_eq!(
            runtime.asset_data_by_name(b"blob")?,
            Some(b"raw".as_slice())
        );
        Ok(())
    }

    #[test]
    fn later_mount_wins_serves_canonical_asset_data() -> Result<()> {
        let mut runtime = Runtime::new(RuntimeConfig::default());

        runtime.mount_archive_data(build_arc20(&[("same", b"first")]))?;
        runtime.mount_archive_data(build_arc20(&[("same", b"second")]))?;

        assert_eq!(
            runtime.asset_data_by_name(b"same")?,
            Some(b"second".as_slice())
        );
        assert_eq!(runtime.catalog().duplicate_assets(), 1);
        Ok(())
    }

    #[test]
    fn invalid_dsc_script_does_not_mutate_script_library() -> Result<()> {
        let invalid_dsc = b"DSC FORMAT 1.00\0\x00\x00";
        let archive_data = build_arc20(&[("bad._bp", invalid_dsc.as_slice())]);
        let mut runtime = Runtime::new(RuntimeConfig::default());

        runtime.mount_archive_data(archive_data)?;

        assert_eq!(runtime.mounted_assets(), 1);
        assert_eq!(runtime.dsc_assets(), 1);
        assert_eq!(runtime.loaded_scripts(), 0);
        assert_eq!(runtime.scripts().system_script_count(), 0);
        assert_eq!(runtime.catalog().archives().len(), 1);
        assert_eq!(
            runtime.asset_data_by_name(b"bad._bp")?,
            Some(invalid_dsc.as_slice())
        );
        Ok(())
    }

    #[test]
    fn archive_data_can_be_queried_by_archive_name() -> Result<()> {
        let archive_data = build_arc20(&[("payload", b"abcdef")]);
        let mut runtime = Runtime::new(RuntimeConfig::default());

        runtime.mount_archive_data_named(archive_data.clone(), Some(b"named.arc"))?;

        assert_eq!(
            runtime.archive_data_by_name(b"named.arc"),
            Some(archive_data.as_slice())
        );
        assert_eq!(
            runtime.archive_len_by_name(b"named.arc"),
            Some(archive_data.len())
        );
        Ok(())
    }

    fn synthetic_system_script() -> Vec<u8> {
        let mut script = vec![0u8; 0x10];
        script.extend_from_slice(&[0xff, 0x00, 0x17]);
        script
    }

    fn build_synthetic_dsc(plain: &[u8]) -> Vec<u8> {
        let hash = 0x1234_5678u32;
        let tree_len = 512usize;
        let header_len = 32usize;
        let mut dsc = vec![0u8; header_len + tree_len + plain.len()];
        dsc[..16].copy_from_slice(b"DSC FORMAT 1.00\0");
        dsc[16..20].copy_from_slice(&hash.to_le_bytes());
        dsc[20..24].copy_from_slice(&(plain.len() as u32).to_le_bytes());
        let mut current = hash;
        for symbol in 0..tree_len {
            let (next, mask) = next_dsc_mask(current);
            current = next;
            let depth = if symbol < 256 { 8u8 } else { 0u8 };
            dsc[header_len + symbol] = depth.wrapping_add(mask);
        }
        dsc[header_len + tree_len..].copy_from_slice(plain);
        dsc
    }

    fn next_dsc_mask(hash: u32) -> (u32, u8) {
        let edx = 20021u32.wrapping_mul(hash & 0xffff);
        let eax = 20021u32
            .wrapping_mul((hash >> 16) & 0xffff)
            .wrapping_add(346u32.wrapping_mul(hash))
            .wrapping_add((edx >> 16) & 0xffff);
        let next = ((eax & 0xffff) << 16)
            .wrapping_add(edx & 0xffff)
            .wrapping_add(1);
        (next, (eax & 0xff) as u8)
    }

    fn build_arc20(files: &[(&str, &[u8])]) -> Vec<u8> {
        const HEADER_LEN: usize = 16;
        const ENTRY_LEN: usize = 128;
        const NAME_LEN: usize = 96;

        let mut data = Vec::new();
        data.extend_from_slice(b"BURIKO ARC20");
        data.extend_from_slice(&(files.len() as u32).to_le_bytes());
        data.resize(HEADER_LEN + files.len() * ENTRY_LEN, 0);

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
