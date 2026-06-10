use std::collections::VecDeque;

use crate::error::{Result, SakuraError};
use crate::scenario::{ScenarioProgram, ScenarioUserFunction, ScenarioVm, ScenarioVmCheckpoint};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlayerConfig {
    pub backlog_limit: usize,
    pub text_speed_cps: u32,
    pub auto_advance_ms: u32,
    pub master_volume: u8,
    pub bgm_volume: u8,
    pub voice_volume: u8,
    pub sfx_volume: u8,
}

impl Default for PlayerConfig {
    fn default() -> Self {
        Self {
            backlog_limit: 512,
            text_speed_cps: 60,
            auto_advance_ms: 0,
            master_volume: 100,
            bgm_volume: 100,
            voice_volume: 100,
            sfx_volume: 100,
        }
    }
}

impl PlayerConfig {
    pub fn validated(self) -> Result<Self> {
        if self.backlog_limit == 0 || self.backlog_limit > 4096 {
            return Err(SakuraError::InvalidRuntime(
                "backlog_limit must be in 1..=4096".to_owned(),
            ));
        }
        if self.text_speed_cps > 240 {
            return Err(SakuraError::InvalidRuntime(
                "text_speed_cps must be in 0..=240".to_owned(),
            ));
        }
        if self.auto_advance_ms > 600_000 {
            return Err(SakuraError::InvalidRuntime(
                "auto_advance_ms must be in 0..=600000".to_owned(),
            ));
        }
        for (name, volume) in [
            ("master_volume", self.master_volume),
            ("bgm_volume", self.bgm_volume),
            ("voice_volume", self.voice_volume),
            ("sfx_volume", self.sfx_volume),
        ] {
            if volume > 100 {
                return Err(SakuraError::InvalidRuntime(format!(
                    "{name} must be in 0..=100"
                )));
            }
        }
        Ok(self)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BacklogEntry {
    pub event_index: u64,
    pub name: Option<Vec<u8>>,
    pub text: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionMode {
    Running,
    WaitingForMessage,
    WaitingForChoice { option_count: usize },
    Halted,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionSnapshot {
    checkpoint: ScenarioVmCheckpoint,
    mode: SessionMode,
    config: PlayerConfig,
    event_count: u64,
    choice_history: Vec<usize>,
}

impl SessionSnapshot {
    pub(crate) fn from_parts_for_restore(
        checkpoint: ScenarioVmCheckpoint,
        mode: SessionMode,
        config: PlayerConfig,
        event_count: u64,
        choice_history: Vec<usize>,
    ) -> Self {
        Self {
            checkpoint,
            mode,
            config,
            event_count,
            choice_history,
        }
    }

    pub fn mode(&self) -> &SessionMode {
        &self.mode
    }

    pub fn config(&self) -> &PlayerConfig {
        &self.config
    }

    pub fn event_count(&self) -> u64 {
        self.event_count
    }

    pub fn choice_history(&self) -> &[usize] {
        &self.choice_history
    }

    pub fn checkpoint(&self) -> &ScenarioVmCheckpoint {
        &self.checkpoint
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionEvent<'a> {
    Message {
        event_index: u64,
        name: Option<&'a [u8]>,
        text: &'a [u8],
    },
    Choice {
        event_index: u64,
        options: Vec<&'a [u8]>,
    },
    UserFunction {
        event_index: u64,
        function: ScenarioUserFunction<'a>,
    },
    Halted,
}

#[derive(Debug, Clone)]
pub struct ScenarioSession<'a> {
    program: ScenarioProgram<'a>,
    vm: ScenarioVm<'a>,
    config: PlayerConfig,
    mode: SessionMode,
    backlog: VecDeque<BacklogEntry>,
    event_count: u64,
    choice_history: Vec<usize>,
}

impl<'a> ScenarioSession<'a> {
    pub fn new(program: ScenarioProgram<'a>, config: PlayerConfig) -> Result<Self> {
        let config = config.validated()?;
        Ok(Self {
            program,
            vm: ScenarioVm::new(program),
            config,
            mode: SessionMode::Running,
            backlog: VecDeque::new(),
            event_count: 0,
            choice_history: Vec::new(),
        })
    }

    pub fn restore(program: ScenarioProgram<'a>, snapshot: SessionSnapshot) -> Result<Self> {
        let config = snapshot.config.validated()?;
        let vm = ScenarioVm::restore(program, snapshot.checkpoint)?;
        Ok(Self {
            program,
            vm,
            config,
            mode: snapshot.mode,
            backlog: VecDeque::new(),
            event_count: snapshot.event_count,
            choice_history: snapshot.choice_history,
        })
    }

    pub fn mode(&self) -> &SessionMode {
        &self.mode
    }

    pub fn config(&self) -> &PlayerConfig {
        &self.config
    }

    pub fn backlog(&self) -> &VecDeque<BacklogEntry> {
        &self.backlog
    }

    pub fn event_count(&self) -> u64 {
        self.event_count
    }

    pub fn choice_history(&self) -> &[usize] {
        &self.choice_history
    }

    pub fn update_config(&mut self, config: PlayerConfig) -> Result<()> {
        self.config = config.validated()?;
        self.trim_backlog();
        Ok(())
    }

    pub fn snapshot(&self) -> SessionSnapshot {
        SessionSnapshot {
            checkpoint: self.vm.checkpoint(),
            mode: self.mode.clone(),
            config: self.config.clone(),
            event_count: self.event_count,
            choice_history: self.choice_history.clone(),
        }
    }

    pub fn step(&mut self) -> Result<SessionEvent<'a>> {
        self.ensure_running()?;
        match self.vm.next_event()? {
            crate::ScenarioEvent::Message(message) => {
                let event_index = self.next_event_index()?;
                self.push_backlog(BacklogEntry {
                    event_index,
                    name: message.name.map(Vec::from),
                    text: Vec::from(message.text),
                });
                self.mode = SessionMode::WaitingForMessage;
                Ok(SessionEvent::Message {
                    event_index,
                    name: message.name,
                    text: message.text,
                })
            }
            crate::ScenarioEvent::Choice(choice) => {
                let event_index = self.next_event_index()?;
                self.mode = SessionMode::WaitingForChoice {
                    option_count: choice.options.len(),
                };
                Ok(SessionEvent::Choice {
                    event_index,
                    options: choice.options,
                })
            }
            crate::ScenarioEvent::UserFunction(function) => {
                let event_index = self.next_event_index()?;
                Ok(SessionEvent::UserFunction {
                    event_index,
                    function,
                })
            }
            crate::ScenarioEvent::Halted => {
                self.mode = SessionMode::Halted;
                Ok(SessionEvent::Halted)
            }
        }
    }

    pub fn advance_message(&mut self) -> Result<()> {
        match self.mode {
            SessionMode::WaitingForMessage => {
                self.mode = SessionMode::Running;
                Ok(())
            }
            _ => Err(SakuraError::InvalidRuntime(
                "advance_message requires a pending message".to_owned(),
            )),
        }
    }

    pub fn select_choice(&mut self, index: usize) -> Result<()> {
        match self.mode {
            SessionMode::WaitingForChoice { option_count } if index < option_count => {
                self.choice_history.push(index);
                self.mode = SessionMode::Running;
                Ok(())
            }
            SessionMode::WaitingForChoice { option_count } => Err(SakuraError::InvalidRuntime(
                format!("choice index {index} is out of range for {option_count} options"),
            )),
            _ => Err(SakuraError::InvalidRuntime(
                "select_choice requires a pending choice".to_owned(),
            )),
        }
    }

    fn ensure_running(&self) -> Result<()> {
        match self.mode {
            SessionMode::Running => Ok(()),
            SessionMode::WaitingForMessage => Err(SakuraError::InvalidRuntime(
                "message must be advanced before stepping".to_owned(),
            )),
            SessionMode::WaitingForChoice { .. } => Err(SakuraError::InvalidRuntime(
                "choice must be selected before stepping".to_owned(),
            )),
            SessionMode::Halted => Err(SakuraError::InvalidRuntime(
                "session has already halted".to_owned(),
            )),
        }
    }

    fn next_event_index(&mut self) -> Result<u64> {
        self.event_count = self
            .event_count
            .checked_add(1)
            .ok_or_else(|| SakuraError::InvalidRuntime("event counter overflow".to_owned()))?;
        Ok(self.event_count)
    }

    fn push_backlog(&mut self, entry: BacklogEntry) {
        self.backlog.push_back(entry);
        self.trim_backlog();
    }

    fn trim_backlog(&mut self) {
        while self.backlog.len() > self.config.backlog_limit {
            self.backlog.pop_front();
        }
    }

    pub fn program(&self) -> ScenarioProgram<'a> {
        self.program
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::script::BURIKO_SCRIPT_V1_MAGIC;

    #[test]
    fn enforces_message_choice_and_backlog_state() -> Result<()> {
        let script = synthetic_script();
        let program = ScenarioProgram::parse(&script)?;
        let mut config = PlayerConfig {
            backlog_limit: 1,
            ..PlayerConfig::default()
        };
        let mut session = ScenarioSession::new(program, config.clone())?;

        match session.step()? {
            SessionEvent::Message {
                event_index,
                name,
                text,
            } => {
                assert_eq!(event_index, 1);
                assert_eq!(name, None);
                assert_eq!(text, b"first");
            }
            event => return Err(unexpected(event)),
        }
        assert_eq!(session.mode(), &SessionMode::WaitingForMessage);
        assert!(session.step().is_err());
        assert_eq!(session.backlog().len(), 1);
        session.advance_message()?;

        match session.step()? {
            SessionEvent::Choice {
                event_index,
                options,
            } => {
                assert_eq!(event_index, 2);
                assert_eq!(options, vec![b"left".as_slice(), b"right".as_slice()]);
            }
            event => return Err(unexpected(event)),
        }
        assert!(session.select_choice(2).is_err());
        session.select_choice(1)?;
        assert_eq!(session.choice_history(), &[1]);

        match session.step()? {
            SessionEvent::Message { text, .. } => assert_eq!(text, b"second"),
            event => return Err(unexpected(event)),
        }
        assert_eq!(session.backlog().len(), 1);
        assert_eq!(session.backlog()[0].text, b"second");

        config.backlog_limit = 2;
        session.update_config(config)?;
        assert_eq!(session.config().backlog_limit, 2);
        Ok(())
    }

    #[test]
    fn snapshots_without_persisting_backlog_text() -> Result<()> {
        let script = synthetic_script();
        let program = ScenarioProgram::parse(&script)?;
        let mut session = ScenarioSession::new(program, PlayerConfig::default())?;
        let _ = session.step()?;
        let snapshot = session.snapshot();

        assert_eq!(snapshot.event_count(), 1);
        assert_eq!(snapshot.mode(), &SessionMode::WaitingForMessage);
        assert!(!snapshot.checkpoint().is_halted());

        let mut restored = ScenarioSession::restore(program, snapshot)?;
        assert_eq!(restored.backlog().len(), 0);
        assert_eq!(restored.mode(), &SessionMode::WaitingForMessage);
        restored.advance_message()?;
        match restored.step()? {
            SessionEvent::Choice { options, .. } => assert_eq!(options.len(), 2),
            event => return Err(unexpected(event)),
        }
        Ok(())
    }

    #[test]
    fn rejects_invalid_config_up_front() {
        let config = PlayerConfig {
            master_volume: 101,
            ..PlayerConfig::default()
        };
        assert!(config.validated().is_err());
    }

    fn unexpected(event: SessionEvent<'_>) -> SakuraError {
        SakuraError::InvalidRuntime(format!("unexpected event: {event:?}"))
    }

    fn synthetic_script() -> Vec<u8> {
        let mut script = synthetic_v1_header();
        append_push_string(&mut script, 48);
        append_opcode(&mut script, 0x0140);
        append_push_string(&mut script, 54);
        append_push_string(&mut script, 59);
        append_opcode(&mut script, 0x0160);
        append_push_string(&mut script, 65);
        append_opcode(&mut script, 0x0140);
        append_opcode(&mut script, 0x001b);
        script.extend_from_slice(b"first\0left\0right\0second\0");
        script
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
