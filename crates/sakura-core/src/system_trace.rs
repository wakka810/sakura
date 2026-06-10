use crate::error::Result;
use crate::system_bytecode::{
    SystemCallFamily, SystemInstructionKind, SystemProgram, SystemUserScriptOp,
};
use crate::system_vm_ops::{eval_basic_binary_integer, eval_extended_binary_integer};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

const STACK_BUCKETS: usize = 8;
const MAX_TRACKED_STACK: usize = 64;
const UNKNOWN_SOURCE_GENERIC: u16 = 0;
const UNKNOWN_SOURCE_WIDTH: u16 = 1;
const UNKNOWN_SOURCE_ARRAY: u16 = 2;
const UNKNOWN_SOURCE_SHORT: u16 = 3;
const UNKNOWN_SOURCE_NO_OPERAND: u16 = 4;
const UNKNOWN_SOURCE_USER_DISPATCH_BASE: u16 = 0x100;
const UNKNOWN_SOURCE_SYSTEM_SERVICE_BASE: u16 = 0x200;
const UNKNOWN_SOURCE_GRAPH_SERVICE_BASE: u16 = 0x300;
const UNKNOWN_SOURCE_SOUND_SERVICE_BASE: u16 = 0x400;
const UNKNOWN_SOURCE_EXTERNAL_SERVICE_BASE: u16 = 0x500;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SystemTraceSummary {
    pub instruction_count: usize,
    pub max_stack_depth: usize,
    pub decode_error_count: usize,
    pub service_call_count: usize,
    pub user_script_dispatch_count: usize,
    pub dispatch_arg_count_buckets: [usize; STACK_BUCKETS],
    pub dispatch_empty_stack_counts: [usize; 256],
    pub dispatch_top_integer_counts: [usize; 256],
    pub dispatch_top_string_counts: [usize; 256],
    pub dispatch_top_code_counts: [usize; 256],
    pub dispatch_top_handle_counts: [usize; 256],
    pub dispatch_top_user_result_counts: [usize; 256],
    pub dispatch_top_pointer_counts: [usize; 256],
    pub dispatch_top_unknown_counts: [usize; 256],
    pub dispatch_top_u8_value_counts: [usize; 256],
    pub dispatch_unknown_sources: Vec<SystemTraceUnknownSourceCount>,
    pub service_input_top_kinds: Vec<SystemTraceSourceValueCount>,
    pub service_input_arg_buckets: Vec<SystemTraceSourceValueCount>,
}

impl Default for SystemTraceSummary {
    fn default() -> Self {
        Self {
            instruction_count: 0,
            max_stack_depth: 0,
            decode_error_count: 0,
            service_call_count: 0,
            user_script_dispatch_count: 0,
            dispatch_arg_count_buckets: [0; STACK_BUCKETS],
            dispatch_empty_stack_counts: [0; 256],
            dispatch_top_integer_counts: [0; 256],
            dispatch_top_string_counts: [0; 256],
            dispatch_top_code_counts: [0; 256],
            dispatch_top_handle_counts: [0; 256],
            dispatch_top_user_result_counts: [0; 256],
            dispatch_top_pointer_counts: [0; 256],
            dispatch_top_unknown_counts: [0; 256],
            dispatch_top_u8_value_counts: [0; 256],
            dispatch_unknown_sources: Vec::new(),
            service_input_top_kinds: Vec::new(),
            service_input_arg_buckets: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SystemTraceUnknownSourceCount {
    pub dispatch_id: u8,
    pub source_code: u16,
    pub count: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SystemTraceSourceValueCount {
    pub source_code: u16,
    pub value_code: u8,
    pub count: usize,
}

pub fn trace_system_script(data: &[u8]) -> Result<SystemTraceSummary> {
    let program = SystemProgram::parse(data)?;
    let mut tracer = SystemTracer::new(program);
    tracer.trace()?;
    Ok(tracer.summary)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TraceValue {
    Unknown(u16),
    Integer(u64),
    String { len: usize },
    Code(Option<usize>),
    UserScriptHandle,
    UserScriptResult(u8),
    Pointer,
}

#[derive(Debug)]
struct SystemTracer<'a> {
    program: SystemProgram<'a>,
    queue: VecDeque<(usize, Vec<TraceValue>)>,
    visited: BTreeSet<usize>,
    summary: SystemTraceSummary,
    unknown_sources: BTreeMap<(u8, u16), usize>,
    service_input_top_kinds: BTreeMap<(u16, u8), usize>,
    service_input_arg_buckets: BTreeMap<(u16, u8), usize>,
}

impl<'a> SystemTracer<'a> {
    fn new(program: SystemProgram<'a>) -> Self {
        let mut queue = VecDeque::new();
        queue.push_back((program.code_offset(), Vec::new()));
        Self {
            program,
            queue,
            visited: BTreeSet::new(),
            summary: SystemTraceSummary::default(),
            unknown_sources: BTreeMap::new(),
            service_input_top_kinds: BTreeMap::new(),
            service_input_arg_buckets: BTreeMap::new(),
        }
    }

    fn trace(&mut self) -> Result<()> {
        while let Some((mut cursor, mut stack)) = self.queue.pop_front() {
            while cursor < self.program.code_end() {
                if !self.visited.insert(cursor) {
                    break;
                }
                if !self.program.has_complete_min_instruction(cursor)? {
                    self.summary.decode_error_count += 1;
                    break;
                }
                let instruction = self.program.decode(cursor)?;
                self.summary.instruction_count += 1;
                match instruction.kind {
                    SystemInstructionKind::Branch { kind } => {
                        if self.apply_branch(kind, instruction.next_offset, &mut stack) {
                            cursor = instruction.next_offset;
                            continue;
                        }
                        break;
                    }
                    SystemInstructionKind::Return => break,
                    kind => self.apply_instruction(instruction.opcode, kind, &mut stack),
                }
                self.summary.max_stack_depth = self.summary.max_stack_depth.max(stack.len());
                cursor = instruction.next_offset;
            }
        }
        self.summary.dispatch_unknown_sources = self
            .unknown_sources
            .iter()
            .map(
                |(&(dispatch_id, source_code), &count)| SystemTraceUnknownSourceCount {
                    dispatch_id,
                    source_code,
                    count,
                },
            )
            .collect();
        self.summary.service_input_top_kinds =
            collect_source_value_counts(&self.service_input_top_kinds);
        self.summary.service_input_arg_buckets =
            collect_source_value_counts(&self.service_input_arg_buckets);
        Ok(())
    }

    fn apply_branch(
        &mut self,
        kind: crate::SystemBranchKind,
        next_offset: usize,
        stack: &mut Vec<TraceValue>,
    ) -> bool {
        match kind {
            crate::SystemBranchKind::Jump => {
                if let Some(target) = self.pop_valid_code_target(stack) {
                    self.queue.push_back((target, stack.clone()));
                }
                false
            }
            crate::SystemBranchKind::Conditional { .. } => {
                let target = self.pop_valid_code_target(stack);
                pop(stack, 1);
                if let Some(target) = target {
                    self.queue.push_back((target, stack.clone()));
                }
                self.queue.push_back((next_offset, stack.clone()));
                false
            }
            crate::SystemBranchKind::Call => {
                if let Some(target) = self.pop_valid_code_target(stack) {
                    self.queue.push_back((target, stack.clone()));
                }
                true
            }
        }
    }

    fn pop_valid_code_target(&self, stack: &mut Vec<TraceValue>) -> Option<usize> {
        let target = match stack.pop()? {
            TraceValue::Code(target) => target?,
            TraceValue::Integer(value) => usize::try_from(value).ok()?,
            _ => return None,
        };
        (target >= self.program.code_offset() && target < self.program.code_end()).then_some(target)
    }

    fn apply_instruction(
        &mut self,
        opcode: u8,
        kind: SystemInstructionKind<'_>,
        stack: &mut Vec<TraceValue>,
    ) {
        match kind {
            SystemInstructionKind::PushU8(value) => push(stack, TraceValue::Integer(value.into())),
            SystemInstructionKind::PushU16(value) => push(stack, TraceValue::Integer(value.into())),
            SystemInstructionKind::PushU32(value) => push(stack, TraceValue::Integer(value.into())),
            SystemInstructionKind::PushU64(value) => push(stack, TraceValue::Integer(value)),
            SystemInstructionKind::GetVariablePointer(_) => push(stack, TraceValue::Pointer),
            SystemInstructionKind::GetString { bytes, .. } => push(
                stack,
                bytes.map_or(TraceValue::Unknown(UNKNOWN_SOURCE_GENERIC), |bytes| {
                    TraceValue::String { len: bytes.len() }
                }),
            ),
            SystemInstructionKind::GetCodeOffset { target, .. } => {
                push(stack, TraceValue::Code(target));
            }
            SystemInstructionKind::WidthOperand { .. } => {
                pop(stack, 1);
                push(stack, TraceValue::Unknown(UNKNOWN_SOURCE_WIDTH));
            }
            SystemInstructionKind::ArrayOperand { .. } | SystemInstructionKind::ShortOperand(_) => {
                push(stack, TraceValue::Unknown(UNKNOWN_SOURCE_ARRAY));
            }
            SystemInstructionKind::ServiceCall {
                family, service_id, ..
            } => {
                if matches!(
                    family,
                    SystemCallFamily::System
                        | SystemCallFamily::Graph
                        | SystemCallFamily::Sound
                        | SystemCallFamily::External
                ) {
                    self.summary.service_call_count += 1;
                    let source = service_unknown_source(family, service_id);
                    self.record_service_input(source, stack);
                    stack.clear();
                    push(stack, TraceValue::Unknown(source));
                }
            }
            SystemInstructionKind::UserScript(SystemUserScriptOp::Load) => {
                stack.clear();
                push(stack, TraceValue::UserScriptHandle);
            }
            SystemInstructionKind::UserScript(SystemUserScriptOp::Free) => {
                pop(stack, 1);
            }
            SystemInstructionKind::UserScript(SystemUserScriptOp::Return) => {
                stack.clear();
            }
            SystemInstructionKind::UserScript(SystemUserScriptOp::Call(service_id)) => {
                self.record_dispatch(service_id, stack);
                stack.clear();
                push(stack, TraceValue::UserScriptResult(service_id));
            }
            SystemInstructionKind::NoOperand => {
                self.apply_no_operand(opcode, stack);
            }
            SystemInstructionKind::Branch { .. } | SystemInstructionKind::Return => {}
        }
    }

    fn apply_no_operand(&self, opcode: u8, stack: &mut Vec<TraceValue>) {
        match opcode {
            0x10 => push(stack, TraceValue::Integer(0)),
            0x11 | 0x6d | 0x71 => pop(stack, 1),
            0x20..=0x27 | 0x29..=0x35 | 0x38 | 0x39 => {
                let right = stack.pop();
                let left = stack.pop();
                push(
                    stack,
                    trace_eval_binary(opcode, left, right).map_or(
                        TraceValue::Unknown(UNKNOWN_SOURCE_NO_OPERAND),
                        TraceValue::Integer,
                    ),
                );
            }
            0x43 | 0x44 => {
                let right = stack.pop();
                let left = stack.pop();
                push(
                    stack,
                    trace_eval_extended_binary(opcode, left, right)
                        .unwrap_or(TraceValue::Unknown(UNKNOWN_SOURCE_NO_OPERAND)),
                );
            }
            0x28 | 0x3a | 0x48 | 0x49 => {
                let value = stack.pop();
                push(
                    stack,
                    trace_eval_unary(opcode, value).map_or(
                        TraceValue::Unknown(UNKNOWN_SOURCE_NO_OPERAND),
                        TraceValue::Integer,
                    ),
                );
            }
            0x40 => {
                let false_value = stack
                    .pop()
                    .unwrap_or(TraceValue::Unknown(UNKNOWN_SOURCE_NO_OPERAND));
                let true_value = stack
                    .pop()
                    .unwrap_or(TraceValue::Unknown(UNKNOWN_SOURCE_NO_OPERAND));
                let compare = stack.pop();
                push(
                    stack,
                    trace_integer(compare)
                        .map(|value| if value != 0 { true_value } else { false_value })
                        .unwrap_or(TraceValue::Unknown(UNKNOWN_SOURCE_NO_OPERAND)),
                );
            }
            0x42 => {
                let divisor = stack.pop();
                let multiplier = stack.pop();
                let multiplicand = stack.pop();
                push(
                    stack,
                    trace_eval_muldiv(multiplicand, multiplier, divisor).map_or(
                        TraceValue::Unknown(UNKNOWN_SOURCE_NO_OPERAND),
                        TraceValue::Integer,
                    ),
                );
            }
            0x60 | 0x62 | 0x6b => pop(stack, 3),
            0x61 | 0x6a | 0x6f => pop(stack, 2),
            0x63 => {
                pop(stack, 3);
                push(stack, TraceValue::Unknown(UNKNOWN_SOURCE_NO_OPERAND));
            }
            0x67 => pop(stack, 4),
            0x68 => {
                let value = stack.pop();
                push(
                    stack,
                    match value {
                        Some(TraceValue::String { len }) => TraceValue::Integer(len as u64),
                        _ => TraceValue::Unknown(UNKNOWN_SOURCE_NO_OPERAND),
                    },
                );
            }
            0x69 => {
                pop(stack, 2);
                push(stack, TraceValue::Unknown(UNKNOWN_SOURCE_NO_OPERAND));
            }
            0x70 => {
                pop(stack, 1);
                push(stack, TraceValue::Unknown(UNKNOWN_SOURCE_NO_OPERAND));
            }
            0x6c => {
                pop(stack, 1);
                push(stack, TraceValue::Unknown(UNKNOWN_SOURCE_NO_OPERAND));
                push(stack, TraceValue::Unknown(UNKNOWN_SOURCE_NO_OPERAND));
                push(stack, TraceValue::Unknown(UNKNOWN_SOURCE_NO_OPERAND));
            }
            0x75 => {
                pop(stack, 3);
                push(stack, TraceValue::Integer(1));
            }
            _ => {}
        }
    }

    fn record_service_input(&mut self, source: u16, stack: &[TraceValue]) {
        let bucket = stack.len().min(STACK_BUCKETS - 1) as u8;
        let top_kind = stack
            .last()
            .copied()
            .map(value_kind_code)
            .unwrap_or(VALUE_KIND_EMPTY);
        *self
            .service_input_arg_buckets
            .entry((source, bucket))
            .or_default() += 1;
        *self
            .service_input_top_kinds
            .entry((source, top_kind))
            .or_default() += 1;
    }

    fn record_dispatch(&mut self, service_id: u8, stack: &[TraceValue]) {
        let id = usize::from(service_id);
        self.summary.user_script_dispatch_count += 1;
        let bucket = stack.len().min(STACK_BUCKETS - 1);
        self.summary.dispatch_arg_count_buckets[bucket] += 1;
        match stack.last().copied() {
            None => self.summary.dispatch_empty_stack_counts[id] += 1,
            Some(TraceValue::Integer(value)) => {
                self.summary.dispatch_top_integer_counts[id] += 1;
                if let Ok(value) = usize::try_from(value) {
                    if value < 256 {
                        self.summary.dispatch_top_u8_value_counts[value] += 1;
                    }
                }
            }
            Some(TraceValue::String { len }) => {
                let _ = len;
                self.summary.dispatch_top_string_counts[id] += 1;
            }
            Some(TraceValue::Code(_)) => self.summary.dispatch_top_code_counts[id] += 1,
            Some(TraceValue::UserScriptHandle) => {
                self.summary.dispatch_top_handle_counts[id] += 1;
            }
            Some(TraceValue::UserScriptResult(result_id)) => {
                let _ = result_id;
                self.summary.dispatch_top_user_result_counts[id] += 1;
            }
            Some(TraceValue::Pointer) => self.summary.dispatch_top_pointer_counts[id] += 1,
            Some(TraceValue::Unknown(source_code)) => {
                self.summary.dispatch_top_unknown_counts[id] += 1;
                *self
                    .unknown_sources
                    .entry((service_id, source_code))
                    .or_default() += 1;
            }
        }
    }
}

fn trace_eval_binary(
    opcode: u8,
    left: Option<TraceValue>,
    right: Option<TraceValue>,
) -> Option<u64> {
    let left = trace_integer(left)?;
    let right = trace_integer(right)?;
    eval_basic_binary_integer(opcode, left, right)
}

fn trace_eval_extended_binary(
    opcode: u8,
    left: Option<TraceValue>,
    right: Option<TraceValue>,
) -> Option<TraceValue> {
    let left = trace_integer(left)?;
    let right = trace_integer(right)?;
    eval_extended_binary_integer(opcode, left, right).map(TraceValue::Integer)
}

fn trace_eval_unary(opcode: u8, value: Option<TraceValue>) -> Option<u64> {
    let value = trace_integer(value)?;
    match opcode {
        0x28 => Some(u64::from(!(value as u32))),
        0x3a => Some(u64::from(value == 0)),
        0x48 | 0x49 => Some(0),
        _ => None,
    }
}

fn trace_eval_muldiv(
    multiplicand: Option<TraceValue>,
    multiplier: Option<TraceValue>,
    divisor: Option<TraceValue>,
) -> Option<u64> {
    let multiplicand = trace_integer(multiplicand)? as i32 as i64;
    let multiplier = trace_integer(multiplier)? as i32 as i64;
    let divisor = trace_integer(divisor)? as i32 as i64;
    let result = if divisor == 0 {
        -1
    } else {
        multiplicand.saturating_mul(multiplier) / divisor
    };
    Some(u64::from(result as i32 as u32))
}

fn trace_integer(value: Option<TraceValue>) -> Option<u64> {
    match value? {
        TraceValue::Integer(value) => Some(value),
        TraceValue::Code(_) => Some(0),
        TraceValue::UserScriptHandle => Some(0),
        TraceValue::UserScriptResult(_) => Some(0),
        TraceValue::String { .. } | TraceValue::Pointer | TraceValue::Unknown(_) => None,
    }
}

pub const VALUE_KIND_EMPTY: u8 = 0;
pub const VALUE_KIND_INTEGER: u8 = 1;
pub const VALUE_KIND_STRING: u8 = 2;
pub const VALUE_KIND_CODE: u8 = 3;
pub const VALUE_KIND_HANDLE: u8 = 4;
pub const VALUE_KIND_USER_RESULT: u8 = 5;
pub const VALUE_KIND_POINTER: u8 = 6;
pub const VALUE_KIND_UNKNOWN: u8 = 7;

pub fn system_trace_value_kind_label(kind: u8) -> &'static str {
    match kind {
        VALUE_KIND_EMPTY => "empty",
        VALUE_KIND_INTEGER => "integer",
        VALUE_KIND_STRING => "string",
        VALUE_KIND_CODE => "code",
        VALUE_KIND_HANDLE => "handle",
        VALUE_KIND_USER_RESULT => "user_result",
        VALUE_KIND_POINTER => "pointer",
        VALUE_KIND_UNKNOWN => "unknown",
        _ => "invalid",
    }
}

pub fn system_trace_unknown_source_label(source_code: u16) -> String {
    match source_code {
        UNKNOWN_SOURCE_GENERIC => "unknown:generic".to_owned(),
        UNKNOWN_SOURCE_WIDTH => "unknown:width".to_owned(),
        UNKNOWN_SOURCE_ARRAY => "unknown:array".to_owned(),
        UNKNOWN_SOURCE_SHORT => "unknown:short".to_owned(),
        UNKNOWN_SOURCE_NO_OPERAND => "unknown:op".to_owned(),
        code if (UNKNOWN_SOURCE_USER_DISPATCH_BASE..UNKNOWN_SOURCE_SYSTEM_SERVICE_BASE)
            .contains(&code) =>
        {
            format!("user:{:02x}", code - UNKNOWN_SOURCE_USER_DISPATCH_BASE)
        }
        code if (UNKNOWN_SOURCE_SYSTEM_SERVICE_BASE..UNKNOWN_SOURCE_GRAPH_SERVICE_BASE)
            .contains(&code) =>
        {
            format!("sys:{:02x}", code - UNKNOWN_SOURCE_SYSTEM_SERVICE_BASE)
        }
        code if (UNKNOWN_SOURCE_GRAPH_SERVICE_BASE..UNKNOWN_SOURCE_SOUND_SERVICE_BASE)
            .contains(&code) =>
        {
            format!("graph:{:02x}", code - UNKNOWN_SOURCE_GRAPH_SERVICE_BASE)
        }
        code if (UNKNOWN_SOURCE_SOUND_SERVICE_BASE..UNKNOWN_SOURCE_EXTERNAL_SERVICE_BASE)
            .contains(&code) =>
        {
            format!("sound:{:02x}", code - UNKNOWN_SOURCE_SOUND_SERVICE_BASE)
        }
        code if code >= UNKNOWN_SOURCE_EXTERNAL_SERVICE_BASE => {
            format!("ext:{:02x}", code - UNKNOWN_SOURCE_EXTERNAL_SERVICE_BASE)
        }
        code => format!("unknown:{code:04x}"),
    }
}

fn service_unknown_source(family: SystemCallFamily, service_id: u8) -> u16 {
    let base = match family {
        SystemCallFamily::System => UNKNOWN_SOURCE_SYSTEM_SERVICE_BASE,
        SystemCallFamily::Graph => UNKNOWN_SOURCE_GRAPH_SERVICE_BASE,
        SystemCallFamily::Sound => UNKNOWN_SOURCE_SOUND_SERVICE_BASE,
        SystemCallFamily::External => UNKNOWN_SOURCE_EXTERNAL_SERVICE_BASE,
    };
    base + u16::from(service_id)
}

fn collect_source_value_counts(
    counts: &BTreeMap<(u16, u8), usize>,
) -> Vec<SystemTraceSourceValueCount> {
    counts
        .iter()
        .map(
            |(&(source_code, value_code), &count)| SystemTraceSourceValueCount {
                source_code,
                value_code,
                count,
            },
        )
        .collect()
}

fn value_kind_code(value: TraceValue) -> u8 {
    match value {
        TraceValue::Unknown(_) => VALUE_KIND_UNKNOWN,
        TraceValue::Integer(_) => VALUE_KIND_INTEGER,
        TraceValue::String { .. } => VALUE_KIND_STRING,
        TraceValue::Code(_) => VALUE_KIND_CODE,
        TraceValue::UserScriptHandle => VALUE_KIND_HANDLE,
        TraceValue::UserScriptResult(_) => VALUE_KIND_USER_RESULT,
        TraceValue::Pointer => VALUE_KIND_POINTER,
    }
}

fn push(stack: &mut Vec<TraceValue>, value: TraceValue) {
    if stack.len() == MAX_TRACKED_STACK {
        stack.remove(0);
    }
    stack.push(value);
}

fn pop(stack: &mut Vec<TraceValue>, count: usize) {
    for _ in 0..count {
        if stack.pop().is_none() {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn traces_user_dispatch_top_integer() -> Result<()> {
        let mut script = vec![0u8; 0x10];
        script.extend_from_slice(&[0x00, 0x07, 0xff, 0x2a, 0x17]);

        let summary = trace_system_script(&script)?;

        assert_eq!(summary.user_script_dispatch_count, 1);
        assert_eq!(summary.dispatch_arg_count_buckets[1], 1);
        assert_eq!(summary.dispatch_top_integer_counts[0x2a], 1);
        assert_eq!(summary.dispatch_top_u8_value_counts[7], 1);
        Ok(())
    }

    #[test]
    fn traces_user_dispatch_top_string_without_exposing_bytes() -> Result<()> {
        let mut script = vec![0u8; 0x10];
        script.push(0x05);
        script.extend_from_slice(&6i16.to_le_bytes());
        script.extend_from_slice(&[0xff, 0x00, 0x17]);
        script.extend_from_slice(b"synthetic\0");

        let summary = trace_system_script(&script)?;

        assert_eq!(summary.user_script_dispatch_count, 1);
        assert_eq!(summary.dispatch_top_string_counts[0x00], 1);
        Ok(())
    }

    #[test]
    fn traces_user_script_load_as_handle() -> Result<()> {
        let mut script = vec![0u8; 0x10];
        script.extend_from_slice(&[0xff, 0xf0, 0xff, 0x00, 0x17]);

        let summary = trace_system_script(&script)?;

        assert_eq!(summary.user_script_dispatch_count, 1);
        assert_eq!(summary.dispatch_top_handle_counts[0x00], 1);
        Ok(())
    }

    #[test]
    fn traces_user_dispatch_result_separately_from_unknown() -> Result<()> {
        let mut script = vec![0u8; 0x10];
        script.extend_from_slice(&[0xff, 0xff, 0xff, 0x00, 0x17]);

        let summary = trace_system_script(&script)?;

        assert_eq!(summary.user_script_dispatch_count, 2);
        assert_eq!(summary.dispatch_top_user_result_counts[0x00], 1);
        assert_eq!(summary.dispatch_top_unknown_counts[0x00], 0);
        Ok(())
    }

    #[test]
    fn traces_service_input_shape() -> Result<()> {
        let mut script = vec![0u8; 0x10];
        script.extend_from_slice(&[0x00, 0x07, 0xb0, 0xff, 0x17]);

        let summary = trace_system_script(&script)?;

        assert!(summary.service_input_top_kinds.iter().any(|count| {
            system_trace_unknown_source_label(count.source_code) == "ext:ff"
                && count.value_code == VALUE_KIND_INTEGER
                && count.count == 1
        }));
        assert!(summary.service_input_arg_buckets.iter().any(|count| {
            system_trace_unknown_source_label(count.source_code) == "ext:ff"
                && count.value_code == 1
                && count.count == 1
        }));
        Ok(())
    }
}
