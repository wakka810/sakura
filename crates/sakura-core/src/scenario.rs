use std::collections::BTreeMap;

use crate::bytes::read_u32_le;
use crate::error::{Result, SakuraError};
use crate::script::{
    is_buriko_script_v1, is_choice_function_name, read_i32, read_v1_header, skip_zero_terminated,
    v1_operand_template, Operand, V1Header,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScenarioProgram<'a> {
    data: &'a [u8],
    header: V1Header,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScenarioLabel<'a> {
    pub name: &'a [u8],
    pub offset: usize,
}

impl<'a> ScenarioProgram<'a> {
    pub fn parse(data: &'a [u8]) -> Result<Self> {
        if !is_buriko_script_v1(data) {
            return Err(SakuraError::UnsupportedFormat(
                "unsupported Ethornell scenario script version".to_owned(),
            ));
        }
        Ok(Self {
            data,
            header: read_v1_header(data)?,
        })
    }

    pub fn entry_offset(&self) -> usize {
        self.header.code_offset
    }

    pub fn labels(&self) -> Result<Vec<ScenarioLabel<'a>>> {
        let mut cursor = crate::script::BURIKO_SCRIPT_V1_MAGIC.len() + 4;
        let referenced_script_count =
            read_i32(self.data, &mut cursor, self.header.code_offset)? as usize;
        for _ in 0..referenced_script_count {
            skip_zero_terminated(self.data, &mut cursor, self.header.code_offset)?;
        }
        let label_count = read_i32(self.data, &mut cursor, self.header.code_offset)? as usize;
        let mut labels = Vec::with_capacity(label_count);
        for _ in 0..label_count {
            let name_start = cursor;
            skip_zero_terminated(self.data, &mut cursor, self.header.code_offset)?;
            let name = &self.data[name_start..cursor - 1];
            let offset = read_i32(self.data, &mut cursor, self.header.code_offset)?;
            if offset < 0 {
                return Err(SakuraError::InvalidScript(
                    "negative scenario label offset".to_owned(),
                ));
            }
            labels.push(ScenarioLabel {
                name,
                offset: offset as usize,
            });
        }
        Ok(labels)
    }

    pub fn label_offset(&self, name: &[u8]) -> Result<Option<usize>> {
        Ok(self
            .labels()?
            .into_iter()
            .find(|label| label.name.eq_ignore_ascii_case(name))
            .map(|label| label.offset))
    }

    pub fn string_bytes(&self, address: i32) -> Result<&'a [u8]> {
        let offset = self.string_offset(address)?;
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

    fn string_offset(&self, address: i32) -> Result<usize> {
        if address < 0 {
            return Err(SakuraError::InvalidScript(
                "negative string address operand".to_owned(),
            ));
        }
        let offset = self
            .header
            .code_offset
            .checked_add(address as usize)
            .ok_or_else(|| SakuraError::InvalidScript("string address overflows".to_owned()))?;
        let mut cursor = offset;
        skip_zero_terminated(self.data, &mut cursor, self.data.len())?;
        Ok(offset)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScenarioMessage<'a> {
    pub opcode: u32,
    pub offset: usize,
    pub int_args: Vec<i32>,
    pub name: Option<&'a [u8]>,
    pub text: &'a [u8],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScenarioChoice<'a> {
    pub opcode: u32,
    pub offset: usize,
    pub int_args: Vec<i32>,
    pub options: Vec<&'a [u8]>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScenarioUserFunction<'a> {
    pub offset: usize,
    pub int_args: Vec<i32>,
    pub name: &'a [u8],
    pub string_args: Vec<&'a [u8]>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScenarioGraphCommand<'a> {
    pub opcode: u32,
    pub offset: usize,
    pub int_args: Vec<i32>,
    pub string_args: Vec<&'a [u8]>,
    pub array_args: Vec<ScenarioArrayArg>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScenarioArrayArg {
    pub index: usize,
    pub address: u32,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScenarioSoundCommand<'a> {
    pub opcode: u32,
    pub offset: usize,
    pub int_args: Vec<i32>,
    pub string_args: Vec<&'a [u8]>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScenarioControlCommand<'a> {
    pub opcode: u32,
    pub offset: usize,
    pub int_args: Vec<i32>,
    pub string_args: Vec<&'a [u8]>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScenarioWait {
    pub opcode: u32,
    pub offset: usize,
    pub duration_ms: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScenarioMessageControl {
    pub opcode: u32,
    pub offset: usize,
    pub duration_ms: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScenarioEvent<'a> {
    Message(ScenarioMessage<'a>),
    Choice(ScenarioChoice<'a>),
    UserFunction(ScenarioUserFunction<'a>),
    Graph(ScenarioGraphCommand<'a>),
    Sound(ScenarioSoundCommand<'a>),
    Wait(ScenarioWait),
    MessageControl(ScenarioMessageControl),
    Halted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ScenarioEventSummary {
    pub message_count: usize,
    pub choice_count: usize,
    pub user_function_count: usize,
    pub graph_count: usize,
    pub sound_count: usize,
    pub wait_count: usize,
    pub message_control_count: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct StringOperand {
    address: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ScenarioNumericValue {
    Integer(i32),
    Address(u32),
}

impl ScenarioNumericValue {
    fn integer(self) -> i32 {
        match self {
            Self::Integer(value) => value,
            Self::Address(address) => address as i32,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ScenarioVm<'a> {
    program: ScenarioProgram<'a>,
    cursor: usize,
    max_code_address: usize,
    time_count_ms: u32,
    random_state: u32,
    halted: bool,
    string_stack: Vec<StringOperand>,
    numeric_stack: Vec<ScenarioNumericValue>,
    memory: BTreeMap<u32, u8>,
    number_variables: BTreeMap<i32, i32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScenarioVmCheckpoint {
    cursor: usize,
    max_code_address: usize,
    time_count_ms: u32,
    random_state: u32,
    halted: bool,
    string_stack: Vec<i32>,
    numeric_stack: Vec<ScenarioNumericValue>,
    memory: BTreeMap<u32, u8>,
    number_variables: BTreeMap<i32, i32>,
}

impl ScenarioVmCheckpoint {
    pub(crate) fn from_parts(
        cursor: usize,
        max_code_address: usize,
        time_count_ms: u32,
        random_state: u32,
        halted: bool,
        string_stack: Vec<i32>,
        numeric_stack: Vec<ScenarioNumericValue>,
        memory: BTreeMap<u32, u8>,
        number_variables: BTreeMap<i32, i32>,
    ) -> Self {
        Self {
            cursor,
            max_code_address,
            time_count_ms,
            random_state,
            halted,
            string_stack,
            numeric_stack,
            memory,
            number_variables,
        }
    }

    pub fn cursor(&self) -> usize {
        self.cursor
    }

    pub fn max_code_address(&self) -> usize {
        self.max_code_address
    }

    pub fn time_count_ms(&self) -> u32 {
        self.time_count_ms
    }

    pub fn random_state(&self) -> u32 {
        self.random_state
    }

    pub fn is_halted(&self) -> bool {
        self.halted
    }

    pub fn string_stack(&self) -> &[i32] {
        &self.string_stack
    }

    pub(crate) fn numeric_stack(&self) -> &[ScenarioNumericValue] {
        &self.numeric_stack
    }

    pub(crate) fn memory(&self) -> &BTreeMap<u32, u8> {
        &self.memory
    }

    pub(crate) fn number_variables(&self) -> &BTreeMap<i32, i32> {
        &self.number_variables
    }
}

impl<'a> ScenarioVm<'a> {
    pub fn new(program: ScenarioProgram<'a>) -> Self {
        Self {
            cursor: program.entry_offset(),
            program,
            max_code_address: 0,
            time_count_ms: 0,
            random_state: 1,
            halted: false,
            string_stack: Vec::new(),
            numeric_stack: Vec::new(),
            memory: BTreeMap::new(),
            number_variables: BTreeMap::new(),
        }
    }

    pub fn cursor(&self) -> usize {
        self.cursor
    }

    pub fn is_halted(&self) -> bool {
        self.halted
    }

    pub fn checkpoint(&self) -> ScenarioVmCheckpoint {
        ScenarioVmCheckpoint {
            cursor: self.cursor,
            max_code_address: self.max_code_address,
            time_count_ms: self.time_count_ms,
            random_state: self.random_state,
            halted: self.halted,
            string_stack: self.string_stack.iter().map(|item| item.address).collect(),
            numeric_stack: self.numeric_stack.clone(),
            memory: self.memory.clone(),
            number_variables: self.number_variables.clone(),
        }
    }

    pub fn restore(program: ScenarioProgram<'a>, checkpoint: ScenarioVmCheckpoint) -> Result<Self> {
        if checkpoint.cursor < program.entry_offset() || checkpoint.cursor > program.data.len() {
            return Err(SakuraError::InvalidRuntime(
                "scenario checkpoint cursor is out of range".to_owned(),
            ));
        }
        let mut string_stack = Vec::with_capacity(checkpoint.string_stack.len());
        for address in checkpoint.string_stack {
            program.string_bytes(address)?;
            string_stack.push(StringOperand { address });
        }
        Ok(Self {
            program,
            cursor: checkpoint.cursor,
            max_code_address: checkpoint.max_code_address,
            time_count_ms: checkpoint.time_count_ms,
            random_state: checkpoint.random_state,
            halted: checkpoint.halted,
            string_stack,
            numeric_stack: checkpoint.numeric_stack,
            memory: checkpoint.memory,
            number_variables: checkpoint.number_variables,
        })
    }

    pub fn next_event(&mut self) -> Result<ScenarioEvent<'a>> {
        while !self.halted {
            let offset = self.cursor;
            let opcode = self.read_opcode()?;
            match opcode {
                0x0000 => self.push_int_operand()?,
                0x0002 => self.push_address_operand()?,
                0x0001 => self.read_code_address_operand()?,
                0x0003 => self.read_string_address_operand()?,
                0x0008 => self.load_memory_operand()?,
                0x0009 => self.store_memory_operand(true, false)?,
                0x000a => self.store_memory_operand(false, true)?,
                0x0020 => self.fold_binary_numeric(NumericOperation::Add),
                0x0021 => self.fold_binary_numeric(NumericOperation::Subtract),
                0x0022 => self.fold_binary_numeric(NumericOperation::Multiply),
                0x00e0 => self.store_number_variable()?,
                0x00e1 => self.load_number_variable()?,
                0x0101 => self.push_time_count(),
                0x001c => {
                    if let Some(event) = self.handle_user_function(offset)? {
                        return Ok(event);
                    }
                }
                0x0110 => return self.handle_wait(offset, opcode),
                0x0140 => return self.handle_message(offset, opcode),
                0x0143 => self.handle_message_process_command(),
                0x0150..=0x0153 => return self.handle_message_control(offset, opcode),
                0x0160 => return self.handle_choice(offset, opcode),
                0x0180..=0x01af => return self.handle_sound(offset, opcode),
                0x0200..=0x03ff => return self.handle_graph(offset, opcode),
                _ => self.read_template_operands(opcode)?,
            }

            if matches!(opcode, 0x007e | 0x007f | 0x00fe) {
                self.string_stack.clear();
                self.numeric_stack.clear();
            }
            if matches!(opcode, 0x001b | 0x00f4)
                && self.max_code_address < self.cursor - self.program.header.code_offset
            {
                self.halted = true;
            }
        }
        Ok(ScenarioEvent::Halted)
    }

    /// Walks the whole script recording an opcode histogram (debug/audit).
    pub fn opcode_histogram(&mut self) -> Result<std::collections::BTreeMap<u32, usize>> {
        let mut hist = std::collections::BTreeMap::new();
        while !self.halted {
            let offset = self.cursor;
            let opcode = self.read_opcode()?;
            *hist.entry(opcode).or_insert(0usize) += 1;
            match opcode {
                0x0000 => self.push_int_operand()?,
                0x0002 => self.push_address_operand()?,
                0x0001 => self.read_code_address_operand()?,
                0x0003 => self.read_string_address_operand()?,
                0x0008 => self.load_memory_operand()?,
                0x0009 => self.store_memory_operand(true, false)?,
                0x000a => self.store_memory_operand(false, true)?,
                0x0020 => self.fold_binary_numeric(NumericOperation::Add),
                0x0021 => self.fold_binary_numeric(NumericOperation::Subtract),
                0x0022 => self.fold_binary_numeric(NumericOperation::Multiply),
                0x00e0 => self.store_number_variable()?,
                0x00e1 => self.load_number_variable()?,
                0x0101 => self.push_time_count(),
                0x001c => {
                    let _ = self.handle_user_function(offset)?;
                }
                0x0110 => {
                    let _ = self.handle_wait(offset, opcode)?;
                }
                0x0140 => {
                    let _ = self.handle_message(offset, opcode)?;
                }
                0x0143 => self.handle_message_process_command(),
                0x0150..=0x0153 => {
                    let _ = self.handle_message_control(offset, opcode)?;
                }
                0x0160 => {
                    let _ = self.handle_choice(offset, opcode)?;
                }
                0x0180..=0x01af => {
                    let _ = self.handle_sound(offset, opcode)?;
                }
                0x0200..=0x03ff => {
                    let _ = self.handle_graph(offset, opcode)?;
                }
                _ => self.read_template_operands(opcode)?,
            }
            if matches!(opcode, 0x007e | 0x007f | 0x00fe) {
                self.string_stack.clear();
                self.numeric_stack.clear();
            }
            if matches!(opcode, 0x001b | 0x00f4)
                && self.max_code_address < self.cursor - self.program.header.code_offset
            {
                self.halted = true;
            }
        }
        Ok(hist)
    }

    /// Linearly audits scenario control commands that are not visible playback events.
    pub fn control_command_trace(&mut self) -> Result<Vec<ScenarioControlCommand<'a>>> {
        let mut commands = Vec::new();
        while !self.halted {
            let offset = self.cursor;
            let opcode = self.read_opcode()?;
            match opcode {
                0x0000 => self.push_int_operand()?,
                0x0002 => self.push_address_operand()?,
                0x0001 => self.read_code_address_operand()?,
                0x0003 => self.read_string_address_operand()?,
                0x0008 => self.load_memory_operand()?,
                0x0009 => self.store_memory_operand(true, false)?,
                0x000a => self.store_memory_operand(false, true)?,
                0x0020 => self.fold_binary_numeric(NumericOperation::Add),
                0x0021 => self.fold_binary_numeric(NumericOperation::Subtract),
                0x0022 => self.fold_binary_numeric(NumericOperation::Multiply),
                0x00e0 => self.store_number_variable()?,
                0x00e1 => self.load_number_variable()?,
                0x0101 => self.push_time_count(),
                0x001c => {
                    let _ = self.handle_user_function(offset)?;
                }
                0x0110 => {
                    let _ = self.handle_wait(offset, opcode)?;
                }
                0x0140 => {
                    let _ = self.handle_message(offset, opcode)?;
                }
                0x0143 => self.handle_message_process_command(),
                0x0150..=0x0153 => {
                    let _ = self.handle_message_control(offset, opcode)?;
                }
                0x0160 => {
                    let _ = self.handle_choice(offset, opcode)?;
                }
                0x0180..=0x01af => {
                    let _ = self.handle_sound(offset, opcode)?;
                }
                0x0200..=0x03ff => {
                    let _ = self.handle_graph(offset, opcode)?;
                }
                0x00f0 | 0x0100..=0x017f => {
                    commands.push(ScenarioControlCommand {
                        opcode,
                        offset,
                        int_args: self.drain_int_args(),
                        string_args: self.drain_string_stack()?,
                    });
                }
                _ => self.read_template_operands(opcode)?,
            }
            if matches!(opcode, 0x007e | 0x007f | 0x00fe) {
                self.string_stack.clear();
                self.numeric_stack.clear();
            }
            if matches!(opcode, 0x001b | 0x00f4)
                && self.max_code_address < self.cursor - self.program.header.code_offset
            {
                self.halted = true;
            }
        }
        Ok(commands)
    }

    fn read_opcode(&mut self) -> Result<u32> {
        let opcode = read_u32_le(self.program.data, self.cursor)?;
        self.cursor += 4;
        Ok(opcode)
    }

    fn read_code_address_operand(&mut self) -> Result<()> {
        let address = self.read_i32()?;
        if address < 0 {
            return Err(SakuraError::InvalidScript(
                "negative code address operand".to_owned(),
            ));
        }
        self.max_code_address = self.max_code_address.max(address as usize);
        Ok(())
    }

    fn push_int_operand(&mut self) -> Result<()> {
        let value = self.read_i32()?;
        self.numeric_stack
            .push(ScenarioNumericValue::Integer(value));
        Ok(())
    }

    fn push_address_operand(&mut self) -> Result<()> {
        let address = self.read_i32()? as u32;
        self.numeric_stack
            .push(ScenarioNumericValue::Address(address));
        Ok(())
    }

    fn read_string_address_operand(&mut self) -> Result<()> {
        let address = self.read_i32()?;
        self.program.string_bytes(address)?;
        self.string_stack.push(StringOperand { address });
        Ok(())
    }

    fn fold_binary_numeric(&mut self, operation: NumericOperation) {
        if self.numeric_stack.len() < 2 {
            return;
        }
        let right = self.numeric_stack.pop().expect("length checked");
        let left = self.numeric_stack.pop().expect("length checked");
        let value = match (operation, left, right) {
            (
                NumericOperation::Add,
                ScenarioNumericValue::Address(address),
                ScenarioNumericValue::Integer(offset),
            )
            | (
                NumericOperation::Add,
                ScenarioNumericValue::Integer(offset),
                ScenarioNumericValue::Address(address),
            ) => ScenarioNumericValue::Address(address.wrapping_add(offset as u32)),
            (
                NumericOperation::Subtract,
                ScenarioNumericValue::Address(address),
                ScenarioNumericValue::Integer(offset),
            ) => ScenarioNumericValue::Address(address.wrapping_sub(offset as u32)),
            (NumericOperation::Add, left, right) => {
                ScenarioNumericValue::Integer(left.integer().wrapping_add(right.integer()))
            }
            (NumericOperation::Subtract, left, right) => {
                ScenarioNumericValue::Integer(left.integer().wrapping_sub(right.integer()))
            }
            (NumericOperation::Multiply, left, right) => {
                ScenarioNumericValue::Integer(left.integer().wrapping_mul(right.integer()))
            }
        };
        self.numeric_stack.push(value);
    }

    fn push_time_count(&mut self) {
        self.numeric_stack
            .push(ScenarioNumericValue::Integer(self.time_count_ms as i32));
    }

    fn store_number_variable(&mut self) -> Result<()> {
        let key = self
            .pop_numeric("number variable store without key")?
            .integer();
        let value = self
            .pop_numeric("number variable store without value")?
            .integer();
        self.number_variables.insert(key, value);
        Ok(())
    }

    fn load_number_variable(&mut self) -> Result<()> {
        let key = self
            .pop_numeric("number variable load without key")?
            .integer();
        let value = self.number_variables.get(&key).copied().unwrap_or(0);
        self.numeric_stack
            .push(ScenarioNumericValue::Integer(value));
        Ok(())
    }

    fn load_memory_operand(&mut self) -> Result<()> {
        let width = self.read_memory_width()?;
        let address = self.pop_address("memory load without address")?;
        let value = self.read_memory_value(address, width)?;
        self.numeric_stack
            .push(ScenarioNumericValue::Integer(value));
        Ok(())
    }

    fn store_memory_operand(&mut self, repush: bool, address_first: bool) -> Result<()> {
        let width = self.read_memory_width()?;
        let (address, value) = if address_first {
            let address = self.pop_address("memory store without address")?;
            let value = self.pop_store_value()?;
            (address, value)
        } else {
            let value = self.pop_store_value()?;
            let address = self.pop_address("memory store without address")?;
            (address, value)
        };
        self.write_memory_value(address, width, value.integer())?;
        if repush {
            match value {
                StoreValue::Numeric(value) => self.numeric_stack.push(value),
                StoreValue::String(value) => self.string_stack.push(value),
            }
        }
        Ok(())
    }

    fn pop_store_value(&mut self) -> Result<StoreValue> {
        if matches!(
            self.numeric_stack.last(),
            Some(ScenarioNumericValue::Integer(_))
        ) || self.string_stack.is_empty()
        {
            return self
                .pop_numeric("memory store without value")
                .map(StoreValue::Numeric);
        }
        self.string_stack
            .pop()
            .map(StoreValue::String)
            .ok_or_else(|| {
                SakuraError::InvalidScript(format!(
                    "memory store without value at script offset 0x{:x}",
                    self.cursor.saturating_sub(self.program.header.code_offset)
                ))
            })
    }

    fn read_memory_width(&mut self) -> Result<usize> {
        match self.read_i32()? {
            0 => Ok(1),
            1 => Ok(2),
            2 => Ok(4),
            value => Err(SakuraError::InvalidScript(format!(
                "unsupported scenario memory width {value}"
            ))),
        }
    }

    fn read_memory_value(&self, address: u32, width: usize) -> Result<i32> {
        let bytes = self.memory_bytes(address, width)?;
        Ok(match width {
            1 => i8::from_le_bytes([bytes[0]]) as i32,
            2 => i16::from_le_bytes([bytes[0], bytes[1]]) as i32,
            4 => i32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]),
            _ => unreachable!("validated memory width"),
        })
    }

    fn write_memory_value(&mut self, address: u32, width: usize, value: i32) -> Result<()> {
        let end = address.checked_add(width as u32).ok_or_else(|| {
            SakuraError::InvalidScript("scenario memory write address overflows".to_owned())
        })?;
        let bytes = value.to_le_bytes();
        for (offset, byte) in bytes[..width].iter().copied().enumerate() {
            self.memory.insert(address + offset as u32, byte);
        }
        debug_assert_eq!(end, address + width as u32);
        Ok(())
    }

    fn memory_bytes(&self, address: u32, len: usize) -> Result<Vec<u8>> {
        address.checked_add(len as u32).ok_or_else(|| {
            SakuraError::InvalidScript("scenario memory read address overflows".to_owned())
        })?;
        Ok((0..len)
            .map(|offset| {
                self.memory
                    .get(&(address + offset as u32))
                    .copied()
                    .unwrap_or(0)
            })
            .collect())
    }

    fn pop_numeric(&mut self, message: &str) -> Result<ScenarioNumericValue> {
        self.numeric_stack.pop().ok_or_else(|| {
            SakuraError::InvalidScript(format!(
                "{message} at script offset 0x{:x}",
                self.cursor.saturating_sub(self.program.header.code_offset)
            ))
        })
    }

    fn pop_address(&mut self, message: &str) -> Result<u32> {
        match self.pop_numeric(message)? {
            ScenarioNumericValue::Address(address) => Ok(address),
            ScenarioNumericValue::Integer(address) => Ok(address as u32),
        }
    }

    fn read_template_operands(&mut self, opcode: u32) -> Result<()> {
        for operand in v1_operand_template(opcode).operands {
            match operand {
                Operand::I32 => {
                    self.read_i32()?;
                }
                Operand::CodeAddress => self.read_code_address_operand()?,
            }
        }
        Ok(())
    }

    fn handle_message(&mut self, offset: usize, opcode: u32) -> Result<ScenarioEvent<'a>> {
        let message = self.pop_string_operand("message opcode without message string")?;
        let name = self
            .string_stack
            .pop()
            .map(|item| self.program.string_bytes(item.address))
            .transpose()?
            .filter(|value| !value.is_empty());
        let text = self.program.string_bytes(message.address)?;
        Ok(ScenarioEvent::Message(ScenarioMessage {
            opcode,
            offset,
            int_args: self.drain_int_args(),
            name,
            text,
        }))
    }

    fn handle_message_process_command(&mut self) {
        // 0x0143 updates an existing CProcDspMsg (sub_47C060 -> sub_43C380);
        // it does not create a visible message. Pending values are its arguments.
        self.string_stack.clear();
        self.numeric_stack.clear();
    }

    fn handle_choice(&mut self, offset: usize, opcode: u32) -> Result<ScenarioEvent<'a>> {
        let options = self.drain_string_stack()?;
        Ok(ScenarioEvent::Choice(ScenarioChoice {
            opcode,
            offset,
            int_args: self.drain_int_args(),
            options,
        }))
    }

    fn handle_user_function(&mut self, offset: usize) -> Result<Option<ScenarioEvent<'a>>> {
        let Some(function) = self.string_stack.pop() else {
            return Ok(None);
        };
        let name = self.program.string_bytes(function.address)?;
        let string_args = self.drain_string_stack()?;
        let int_args = if name.eq_ignore_ascii_case(b"RandomNumberReturn") {
            let args = self.pop_trailing_int_args(2, "RandomNumberReturn requires two integers")?;
            let span = args[0];
            let base = args[1];
            let bound = span.saturating_add(1);
            let result = base.wrapping_add(self.bounded_random(bound));
            self.numeric_stack
                .push(ScenarioNumericValue::Integer(result));
            args
        } else if name.eq_ignore_ascii_case(b"RandomNumberSet") {
            let args = self.pop_trailing_int_args(3, "RandomNumberSet requires three integers")?;
            let key = args[0];
            let span = args[1];
            let base = args[2];
            let bound = span.saturating_add(1);
            let result = base.wrapping_add(self.bounded_random(bound));
            self.number_variables.insert(key, result);
            args
        } else {
            self.drain_int_args()
        };
        if is_choice_function_name(name) && !string_args.is_empty() {
            return Ok(Some(ScenarioEvent::Choice(ScenarioChoice {
                opcode: 0x001c,
                offset,
                int_args,
                options: string_args,
            })));
        }
        Ok(Some(ScenarioEvent::UserFunction(ScenarioUserFunction {
            offset,
            int_args,
            name,
            string_args,
        })))
    }

    fn pop_trailing_int_args(&mut self, count: usize, message: &str) -> Result<Vec<i32>> {
        if self.numeric_stack.len() < count {
            return Err(SakuraError::InvalidScript(message.to_owned()));
        }
        let start = self.numeric_stack.len() - count;
        let values = self.numeric_stack.split_off(start);
        values
            .into_iter()
            .map(|value| match value {
                ScenarioNumericValue::Integer(value) => Ok(value),
                ScenarioNumericValue::Address(_) => {
                    Err(SakuraError::InvalidScript(message.to_owned()))
                }
            })
            .collect()
    }

    fn bounded_random(&mut self, bound: i32) -> i32 {
        if bound <= 0 {
            return 0;
        }
        let first = self.next_msvcrt_random() << 8;
        let second = (first ^ self.next_msvcrt_random()) << 8;
        ((second ^ self.next_msvcrt_random()) % bound as u32) as i32
    }

    fn next_msvcrt_random(&mut self) -> u32 {
        self.random_state = self
            .random_state
            .wrapping_mul(214_013)
            .wrapping_add(2_531_011);
        (self.random_state >> 16) & 0x7fff
    }

    fn handle_graph(&mut self, offset: usize, opcode: u32) -> Result<ScenarioEvent<'a>> {
        let array_args = self.graph_array_args(opcode)?;
        let int_args = self.drain_int_args();
        Ok(ScenarioEvent::Graph(ScenarioGraphCommand {
            opcode,
            offset,
            int_args,
            string_args: self.drain_string_stack()?,
            array_args,
        }))
    }

    fn handle_sound(&mut self, offset: usize, opcode: u32) -> Result<ScenarioEvent<'a>> {
        Ok(ScenarioEvent::Sound(ScenarioSoundCommand {
            opcode,
            offset,
            int_args: self.drain_int_args(),
            string_args: self.drain_string_stack()?,
        }))
    }

    fn handle_wait(&mut self, offset: usize, opcode: u32) -> Result<ScenarioEvent<'a>> {
        let duration_ms = self
            .numeric_stack
            .pop()
            .map(ScenarioNumericValue::integer)
            .ok_or_else(|| SakuraError::InvalidScript("wait opcode without duration".to_owned()))?;
        if duration_ms < 0 {
            return Err(SakuraError::InvalidScript(
                "wait opcode has negative duration".to_owned(),
            ));
        }
        self.numeric_stack.clear();
        self.string_stack.clear();
        self.time_count_ms = self.time_count_ms.wrapping_add(duration_ms as u32);
        Ok(ScenarioEvent::Wait(ScenarioWait {
            opcode,
            offset,
            duration_ms: duration_ms as u32,
        }))
    }

    fn handle_message_control(&mut self, offset: usize, opcode: u32) -> Result<ScenarioEvent<'a>> {
        let duration_ms = match opcode {
            0x0150 | 0x0151 => 150,
            0x0152 | 0x0153 => {
                let value = self
                    .numeric_stack
                    .pop()
                    .map(ScenarioNumericValue::integer)
                    .ok_or_else(|| {
                        SakuraError::InvalidScript(
                            "message control opcode without duration".to_owned(),
                        )
                    })?;
                if value < 0 {
                    return Err(SakuraError::InvalidScript(
                        "message control opcode has negative duration".to_owned(),
                    ));
                }
                value as u32
            }
            _ => unreachable!("message control handler called for opcode {opcode:#x}"),
        };
        self.numeric_stack.clear();
        self.string_stack.clear();
        self.time_count_ms = self.time_count_ms.wrapping_add(duration_ms);
        Ok(ScenarioEvent::MessageControl(ScenarioMessageControl {
            opcode,
            offset,
            duration_ms,
        }))
    }

    fn drain_string_stack(&mut self) -> Result<Vec<&'a [u8]>> {
        let mut values = Vec::with_capacity(self.string_stack.len());
        for item in self.string_stack.drain(..) {
            values.push(self.program.string_bytes(item.address)?);
        }
        Ok(values)
    }

    fn drain_int_args(&mut self) -> Vec<i32> {
        std::mem::take(&mut self.numeric_stack)
            .into_iter()
            .filter_map(|value| match value {
                ScenarioNumericValue::Integer(value) => Some(value),
                ScenarioNumericValue::Address(_) => None,
            })
            .collect()
    }

    fn graph_array_args(&self, opcode: u32) -> Result<Vec<ScenarioArrayArg>> {
        if opcode != 0x030e {
            return Ok(Vec::new());
        }
        let mut arrays = Vec::new();
        for (index, value) in self.numeric_stack.iter().copied().enumerate() {
            let ScenarioNumericValue::Address(address) = value else {
                continue;
            };
            let motion_count = self
                .numeric_stack
                .get(index + 1)
                .copied()
                .map(ScenarioNumericValue::integer)
                .unwrap_or(0);
            if !(0..=16).contains(&motion_count) {
                return Err(SakuraError::InvalidScript(format!(
                    "MotionCtlSprite motion count {motion_count} is out of range"
                )));
            }
            let len = motion_count as usize * 0x120;
            arrays.push(ScenarioArrayArg {
                index,
                address,
                bytes: self.memory_bytes(address, len)?,
            });
        }
        Ok(arrays)
    }

    fn pop_string_operand(&mut self, message: &str) -> Result<StringOperand> {
        self.string_stack
            .pop()
            .ok_or_else(|| SakuraError::InvalidScript(message.to_owned()))
    }

    fn read_i32(&mut self) -> Result<i32> {
        read_i32(self.program.data, &mut self.cursor, self.program.data.len())
    }
}

#[derive(Debug, Clone, Copy)]
enum NumericOperation {
    Add,
    Subtract,
    Multiply,
}

#[derive(Debug, Clone, Copy)]
enum StoreValue {
    Numeric(ScenarioNumericValue),
    String(StringOperand),
}

impl StoreValue {
    fn integer(self) -> i32 {
        match self {
            Self::Numeric(value) => value.integer(),
            Self::String(value) => value.address,
        }
    }
}

pub fn summarize_scenario_events(data: &[u8]) -> Result<ScenarioEventSummary> {
    let program = ScenarioProgram::parse(data)?;
    let mut vm = ScenarioVm::new(program);
    let mut summary = ScenarioEventSummary::default();
    loop {
        match vm.next_event()? {
            ScenarioEvent::Message(_) => summary.message_count += 1,
            ScenarioEvent::Choice(_) => summary.choice_count += 1,
            ScenarioEvent::UserFunction(_) => summary.user_function_count += 1,
            ScenarioEvent::Graph(_) => summary.graph_count += 1,
            ScenarioEvent::Sound(_) => summary.sound_count += 1,
            ScenarioEvent::Wait(_) => summary.wait_count += 1,
            ScenarioEvent::MessageControl(_) => summary.message_control_count += 1,
            ScenarioEvent::Halted => break,
        }
    }
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::script::BURIKO_SCRIPT_V1_MAGIC;

    #[test]
    fn steps_synthetic_message_event() -> Result<()> {
        let mut script = synthetic_v1_header();
        append_push_string(&mut script, 24);
        append_push_string(&mut script, 29);
        append_opcode(&mut script, 0x0140);
        append_opcode(&mut script, 0x001b);
        script.extend_from_slice(b"name\0message\0");

        let program = ScenarioProgram::parse(&script)?;
        let mut vm = ScenarioVm::new(program);

        match vm.next_event()? {
            ScenarioEvent::Message(message) => {
                assert_eq!(message.name, Some(b"name".as_slice()));
                assert_eq!(message.text, b"message");
            }
            event => {
                return Err(SakuraError::InvalidScript(format!(
                    "unexpected event: {event:?}"
                )))
            }
        }
        assert_eq!(vm.next_event()?, ScenarioEvent::Halted);
        assert!(vm.is_halted());
        Ok(())
    }

    #[test]
    fn skips_message_process_command_without_leaking_arguments() -> Result<()> {
        let mut script = synthetic_v1_header();
        append_push_int(&mut script, 0);
        append_push_string(&mut script, 36);
        append_opcode(&mut script, 0x0143);
        append_push_string(&mut script, 43);
        append_opcode(&mut script, 0x0140);
        append_opcode(&mut script, 0x001b);
        script.extend_from_slice(b"hidden\0visible\0");

        let mut vm = ScenarioVm::new(ScenarioProgram::parse(&script)?);
        match vm.next_event()? {
            ScenarioEvent::Message(message) => {
                assert_eq!(message.opcode, 0x0140);
                assert_eq!(message.name, None);
                assert_eq!(message.text, b"visible");
                assert!(message.int_args.is_empty());
            }
            event => {
                return Err(SakuraError::InvalidScript(format!(
                    "unexpected event: {event:?}"
                )))
            }
        }
        Ok(())
    }

    #[test]
    fn preserves_choice_order() -> Result<()> {
        let mut script = synthetic_v1_header();
        append_push_string(&mut script, 24);
        append_push_string(&mut script, 29);
        append_opcode(&mut script, 0x0160);
        append_opcode(&mut script, 0x001b);
        script.extend_from_slice(b"left\0right\0");

        let mut vm = ScenarioVm::new(ScenarioProgram::parse(&script)?);

        match vm.next_event()? {
            ScenarioEvent::Choice(choice) => {
                assert_eq!(
                    choice.options,
                    vec![b"left".as_slice(), b"right".as_slice()]
                );
            }
            event => {
                return Err(SakuraError::InvalidScript(format!(
                    "unexpected event: {event:?}"
                )))
            }
        }
        Ok(())
    }

    #[test]
    fn maps_select_user_function_to_choice() -> Result<()> {
        let mut script = synthetic_v1_header();
        append_push_string(&mut script, 32);
        append_push_string(&mut script, 38);
        append_push_string(&mut script, 45);
        append_opcode(&mut script, 0x001c);
        append_opcode(&mut script, 0x001b);
        script.extend_from_slice(b"first\0second\0_SelectEx\0");

        let summary = summarize_scenario_events(&script)?;

        assert_eq!(summary.message_count, 0);
        assert_eq!(summary.choice_count, 1);
        assert_eq!(summary.user_function_count, 0);
        Ok(())
    }

    #[test]
    fn maps_select_named_user_function_to_choice() -> Result<()> {
        let mut script = synthetic_v1_header();
        append_push_string(&mut script, 32);
        append_push_string(&mut script, 38);
        append_push_string(&mut script, 45);
        append_opcode(&mut script, 0x001c);
        append_opcode(&mut script, 0x001b);
        script.extend_from_slice(b"first\0second\0SelectMenu\0");

        let summary = summarize_scenario_events(&script)?;

        assert_eq!(summary.choice_count, 1);
        assert_eq!(summary.user_function_count, 0);
        Ok(())
    }

    #[test]
    fn reports_user_function_string_args() -> Result<()> {
        let mut script = synthetic_v1_header();
        append_push_string(&mut script, 32);
        append_push_string(&mut script, 36);
        append_push_string(&mut script, 40);
        append_opcode(&mut script, 0x001c);
        append_opcode(&mut script, 0x001b);
        script.extend_from_slice(b"one\0two\0call\0");

        let mut vm = ScenarioVm::new(ScenarioProgram::parse(&script)?);

        match vm.next_event()? {
            ScenarioEvent::UserFunction(call) => {
                assert_eq!(call.name, b"call");
                assert_eq!(call.string_args, vec![b"one".as_slice(), b"two".as_slice()]);
            }
            event => {
                return Err(SakuraError::InvalidScript(format!(
                    "unexpected event: {event:?}"
                )))
            }
        }
        Ok(())
    }

    #[test]
    fn random_number_return_preserves_outer_operands_and_returns_bounded_value() -> Result<()> {
        let mut script = synthetic_v1_header();
        append_push_int(&mut script, 7);
        append_push_int(&mut script, 10);
        append_push_int(&mut script, -5);
        append_push_string(&mut script, 44);
        append_opcode(&mut script, 0x001c);
        append_opcode(&mut script, 0x0300);
        append_opcode(&mut script, 0x001b);
        script.extend_from_slice(b"RandomNumberReturn\0");

        let program = ScenarioProgram::parse(&script)?;
        let mut vm = ScenarioVm::new(program);
        match vm.next_event()? {
            ScenarioEvent::UserFunction(call) => {
                assert_eq!(call.name, b"RandomNumberReturn");
                assert_eq!(call.int_args, vec![10, -5]);
            }
            event => {
                return Err(SakuraError::InvalidScript(format!(
                    "unexpected event: {event:?}"
                )))
            }
        }
        let checkpoint = vm.checkpoint();
        assert_ne!(checkpoint.random_state(), 1);

        for mut candidate in [vm, ScenarioVm::restore(program, checkpoint)?] {
            match candidate.next_event()? {
                ScenarioEvent::Graph(command) => {
                    assert_eq!(command.int_args.len(), 2);
                    assert_eq!(command.int_args[0], 7);
                    assert!((-5..=5).contains(&command.int_args[1]));
                }
                event => {
                    return Err(SakuraError::InvalidScript(format!(
                        "unexpected event: {event:?}"
                    )))
                }
            }
        }
        Ok(())
    }

    #[test]
    fn random_number_set_updates_number_variable_and_survives_restore() -> Result<()> {
        let mut script = synthetic_v1_header();
        append_push_int(&mut script, 51);
        append_push_int(&mut script, 90);
        append_push_int(&mut script, -45);
        append_push_string(&mut script, 56);
        append_opcode(&mut script, 0x001c);
        append_push_int(&mut script, 51);
        append_opcode(&mut script, 0x00e1);
        append_opcode(&mut script, 0x0300);
        append_opcode(&mut script, 0x001b);
        script.extend_from_slice(b"RandomNumberSet\0");

        let program = ScenarioProgram::parse(&script)?;
        let mut vm = ScenarioVm::new(program);
        match vm.next_event()? {
            ScenarioEvent::UserFunction(call) => {
                assert_eq!(call.name, b"RandomNumberSet");
                assert_eq!(call.int_args, vec![51, 90, -45]);
            }
            event => {
                return Err(SakuraError::InvalidScript(format!(
                    "unexpected event: {event:?}"
                )))
            }
        }
        let checkpoint = vm.checkpoint();
        assert_eq!(checkpoint.number_variables().get(&51), Some(&-34));

        for mut candidate in [vm, ScenarioVm::restore(program, checkpoint)?] {
            match candidate.next_event()? {
                ScenarioEvent::Graph(command) => assert_eq!(command.int_args, vec![-34]),
                event => {
                    return Err(SakuraError::InvalidScript(format!(
                        "unexpected event: {event:?}"
                    )))
                }
            }
        }
        Ok(())
    }

    #[test]
    fn number_variable_opcodes_store_and_load_values() -> Result<()> {
        let mut script = synthetic_v1_header();
        append_push_int(&mut script, 77);
        append_push_int(&mut script, 3);
        append_opcode(&mut script, 0x00e0);
        append_push_int(&mut script, 3);
        append_opcode(&mut script, 0x00e1);
        append_opcode(&mut script, 0x0300);
        append_opcode(&mut script, 0x001b);

        let mut vm = ScenarioVm::new(ScenarioProgram::parse(&script)?);
        match vm.next_event()? {
            ScenarioEvent::Graph(command) => assert_eq!(command.int_args, vec![77]),
            event => {
                return Err(SakuraError::InvalidScript(format!(
                    "unexpected event: {event:?}"
                )))
            }
        }
        Ok(())
    }

    #[test]
    fn traces_internal_script_calls_and_control_commands() -> Result<()> {
        let mut script = synthetic_v1_header();
        append_push_int(&mut script, 7);
        append_push_string(&mut script, 36);
        append_opcode(&mut script, 0x00f0);
        append_push_string(&mut script, 42);
        append_opcode(&mut script, 0x0122);
        append_opcode(&mut script, 0x001b);
        script.extend_from_slice(b"child\0config\0");

        let commands = ScenarioVm::new(ScenarioProgram::parse(&script)?).control_command_trace()?;

        assert_eq!(
            commands,
            vec![
                ScenarioControlCommand {
                    opcode: 0x00f0,
                    offset: 0x38,
                    int_args: vec![7],
                    string_args: vec![b"child".as_slice()],
                },
                ScenarioControlCommand {
                    opcode: 0x0122,
                    offset: 0x44,
                    int_args: vec![],
                    string_args: vec![b"config".as_slice()],
                },
            ]
        );
        Ok(())
    }

    #[test]
    fn emits_graph_and_wait_arguments_in_script_order() -> Result<()> {
        let mut script = synthetic_v1_header();
        append_push_int(&mut script, 3000);
        append_push_string(&mut script, 36);
        append_opcode(&mut script, 0x0280);
        append_push_int(&mut script, 1000);
        append_opcode(&mut script, 0x0110);
        append_opcode(&mut script, 0x001b);
        script.extend_from_slice(b"sp0065a\0");

        let mut vm = ScenarioVm::new(ScenarioProgram::parse(&script)?);
        match vm.next_event()? {
            ScenarioEvent::Graph(command) => {
                assert_eq!(command.opcode, 0x0280);
                assert_eq!(command.int_args, vec![3000]);
                assert_eq!(command.string_args, vec![b"sp0065a".as_slice()]);
            }
            event => {
                return Err(SakuraError::InvalidScript(format!(
                    "unexpected event: {event:?}"
                )))
            }
        }
        match vm.next_event()? {
            ScenarioEvent::Wait(wait) => {
                assert_eq!(wait.opcode, 0x0110);
                assert_eq!(wait.duration_ms, 1000);
            }
            event => {
                return Err(SakuraError::InvalidScript(format!(
                    "unexpected event: {event:?}"
                )))
            }
        }
        Ok(())
    }

    #[test]
    fn emits_message_window_controls_with_faithful_durations() -> Result<()> {
        let mut script = synthetic_v1_header();
        append_opcode(&mut script, 0x0150);
        append_opcode(&mut script, 0x0151);
        append_push_int(&mut script, 750);
        append_opcode(&mut script, 0x0152);
        append_push_int(&mut script, 625);
        append_opcode(&mut script, 0x0153);
        append_opcode(&mut script, 0x001b);

        let mut vm = ScenarioVm::new(ScenarioProgram::parse(&script)?);
        for (opcode, duration_ms) in [(0x0150, 150), (0x0151, 150), (0x0152, 750), (0x0153, 625)] {
            match vm.next_event()? {
                ScenarioEvent::MessageControl(control) => {
                    assert_eq!(control.opcode, opcode);
                    assert_eq!(control.duration_ms, duration_ms);
                }
                event => {
                    return Err(SakuraError::InvalidScript(format!(
                        "unexpected event: {event:?}"
                    )))
                }
            }
        }
        assert_eq!(vm.next_event()?, ScenarioEvent::Halted);
        Ok(())
    }

    #[test]
    fn emits_bgm_play_arguments_in_script_order() -> Result<()> {
        let mut script = synthetic_v1_header();
        append_push_int(&mut script, 0);
        append_push_int(&mut script, 128);
        append_push_string(&mut script, 40);
        append_push_int(&mut script, 0);
        append_opcode(&mut script, 0x0180);
        append_opcode(&mut script, 0x001b);
        script.extend_from_slice(b"bgm004\0");

        let mut vm = ScenarioVm::new(ScenarioProgram::parse(&script)?);
        match vm.next_event()? {
            ScenarioEvent::Sound(command) => {
                assert_eq!(command.opcode, 0x0180);
                assert_eq!(command.int_args, vec![0, 128, 0]);
                assert_eq!(command.string_args, vec![b"bgm004".as_slice()]);
            }
            event => {
                return Err(SakuraError::InvalidScript(format!(
                    "unexpected event: {event:?}"
                )))
            }
        }
        Ok(())
    }

    #[test]
    fn emits_voice_play_arguments_in_script_order() -> Result<()> {
        let mut script = synthetic_v1_header();
        append_push_string(&mut script, 16);
        append_opcode(&mut script, 0x01a9);
        append_opcode(&mut script, 0x001b);
        script.extend_from_slice(b"aid_000001\0");

        let mut vm = ScenarioVm::new(ScenarioProgram::parse(&script)?);
        match vm.next_event()? {
            ScenarioEvent::Sound(command) => {
                assert_eq!(command.opcode, 0x01a9);
                assert_eq!(command.int_args, Vec::<i32>::new());
                assert_eq!(command.string_args, vec![b"aid_000001".as_slice()]);
            }
            event => {
                return Err(SakuraError::InvalidScript(format!(
                    "unexpected event: {event:?}"
                )))
            }
        }
        Ok(())
    }

    #[test]
    fn emits_se_play_arguments_in_script_order() -> Result<()> {
        let mut script = synthetic_v1_header();
        append_push_int(&mut script, 0);
        append_push_int(&mut script, 108);
        append_push_string(&mut script, 40);
        append_push_int(&mut script, 0);
        append_opcode(&mut script, 0x0190);
        append_opcode(&mut script, 0x001b);
        script.extend_from_slice(b"lse0723\0");

        let mut vm = ScenarioVm::new(ScenarioProgram::parse(&script)?);
        match vm.next_event()? {
            ScenarioEvent::Sound(command) => {
                assert_eq!(command.opcode, 0x0190);
                assert_eq!(command.int_args, vec![0, 108, 0]);
                assert_eq!(command.string_args, vec![b"lse0723".as_slice()]);
            }
            event => {
                return Err(SakuraError::InvalidScript(format!(
                    "unexpected event: {event:?}"
                )))
            }
        }
        Ok(())
    }

    #[test]
    fn emits_extended_sound_and_graph_family_commands() -> Result<()> {
        let mut script = synthetic_v1_header();
        append_push_int(&mut script, 1500);
        append_opcode(&mut script, 0x0186);
        append_push_string(&mut script, 28);
        append_opcode(&mut script, 0x0306);
        append_opcode(&mut script, 0x001b);
        script.extend_from_slice(b"sound01\0");

        let mut vm = ScenarioVm::new(ScenarioProgram::parse(&script)?);
        match vm.next_event()? {
            ScenarioEvent::Sound(command) => {
                assert_eq!(command.opcode, 0x0186);
                assert_eq!(command.int_args, vec![1500]);
            }
            event => {
                return Err(SakuraError::InvalidScript(format!(
                    "unexpected event: {event:?}"
                )))
            }
        }
        match vm.next_event()? {
            ScenarioEvent::Graph(command) => {
                assert_eq!(command.opcode, 0x0306);
                assert_eq!(command.string_args, vec![b"sound01".as_slice()]);
            }
            event => {
                return Err(SakuraError::InvalidScript(format!(
                    "unexpected event: {event:?}"
                )))
            }
        }
        Ok(())
    }

    #[test]
    fn evaluates_literal_arithmetic_before_emitting_command_arguments() -> Result<()> {
        let mut script = synthetic_v1_header();
        append_push_int(&mut script, 360);
        append_push_int(&mut script, -1);
        append_opcode(&mut script, 0x0022);
        append_push_int(&mut script, 10);
        append_push_int(&mut script, 4);
        append_opcode(&mut script, 0x0020);
        append_push_int(&mut script, 3);
        append_opcode(&mut script, 0x0021);
        append_opcode(&mut script, 0x0308);
        append_opcode(&mut script, 0x001b);

        let mut vm = ScenarioVm::new(ScenarioProgram::parse(&script)?);
        match vm.next_event()? {
            ScenarioEvent::Graph(command) => {
                assert_eq!(command.opcode, 0x0308);
                assert_eq!(command.int_args, vec![-360, 11]);
            }
            event => {
                return Err(SakuraError::InvalidScript(format!(
                    "unexpected event: {event:?}"
                )))
            }
        }
        Ok(())
    }

    #[test]
    fn get_time_count_returns_accumulated_blocking_time() -> Result<()> {
        let mut script = synthetic_v1_header();
        append_push_address(&mut script, 4);
        append_opcode(&mut script, 0x0101);
        append_memory_store(&mut script, 2);
        append_line_marker(&mut script);
        append_push_int(&mut script, 250);
        append_opcode(&mut script, 0x0110);
        append_push_address(&mut script, 8);
        append_opcode(&mut script, 0x0101);
        append_memory_store(&mut script, 2);
        append_line_marker(&mut script);
        append_push_address(&mut script, 4);
        append_memory_load(&mut script, 2);
        append_push_address(&mut script, 8);
        append_memory_load(&mut script, 2);
        append_opcode(&mut script, 0x0300);
        append_opcode(&mut script, 0x001b);

        let program = ScenarioProgram::parse(&script)?;
        let mut vm = ScenarioVm::new(program);
        assert!(matches!(
            vm.next_event()?,
            ScenarioEvent::Wait(ScenarioWait {
                duration_ms: 250,
                ..
            })
        ));
        let checkpoint = vm.checkpoint();
        assert_eq!(checkpoint.time_count_ms(), 250);

        let mut restored = ScenarioVm::restore(program, checkpoint)?;
        match restored.next_event()? {
            ScenarioEvent::Graph(command) => {
                assert_eq!(command.int_args, vec![0, 250]);
            }
            event => {
                return Err(SakuraError::InvalidScript(format!(
                    "unexpected event: {event:?}"
                )))
            }
        }
        Ok(())
    }

    #[test]
    fn emits_motion_control_array_from_scenario_memory() -> Result<()> {
        let mut script = synthetic_v1_header();
        append_push_address(&mut script, 0x240);
        append_push_int(&mut script, 2);
        append_memory_store(&mut script, 2);
        append_line_marker(&mut script);
        append_push_address(&mut script, 0x240);
        append_push_int(&mut script, 0x120);
        append_opcode(&mut script, 0x0020);
        append_push_int(&mut script, 1);
        append_memory_store(&mut script, 2);
        append_line_marker(&mut script);
        append_push_int(&mut script, 1);
        append_push_address(&mut script, 0x240);
        append_push_int(&mut script, 2);
        append_push_int(&mut script, 62);
        append_opcode(&mut script, 0x030e);
        append_opcode(&mut script, 0x001b);

        let mut vm = ScenarioVm::new(ScenarioProgram::parse(&script)?);
        match vm.next_event()? {
            ScenarioEvent::Graph(command) => {
                assert_eq!(command.opcode, 0x030e);
                assert_eq!(command.int_args, vec![1, 2, 62]);
                assert_eq!(command.array_args.len(), 1);
                assert_eq!(command.array_args[0].index, 1);
                assert_eq!(command.array_args[0].address, 0x240);
                assert_eq!(command.array_args[0].bytes.len(), 2 * 0x120);
                assert_eq!(&command.array_args[0].bytes[..4], &2i32.to_le_bytes());
                assert_eq!(
                    &command.array_args[0].bytes[0x120..0x124],
                    &1i32.to_le_bytes()
                );
            }
            event => {
                return Err(SakuraError::InvalidScript(format!(
                    "unexpected event: {event:?}"
                )))
            }
        }
        Ok(())
    }

    #[test]
    fn checkpoint_restores_numeric_stack_and_scenario_memory() -> Result<()> {
        let mut script = synthetic_v1_header();
        append_push_address(&mut script, 0x240);
        append_push_int(&mut script, -150);
        append_memory_store(&mut script, 2);
        append_line_marker(&mut script);
        append_opcode(&mut script, 0x0300);
        append_push_address(&mut script, 0x240);
        append_memory_load(&mut script, 2);
        append_opcode(&mut script, 0x0308);
        append_opcode(&mut script, 0x001b);

        let program = ScenarioProgram::parse(&script)?;
        let mut vm = ScenarioVm::new(program);
        assert!(matches!(vm.next_event()?, ScenarioEvent::Graph(_)));
        let checkpoint = vm.checkpoint();

        let mut restored = ScenarioVm::restore(program, checkpoint)?;
        match restored.next_event()? {
            ScenarioEvent::Graph(command) => {
                assert_eq!(command.opcode, 0x0308);
                assert_eq!(command.int_args, vec![-150]);
            }
            event => {
                return Err(SakuraError::InvalidScript(format!(
                    "unexpected event: {event:?}"
                )))
            }
        }
        Ok(())
    }

    #[test]
    fn restores_from_content_free_checkpoint() -> Result<()> {
        let mut script = synthetic_v1_header();
        append_push_string(&mut script, 16);
        append_opcode(&mut script, 0x0140);
        append_opcode(&mut script, 0x001b);
        script.extend_from_slice(b"message\0");
        let program = ScenarioProgram::parse(&script)?;
        let mut vm = ScenarioVm::new(program);
        let checkpoint = vm.checkpoint();

        assert_eq!(checkpoint.cursor(), program.entry_offset());
        match vm.next_event()? {
            ScenarioEvent::Message(message) => assert_eq!(message.text, b"message"),
            event => {
                return Err(SakuraError::InvalidScript(format!(
                    "unexpected event: {event:?}"
                )))
            }
        }

        let mut restored = ScenarioVm::restore(program, checkpoint)?;
        match restored.next_event()? {
            ScenarioEvent::Message(message) => assert_eq!(message.text, b"message"),
            event => {
                return Err(SakuraError::InvalidScript(format!(
                    "unexpected event: {event:?}"
                )))
            }
        }
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

    fn append_push_int(script: &mut Vec<u8>, value: i32) {
        append_opcode(script, 0x0000);
        script.extend_from_slice(&value.to_le_bytes());
    }

    fn append_push_address(script: &mut Vec<u8>, address: i32) {
        append_opcode(script, 0x0002);
        script.extend_from_slice(&address.to_le_bytes());
    }

    fn append_memory_load(script: &mut Vec<u8>, width: i32) {
        append_opcode(script, 0x0008);
        script.extend_from_slice(&width.to_le_bytes());
    }

    fn append_memory_store(script: &mut Vec<u8>, width: i32) {
        append_opcode(script, 0x0009);
        script.extend_from_slice(&width.to_le_bytes());
    }

    fn append_line_marker(script: &mut Vec<u8>) {
        append_opcode(script, 0x007f);
        script.extend_from_slice(&0i32.to_le_bytes());
        script.extend_from_slice(&0i32.to_le_bytes());
    }

    fn append_opcode(script: &mut Vec<u8>, opcode: u32) {
        script.extend_from_slice(&opcode.to_le_bytes());
    }
}
