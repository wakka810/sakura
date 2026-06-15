use crate::error::{Result, SakuraError};
use crate::system_bytecode::{
    SystemBranchKind, SystemCallFamily, SystemInstructionKind, SystemProgram, SystemUserScriptOp,
};
use crate::system_host::{SystemHostBytesWrite, SystemHostWrite};
use crate::system_vm_ops::{
    apply_basic_no_operand, eval_basic_binary_integer, system_value_integer, ADDRESS_OFFSET_MASK,
    CODE_ADDRESS_ALT_BASE, CODE_ADDRESS_BASE, LOCAL_ADDRESS_ALT_BASE, LOCAL_ADDRESS_BASE,
};
use std::collections::{BTreeMap, VecDeque};

const MAX_STACK: usize = 65_536;
const LOCAL_MEM_SIZE: usize = (ADDRESS_OFFSET_MASK as usize) + 1;
const GLOBAL_SLOT_COUNT: usize = 2;
const UNKNOWN_SLOT_COUNT: usize = 2;
const RECENT_OPCODE_LIMIT: usize = 64;
const ZERO_PADDING_RUN: usize = 64;
const PUSH8_TABLE_RUN: usize = 256;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SystemValue<'a> {
    Integer(u64),
    String(&'a [u8]),
    OwnedString(Vec<u8>),
    LocalStringPointer { address: u32, bytes: Vec<u8> },
    Code(usize),
    CodeInScript { script_index: usize, offset: usize },
    VariablePointer(u32),
    UserScriptHandle(u32),
    UserScriptResult(u8),
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SystemValueSnapshot {
    Integer(u64),
    String(Vec<u8>),
    LocalStringPointer { address: u32, bytes: Vec<u8> },
    Code(usize),
    CodeInScript { script_index: usize, offset: usize },
    VariablePointer(u32),
    UserScriptHandle(u32),
    UserScriptResult(u8),
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SystemVmSnapshot {
    pub script_index: usize,
    pub cursor: usize,
    pub stack: Vec<SystemValueSnapshot>,
    pub local_mem: Vec<u8>,
    pub local_slots: BTreeMap<usize, SystemValueSnapshot>,
    pub global_mem: Vec<Vec<u8>>,
    pub global_slots: Vec<BTreeMap<usize, SystemValueSnapshot>>,
    pub unknown_mem: Vec<Vec<u8>>,
    pub unknown_slots: Vec<BTreeMap<usize, SystemValueSnapshot>>,
    pub aux_mem: Vec<Vec<u8>>,
    pub aux_slots: Vec<BTreeMap<usize, SystemValueSnapshot>>,
    pub mem_ptr: u32,
    pub probe_entry: bool,
    pub probe_base_mem_ptr: u32,
    pub halted: bool,
    pub last_instruction_offset: Option<usize>,
    pub last_opcode: Option<u8>,
    pub recent_opcodes: Vec<u8>,
}

impl<'a> SystemValue<'a> {
    pub fn string_bytes(&self) -> Option<&[u8]> {
        match self {
            Self::String(bytes) => Some(bytes),
            Self::OwnedString(bytes) => Some(bytes.as_slice()),
            Self::LocalStringPointer { bytes, .. } => Some(bytes.as_slice()),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SystemVmEvent<'a> {
    ServiceCall {
        family: SystemCallFamily,
        service_id: u8,
        args: Vec<SystemValue<'a>>,
    },
    LoadedProgramCall {
        handle: u32,
        offset: Option<usize>,
        args: Vec<SystemValue<'a>>,
    },
    UserScriptCall {
        service_id: u8,
        args: Vec<SystemValue<'a>>,
    },
    UserScriptLoad,
    UserScriptFree {
        args: Vec<SystemValue<'a>>,
    },
    UserScriptReturn,
    Halted,
}

#[derive(Debug, Clone)]
pub struct SystemVm<'a> {
    program: SystemProgram<'a>,
    script_index: usize,
    cursor: usize,
    stack: Vec<SystemValue<'a>>,
    local_mem: Vec<u8>,
    local_slots: BTreeMap<usize, SystemValue<'a>>,
    global_mem: [Vec<u8>; GLOBAL_SLOT_COUNT],
    global_slots: [BTreeMap<usize, SystemValue<'a>>; GLOBAL_SLOT_COUNT],
    unknown_mem: [Vec<u8>; UNKNOWN_SLOT_COUNT],
    unknown_slots: [BTreeMap<usize, SystemValue<'a>>; UNKNOWN_SLOT_COUNT],
    aux_mem: Vec<Vec<u8>>,
    aux_slots: Vec<BTreeMap<usize, SystemValue<'a>>>,
    mem_ptr: u32,
    probe_entry: bool,
    probe_base_mem_ptr: u32,
    halted: bool,
    last_instruction_offset: Option<usize>,
    last_opcode: Option<u8>,
    recent_opcodes: VecDeque<u8>,
}

impl<'a> SystemVm<'a> {
    pub fn new(program: SystemProgram<'a>) -> Self {
        Self {
            cursor: program.code_offset(),
            program,
            script_index: 0,
            stack: Vec::new(),
            local_mem: vec![0; LOCAL_MEM_SIZE],
            local_slots: BTreeMap::new(),
            global_mem: std::array::from_fn(|_| Vec::new()),
            global_slots: std::array::from_fn(|_| BTreeMap::new()),
            unknown_mem: std::array::from_fn(|_| Vec::new()),
            unknown_slots: std::array::from_fn(|_| BTreeMap::new()),
            aux_mem: vec![Vec::new(); 0x31],
            aux_slots: vec![BTreeMap::new(); 0x31],
            mem_ptr: 0,
            probe_entry: false,
            probe_base_mem_ptr: 0,
            halted: false,
            last_instruction_offset: None,
            last_opcode: None,
            recent_opcodes: VecDeque::new(),
        }
    }

    pub fn parse(data: &'a [u8]) -> Result<Self> {
        Ok(Self::new(SystemProgram::parse(data)?))
    }

    pub fn cursor(&self) -> usize {
        self.cursor
    }

    pub(crate) fn program(&self) -> SystemProgram<'a> {
        self.program
    }

    #[allow(dead_code)]
    pub(crate) fn code_script_index(&self) -> usize {
        self.script_index
    }

    pub(crate) fn set_script_index(&mut self, script_index: usize) {
        self.script_index = script_index;
    }

    pub fn seek(&mut self, offset: usize) -> Result<()> {
        if offset < self.program.code_offset() || offset >= self.program.code_end() {
            return Err(SakuraError::InvalidScript(
                "system VM seek target is out of range".to_owned(),
            ));
        }
        self.cursor = offset;
        self.halted = false;
        Ok(())
    }

    pub fn stack(&self) -> &[SystemValue<'a>] {
        &self.stack
    }

    pub fn mem_ptr(&self) -> u32 {
        self.mem_ptr
    }

    pub fn set_probe_entry(&mut self, enabled: bool) {
        self.probe_entry = enabled;
        if enabled {
            self.probe_base_mem_ptr = self.mem_ptr;
        } else {
            self.probe_base_mem_ptr = 0;
        }
    }

    pub fn is_halted(&self) -> bool {
        self.halted
    }

    pub(crate) fn snapshot(&self) -> SystemVmSnapshot {
        SystemVmSnapshot {
            script_index: self.script_index,
            cursor: self.cursor,
            stack: self
                .stack
                .iter()
                .cloned()
                .map(SystemValueSnapshot::from)
                .collect(),
            local_mem: self.local_mem.clone(),
            local_slots: self
                .local_slots
                .iter()
                .map(|(offset, value)| (*offset, SystemValueSnapshot::from(value.clone())))
                .collect(),
            global_mem: self.global_mem.iter().map(Clone::clone).collect(),
            global_slots: self.global_slots.iter().map(snapshot_slot_map).collect(),
            unknown_mem: self.unknown_mem.iter().map(Clone::clone).collect(),
            unknown_slots: self.unknown_slots.iter().map(snapshot_slot_map).collect(),
            aux_mem: self.aux_mem.clone(),
            aux_slots: self.aux_slots.iter().map(snapshot_slot_map).collect(),
            mem_ptr: self.mem_ptr,
            probe_entry: self.probe_entry,
            probe_base_mem_ptr: self.probe_base_mem_ptr,
            halted: self.halted,
            last_instruction_offset: self.last_instruction_offset,
            last_opcode: self.last_opcode,
            recent_opcodes: self.recent_opcodes.iter().copied().collect(),
        }
    }

    pub(crate) fn restore(program: SystemProgram<'a>, snapshot: SystemVmSnapshot) -> Result<Self> {
        if snapshot.cursor < program.code_offset()
            || (!snapshot.halted && snapshot.cursor >= program.code_end())
            || snapshot.local_mem.len() != LOCAL_MEM_SIZE
            || snapshot.mem_ptr as usize > LOCAL_MEM_SIZE
            || snapshot.probe_base_mem_ptr as usize > LOCAL_MEM_SIZE
            || snapshot.global_mem.len() != GLOBAL_SLOT_COUNT
            || snapshot.global_slots.len() != GLOBAL_SLOT_COUNT
            || snapshot.unknown_mem.len() != UNKNOWN_SLOT_COUNT
            || snapshot.unknown_slots.len() != UNKNOWN_SLOT_COUNT
            || snapshot.aux_mem.len() != 0x31
            || snapshot.aux_slots.len() != 0x31
            || snapshot
                .global_mem
                .iter()
                .any(|mem| mem.len() > LOCAL_MEM_SIZE)
            || snapshot
                .unknown_mem
                .iter()
                .any(|mem| mem.len() > LOCAL_MEM_SIZE)
            || snapshot
                .aux_mem
                .iter()
                .any(|mem| mem.len() > LOCAL_MEM_SIZE)
        {
            return Err(SakuraError::InvalidRuntime(
                "system VM snapshot is invalid".to_owned(),
            ));
        }
        let mut recent_opcodes = VecDeque::with_capacity(RECENT_OPCODE_LIMIT);
        for opcode in snapshot
            .recent_opcodes
            .into_iter()
            .rev()
            .take(RECENT_OPCODE_LIMIT)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
        {
            recent_opcodes.push_back(opcode);
        }
        Ok(Self {
            program,
            script_index: snapshot.script_index,
            cursor: snapshot.cursor,
            stack: snapshot
                .stack
                .into_iter()
                .map(SystemValueSnapshot::into_runtime_value)
                .collect(),
            local_mem: snapshot.local_mem,
            local_slots: snapshot
                .local_slots
                .into_iter()
                .map(|(offset, value)| (offset, value.into_runtime_value()))
                .collect(),
            global_mem: vec_into_array(snapshot.global_mem).map_err(|_| {
                SakuraError::InvalidRuntime(
                    "system VM snapshot global memory is invalid".to_owned(),
                )
            })?,
            global_slots: vec_into_array(
                snapshot
                    .global_slots
                    .into_iter()
                    .map(restore_slot_map)
                    .collect(),
            )
            .map_err(|_| {
                SakuraError::InvalidRuntime(
                    "system VM snapshot global slots are invalid".to_owned(),
                )
            })?,
            unknown_mem: vec_into_array(snapshot.unknown_mem).map_err(|_| {
                SakuraError::InvalidRuntime(
                    "system VM snapshot unknown memory is invalid".to_owned(),
                )
            })?,
            unknown_slots: vec_into_array(
                snapshot
                    .unknown_slots
                    .into_iter()
                    .map(restore_slot_map)
                    .collect(),
            )
            .map_err(|_| {
                SakuraError::InvalidRuntime(
                    "system VM snapshot unknown slots are invalid".to_owned(),
                )
            })?,
            aux_mem: snapshot.aux_mem,
            aux_slots: snapshot
                .aux_slots
                .into_iter()
                .map(restore_slot_map)
                .collect(),
            mem_ptr: snapshot.mem_ptr,
            probe_entry: snapshot.probe_entry,
            probe_base_mem_ptr: snapshot.probe_base_mem_ptr,
            halted: snapshot.halted,
            last_instruction_offset: snapshot.last_instruction_offset,
            last_opcode: snapshot.last_opcode,
            recent_opcodes,
        })
    }

    pub fn last_instruction_offset(&self) -> Option<usize> {
        self.last_instruction_offset
    }

    pub fn last_opcode(&self) -> Option<u8> {
        self.last_opcode
    }

    pub fn local_integer(&self, offset: usize, width: u8) -> Option<u64> {
        self.read_local_int(offset, width)
    }

    pub fn recent_opcodes(&self) -> impl Iterator<Item = u8> + '_ {
        self.recent_opcodes.iter().copied()
    }

    pub(crate) fn fork_with_shared_memory(&self, program: SystemProgram<'a>) -> Self {
        Self {
            program,
            script_index: self.script_index,
            cursor: program.code_offset(),
            stack: Vec::new(),
            local_mem: self.local_mem.clone(),
            local_slots: self.local_slots.clone(),
            global_mem: self.global_mem.clone(),
            global_slots: self.global_slots.clone(),
            unknown_mem: self.unknown_mem.clone(),
            unknown_slots: self.unknown_slots.clone(),
            aux_mem: self.aux_mem.clone(),
            aux_slots: self.aux_slots.clone(),
            mem_ptr: self.mem_ptr,
            probe_entry: false,
            probe_base_mem_ptr: 0,
            halted: false,
            last_instruction_offset: None,
            last_opcode: None,
            recent_opcodes: VecDeque::new(),
        }
    }

    pub(crate) fn adopt_shared_memory_from(&mut self, other: &Self) {
        self.local_mem = other.local_mem.clone();
        self.local_slots = other.local_slots.clone();
        self.global_mem = other.global_mem.clone();
        self.global_slots = other.global_slots.clone();
        self.unknown_mem = other.unknown_mem.clone();
        self.unknown_slots = other.unknown_slots.clone();
        self.aux_mem = other.aux_mem.clone();
        self.aux_slots = other.aux_slots.clone();
    }

    pub(crate) fn adopt_shared_system_memory_from(&mut self, other: &Self) {
        self.global_mem = other.global_mem.clone();
        self.global_slots = other.global_slots.clone();
        self.aux_mem = other.aux_mem.clone();
        self.aux_slots = other.aux_slots.clone();
    }

    pub fn resume_with(&mut self, value: SystemValue<'a>) -> Result<()> {
        if self.halted {
            return Err(SakuraError::InvalidScript(
                "cannot resume a halted system VM".to_owned(),
            ));
        }
        self.push(value)
    }

    pub fn write_host_local_integer(&mut self, address: u32, width: u8, value: u64) -> Result<()> {
        if int_width_len(width).is_none() {
            return Err(SakuraError::InvalidScript(format!(
                "host local write width {width} is invalid"
            )));
        }
        let pointer = SystemValue::VariablePointer(wrap_local_offset(address));
        let resolved = self.resolve_address(pointer, width).ok_or_else(|| {
            SakuraError::InvalidScript(format!(
                "host local write address 0x{address:x} is out of range"
            ))
        })?;
        self.write_memory_value(resolved, width, SystemValue::Integer(value));
        Ok(())
    }

    pub fn host_local_integer(&self, address: u32, width: u8) -> Option<u64> {
        int_width_len(width)?;
        let resolved = self.resolve_address(
            SystemValue::VariablePointer(wrap_local_offset(address)),
            width,
        )?;
        self.read_plain_integer(resolved, width)
    }

    pub fn host_integer_raw(&self, address: u32, width: u8) -> Option<u64> {
        let len = int_width_len(width)?;
        let resolved = self.decode_integer_address(u64::from(address), len)?;
        self.read_plain_integer(resolved, width)
    }

    pub fn host_bytes_raw(&self, address: u32, len: usize) -> Option<Vec<u8>> {
        let resolved = self.decode_integer_address(u64::from(address), len)?;
        self.read_memory_bytes(resolved, len).ok()
    }

    pub fn write_host_integer_raw(&mut self, address: u32, width: u8, value: u64) -> Result<()> {
        self.write_host_integer(address, width, value)
    }

    pub fn apply_host_write(&mut self, write: &SystemHostWrite) -> Result<()> {
        match write {
            SystemHostWrite::Integer(write) => {
                self.write_host_integer(write.address, write.width, write.value)
            }
            SystemHostWrite::LocalInteger(write) => {
                self.write_host_local_integer(write.address, write.width, write.value)
            }
            SystemHostWrite::Bytes(write) => self.write_host_bytes(write),
        }
    }

    pub fn next_event(&mut self) -> Result<SystemVmEvent<'a>> {
        self.next_event_inner(None)
    }

    pub fn next_event_with_limit(&mut self, max_instructions: usize) -> Result<SystemVmEvent<'a>> {
        self.next_event_inner(Some(max_instructions))
    }

    fn next_event_inner(&mut self, max_instructions: Option<usize>) -> Result<SystemVmEvent<'a>> {
        let mut executed = 0usize;
        while !self.halted {
            if max_instructions.is_some_and(|limit| executed >= limit) {
                return Err(SakuraError::InvalidScript(
                    "system VM instruction limit exceeded".to_owned(),
                ));
            }
            if self.cursor >= self.program.code_end() {
                self.halted = true;
                break;
            }
            if self.remaining_code_is_zero_padding()
                || self.starts_with_zero_padding_run()
                || self.starts_with_push8_table_run()
            {
                self.halted = true;
                break;
            }
            if !self.program.has_complete_min_instruction(self.cursor)? {
                self.halted = true;
                break;
            }
            let decode_offset = self.cursor;
            let instruction = match self.program.decode(decode_offset) {
                Ok(instruction) => instruction,
                Err(error) => {
                    self.last_instruction_offset = Some(decode_offset);
                    self.last_opcode = self.program.data().get(decode_offset).copied();
                    if let Some(opcode) = self.last_opcode {
                        self.remember_opcode(opcode);
                    }
                    return Err(error);
                }
            };
            self.last_instruction_offset = Some(instruction.offset);
            self.last_opcode = Some(instruction.opcode);
            self.remember_opcode(instruction.opcode);
            self.cursor = instruction.next_offset;
            executed = executed.saturating_add(1);
            match instruction.kind {
                SystemInstructionKind::PushU8(value) => {
                    self.push(SystemValue::Integer(value.into()))?
                }
                SystemInstructionKind::PushU16(value) => {
                    self.push(SystemValue::Integer(value.into()))?
                }
                SystemInstructionKind::PushU32(value) => {
                    self.push(SystemValue::Integer(value.into()))?
                }
                SystemInstructionKind::PushU64(value) => self.push(SystemValue::Integer(value))?,
                SystemInstructionKind::GetVariablePointer(offset) => {
                    self.push(SystemValue::VariablePointer(wrap_local_offset(
                        self.mem_ptr.wrapping_sub(u32::from(offset)),
                    )))?
                }
                SystemInstructionKind::GetString { bytes, target, .. } => {
                    let value = match (target, bytes) {
                        (_, Some(bytes)) => SystemValue::String(bytes),
                        (Some(target), None) => SystemValue::Code(target),
                        (None, None) => SystemValue::Unknown,
                    };
                    self.push(value)?;
                }
                SystemInstructionKind::GetCodeOffset { target, .. } => {
                    self.push(target.map_or(SystemValue::Unknown, SystemValue::Code))?;
                }
                SystemInstructionKind::Branch { kind } => {
                    if let Some(event) = self.apply_branch(kind)? {
                        return Ok(event);
                    }
                }
                SystemInstructionKind::ServiceCall {
                    family, service_id, ..
                } => {
                    return Ok(SystemVmEvent::ServiceCall {
                        family,
                        service_id,
                        args: self.take_service_args(family, service_id),
                    });
                }
                SystemInstructionKind::UserScript(op) => match op {
                    SystemUserScriptOp::Load => return Ok(SystemVmEvent::UserScriptLoad),
                    SystemUserScriptOp::Free => {
                        return Ok(SystemVmEvent::UserScriptFree {
                            args: self.take_args(),
                        })
                    }
                    SystemUserScriptOp::Return => {
                        self.halted = true;
                        return Ok(SystemVmEvent::UserScriptReturn);
                    }
                    SystemUserScriptOp::Call(service_id) => {
                        return Ok(SystemVmEvent::UserScriptCall {
                            service_id,
                            args: self.take_args(),
                        })
                    }
                },
                SystemInstructionKind::Return => {
                    if self.probe_entry && self.mem_ptr == self.probe_base_mem_ptr {
                        self.halted = true;
                        continue;
                    }
                    if self.mem_ptr != 0 {
                        self.mem_ptr = self.mem_ptr.saturating_sub(4);
                        let Some(raw_return) = self.read_local_int(self.mem_ptr as usize, 2) else {
                            if self.probe_entry {
                                self.halted = true;
                                continue;
                            }
                            return Err(SakuraError::InvalidScript(
                                "system return address is out of range".to_owned(),
                            ));
                        };
                        if raw_return == u32::MAX as u64 && self.probe_entry {
                            self.halted = true;
                            continue;
                        }
                        let return_offset = usize::try_from(raw_return)
                            .ok()
                            .filter(|offset| {
                                *offset >= self.program.code_offset()
                                    && *offset < self.program.code_end()
                            })
                            .or_else(|| self.probe_entry.then_some(self.program.code_end()))
                            .ok_or_else(|| {
                                SakuraError::InvalidScript(
                                    "system return address is out of range".to_owned(),
                                )
                            })?;
                        self.cursor = return_offset;
                    } else {
                        self.halted = true;
                    }
                }
                SystemInstructionKind::WidthOperand { width } => {
                    self.apply_width_operand(instruction.opcode, width)?
                }
                SystemInstructionKind::ArrayOperand { .. } => self.push(SystemValue::Unknown)?,
                SystemInstructionKind::ShortOperand(value) => self.apply_short_operand(value)?,
                SystemInstructionKind::NoOperand => self.apply_no_operand(instruction.opcode)?,
            }
        }
        Ok(SystemVmEvent::Halted)
    }

    fn apply_branch(&mut self, kind: SystemBranchKind) -> Result<Option<SystemVmEvent<'a>>> {
        match kind {
            SystemBranchKind::Jump => {
                let target = self.pop_code_target();
                self.cursor =
                    target.ok_or_else(|| self.invalid_branch_target_error("jump", target))?;
            }
            SystemBranchKind::Conditional { condition } => {
                let target = self.pop_code_target();
                let value = self.pop_integer().unwrap_or(0);
                if conditional_branch_taken(condition, value) {
                    self.cursor = target
                        .ok_or_else(|| self.invalid_branch_target_error("conditional", target))?;
                }
            }
            SystemBranchKind::Call => {
                let target_value = self.pop_or_zero();
                if let SystemValue::UserScriptHandle(handle) = target_value {
                    return Ok(Some(SystemVmEvent::LoadedProgramCall {
                        handle,
                        offset: None,
                        args: self.take_args(),
                    }));
                }
                let target = match target_value {
                    SystemValue::CodeInScript {
                        script_index,
                        offset,
                    } if script_index != self.script_index => {
                        return Ok(Some(SystemVmEvent::LoadedProgramCall {
                            handle: script_index as u32,
                            offset: Some(offset),
                            args: self.take_args(),
                        }));
                    }
                    other => self
                        .value_code_target(other)
                        .ok_or_else(|| self.invalid_branch_target_error("call", None))?,
                };
                let return_offset = self.cursor;
                let Some(return_slot_end) = usize::try_from(self.mem_ptr)
                    .ok()
                    .and_then(|offset| offset.checked_add(4))
                else {
                    return Err(SakuraError::InvalidScript(
                        "system call stack pointer overflowed".to_owned(),
                    ));
                };
                if return_slot_end >= LOCAL_MEM_SIZE {
                    return Err(SakuraError::InvalidScript(
                        "system local stack frame overflowed".to_owned(),
                    ));
                }
                self.write_local_int(self.mem_ptr as usize, 2, return_offset as u64);
                self.mem_ptr = self.mem_ptr.saturating_add(4);
                self.cursor = target;
            }
        }
        Ok(None)
    }

    fn invalid_branch_target_error(&self, kind: &str, target: Option<usize>) -> SakuraError {
        let offset = self.last_instruction_offset.unwrap_or(self.cursor);
        match target {
            Some(target) => SakuraError::InvalidScript(format!(
                "system {kind} target 0x{target:x} is out of range at offset 0x{offset:x}"
            )),
            None => SakuraError::InvalidScript(format!(
                "system {kind} target is out of range at offset 0x{offset:x}"
            )),
        }
    }

    fn push(&mut self, value: SystemValue<'a>) -> Result<()> {
        if self.stack.len() == MAX_STACK {
            return Err(SakuraError::InvalidScript(
                "system stack limit exceeded".to_owned(),
            ));
        }
        self.stack.push(value);
        Ok(())
    }

    fn remember_opcode(&mut self, opcode: u8) {
        if self.recent_opcodes.len() == RECENT_OPCODE_LIMIT {
            self.recent_opcodes.pop_front();
        }
        self.recent_opcodes.push_back(opcode);
    }

    fn remaining_code_is_zero_padding(&self) -> bool {
        self.program
            .data()
            .get(self.cursor..self.program.code_end())
            .is_some_and(|tail| !tail.is_empty() && tail.iter().all(|byte| *byte == 0))
    }

    fn starts_with_zero_padding_run(&self) -> bool {
        self.program
            .data()
            .get(self.cursor..self.program.code_end())
            .is_some_and(|tail| {
                tail.len() >= ZERO_PADDING_RUN
                    && tail[..ZERO_PADDING_RUN].iter().all(|byte| *byte == 0)
            })
    }

    fn starts_with_push8_table_run(&self) -> bool {
        let Some(tail) = self
            .program
            .data()
            .get(self.cursor..self.program.code_end())
        else {
            return false;
        };
        let needed = PUSH8_TABLE_RUN * 2;
        tail.len() >= needed && tail[..needed].chunks_exact(2).all(|pair| pair[0] == 0)
    }

    fn pop(&mut self) -> Option<SystemValue<'a>> {
        self.stack.pop()
    }

    fn pop_or_zero(&mut self) -> SystemValue<'a> {
        self.pop().unwrap_or(SystemValue::Integer(0))
    }

    fn pop_many(&mut self, count: usize) {
        for _ in 0..count {
            if self.pop().is_none() {
                break;
            }
        }
    }

    fn pop_integer(&mut self) -> Option<u64> {
        system_value_integer(&self.pop_or_zero())
    }

    fn pop_code_target(&mut self) -> Option<usize> {
        let value = self.pop_or_zero();
        self.value_code_target(value)
    }

    fn value_code_target(&self, value: SystemValue<'_>) -> Option<usize> {
        match value {
            SystemValue::Code(offset) => (offset >= self.program.code_offset()
                && offset < self.program.code_end())
            .then_some(offset),
            SystemValue::CodeInScript { offset, .. } => (offset >= self.program.code_offset()
                && offset < self.program.code_end())
            .then_some(offset),
            SystemValue::Integer(value) => {
                let offset = self.decode_code_address(value)?;
                (offset >= self.program.code_offset() && offset < self.program.code_end())
                    .then_some(offset)
            }
            _ => None,
        }
    }

    fn decode_code_address(&self, value: u64) -> Option<usize> {
        let value = value as u32;
        if matches!(
            value & !ADDRESS_OFFSET_MASK,
            CODE_ADDRESS_BASE | CODE_ADDRESS_ALT_BASE
        ) {
            usize::try_from(value & ADDRESS_OFFSET_MASK).ok()
        } else {
            usize::try_from(u64::from(value)).ok()
        }
    }

    fn apply_width_operand(&mut self, opcode: u8, width: u8) -> Result<()> {
        match opcode {
            0x08 => self.apply_load(width)?,
            0x09 => self.apply_store_copy(width)?,
            0x0a => self.apply_store(width)?,
            _ => self.push(SystemValue::Unknown)?,
        }
        Ok(())
    }

    fn apply_load(&mut self, width: u8) -> Result<()> {
        let value = match self
            .pop()
            .and_then(|value| self.resolve_address(value, width))
        {
            Some(address) => self.read_memory_value(address, width),
            None => SystemValue::Unknown,
        };
        self.push(value)
    }

    fn apply_store_copy(&mut self, width: u8) -> Result<()> {
        let value = self.pop_or_zero();
        self.store_popped_pointer(width, value.clone());
        self.push(value)
    }

    fn apply_store(&mut self, width: u8) -> Result<()> {
        let pointer = self.pop();
        let value = self.pop_or_zero();
        self.store_pointer(width, pointer, value);
        Ok(())
    }

    fn store_popped_pointer(&mut self, width: u8, value: SystemValue<'a>) {
        let pointer = self.pop();
        self.store_pointer(width, pointer, value);
    }

    fn store_pointer(
        &mut self,
        width: u8,
        pointer: Option<SystemValue<'a>>,
        value: SystemValue<'a>,
    ) {
        let Some(pointer) = pointer else {
            return;
        };
        let Some(address) = self.resolve_write_address(pointer, width) else {
            return;
        };
        self.write_memory_value(address, width, value);
    }

    fn apply_short_operand(&mut self, value: u16) -> Result<()> {
        let width = (value & 0xff) as u8;
        let count = usize::from(value >> 8);
        let mut values = Vec::with_capacity(count);
        for _ in 0..count {
            values.push(self.pop_or_zero());
        }
        let dst = self.pop_or_zero();
        let Some(address) = self.resolve_write_address(dst, width) else {
            return Ok(());
        };
        let stride = 1usize << width.min(2);
        let mut offset = address.offset();
        for value in values.into_iter().rev() {
            self.write_memory_value(address.with_offset(offset), width, value);
            offset = offset.saturating_add(stride);
        }
        Ok(())
    }

    fn apply_no_operand(&mut self, opcode: u8) -> Result<()> {
        match opcode {
            0x60 => return self.apply_memcpy(),
            0x61 => return self.apply_memclear(),
            0x62 => return self.apply_memset(),
            0x63 => return self.apply_memeq(),
            0x68 => return self.apply_strlen(),
            0x69 => return self.apply_streq(),
            _ => {}
        }
        if apply_basic_no_operand(opcode, &mut self.stack) {
            return Ok(());
        }
        match opcode {
            0x10 => self.push(SystemValue::Integer(u64::from(self.mem_ptr)))?,
            0x11 => self.apply_set_mem_ptr(),
            0x6d | 0x71 => self.pop_many(1),
            0x20..=0x27 | 0x29..=0x35 | 0x38 | 0x39 => self.apply_binary_op(opcode)?,
            0x6a => self.apply_strcpy(),
            0x6b => self.apply_concat(),
            0x67 => self.pop_many(4),
            0x6c => {
                self.pop_many(1);
                self.push(SystemValue::Unknown)?;
                self.push(SystemValue::Unknown)?;
                self.push(SystemValue::Unknown)?;
            }
            0x6f => self.apply_sprintf(),
            0x75 => {
                self.pop_many(3);
                self.push(SystemValue::Integer(1))?;
            }
            _ => {}
        }
        Ok(())
    }

    fn apply_memcpy(&mut self) -> Result<()> {
        let size = self.pop_integer().unwrap_or(0) as usize;
        let src = self.pop();
        let dst = self.pop();
        let Some(src_address) = src.and_then(|value| self.resolve_range(value, size)) else {
            return Ok(());
        };
        let Some(dst_address) = dst.and_then(|value| self.resolve_write_range(value, size)) else {
            return Ok(());
        };
        let bytes = self.read_memory_bytes(src_address, size)?;
        self.write_memory_bytes(dst_address, &bytes);
        Ok(())
    }

    fn apply_memclear(&mut self) -> Result<()> {
        let size = self.pop_integer().unwrap_or(0) as usize;
        let ptr = self.pop();
        let Some(address) = ptr.and_then(|value| self.resolve_write_range(value, size)) else {
            return Ok(());
        };
        self.write_memory_bytes(address, &vec![0; size]);
        Ok(())
    }

    fn apply_memset(&mut self) -> Result<()> {
        let value = self.pop_integer().unwrap_or(0) as u8;
        let size = self.pop_integer().unwrap_or(0) as usize;
        let ptr = self.pop();
        let Some(address) = ptr.and_then(|value| self.resolve_write_range(value, size)) else {
            return Ok(());
        };
        self.write_memory_bytes(address, &vec![value; size]);
        Ok(())
    }

    fn apply_memeq(&mut self) -> Result<()> {
        let size = self.pop_integer().unwrap_or(0) as usize;
        let src = self.pop();
        let dst = self.pop();
        let result = if let (Some(src), Some(dst)) = (
            src.and_then(|value| self.resolve_range(value, size)),
            dst.and_then(|value| self.resolve_range(value, size)),
        ) {
            self.read_memory_bytes(src, size)? == self.read_memory_bytes(dst, size)?
        } else {
            false
        };
        self.push(SystemValue::Integer(u64::from(result)))
    }

    fn apply_strlen(&mut self) -> Result<()> {
        let value = self.pop();
        let len = value
            .as_ref()
            .and_then(|value| self.value_string_snapshot(value))
            .map(|bytes| bytes.len() as u64);
        self.push(len.map_or(SystemValue::Unknown, SystemValue::Integer))
    }

    fn apply_streq(&mut self) -> Result<()> {
        let right = self.pop();
        let left = self.pop();
        let result = match (
            left.as_ref()
                .and_then(|value| self.value_string_snapshot(value)),
            right
                .as_ref()
                .and_then(|value| self.value_string_snapshot(value)),
        ) {
            (Some(left), Some(right)) => SystemValue::Integer(u64::from(left == right)),
            _ => SystemValue::Unknown,
        };
        self.push(result)
    }

    fn apply_strcpy(&mut self) {
        let src = self.pop_or_zero();
        let dst = self.pop();
        let value = self
            .value_string_snapshot(&src)
            .map(SystemValue::OwnedString)
            .unwrap_or(src);
        self.store_pointer(2, dst, value);
    }

    fn apply_concat(&mut self) {
        let right = self.pop_or_zero();
        let left = self.pop_or_zero();
        let dst = self.pop();
        let value = match (
            self.value_string_snapshot(&left),
            self.value_string_snapshot(&right),
        ) {
            (Some(left), Some(right)) => {
                let mut data = Vec::with_capacity(left.len().saturating_add(right.len()));
                data.extend_from_slice(&left);
                data.extend_from_slice(&right);
                SystemValue::OwnedString(data)
            }
            _ => SystemValue::Unknown,
        };
        self.store_pointer(2, dst, value);
    }

    fn apply_sprintf(&mut self) {
        let format = self.pop_or_zero();
        let dst = self.pop();
        let Some(format) = self.value_string_snapshot(&format) else {
            self.store_pointer(2, dst, SystemValue::Unknown);
            return;
        };
        let value = SystemValue::OwnedString(self.render_sprintf(&format));
        self.store_pointer(2, dst, value);
    }

    fn render_sprintf(&mut self, format: &[u8]) -> Vec<u8> {
        let mut output = Vec::with_capacity(format.len());
        let mut cursor = 0usize;
        while cursor < format.len() {
            if format[cursor] != b'%' {
                output.push(format[cursor]);
                cursor += 1;
                continue;
            }
            let directive_start = cursor;
            cursor += 1;
            if cursor == format.len() {
                output.push(b'%');
                break;
            }
            if format[cursor] == b'%' {
                output.push(b'%');
                cursor += 1;
                continue;
            }
            let spec = self.parse_sprintf_spec(format, &mut cursor);
            match spec.specifier {
                b's' => {
                    let value = self.pop_or_zero();
                    let bytes = self.value_string_snapshot(&value).unwrap_or_default();
                    append_padded_bytes(&mut output, &bytes, spec.width, spec.precision, spec.left);
                }
                b'c' => {
                    let value = self.pop_integer().unwrap_or(0) as u8;
                    append_padded_bytes(
                        &mut output,
                        &[value],
                        spec.width,
                        spec.precision,
                        spec.left,
                    );
                }
                b'd' | b'i' => {
                    let value = self.pop_integer().unwrap_or(0) as u32 as i32;
                    append_formatted_integer(
                        &mut output,
                        value.is_negative(),
                        i64::from(value).unsigned_abs(),
                        10,
                        false,
                        &spec,
                    );
                }
                b'u' => {
                    let value = self.pop_integer().unwrap_or(0) as u32;
                    append_formatted_integer(
                        &mut output,
                        false,
                        u64::from(value),
                        10,
                        false,
                        &spec,
                    );
                }
                b'x' | b'X' | b'p' => {
                    let value = self.pop_integer().unwrap_or(0) as u32;
                    append_formatted_integer(
                        &mut output,
                        false,
                        u64::from(value),
                        16,
                        spec.specifier == b'X',
                        &spec,
                    );
                }
                b'o' => {
                    let value = self.pop_integer().unwrap_or(0) as u32;
                    append_formatted_integer(&mut output, false, u64::from(value), 8, false, &spec);
                }
                _ => output.extend_from_slice(&format[directive_start..cursor]),
            }
        }
        output
    }

    fn parse_sprintf_spec(&mut self, format: &[u8], cursor: &mut usize) -> SprintfSpec {
        let mut spec = SprintfSpec::default();
        while let Some(byte) = format.get(*cursor).copied() {
            match byte {
                b'-' => spec.left = true,
                b'+' => spec.force_sign = true,
                b' ' => spec.space_sign = true,
                b'#' => spec.alternate = true,
                b'0' => spec.zero_pad = true,
                _ => break,
            }
            *cursor += 1;
        }
        spec.width = self.parse_sprintf_number_or_star(format, cursor);
        if matches!(format.get(*cursor), Some(b'.')) {
            *cursor += 1;
            spec.precision = self.parse_sprintf_number_or_star(format, cursor);
        }
        while matches!(
            format.get(*cursor),
            Some(b'h' | b'l' | b'j' | b'z' | b't' | b'L')
        ) {
            *cursor += 1;
        }
        spec.specifier = format.get(*cursor).copied().unwrap_or(b'?');
        *cursor = (*cursor).saturating_add(1);
        if spec.width.is_some_and(|width| width < 0) {
            spec.left = true;
            spec.width = spec.width.map(i32::abs);
        }
        if spec.precision.is_some_and(|precision| precision < 0) {
            spec.precision = None;
        }
        spec
    }

    fn parse_sprintf_number_or_star(&mut self, format: &[u8], cursor: &mut usize) -> Option<i32> {
        if matches!(format.get(*cursor), Some(b'*')) {
            *cursor += 1;
            return Some(self.pop_integer().unwrap_or(0) as i32);
        }
        let start = *cursor;
        let mut value = 0i32;
        while let Some(byte @ b'0'..=b'9') = format.get(*cursor).copied() {
            value = value
                .saturating_mul(10)
                .saturating_add(i32::from(byte - b'0'));
            *cursor += 1;
        }
        (*cursor != start).then_some(value)
    }

    fn apply_set_mem_ptr(&mut self) {
        let Some(value) = self.pop_integer() else {
            return;
        };
        if let Ok(offset) = usize::try_from(value) {
            if offset <= LOCAL_MEM_SIZE {
                self.mem_ptr = offset as u32;
            }
        }
    }

    fn apply_binary_op(&mut self, opcode: u8) -> Result<()> {
        let right = self.pop_or_zero();
        let left = self.pop_or_zero();
        if let Some(value) = eval_typed_binary(opcode, Some(&left), Some(&right)) {
            return self.push(value);
        }
        let result = match (system_value_integer(&left), system_value_integer(&right)) {
            (Some(left), Some(right)) => eval_basic_binary_integer(opcode, left, right),
            _ => None,
        };
        self.push(result.map_or(SystemValue::Unknown, SystemValue::Integer))
    }

    fn take_args(&mut self) -> Vec<SystemValue<'a>> {
        std::mem::take(&mut self.stack)
    }

    fn take_service_args(
        &mut self,
        family: SystemCallFamily,
        service_id: u8,
    ) -> Vec<SystemValue<'a>> {
        let args = self.take_args();
        if !service_accepts_pointer_strings(family, service_id) {
            return args;
        }
        args.into_iter()
            .map(|value| self.resolve_local_string_pointer(value))
            .collect()
    }

    fn resolve_local_string_pointer(&self, value: SystemValue<'a>) -> SystemValue<'a> {
        let address = match value {
            SystemValue::VariablePointer(address) => wrap_local_offset(address),
            SystemValue::Integer(value) => match self.decode_local_address(value) {
                Some(address) => address,
                None => return SystemValue::Integer(value),
            },
            _ => return value,
        };
        let Some(bytes) = usize::try_from(address)
            .ok()
            .and_then(|offset| self.read_local_c_string(offset))
        else {
            return SystemValue::VariablePointer(address);
        };
        if bytes.is_empty() {
            SystemValue::VariablePointer(address)
        } else {
            SystemValue::LocalStringPointer { address, bytes }
        }
    }

    fn resolve_address(&self, value: SystemValue<'_>, width: u8) -> Option<MemoryAddress> {
        let len = int_width_len(width)?;
        self.resolve_memory_address(value, len)
    }

    fn resolve_range(&self, value: SystemValue<'_>, len: usize) -> Option<MemoryAddress> {
        self.resolve_memory_address(value, len)
    }

    fn resolve_write_address(&self, value: SystemValue<'_>, width: u8) -> Option<MemoryAddress> {
        let len = int_width_len(width)?;
        self.resolve_write_memory_address(value, len)
    }

    fn resolve_write_range(&self, value: SystemValue<'_>, len: usize) -> Option<MemoryAddress> {
        self.resolve_write_memory_address(value, len)
    }

    fn resolve_memory_address(&self, value: SystemValue<'_>, len: usize) -> Option<MemoryAddress> {
        match value {
            SystemValue::VariablePointer(address) => {
                let offset = usize::try_from(wrap_local_offset(address)).ok()?;
                (offset.checked_add(len)? <= LOCAL_MEM_SIZE).then_some(MemoryAddress::local(offset))
            }
            SystemValue::LocalStringPointer { address, .. } => {
                self.decode_external_address(address, len)
            }
            SystemValue::Integer(value) => self.decode_integer_address(value, len),
            _ => None,
        }
    }

    fn resolve_write_memory_address(
        &self,
        value: SystemValue<'_>,
        len: usize,
    ) -> Option<MemoryAddress> {
        match value {
            SystemValue::VariablePointer(address) => {
                let offset = usize::try_from(wrap_local_offset(address)).ok()?;
                (offset.checked_add(len)? <= LOCAL_MEM_SIZE).then_some(MemoryAddress::local(offset))
            }
            SystemValue::LocalStringPointer { address, .. } => {
                self.decode_external_write_address(address, len)
            }
            SystemValue::Integer(value) => self.decode_integer_write_address(value, len),
            _ => None,
        }
    }

    fn decode_integer_address(&self, value: u64, len: usize) -> Option<MemoryAddress> {
        let value = value as u32;
        let offset = usize::try_from(value & ADDRESS_OFFSET_MASK).ok()?;
        match value & !ADDRESS_OFFSET_MASK {
            0 | 0x0100_0000 => self.memory_address(MemoryAddress::global(value >> 24, offset), len),
            LOCAL_ADDRESS_BASE | LOCAL_ADDRESS_ALT_BASE => {
                self.memory_address(MemoryAddress::local(offset), len)
            }
            CODE_ADDRESS_BASE | CODE_ADDRESS_ALT_BASE => (offset.checked_add(len)?
                <= self.program.data().len())
            .then_some(MemoryAddress::code(offset)),
            0x1400_0000 | 0x1500_0000 => {
                self.memory_address(MemoryAddress::unknown((value >> 24) - 0x14, offset), len)
            }
            _ => self.decode_external_address(value, len),
        }
    }

    fn decode_integer_write_address(&self, value: u64, len: usize) -> Option<MemoryAddress> {
        let value = value as u32;
        let offset = usize::try_from(value & ADDRESS_OFFSET_MASK).ok()?;
        match value & !ADDRESS_OFFSET_MASK {
            0 | 0x0100_0000 => {
                self.write_memory_address(MemoryAddress::global(value >> 24, offset), len)
            }
            LOCAL_ADDRESS_BASE | LOCAL_ADDRESS_ALT_BASE => {
                self.write_memory_address(MemoryAddress::local(offset), len)
            }
            CODE_ADDRESS_BASE | CODE_ADDRESS_ALT_BASE => None,
            0x1400_0000 | 0x1500_0000 => {
                self.write_memory_address(MemoryAddress::unknown((value >> 24) - 0x14, offset), len)
            }
            _ => self.decode_external_write_address(value, len),
        }
    }

    fn decode_external_address(&self, address: u32, len: usize) -> Option<MemoryAddress> {
        let upper = address >> 24;
        let offset = usize::try_from(address & ADDRESS_OFFSET_MASK).ok()?;
        match upper {
            0x14 | 0x15 => self.memory_address(MemoryAddress::unknown(upper - 0x14, offset), len),
            0x20..=0x7f => {
                self.memory_address(MemoryAddress::aux((upper >> 1) - 0x10, offset), len)
            }
            _ => None,
        }
    }

    fn decode_external_write_address(&self, address: u32, len: usize) -> Option<MemoryAddress> {
        let upper = address >> 24;
        let offset = usize::try_from(address & ADDRESS_OFFSET_MASK).ok()?;
        match upper {
            0x14 | 0x15 => {
                self.write_memory_address(MemoryAddress::unknown(upper - 0x14, offset), len)
            }
            0x20..=0x7f => {
                self.write_memory_address(MemoryAddress::aux((upper >> 1) - 0x10, offset), len)
            }
            _ => None,
        }
    }

    fn memory_address(&self, address: MemoryAddress, len: usize) -> Option<MemoryAddress> {
        let end = address.offset.checked_add(len)?;
        let valid = match address.space {
            MemorySpace::Local => end <= LOCAL_MEM_SIZE,
            MemorySpace::Code => end <= self.program.data().len(),
            MemorySpace::Global(slot) => (slot as usize) < self.global_mem.len(),
            MemorySpace::Unknown(slot) => (slot as usize) < self.unknown_mem.len(),
            MemorySpace::Aux(slot) => (slot as usize) < self.aux_mem.len(),
        };
        valid.then_some(address)
    }

    fn write_memory_address(&self, address: MemoryAddress, len: usize) -> Option<MemoryAddress> {
        let end = address.offset.checked_add(len)?;
        let valid = match address.space {
            MemorySpace::Local => end <= LOCAL_MEM_SIZE,
            MemorySpace::Code => false,
            MemorySpace::Global(slot) => (slot as usize) < self.global_mem.len(),
            MemorySpace::Unknown(slot) => (slot as usize) < self.unknown_mem.len(),
            MemorySpace::Aux(slot) => (slot as usize) < self.aux_mem.len(),
        };
        valid.then_some(address)
    }

    fn value_string_snapshot(&self, value: &SystemValue<'_>) -> Option<Vec<u8>> {
        if let Some(bytes) = value.string_bytes() {
            return Some(bytes.to_vec());
        }
        if let SystemValue::Integer(value) = value {
            let value = *value as u32;
            return match value & !ADDRESS_OFFSET_MASK {
                CODE_ADDRESS_BASE | CODE_ADDRESS_ALT_BASE => {
                    self.read_program_c_string((value & ADDRESS_OFFSET_MASK) as usize)
                }
                LOCAL_ADDRESS_BASE | LOCAL_ADDRESS_ALT_BASE => {
                    self.read_local_c_string((value & ADDRESS_OFFSET_MASK) as usize)
                }
                0 | 0x0100_0000 => self.read_global_c_string(
                    (value >> 24) as usize,
                    (value & ADDRESS_OFFSET_MASK) as usize,
                ),
                0x1400_0000 | 0x1500_0000 => self.read_unknown_c_string(
                    ((value >> 24) - 0x14) as usize,
                    (value & ADDRESS_OFFSET_MASK) as usize,
                ),
                _ if value >> 24 >= 0x20 => self.read_aux_c_string(
                    ((value >> 1) - 0x10) as usize,
                    (value & ADDRESS_OFFSET_MASK) as usize,
                ),
                _ => None,
            };
        }
        if let SystemValue::Code(offset) = value {
            return self.read_program_c_string(*offset);
        }
        match value {
            SystemValue::VariablePointer(address) => {
                self.read_local_c_string(wrap_local_offset(*address) as usize)
            }
            SystemValue::LocalStringPointer { address, .. } => self.read_address_c_string(*address),
            _ => None,
        }
    }

    fn read_address_c_string(&self, address: u32) -> Option<Vec<u8>> {
        let upper = address >> 24;
        let offset = (address & ADDRESS_OFFSET_MASK) as usize;
        match upper {
            0 => self.read_global_c_string(0, offset),
            1 => self.read_global_c_string(1, offset),
            0x12 | 0x13 => self.read_local_c_string(offset),
            0x14 | 0x15 => self.read_unknown_c_string((upper - 0x14) as usize, offset),
            0x20..=0x7f => self.read_aux_c_string(((upper >> 1) - 0x10) as usize, offset),
            _ => self.read_local_c_string(wrap_local_offset(address) as usize),
        }
    }

    fn decode_local_address(&self, value: u64) -> Option<u32> {
        let value = value as u32;
        matches!(
            value & !ADDRESS_OFFSET_MASK,
            LOCAL_ADDRESS_BASE | LOCAL_ADDRESS_ALT_BASE
        )
        .then_some(value & ADDRESS_OFFSET_MASK)
    }

    fn write_host_integer(&mut self, address: u32, width: u8, value: u64) -> Result<()> {
        let len = int_width_len(width).unwrap_or(0);
        let address = self
            .decode_integer_write_address(u64::from(address), len)
            .ok_or_else(|| {
                SakuraError::InvalidScript(format!(
                    "host integer write address 0x{address:x} width {width} is out of range"
                ))
            })?;
        self.write_memory_value(address, width, SystemValue::Integer(value));
        Ok(())
    }

    fn write_host_bytes(&mut self, write: &SystemHostBytesWrite) -> Result<()> {
        let address = self
            .decode_integer_write_address(u64::from(write.address), write.bytes.len())
            .ok_or_else(|| {
                SakuraError::InvalidScript(format!(
                    "host byte write address 0x{:x} len {} is out of range",
                    write.address,
                    write.bytes.len()
                ))
            })?;
        self.write_memory_bytes(address, &write.bytes);
        Ok(())
    }

    fn read_local_c_string(&self, offset: usize) -> Option<Vec<u8>> {
        if let Some(value) = self.local_slots.get(&offset) {
            if let Some(bytes) = value.string_bytes() {
                return Some(bytes.to_vec());
            }
        }
        read_sparse_c_string(&self.local_mem, offset)
    }

    fn read_global_c_string(&self, slot: usize, offset: usize) -> Option<Vec<u8>> {
        if let Some(value) = self.global_slots.get(slot)?.get(&offset) {
            if let Some(bytes) = value.string_bytes() {
                return Some(bytes.to_vec());
            }
        }
        read_sparse_c_string(self.global_mem.get(slot)?, offset)
    }

    fn read_unknown_c_string(&self, slot: usize, offset: usize) -> Option<Vec<u8>> {
        if let Some(value) = self.unknown_slots.get(slot)?.get(&offset) {
            if let Some(bytes) = value.string_bytes() {
                return Some(bytes.to_vec());
            }
        }
        read_sparse_c_string(self.unknown_mem.get(slot)?, offset)
    }

    fn read_aux_c_string(&self, slot: usize, offset: usize) -> Option<Vec<u8>> {
        if let Some(value) = self.aux_slots.get(slot)?.get(&offset) {
            if let Some(bytes) = value.string_bytes() {
                return Some(bytes.to_vec());
            }
        }
        read_sparse_c_string(self.aux_mem.get(slot)?, offset)
    }

    /// Reads a NUL-terminated string from an auxiliary memory slot at the given
    /// byte offset. Used to resolve graph layer/archive tokens (small integer
    /// arguments that index into aux slot 0) into their bound asset entry names
    /// at the exact instant a graph service call is recorded, while the binding
    /// is still present in aux memory.
    pub(crate) fn aux_token_c_string(&self, slot: usize, offset: usize) -> Option<Vec<u8>> {
        self.read_aux_c_string(slot, offset)
    }

    fn read_program_c_string(&self, offset: usize) -> Option<Vec<u8>> {
        let tail = self.program.data().get(offset..)?;
        let len = tail.iter().position(|byte| *byte == 0)?;
        Some(tail[..len].to_vec())
    }

    fn read_local_int(&self, offset: usize, width: u8) -> Option<u64> {
        read_sparse_int(&self.local_mem, offset, width)
    }

    fn read_program_int(&self, offset: usize, width: u8) -> Option<u64> {
        let len = int_width_len(width)?;
        let end = offset.checked_add(len)?;
        let bytes = self.program.data().get(offset..end)?;
        Some(match width {
            0 => u64::from(bytes[0]),
            1 => u64::from(u16::from_le_bytes([bytes[0], bytes[1]])),
            2 => u64::from(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])),
            _ => return None,
        })
    }

    fn read_local_value(&self, offset: usize, width: u8) -> SystemValue<'a> {
        if width == 2 {
            if let Some(value) = self.local_slots.get(&offset) {
                return value.clone();
            }
        }
        self.read_local_int(offset, width)
            .map(|value| self.decode_stored_integer_value(value, width))
            .unwrap_or(SystemValue::Unknown)
    }

    fn read_global_value(&self, slot: usize, offset: usize, width: u8) -> SystemValue<'a> {
        if slot == 0 && self.script_index == 8 && (0x1d000..0x1f000).contains(&offset) {}
        if width == 2 {
            if let Some(value) = self
                .global_slots
                .get(slot)
                .and_then(|slots| slots.get(&offset))
            {
                return value.clone();
            }
        }
        self.read_global_int(slot, offset, width)
            .map(|value| self.decode_stored_integer_value(value, width))
            .unwrap_or(SystemValue::Unknown)
    }

    fn read_unknown_value(&self, slot: usize, offset: usize, width: u8) -> SystemValue<'a> {
        if width == 2 {
            if let Some(value) = self
                .unknown_slots
                .get(slot)
                .and_then(|slots| slots.get(&offset))
            {
                return value.clone();
            }
        }
        self.read_unknown_int(slot, offset, width)
            .map(|value| self.decode_stored_integer_value(value, width))
            .unwrap_or(SystemValue::Unknown)
    }

    fn read_aux_value(&self, slot: usize, offset: usize, width: u8) -> SystemValue<'a> {
        if width == 2 {
            if let Some(value) = self
                .aux_slots
                .get(slot)
                .and_then(|slots| slots.get(&offset))
            {
                return value.clone();
            }
        }
        self.read_aux_int(slot, offset, width)
            .map(|value| self.decode_stored_integer_value(value, width))
            .unwrap_or(SystemValue::Unknown)
    }

    fn read_memory_value(&self, address: MemoryAddress, width: u8) -> SystemValue<'a> {
        match address.space {
            MemorySpace::Local => self.read_local_value(address.offset, width),
            MemorySpace::Code => self
                .read_program_int(address.offset, width)
                .map(|value| self.decode_stored_integer_value(value, width))
                .unwrap_or(SystemValue::Unknown),
            MemorySpace::Global(slot) => {
                self.read_global_value(slot as usize, address.offset, width)
            }
            MemorySpace::Unknown(slot) => {
                self.read_unknown_value(slot as usize, address.offset, width)
            }
            MemorySpace::Aux(slot) => self.read_aux_value(slot as usize, address.offset, width),
        }
    }

    fn write_local_value(&mut self, offset: usize, width: u8, value: SystemValue<'a>) {
        let value = self.normalize_stored_value(value);
        if width == 2 {
            self.local_slots.insert(offset, value.clone());
        } else {
            self.local_slots.remove(&offset);
        }
        if let Some(bytes) = value.string_bytes() {
            self.write_local_c_string(offset, bytes);
            return;
        }
        if let Some(integer) = system_value_integer(&value) {
            self.write_local_int(offset, width, integer);
        }
    }

    fn write_global_value(
        &mut self,
        slot: usize,
        offset: usize,
        width: u8,
        value: SystemValue<'a>,
    ) {
        let value = self.normalize_stored_value(value);
        if width == 2 {
            self.global_slots[slot].insert(offset, value.clone());
        } else {
            self.global_slots[slot].remove(&offset);
        }
        if let Some(bytes) = value.string_bytes() {
            self.write_global_c_string(slot, offset, bytes);
            return;
        }
        if let Some(integer) = system_value_integer(&value) {
            let _ = self.write_global_int(slot, offset, width, integer);
        }
    }

    fn write_unknown_value(
        &mut self,
        slot: usize,
        offset: usize,
        width: u8,
        value: SystemValue<'a>,
    ) {
        let value = self.normalize_stored_value(value);
        if width == 2 {
            self.unknown_slots[slot].insert(offset, value.clone());
        } else {
            self.unknown_slots[slot].remove(&offset);
        }
        if let Some(bytes) = value.string_bytes() {
            self.write_unknown_c_string(slot, offset, bytes);
            return;
        }
        if let Some(integer) = system_value_integer(&value) {
            let _ = self.write_unknown_int(slot, offset, width, integer);
        }
    }

    fn write_aux_value(&mut self, slot: usize, offset: usize, width: u8, value: SystemValue<'a>) {
        let value = self.normalize_stored_value(value);
        if width == 2 {
            self.aux_slots[slot].insert(offset, value.clone());
        } else {
            self.aux_slots[slot].remove(&offset);
        }
        if let Some(bytes) = value.string_bytes() {
            self.write_aux_c_string(slot, offset, bytes);
            return;
        }
        if let Some(integer) = system_value_integer(&value) {
            let _ = self.write_aux_int(slot, offset, width, integer);
        }
    }

    fn write_memory_value(&mut self, address: MemoryAddress, width: u8, value: SystemValue<'a>) {
        match address.space {
            MemorySpace::Local => self.write_local_value(address.offset, width, value),
            MemorySpace::Code => {}
            MemorySpace::Global(slot) => {
                self.write_global_value(slot as usize, address.offset, width, value)
            }
            MemorySpace::Unknown(slot) => {
                self.write_unknown_value(slot as usize, address.offset, width, value)
            }
            MemorySpace::Aux(slot) => {
                self.write_aux_value(slot as usize, address.offset, width, value)
            }
        }
    }

    fn write_local_c_string(&mut self, offset: usize, bytes: &[u8]) {
        let len = bytes.len().saturating_add(1);
        let Some(end) = offset.checked_add(len) else {
            return;
        };
        if end > LOCAL_MEM_SIZE {
            return;
        }
        self.ensure_memory_len(MemorySpace::Local, end);
        self.local_mem[offset..offset + bytes.len()].copy_from_slice(bytes);
        self.local_mem[offset + bytes.len()] = 0;
    }

    fn clear_local_slots_in_range(&mut self, offset: usize, len: usize) {
        let Some(end) = offset.checked_add(len) else {
            self.local_slots.clear();
            return;
        };
        self.local_slots
            .retain(|slot_offset, _| *slot_offset < offset || *slot_offset >= end);
    }

    #[allow(dead_code)]
    fn clear_aux_slots_in_range(&mut self, offset: usize, len: usize) {
        let Some(end) = offset.checked_add(len) else {
            for slots in &mut self.aux_slots {
                slots.clear();
            }
            return;
        };
        for slots in &mut self.aux_slots {
            slots.retain(|slot_offset, _| *slot_offset < offset || *slot_offset >= end);
        }
    }

    fn clear_slots_in_range(
        slots: &mut BTreeMap<usize, SystemValue<'a>>,
        offset: usize,
        len: usize,
    ) {
        let Some(end) = offset.checked_add(len) else {
            slots.clear();
            return;
        };
        slots.retain(|slot_offset, _| *slot_offset < offset || *slot_offset >= end);
    }

    fn write_local_int(&mut self, offset: usize, width: u8, value: u64) {
        let Some(len) = int_width_len(width) else {
            return;
        };
        let Some(end) = offset.checked_add(len) else {
            return;
        };
        if end > LOCAL_MEM_SIZE {
            return;
        }
        self.ensure_memory_len(MemorySpace::Local, end);
        match width {
            0 => self.local_mem[offset] = value as u8,
            1 => self.local_mem[offset..offset + 2].copy_from_slice(&(value as u16).to_le_bytes()),
            2 => self.local_mem[offset..offset + 4].copy_from_slice(&(value as u32).to_le_bytes()),
            _ => {}
        }
    }

    fn write_global_c_string(&mut self, slot: usize, offset: usize, bytes: &[u8]) {
        let len = bytes.len().saturating_add(1);
        let Some(end) = offset.checked_add(len) else {
            return;
        };
        self.ensure_memory_len(MemorySpace::Global(slot as u32), end);
        self.global_mem[slot][offset..offset + bytes.len()].copy_from_slice(bytes);
        self.global_mem[slot][offset + bytes.len()] = 0;
    }

    fn write_unknown_c_string(&mut self, slot: usize, offset: usize, bytes: &[u8]) {
        let len = bytes.len().saturating_add(1);
        let Some(end) = offset.checked_add(len) else {
            return;
        };
        self.ensure_memory_len(MemorySpace::Unknown(slot as u32), end);
        self.unknown_mem[slot][offset..offset + bytes.len()].copy_from_slice(bytes);
        self.unknown_mem[slot][offset + bytes.len()] = 0;
    }

    fn write_aux_c_string(&mut self, slot: usize, offset: usize, bytes: &[u8]) {
        let len = bytes.len().saturating_add(1);
        let Some(end) = offset.checked_add(len) else {
            return;
        };
        self.ensure_memory_len(MemorySpace::Aux(slot as u32), end);
        self.aux_mem[slot][offset..offset + bytes.len()].copy_from_slice(bytes);
        self.aux_mem[slot][offset + bytes.len()] = 0;
    }

    fn write_global_int(
        &mut self,
        slot: usize,
        offset: usize,
        width: u8,
        value: u64,
    ) -> Result<()> {
        let len = int_width_len(width)
            .ok_or_else(|| SakuraError::InvalidScript("invalid global integer width".to_owned()))?;
        self.ensure_memory_len(MemorySpace::Global(slot as u32), offset + len);
        match width {
            0 => self.global_mem[slot][offset] = value as u8,
            1 => self.global_mem[slot][offset..offset + 2]
                .copy_from_slice(&(value as u16).to_le_bytes()),
            2 => self.global_mem[slot][offset..offset + 4]
                .copy_from_slice(&(value as u32).to_le_bytes()),
            _ => {}
        }
        Ok(())
    }

    fn write_unknown_int(
        &mut self,
        slot: usize,
        offset: usize,
        width: u8,
        value: u64,
    ) -> Result<()> {
        let len = int_width_len(width).ok_or_else(|| {
            SakuraError::InvalidScript("invalid unknown integer width".to_owned())
        })?;
        self.ensure_memory_len(MemorySpace::Unknown(slot as u32), offset + len);
        match width {
            0 => self.unknown_mem[slot][offset] = value as u8,
            1 => self.unknown_mem[slot][offset..offset + 2]
                .copy_from_slice(&(value as u16).to_le_bytes()),
            2 => self.unknown_mem[slot][offset..offset + 4]
                .copy_from_slice(&(value as u32).to_le_bytes()),
            _ => {}
        }
        Ok(())
    }

    fn write_aux_int(&mut self, slot: usize, offset: usize, width: u8, value: u64) -> Result<()> {
        let len = int_width_len(width)
            .ok_or_else(|| SakuraError::InvalidScript("invalid aux integer width".to_owned()))?;
        self.ensure_memory_len(MemorySpace::Aux(slot as u32), offset + len);
        match width {
            0 => self.aux_mem[slot][offset] = value as u8,
            1 => self.aux_mem[slot][offset..offset + 2]
                .copy_from_slice(&(value as u16).to_le_bytes()),
            2 => self.aux_mem[slot][offset..offset + 4]
                .copy_from_slice(&(value as u32).to_le_bytes()),
            _ => {}
        }
        Ok(())
    }

    fn read_global_int(&self, slot: usize, offset: usize, width: u8) -> Option<u64> {
        read_sparse_int(self.global_mem.get(slot)?, offset, width)
    }

    fn read_unknown_int(&self, slot: usize, offset: usize, width: u8) -> Option<u64> {
        read_sparse_int(self.unknown_mem.get(slot)?, offset, width)
    }

    fn read_aux_int(&self, slot: usize, offset: usize, width: u8) -> Option<u64> {
        read_sparse_int(self.aux_mem.get(slot)?, offset, width)
    }

    fn read_plain_integer(&self, address: MemoryAddress, width: u8) -> Option<u64> {
        match address.space {
            MemorySpace::Local => self.read_local_int(address.offset, width),
            MemorySpace::Code => self.read_program_int(address.offset, width),
            MemorySpace::Global(slot) => self.read_global_int(slot as usize, address.offset, width),
            MemorySpace::Unknown(slot) => {
                self.read_unknown_int(slot as usize, address.offset, width)
            }
            MemorySpace::Aux(slot) => self.read_aux_int(slot as usize, address.offset, width),
        }
    }

    fn read_memory_bytes(&self, address: MemoryAddress, len: usize) -> Result<Vec<u8>> {
        let bytes = match address.space {
            MemorySpace::Code => {
                let end = address.offset.checked_add(len).ok_or_else(|| {
                    SakuraError::InvalidScript("memory range overflows".to_owned())
                })?;
                self.program
                    .data()
                    .get(address.offset..end)
                    .map(|bytes| bytes.to_vec())
            }
            MemorySpace::Local => read_sparse_bytes(&self.local_mem, address.offset, len),
            MemorySpace::Global(slot) => {
                read_sparse_bytes(&self.global_mem[slot as usize], address.offset, len)
            }
            MemorySpace::Unknown(slot) => {
                read_sparse_bytes(&self.unknown_mem[slot as usize], address.offset, len)
            }
            MemorySpace::Aux(slot) => {
                read_sparse_bytes(&self.aux_mem[slot as usize], address.offset, len)
            }
        };
        bytes.ok_or_else(|| SakuraError::InvalidScript("memory range is out of bounds".to_owned()))
    }

    fn write_memory_bytes(&mut self, address: MemoryAddress, bytes: &[u8]) {
        let end = address.offset.saturating_add(bytes.len());
        match address.space {
            MemorySpace::Local => {
                self.ensure_memory_len(address.space, end);
                self.local_mem[address.offset..end].copy_from_slice(bytes);
                self.clear_local_slots_in_range(address.offset, bytes.len());
            }
            MemorySpace::Code => {}
            MemorySpace::Global(slot) => {
                self.ensure_memory_len(address.space, end);
                self.global_mem[slot as usize][address.offset..end].copy_from_slice(bytes);
                Self::clear_slots_in_range(
                    &mut self.global_slots[slot as usize],
                    address.offset,
                    bytes.len(),
                );
            }
            MemorySpace::Unknown(slot) => {
                self.ensure_memory_len(address.space, end);
                self.unknown_mem[slot as usize][address.offset..end].copy_from_slice(bytes);
                Self::clear_slots_in_range(
                    &mut self.unknown_slots[slot as usize],
                    address.offset,
                    bytes.len(),
                );
            }
            MemorySpace::Aux(slot) => {
                self.ensure_memory_len(address.space, end);
                self.aux_mem[slot as usize][address.offset..end].copy_from_slice(bytes);
                Self::clear_slots_in_range(
                    &mut self.aux_slots[slot as usize],
                    address.offset,
                    bytes.len(),
                );
            }
        }
    }

    fn ensure_memory_len(&mut self, space: MemorySpace, end: usize) {
        if end > LOCAL_MEM_SIZE {
            return;
        }
        match space {
            MemorySpace::Local => {
                if end > self.local_mem.len() {
                    self.local_mem.resize(end, 0);
                }
            }
            MemorySpace::Code => {}
            MemorySpace::Global(slot) => {
                let mem = &mut self.global_mem[slot as usize];
                if end > mem.len() {
                    mem.resize(end, 0);
                }
            }
            MemorySpace::Unknown(slot) => {
                let mem = &mut self.unknown_mem[slot as usize];
                if end > mem.len() {
                    mem.resize(end, 0);
                }
            }
            MemorySpace::Aux(slot) => {
                let mem = &mut self.aux_mem[slot as usize];
                if end > mem.len() {
                    mem.resize(end, 0);
                }
            }
        }
    }

    fn decode_stored_integer_value(&self, value: u64, width: u8) -> SystemValue<'a> {
        if width != 2 {
            return SystemValue::Integer(value);
        }
        let value32 = value as u32;
        match value32 & !ADDRESS_OFFSET_MASK {
            CODE_ADDRESS_BASE | CODE_ADDRESS_ALT_BASE => {
                let offset = usize::try_from(value32 & ADDRESS_OFFSET_MASK).ok();
                offset
                    .and_then(|offset| self.value_code_target(SystemValue::Code(offset)))
                    .map_or(SystemValue::Integer(value), SystemValue::Code)
            }
            LOCAL_ADDRESS_BASE | LOCAL_ADDRESS_ALT_BASE => {
                SystemValue::VariablePointer(wrap_local_offset(value32 & ADDRESS_OFFSET_MASK))
            }
            _ => SystemValue::Integer(value),
        }
    }

    fn normalize_stored_value(&self, value: SystemValue<'a>) -> SystemValue<'a> {
        match value {
            SystemValue::Code(offset) => SystemValue::CodeInScript {
                script_index: self.script_index,
                offset,
            },
            other => other,
        }
    }
}

fn sparse_range_end(offset: usize, len: usize) -> Option<usize> {
    let end = offset.checked_add(len)?;
    (end <= LOCAL_MEM_SIZE).then_some(end)
}

fn read_sparse_bytes(mem: &[u8], offset: usize, len: usize) -> Option<Vec<u8>> {
    sparse_range_end(offset, len)?;
    let mut out = vec![0; len];
    if offset >= mem.len() || len == 0 {
        return Some(out);
    }
    let available = mem.len().saturating_sub(offset).min(len);
    out[..available].copy_from_slice(&mem[offset..offset + available]);
    Some(out)
}

fn read_sparse_int(mem: &[u8], offset: usize, width: u8) -> Option<u64> {
    let len = int_width_len(width)?;
    let bytes = read_sparse_bytes(mem, offset, len)?;
    Some(match width {
        0 => u64::from(bytes[0]),
        1 => u64::from(u16::from_le_bytes([bytes[0], bytes[1]])),
        2 => u64::from(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])),
        _ => return None,
    })
}

fn read_sparse_c_string(mem: &[u8], offset: usize) -> Option<Vec<u8>> {
    if offset > LOCAL_MEM_SIZE {
        return None;
    }
    if offset >= mem.len() {
        return Some(Vec::new());
    }
    let tail = &mem[offset..];
    let len = tail
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(tail.len());
    Some(tail[..len].to_vec())
}

impl<'a> From<SystemValue<'a>> for SystemValueSnapshot {
    fn from(value: SystemValue<'a>) -> Self {
        match value {
            SystemValue::Integer(value) => Self::Integer(value),
            SystemValue::String(bytes) => Self::String(bytes.to_vec()),
            SystemValue::OwnedString(bytes) => Self::String(bytes),
            SystemValue::LocalStringPointer { address, bytes } => {
                Self::LocalStringPointer { address, bytes }
            }
            SystemValue::Code(offset) => Self::Code(offset),
            SystemValue::CodeInScript {
                script_index,
                offset,
            } => Self::CodeInScript {
                script_index,
                offset,
            },
            SystemValue::VariablePointer(address) => Self::VariablePointer(address),
            SystemValue::UserScriptHandle(handle) => Self::UserScriptHandle(handle),
            SystemValue::UserScriptResult(service_id) => Self::UserScriptResult(service_id),
            SystemValue::Unknown => Self::Unknown,
        }
    }
}

impl SystemValueSnapshot {
    pub(crate) fn into_runtime_value<'a>(self) -> SystemValue<'a> {
        match self {
            Self::Integer(value) => SystemValue::Integer(value),
            Self::String(bytes) => SystemValue::OwnedString(bytes),
            Self::LocalStringPointer { address, bytes } => {
                SystemValue::LocalStringPointer { address, bytes }
            }
            Self::Code(offset) => SystemValue::Code(offset),
            Self::CodeInScript {
                script_index,
                offset,
            } => SystemValue::CodeInScript {
                script_index,
                offset,
            },
            Self::VariablePointer(address) => SystemValue::VariablePointer(address),
            Self::UserScriptHandle(handle) => SystemValue::UserScriptHandle(handle),
            Self::UserScriptResult(service_id) => SystemValue::UserScriptResult(service_id),
            Self::Unknown => SystemValue::Unknown,
        }
    }
}

fn int_width_len(width: u8) -> Option<usize> {
    match width {
        0 => Some(1),
        1 => Some(2),
        2 => Some(4),
        _ => None,
    }
}

fn wrap_local_offset(address: u32) -> u32 {
    address & ADDRESS_OFFSET_MASK
}

fn snapshot_slot_map<'a>(
    slots: &BTreeMap<usize, SystemValue<'a>>,
) -> BTreeMap<usize, SystemValueSnapshot> {
    slots
        .iter()
        .map(|(offset, value)| (*offset, SystemValueSnapshot::from(value.clone())))
        .collect()
}

fn restore_slot_map<'a>(
    slots: BTreeMap<usize, SystemValueSnapshot>,
) -> BTreeMap<usize, SystemValue<'a>> {
    slots
        .into_iter()
        .map(|(offset, value)| (offset, value.into_runtime_value()))
        .collect()
}

fn vec_into_array<T, const N: usize>(value: Vec<T>) -> std::result::Result<[T; N], Vec<T>> {
    value.try_into()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MemorySpace {
    Local,
    Code,
    Global(u32),
    Unknown(u32),
    Aux(u32),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct MemoryAddress {
    space: MemorySpace,
    offset: usize,
}

impl MemoryAddress {
    fn local(offset: usize) -> Self {
        Self {
            space: MemorySpace::Local,
            offset,
        }
    }

    fn code(offset: usize) -> Self {
        Self {
            space: MemorySpace::Code,
            offset,
        }
    }

    fn global(slot: u32, offset: usize) -> Self {
        Self {
            space: MemorySpace::Global(slot),
            offset,
        }
    }

    fn unknown(slot: u32, offset: usize) -> Self {
        Self {
            space: MemorySpace::Unknown(slot),
            offset,
        }
    }

    fn aux(slot: u32, offset: usize) -> Self {
        Self {
            space: MemorySpace::Aux(slot),
            offset,
        }
    }

    fn offset(self) -> usize {
        self.offset
    }

    fn with_offset(self, offset: usize) -> Self {
        Self { offset, ..self }
    }
}

#[derive(Debug, Clone, Copy, Default)]
struct SprintfSpec {
    left: bool,
    force_sign: bool,
    space_sign: bool,
    alternate: bool,
    zero_pad: bool,
    width: Option<i32>,
    precision: Option<i32>,
    specifier: u8,
}

fn service_accepts_pointer_strings(family: SystemCallFamily, service_id: u8) -> bool {
    match family {
        SystemCallFamily::System => {
            matches!(
                service_id,
                0x30 | 0x31 | 0x32 | 0x34 | 0x35 | 0x40 | 0x88 | 0x8a | 0x8b
            )
        }
        SystemCallFamily::Sound => true,
        _ => false,
    }
}

fn append_padded_bytes(
    output: &mut Vec<u8>,
    bytes: &[u8],
    width: Option<i32>,
    precision: Option<i32>,
    left: bool,
) {
    let len = precision
        .and_then(|precision| usize::try_from(precision).ok())
        .map_or(bytes.len(), |precision| bytes.len().min(precision));
    let bytes = &bytes[..len];
    let pad = width
        .and_then(|width| usize::try_from(width).ok())
        .unwrap_or(0)
        .saturating_sub(bytes.len());
    if !left {
        output.resize(output.len() + pad, b' ');
    }
    output.extend_from_slice(bytes);
    if left {
        output.resize(output.len() + pad, b' ');
    }
}

fn append_formatted_integer(
    output: &mut Vec<u8>,
    negative: bool,
    value: u64,
    radix: u8,
    uppercase: bool,
    spec: &SprintfSpec,
) {
    let mut digits = integer_digits(value, radix, uppercase);
    if value == 0 && spec.precision == Some(0) {
        digits.clear();
    }
    if let Some(precision) = spec.precision.and_then(|value| usize::try_from(value).ok()) {
        if precision > digits.len() {
            let mut padded = vec![b'0'; precision - digits.len()];
            padded.extend_from_slice(&digits);
            digits = padded;
        }
    }
    let mut prefix = Vec::with_capacity(3);
    if negative {
        prefix.push(b'-');
    } else if spec.force_sign {
        prefix.push(b'+');
    } else if spec.space_sign {
        prefix.push(b' ');
    }
    if spec.alternate || spec.specifier == b'p' {
        match spec.specifier {
            b'x' | b'p' if value != 0 || spec.specifier == b'p' => prefix.extend_from_slice(b"0x"),
            b'X' if value != 0 => prefix.extend_from_slice(b"0X"),
            b'o' if !digits.starts_with(b"0") => prefix.push(b'0'),
            _ => {}
        }
    }
    let width = spec
        .width
        .and_then(|width| usize::try_from(width).ok())
        .unwrap_or(0);
    let field_len = prefix.len().saturating_add(digits.len());
    let pad = width.saturating_sub(field_len);
    if !spec.left && !(spec.zero_pad && spec.precision.is_none()) {
        output.resize(output.len() + pad, b' ');
    }
    output.extend_from_slice(&prefix);
    if !spec.left && spec.zero_pad && spec.precision.is_none() {
        output.resize(output.len() + pad, b'0');
    }
    output.extend_from_slice(&digits);
    if spec.left {
        output.resize(output.len() + pad, b' ');
    }
}

fn integer_digits(mut value: u64, radix: u8, uppercase: bool) -> Vec<u8> {
    let alphabet = if uppercase {
        b"0123456789ABCDEF"
    } else {
        b"0123456789abcdef"
    };
    if value == 0 {
        return vec![b'0'];
    }
    let mut digits = Vec::new();
    let radix = u64::from(radix);
    while value != 0 {
        digits.push(alphabet[(value % radix) as usize]);
        value /= radix;
    }
    digits.reverse();
    digits
}

fn conditional_branch_taken(condition: u8, value: u64) -> bool {
    let signed = value as i64;
    match condition {
        0 => value != 0,
        1 => value == 0,
        2 => signed > 0,
        3 => signed >= 0,
        4 => signed <= 0,
        5 => signed < 0,
        _ => true,
    }
}

fn eval_typed_binary<'a>(
    opcode: u8,
    left: Option<&SystemValue<'a>>,
    right: Option<&SystemValue<'a>>,
) -> Option<SystemValue<'a>> {
    match (opcode, left?, right?) {
        (0x20, SystemValue::VariablePointer(address), right) => {
            let right = plain_integer(right)?;
            Some(SystemValue::VariablePointer(
                address.wrapping_add(right as u32),
            ))
        }
        (0x20, left, SystemValue::VariablePointer(address)) => {
            let left = plain_integer(left)?;
            Some(SystemValue::VariablePointer(
                address.wrapping_add(left as u32),
            ))
        }
        (0x21, SystemValue::VariablePointer(address), right) => {
            let right = plain_integer(right)?;
            Some(SystemValue::VariablePointer(
                address.wrapping_sub(right as u32),
            ))
        }
        (0x20, SystemValue::Code(offset), right) => {
            let right = usize::try_from(plain_integer(right)?).ok()?;
            offset.checked_add(right).map(SystemValue::Code)
        }
        (0x20, left, SystemValue::Code(offset)) => {
            let left = usize::try_from(plain_integer(left)?).ok()?;
            offset.checked_add(left).map(SystemValue::Code)
        }
        (0x21, SystemValue::Code(offset), right) => {
            let right = usize::try_from(plain_integer(right)?).ok()?;
            offset.checked_sub(right).map(SystemValue::Code)
        }
        _ => None,
    }
}

fn plain_integer(value: &SystemValue<'_>) -> Option<u64> {
    match value {
        SystemValue::Integer(value) => Some(*value),
        SystemValue::UserScriptHandle(handle) => Some(u64::from(*handle)),
        SystemValue::UserScriptResult(_) => Some(0),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pauses_on_service_call_with_typed_args() -> Result<()> {
        let mut script = vec![0u8; 0x10];
        script.extend_from_slice(&[0x00, 0x2a, 0x91, 0x88, 0x17]);
        let mut vm = SystemVm::parse(&script)?;

        assert_eq!(
            vm.next_event()?,
            SystemVmEvent::ServiceCall {
                family: SystemCallFamily::Graph,
                service_id: 0x88,
                args: vec![SystemValue::Integer(0x2a)],
            }
        );
        vm.resume_with(SystemValue::Unknown)?;
        assert_eq!(vm.next_event()?, SystemVmEvent::Halted);
        Ok(())
    }

    #[test]
    fn carries_service_return_into_user_script_call() -> Result<()> {
        let mut script = vec![0u8; 0x10];
        script.extend_from_slice(&[0x00, 0x07, 0xb0, 0xff, 0xff, 0x00, 0x17]);
        let mut vm = SystemVm::parse(&script)?;

        assert_eq!(
            vm.next_event()?,
            SystemVmEvent::ServiceCall {
                family: SystemCallFamily::External,
                service_id: 0xff,
                args: vec![SystemValue::Integer(7)],
            }
        );
        vm.resume_with(SystemValue::Integer(99))?;
        assert_eq!(
            vm.next_event()?,
            SystemVmEvent::UserScriptCall {
                service_id: 0x00,
                args: vec![SystemValue::Integer(99)],
            }
        );
        Ok(())
    }

    #[test]
    fn evaluates_basic_integer_stack_ops_before_service_call() -> Result<()> {
        let mut script = vec![0u8; 0x10];
        script.extend_from_slice(&[0x00, 0x02, 0x00, 0x03, 0x20, 0x00, 0x05, 0x30, 0x80, 0x46]);
        let mut vm = SystemVm::parse(&script)?;

        assert_eq!(
            vm.next_event()?,
            SystemVmEvent::ServiceCall {
                family: SystemCallFamily::System,
                service_id: 0x46,
                args: vec![SystemValue::Integer(1)],
            }
        );
        Ok(())
    }

    #[test]
    fn stores_and_loads_local_variables() -> Result<()> {
        let mut script = vec![0u8; 0x10];
        script.extend_from_slice(&[
            0x00, 0x20, 0x11, 0x00, 0x05, 0x04, 0x04, 0x00, 0x0a, 0x02, 0x04, 0x04, 0x00, 0x08,
            0x02, 0x80, 0x46,
        ]);
        let mut vm = SystemVm::parse(&script)?;

        assert_eq!(
            vm.next_event()?,
            SystemVmEvent::ServiceCall {
                family: SystemCallFamily::System,
                service_id: 0x46,
                args: vec![SystemValue::Integer(5)],
            }
        );
        Ok(())
    }

    #[test]
    fn preserves_typed_dword_local_values() -> Result<()> {
        let mut script = vec![0u8; 0x10];
        script.extend_from_slice(&[0x00, 0x20, 0x11]);
        script.push(0x05);
        script.extend_from_slice(&15i16.to_le_bytes());
        script.extend_from_slice(&[
            0x04, 0x04, 0x00, 0x0a, 0x02, 0x04, 0x04, 0x00, 0x08, 0x02, 0x80, 0x46,
        ]);
        script.extend_from_slice(b"synthetic\0");
        let mut vm = SystemVm::parse(&script)?;

        assert_eq!(
            vm.next_event()?,
            SystemVmEvent::ServiceCall {
                family: SystemCallFamily::System,
                service_id: 0x46,
                args: vec![SystemValue::String(b"synthetic")],
            }
        );
        Ok(())
    }

    #[test]
    fn concatenates_strings_into_local_slot() -> Result<()> {
        let mut script = vec![0u8; 0x10];
        script.extend_from_slice(&[0x00, 0x20, 0x11]);
        script.push(0x04);
        script.extend_from_slice(&8u16.to_le_bytes());
        script.push(0x05);
        script.extend_from_slice(&14i16.to_le_bytes());
        script.push(0x05);
        script.extend_from_slice(&15i16.to_le_bytes());
        script.extend_from_slice(&[0x6b, 0x04, 0x08, 0x00, 0x08, 0x02, 0x80, 0x46]);
        script.extend_from_slice(b"one\0two\0");
        let mut vm = SystemVm::parse(&script)?;

        assert_eq!(
            vm.next_event()?,
            SystemVmEvent::ServiceCall {
                family: SystemCallFamily::System,
                service_id: 0x46,
                args: vec![SystemValue::OwnedString(b"onetwo".to_vec())],
            }
        );
        Ok(())
    }

    #[test]
    fn reads_copied_local_strings_for_string_ops() -> Result<()> {
        let mut script = vec![0u8; 0x10];
        script.extend_from_slice(&[0x00, 0x20, 0x11]);
        script.push(0x05);
        script.extend_from_slice(&21i16.to_le_bytes());
        script.extend_from_slice(&[
            0x04, 0x08, 0x00, 0x0a, 0x02, 0x04, 0x08, 0x00, 0x68, 0x04, 0x08, 0x00, 0x05,
        ]);
        script.extend_from_slice(&10i16.to_le_bytes());
        script.extend_from_slice(&[0x69, 0x80, 0x46]);
        script.extend_from_slice(b"abc\0abc\0");
        let mut vm = SystemVm::parse(&script)?;

        assert_eq!(
            vm.next_event()?,
            SystemVmEvent::ServiceCall {
                family: SystemCallFamily::System,
                service_id: 0x46,
                args: vec![SystemValue::Integer(3), SystemValue::Integer(1)],
            }
        );
        Ok(())
    }

    #[test]
    fn applies_local_memory_copy_set_and_compare() -> Result<()> {
        let mut script = vec![0u8; 0x10];
        script.extend_from_slice(&[0x00, 0x20, 0x11]);
        script.push(0x05);
        script.extend_from_slice(&41i16.to_le_bytes());
        script.extend_from_slice(&[
            0x04, 0x08, 0x00, 0x0a, 0x02, 0x04, 0x10, 0x00, 0x04, 0x08, 0x00, 0x00, 0x03, 0x60,
            0x04, 0x10, 0x00, 0x04, 0x08, 0x00, 0x00, 0x03, 0x63, 0x04, 0x14, 0x00, 0x00, 0x02,
            0x00, 0xff, 0x62, 0x04, 0x14, 0x00, 0x08, 0x00, 0x80, 0x46,
        ]);
        script.extend_from_slice(b"abc\0");
        let mut vm = SystemVm::parse(&script)?;

        assert_eq!(
            vm.next_event()?,
            SystemVmEvent::ServiceCall {
                family: SystemCallFamily::System,
                service_id: 0x46,
                args: vec![SystemValue::Integer(1), SystemValue::Integer(0xff)],
            }
        );
        Ok(())
    }

    #[test]
    fn storemulti_writes_frame_relative_values() -> Result<()> {
        let mut script = vec![0u8; 0x10];
        script.extend_from_slice(&[
            0x00, 0x20, 0x11, 0x04, 0x08, 0x00, 0x00, 0x0b, 0x00, 0x16, 0x0c, 0x02, 0x02, 0x04,
            0x08, 0x00, 0x08, 0x02, 0x04, 0x04, 0x00, 0x08, 0x02, 0x80, 0x46,
        ]);
        let mut vm = SystemVm::parse(&script)?;

        assert_eq!(
            vm.next_event()?,
            SystemVmEvent::ServiceCall {
                family: SystemCallFamily::System,
                service_id: 0x46,
                args: vec![SystemValue::Integer(11), SystemValue::Integer(22)],
            }
        );
        Ok(())
    }

    #[test]
    fn executes_call_and_return_control_flow() -> Result<()> {
        let mut script = vec![0u8; 0x10];
        script.extend_from_slice(&[
            0x06, 0x09, 0x00, 0x16, 0x00, 0x02, 0xa0, 0x46, 0x17, 0x00, 0x01, 0x17,
        ]);
        let mut vm = SystemVm::parse(&script)?;

        assert_eq!(
            vm.next_event()?,
            SystemVmEvent::ServiceCall {
                family: SystemCallFamily::Sound,
                service_id: 0x46,
                args: vec![SystemValue::Integer(1), SystemValue::Integer(2)],
            }
        );
        vm.resume_with(SystemValue::Unknown)?;
        assert_eq!(vm.next_event()?, SystemVmEvent::Halted);
        Ok(())
    }

    #[test]
    fn preserves_code_offsets_through_local_pointer_tables() -> Result<()> {
        let mut script = vec![0u8; 0x10];
        script.extend_from_slice(&[
            0x00, 0x20, 0x11, 0x06, 0x16, 0x00, 0x04, 0x08, 0x00, 0x0a, 0x02, 0x04, 0x08, 0x00,
            0x00, 0x00, 0x20, 0x08, 0x02, 0x16, 0x00, 0x02, 0xa0, 0x46, 0x17, 0x00, 0x01, 0x17,
        ]);
        let mut vm = SystemVm::parse(&script)?;

        assert_eq!(
            vm.next_event()?,
            SystemVmEvent::ServiceCall {
                family: SystemCallFamily::Sound,
                service_id: 0x46,
                args: vec![SystemValue::Integer(1), SystemValue::Integer(2)],
            }
        );
        Ok(())
    }

    #[test]
    fn dispatches_codeoffset_table_using_frame_index() -> Result<()> {
        let frame_size = 24u16;
        let arg_slot = frame_size;
        let table_slot = frame_size - 4;
        let mut script = vec![0u8; 0x10];
        script.extend_from_slice(&[0x10, 0x00, frame_size as u8, 0x20, 0x11, 0x04]);
        script.extend_from_slice(&arg_slot.to_le_bytes());
        script.extend_from_slice(&[0x0a, 0x02, 0x04]);
        script.extend_from_slice(&table_slot.to_le_bytes());
        let first_target_operand = push_codeoffset_placeholder(&mut script);
        let second_target_operand = push_codeoffset_placeholder(&mut script);
        script.extend_from_slice(&[0x0c, 0x02, 0x02, 0x04]);
        script.extend_from_slice(&table_slot.to_le_bytes());
        script.push(0x04);
        script.extend_from_slice(&arg_slot.to_le_bytes());
        script.extend_from_slice(&[0x08, 0x02, 0x00, 0x02, 0x29, 0x20, 0x08, 0x02, 0x16]);
        let first_target = script.len();
        script.extend_from_slice(&[0x00, 0x09, 0xa0, 0x46, 0x17]);
        let second_target = script.len();
        script.extend_from_slice(&[0x00, 0x01, 0xa0, 0x46, 0x17]);
        patch_codeoffset(&mut script, first_target_operand, first_target);
        patch_codeoffset(&mut script, second_target_operand, second_target);
        let mut vm = SystemVm::parse(&script)?;
        vm.resume_with(SystemValue::Integer(1))?;

        assert_eq!(
            vm.next_event()?,
            SystemVmEvent::ServiceCall {
                family: SystemCallFamily::Sound,
                service_id: 0x46,
                args: vec![SystemValue::Integer(1)],
            }
        );
        Ok(())
    }

    #[test]
    fn wraps_frame_relative_local_pointers_into_masked_local_space() -> Result<()> {
        let mut script = vec![0u8; 0x10];
        script.extend_from_slice(&[
            0x04, 0x04, 0x00, 0x00, 0x2a, 0x0a, 0x02, 0x04, 0x04, 0x00, 0x08, 0x02, 0x80, 0x46,
        ]);
        let mut vm = SystemVm::parse(&script)?;
        vm.resume_with(SystemValue::Integer(1))?;

        assert_eq!(
            vm.next_event()?,
            SystemVmEvent::ServiceCall {
                family: SystemCallFamily::System,
                service_id: 0x46,
                args: vec![SystemValue::Integer(1), SystemValue::Integer(0)],
            }
        );
        assert_eq!(vm.host_local_integer(ADDRESS_OFFSET_MASK - 3, 2), Some(0));
        Ok(())
    }

    #[test]
    fn host_byte_write_expands_aux_memory_targets() -> Result<()> {
        let script = vec![0u8; 0x10];
        let mut vm = SystemVm::parse(&script)?;
        let bytes = vec![0x12, 0x34, 0x56, 0x78];

        vm.apply_host_write(&SystemHostWrite::Bytes(SystemHostBytesWrite {
            address: 0x2040_6000,
            bytes: bytes.clone(),
        }))?;

        assert_eq!(vm.host_integer_raw(0x2040_6000, 2), Some(0x7856_3412));
        Ok(())
    }

    #[test]
    fn host_bytes_raw_reads_code_space_for_debug_probes() -> Result<()> {
        let mut script = vec![0u8; 0x10];
        script.extend_from_slice(b"code-bytes");
        let vm = SystemVm::parse(&script)?;

        assert_eq!(
            vm.host_bytes_raw(CODE_ADDRESS_BASE | 0x10, 10),
            Some(b"code-bytes".to_vec())
        );
        assert_eq!(vm.host_bytes_raw(CODE_ADDRESS_BASE | 0x19, 16), None);
        Ok(())
    }

    fn push_codeoffset_placeholder(script: &mut Vec<u8>) -> usize {
        script.push(0x06);
        let operand_offset = script.len();
        script.extend_from_slice(&0i16.to_le_bytes());
        operand_offset
    }

    fn patch_codeoffset(script: &mut [u8], operand_offset: usize, target: usize) {
        let opcode_offset = operand_offset - 1;
        let displacement = i16::try_from(target as isize - opcode_offset as isize).unwrap();
        script[operand_offset..operand_offset + 2].copy_from_slice(&displacement.to_le_bytes());
    }

    #[test]
    fn halts_on_truncated_tail_like_static_disassembler() -> Result<()> {
        let mut script = vec![0u8; 0x10];
        script.push(0x05);
        let mut vm = SystemVm::parse(&script)?;

        assert_eq!(vm.next_event()?, SystemVmEvent::Halted);
        assert!(vm.is_halted());
        Ok(())
    }

    #[test]
    fn halts_on_zero_filled_padding_tail() -> Result<()> {
        let script = vec![0u8; 0x100];
        let mut vm = SystemVm::parse(&script)?;

        assert_eq!(vm.next_event()?, SystemVmEvent::Halted);
        assert_eq!(vm.stack().len(), 0);
        Ok(())
    }

    #[test]
    fn halts_on_long_zero_padding_run_before_trailing_data() -> Result<()> {
        let mut script = vec![0u8; 0x10 + ZERO_PADDING_RUN];
        script.push(0x17);
        let mut vm = SystemVm::parse(&script)?;

        assert_eq!(vm.next_event()?, SystemVmEvent::Halted);
        assert_eq!(vm.stack().len(), 0);
        Ok(())
    }

    #[test]
    fn halts_on_long_push8_table_run() -> Result<()> {
        let mut script = vec![0u8; 0x10];
        for value in 0..PUSH8_TABLE_RUN {
            script.push(0x00);
            script.push((value & 0xff) as u8);
        }
        script.push(0x17);
        let mut vm = SystemVm::parse(&script)?;

        assert_eq!(vm.next_event()?, SystemVmEvent::Halted);
        assert_eq!(vm.stack().len(), 0);
        Ok(())
    }

    #[test]
    fn applies_signed_conditional_branch_kinds() -> Result<()> {
        assert!(conditional_branch_taken(2, 1));
        assert!(!conditional_branch_taken(2, 0));
        assert!(conditional_branch_taken(3, 0));
        assert!(conditional_branch_taken(4, u64::MAX));
        assert!(conditional_branch_taken(5, u64::MAX));
        assert!(!conditional_branch_taken(5, 1));
        Ok(())
    }
}
