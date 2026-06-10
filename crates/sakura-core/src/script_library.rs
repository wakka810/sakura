use crate::archive::ArcArchive;
use crate::dsc::decompress_dsc;
use crate::error::Result;
use crate::scenario::{ScenarioProgram, ScenarioVm};
use crate::script::is_buriko_script_v1;
use crate::sniff::{sniff_payload, PayloadKind};
use crate::system_vm::SystemVm;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ScriptId(usize);

impl ScriptId {
    pub fn index(self) -> usize {
        self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoadedScriptKind {
    Scenario,
    System,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadedScript {
    kind: LoadedScriptKind,
    decompressed: Vec<u8>,
}

impl LoadedScript {
    pub fn kind(&self) -> LoadedScriptKind {
        self.kind
    }

    pub fn decompressed(&self) -> &[u8] {
        &self.decompressed
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ScriptLibrary {
    scripts: Vec<LoadedScript>,
    by_name: BTreeMap<Vec<u8>, ScriptId>,
    scenario_scripts: usize,
    system_scripts: usize,
    duplicate_scripts: usize,
}

impl ScriptLibrary {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn mount_archive(&mut self, archive: &ArcArchive<'_>) -> Result<usize> {
        let mut mounted = 0usize;
        for entry in archive.entries() {
            let payload = archive.entry_data(entry)?;
            if sniff_payload(payload) != PayloadKind::Dsc {
                continue;
            }
            if self
                .mount_dsc_payload(entry.name.as_bytes(), payload)
                .is_ok()
            {
                mounted += 1;
            }
        }
        Ok(mounted)
    }

    pub fn mount_dsc_payload(&mut self, name: &[u8], payload: &[u8]) -> Result<ScriptId> {
        if sniff_payload(payload) != PayloadKind::Dsc {
            return Err(crate::SakuraError::InvalidScript(
                "script payload is not DSC".to_owned(),
            ));
        }
        let decompressed = decompress_dsc(payload)?;
        let Some(kind) = classify_loaded_script(name, &decompressed) else {
            return Err(crate::SakuraError::InvalidScript(
                "dsc payload is not a loadable script".to_owned(),
            ));
        };
        match kind {
            LoadedScriptKind::Scenario => {
                ScenarioProgram::parse(&decompressed)?;
            }
            LoadedScriptKind::System => {
                SystemVm::parse(&decompressed)?;
            }
        }
        match kind {
            LoadedScriptKind::Scenario => self.scenario_scripts += 1,
            LoadedScriptKind::System => self.system_scripts += 1,
        }
        let id = ScriptId(self.scripts.len());
        if self.by_name.insert(name.to_vec(), id).is_some() {
            self.duplicate_scripts += 1;
        }
        self.scripts.push(LoadedScript { kind, decompressed });
        Ok(id)
    }

    pub fn find_by_name_bytes(&self, name: &[u8]) -> Option<ScriptId> {
        self.by_name.get(name).copied()
    }

    pub fn id_from_index(&self, index: usize) -> Option<ScriptId> {
        (index < self.scripts.len()).then_some(ScriptId(index))
    }

    pub fn script(&self, id: ScriptId) -> Option<&LoadedScript> {
        self.scripts.get(id.index())
    }

    pub fn name_by_id(&self, id: ScriptId) -> Option<&[u8]> {
        self.by_name
            .iter()
            .find_map(|(name, current)| (*current == id).then_some(name.as_slice()))
    }

    pub fn scenario_program(&self, id: ScriptId) -> Result<Option<ScenarioProgram<'_>>> {
        let Some(script) = self.script(id) else {
            return Ok(None);
        };
        if script.kind != LoadedScriptKind::Scenario {
            return Ok(None);
        }
        Ok(Some(ScenarioProgram::parse(&script.decompressed)?))
    }

    pub fn scenario_vm(&self, id: ScriptId) -> Result<Option<ScenarioVm<'_>>> {
        self.scenario_program(id)
            .map(|program| program.map(ScenarioVm::new))
    }

    pub fn system_vm(&self, id: ScriptId) -> Result<Option<SystemVm<'_>>> {
        let Some(script) = self.script(id) else {
            return Ok(None);
        };
        if script.kind != LoadedScriptKind::System {
            return Ok(None);
        }
        Ok(Some(SystemVm::parse(&script.decompressed)?))
    }

    pub fn script_count(&self) -> usize {
        self.scripts.len()
    }

    pub fn canonical_script_count(&self) -> usize {
        self.by_name.len()
    }

    pub fn scenario_script_count(&self) -> usize {
        self.scenario_scripts
    }

    pub fn system_script_count(&self) -> usize {
        self.system_scripts
    }

    pub fn duplicate_script_count(&self) -> usize {
        self.duplicate_scripts
    }
}

fn classify_loaded_script(name: &[u8], decompressed: &[u8]) -> Option<LoadedScriptKind> {
    if is_buriko_script_v1(decompressed) {
        return Some(LoadedScriptKind::Scenario);
    }
    let _ = name;
    Some(LoadedScriptKind::System)
}

pub fn classify_dsc_script(name: &[u8], decompressed: &[u8]) -> Option<LoadedScriptKind> {
    classify_loaded_script(name, decompressed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mounts_decompressed_system_script_by_name() -> Result<()> {
        let payload = build_synthetic_dsc(&synthetic_system_script());
        let archive_data = build_arc20(&[("script._bp", payload.as_slice())]);
        let archive = ArcArchive::parse(&archive_data)?;
        let mut library = ScriptLibrary::new();

        assert_eq!(library.mount_archive(&archive)?, 1);
        assert_eq!(library.script_count(), 1);
        assert_eq!(library.system_script_count(), 1);
        let id = library.find_by_name_bytes(b"script._bp").ok_or_else(|| {
            crate::SakuraError::InvalidArchive("synthetic script missing".to_owned())
        })?;
        let mut host = crate::SystemHost::new(&library);
        assert_eq!(
            host.event_result(&crate::SystemVmEvent::ServiceCall {
                family: crate::SystemCallFamily::System,
                service_id: 0x40,
                args: vec![crate::SystemValue::String(b"script._bp")],
            }),
            Some(crate::SystemHostResult::UserScriptHandle(id.index() as u32))
        );

        let mut vm = library.system_vm(id)?.ok_or_else(|| {
            crate::SakuraError::InvalidScript("synthetic system VM missing".to_owned())
        })?;

        assert!(matches!(
            vm.next_event()?,
            crate::SystemVmEvent::UserScriptCall { service_id: 0, .. }
        ));
        Ok(())
    }

    #[test]
    fn rejects_non_program_dsc_payloads() {
        let payload = build_synthetic_dsc(&synthetic_non_program_dsc());
        let mut library = ScriptLibrary::new();

        assert!(library.mount_dsc_payload(b"sse000000", &payload).is_err());
        assert_eq!(library.script_count(), 0);
        assert_eq!(library.system_script_count(), 0);
    }

    #[test]
    fn mounts_extensionless_system_script_when_vm_parses() -> Result<()> {
        let payload = build_synthetic_dsc(&synthetic_system_script());
        let mut library = ScriptLibrary::new();

        let id = library.mount_dsc_payload(b"sse000000", &payload)?;

        assert_eq!(id.index(), 0);
        assert_eq!(library.script_count(), 1);
        assert_eq!(library.system_script_count(), 1);
        assert_eq!(library.find_by_name_bytes(b"sse000000"), Some(id));
        assert!(library.system_vm(id)?.is_some());
        Ok(())
    }

    fn synthetic_system_script() -> Vec<u8> {
        let mut script = vec![0u8; 0x10];
        script.extend_from_slice(&[0xff, 0x00, 0x17]);
        script
    }

    fn synthetic_non_program_dsc() -> Vec<u8> {
        vec![0u8; 0x0f]
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
