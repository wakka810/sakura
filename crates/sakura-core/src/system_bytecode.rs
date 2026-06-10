use crate::bytes::{read_exact, read_u32_le};
use crate::error::{Result, SakuraError};

const LEGACY_SYSTEM_CODE_OFFSET: usize = 0x10;
const DECLARED_SYSTEM_CODE_OFFSET_FIELD: usize = 0;
const DECLARED_SYSTEM_CODE_END_FIELD: usize = 4;
const MIN_HEADER_SYSTEM_CODE_OFFSET: usize = 0x10;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SystemProgram<'a> {
    data: &'a [u8],
    code_offset: usize,
    code_end: usize,
}

impl<'a> SystemProgram<'a> {
    pub fn parse(data: &'a [u8]) -> Result<Self> {
        if data.len() < 0x10 {
            return Err(SakuraError::InvalidScript(
                "system script is shorter than its bytecode offset".to_owned(),
            ));
        }
        let (code_offset, code_end) = system_code_bounds(data);
        Ok(Self {
            data,
            code_offset,
            code_end,
        })
    }

    pub fn data(&self) -> &'a [u8] {
        self.data
    }

    pub fn code_offset(&self) -> usize {
        self.code_offset
    }

    pub fn code_end(&self) -> usize {
        self.code_end
    }

    pub fn decode(&self, offset: usize) -> Result<SystemInstruction<'a>> {
        if offset < self.code_offset || offset >= self.code_end {
            return Err(SakuraError::InvalidScript(
                "system code target is out of range".to_owned(),
            ));
        }
        let opcode = *self.data.get(offset).ok_or(SakuraError::UnexpectedEof {
            offset,
            needed: 1,
            available: 0,
        })?;
        let Some(min_len) = system_min_instruction_len(opcode) else {
            return Err(SakuraError::InvalidScript(format!(
                "unknown system opcode 0x{opcode:02x} at offset 0x{offset:x}"
            )));
        };
        if self.code_end - offset < min_len {
            return Err(SakuraError::UnexpectedEof {
                offset,
                needed: min_len,
                available: self.code_end - offset,
            });
        }

        let mut cursor = offset + 1;
        let kind = match opcode {
            0x00 => {
                let value = self.read_u8(cursor)?;
                cursor += 1;
                SystemInstructionKind::PushU8(value)
            }
            0x01 => {
                let value = self.read_u16(cursor)?;
                cursor += 2;
                SystemInstructionKind::PushU16(value)
            }
            0x02 => {
                let value = read_u32_le(self.data, cursor)?;
                cursor += 4;
                SystemInstructionKind::PushU32(value)
            }
            0x03 => {
                let value = self.read_u64(cursor)?;
                cursor += 8;
                SystemInstructionKind::PushU64(value)
            }
            0x04 => {
                let value = self.read_u16(cursor)?;
                cursor += 2;
                SystemInstructionKind::GetVariablePointer(value)
            }
            0x05 => {
                let displacement = read_i16(self.data, cursor)?;
                let target = relative_target(offset, displacement);
                let bytes = target.and_then(|target| self.zero_terminated_bytes(target).ok());
                cursor += 2;
                SystemInstructionKind::GetString {
                    displacement,
                    target,
                    bytes,
                }
            }
            0x06 => {
                let displacement = read_i16(self.data, cursor)?;
                let target = relative_target(offset, displacement);
                cursor += 2;
                SystemInstructionKind::GetCodeOffset {
                    displacement,
                    target,
                }
            }
            0x14 => SystemInstructionKind::Branch {
                kind: SystemBranchKind::Jump,
            },
            0x15 => {
                let condition = self.read_u8(cursor)?;
                cursor += 1;
                SystemInstructionKind::Branch {
                    kind: SystemBranchKind::Conditional { condition },
                }
            }
            0x16 => SystemInstructionKind::Branch {
                kind: SystemBranchKind::Call,
            },
            0x08..=0x0a => {
                let width = self.read_u8(cursor)?;
                cursor += 1;
                SystemInstructionKind::WidthOperand { width }
            }
            0x0b => {
                let len = usize::from(self.read_u8(cursor)?);
                let array_start = cursor + 1;
                let array_end = array_start.checked_add(len).ok_or_else(|| {
                    SakuraError::InvalidScript("system array operand overflows".to_owned())
                })?;
                if array_end > self.code_end {
                    return Err(SakuraError::UnexpectedEof {
                        offset,
                        needed: array_end - offset,
                        available: self.code_end - offset,
                    });
                }
                cursor = array_end;
                SystemInstructionKind::ArrayOperand {
                    bytes: &self.data[array_start..array_end],
                }
            }
            0x0c => {
                let value = self.read_u16(cursor)?;
                cursor += 2;
                SystemInstructionKind::ShortOperand(value)
            }
            0x17 => SystemInstructionKind::Return,
            0x80 | 0x81 => {
                let service_id = self.read_u8(cursor)?;
                cursor += 1;
                SystemInstructionKind::ServiceCall {
                    family: SystemCallFamily::System,
                    opcode,
                    service_id,
                }
            }
            0x90..=0x92 => {
                let service_id = self.read_u8(cursor)?;
                cursor += 1;
                SystemInstructionKind::ServiceCall {
                    family: SystemCallFamily::Graph,
                    opcode,
                    service_id,
                }
            }
            0xa0 => {
                let service_id = self.read_u8(cursor)?;
                cursor += 1;
                SystemInstructionKind::ServiceCall {
                    family: SystemCallFamily::Sound,
                    opcode,
                    service_id,
                }
            }
            0xb0 | 0xc0 | 0xd0 | 0xe0 => {
                let service_id = self.read_u8(cursor)?;
                cursor += 1;
                SystemInstructionKind::ServiceCall {
                    family: SystemCallFamily::External,
                    opcode,
                    service_id,
                }
            }
            0xff => {
                let service_id = self.read_u8(cursor)?;
                cursor += 1;
                SystemInstructionKind::UserScript(user_script_op(service_id))
            }
            _ => SystemInstructionKind::NoOperand,
        };

        Ok(SystemInstruction {
            offset,
            opcode,
            next_offset: cursor,
            kind,
        })
    }

    pub fn has_complete_min_instruction(&self, offset: usize) -> Result<bool> {
        let opcode = *self.data.get(offset).ok_or(SakuraError::UnexpectedEof {
            offset,
            needed: 1,
            available: 0,
        })?;
        let Some(min_len) = system_min_instruction_len(opcode) else {
            return Err(SakuraError::InvalidScript(format!(
                "unknown system opcode 0x{opcode:02x} at offset 0x{offset:x}"
            )));
        };
        Ok(self.code_end - offset >= min_len)
    }

    fn zero_terminated_bytes(&self, offset: usize) -> Result<&'a [u8]> {
        let end = self
            .data
            .get(offset..)
            .and_then(|tail| tail.iter().position(|byte| *byte == 0))
            .map(|relative| offset + relative)
            .ok_or_else(|| SakuraError::InvalidScript("unterminated script string".to_owned()))?;
        self.data
            .get(offset..end)
            .ok_or_else(|| SakuraError::InvalidScript("string address is out of range".to_owned()))
    }

    fn read_u8(&self, offset: usize) -> Result<u8> {
        Ok(*read_exact(self.data, offset, 1)?
            .first()
            .ok_or(SakuraError::UnexpectedEof {
                offset,
                needed: 1,
                available: 0,
            })?)
    }

    fn read_u16(&self, offset: usize) -> Result<u16> {
        let bytes = read_exact(self.data, offset, 2)?;
        Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
    }

    fn read_u64(&self, offset: usize) -> Result<u64> {
        let bytes = read_exact(self.data, offset, 8)?;
        Ok(u64::from_le_bytes([
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
        ]))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SystemInstruction<'a> {
    pub offset: usize,
    pub opcode: u8,
    pub next_offset: usize,
    pub kind: SystemInstructionKind<'a>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SystemInstructionKind<'a> {
    PushU8(u8),
    PushU16(u16),
    PushU32(u32),
    PushU64(u64),
    GetVariablePointer(u16),
    GetString {
        displacement: i16,
        target: Option<usize>,
        bytes: Option<&'a [u8]>,
    },
    GetCodeOffset {
        displacement: i16,
        target: Option<usize>,
    },
    Branch {
        kind: SystemBranchKind,
    },
    WidthOperand {
        width: u8,
    },
    ArrayOperand {
        bytes: &'a [u8],
    },
    ShortOperand(u16),
    ServiceCall {
        family: SystemCallFamily,
        opcode: u8,
        service_id: u8,
    },
    UserScript(SystemUserScriptOp),
    Return,
    NoOperand,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SystemBranchKind {
    Jump,
    Conditional { condition: u8 },
    Call,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SystemCallFamily {
    System,
    Graph,
    Sound,
    External,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SystemUserScriptOp {
    Load,
    Free,
    Return,
    Call(u8),
}

pub(crate) fn read_i16(data: &[u8], offset: usize) -> Result<i16> {
    let bytes = read_exact(data, offset, 2)?;
    Ok(i16::from_le_bytes([bytes[0], bytes[1]]))
}

pub(crate) fn system_min_instruction_len(opcode: u8) -> Option<usize> {
    match opcode {
        0x00 => Some(2),
        0x01 | 0x04 | 0x05 | 0x06 => Some(3),
        0x02 => Some(5),
        0x03 => Some(9),
        0x08..=0x0a
        | 0x15
        | 0x80
        | 0x81
        | 0x90..=0x92
        | 0xa0
        | 0xb0
        | 0xc0
        | 0xd0
        | 0xe0
        | 0xff => Some(2),
        0x0b => Some(2),
        0x0c => Some(3),
        0x14 | 0x16 | 0x17 => Some(1),
        opcode if system_opcode_has_no_operand(opcode) => Some(1),
        _ => None,
    }
}

fn system_code_bounds(data: &[u8]) -> (usize, usize) {
    let mut code_offset = LEGACY_SYSTEM_CODE_OFFSET.min(data.len());
    if let Some(bytes) =
        data.get(DECLARED_SYSTEM_CODE_OFFSET_FIELD..DECLARED_SYSTEM_CODE_OFFSET_FIELD + 4)
    {
        let declared = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize;
        if declared >= MIN_HEADER_SYSTEM_CODE_OFFSET && declared < data.len() && declared & 0x3 == 0
        {
            code_offset = declared;
        }
    }

    let mut code_end = data.len();
    if let Some(bytes) =
        data.get(DECLARED_SYSTEM_CODE_END_FIELD..DECLARED_SYSTEM_CODE_END_FIELD + 4)
    {
        let declared = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize;
        if declared > code_offset && declared <= data.len() {
            code_end = declared;
        }
    }
    (code_offset, code_end)
}

fn system_opcode_has_no_operand(opcode: u8) -> bool {
    matches!(
        opcode,
        0x10
            | 0x11
            | 0x20..=0x2b
            | 0x2d..=0x2f
            | 0x30..=0x35
            | 0x36
            | 0x38..=0x3a
            | 0x40
            | 0x42..=0x45
            | 0x46
            | 0x48
            | 0x49
            | 0x50..=0x5b
            | 0x5c
            | 0x5d..=0x6f
            | 0x70
            | 0x71
            | 0x72
            | 0x74
            | 0x75
            | 0x77..=0x7f
    )
}

fn relative_target(offset: usize, displacement: i16) -> Option<usize> {
    let target = offset as isize + isize::from(displacement);
    (target >= 0).then_some(target as usize)
}

fn user_script_op(service_id: u8) -> SystemUserScriptOp {
    match service_id {
        0xf0 => SystemUserScriptOp::Load,
        0xf1 => SystemUserScriptOp::Free,
        0xf8 => SystemUserScriptOp::Return,
        service_id => SystemUserScriptOp::Call(service_id),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_synthetic_graphcall() -> Result<()> {
        let mut script = vec![0u8; 0x10];
        script.extend_from_slice(&[0x00, 0x2a, 0x91, 0x88, 0x17]);
        let program = SystemProgram::parse(&script)?;

        assert_eq!(program.code_offset(), 0x10);
        let push = program.decode(0x10)?;
        assert_eq!(push.next_offset, 0x12);
        assert_eq!(push.kind, SystemInstructionKind::PushU8(0x2a));

        let call = program.decode(0x12)?;
        assert_eq!(
            call.kind,
            SystemInstructionKind::ServiceCall {
                family: SystemCallFamily::Graph,
                opcode: 0x91,
                service_id: 0x88
            }
        );
        Ok(())
    }

    #[test]
    fn decodes_system_script_with_declared_code_offset() -> Result<()> {
        let mut script = vec![0u8; 0x20];
        script[0..4].copy_from_slice(&0x20u32.to_le_bytes());
        script.extend_from_slice(&[0x00, 0x2a, 0x91, 0x88, 0x17]);
        let script_len = script.len() as u32;
        script[4..8].copy_from_slice(&script_len.to_le_bytes());
        let program = SystemProgram::parse(&script)?;

        assert_eq!(program.code_offset(), 0x20);
        assert_eq!(program.code_end(), script.len());
        assert_eq!(
            program.decode(0x20)?.kind,
            SystemInstructionKind::PushU8(0x2a)
        );
        assert!(matches!(
            program.decode(0x22)?.kind,
            SystemInstructionKind::ServiceCall {
                family: SystemCallFamily::Graph,
                opcode: 0x91,
                service_id: 0x88,
            }
        ));
        Ok(())
    }

    #[test]
    fn decodes_synthetic_getstring() -> Result<()> {
        let mut script = vec![0u8; 0x10];
        script.push(0x05);
        script.extend_from_slice(&4i16.to_le_bytes());
        script.push(0x17);
        script.extend_from_slice(b"x\0");
        let program = SystemProgram::parse(&script)?;

        let instruction = program.decode(0x10)?;

        assert_eq!(instruction.next_offset, 0x13);
        assert_eq!(
            instruction.kind,
            SystemInstructionKind::GetString {
                displacement: 4,
                target: Some(0x14),
                bytes: Some(b"x".as_slice())
            }
        );
        Ok(())
    }

    #[test]
    fn decodes_codeoffset_without_consuming_following_opcode() -> Result<()> {
        let mut script = vec![0u8; 0x10];
        script.extend_from_slice(&[0x06, 0x04, 0x00, 0x20, 0x17, 0x17]);
        let program = SystemProgram::parse(&script)?;

        let instruction = program.decode(0x10)?;

        assert_eq!(instruction.next_offset, 0x13);
        assert_eq!(
            instruction.kind,
            SystemInstructionKind::GetCodeOffset {
                displacement: 4,
                target: Some(0x14),
            }
        );
        assert_eq!(program.decode(0x13)?.kind, SystemInstructionKind::NoOperand);
        Ok(())
    }

    #[test]
    fn classifies_user_script_services() -> Result<()> {
        let mut script = vec![0u8; 0x10];
        script.extend_from_slice(&[0xff, 0xf0, 0xff, 0x2a, 0xff, 0xf8]);
        let program = SystemProgram::parse(&script)?;

        assert_eq!(
            program.decode(0x10)?.kind,
            SystemInstructionKind::UserScript(SystemUserScriptOp::Load)
        );
        assert_eq!(
            program.decode(0x12)?.kind,
            SystemInstructionKind::UserScript(SystemUserScriptOp::Call(0x2a))
        );
        assert_eq!(
            program.decode(0x14)?.kind,
            SystemInstructionKind::UserScript(SystemUserScriptOp::Return)
        );
        Ok(())
    }

    #[test]
    fn classifies_only_explicit_service_family_opcodes() -> Result<()> {
        let mut script = vec![0u8; 0x10];
        script.extend_from_slice(&[
            0x80, 0x01, 0x81, 0x02, 0x90, 0x03, 0x91, 0x04, 0x92, 0x05, 0xa0, 0x06, 0xb0, 0x07,
            0xc0, 0x08, 0xd0, 0x09, 0xe0, 0x0a, 0xa1, 0x17,
        ]);
        let program = SystemProgram::parse(&script)?;

        assert!(matches!(
            program.decode(0x10)?.kind,
            SystemInstructionKind::ServiceCall {
                family: SystemCallFamily::System,
                service_id: 1,
                ..
            }
        ));
        assert!(matches!(
            program.decode(0x1a)?.kind,
            SystemInstructionKind::ServiceCall {
                family: SystemCallFamily::Sound,
                service_id: 6,
                ..
            }
        ));
        assert!(program.decode(0x24).is_err());
        Ok(())
    }

    #[test]
    fn rejects_null_mnemonic_opcode_ranges_instead_of_treating_them_as_noops() -> Result<()> {
        for opcode in [0x07, 0x12, 0x2c, 0x41, 0x76, 0x82, 0x93, 0xa1] {
            let mut script = vec![0u8; 0x10];
            script.extend_from_slice(&[opcode, 0x17]);
            let program = SystemProgram::parse(&script)?;

            assert!(
                program.decode(0x10).is_err(),
                "opcode 0x{opcode:02x} must stay invalid"
            );
        }
        Ok(())
    }
}
