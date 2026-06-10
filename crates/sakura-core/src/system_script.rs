use crate::error::{Result, SakuraError};
use crate::system_bytecode::{
    SystemCallFamily, SystemInstructionKind, SystemProgram, SystemUserScriptOp,
};
use std::collections::{BTreeSet, VecDeque};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SystemScriptSummary {
    pub code_offset: usize,
    pub code_end: usize,
    pub instruction_count: usize,
    pub reachable_code_bytes: usize,
    pub string_operands: usize,
    pub jump_count: usize,
    pub conditional_jump_count: usize,
    pub call_count: usize,
    pub return_count: usize,
    pub syscall_count: usize,
    pub graphcall_count: usize,
    pub soundcall_count: usize,
    pub extcall_count: usize,
    pub user_script_call_count: usize,
    pub syscall_service_counts: [usize; 256],
    pub graphcall_service_counts: [usize; 256],
    pub soundcall_service_counts: [usize; 256],
    pub extcall_service_counts: [usize; 256],
    pub user_script_dispatch_counts: [usize; 256],
    pub user_script_load_count: usize,
    pub user_script_free_count: usize,
    pub user_script_return_count: usize,
    pub user_script_dispatch_count: usize,
    pub truncated_tail_blocks: usize,
    pub invalid_opcode_blocks: usize,
    pub invalid_target_blocks: usize,
    pub invalid_jump_blocks: usize,
    pub invalid_string_target_blocks: usize,
    pub max_reachable_offset: usize,
    pub min_syscall_offsets: [usize; 256],
    pub min_graphcall_offsets: [usize; 256],
    pub min_soundcall_offsets: [usize; 256],
    pub min_extcall_offsets: [usize; 256],
    pub min_syscall_block_offsets: [usize; 256],
    pub min_graphcall_block_offsets: [usize; 256],
    pub min_soundcall_block_offsets: [usize; 256],
    pub min_extcall_block_offsets: [usize; 256],
}

pub fn analyze_system_script(data: &[u8]) -> Result<SystemScriptSummary> {
    if data.len() < 0x10 {
        return Err(SakuraError::InvalidScript(
            "system script is shorter than its bytecode offset".to_owned(),
        ));
    }

    let mut state = SystemState::new(data)?;
    state.disassemble()?;
    Ok(state.summary())
}

#[derive(Debug)]
struct SystemState<'a> {
    program: SystemProgram<'a>,
    queue: VecDeque<usize>,
    visited: BTreeSet<usize>,
    block_starts: BTreeSet<usize>,
    summary: SystemScriptSummary,
}

impl<'a> SystemState<'a> {
    fn new(data: &'a [u8]) -> Result<Self> {
        let program = SystemProgram::parse(data)?;
        let code_offset = program.code_offset();
        let code_end = program.code_end();
        let mut queue = VecDeque::new();
        queue.push_back(code_offset);
        let mut block_starts = BTreeSet::new();
        block_starts.insert(code_offset);
        Ok(Self {
            program,
            queue,
            visited: BTreeSet::new(),
            block_starts,
            summary: SystemScriptSummary {
                code_offset,
                code_end,
                instruction_count: 0,
                reachable_code_bytes: 0,
                string_operands: 0,
                jump_count: 0,
                conditional_jump_count: 0,
                call_count: 0,
                return_count: 0,
                syscall_count: 0,
                graphcall_count: 0,
                soundcall_count: 0,
                extcall_count: 0,
                user_script_call_count: 0,
                syscall_service_counts: [0; 256],
                graphcall_service_counts: [0; 256],
                soundcall_service_counts: [0; 256],
                extcall_service_counts: [0; 256],
                user_script_dispatch_counts: [0; 256],
                user_script_load_count: 0,
                user_script_free_count: 0,
                user_script_return_count: 0,
                user_script_dispatch_count: 0,
                truncated_tail_blocks: 0,
                invalid_opcode_blocks: 0,
                invalid_target_blocks: 0,
                invalid_jump_blocks: 0,
                invalid_string_target_blocks: 0,
                max_reachable_offset: 0,
                min_syscall_offsets: [usize::MAX; 256],
                min_graphcall_offsets: [usize::MAX; 256],
                min_soundcall_offsets: [usize::MAX; 256],
                min_extcall_offsets: [usize::MAX; 256],
                min_syscall_block_offsets: [usize::MAX; 256],
                min_graphcall_block_offsets: [usize::MAX; 256],
                min_soundcall_block_offsets: [usize::MAX; 256],
                min_extcall_block_offsets: [usize::MAX; 256],
            },
        })
    }

    fn disassemble(&mut self) -> Result<()> {
        while let Some(block_start) = self.queue.pop_front() {
            self.validate_code_offset(block_start)?;
            let mut cursor = block_start;
            let mut pending_code_target = None;
            while cursor < self.program.code_end() {
                if cursor != block_start && self.block_starts.contains(&cursor) {
                    break;
                }
                if !self.visited.insert(cursor) {
                    break;
                }
                let next = self.process_instruction(cursor, &mut pending_code_target)?;
                match next {
                    NextInstruction::Continue(offset) => cursor = offset,
                    NextInstruction::Stop => break,
                }
            }
        }
        Ok(())
    }

    fn summary(self) -> SystemScriptSummary {
        self.summary
    }

    fn process_instruction(
        &mut self,
        offset: usize,
        pending_code_target: &mut Option<usize>,
    ) -> Result<NextInstruction> {
        match self.program.has_complete_min_instruction(offset) {
            Ok(true) => {}
            Ok(false) => {
                self.summary.truncated_tail_blocks += 1;
                return Ok(NextInstruction::Stop);
            }
            Err(error) if is_unknown_opcode_error(&error) => {
                self.summary.invalid_opcode_blocks += 1;
                return Ok(NextInstruction::Stop);
            }
            Err(error) => return Err(error),
        }

        let instruction = match self.program.decode(offset) {
            Ok(instruction) => instruction,
            Err(error) if is_unknown_opcode_error(&error) => {
                self.summary.invalid_opcode_blocks += 1;
                return Ok(NextInstruction::Stop);
            }
            Err(error) => return Err(error),
        };
        let block_start = self
            .block_starts
            .range(..=offset)
            .next_back()
            .copied()
            .unwrap_or(offset);
        match &instruction.kind {
            SystemInstructionKind::GetString { bytes, .. } => {
                if bytes.is_some() {
                    self.summary.string_operands += 1;
                }
            }
            SystemInstructionKind::GetCodeOffset { target, .. } => *pending_code_target = *target,
            SystemInstructionKind::Branch { kind } => match kind {
                crate::SystemBranchKind::Jump => {
                    if let Some(target) = pending_code_target.take() {
                        self.enqueue(target)?;
                    } else {
                        self.summary.invalid_target_blocks += 1;
                    }
                    self.summary.jump_count += 1;
                    self.finish_instruction(offset, instruction.next_offset)?;
                    return Ok(NextInstruction::Stop);
                }
                crate::SystemBranchKind::Conditional { condition } => {
                    if *condition > 5 {
                        self.summary.invalid_jump_blocks += 1;
                        return Ok(NextInstruction::Stop);
                    }
                    if let Some(target) = pending_code_target.take() {
                        self.enqueue(target)?;
                    } else {
                        self.summary.invalid_target_blocks += 1;
                    }
                    self.summary.conditional_jump_count += 1;
                    self.finish_instruction(offset, instruction.next_offset)?;
                    return Ok(NextInstruction::Continue(instruction.next_offset));
                }
                crate::SystemBranchKind::Call => {
                    if let Some(target) = pending_code_target.take() {
                        self.enqueue(target)?;
                    } else {
                        self.summary.invalid_target_blocks += 1;
                    }
                    self.summary.call_count += 1;
                }
            },
            SystemInstructionKind::Return => {
                self.finish_instruction(offset, instruction.next_offset)?;
                self.summary.return_count += 1;
                return Ok(NextInstruction::Stop);
            }
            SystemInstructionKind::ServiceCall {
                family, service_id, ..
            } => match family {
                SystemCallFamily::System => {
                    self.summary.syscall_count += 1;
                    self.summary.syscall_service_counts[usize::from(*service_id)] += 1;
                    self.summary.min_syscall_offsets[usize::from(*service_id)] =
                        self.summary.min_syscall_offsets[usize::from(*service_id)].min(offset);
                    self.summary.min_syscall_block_offsets[usize::from(*service_id)] =
                        self.summary.min_syscall_block_offsets[usize::from(*service_id)]
                            .min(block_start);
                }
                SystemCallFamily::Graph => {
                    self.summary.graphcall_count += 1;
                    self.summary.graphcall_service_counts[usize::from(*service_id)] += 1;
                    self.summary.min_graphcall_offsets[usize::from(*service_id)] =
                        self.summary.min_graphcall_offsets[usize::from(*service_id)].min(offset);
                    self.summary.min_graphcall_block_offsets[usize::from(*service_id)] =
                        self.summary.min_graphcall_block_offsets[usize::from(*service_id)]
                            .min(block_start);
                }
                SystemCallFamily::Sound => {
                    self.summary.soundcall_count += 1;
                    self.summary.soundcall_service_counts[usize::from(*service_id)] += 1;
                    self.summary.min_soundcall_offsets[usize::from(*service_id)] =
                        self.summary.min_soundcall_offsets[usize::from(*service_id)].min(offset);
                    self.summary.min_soundcall_block_offsets[usize::from(*service_id)] =
                        self.summary.min_soundcall_block_offsets[usize::from(*service_id)]
                            .min(block_start);
                }
                SystemCallFamily::External => {
                    self.summary.extcall_count += 1;
                    self.summary.extcall_service_counts[usize::from(*service_id)] += 1;
                    self.summary.min_extcall_offsets[usize::from(*service_id)] =
                        self.summary.min_extcall_offsets[usize::from(*service_id)].min(offset);
                    self.summary.min_extcall_block_offsets[usize::from(*service_id)] =
                        self.summary.min_extcall_block_offsets[usize::from(*service_id)]
                            .min(block_start);
                }
            },
            SystemInstructionKind::UserScript(op) => {
                self.summary.user_script_call_count += 1;
                match op {
                    SystemUserScriptOp::Load => self.summary.user_script_load_count += 1,
                    SystemUserScriptOp::Free => self.summary.user_script_free_count += 1,
                    SystemUserScriptOp::Return => self.summary.user_script_return_count += 1,
                    SystemUserScriptOp::Call(service_id) => {
                        self.summary.user_script_dispatch_count += 1;
                        self.summary.user_script_dispatch_counts[usize::from(*service_id)] += 1;
                    }
                }
            }
            _ => {}
        }
        if !matches!(
            instruction.kind,
            SystemInstructionKind::GetCodeOffset { .. }
        ) {
            *pending_code_target = None;
        }

        self.finish_instruction(offset, instruction.next_offset)?;
        Ok(NextInstruction::Continue(instruction.next_offset))
    }

    fn finish_instruction(&mut self, offset: usize, cursor: usize) -> Result<()> {
        if cursor > self.program.code_end() {
            return Err(SakuraError::UnexpectedEof {
                offset,
                needed: cursor - offset,
                available: self.program.code_end().saturating_sub(offset),
            });
        }
        self.summary.instruction_count += 1;
        self.summary.reachable_code_bytes += cursor - offset;
        self.summary.max_reachable_offset = self.summary.max_reachable_offset.max(cursor);
        Ok(())
    }

    fn enqueue(&mut self, offset: usize) -> Result<()> {
        if offset < self.program.code_offset() || offset >= self.program.code_end() {
            self.summary.invalid_target_blocks += 1;
            return Ok(());
        }
        self.block_starts.insert(offset);
        if !self.visited.contains(&offset) {
            self.queue.push_back(offset);
        }
        Ok(())
    }

    fn validate_code_offset(&self, offset: usize) -> Result<()> {
        if offset < self.program.code_offset() || offset >= self.program.code_end() {
            return Err(SakuraError::InvalidScript(
                "system code target is out of range".to_owned(),
            ));
        }
        Ok(())
    }
}

fn is_unknown_opcode_error(error: &SakuraError) -> bool {
    matches!(
        error,
        SakuraError::InvalidScript(message) if message.starts_with("unknown system opcode ")
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NextInstruction {
    Continue(usize),
    Stop,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn analyzes_synthetic_system_graphcall_script() -> Result<()> {
        let mut script = vec![0u8; 0x10];
        script.extend_from_slice(&[0x00, 0x2a, 0x91, 0x88, 0x17]);

        let summary = analyze_system_script(&script)?;

        assert_eq!(summary.instruction_count, 3);
        assert_eq!(summary.graphcall_count, 1);
        assert_eq!(summary.graphcall_service_counts[0x88], 1);
        assert_eq!(summary.return_count, 1);
        assert_eq!(summary.reachable_code_bytes, 5);
        Ok(())
    }

    #[test]
    fn records_invalid_opcode_blocks_without_aborting_static_analysis() -> Result<()> {
        let mut script = vec![0u8; 0x10];
        script.extend_from_slice(&[0x76, 0x17]);

        let summary = analyze_system_script(&script)?;

        assert_eq!(summary.instruction_count, 0);
        assert_eq!(summary.invalid_opcode_blocks, 1);
        Ok(())
    }

    #[test]
    fn analyzes_synthetic_system_getstring_script() -> Result<()> {
        let mut script = vec![0u8; 0x10];
        script.push(0x05);
        script.extend_from_slice(&4i16.to_le_bytes());
        script.push(0x17);
        script.extend_from_slice(b"x\0");

        let summary = analyze_system_script(&script)?;

        assert_eq!(summary.instruction_count, 2);
        assert_eq!(summary.string_operands, 1);
        assert_eq!(summary.return_count, 1);
        Ok(())
    }

    #[test]
    fn analyzes_synthetic_system_user_script_services() -> Result<()> {
        let mut script = vec![0u8; 0x10];
        script.extend_from_slice(&[0xff, 0xf0, 0xff, 0x2a, 0xff, 0xf8, 0x17]);

        let summary = analyze_system_script(&script)?;

        assert_eq!(summary.user_script_call_count, 3);
        assert_eq!(summary.user_script_load_count, 1);
        assert_eq!(summary.user_script_dispatch_count, 1);
        assert_eq!(summary.user_script_dispatch_counts[0x2a], 1);
        assert_eq!(summary.user_script_return_count, 1);
        Ok(())
    }
}
