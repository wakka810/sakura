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
    pub name: Option<&'a [u8]>,
    pub text: &'a [u8],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScenarioChoice<'a> {
    pub opcode: u32,
    pub offset: usize,
    pub options: Vec<&'a [u8]>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScenarioUserFunction<'a> {
    pub offset: usize,
    pub name: &'a [u8],
    pub string_args: Vec<&'a [u8]>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScenarioEvent<'a> {
    Message(ScenarioMessage<'a>),
    Choice(ScenarioChoice<'a>),
    UserFunction(ScenarioUserFunction<'a>),
    Halted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ScenarioEventSummary {
    pub message_count: usize,
    pub choice_count: usize,
    pub user_function_count: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct StringOperand {
    address: i32,
}

#[derive(Debug, Clone)]
pub struct ScenarioVm<'a> {
    program: ScenarioProgram<'a>,
    cursor: usize,
    max_code_address: usize,
    halted: bool,
    string_stack: Vec<StringOperand>,
    int_stack: Vec<i32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScenarioVmCheckpoint {
    cursor: usize,
    max_code_address: usize,
    halted: bool,
    string_stack: Vec<i32>,
}

impl ScenarioVmCheckpoint {
    pub(crate) fn from_parts(
        cursor: usize,
        max_code_address: usize,
        halted: bool,
        string_stack: Vec<i32>,
    ) -> Self {
        Self {
            cursor,
            max_code_address,
            halted,
            string_stack,
        }
    }

    pub fn cursor(&self) -> usize {
        self.cursor
    }

    pub fn max_code_address(&self) -> usize {
        self.max_code_address
    }

    pub fn is_halted(&self) -> bool {
        self.halted
    }

    pub fn string_stack(&self) -> &[i32] {
        &self.string_stack
    }
}

impl<'a> ScenarioVm<'a> {
    pub fn new(program: ScenarioProgram<'a>) -> Self {
        Self {
            cursor: program.entry_offset(),
            program,
            max_code_address: 0,
            halted: false,
            string_stack: Vec::new(),
            int_stack: Vec::new(),
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
            halted: self.halted,
            string_stack: self.string_stack.iter().map(|item| item.address).collect(),
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
            halted: checkpoint.halted,
            string_stack,
            int_stack: Vec::new(),
        })
    }

    pub fn next_event(&mut self) -> Result<ScenarioEvent<'a>> {
        while !self.halted {
            let offset = self.cursor;
            let opcode = self.read_opcode()?;
            match opcode {
                0x0000 => { let v = self.read_i32()?; self.int_stack.push(v); }
                0x0001 => self.read_code_address_operand()?,
                0x0003 => self.read_string_address_operand()?,
                0x001c => {
                    if let Some(event) = self.handle_user_function(offset)? {
                        return Ok(event);
                    }
                }
                0x0140 | 0x0143 => return self.handle_message(offset, opcode),
                0x0160 => return self.handle_choice(offset, opcode),
                _ => self.read_template_operands(opcode)?,
            }

            if matches!(opcode, 0x007e | 0x007f | 0x00fe) {
                self.string_stack.clear();
                self.int_stack.clear();
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
                0x0001 => self.read_code_address_operand()?,
                0x0003 => self.read_string_address_operand()?,
                0x001c => { let _ = self.handle_user_function(offset)?; }
                0x0140 | 0x0143 => { let _ = self.handle_message(offset, opcode)?; }
                0x0160 => { let _ = self.handle_choice(offset, opcode)?; }
                _ => self.read_template_operands(opcode)?,
            }
            if matches!(opcode, 0x007e | 0x007f | 0x00fe) { self.string_stack.clear(); }
            if matches!(opcode, 0x001b | 0x00f4)
                && self.max_code_address < self.cursor - self.program.header.code_offset
            { self.halted = true; }
        }
        Ok(hist)
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

    fn read_string_address_operand(&mut self) -> Result<()> {
        let address = self.read_i32()?;
        self.program.string_bytes(address)?;
        self.string_stack.push(StringOperand { address });
        Ok(())
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
            name,
            text,
        }))
    }

    fn handle_choice(&mut self, offset: usize, opcode: u32) -> Result<ScenarioEvent<'a>> {
        let options = self.drain_string_stack()?;
        Ok(ScenarioEvent::Choice(ScenarioChoice {
            opcode,
            offset,
            options,
        }))
    }

    fn handle_user_function(&mut self, offset: usize) -> Result<Option<ScenarioEvent<'a>>> {
        let Some(function) = self.string_stack.pop() else {
            return Ok(None);
        };
        let name = self.program.string_bytes(function.address)?;
        let string_args = self.drain_string_stack()?;
        if is_choice_function_name(name) && !string_args.is_empty() {
            return Ok(Some(ScenarioEvent::Choice(ScenarioChoice {
                opcode: 0x001c,
                offset,
                options: string_args,
            })));
        }
        Ok(Some(ScenarioEvent::UserFunction(ScenarioUserFunction {
            offset,
            name,
            string_args,
        })))
    }

    fn drain_string_stack(&mut self) -> Result<Vec<&'a [u8]>> {
        let mut values = Vec::with_capacity(self.string_stack.len());
        for item in self.string_stack.drain(..) {
            values.push(self.program.string_bytes(item.address)?);
        }
        Ok(values)
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

pub fn summarize_scenario_events(data: &[u8]) -> Result<ScenarioEventSummary> {
    let program = ScenarioProgram::parse(data)?;
    let mut vm = ScenarioVm::new(program);
    let mut summary = ScenarioEventSummary::default();
    loop {
        match vm.next_event()? {
            ScenarioEvent::Message(_) => summary.message_count += 1,
            ScenarioEvent::Choice(_) => summary.choice_count += 1,
            ScenarioEvent::UserFunction(_) => summary.user_function_count += 1,
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

    fn append_opcode(script: &mut Vec<u8>, opcode: u32) {
        script.extend_from_slice(&opcode.to_le_bytes());
    }
}
