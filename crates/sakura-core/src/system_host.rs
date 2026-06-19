use crate::archive::ArcName;
use crate::catalog::{ArchiveSummary, AssetCatalog, AssetRecord};
use crate::error::Result;
use crate::flagdb::{FlagDb, FlagError};
use crate::runtime::Runtime;
use crate::runtime_input::RuntimeInputState;
use crate::script_library::ScriptLibrary;
use crate::sniff::PayloadKind;
use crate::system_bytecode::SystemCallFamily;
use crate::system_vm::{SystemValue, SystemVm, SystemVmEvent};
use crate::system_vm_ops::system_value_integer;
use std::collections::BTreeMap;

const HOST_ALLOC_BASE: u32 = 0x2000_0000;

/// Logical name scrdrv passes to the System file-query services (0x30/0x31/0x34/0x35)
/// when it loads the strings database. In retail layouts this asset lives inside
/// `data01xxx.arc`; in the user's install it is the standalone `BGI.gdb` sidecar,
/// so the host resolves this name against `Runtime::strings_db` rather than the catalog.
const STRINGS_DB_QUERY_NAME: &[u8] = b"StringsDB";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct SystemHostRunSummary {
    pub event_count: usize,
    pub service_event_count: usize,
    pub user_call_event_count: usize,
    pub user_load_event_count: usize,
    pub user_free_event_count: usize,
    pub user_return_event_count: usize,
    pub halted_event_count: usize,
    pub completed: bool,
    pub event_limited: bool,
    pub last_event_kind: SystemHostEventKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SystemHostEventKind {
    #[default]
    None,
    Service,
    UserCall,
    UserLoad,
    UserFree,
    UserReturn,
    Halted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct SystemHostServiceState {
    pub service_count: usize,
    pub last_family: Option<SystemCallFamily>,
    pub last_service_id: u8,
    pub last_arg_count: usize,
    pub last_top_kind: u8,
    pub load_program_count: usize,
    pub file_query_count: usize,
    pub graph_format_count: usize,
    pub graph_render_text_count: usize,
    pub sound_play_count: usize,
    pub sound_service_count: usize,
    pub last_sound_service_id: u8,
    pub last_sound_arg_count: usize,
    pub last_sound_top_kind: u8,
    pub last_sound_integer_arg_count: usize,
    pub last_sound_min_integer_arg: u64,
    pub last_sound_max_integer_arg: u64,
    pub last_asset_string_len: usize,
    pub last_asset_string_hash: u64,
    pub last_asset_query_service_id: u8,
    pub last_asset_found: bool,
    pub last_loaded_script_string_len: usize,
    pub last_loaded_script_string_hash: u64,
    pub last_loaded_script_found: bool,
    pub sound_after_asset_query_count: usize,
    pub archive_descriptor_count: usize,
    pub archive_binding_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SystemAssetRequest {
    pub service_id: u8,
    pub name: Vec<u8>,
    pub size: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FileQueryTarget<'a> {
    Asset(&'a AssetRecord),
    Archive(&'a ArchiveSummary),
    StringsDb(&'a [u8]),
}

impl<'a> FileQueryTarget<'a> {
    fn name(self) -> &'a [u8] {
        match self {
            Self::Asset(record) => record.name().as_bytes(),
            Self::Archive(summary) => summary.name().map(ArcName::as_bytes).unwrap_or(&[]),
            Self::StringsDb(_) => STRINGS_DB_QUERY_NAME,
        }
    }

    fn size(self) -> u32 {
        match self {
            Self::Asset(record) => record.location().size,
            Self::Archive(summary) => summary.archive_len().min(u32::MAX as usize) as u32,
            Self::StringsDb(data) => data.len().min(u32::MAX as usize) as u32,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SystemHostResult {
    Integer(u64),
    UserScriptHandle(u32),
    UserScriptResult(u8),
    Unknown,
    Void,
    Effect(SystemHostEffect),
    ValueAndEffect {
        value: SystemHostValue,
        effect: SystemHostEffect,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SystemHostValue {
    Integer(u64),
    UserScriptHandle(u32),
    UserScriptResult(u8),
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SystemHostEffect {
    pub writes: Vec<SystemHostWrite>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SystemHostWrite {
    Integer(SystemHostIntegerWrite),
    LocalInteger(SystemHostLocalWrite),
    Bytes(SystemHostBytesWrite),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SystemHostBytesWrite {
    pub address: u32,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct SystemHostLocalWrite {
    pub address: u32,
    pub width: u8,
    pub value: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct SystemHostIntegerWrite {
    pub address: u32,
    pub width: u8,
    pub value: u64,
}

impl SystemHostResult {
    pub fn into_value<'a>(&self) -> Option<SystemValue<'a>> {
        self.value().map(SystemHostValue::into_value)
    }

    pub fn value(&self) -> Option<SystemHostValue> {
        match self {
            Self::Integer(value) => Some(SystemHostValue::Integer(*value)),
            Self::UserScriptHandle(handle) => Some(SystemHostValue::UserScriptHandle(*handle)),
            Self::UserScriptResult(service_id) => {
                Some(SystemHostValue::UserScriptResult(*service_id))
            }
            Self::Unknown => Some(SystemHostValue::Unknown),
            Self::Void | Self::Effect(_) => None,
            Self::ValueAndEffect { value, .. } => Some(*value),
        }
    }

    pub fn effect(&self) -> Option<&SystemHostEffect> {
        match self {
            Self::Effect(effect) | Self::ValueAndEffect { effect, .. } => Some(effect),
            _ => None,
        }
    }
}

impl SystemHostValue {
    pub fn into_value<'a>(self) -> SystemValue<'a> {
        match self {
            Self::Integer(value) => SystemValue::Integer(value),
            Self::UserScriptHandle(handle) => SystemValue::UserScriptHandle(handle),
            Self::UserScriptResult(service_id) => SystemValue::UserScriptResult(service_id),
            Self::Unknown => SystemValue::Unknown,
        }
    }
}

impl SystemHostEffect {
    pub fn new() -> Self {
        Self { writes: Vec::new() }
    }

    pub fn with_write(address: u32, width: u8, value: u64) -> Self {
        let mut effect = Self::new();
        effect.push_write(address, width, value);
        effect
    }

    pub fn push_write(&mut self, address: u32, width: u8, value: u64) {
        self.writes
            .push(SystemHostWrite::Integer(SystemHostIntegerWrite {
                address,
                width,
                value,
            }));
    }

    pub fn push_local_write(&mut self, address: u32, width: u8, value: u64) {
        self.writes
            .push(SystemHostWrite::LocalInteger(SystemHostLocalWrite {
                address,
                width,
                value,
            }));
    }

    pub fn push_bytes(&mut self, address: u32, bytes: &[u8]) {
        self.writes
            .push(SystemHostWrite::Bytes(SystemHostBytesWrite {
                address,
                bytes: bytes.to_vec(),
            }));
    }

    pub fn writes(&self) -> &[SystemHostWrite] {
        &self.writes
    }
}

pub fn default_system_event_result(event: &SystemVmEvent<'_>) -> Option<SystemHostResult> {
    match event {
        SystemVmEvent::ServiceCall {
            family, service_id, ..
        } => Some(default_service_result(*family, *service_id)),
        SystemVmEvent::LoadedProgramCall { .. } => Some(SystemHostResult::Void),
        SystemVmEvent::UserScriptCall { service_id, .. } => {
            Some(SystemHostResult::UserScriptResult(*service_id))
        }
        SystemVmEvent::UserScriptLoad => Some(SystemHostResult::UserScriptHandle(0)),
        SystemVmEvent::UserScriptFree { .. } => Some(SystemHostResult::Integer(1)),
        SystemVmEvent::UserScriptReturn | SystemVmEvent::Halted => None,
    }
}

pub fn default_service_result(family: SystemCallFamily, service_id: u8) -> SystemHostResult {
    match (family, service_id) {
        (SystemCallFamily::System, 0x01 | 0x02 | 0x04 | 0x05 | 0x0d | 0x11 | 0x21..=0x35) => {
            SystemHostResult::Integer(0)
        }
        (SystemCallFamily::System, 0x20) => SystemHostResult::Integer(HOST_ALLOC_BASE.into()),
        (SystemCallFamily::System, 0x40) => SystemHostResult::UserScriptHandle(0),
        _ => SystemHostResult::Void,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SystemHost<'a> {
    scripts: &'a ScriptLibrary,
    catalog: Option<&'a AssetCatalog>,
    runtime: Option<&'a Runtime>,
    input: RuntimeInputState,
    state: SystemHostServiceState,
    last_asset_name: Vec<u8>,
    asset_cache: BTreeMap<Vec<u8>, Vec<u8>>,
    next_alloc_address: u32,
    next_graph_handle: u32,
    graph_cursor: u32,
    graph_1f: Graph1fState,
    scrmain_init: ScrmainInitState,
    archive_bindings: BTreeMap<u32, ArchiveBindingState>,
    flags: FlagDb,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SystemHostSnapshot {
    pub state: SystemHostServiceState,
    pub last_asset_name: Vec<u8>,
    pub asset_cache: BTreeMap<Vec<u8>, Vec<u8>>,
    pub next_alloc_address: u32,
    pub next_graph_handle: u32,
    pub graph_cursor: u32,
    pub graph_1f: Graph1fState,
    pub scrmain_init: ScrmainInitState,
    pub archive_bindings: BTreeMap<u32, ArchiveBindingState>,
    pub flags: FlagDb,
}

impl<'a> SystemHost<'a> {
    pub fn new(scripts: &'a ScriptLibrary) -> Self {
        Self {
            scripts,
            catalog: None,
            runtime: None,
            input: RuntimeInputState::default(),
            state: SystemHostServiceState::default(),
            last_asset_name: Vec::new(),
            asset_cache: BTreeMap::new(),
            next_alloc_address: HOST_ALLOC_BASE,
            next_graph_handle: GRAPH_HANDLE_BASE,
            graph_cursor: 0,
            graph_1f: Graph1fState::default(),
            scrmain_init: ScrmainInitState::default(),
            archive_bindings: BTreeMap::new(),
            flags: FlagDb::new(),
        }
    }

    pub fn with_catalog(scripts: &'a ScriptLibrary, catalog: &'a AssetCatalog) -> Self {
        Self {
            scripts,
            catalog: Some(catalog),
            runtime: None,
            input: RuntimeInputState::default(),
            state: SystemHostServiceState::default(),
            last_asset_name: Vec::new(),
            asset_cache: BTreeMap::new(),
            next_alloc_address: HOST_ALLOC_BASE,
            next_graph_handle: GRAPH_HANDLE_BASE,
            graph_cursor: 0,
            graph_1f: Graph1fState::default(),
            scrmain_init: ScrmainInitState::default(),
            archive_bindings: BTreeMap::new(),
            flags: FlagDb::new(),
        }
    }

    pub fn with_runtime(runtime: &'a Runtime) -> Self {
        Self {
            scripts: runtime.scripts(),
            catalog: Some(runtime.catalog()),
            runtime: Some(runtime),
            input: runtime.input(),
            state: SystemHostServiceState::default(),
            last_asset_name: Vec::new(),
            asset_cache: BTreeMap::new(),
            next_alloc_address: HOST_ALLOC_BASE,
            next_graph_handle: GRAPH_HANDLE_BASE,
            graph_cursor: 0,
            graph_1f: Graph1fState::default(),
            scrmain_init: ScrmainInitState::default(),
            archive_bindings: BTreeMap::new(),
            flags: FlagDb::new(),
        }
    }

    pub fn state(&self) -> SystemHostServiceState {
        self.state
    }

    pub fn last_asset_name(&self) -> &[u8] {
        &self.last_asset_name
    }

    pub(crate) fn snapshot(&self) -> SystemHostSnapshot {
        SystemHostSnapshot {
            state: self.state,
            last_asset_name: self.last_asset_name.clone(),
            asset_cache: self.asset_cache.clone(),
            next_alloc_address: self.next_alloc_address,
            next_graph_handle: self.next_graph_handle,
            graph_cursor: self.graph_cursor,
            graph_1f: self.graph_1f,
            scrmain_init: self.scrmain_init,
            archive_bindings: self.archive_bindings.clone(),
            flags: self.flags.clone(),
        }
    }

    pub(crate) fn restore_with_runtime(runtime: &'a Runtime, snapshot: SystemHostSnapshot) -> Self {
        Self {
            scripts: runtime.scripts(),
            catalog: Some(runtime.catalog()),
            runtime: Some(runtime),
            input: runtime.input(),
            state: snapshot.state,
            last_asset_name: snapshot.last_asset_name,
            asset_cache: snapshot.asset_cache,
            next_alloc_address: snapshot.next_alloc_address,
            next_graph_handle: snapshot.next_graph_handle,
            graph_cursor: snapshot.graph_cursor,
            graph_1f: snapshot.graph_1f,
            scrmain_init: snapshot.scrmain_init,
            archive_bindings: snapshot.archive_bindings,
            flags: snapshot.flags,
        }
    }

    pub fn cache_asset_bytes(&mut self, name: &[u8], payload: Vec<u8>) {
        self.asset_cache.insert(name.to_vec(), payload);
    }

    pub fn asset_request(
        &self,
        service_id: u8,
        args: &[SystemValue<'_>],
    ) -> Option<SystemAssetRequest> {
        match service_id {
            0x30 | 0x31 => {
                let target = self.find_file_query_target(args)?;
                let name = target.name();
                if self.asset_cache.contains_key(name) || self.runtime_file_data(target).is_some() {
                    return None;
                }
                Some(SystemAssetRequest {
                    service_id,
                    name: name.to_vec(),
                    size: target.size(),
                })
            }
            0x40 => self.load_program_request(args),
            _ => None,
        }
    }

    pub fn event_result(&mut self, event: &SystemVmEvent<'_>) -> Option<SystemHostResult> {
        self.record_event(event);
        self.event_result_without_record(event)
    }

    pub(crate) fn record_service_event(&mut self, event: &SystemVmEvent<'_>) {
        self.record_event(event);
    }

    pub(crate) fn event_result_without_record(
        &mut self,
        event: &SystemVmEvent<'_>,
    ) -> Option<SystemHostResult> {
        match event {
            SystemVmEvent::ServiceCall {
                family: SystemCallFamily::System,
                service_id: 0x40,
                args,
            } => self
                .load_program_result(args)
                .or_else(|| default_system_event_result(event)),
            SystemVmEvent::ServiceCall {
                family: SystemCallFamily::System,
                service_id: service_id @ (0x30 | 0x31 | 0x34 | 0x35),
                args,
            } => self
                .file_service_result(*service_id, args)
                .or_else(|| default_system_event_result(event)),
            SystemVmEvent::ServiceCall {
                family: SystemCallFamily::System,
                service_id: 0x20,
                args,
            } => Some(self.alloc_result(args)),
            SystemVmEvent::ServiceCall {
                family: SystemCallFamily::System,
                service_id,
                args,
            } => self
                .system_service_result(*service_id, args)
                .or_else(|| default_system_event_result(event)),
            SystemVmEvent::ServiceCall {
                family: SystemCallFamily::Graph,
                service_id,
                args,
            } => self
                .graph_service_result(*service_id, args)
                .or_else(|| default_system_event_result(event)),
            _ => default_system_event_result(event),
        }
    }

    fn record_event(&mut self, event: &SystemVmEvent<'_>) {
        let SystemVmEvent::ServiceCall {
            family,
            service_id,
            args,
        } = event
        else {
            return;
        };
        self.state.service_count += 1;
        self.state.last_family = Some(*family);
        self.state.last_service_id = *service_id;
        self.state.last_arg_count = args.len();
        self.state.last_top_kind = args.last().map(system_value_kind_code).unwrap_or(0);
        match (*family, *service_id) {
            (SystemCallFamily::System, 0x40) => self.state.load_program_count += 1,
            (SystemCallFamily::System, 0x30 | 0x31 | 0x34 | 0x35) => {
                self.state.file_query_count += 1
            }
            (SystemCallFamily::Graph, 0x88) => self.state.graph_format_count += 1,
            (SystemCallFamily::Graph, 0x9c) => self.state.graph_render_text_count += 1,
            (SystemCallFamily::Sound, service_id) => {
                self.state.sound_service_count += 1;
                self.state.last_sound_service_id = service_id;
                self.state.last_sound_arg_count = args.len();
                self.state.last_sound_top_kind =
                    args.last().map(system_value_kind_code).unwrap_or(0);
                let bounds = integer_arg_bounds(args);
                self.state.last_sound_integer_arg_count = bounds.count;
                self.state.last_sound_min_integer_arg = bounds.min;
                self.state.last_sound_max_integer_arg = bounds.max;
                self.state.sound_play_count += 1;
                if self.state.last_asset_string_hash != 0 {
                    self.state.sound_after_asset_query_count += 1;
                }
            }
            _ => {}
        }
    }

    fn load_program_result(&mut self, args: &[SystemValue<'_>]) -> Option<SystemHostResult> {
        for value in args.iter().rev() {
            let Some(name) = value.string_bytes() else {
                continue;
            };
            self.record_script_string(name, false);
            let Some(id) = self.scripts.find_by_name_bytes(name) else {
                continue;
            };
            let Ok(handle) = u32::try_from(id.index()) else {
                return None;
            };
            self.record_script_string(name, true);
            return Some(SystemHostResult::UserScriptHandle(handle));
        }
        None
    }

    fn load_program_request(&self, args: &[SystemValue<'_>]) -> Option<SystemAssetRequest> {
        let mut fallback = None;
        for value in args.iter().rev() {
            let Some(name) = value.string_bytes() else {
                continue;
            };
            fallback.get_or_insert(name);
            if self.scripts.find_by_name_bytes(name).is_some() {
                return None;
            }
        }
        let name = fallback?;
        let record = self.catalog?.find_by_query_name_bytes(name)?;
        if !matches!(record.kind(), PayloadKind::Dsc | PayloadKind::Unknown) {
            return None;
        }
        Some(SystemAssetRequest {
            service_id: 0x40,
            name: record.name().as_bytes().to_vec(),
            size: record.location().size,
        })
    }

    fn file_service_result(
        &mut self,
        service_id: u8,
        args: &[SystemValue<'_>],
    ) -> Option<SystemHostResult> {
        self.record_asset_query(service_id, args);
        let target = self.find_file_query_target(args);
        match service_id {
            0x30 => Some(self.file_load_result(target, args)),
            0x31 => Some(self.file_section_load_result(target, args)),
            0x34 => Some(SystemHostResult::Integer(u64::from(target.is_some()))),
            0x35 => Some(SystemHostResult::Integer(
                target.map_or(0, |target| u64::from(target.size())),
            )),
            _ => None,
        }
    }

    fn file_load_result(
        &self,
        target: Option<FileQueryTarget<'a>>,
        args: &[SystemValue<'_>],
    ) -> SystemHostResult {
        let Some(target) = target else {
            return SystemHostResult::Integer(0);
        };
        let Some(buffer) = file_buffer_address_arg(args) else {
            return SystemHostResult::Integer(u64::from(target.size()));
        };
        let Some(data) = self.file_bytes(target) else {
            return SystemHostResult::Integer(u64::from(target.size()));
        };
        let mut effect = SystemHostEffect::new();
        effect.push_bytes(buffer, &data);
        SystemHostResult::ValueAndEffect {
            value: SystemHostValue::Integer(data.len().min(u32::MAX as usize) as u64),
            effect,
        }
    }

    fn file_section_load_result(
        &self,
        target: Option<FileQueryTarget<'a>>,
        args: &[SystemValue<'_>],
    ) -> SystemHostResult {
        let Some(target) = target else {
            return SystemHostResult::Integer(0);
        };
        let read = section_read(target.size(), args);
        let Some(buffer) = file_buffer_address_arg(args) else {
            return SystemHostResult::Integer(read.len as u64);
        };
        let Some(data) = self.file_bytes(target) else {
            return SystemHostResult::Integer(read.len as u64);
        };
        let end = read.offset.saturating_add(read.len).min(data.len());
        let bytes = data.get(read.offset..end).unwrap_or(&[]);
        let mut effect = SystemHostEffect::new();
        effect.push_bytes(buffer, bytes);
        SystemHostResult::ValueAndEffect {
            value: SystemHostValue::Integer(bytes.len().min(u32::MAX as usize) as u64),
            effect,
        }
    }

    fn file_bytes(&self, target: FileQueryTarget<'a>) -> Option<Vec<u8>> {
        let name = target.name();
        if let Some(bytes) = self.asset_cache.get(name) {
            return Some(bytes.clone());
        }
        self.runtime_file_data(target).map(Vec::from)
    }

    fn runtime_file_data(&self, target: FileQueryTarget<'a>) -> Option<&'a [u8]> {
        match target {
            FileQueryTarget::Asset(record) => self.runtime?.asset_data(record).ok(),
            FileQueryTarget::Archive(summary) => self
                .runtime?
                .archive_data_by_name(summary.name()?.as_bytes()),
            FileQueryTarget::StringsDb(data) => Some(data),
        }
    }

    fn find_file_query_target(&self, args: &[SystemValue<'_>]) -> Option<FileQueryTarget<'a>> {
        let catalog = self.catalog?;
        args.iter().rev().find_map(|value| {
            let name = value.string_bytes()?;
            self.strings_db_target(name)
                .or_else(|| {
                    catalog
                        .find_by_query_name_bytes(name)
                        .map(FileQueryTarget::Asset)
                })
                .or_else(|| {
                    catalog
                        .find_archive_by_query_name_bytes(name)
                        .map(FileQueryTarget::Archive)
                })
        })
    }

    /// Resolves scrdrv's `StringsDB` file query to the mounted strings-database
    /// sidecar. Without this the query would match the `data01xxx.arc` archive
    /// (the other argument scrdrv passes) and the load would hand back archive
    /// bytes, which scrdrv rejects as a corrupted strings database.
    fn strings_db_target(&self, name: &[u8]) -> Option<FileQueryTarget<'a>> {
        if !name.eq_ignore_ascii_case(STRINGS_DB_QUERY_NAME) {
            return None;
        }
        self.runtime?.strings_db().map(FileQueryTarget::StringsDb)
    }

    fn record_asset_query(&mut self, service_id: u8, args: &[SystemValue<'_>]) {
        let mut fallback = None;
        let mut matched = None;
        for value in args.iter().rev() {
            let Some(name) = value.string_bytes() else {
                continue;
            };
            fallback.get_or_insert(name);
            if self.catalog.is_some_and(|catalog| {
                catalog.find_by_query_name_bytes(name).is_some()
                    || catalog.find_archive_by_query_name_bytes(name).is_some()
            }) {
                matched = Some(name);
                break;
            }
        }
        let Some(name) = matched.or(fallback) else {
            return;
        };
        self.last_asset_name.clear();
        self.last_asset_name.extend_from_slice(name);
        self.state.last_asset_string_len = name.len();
        self.state.last_asset_string_hash = fnv1a64(name);
        self.state.last_asset_query_service_id = service_id;
        self.state.last_asset_found = matched.is_some();
    }

    fn record_script_string(&mut self, name: &[u8], found: bool) {
        self.state.last_loaded_script_string_len = name.len();
        self.state.last_loaded_script_string_hash = fnv1a64(name);
        self.state.last_loaded_script_found = found;
    }

    fn graph_service_result(
        &mut self,
        service_id: u8,
        args: &[SystemValue<'_>],
    ) -> Option<SystemHostResult> {
        match service_id {
            0x80 | 0xb8 => Some(SystemHostResult::Integer(u64::from(
                self.allocate_graph_handle(),
            ))),
            0xd7 => Some(self.graph_d7_result(args)),
            0xda => Some(self.graph_da_result(args)),
            0xdb => Some(self.graph_db_result()),
            0x1f => Some(self.graph_1f_result(args)),
            0xba | 0xbc | 0xbf => {
                graph_output_event_result(service_id, &mut self.graph_cursor, args)
            }
            _ => None,
        }
    }

    fn graph_1f_result(&mut self, args: &[SystemValue<'_>]) -> SystemHostResult {
        match classify_graph_1f_call(args) {
            Graph1fCall::IndexedSlot => {
                let slot = self.graph_1f.next_slot;
                self.graph_1f.next_slot = (self.graph_1f.next_slot + 1) % GRAPH_1F_SLOT_LIMIT;
                SystemHostResult::Integer(u64::from(slot))
            }
            Graph1fCall::ReadyQuery | Graph1fCall::ReadyChain | Graph1fCall::ReadyTable => {
                SystemHostResult::Integer(GRAPH_1F_READY_VALUE)
            }
            Graph1fCall::Unknown => SystemHostResult::Unknown,
        }
    }

    fn graph_db_result(&self) -> SystemHostResult {
        SystemHostResult::Integer(u64::from(
            self.input.pointer_button != 0 || self.input.click_count != 0,
        ))
    }

    fn graph_da_result(&self, args: &[SystemValue<'_>]) -> SystemHostResult {
        let value =
            graph_position_component(args, self.input.pointer_x, self.input.pointer_y).unwrap_or(0);
        SystemHostResult::Integer(u64::from(value))
    }

    fn graph_d7_result(&self, args: &[SystemValue<'_>]) -> SystemHostResult {
        let Some(pointer) = args.iter().find_map(system_value_local_address) else {
            return SystemHostResult::Integer(0);
        };
        let axis_value =
            graph_position_component(args, self.input.pointer_x, self.input.pointer_y).unwrap_or(0);
        let mut effect = SystemHostEffect::new();
        effect.push_local_write(pointer, 2, u64::from(axis_value));
        let other = if axis_prefers_x(args) {
            self.input.pointer_y
        } else {
            self.input.pointer_x
        };
        SystemHostResult::ValueAndEffect {
            value: SystemHostValue::Integer(u64::from(other)),
            effect,
        }
    }

    fn allocate_graph_handle(&mut self) -> u32 {
        let handle = self.next_graph_handle;
        self.next_graph_handle = self
            .next_graph_handle
            .saturating_add(1)
            .max(GRAPH_HANDLE_BASE);
        handle
    }

    fn alloc_result(&mut self, args: &[SystemValue<'_>]) -> SystemHostResult {
        let requested = args
            .iter()
            .rev()
            .find_map(system_value_integer)
            .and_then(|value| u32::try_from(value).ok())
            .unwrap_or(0);
        let aligned = requested.saturating_add(15) & !15;
        let address = self.next_alloc_address;
        self.next_alloc_address = self.next_alloc_address.saturating_add(aligned.max(16));
        SystemHostResult::Integer(u64::from(address))
    }

    fn system_service_result(
        &mut self,
        service_id: u8,
        args: &[SystemValue<'_>],
    ) -> Option<SystemHostResult> {
        match service_id {
            0x21 => Some(self.archive_query_result(args)),
            0x33 => Some(SystemHostResult::Void),
            0x88 => Some(self.cflag_ensure(args)),
            0x8a => Some(self.system_8a_result(args)),
            0x8b => Some(self.system_8b_result(args)),
            0xe9 => Some(self.archive_descriptor_result(args)),
            0x6a => Some(self.scrmain_init.service_6a(args)),
            0x5f => Some(SystemHostResult::Integer(1)),
            0x11 => Some(self.scrmain_init.service_11(args)),
            0x16 => Some(self.scrmain_init.service_16(args)),
            _ => None,
        }
    }

    fn system_8a_result(&mut self, args: &[SystemValue<'_>]) -> SystemHostResult {
        if flag_name_arg(args).is_some() {
            return self.cflag_setrange(args);
        }
        if self.scrmain_init.system_8b_seen && scrmain_event_ack_args(args) {
            return self.scrmain_init.service_8a(args);
        }
        self.cflag_setrange(args)
    }

    fn system_8b_result(&mut self, args: &[SystemValue<'_>]) -> SystemHostResult {
        if flag_name_arg(args).is_some() {
            return self.cflag_getbit(args);
        }
        if scrmain_event_poll_args(args) {
            return self.scrmain_init.service_8b(args);
        }
        self.cflag_getbit(args)
    }

    /// CFlag ensure (System 0x88, BGI sub_483A30 -> sub_4662A0 -> sub_444F10):
    /// pop bitcount, read name string, create/resize the named bit-array.
    /// Pushes BOOL success (the engine returns `sub_444F10(...) == 0`).
    fn cflag_ensure(&mut self, args: &[SystemValue<'_>]) -> SystemHostResult {
        let Some((si, name)) = flag_name_arg(args) else {
            return SystemHostResult::Integer(0);
        };
        let name = name.to_vec();
        let bitcount = nth_integer_arg(args, si + 1)
            .or_else(|| args.iter().filter_map(system_value_integer).last())
            .unwrap_or(0) as usize;
        self.flags.ensure(&name, bitcount);
        SystemHostResult::Integer(1)
    }

    /// CFlag set-range (System 0x8a, BGI sub_483AE0 -> sub_4662D0 -> sub_4450D0):
    /// pop count, value, start, read name; set/clear bits [start, start+count).
    /// Pushes the engine's mapped status (0 ok, 1 not-found, 2 oob, 3 bad-len).
    fn cflag_setrange(&mut self, args: &[SystemValue<'_>]) -> SystemHostResult {
        let Some((si, name)) = flag_name_arg(args) else {
            return SystemHostResult::Integer(1);
        };
        let name = name.to_vec();
        let start = nth_integer_arg(args, si + 1).unwrap_or(0) as usize;
        let value = nth_integer_arg(args, si + 2).unwrap_or(0) != 0;
        let count = nth_integer_arg(args, si + 3).unwrap_or(0) as usize;
        let status = match self.flags.set_range(&name, start, count, value) {
            Ok(()) => 0u64,
            Err(FlagError::NotFound) => 1,
            Err(FlagError::OutOfRange) => 2,
            Err(FlagError::BadLength) => 3,
        };
        SystemHostResult::Integer(status)
    }

    /// CFlag get-bit (System 0x8b, BGI sub_483BA0 -> sub_4662F0 -> sub_445170):
    /// pop bit, read name, pop out-pointer; write the bit value (DWORD) to
    /// `*out` and push the status (0 ok, 1 not-found, 2 oob).
    fn cflag_getbit(&mut self, args: &[SystemValue<'_>]) -> SystemHostResult {
        let Some((si, name)) = flag_name_arg(args) else {
            return SystemHostResult::Integer(1);
        };
        let name = name.to_vec();
        let bit = nth_integer_arg(args, si + 1).unwrap_or(0) as usize;
        let (status, value) = match self.flags.get_bit(&name, bit) {
            Ok(v) => (0u64, u64::from(v)),
            Err(FlagError::NotFound) => (1, 0),
            Err(FlagError::OutOfRange) => (2, 0),
            Err(FlagError::BadLength) => (3, 0),
        };
        let out_arg = si.checked_sub(1).and_then(|i| args.get(i));
        let mut effect = SystemHostEffect::new();
        if let Some(addr) = out_arg.and_then(system_value_local_address) {
            effect.push_local_write(addr, 2, value);
        } else if let Some(addr) = out_arg.and_then(system_value_integer) {
            effect.push_write(addr as u32, 2, value);
        }
        if effect.writes().is_empty() {
            SystemHostResult::Integer(status)
        } else {
            SystemHostResult::ValueAndEffect {
                value: SystemHostValue::Integer(status),
                effect,
            }
        }
    }

    fn archive_query_result(&mut self, args: &[SystemValue<'_>]) -> SystemHostResult {
        let base = nth_integer_arg(args, 0)
            .or_else(|| args.iter().find_map(system_value_integer))
            .unwrap_or(0) as u32;
        let out = nth_integer_arg(args, 1).unwrap_or(0) as u32;
        let archive_len = self.archive_len_for_base(base).unwrap_or(0);
        let entry_count = self.archive_entry_count_for_base(base).unwrap_or(0);
        let mut effect = SystemHostEffect::new();
        if out != 0 {
            effect.push_write(out, 2, u64::from(archive_len));
            effect.push_write(out.saturating_add(4), 2, u64::from(entry_count));
        }
        SystemHostResult::ValueAndEffect {
            value: SystemHostValue::Integer(0),
            effect,
        }
    }

    fn archive_descriptor_result(&mut self, args: &[SystemValue<'_>]) -> SystemHostResult {
        let integer_args: Vec<u64> = args.iter().filter_map(system_value_integer).collect();
        let archive_len = integer_args.first().copied().unwrap_or(0) as u32;
        let descriptor = args
            .iter()
            .rev()
            .find_map(system_value_local_address)
            .unwrap_or(0);
        let base = integer_args
            .iter()
            .copied()
            .find(|value| (*value as u32) >= 0x2000_0000)
            .unwrap_or(0) as u32;
        let key = integer_args
            .last()
            .copied()
            .unwrap_or(u64::from(archive_len)) as u32;
        let entry_count = self.archive_entry_count_for_base(base).unwrap_or(0);
        let state = ArchiveBindingState {
            base,
            archive_len,
            entry_count,
            key,
            descriptor,
        };
        if descriptor != 0 {
            self.archive_bindings.insert(descriptor, state);
        }
        self.state.archive_descriptor_count += 1;
        let mut effect = SystemHostEffect::new();
        if descriptor != 0 {
            effect.push_write(descriptor, 2, u64::from(base));
            effect.push_write(descriptor.saturating_add(4), 2, u64::from(archive_len));
            effect.push_write(descriptor.saturating_add(8), 2, u64::from(entry_count));
            effect.push_write(descriptor.saturating_add(12), 2, u64::from(key));
        }
        SystemHostResult::Effect(effect)
    }

    #[allow(dead_code)]
    fn archive_binding_result(&mut self, args: &[SystemValue<'_>]) -> SystemHostResult {
        let binding_index = args
            .iter()
            .rposition(|value| system_value_local_address(value).is_some());
        let binding = binding_index
            .and_then(|index| system_value_local_address(&args[index]))
            .unwrap_or(0);
        let key = args
            .iter()
            .rev()
            .filter_map(system_value_integer)
            .next()
            .unwrap_or(0) as u32;
        let ints_before_binding: Vec<u64> = binding_index
            .map(|index| {
                args[..index]
                    .iter()
                    .filter_map(system_value_integer)
                    .collect()
            })
            .unwrap_or_default();
        let flags = ints_before_binding.last().copied().unwrap_or(0) as u32;
        let binding_len = ints_before_binding
            .iter()
            .rev()
            .nth(1)
            .copied()
            .or_else(|| ints_before_binding.last().copied())
            .unwrap_or(0) as u32;
        let descriptor = self
            .archive_bindings
            .values()
            .find(|state| state.key == key)
            .copied();
        self.state.archive_binding_count += 1;
        let mut effect = SystemHostEffect::new();
        if binding != 0 {
            effect.push_write(binding, 2, u64::from(binding_len));
            effect.push_write(binding.saturating_add(4), 2, u64::from(flags));
            if let Some(descriptor) = descriptor {
                effect.push_write(binding.saturating_add(8), 2, u64::from(descriptor.base));
                effect.push_write(
                    binding.saturating_add(12),
                    2,
                    u64::from(descriptor.archive_len),
                );
                effect.push_write(
                    binding.saturating_add(16),
                    2,
                    u64::from(descriptor.entry_count),
                );
                effect.push_write(binding.saturating_add(20), 2, u64::from(descriptor.key));
            } else {
                effect.push_write(binding.saturating_add(20), 2, u64::from(key));
            }
        }
        SystemHostResult::Effect(effect)
    }

    fn archive_len_for_base(&self, base: u32) -> Option<u32> {
        let bytes = self.runtime_archive_bytes_for_base(base)?;
        u32::try_from(bytes.len()).ok()
    }

    fn archive_entry_count_for_base(&self, base: u32) -> Option<u32> {
        let bytes = self.runtime_archive_bytes_for_base(base)?;
        crate::archive::ArcArchive::parse(bytes)
            .ok()
            .and_then(|archive| u32::try_from(archive.entries().len()).ok())
    }

    fn runtime_archive_bytes_for_base(&self, base: u32) -> Option<&'a [u8]> {
        let name = self.last_asset_name();
        if name.is_empty() {
            return None;
        }
        let target = self.catalog?.find_archive_by_query_name_bytes(name)?;
        let bytes = self.runtime_file_data(FileQueryTarget::Archive(target))?;
        let archive_len = u32::try_from(bytes.len()).ok()?;
        (archive_len == 0 || base == 0 || base >= 0x2000_0000).then_some(bytes)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct ArchiveBindingState {
    base: u32,
    archive_len: u32,
    entry_count: u32,
    key: u32,
    descriptor: u32,
}

const GRAPH_HANDLE_BASE: u32 = 1;
const GRAPH_OUTPUT_EVENT_READY: u64 = 0x1000_0006;
const GRAPH_1F_READY_VALUE: u64 = 0x0001_0001;
const GRAPH_1F_SLOT_LIMIT: u32 = 14;
const HOST_LOCAL_MEM_SIZE: u32 = crate::system_vm_ops::ADDRESS_OFFSET_MASK + 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Graph1fState {
    next_slot: u32,
}

impl Default for Graph1fState {
    fn default() -> Self {
        Self { next_slot: 0 }
    }
}

#[allow(dead_code)]
const SCRMAIN_EVENT_READY_FLAG_ADDR: u32 = 603624;
#[allow(dead_code)]
const SCRMAIN_EVENT_PENDING_OFFSET_ADDR: u32 = 603628;
#[allow(dead_code)]
const SCRMAIN_EVENT_PENDING_SEQ_ADDR: u32 = 603632;
#[allow(dead_code)]
const SCRMAIN_EVENT_RECORD_LEN: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct ScrmainInitState {
    system_8b_seen: bool,
    next_seq: u32,
    pending_offset: u32,
    pending_seq: u32,
    last_ack_offset: u32,
}

impl ScrmainInitState {
    fn service_6a(&mut self, args: &[SystemValue<'_>]) -> SystemHostResult {
        let Some(pointer) = nth_integer_arg(args, args.len().saturating_sub(1)) else {
            return SystemHostResult::Integer(0);
        };
        let mut effect = SystemHostEffect::new();
        effect.push_write(pointer as u32, 2, 0);
        SystemHostResult::ValueAndEffect {
            value: SystemHostValue::Integer(0),
            effect,
        }
    }

    fn service_8b(&mut self, args: &[SystemValue<'_>]) -> SystemHostResult {
        self.system_8b_seen = true;
        let Some(buffer) = nth_integer_arg(args, 5) else {
            return SystemHostResult::Integer(1);
        };
        let offset = nth_integer_arg(args, 1).unwrap_or(0) as u32;
        let requested_seq = nth_integer_arg(args, 2).unwrap_or(0) as u32;
        let stride_offset = nth_integer_arg(args, 6).unwrap_or(u64::from(offset)) as u32;
        let seq = requested_seq.max(self.next_seq.saturating_add(1)).max(1);
        self.next_seq = seq;
        self.pending_offset = offset;
        self.pending_seq = seq;

        let mut record = [0u8; SCRMAIN_EVENT_RECORD_LEN];
        record[..4].copy_from_slice(&stride_offset.to_le_bytes());
        record[4..].copy_from_slice(&seq.to_le_bytes());

        let mut effect = SystemHostEffect::new();
        effect.push_write(SCRMAIN_EVENT_READY_FLAG_ADDR, 2, 1);
        effect.push_write(SCRMAIN_EVENT_PENDING_OFFSET_ADDR, 2, u64::from(offset));
        effect.push_write(SCRMAIN_EVENT_PENDING_SEQ_ADDR, 2, u64::from(seq));
        effect.push_bytes(buffer as u32, &record);
        if offset != 0 {
            effect.push_bytes(buffer as u32 + offset, &record);
        }
        effect.push_bytes(0x2000_0000u32.saturating_add(offset), &record);

        SystemHostResult::ValueAndEffect {
            value: SystemHostValue::Integer(1),
            effect,
        }
    }

    fn service_8a(&mut self, args: &[SystemValue<'_>]) -> SystemHostResult {
        let Some(buffer) = nth_integer_arg(args, 1) else {
            return SystemHostResult::Integer(0);
        };
        let offset = nth_integer_arg(args, 2).unwrap_or(0) as u32;
        self.last_ack_offset = offset;

        let mut effect = SystemHostEffect::new();
        effect.push_write(SCRMAIN_EVENT_READY_FLAG_ADDR, 2, 0);
        effect.push_write(SCRMAIN_EVENT_PENDING_OFFSET_ADDR, 2, 0);
        effect.push_write(SCRMAIN_EVENT_PENDING_SEQ_ADDR, 2, 0);
        let _ = buffer;
        let _ = offset;

        SystemHostResult::ValueAndEffect {
            value: SystemHostValue::Integer(0),
            effect,
        }
    }

    #[allow(dead_code)]
    fn service_5f(&mut self, _args: &[SystemValue<'_>]) -> SystemHostResult {
        if self.pending_seq == 0 && self.pending_offset == 0 {
            return SystemHostResult::Integer(0);
        }

        let pending_offset = self.pending_offset;
        self.last_ack_offset = pending_offset;
        self.pending_offset = 0;
        self.pending_seq = 0;

        let mut effect = SystemHostEffect::new();
        effect.push_write(SCRMAIN_EVENT_READY_FLAG_ADDR, 2, 0);
        effect.push_write(SCRMAIN_EVENT_PENDING_OFFSET_ADDR, 2, 0);
        effect.push_write(SCRMAIN_EVENT_PENDING_SEQ_ADDR, 2, 0);
        SystemHostResult::ValueAndEffect {
            value: SystemHostValue::Integer(0),
            effect,
        }
    }

    fn service_11(&mut self, _args: &[SystemValue<'_>]) -> SystemHostResult {
        SystemHostResult::Integer(0)
    }

    fn service_16(&mut self, _args: &[SystemValue<'_>]) -> SystemHostResult {
        SystemHostResult::Integer(0)
    }
}

/// Finds the flag-name string operand and its index within the arg slice
/// (there is exactly one string arg in the CFlag services).
fn flag_name_arg<'b>(args: &'b [SystemValue<'_>]) -> Option<(usize, &'b [u8])> {
    args.iter()
        .enumerate()
        .rev()
        .find_map(|(i, value)| value.string_bytes().map(|bytes| (i, bytes)))
}

fn scrmain_event_poll_args(args: &[SystemValue<'_>]) -> bool {
    args.len() >= 7 && flag_name_arg(args).is_none() && integer_arg_bounds(args).count >= 7
}

fn scrmain_event_ack_args(args: &[SystemValue<'_>]) -> bool {
    args.len() >= 3 && flag_name_arg(args).is_none() && integer_arg_bounds(args).count >= 3
}

fn nth_integer_arg(args: &[SystemValue<'_>], index: usize) -> Option<u64> {
    args.get(index).and_then(system_value_integer)
}

#[allow(dead_code)]
fn nth_local_address_arg(args: &[SystemValue<'_>], index: usize) -> Option<u32> {
    args.get(index).and_then(system_value_local_address)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Graph1fCall {
    IndexedSlot,
    ReadyQuery,
    ReadyChain,
    ReadyTable,
    Unknown,
}

fn classify_graph_1f_call(args: &[SystemValue<'_>]) -> Graph1fCall {
    if args.len() == 6 {
        return Graph1fCall::IndexedSlot;
    }
    if args.len() >= 15 {
        return Graph1fCall::ReadyTable;
    }
    if args.len() == 3
        && system_value_integer(&args[0]) == Some(GRAPH_1F_READY_VALUE)
        && args[1..]
            .iter()
            .all(|value| system_value_local_address(value).is_some())
    {
        return Graph1fCall::ReadyChain;
    }
    if args.len() == 2
        && args
            .iter()
            .all(|value| system_value_local_address(value).is_some())
    {
        return Graph1fCall::ReadyQuery;
    }
    Graph1fCall::Unknown
}

fn graph_output_event_result(
    service_id: u8,
    graph_cursor: &mut u32,
    args: &[SystemValue<'_>],
) -> Option<SystemHostResult> {
    let output = args
        .first()
        .and_then(system_value_local_address)
        .or_else(|| args.iter().find_map(system_value_local_address))?;
    let event_code = graph_output_event_code(service_id, *graph_cursor);
    *graph_cursor = graph_cursor.saturating_add(1);
    let mut effect = SystemHostEffect::new();
    effect.push_local_write(output, 2, event_code);
    effect.push_local_write(output.saturating_add(4), 2, 0);
    Some(SystemHostResult::Effect(effect))
}

fn graph_output_event_code(service_id: u8, graph_cursor: u32) -> u64 {
    match service_id {
        0xbf => GRAPH_OUTPUT_EVENT_READY,
        0xba if graph_cursor == 0 => GRAPH_OUTPUT_EVENT_READY,
        _ => 0,
    }
}

fn system_value_local_address(value: &SystemValue<'_>) -> Option<u32> {
    match value {
        SystemValue::VariablePointer(address) => {
            Some(*address & crate::system_vm_ops::ADDRESS_OFFSET_MASK)
                .filter(|address| *address < HOST_LOCAL_MEM_SIZE)
        }
        SystemValue::LocalStringPointer { address, .. } => {
            Some(*address).filter(|address| *address < HOST_LOCAL_MEM_SIZE)
        }
        SystemValue::Integer(value) => {
            let value = *value as u32;
            let address = value & crate::system_vm_ops::ADDRESS_OFFSET_MASK;
            match value & !crate::system_vm_ops::ADDRESS_OFFSET_MASK {
                crate::system_vm_ops::LOCAL_ADDRESS_BASE
                | crate::system_vm_ops::LOCAL_ADDRESS_ALT_BASE => {
                    (address < HOST_LOCAL_MEM_SIZE).then_some(address)
                }
                _ => None,
            }
        }
        _ => None,
    }
}

fn first_memory_address_arg(args: &[SystemValue<'_>]) -> Option<u32> {
    args.iter().find_map(memory_address_arg)
}

fn file_buffer_address_arg(args: &[SystemValue<'_>]) -> Option<u32> {
    let first_string = args
        .iter()
        .position(|value| value.string_bytes().is_some())
        .unwrap_or(args.len());
    args[..first_string]
        .iter()
        .rev()
        .find_map(memory_address_arg)
        .or_else(|| first_memory_address_arg(args))
}

fn axis_prefers_x(args: &[SystemValue<'_>]) -> bool {
    let ints: Vec<u64> = args.iter().filter_map(system_value_integer).collect();
    if ints.iter().any(|value| *value == 1224 || *value == 1280) {
        return true;
    }
    if ints.iter().any(|value| *value == 1408 || *value == 720) {
        return false;
    }
    true
}

fn graph_position_component(args: &[SystemValue<'_>], x: u32, y: u32) -> Option<u32> {
    if args.is_empty() {
        return None;
    }
    Some(if axis_prefers_x(args) { x } else { y })
}

fn memory_address_arg(value: &SystemValue<'_>) -> Option<u32> {
    match value {
        SystemValue::VariablePointer(address) => {
            Some(*address & crate::system_vm_ops::ADDRESS_OFFSET_MASK)
        }
        SystemValue::LocalStringPointer { address, .. } => Some(*address),
        SystemValue::Integer(value) => Some(*value as u32).filter(|value| *value != 0),
        _ => None,
    }
}

struct SectionRead {
    offset: usize,
    len: usize,
}

fn section_read(size: u32, args: &[SystemValue<'_>]) -> SectionRead {
    let mut integers = args.iter().filter_map(system_value_integer);
    let Some(_buffer) = integers.next() else {
        return SectionRead {
            offset: 0,
            len: size as usize,
        };
    };
    let requested = integers.next_back().unwrap_or(u64::from(size)) as usize;
    let offset = integers.next_back().unwrap_or(0);
    let size = size as usize;
    let offset = (offset as usize).min(size);
    SectionRead {
        offset,
        len: requested.min(size.saturating_sub(offset)),
    }
}

pub fn run_system_vm_with_default_host(
    vm: &mut SystemVm<'_>,
    max_events: usize,
    max_instructions_per_event: usize,
) -> Result<SystemHostRunSummary> {
    run_system_vm_with_event_result(vm, max_events, max_instructions_per_event, |event| {
        default_system_event_result(event)
    })
}

pub fn run_system_vm_with_host(
    vm: &mut SystemVm<'_>,
    host: &mut SystemHost<'_>,
    max_events: usize,
    max_instructions_per_event: usize,
) -> Result<SystemHostRunSummary> {
    run_system_vm_with_event_result(vm, max_events, max_instructions_per_event, |event| {
        host.event_result(event)
    })
}

fn system_value_kind_code(value: &SystemValue<'_>) -> u8 {
    match value {
        SystemValue::Integer(_) => 1,
        SystemValue::String(_)
        | SystemValue::OwnedString(_)
        | SystemValue::LocalStringPointer { .. } => 2,
        SystemValue::Code(_) | SystemValue::CodeInScript { .. } => 3,
        SystemValue::UserScriptHandle(_) => 4,
        SystemValue::UserScriptResult(_) => 5,
        SystemValue::VariablePointer(_) => 6,
        SystemValue::Unknown => 7,
    }
}

struct IntegerArgBounds {
    count: usize,
    min: u64,
    max: u64,
}

fn integer_arg_bounds(args: &[SystemValue<'_>]) -> IntegerArgBounds {
    let mut count = 0usize;
    let mut min = u64::MAX;
    let mut max = 0u64;
    for value in args.iter().filter_map(system_value_integer) {
        count += 1;
        min = min.min(value);
        max = max.max(value);
    }
    if count == 0 {
        min = 0;
    }
    IntegerArgBounds { count, min, max }
}

fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

fn run_system_vm_with_event_result<F>(
    vm: &mut SystemVm<'_>,
    max_events: usize,
    max_instructions_per_event: usize,
    mut event_result: F,
) -> Result<SystemHostRunSummary>
where
    F: FnMut(&SystemVmEvent<'_>) -> Option<SystemHostResult>,
{
    let mut summary = SystemHostRunSummary::default();
    loop {
        if summary.event_count == max_events {
            summary.event_limited = true;
            break;
        }
        let event = vm.next_event_with_limit(max_instructions_per_event)?;
        summary.event_count += 1;
        match &event {
            SystemVmEvent::ServiceCall { .. } => {
                summary.service_event_count += 1;
                summary.last_event_kind = SystemHostEventKind::Service;
            }
            SystemVmEvent::LoadedProgramCall { .. } => {
                summary.user_call_event_count += 1;
                summary.last_event_kind = SystemHostEventKind::UserCall;
            }
            SystemVmEvent::UserScriptCall { .. } => {
                summary.user_call_event_count += 1;
                summary.last_event_kind = SystemHostEventKind::UserCall;
            }
            SystemVmEvent::UserScriptLoad => {
                summary.user_load_event_count += 1;
                summary.last_event_kind = SystemHostEventKind::UserLoad;
            }
            SystemVmEvent::UserScriptFree { .. } => {
                summary.user_free_event_count += 1;
                summary.last_event_kind = SystemHostEventKind::UserFree;
            }
            SystemVmEvent::UserScriptReturn => {
                summary.user_return_event_count += 1;
                summary.last_event_kind = SystemHostEventKind::UserReturn;
            }
            SystemVmEvent::Halted => {
                summary.halted_event_count += 1;
                summary.last_event_kind = SystemHostEventKind::Halted;
                summary.completed = true;
                break;
            }
        }
        let Some(result) = event_result(&event) else {
            summary.completed = true;
            break;
        };
        if let Some(effect) = result.effect() {
            apply_host_effect(vm, effect)?;
        }
        if let Some(value) = result.into_value() {
            vm.resume_with(value)?;
        }
    }
    Ok(summary)
}

fn apply_host_effect(vm: &mut SystemVm<'_>, effect: &SystemHostEffect) -> Result<()> {
    for write in effect.writes() {
        vm.apply_host_write(write)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::archive::ArcArchive;
    use crate::system_vm::SystemVmEvent;

    #[test]
    fn returns_handle_for_program_load_events() {
        assert_eq!(
            default_service_result(SystemCallFamily::System, 0x20),
            SystemHostResult::Integer(HOST_ALLOC_BASE.into())
        );
        assert_eq!(
            default_system_event_result(&SystemVmEvent::UserScriptLoad),
            Some(SystemHostResult::UserScriptHandle(0))
        );
        assert_eq!(
            default_service_result(SystemCallFamily::System, 0x40),
            SystemHostResult::UserScriptHandle(0)
        );
        assert_eq!(
            default_service_result(SystemCallFamily::Graph, 0x88),
            SystemHostResult::Void
        );
    }

    #[test]
    fn preserves_user_script_dispatch_result_identity() {
        assert_eq!(
            default_system_event_result(&SystemVmEvent::UserScriptCall {
                service_id: 0x3f,
                args: Vec::new(),
            }),
            Some(SystemHostResult::UserScriptResult(0x3f))
        );
    }

    #[test]
    fn treats_terminal_events_as_not_resumable() {
        assert_eq!(default_system_event_result(&SystemVmEvent::Halted), None);
        assert_eq!(
            default_system_event_result(&SystemVmEvent::UserScriptReturn),
            None
        );
    }

    #[test]
    fn system_5f_returns_observed_ready_value() {
        let scripts = ScriptLibrary::new();
        let mut host = SystemHost::new(&scripts);

        assert_eq!(
            host.event_result(&SystemVmEvent::ServiceCall {
                family: SystemCallFamily::System,
                service_id: 0x5f,
                args: Vec::new(),
            }),
            Some(SystemHostResult::Integer(1))
        );
    }

    #[test]
    fn system_8b_preserves_cflag_getbit_for_string_shape() {
        let scripts = ScriptLibrary::new();
        let mut host = SystemHost::new(&scripts);

        assert_eq!(
            host.event_result(&SystemVmEvent::ServiceCall {
                family: SystemCallFamily::System,
                service_id: 0x88,
                args: vec![SystemValue::String(b"flag"), SystemValue::Integer(8)],
            }),
            Some(SystemHostResult::Integer(1))
        );
        assert_eq!(
            host.event_result(&SystemVmEvent::ServiceCall {
                family: SystemCallFamily::System,
                service_id: 0x8a,
                args: vec![
                    SystemValue::String(b"flag"),
                    SystemValue::Integer(2),
                    SystemValue::Integer(1),
                    SystemValue::Integer(1),
                ],
            }),
            Some(SystemHostResult::Integer(0))
        );

        assert_eq!(
            host.event_result(&SystemVmEvent::ServiceCall {
                family: SystemCallFamily::System,
                service_id: 0x8b,
                args: vec![
                    SystemValue::VariablePointer(0x20),
                    SystemValue::String(b"flag"),
                    SystemValue::Integer(2),
                ],
            }),
            Some(SystemHostResult::ValueAndEffect {
                value: SystemHostValue::Integer(0),
                effect: SystemHostEffect {
                    writes: vec![SystemHostWrite::LocalInteger(SystemHostLocalWrite {
                        address: 0x20,
                        width: 2,
                        value: 1,
                    })],
                },
            })
        );
    }

    #[test]
    fn system_8b_routes_integer_scrmain_shape_to_event_init() {
        let scripts = ScriptLibrary::new();
        let mut host = SystemHost::new(&scripts);
        let record = vec![8, 0, 0, 0, 1, 0, 0, 0];

        assert_eq!(
            host.event_result(&SystemVmEvent::ServiceCall {
                family: SystemCallFamily::System,
                service_id: 0x8b,
                args: vec![
                    SystemValue::Integer(1),
                    SystemValue::Integer(4),
                    SystemValue::Integer(0),
                    SystemValue::Integer(0),
                    SystemValue::Integer(0),
                    SystemValue::Integer(0x584),
                    SystemValue::Integer(8),
                ],
            }),
            Some(SystemHostResult::ValueAndEffect {
                value: SystemHostValue::Integer(1),
                effect: SystemHostEffect {
                    writes: vec![
                        SystemHostWrite::Integer(SystemHostIntegerWrite {
                            address: SCRMAIN_EVENT_READY_FLAG_ADDR,
                            width: 2,
                            value: 1,
                        }),
                        SystemHostWrite::Integer(SystemHostIntegerWrite {
                            address: SCRMAIN_EVENT_PENDING_OFFSET_ADDR,
                            width: 2,
                            value: 4,
                        }),
                        SystemHostWrite::Integer(SystemHostIntegerWrite {
                            address: SCRMAIN_EVENT_PENDING_SEQ_ADDR,
                            width: 2,
                            value: 1,
                        }),
                        SystemHostWrite::Bytes(SystemHostBytesWrite {
                            address: 0x584,
                            bytes: record.clone(),
                        }),
                        SystemHostWrite::Bytes(SystemHostBytesWrite {
                            address: 0x588,
                            bytes: record.clone(),
                        }),
                        SystemHostWrite::Bytes(SystemHostBytesWrite {
                            address: 0x2000_0004,
                            bytes: record,
                        }),
                    ],
                },
            })
        );

        assert_eq!(
            host.event_result(&SystemVmEvent::ServiceCall {
                family: SystemCallFamily::System,
                service_id: 0x8a,
                args: vec![
                    SystemValue::Integer(0),
                    SystemValue::Integer(0x584),
                    SystemValue::Integer(4),
                ],
            }),
            Some(SystemHostResult::ValueAndEffect {
                value: SystemHostValue::Integer(0),
                effect: SystemHostEffect {
                    writes: vec![
                        SystemHostWrite::Integer(SystemHostIntegerWrite {
                            address: SCRMAIN_EVENT_READY_FLAG_ADDR,
                            width: 2,
                            value: 0,
                        }),
                        SystemHostWrite::Integer(SystemHostIntegerWrite {
                            address: SCRMAIN_EVENT_PENDING_OFFSET_ADDR,
                            width: 2,
                            value: 0,
                        }),
                        SystemHostWrite::Integer(SystemHostIntegerWrite {
                            address: SCRMAIN_EVENT_PENDING_SEQ_ADDR,
                            width: 2,
                            value: 0,
                        }),
                    ],
                },
            })
        );
    }

    #[test]
    fn runs_vm_until_event_limit_with_default_host() -> crate::Result<()> {
        let mut script = vec![0u8; 0x10];
        script.extend_from_slice(&[0xff, 0x00, 0xff, 0x00, 0xff, 0x00, 0x17]);
        let mut vm = SystemVm::parse(&script)?;

        let summary = run_system_vm_with_default_host(&mut vm, 2, 16)?;

        assert_eq!(summary.event_count, 2);
        assert_eq!(summary.user_call_event_count, 2);
        assert!(summary.event_limited);
        assert!(!summary.completed);
        assert_eq!(summary.last_event_kind, SystemHostEventKind::UserCall);
        Ok(())
    }

    #[test]
    fn graph_db_requires_pressed_button_or_click_edge() {
        let mut runtime = Runtime::new(crate::RuntimeConfig::default());
        runtime.set_input(RuntimeInputState {
            click_count: 0,
            key_press_count: 0,
            pointer_x: 12,
            pointer_y: 34,
            pointer_button: 0,
            pointer_valid: true,
            key_enter_down: false,
            key_space_down: false,
            key_up_down: false,
            key_down_down: false,
            key_left_down: false,
            key_right_down: false,
        });
        let mut host = SystemHost::with_runtime(&runtime);
        let event = SystemVmEvent::ServiceCall {
            family: SystemCallFamily::Graph,
            service_id: 0xdb,
            args: Vec::new(),
        };
        assert_eq!(
            host.event_result(&event),
            Some(SystemHostResult::Integer(0))
        );

        runtime.set_input(RuntimeInputState {
            click_count: 1,
            ..runtime.input()
        });
        host = SystemHost::with_runtime(&runtime);
        assert_eq!(
            host.event_result(&event),
            Some(SystemHostResult::Integer(1))
        );

        runtime.set_input(RuntimeInputState {
            click_count: 0,
            pointer_button: 1,
            ..runtime.input()
        });
        host = SystemHost::with_runtime(&runtime);
        assert_eq!(
            host.event_result(&event),
            Some(SystemHostResult::Integer(1))
        );
    }

    #[test]
    fn system_6a_clears_status_slot_and_returns_zero() {
        let scripts = ScriptLibrary::new();
        let mut host = SystemHost::new(&scripts);
        let args = vec![
            SystemValue::Integer(0x14),
            SystemValue::Integer(0x2000_0014),
            SystemValue::Integer(0x14),
            SystemValue::Integer(0x18),
            SystemValue::Integer(0),
            SystemValue::Integer(0x14),
            SystemValue::Integer(0x29a6c),
            SystemValue::Integer(1),
            SystemValue::Integer(0x2000_0014),
            SystemValue::VariablePointer(28),
        ];

        let result = host.event_result(&SystemVmEvent::ServiceCall {
            family: SystemCallFamily::System,
            service_id: 0x6a,
            args,
        });

        assert_eq!(
            result,
            Some(SystemHostResult::ValueAndEffect {
                value: SystemHostValue::Integer(0),
                effect: SystemHostEffect::with_write(0x1200_001c, 2, 0),
            })
        );
    }

    #[test]
    fn catalog_file_services_return_asset_presence_and_sizes() -> crate::Result<()> {
        let archive_data = build_arc20(&[("payload", b"abcdef")]);
        let archive = ArcArchive::parse(&archive_data)?;
        let mut catalog = AssetCatalog::new();
        catalog.mount_archive(&archive)?;
        let scripts = ScriptLibrary::new();
        let mut host = SystemHost::with_catalog(&scripts, &catalog);
        let file_args = vec![
            SystemValue::String(b"archive"),
            SystemValue::String(b"payload"),
        ];

        assert_eq!(
            host.event_result(&SystemVmEvent::ServiceCall {
                family: SystemCallFamily::System,
                service_id: 0x34,
                args: file_args.clone(),
            }),
            Some(SystemHostResult::Integer(1))
        );
        assert_eq!(
            host.event_result(&SystemVmEvent::ServiceCall {
                family: SystemCallFamily::System,
                service_id: 0x35,
                args: file_args.clone(),
            }),
            Some(SystemHostResult::Integer(6))
        );
        assert_eq!(
            host.event_result(&SystemVmEvent::ServiceCall {
                family: SystemCallFamily::System,
                service_id: 0x30,
                args: file_args,
            }),
            Some(SystemHostResult::Integer(6))
        );
        Ok(())
    }

    #[test]
    fn catalog_section_load_clamps_to_asset_bounds() -> crate::Result<()> {
        let archive_data = build_arc20(&[("payload", b"abcdef")]);
        let archive = ArcArchive::parse(&archive_data)?;
        let mut catalog = AssetCatalog::new();
        catalog.mount_archive(&archive)?;
        let scripts = ScriptLibrary::new();
        let mut host = SystemHost::with_catalog(&scripts, &catalog);

        assert_eq!(
            host.event_result(&SystemVmEvent::ServiceCall {
                family: SystemCallFamily::System,
                service_id: 0x31,
                args: vec![
                    SystemValue::Integer(0x2000),
                    SystemValue::String(b"archive"),
                    SystemValue::String(b"payload"),
                    SystemValue::Integer(2),
                    SystemValue::Integer(3),
                ],
            }),
            Some(SystemHostResult::Integer(3))
        );
        assert_eq!(
            host.event_result(&SystemVmEvent::ServiceCall {
                family: SystemCallFamily::System,
                service_id: 0x31,
                args: vec![
                    SystemValue::Integer(0x2000),
                    SystemValue::String(b"archive"),
                    SystemValue::String(b"payload"),
                    SystemValue::Integer(4),
                    SystemValue::Integer(9),
                ],
            }),
            Some(SystemHostResult::Integer(2))
        );
        Ok(())
    }

    #[test]
    fn runtime_file_services_resolve_archive_file_names() -> crate::Result<()> {
        let archive_data = build_arc20(&[("payload", b"abcdef")]);
        let mut runtime = Runtime::new(crate::RuntimeConfig::default());
        runtime.mount_archive_data_named(archive_data.clone(), Some(b"named.arc"))?;
        let mut host = SystemHost::with_runtime(&runtime);
        let args = vec![SystemValue::String(b"named.arc")];

        assert_eq!(
            host.event_result(&SystemVmEvent::ServiceCall {
                family: SystemCallFamily::System,
                service_id: 0x34,
                args: args.clone(),
            }),
            Some(SystemHostResult::Integer(1))
        );
        assert_eq!(
            host.event_result(&SystemVmEvent::ServiceCall {
                family: SystemCallFamily::System,
                service_id: 0x35,
                args: args.clone(),
            }),
            Some(SystemHostResult::Integer(archive_data.len() as u64))
        );
        assert_eq!(
            host.event_result(&SystemVmEvent::ServiceCall {
                family: SystemCallFamily::System,
                service_id: 0x30,
                args: args.clone(),
            }),
            Some(SystemHostResult::Integer(archive_data.len() as u64))
        );

        let load = host.event_result(&SystemVmEvent::ServiceCall {
            family: SystemCallFamily::System,
            service_id: 0x30,
            args: vec![
                SystemValue::Integer(0x2000),
                SystemValue::String(b"named.arc"),
            ],
        });
        assert_eq!(
            load,
            Some(SystemHostResult::ValueAndEffect {
                value: SystemHostValue::Integer(archive_data.len() as u64),
                effect: SystemHostEffect {
                    writes: vec![SystemHostWrite::Bytes(SystemHostBytesWrite {
                        address: 0x2000,
                        bytes: archive_data.clone(),
                    })],
                },
            })
        );

        let section = host.event_result(&SystemVmEvent::ServiceCall {
            family: SystemCallFamily::System,
            service_id: 0x31,
            args: vec![
                SystemValue::Integer(0x2000),
                SystemValue::String(b"named.arc"),
                SystemValue::Integer(2),
                SystemValue::Integer(4),
            ],
        });
        assert_eq!(
            section,
            Some(SystemHostResult::ValueAndEffect {
                value: SystemHostValue::Integer(4),
                effect: SystemHostEffect {
                    writes: vec![SystemHostWrite::Bytes(SystemHostBytesWrite {
                        address: 0x2000,
                        bytes: archive_data[2..6].to_vec(),
                    })],
                },
            })
        );
        Ok(())
    }

    #[test]
    fn runtime_file_services_match_archive_placeholder_names() -> crate::Result<()> {
        let archive_data = build_arc20(&[("payload", b"abcdef")]);
        let mut runtime = Runtime::new(crate::RuntimeConfig::default());
        runtime.mount_archive_data_named(archive_data, Some(b"data01099.arc"))?;
        let mut host = SystemHost::with_runtime(&runtime);

        assert_eq!(
            host.event_result(&SystemVmEvent::ServiceCall {
                family: SystemCallFamily::System,
                service_id: 0x34,
                args: vec![SystemValue::String(b"data01xxx.arc")],
            }),
            Some(SystemHostResult::Integer(1))
        );
        Ok(())
    }

    #[test]
    fn runtime_manifest_only_archive_requests_pending_bytes() -> crate::Result<()> {
        let archive_data = build_arc20(&[("payload", b"abcdef")]);
        let archive = ArcArchive::parse(&archive_data)?;
        let index = crate::ArcIndex::parse_prefix(
            &archive_data[..archive.index().data_start()],
            archive_data.len(),
        )?;
        let mut runtime = Runtime::new(crate::RuntimeConfig::default());
        runtime.mount_archive_index_named(index, Some(b"data01099.arc"))?;
        let mut host = SystemHost::with_runtime(&runtime);
        let args = vec![
            SystemValue::Integer(0x2000_0000),
            SystemValue::String(b"data01xxx.arc"),
        ];

        assert_eq!(
            host.event_result(&SystemVmEvent::ServiceCall {
                family: SystemCallFamily::System,
                service_id: 0x34,
                args: vec![SystemValue::String(b"data01xxx.arc")],
            }),
            Some(SystemHostResult::Integer(1))
        );
        assert_eq!(
            host.event_result(&SystemVmEvent::ServiceCall {
                family: SystemCallFamily::System,
                service_id: 0x35,
                args: vec![SystemValue::String(b"data01xxx.arc")],
            }),
            Some(SystemHostResult::Integer(archive_data.len() as u64))
        );
        let pending = host.asset_request(0x30, &args);
        assert_eq!(
            pending,
            Some(SystemAssetRequest {
                service_id: 0x30,
                name: b"data01099.arc".to_vec(),
                size: archive_data.len() as u32,
            })
        );
        assert_eq!(
            host.event_result(&SystemVmEvent::ServiceCall {
                family: SystemCallFamily::System,
                service_id: 0x30,
                args,
            }),
            Some(SystemHostResult::Integer(archive_data.len() as u64))
        );
        Ok(())
    }

    #[test]
    fn runtime_file_services_match_case_insensitive_asset_queries() -> crate::Result<()> {
        let archive_data = build_arc20(&[("makerlogo", b"abcdef")]);
        let mut runtime = Runtime::new(crate::RuntimeConfig::default());
        runtime.mount_archive_data_named(archive_data, Some(b"data01999.arc"))?;
        let mut host = SystemHost::with_runtime(&runtime);
        let args = vec![
            SystemValue::String(b"data01xxx.arc"),
            SystemValue::String(b"MakerLogo"),
        ];

        assert_eq!(
            host.event_result(&SystemVmEvent::ServiceCall {
                family: SystemCallFamily::System,
                service_id: 0x34,
                args: args.clone(),
            }),
            Some(SystemHostResult::Integer(1))
        );
        assert_eq!(host.last_asset_name(), b"MakerLogo");
        assert_eq!(
            host.event_result(&SystemVmEvent::ServiceCall {
                family: SystemCallFamily::System,
                service_id: 0x35,
                args: args.clone(),
            }),
            Some(SystemHostResult::Integer(6))
        );
        assert_eq!(
            host.event_result(&SystemVmEvent::ServiceCall {
                family: SystemCallFamily::System,
                service_id: 0x30,
                args,
            }),
            Some(SystemHostResult::Integer(6))
        );
        Ok(())
    }

    #[test]
    fn runtime_file_load_prefers_last_pre_string_buffer_pointer() -> crate::Result<()> {
        let archive_data = build_arc20(&[("payload", b"abcdef")]);
        let mut runtime = Runtime::new(crate::RuntimeConfig::default());
        runtime.mount_archive_data_named(archive_data.clone(), Some(b"named.arc"))?;
        let mut host = SystemHost::with_runtime(&runtime);

        let load = host.event_result(&SystemVmEvent::ServiceCall {
            family: SystemCallFamily::System,
            service_id: 0x30,
            args: vec![
                SystemValue::Integer(archive_data.len() as u64),
                SystemValue::Integer(0x2000_0000),
                SystemValue::Integer(0x2000_0000),
                SystemValue::Integer(0x2000_0000),
                SystemValue::String(b"named.arc"),
                SystemValue::VariablePointer(0x890),
            ],
        });
        assert_eq!(
            load,
            Some(SystemHostResult::ValueAndEffect {
                value: SystemHostValue::Integer(archive_data.len() as u64),
                effect: SystemHostEffect {
                    writes: vec![SystemHostWrite::Bytes(SystemHostBytesWrite {
                        address: 0x2000_0000,
                        bytes: archive_data,
                    })],
                },
            })
        );
        Ok(())
    }

    #[test]
    fn catalog_file_services_return_zero_for_missing_assets() {
        let catalog = AssetCatalog::new();
        let scripts = ScriptLibrary::new();
        let mut host = SystemHost::with_catalog(&scripts, &catalog);

        assert_eq!(
            host.event_result(&SystemVmEvent::ServiceCall {
                family: SystemCallFamily::System,
                service_id: 0x34,
                args: vec![SystemValue::String(b"missing")],
            }),
            Some(SystemHostResult::Integer(0))
        );
        assert_eq!(
            host.event_result(&SystemVmEvent::ServiceCall {
                family: SystemCallFamily::System,
                service_id: 0x35,
                args: vec![SystemValue::String(b"missing")],
            }),
            Some(SystemHostResult::Integer(0))
        );
    }

    #[test]
    fn graph_1f_returns_ready_value_for_table_and_query_shapes() {
        let scripts = ScriptLibrary::new();
        let mut host = SystemHost::new(&scripts);

        assert_eq!(
            host.event_result(&SystemVmEvent::ServiceCall {
                family: SystemCallFamily::Graph,
                service_id: 0x1f,
                args: vec![
                    SystemValue::VariablePointer(0x30),
                    SystemValue::Integer(8),
                    SystemValue::VariablePointer(0x30),
                    SystemValue::Integer(u32::MAX.into()),
                    SystemValue::Integer(0),
                    SystemValue::Integer(0),
                    SystemValue::Integer(0),
                    SystemValue::Integer(0x454),
                    SystemValue::Integer(0x282),
                    SystemValue::Integer(0x601),
                    SystemValue::Integer(u32::MAX.into()),
                    SystemValue::Integer(u32::MAX.into()),
                    SystemValue::Integer(u32::MAX.into()),
                    SystemValue::Integer(u32::MAX.into()),
                    SystemValue::VariablePointer(0x650),
                ],
            }),
            Some(SystemHostResult::Integer(GRAPH_1F_READY_VALUE))
        );
        assert_eq!(
            host.event_result(&SystemVmEvent::ServiceCall {
                family: SystemCallFamily::Graph,
                service_id: 0x1f,
                args: vec![
                    SystemValue::Integer(GRAPH_1F_READY_VALUE),
                    SystemValue::VariablePointer(0x641),
                    SystemValue::VariablePointer(0x637),
                ],
            }),
            Some(SystemHostResult::Integer(GRAPH_1F_READY_VALUE))
        );
    }

    #[test]
    fn graph_1f_unknown_shape_does_not_claim_ready() {
        let scripts = ScriptLibrary::new();
        let mut host = SystemHost::new(&scripts);

        assert_eq!(
            host.event_result(&SystemVmEvent::ServiceCall {
                family: SystemCallFamily::Graph,
                service_id: 0x1f,
                args: vec![SystemValue::Integer(1)],
            }),
            Some(SystemHostResult::Unknown)
        );
    }

    #[test]
    fn graph_1f_allocates_wrapping_slot_indices_for_six_arg_shape() {
        let scripts = ScriptLibrary::new();
        let mut host = SystemHost::new(&scripts);
        let args = vec![
            SystemValue::Integer(3791),
            SystemValue::Integer(130),
            SystemValue::VariablePointer(192),
            SystemValue::VariablePointer(128),
            SystemValue::VariablePointer(64),
            SystemValue::Integer(253),
        ];

        for expected in 0..GRAPH_1F_SLOT_LIMIT {
            assert_eq!(
                host.event_result(&SystemVmEvent::ServiceCall {
                    family: SystemCallFamily::Graph,
                    service_id: 0x1f,
                    args: args.clone(),
                }),
                Some(SystemHostResult::Integer(u64::from(expected)))
            );
        }
        assert_eq!(
            host.event_result(&SystemVmEvent::ServiceCall {
                family: SystemCallFamily::Graph,
                service_id: 0x1f,
                args,
            }),
            Some(SystemHostResult::Integer(0))
        );
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
