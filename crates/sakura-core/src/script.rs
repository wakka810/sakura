use crate::bytes::{read_exact, read_u32_le};
use crate::error::{Result, SakuraError};

pub const BURIKO_SCRIPT_V1_MAGIC: &[u8; 28] = b"BurikoCompiledScriptVer1.00\0";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScriptVersion {
    BurikoCompiledV1,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScriptSummary {
    pub version: ScriptVersion,
    pub code_offset: usize,
    pub code_length: usize,
    pub referenced_script_count: usize,
    pub label_count: usize,
    pub instruction_count: usize,
    pub code_address_operands: usize,
    pub string_address_operands: usize,
    pub message_string_operands: usize,
    pub character_name_string_operands: usize,
    pub choice_string_operands: usize,
    pub choice_function_call_count: usize,
    pub internal_string_operands: usize,
    pub user_function_call_count: usize,
    pub user_function_string_arg_operands: usize,
    pub max_user_function_string_args: usize,
    pub max_string_stack_depth: usize,
    pub largest_code_address: usize,
}

pub fn is_buriko_script_v1(data: &[u8]) -> bool {
    data.starts_with(BURIKO_SCRIPT_V1_MAGIC)
}

pub fn analyze_scenario_script(data: &[u8]) -> Result<ScriptSummary> {
    if !is_buriko_script_v1(data) {
        return Err(SakuraError::UnsupportedFormat(
            "unsupported Ethornell scenario script version".to_owned(),
        ));
    }

    let header = read_v1_header(data)?;
    let mut state = V1State::new(data, header);
    state.disassemble()?;
    Ok(state.summary())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct V1Header {
    pub(crate) code_offset: usize,
    pub(crate) referenced_script_count: usize,
    pub(crate) label_count: usize,
}

pub(crate) fn read_v1_header(data: &[u8]) -> Result<V1Header> {
    let header_size = read_u32_le(data, BURIKO_SCRIPT_V1_MAGIC.len())? as usize;
    if header_size < 4 {
        return Err(SakuraError::InvalidScript(
            "v1 header size is smaller than its length field".to_owned(),
        ));
    }

    let code_offset = BURIKO_SCRIPT_V1_MAGIC
        .len()
        .checked_add(header_size)
        .ok_or_else(|| SakuraError::InvalidScript("v1 code offset overflows".to_owned()))?;
    if code_offset > data.len() {
        return Err(SakuraError::UnexpectedEof {
            offset: BURIKO_SCRIPT_V1_MAGIC.len(),
            needed: header_size,
            available: data.len().saturating_sub(BURIKO_SCRIPT_V1_MAGIC.len()),
        });
    }

    let header_start = BURIKO_SCRIPT_V1_MAGIC.len() + 4;
    let mut cursor = header_start;
    let referenced_script_count = read_count(data, &mut cursor, code_offset)?;
    for _ in 0..referenced_script_count {
        skip_zero_terminated(data, &mut cursor, code_offset)?;
    }

    let label_count = read_count(data, &mut cursor, code_offset)?;
    for _ in 0..label_count {
        skip_zero_terminated(data, &mut cursor, code_offset)?;
        read_i32(data, &mut cursor, code_offset)?;
    }

    if cursor > code_offset {
        return Err(SakuraError::InvalidScript(
            "v1 header fields exceed declared code offset".to_owned(),
        ));
    }

    Ok(V1Header {
        code_offset,
        referenced_script_count,
        label_count,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct StackItem {
    value: i32,
}

#[derive(Debug)]
struct V1State<'a> {
    data: &'a [u8],
    cursor: usize,
    header: V1Header,
    instruction_count: usize,
    code_address_operands: usize,
    string_address_operands: usize,
    message_string_operands: usize,
    character_name_string_operands: usize,
    choice_string_operands: usize,
    choice_function_call_count: usize,
    internal_string_operands: usize,
    user_function_call_count: usize,
    user_function_string_arg_operands: usize,
    max_user_function_string_args: usize,
    max_string_stack_depth: usize,
    largest_code_address: usize,
    string_stack: Vec<StackItem>,
}

impl<'a> V1State<'a> {
    fn new(data: &'a [u8], header: V1Header) -> Self {
        Self {
            data,
            cursor: header.code_offset,
            header,
            instruction_count: 0,
            code_address_operands: 0,
            string_address_operands: 0,
            message_string_operands: 0,
            character_name_string_operands: 0,
            choice_string_operands: 0,
            choice_function_call_count: 0,
            internal_string_operands: 0,
            user_function_call_count: 0,
            user_function_string_arg_operands: 0,
            max_user_function_string_args: 0,
            max_string_stack_depth: 0,
            largest_code_address: 0,
            string_stack: Vec::new(),
        }
    }

    fn disassemble(&mut self) -> Result<()> {
        loop {
            let opcode = self.read_opcode()?;
            self.instruction_count += 1;
            match opcode {
                0x0001 => self.read_code_address()?,
                0x0003 => self.read_push_string_address()?,
                0x001c => self.handle_user_function_call()?,
                0x0140 | 0x0143 => self.handle_message()?,
                0x0160 => self.handle_choice_screen(),
                _ => self.read_template_operands(v1_operand_template(opcode))?,
            }

            if matches!(opcode, 0x007e | 0x007f | 0x00fe) {
                self.output_internal_strings();
            }
            if matches!(opcode, 0x001b | 0x00f4)
                && self.largest_code_address < self.cursor - self.header.code_offset
            {
                break;
            }
        }
        self.output_internal_strings();
        Ok(())
    }

    fn summary(&self) -> ScriptSummary {
        ScriptSummary {
            version: ScriptVersion::BurikoCompiledV1,
            code_offset: self.header.code_offset,
            code_length: self.cursor - self.header.code_offset,
            referenced_script_count: self.header.referenced_script_count,
            label_count: self.header.label_count,
            instruction_count: self.instruction_count,
            code_address_operands: self.code_address_operands,
            string_address_operands: self.string_address_operands,
            message_string_operands: self.message_string_operands,
            character_name_string_operands: self.character_name_string_operands,
            choice_string_operands: self.choice_string_operands,
            choice_function_call_count: self.choice_function_call_count,
            internal_string_operands: self.internal_string_operands,
            user_function_call_count: self.user_function_call_count,
            user_function_string_arg_operands: self.user_function_string_arg_operands,
            max_user_function_string_args: self.max_user_function_string_args,
            max_string_stack_depth: self.max_string_stack_depth,
            largest_code_address: self.largest_code_address,
        }
    }

    fn read_opcode(&mut self) -> Result<u32> {
        self.read_u32()
    }

    fn read_template_operands(&mut self, template: OperandTemplate) -> Result<()> {
        for operand in template.operands {
            match operand {
                Operand::I32 => {
                    self.read_i32()?;
                }
                Operand::CodeAddress => self.read_code_address()?,
            }
        }
        Ok(())
    }

    fn read_code_address(&mut self) -> Result<()> {
        let address = self.read_i32()?;
        if address < 0 {
            return Err(SakuraError::InvalidScript(
                "negative code address operand".to_owned(),
            ));
        }
        self.code_address_operands += 1;
        self.largest_code_address = self.largest_code_address.max(address as usize);
        Ok(())
    }

    fn read_push_string_address(&mut self) -> Result<()> {
        let value = self.read_i32()?;
        self.validate_string_address(value)?;
        self.string_address_operands += 1;
        self.string_stack.push(StackItem { value });
        self.max_string_stack_depth = self.max_string_stack_depth.max(self.string_stack.len());
        Ok(())
    }

    fn handle_user_function_call(&mut self) -> Result<()> {
        self.user_function_call_count += 1;
        let string_args = self.string_stack.len().saturating_sub(1);
        self.user_function_string_arg_operands += string_args;
        self.max_user_function_string_args = self.max_user_function_string_args.max(string_args);

        let Some(item) = self.string_stack.pop() else {
            return Ok(());
        };
        self.internal_string_operands += 1;
        if self.is_choice_function_address(item.value)? && !self.string_stack.is_empty() {
            self.choice_function_call_count += 1;
            self.handle_choice_screen();
        }
        Ok(())
    }

    fn handle_message(&mut self) -> Result<()> {
        let message = self.pop_string_operand("message opcode without message string")?;
        if let Some(name) = self.string_stack.pop() {
            if self.is_empty_string(name.value)? {
                self.internal_string_operands += 1;
            } else {
                self.character_name_string_operands += 1;
            }
        }

        if self.is_empty_string(message.value)? {
            self.internal_string_operands += 1;
        } else {
            self.message_string_operands += 1;
        }
        Ok(())
    }

    fn handle_choice_screen(&mut self) {
        self.choice_string_operands += self.string_stack.len();
        self.string_stack.clear();
    }

    fn output_internal_strings(&mut self) {
        self.internal_string_operands += self.string_stack.len();
        self.string_stack.clear();
    }

    fn pop_string_operand(&mut self, message: &str) -> Result<StackItem> {
        self.string_stack
            .pop()
            .ok_or_else(|| SakuraError::InvalidScript(message.to_owned()))
    }

    fn read_i32(&mut self) -> Result<i32> {
        read_i32(self.data, &mut self.cursor, self.data.len())
    }

    fn read_u32(&mut self) -> Result<u32> {
        let value = read_u32_le(self.data, self.cursor)?;
        self.cursor += 4;
        Ok(value)
    }

    fn validate_string_address(&self, address: i32) -> Result<()> {
        let offset = self.string_offset(address)?;
        let mut cursor = offset;
        skip_zero_terminated(self.data, &mut cursor, self.data.len())
    }

    fn is_empty_string(&self, address: i32) -> Result<bool> {
        let offset = self.string_offset(address)?;
        Ok(*self.data.get(offset).ok_or(SakuraError::UnexpectedEof {
            offset,
            needed: 1,
            available: 0,
        })? == 0)
    }

    fn is_choice_function_address(&self, address: i32) -> Result<bool> {
        self.string_bytes(address).map(is_choice_function_name)
    }

    fn string_bytes(&self, address: i32) -> Result<&'a [u8]> {
        let offset = self.string_offset(address)?;
        let tail = self.data.get(offset..).ok_or_else(|| {
            SakuraError::InvalidScript("string address is out of range".to_owned())
        })?;
        let end = tail
            .iter()
            .position(|byte| *byte == 0)
            .ok_or_else(|| SakuraError::InvalidScript("unterminated script string".to_owned()))?;
        Ok(&tail[..end])
    }

    fn string_offset(&self, address: i32) -> Result<usize> {
        if address < 0 {
            return Err(SakuraError::InvalidScript(
                "negative string address operand".to_owned(),
            ));
        }
        self.header
            .code_offset
            .checked_add(address as usize)
            .ok_or_else(|| SakuraError::InvalidScript("string address overflows".to_owned()))
    }
}

pub(crate) fn is_choice_function_name(name: &[u8]) -> bool {
    name == b"_SelectEx"
        || name
            .windows(b"select".len())
            .any(|window| window.eq_ignore_ascii_case(b"select"))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Operand {
    I32,
    CodeAddress,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct OperandTemplate {
    pub(crate) operands: &'static [Operand],
}

pub(crate) fn v1_operand_template(opcode: u32) -> OperandTemplate {
    use Operand::{CodeAddress, I32};
    match opcode {
        0x0000 | 0x0002 | 0x0008 | 0x0009 | 0x000a | 0x0017 | 0x0019 | 0x003f | 0x007e => {
            OperandTemplate { operands: &[I32] }
        }
        0x007f => OperandTemplate {
            operands: &[I32, I32],
        },
        0x007b => OperandTemplate {
            operands: &[I32, I32, I32],
        },
        0x0001 => OperandTemplate {
            operands: &[CodeAddress],
        },
        _ => OperandTemplate { operands: &[] },
    }
}

fn read_count(data: &[u8], cursor: &mut usize, end: usize) -> Result<usize> {
    let value = read_i32(data, cursor, end)?;
    if value < 0 {
        return Err(SakuraError::InvalidScript(
            "negative script header count".to_owned(),
        ));
    }
    Ok(value as usize)
}

pub(crate) fn read_i32(data: &[u8], cursor: &mut usize, end: usize) -> Result<i32> {
    let read_end = (*cursor)
        .checked_add(4)
        .ok_or_else(|| SakuraError::InvalidScript("script cursor overflows".to_owned()))?;
    if read_end > end {
        return Err(SakuraError::UnexpectedEof {
            offset: *cursor,
            needed: 4,
            available: data.len().saturating_sub(*cursor),
        });
    }
    let bytes = read_exact(data, *cursor, 4)?;
    *cursor += 4;
    Ok(i32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

pub(crate) fn skip_zero_terminated(data: &[u8], cursor: &mut usize, end: usize) -> Result<()> {
    let relative_end = data
        .get(*cursor..end)
        .and_then(|tail| tail.iter().position(|byte| *byte == 0))
        .ok_or_else(|| SakuraError::InvalidScript("unterminated script string".to_owned()))?;
    *cursor += relative_end + 1;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn analyzes_synthetic_v1_message_script() -> Result<()> {
        let mut script = synthetic_v1_header();
        append_push_string(&mut script, 24);
        append_push_string(&mut script, 29);
        append_opcode(&mut script, 0x0140);
        append_opcode(&mut script, 0x001b);
        script.extend_from_slice(b"name\0message\0");

        let summary = analyze_scenario_script(&script)?;

        assert_eq!(summary.version, ScriptVersion::BurikoCompiledV1);
        assert_eq!(summary.code_offset, BURIKO_SCRIPT_V1_MAGIC.len() + 12);
        assert_eq!(summary.code_length, 24);
        assert_eq!(summary.instruction_count, 4);
        assert_eq!(summary.string_address_operands, 2);
        assert_eq!(summary.message_string_operands, 1);
        assert_eq!(summary.character_name_string_operands, 1);
        assert_eq!(summary.internal_string_operands, 0);
        Ok(())
    }

    #[test]
    fn analyzes_synthetic_v1_choice_script() -> Result<()> {
        let mut script = synthetic_v1_header();
        append_push_string(&mut script, 24);
        append_push_string(&mut script, 31);
        append_opcode(&mut script, 0x0160);
        append_opcode(&mut script, 0x001b);
        script.extend_from_slice(b"first\0second\0");

        let summary = analyze_scenario_script(&script)?;

        assert_eq!(summary.choice_string_operands, 2);
        assert_eq!(summary.message_string_operands, 0);
        assert_eq!(summary.max_string_stack_depth, 2);
        Ok(())
    }

    fn synthetic_v1_header() -> Vec<u8> {
        let mut script = Vec::new();
        script.extend_from_slice(BURIKO_SCRIPT_V1_MAGIC);
        script.extend_from_slice(&12i32.to_le_bytes());
        script.extend_from_slice(&0i32.to_le_bytes());
        script.extend_from_slice(&0i32.to_le_bytes());
        script
    }

    fn append_push_string(script: &mut Vec<u8>, address: i32) {
        append_opcode(script, 0x0003);
        script.extend_from_slice(&address.to_le_bytes());
    }

    fn append_opcode(script: &mut Vec<u8>, opcode: u32) {
        script.extend_from_slice(&opcode.to_le_bytes());
    }
}
