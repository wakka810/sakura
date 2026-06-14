use crate::error::{Result, SakuraError};
use crate::runtime::Runtime;
use crate::script_library::{ScriptId, ScriptLibrary};
use crate::system_host::{
    SystemAssetRequest, SystemHost, SystemHostEffect, SystemHostEventKind, SystemHostServiceState,
    SystemHostSnapshot,
};
use crate::system_vm::{
    SystemValue, SystemValueSnapshot, SystemVm, SystemVmEvent, SystemVmSnapshot,
};

const MAX_CALL_DEPTH: usize = 256;
// Real BGI/Ethornell graph calls can carry long point/rect tables. Keep enough
// slots to preserve full draw payloads for browser-side rendering and probes.
pub const SYSTEM_SERVICE_TRACE_ARG_SLOTS: usize = 256;
pub const SYSTEM_SERVICE_TRACE_INLINE_STRING_LIMIT: usize = 4;
pub const SYSTEM_SERVICE_TRACE_INLINE_STRING_MAX_BYTES: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SystemRuntimeSummary {
    pub event_count: usize,
    pub service_event_count: usize,
    pub user_call_event_count: usize,
    pub user_load_event_count: usize,
    pub user_free_event_count: usize,
    pub user_return_event_count: usize,
    pub halted_event_count: usize,
    pub completed: bool,
    pub event_limited: bool,
    pub max_call_depth: usize,
    pub last_event_kind: SystemHostEventKind,
    pub syscall_service_counts: [usize; 256],
    pub graphcall_service_counts: [usize; 256],
    pub soundcall_service_counts: [usize; 256],
    pub extcall_service_counts: [usize; 256],
    pub user_script_dispatch_counts: [usize; 256],
    pub first_graph88_arg_count: usize,
    pub first_graph88_top_kind: u8,
    pub first_graph9c_arg_count: usize,
    pub first_graph9c_top_kind: u8,
    pub first_sound_service_id: u8,
    pub first_sound_arg_count: usize,
    pub first_sound_top_kind: u8,
    pub host_state: SystemHostServiceState,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SystemServiceTrace {
    pub total_service_count: usize,
    pub recorded_services: Vec<SystemServiceTraceEvent>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SystemServiceTraceInlineString {
    pub arg_index: usize,
    pub byte_len: usize,
    pub full_len: usize,
    pub hash: u32,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SystemServiceTraceEvent {
    pub event_index: usize,
    pub depth: usize,
    pub script_index: usize,
    pub family: crate::SystemCallFamily,
    pub service_id: u8,
    pub arg_count: usize,
    pub top_kind: u8,
    pub integer_arg_count: usize,
    pub min_integer_arg: u64,
    pub max_integer_arg: u64,
    pub string_arg_count: usize,
    pub first_string_len: usize,
    pub first_string_hash: u64,
    pub instruction_offset: usize,
    pub arg_slots: [SystemServiceTraceArg; SYSTEM_SERVICE_TRACE_ARG_SLOTS],
    pub inline_strings: Vec<SystemServiceTraceInlineString>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct SystemServiceTraceArg {
    pub kind: u8,
    pub value: u32,
    pub len: u32,
    pub hash: u32,
}

impl Default for SystemRuntimeSummary {
    fn default() -> Self {
        Self {
            event_count: 0,
            service_event_count: 0,
            user_call_event_count: 0,
            user_load_event_count: 0,
            user_free_event_count: 0,
            user_return_event_count: 0,
            halted_event_count: 0,
            completed: false,
            event_limited: false,
            max_call_depth: 0,
            last_event_kind: SystemHostEventKind::None,
            syscall_service_counts: [0; 256],
            graphcall_service_counts: [0; 256],
            soundcall_service_counts: [0; 256],
            extcall_service_counts: [0; 256],
            user_script_dispatch_counts: [0; 256],
            first_graph88_arg_count: 0,
            first_graph88_top_kind: 0,
            first_graph9c_arg_count: 0,
            first_graph9c_top_kind: 0,
            first_sound_service_id: 0,
            first_sound_arg_count: 0,
            first_sound_top_kind: 0,
            host_state: SystemHostServiceState::default(),
        }
    }
}

pub struct SystemRuntime<'a> {
    scripts: &'a ScriptLibrary,
    host: SystemHost<'a>,
    frames: Vec<SystemFrame<'a>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SystemRuntimePendingAsset {
    pub request: SystemAssetRequest,
    pub event: SystemVmEventOwned,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SystemRuntimeSnapshot {
    pub host: SystemHostSnapshot,
    pub frames: Vec<SystemFrameSnapshot>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SystemFrameSnapshot {
    pub script_index: usize,
    pub vm: SystemVmSnapshot,
    pub mode: u8,
    pub return_value: Option<SystemValueSnapshot>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SystemVmEventOwned {
    ServiceCall {
        family: crate::SystemCallFamily,
        service_id: u8,
        args: Vec<SystemValueSnapshot>,
    },
    LoadedProgramCall {
        handle: u32,
        offset: Option<usize>,
        args: Vec<SystemValueSnapshot>,
    },
    UserScriptCall {
        service_id: u8,
        args: Vec<SystemValueSnapshot>,
    },
    UserScriptLoad,
    UserScriptFree {
        args: Vec<SystemValueSnapshot>,
    },
    UserScriptReturn,
    Halted,
}

impl SystemVmEventOwned {
    pub(crate) fn into_runtime_event(self) -> SystemVmEvent<'static> {
        match self {
            Self::ServiceCall {
                family,
                service_id,
                args,
            } => SystemVmEvent::ServiceCall {
                family,
                service_id,
                args: owned_args_to_runtime(args),
            },
            Self::LoadedProgramCall {
                handle,
                offset,
                args,
            } => SystemVmEvent::LoadedProgramCall {
                handle,
                offset,
                args: owned_args_to_runtime(args),
            },
            Self::UserScriptCall { service_id, args } => SystemVmEvent::UserScriptCall {
                service_id,
                args: owned_args_to_runtime(args),
            },
            Self::UserScriptLoad => SystemVmEvent::UserScriptLoad,
            Self::UserScriptFree { args } => SystemVmEvent::UserScriptFree {
                args: owned_args_to_runtime(args),
            },
            Self::UserScriptReturn => SystemVmEvent::UserScriptReturn,
            Self::Halted => SystemVmEvent::Halted,
        }
    }
}

impl<'a> From<SystemVmEvent<'a>> for SystemVmEventOwned {
    fn from(value: SystemVmEvent<'a>) -> Self {
        match value {
            SystemVmEvent::ServiceCall {
                family,
                service_id,
                args,
            } => Self::ServiceCall {
                family,
                service_id,
                args: args.into_iter().map(SystemValueSnapshot::from).collect(),
            },
            SystemVmEvent::LoadedProgramCall {
                handle,
                offset,
                args,
            } => Self::LoadedProgramCall {
                handle,
                offset,
                args: args.into_iter().map(SystemValueSnapshot::from).collect(),
            },
            SystemVmEvent::UserScriptCall { service_id, args } => Self::UserScriptCall {
                service_id,
                args: args.into_iter().map(SystemValueSnapshot::from).collect(),
            },
            SystemVmEvent::UserScriptLoad => Self::UserScriptLoad,
            SystemVmEvent::UserScriptFree { args } => Self::UserScriptFree {
                args: args.into_iter().map(SystemValueSnapshot::from).collect(),
            },
            SystemVmEvent::UserScriptReturn => Self::UserScriptReturn,
            SystemVmEvent::Halted => Self::Halted,
        }
    }
}

impl<'a> SystemRuntime<'a> {
    pub fn new(scripts: &'a ScriptLibrary, host: SystemHost<'a>) -> Self {
        Self {
            scripts,
            host,
            frames: Vec::new(),
        }
    }

    pub(crate) fn snapshot(&self) -> SystemRuntimeSnapshot {
        SystemRuntimeSnapshot {
            host: self.host.snapshot(),
            frames: self
                .frames
                .iter()
                .map(|frame| SystemFrameSnapshot {
                    script_index: frame.script_id.index(),
                    vm: frame.vm.snapshot(),
                    mode: frame.mode.as_u8(),
                    return_value: frame.return_value.clone().map(SystemValueSnapshot::from),
                })
                .collect(),
        }
    }

    pub(crate) fn restore(runtime: &'a Runtime, snapshot: SystemRuntimeSnapshot) -> Result<Self> {
        let scripts = runtime.scripts();
        let host = SystemHost::restore_with_runtime(runtime, snapshot.host);
        let mut frames = Vec::with_capacity(snapshot.frames.len());
        for frame in snapshot.frames {
            let script_id = scripts.id_from_index(frame.script_index).ok_or_else(|| {
                SakuraError::InvalidRuntime(
                    "system runtime snapshot script index is invalid".to_owned(),
                )
            })?;
            let program = scripts.system_vm(script_id)?.ok_or_else(|| {
                SakuraError::InvalidRuntime(
                    "system runtime snapshot target is not a system script".to_owned(),
                )
            })?;
            let vm = SystemVm::restore(program.program().clone(), frame.vm)?;
            frames.push(SystemFrame {
                script_id,
                vm,
                mode: ChildFrameMode::from_u8(frame.mode)?,
                return_value: frame
                    .return_value
                    .map(SystemValueSnapshot::into_runtime_value),
            });
        }
        Ok(Self {
            scripts,
            host,
            frames,
        })
    }

    pub fn push_script(&mut self, id: ScriptId, args: Vec<SystemValue<'a>>) -> Result<()> {
        self.push_script_with_mode(id, None, args, ChildFrameMode::Standalone)
    }

    pub fn push_script_at(
        &mut self,
        id: ScriptId,
        offset: Option<usize>,
        args: Vec<SystemValue<'a>>,
    ) -> Result<()> {
        self.push_script_with_mode(id, offset, args, ChildFrameMode::Standalone)
    }

    fn push_script_with_mode(
        &mut self,
        id: ScriptId,
        offset: Option<usize>,
        args: Vec<SystemValue<'a>>,
        mode: ChildFrameMode,
    ) -> Result<()> {
        if self.frames.len() == MAX_CALL_DEPTH {
            return Err(SakuraError::InvalidScript(
                "system runtime call stack limit exceeded".to_owned(),
            ));
        }
        let mut program = self.scripts.system_vm(id)?.ok_or_else(|| {
            SakuraError::InvalidScript("system runtime target is not a system script".to_owned())
        })?;
        let mut vm = match mode {
            ChildFrameMode::Standalone => program,
            ChildFrameMode::ShareParentMemory => {
                let parent = self.frames.last().ok_or_else(|| {
                    SakuraError::InvalidRuntime(
                        "shared-memory child script requires a parent frame".to_owned(),
                    )
                })?;
                parent.vm.fork_with_shared_memory(program.program().clone())
            }
            ChildFrameMode::ShareSystemMemory => {
                let parent = self.frames.last().ok_or_else(|| {
                    SakuraError::InvalidRuntime(
                        "shared-system-memory child script requires a parent frame".to_owned(),
                    )
                })?;
                program.adopt_shared_system_memory_from(&parent.vm);
                program
            }
        };
        vm.set_script_index(id.index());
        if let Some(offset) = offset {
            vm.set_probe_entry(true);
            vm.seek(offset)?;
        } else if matches!(
            mode,
            ChildFrameMode::ShareParentMemory | ChildFrameMode::ShareSystemMemory
        ) {
            vm.set_probe_entry(true);
        }
        for arg in args {
            vm.resume_with(arg)?;
        }
        self.frames.push(SystemFrame {
            script_id: id,
            vm,
            mode,
            return_value: None,
        });
        Ok(())
    }

    pub fn run(
        &mut self,
        max_events: usize,
        max_instructions_per_event: usize,
    ) -> Result<SystemRuntimeSummary> {
        self.run_inner(max_events, max_instructions_per_event, None)
    }

    pub fn run_with_service_trace(
        &mut self,
        max_events: usize,
        max_instructions_per_event: usize,
        max_recorded_services: usize,
    ) -> Result<(SystemRuntimeSummary, SystemServiceTrace)> {
        let mut trace = SystemServiceTrace {
            total_service_count: 0,
            recorded_services: Vec::with_capacity(max_recorded_services),
        };
        let summary = self.run_inner(
            max_events,
            max_instructions_per_event,
            Some((&mut trace, max_recorded_services)),
        )?;
        Ok((summary, trace))
    }

    pub fn run_with_service_trace_until_asset(
        &mut self,
        max_events: usize,
        max_instructions_per_event: usize,
        max_recorded_services: usize,
    ) -> Result<(
        SystemRuntimeSummary,
        SystemServiceTrace,
        Option<SystemRuntimePendingAsset>,
    )> {
        let mut trace = SystemServiceTrace {
            total_service_count: 0,
            recorded_services: Vec::with_capacity(max_recorded_services),
        };
        let (summary, pending_asset) = self.run_inner_until_asset(
            max_events,
            max_instructions_per_event,
            Some((&mut trace, max_recorded_services)),
        )?;
        Ok((summary, trace, pending_asset))
    }

    pub fn current_frame_state(&self) -> Option<SystemRuntimeFrameState> {
        let frame = self.frames.last()?;
        Some(SystemRuntimeFrameState {
            script_index: frame.script_id.index(),
            cursor: frame.vm.cursor(),
            last_instruction_offset: frame.vm.last_instruction_offset().unwrap_or(0),
            mem_ptr: frame.vm.mem_ptr(),
            local_44: frame.vm.local_integer(44, 2).unwrap_or(0),
            local_48: frame.vm.local_integer(48, 2).unwrap_or(0),
            local_56: frame.vm.local_integer(56, 2).unwrap_or(0),
            local_60: frame.vm.local_integer(60, 2).unwrap_or(0),
            local_64: frame.vm.local_integer(64, 2).unwrap_or(0),
            local_68: frame.vm.local_integer(68, 2).unwrap_or(0),
            local_72: frame.vm.local_integer(72, 2).unwrap_or(0),
            local_76: frame.vm.local_integer(76, 2).unwrap_or(0),
            local_1076: frame.vm.local_integer(1076, 2).unwrap_or(0),
            local_1152: frame.vm.local_integer(1152, 2).unwrap_or(0),
            local_3952: frame.vm.local_integer(3952, 2).unwrap_or(0),
            local_3956: frame.vm.local_integer(3956, 2).unwrap_or(0),
            local_3980: frame.vm.local_integer(3980, 2).unwrap_or(0),
            local_3992: frame.vm.local_integer(3992, 2).unwrap_or(0),
            local_3996: frame.vm.local_integer(3996, 2).unwrap_or(0),
            local_4024: frame.vm.local_integer(4024, 2).unwrap_or(0),
            local_4028: frame.vm.local_integer(4028, 2).unwrap_or(0),
            local_4076: frame.vm.local_integer(4076, 2).unwrap_or(0),
            local_7100: frame.vm.local_integer(7100, 2).unwrap_or(0),
            local_7104: frame.vm.local_integer(7104, 2).unwrap_or(0),
            local_7108: frame.vm.local_integer(7108, 2).unwrap_or(0),
            local_7112: frame.vm.local_integer(7112, 2).unwrap_or(0),
        })
    }

    pub fn current_frame_local_integer(&self, offset: usize, width: u8) -> Option<u64> {
        self.frames.last()?.vm.local_integer(offset, width)
    }

    pub fn current_frame_integer_raw(&self, address: u32, width: u8) -> Option<u64> {
        self.frames.last()?.vm.host_integer_raw(address, width)
    }

    pub fn current_frame_bytes_raw(&self, address: u32, len: usize) -> Option<Vec<u8>> {
        self.frames.last()?.vm.host_bytes_raw(address, len)
    }

    pub(crate) fn host_state(&self) -> SystemHostServiceState {
        self.host.state()
    }

    pub fn host_last_asset_name(&self) -> &[u8] {
        self.host.last_asset_name()
    }

    pub(crate) fn host_mut_for_session_supply(&mut self) -> &mut SystemHost<'a> {
        &mut self.host
    }

    pub(crate) fn resume_pending_event(&mut self, event: SystemVmEventOwned) -> Result<()> {
        let event = event.into_runtime_event();
        let Some(result) = self.host.event_result_without_record(&event) else {
            return Ok(());
        };
        if let Some(effect) = result.effect() {
            self.apply_host_effect(effect)?;
        }
        if let Some(value) = result.into_value() {
            self.resume_current(value)?;
        }
        Ok(())
    }

    fn run_inner(
        &mut self,
        max_events: usize,
        max_instructions_per_event: usize,
        mut trace: Option<(&mut SystemServiceTrace, usize)>,
    ) -> Result<SystemRuntimeSummary> {
        let (summary, _pending_asset) =
            self.run_inner_until_asset(max_events, max_instructions_per_event, trace.take())?;
        Ok(summary)
    }

    fn run_inner_until_asset(
        &mut self,
        max_events: usize,
        max_instructions_per_event: usize,
        mut trace: Option<(&mut SystemServiceTrace, usize)>,
    ) -> Result<(SystemRuntimeSummary, Option<SystemRuntimePendingAsset>)> {
        let mut summary = SystemRuntimeSummary::default();
        loop {
            if summary.event_count == max_events {
                summary.event_limited = true;
                break;
            }
            let depth = self.frames.len();
            let Some(frame) = self.frames.last_mut() else {
                summary.completed = true;
                break;
            };
            let event = frame.vm.next_event_with_limit(max_instructions_per_event)?;
            summary.event_count += 1;
            summary.max_call_depth = summary.max_call_depth.max(depth);
            match &event {
                SystemVmEvent::ServiceCall {
                    family,
                    service_id,
                    args,
                } => {
                    summary.service_event_count += 1;
                    summary.last_event_kind = SystemHostEventKind::Service;
                    if let Some((trace, max_recorded_services)) = trace.as_mut() {
                        record_service_trace(
                            &mut **trace,
                            *max_recorded_services,
                            summary.event_count,
                            depth,
                            frame.script_id.index(),
                            *family,
                            *service_id,
                            args,
                            frame.vm.last_instruction_offset().unwrap_or(0),
                            &frame.vm,
                        );
                    }
                    self.host.record_service_event(&event);
                    match family {
                        crate::SystemCallFamily::System => {
                            summary.syscall_service_counts[usize::from(*service_id)] += 1
                        }
                        crate::SystemCallFamily::Graph => {
                            summary.graphcall_service_counts[usize::from(*service_id)] += 1;
                            match *service_id {
                                0x88 if summary.first_graph88_arg_count == 0 => {
                                    summary.first_graph88_arg_count = args.len();
                                    summary.first_graph88_top_kind = top_value_kind(args);
                                }
                                0x9c if summary.first_graph9c_arg_count == 0 => {
                                    summary.first_graph9c_arg_count = args.len();
                                    summary.first_graph9c_top_kind = top_value_kind(args);
                                }
                                _ => {}
                            }
                        }
                        crate::SystemCallFamily::Sound => {
                            summary.soundcall_service_counts[usize::from(*service_id)] += 1;
                            if summary.first_sound_arg_count == 0 {
                                summary.first_sound_service_id = *service_id;
                                summary.first_sound_arg_count = args.len();
                                summary.first_sound_top_kind = top_value_kind(args);
                            }
                        }
                        crate::SystemCallFamily::External => {
                            summary.extcall_service_counts[usize::from(*service_id)] += 1
                        }
                    }
                    if let Some(request) = self.host.asset_request(*service_id, args) {
                        summary.host_state = self.host.state();
                        return Ok((
                            summary,
                            Some(SystemRuntimePendingAsset {
                                request,
                                event: SystemVmEventOwned::from(event.clone()),
                            }),
                        ));
                    }
                }
                SystemVmEvent::LoadedProgramCall { .. } => {
                    summary.user_call_event_count += 1;
                    summary.last_event_kind = SystemHostEventKind::UserCall;
                }
                SystemVmEvent::UserScriptCall { service_id, .. } => {
                    summary.user_call_event_count += 1;
                    summary.last_event_kind = SystemHostEventKind::UserCall;
                    summary.user_script_dispatch_counts[usize::from(*service_id)] += 1;
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
                    let return_value = self.finish_current_frame();
                    if let Some(value) = return_value {
                        self.resume_current(value)?;
                    }
                    continue;
                }
                SystemVmEvent::Halted => {
                    summary.halted_event_count += 1;
                    summary.last_event_kind = SystemHostEventKind::Halted;
                    let return_value = self.finish_current_frame();
                    if let Some(value) = return_value {
                        self.resume_current(value)?;
                    }
                    continue;
                }
            }

            if let Some((id, offset, args)) = self.dispatch_target(event.clone())? {
                let mode = match event {
                    SystemVmEvent::LoadedProgramCall { .. } => ChildFrameMode::ShareParentMemory,
                    SystemVmEvent::UserScriptCall { .. } => ChildFrameMode::ShareSystemMemory,
                    _ => ChildFrameMode::Standalone,
                };
                self.push_script_with_mode(id, offset, args, mode)?;
                if let Some(frame) = self.frames.last_mut() {
                    frame.return_value = dispatched_return_value(&event);
                }
                continue;
            }

            let Some(result) = self.host.event_result_without_record(&event) else {
                summary.completed = true;
                break;
            };
            if let Some(effect) = result.effect() {
                self.apply_host_effect(effect)?;
            }
            if let Some(value) = result.into_value() {
                self.resume_current(value)?;
            }
        }
        summary.host_state = self.host.state();
        Ok((summary, None))
    }

    fn dispatch_target(
        &self,
        event: SystemVmEvent<'a>,
    ) -> Result<Option<(ScriptId, Option<usize>, Vec<SystemValue<'a>>)>> {
        match event {
            SystemVmEvent::LoadedProgramCall {
                handle,
                offset,
                args,
            } => {
                let Some(id) = self.scripts.id_from_index(handle as usize) else {
                    return Ok(None);
                };
                Ok(Some((id, offset, args)))
            }
            SystemVmEvent::UserScriptCall { mut args, .. } => {
                if let Some(SystemValue::UserScriptHandle(handle)) = args.first().cloned() {
                    let Some(id) = self.scripts.id_from_index(handle as usize) else {
                        return Ok(None);
                    };
                    args.remove(0);
                    return Ok(Some((id, None, args)));
                }
                if let Some(index) = args
                    .iter()
                    .position(|value| matches!(value, SystemValue::CodeInScript { .. }))
                {
                    let SystemValue::CodeInScript {
                        script_index,
                        offset,
                    } = args.remove(index)
                    else {
                        unreachable!();
                    };
                    let Some(id) = self.scripts.id_from_index(script_index) else {
                        return Ok(None);
                    };
                    return Ok(Some((id, Some(offset), args)));
                }
                Ok(None)
            }
            _ => Ok(None),
        }
    }

    fn resume_current(&mut self, value: SystemValue<'a>) -> Result<()> {
        let Some(frame) = self.frames.last_mut() else {
            return Ok(());
        };
        frame.vm.resume_with(value)
    }

    fn apply_host_effect(&mut self, effect: &SystemHostEffect) -> Result<()> {
        let Some(frame) = self.frames.last_mut() else {
            return Ok(());
        };
        for write in effect.writes() {
            frame.vm.apply_host_write(write)?;
        }
        Ok(())
    }

    fn finish_current_frame(&mut self) -> Option<SystemValue<'a>> {
        let Some(frame) = self.frames.pop() else {
            return None;
        };
        let Some(parent) = self.frames.last_mut() else {
            return None;
        };
        let implicit_return = matches!(frame.mode, ChildFrameMode::ShareParentMemory)
            .then(|| frame.vm.stack().last().cloned())
            .flatten();
        match frame.mode {
            ChildFrameMode::Standalone => {}
            ChildFrameMode::ShareParentMemory => parent.vm.adopt_shared_memory_from(&frame.vm),
            ChildFrameMode::ShareSystemMemory => {
                parent.vm.adopt_shared_system_memory_from(&frame.vm)
            }
        }
        frame.return_value.or(implicit_return)
    }
}

fn owned_args_to_runtime(args: Vec<SystemValueSnapshot>) -> Vec<SystemValue<'static>> {
    args.into_iter()
        .map(SystemValueSnapshot::into_runtime_value)
        .collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct SystemRuntimeFrameState {
    pub script_index: usize,
    pub cursor: usize,
    pub last_instruction_offset: usize,
    pub mem_ptr: u32,
    pub local_44: u64,
    pub local_48: u64,
    pub local_56: u64,
    pub local_60: u64,
    pub local_64: u64,
    pub local_68: u64,
    pub local_72: u64,
    pub local_76: u64,
    pub local_1076: u64,
    pub local_1152: u64,
    pub local_3952: u64,
    pub local_3956: u64,
    pub local_3980: u64,
    pub local_3992: u64,
    pub local_3996: u64,
    pub local_4024: u64,
    pub local_4028: u64,
    pub local_4076: u64,
    pub local_7100: u64,
    pub local_7104: u64,
    pub local_7108: u64,
    pub local_7112: u64,
}

fn record_service_trace(
    trace: &mut SystemServiceTrace,
    max_recorded_services: usize,
    event_index: usize,
    depth: usize,
    script_index: usize,
    family: crate::SystemCallFamily,
    service_id: u8,
    args: &[SystemValue<'_>],
    instruction_offset: usize,
    vm: &crate::system_vm::SystemVm<'_>,
) {
    trace.total_service_count += 1;
    if trace.recorded_services.len() == max_recorded_services {
        return;
    }
    let (integer_arg_count, min_integer_arg, max_integer_arg) = integer_arg_bounds(args);
    let (string_arg_count, first_string_len, first_string_hash) = string_arg_shape(args);
    trace.recorded_services.push(SystemServiceTraceEvent {
        event_index,
        depth,
        script_index,
        family,
        service_id,
        arg_count: args.len(),
        top_kind: top_value_kind(args),
        integer_arg_count,
        min_integer_arg,
        max_integer_arg,
        string_arg_count,
        first_string_len,
        first_string_hash,
        instruction_offset,
        arg_slots: service_arg_slots(args),
        inline_strings: service_inline_strings(vm, family, args),
    });
}

fn service_arg_slots(
    args: &[SystemValue<'_>],
) -> [SystemServiceTraceArg; SYSTEM_SERVICE_TRACE_ARG_SLOTS] {
    let mut slots = [SystemServiceTraceArg::default(); SYSTEM_SERVICE_TRACE_ARG_SLOTS];
    for (slot, value) in slots.iter_mut().zip(args.iter()) {
        *slot = service_arg_slot(value);
    }
    slots
}

fn service_arg_slot(value: &SystemValue<'_>) -> SystemServiceTraceArg {
    match value {
        SystemValue::Integer(value) => SystemServiceTraceArg {
            kind: 1,
            value: *value as u32,
            len: 0,
            hash: 0,
        },
        SystemValue::String(bytes) => string_trace_arg(0, bytes),
        SystemValue::OwnedString(bytes) => string_trace_arg(0, bytes),
        SystemValue::LocalStringPointer { address, bytes } => string_trace_arg(*address, bytes),
        SystemValue::Code(offset) => SystemServiceTraceArg {
            kind: 3,
            value: (*offset).min(u32::MAX as usize) as u32,
            len: 0,
            hash: 0,
        },
        SystemValue::CodeInScript { offset, .. } => SystemServiceTraceArg {
            kind: 3,
            value: (*offset).min(u32::MAX as usize) as u32,
            len: 0,
            hash: 0,
        },
        SystemValue::UserScriptHandle(handle) => SystemServiceTraceArg {
            kind: 4,
            value: *handle,
            len: 0,
            hash: 0,
        },
        SystemValue::UserScriptResult(service_id) => SystemServiceTraceArg {
            kind: 5,
            value: u32::from(*service_id),
            len: 0,
            hash: 0,
        },
        SystemValue::VariablePointer(address) => SystemServiceTraceArg {
            kind: 6,
            value: *address,
            len: 0,
            hash: 0,
        },
        SystemValue::Unknown => SystemServiceTraceArg {
            kind: 7,
            value: 0,
            len: 0,
            hash: 0,
        },
    }
}

fn string_trace_arg(value: u32, bytes: &[u8]) -> SystemServiceTraceArg {
    SystemServiceTraceArg {
        kind: 2,
        value,
        len: bytes.len().min(u32::MAX as usize) as u32,
        hash: fnv1a64(bytes) as u32,
    }
}

fn service_inline_strings(
    vm: &crate::system_vm::SystemVm<'_>,
    family: crate::SystemCallFamily,
    args: &[SystemValue<'_>],
) -> Vec<SystemServiceTraceInlineString> {
    let mut strings = Vec::new();
    for (arg_index, value) in args.iter().enumerate() {
        let Some(bytes) = value.string_bytes() else {
            continue;
        };
        if strings.len() == SYSTEM_SERVICE_TRACE_INLINE_STRING_LIMIT {
            break;
        }
        push_inline_string(&mut strings, arg_index, bytes);
    }
    // Graph layer/blit calls reference their bound asset by a small integer token
    // (e.g. a source-layer key) that indexes into auxiliary memory slot 0, where
    // the engine has written the asset's entry name. That binding is only present
    // while the graph command executes, so resolve it here at emit time rather
    // than sampling memory asynchronously from the renderer.
    if family == crate::SystemCallFamily::Graph {
        for (arg_index, value) in args.iter().enumerate() {
            if strings.len() == SYSTEM_SERVICE_TRACE_INLINE_STRING_LIMIT {
                break;
            }
            let SystemValue::Integer(token) = value else {
                continue;
            };
            let token = *token as u32;
            if token == 0 || token > AUX_TOKEN_MAX_OFFSET {
                continue;
            }
            if strings
                .iter()
                .any(|existing| existing.arg_index == arg_index)
            {
                continue;
            }
            let Some(bytes) = vm.aux_token_c_string(0, token as usize) else {
                continue;
            };
            if !looks_like_asset_entry_name(&bytes) {
                continue;
            }
            push_inline_string(&mut strings, arg_index, &bytes);
        }
    }
    strings
}

const AUX_TOKEN_MAX_OFFSET: u32 = 0x0001_0000;

fn push_inline_string(
    strings: &mut Vec<SystemServiceTraceInlineString>,
    arg_index: usize,
    bytes: &[u8],
) {
    let byte_len = bytes
        .len()
        .min(SYSTEM_SERVICE_TRACE_INLINE_STRING_MAX_BYTES);
    strings.push(SystemServiceTraceInlineString {
        arg_index,
        byte_len,
        full_len: bytes.len(),
        hash: fnv1a64(bytes) as u32,
        bytes: bytes[..byte_len].to_vec(),
    });
}

/// Heuristic gate so aux-token resolution only records strings that look like
/// real asset entry names (printable ASCII with at least one alphanumeric run),
/// avoiding noise from unrelated integer arguments that happen to index live
/// aux memory.
fn looks_like_asset_entry_name(bytes: &[u8]) -> bool {
    if bytes.len() < 4 || bytes.len() > SYSTEM_SERVICE_TRACE_INLINE_STRING_MAX_BYTES {
        return false;
    }
    let mut alnum = 0usize;
    for &byte in bytes {
        if !(0x20..=0x7e).contains(&byte) {
            return false;
        }
        if byte.is_ascii_alphanumeric() {
            alnum += 1;
        }
    }
    alnum * 2 >= bytes.len()
}

fn integer_arg_bounds(args: &[SystemValue<'_>]) -> (usize, u64, u64) {
    let mut count = 0usize;
    let mut min = u64::MAX;
    let mut max = 0u64;
    for value in args {
        if let SystemValue::Integer(integer) = value {
            count += 1;
            min = min.min(*integer);
            max = max.max(*integer);
        }
    }
    if count == 0 {
        (0, 0, 0)
    } else {
        (count, min, max)
    }
}

fn top_value_kind(args: &[SystemValue<'_>]) -> u8 {
    args.last().map(value_kind_code).unwrap_or(0)
}

fn string_arg_shape(args: &[SystemValue<'_>]) -> (usize, usize, u64) {
    let mut count = 0usize;
    let mut first_len = 0usize;
    let mut first_hash = 0u64;
    for value in args {
        let Some(bytes) = value.string_bytes() else {
            continue;
        };
        count += 1;
        if count == 1 {
            first_len = bytes.len();
            first_hash = fnv1a64(bytes);
        }
    }
    (count, first_len, first_hash)
}

fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

fn value_kind_code(value: &SystemValue<'_>) -> u8 {
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

#[derive(Debug)]
struct SystemFrame<'a> {
    script_id: ScriptId,
    vm: SystemVm<'a>,
    mode: ChildFrameMode,
    return_value: Option<SystemValue<'a>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ChildFrameMode {
    Standalone,
    ShareParentMemory,
    ShareSystemMemory,
}

impl ChildFrameMode {
    fn as_u8(self) -> u8 {
        match self {
            Self::Standalone => 0,
            Self::ShareParentMemory => 1,
            Self::ShareSystemMemory => 2,
        }
    }

    fn from_u8(value: u8) -> Result<Self> {
        match value {
            0 => Ok(Self::Standalone),
            1 => Ok(Self::ShareParentMemory),
            2 => Ok(Self::ShareSystemMemory),
            _ => Err(SakuraError::InvalidRuntime(
                "system runtime snapshot frame mode is invalid".to_owned(),
            )),
        }
    }
}

fn dispatched_return_value<'a>(event: &SystemVmEvent<'_>) -> Option<SystemValue<'a>> {
    match event {
        SystemVmEvent::UserScriptCall { service_id, .. } => {
            Some(SystemValue::UserScriptResult(*service_id))
        }
        _ => None,
    }
}

pub fn run_system_runtime_with_host(
    scripts: &ScriptLibrary,
    host: SystemHost<'_>,
    entry_id: ScriptId,
    max_events: usize,
    max_instructions_per_event: usize,
) -> Result<SystemRuntimeSummary> {
    let mut runtime = SystemRuntime::new(scripts, host);
    runtime.push_script(entry_id, Vec::new())?;
    runtime.run(max_events, max_instructions_per_event)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ArcArchive;

    #[test]
    fn dispatches_user_script_handle_to_loaded_system_script() -> Result<()> {
        let callee = build_synthetic_dsc(&{
            let mut script = vec![0u8; 0x10];
            script.extend_from_slice(&[0x80, 0x46, 0xff, 0xf8]);
            script
        });
        let caller = build_synthetic_dsc(&{
            let mut script = vec![0u8; 0x10];
            script.push(0x05);
            script.extend_from_slice(&8i16.to_le_bytes());
            script.extend_from_slice(&[0x80, 0x40, 0xff, 0x00, 0x17]);
            script.extend_from_slice(b"callee._bp\0");
            script
        });
        let archive_data = build_arc20(&[
            ("callee._bp", callee.as_slice()),
            ("caller._bp", caller.as_slice()),
        ]);
        let archive = ArcArchive::parse(&archive_data)?;
        let mut scripts = ScriptLibrary::new();
        scripts.mount_archive(&archive)?;
        let host = SystemHost::new(&scripts);
        let entry_id = scripts
            .id_from_index(1)
            .ok_or_else(|| SakuraError::InvalidScript("synthetic caller missing".to_owned()))?;

        let summary = run_system_runtime_with_host(&scripts, host, entry_id, 16, 64)?;

        assert!(summary.completed);
        assert_eq!(summary.user_call_event_count, 1);
        assert_eq!(summary.service_event_count, 2);
        Ok(())
    }

    #[test]
    fn dispatches_user_script_arguments_through_callee_frame_prologue() -> Result<()> {
        let callee = build_synthetic_dsc(&{
            let mut script = vec![0u8; 0x10];
            script.extend_from_slice(&[
                0x10, 0x00, 0x14, 0x20, 0x11, 0x04, 0x14, 0x00, 0x0a, 0x02, 0x04, 0x14, 0x00, 0x08,
                0x02, 0xa0, 0x46, 0x10, 0x00, 0x14, 0x21, 0x11, 0x17,
            ]);
            script
        });
        let caller = build_synthetic_dsc(&{
            let mut script = vec![0u8; 0x10];
            script.push(0x05);
            let string_operand = script.len();
            script.extend_from_slice(&0i16.to_le_bytes());
            script.extend_from_slice(&[0x80, 0x40, 0x00, 0x07, 0xff, 0x00, 0x17]);
            let string_offset = script.len();
            script.extend_from_slice(b"callee._bp\0");
            let displacement = i16::try_from(string_offset as isize - 0x10).unwrap();
            script[string_operand..string_operand + 2].copy_from_slice(&displacement.to_le_bytes());
            script
        });
        let archive_data = build_arc20(&[
            ("callee._bp", callee.as_slice()),
            ("caller._bp", caller.as_slice()),
        ]);
        let archive = ArcArchive::parse(&archive_data)?;
        let mut scripts = ScriptLibrary::new();
        scripts.mount_archive(&archive)?;
        let host = SystemHost::new(&scripts);
        let entry_id = scripts
            .id_from_index(1)
            .ok_or_else(|| SakuraError::InvalidScript("synthetic caller missing".to_owned()))?;
        let mut runtime = SystemRuntime::new(&scripts, host);
        runtime.push_script(entry_id, Vec::new())?;

        let (summary, trace) = runtime.run_with_service_trace(16, 64, 4)?;

        assert!(summary.completed);
        assert_eq!(summary.user_call_event_count, 1);
        assert_eq!(summary.service_event_count, 2);
        let callee_service = trace
            .recorded_services
            .iter()
            .find(|event| event.family == crate::SystemCallFamily::Sound)
            .ok_or_else(|| SakuraError::InvalidScript("callee sound service missing".to_owned()))?;
        assert_eq!(callee_service.service_id, 0x46);
        assert_eq!(callee_service.arg_count, 1);
        assert_eq!(callee_service.integer_arg_count, 1);
        assert_eq!(callee_service.min_integer_arg, 7);
        assert_eq!(callee_service.max_integer_arg, 7);
        Ok(())
    }

    #[test]
    fn preserves_user_script_result_shape_after_dispatched_system_script_returns() -> Result<()> {
        let callee = build_synthetic_dsc(&{
            let mut script = vec![0u8; 0x10];
            script.extend_from_slice(&[0x17]);
            script
        });
        let caller = build_synthetic_dsc(&{
            let mut script = vec![0u8; 0x10];
            script.push(0x05);
            let string_operand = script.len();
            script.extend_from_slice(&0i16.to_le_bytes());
            script.extend_from_slice(&[0x80, 0x40, 0x00, 0x07, 0xff, 0x00, 0x80, 0x46, 0x17]);
            let string_offset = script.len();
            script.extend_from_slice(b"callee._bp\0");
            let displacement = i16::try_from(string_offset as isize - 0x10).unwrap();
            script[string_operand..string_operand + 2].copy_from_slice(&displacement.to_le_bytes());
            script
        });
        let archive_data = build_arc20(&[
            ("callee._bp", callee.as_slice()),
            ("caller._bp", caller.as_slice()),
        ]);
        let archive = ArcArchive::parse(&archive_data)?;
        let mut scripts = ScriptLibrary::new();
        scripts.mount_archive(&archive)?;
        let host = SystemHost::new(&scripts);
        let entry_id = scripts
            .id_from_index(1)
            .ok_or_else(|| SakuraError::InvalidScript("synthetic caller missing".to_owned()))?;
        let mut runtime = SystemRuntime::new(&scripts, host);
        runtime.push_script(entry_id, Vec::new())?;

        let (summary, trace) = runtime.run_with_service_trace(16, 64, 4)?;

        assert!(summary.completed);
        assert_eq!(summary.user_call_event_count, 1);
        assert_eq!(summary.service_event_count, 2);
        assert_eq!(
            trace.recorded_services[0].family,
            crate::SystemCallFamily::System
        );
        assert_eq!(trace.recorded_services[0].service_id, 0x40);
        assert_eq!(
            trace.recorded_services[1].family,
            crate::SystemCallFamily::System
        );
        assert_eq!(trace.recorded_services[1].service_id, 0x46);
        assert_eq!(trace.recorded_services[1].arg_count, 1);
        assert_eq!(trace.recorded_services[1].top_kind, 5);
        Ok(())
    }

    #[test]
    fn dispatches_loaded_program_handle_calls_without_parent_stack_pollution() -> Result<()> {
        let callee = build_synthetic_dsc(&{
            let mut script = vec![0u8; 0x10];
            script.extend_from_slice(&[
                0x10, 0x00, 0x08, 0x20, 0x11, 0x00, 0x07, 0x91, 0x88, 0x10, 0x00, 0x08, 0x21, 0x11,
                0x17,
            ]);
            script
        });
        let caller = build_synthetic_dsc(&{
            let mut script = vec![0u8; 0x10];
            script.extend_from_slice(&[0x10, 0x00, 0x20, 0x11]);
            script.push(0x05);
            let string_operand = script.len();
            script.extend_from_slice(&0i16.to_le_bytes());
            script.extend_from_slice(&[
                0x80, 0x40, 0x04, 0x08, 0x00, 0x0a, 0x02, 0x04, 0x08, 0x00, 0x08, 0x02, 0x16, 0x91,
                0x64, 0x10, 0x00, 0x20, 0x21, 0x11, 0x17,
            ]);
            let string_offset = script.len();
            script.extend_from_slice(b"callee._bp\0");
            let displacement = i16::try_from(string_offset as isize - 0x14).unwrap();
            script[string_operand..string_operand + 2].copy_from_slice(&displacement.to_le_bytes());
            script
        });
        let archive_data = build_arc20(&[
            ("callee._bp", callee.as_slice()),
            ("caller._bp", caller.as_slice()),
        ]);
        let archive = ArcArchive::parse(&archive_data)?;
        let mut scripts = ScriptLibrary::new();
        scripts.mount_archive(&archive)?;
        let host = SystemHost::new(&scripts);
        let entry_id = scripts
            .id_from_index(1)
            .ok_or_else(|| SakuraError::InvalidScript("synthetic caller missing".to_owned()))?;
        let mut runtime = SystemRuntime::new(&scripts, host);
        runtime.push_script(entry_id, Vec::new())?;

        let (summary, trace) = runtime.run_with_service_trace(16, 64, 8)?;

        assert!(summary.completed);
        assert_eq!(summary.user_call_event_count, 1);
        assert_eq!(summary.service_event_count, 3);
        assert_eq!(trace.recorded_services[0].service_id, 0x40);
        assert_eq!(trace.recorded_services[1].service_id, 0x88);
        assert_eq!(trace.recorded_services[2].service_id, 0x64);
        assert_eq!(trace.recorded_services[2].arg_count, 0);
        Ok(())
    }

    #[test]
    fn leaves_plain_user_script_calls_to_host_result() -> Result<()> {
        let caller = build_synthetic_dsc(&{
            let mut script = vec![0u8; 0x10];
            script.extend_from_slice(&[0xff, 0x00, 0x80, 0x46, 0x17]);
            script
        });
        let archive_data = build_arc20(&[("caller._bp", caller.as_slice())]);
        let archive = ArcArchive::parse(&archive_data)?;
        let mut scripts = ScriptLibrary::new();
        scripts.mount_archive(&archive)?;
        let host = SystemHost::new(&scripts);
        let entry_id = scripts
            .id_from_index(0)
            .ok_or_else(|| SakuraError::InvalidScript("synthetic caller missing".to_owned()))?;

        let summary = run_system_runtime_with_host(&scripts, host, entry_id, 16, 64)?;

        assert!(summary.completed);
        assert_eq!(summary.user_call_event_count, 1);
        assert_eq!(summary.service_event_count, 1);
        Ok(())
    }

    #[test]
    fn does_not_push_void_service_results_into_following_service_args() -> Result<()> {
        let caller = build_synthetic_dsc(&{
            let mut script = vec![0u8; 0x10];
            script.extend_from_slice(&[0xa0, 0x70, 0x91, 0x68, 0x00, 0x03, 0x91, 0x64, 0x17]);
            script
        });
        let archive_data = build_arc20(&[("caller._bp", caller.as_slice())]);
        let archive = ArcArchive::parse(&archive_data)?;
        let mut scripts = ScriptLibrary::new();
        scripts.mount_archive(&archive)?;
        let host = SystemHost::new(&scripts);
        let entry_id = scripts
            .id_from_index(0)
            .ok_or_else(|| SakuraError::InvalidScript("synthetic caller missing".to_owned()))?;
        let mut runtime = SystemRuntime::new(&scripts, host);
        runtime.push_script(entry_id, Vec::new())?;

        let (summary, trace) = runtime.run_with_service_trace(16, 64, 4)?;

        assert!(summary.completed);
        assert_eq!(summary.service_event_count, 3);
        assert_eq!(trace.recorded_services[0].arg_count, 0);
        assert_eq!(trace.recorded_services[1].arg_count, 0);
        assert_eq!(trace.recorded_services[2].arg_count, 1);
        assert_eq!(trace.recorded_services[2].integer_arg_count, 1);
        assert_eq!(trace.recorded_services[2].min_integer_arg, 3);
        Ok(())
    }

    #[test]
    fn records_service_trace_without_payload_bytes() -> Result<()> {
        let caller = build_synthetic_dsc(&{
            let mut script = vec![0u8; 0x10];
            script.extend_from_slice(&[0x00, 0x2a, 0x00, 0x2b, 0x91, 0x88, 0x17]);
            script
        });
        let archive_data = build_arc20(&[("caller._bp", caller.as_slice())]);
        let archive = ArcArchive::parse(&archive_data)?;
        let mut scripts = ScriptLibrary::new();
        scripts.mount_archive(&archive)?;
        let host = SystemHost::new(&scripts);
        let entry_id = scripts
            .id_from_index(0)
            .ok_or_else(|| SakuraError::InvalidScript("synthetic caller missing".to_owned()))?;
        let mut runtime = SystemRuntime::new(&scripts, host);
        runtime.push_script(entry_id, Vec::new())?;

        let (summary, trace) = runtime.run_with_service_trace(16, 64, 4)?;

        assert!(summary.completed);
        assert_eq!(trace.total_service_count, 1);
        assert_eq!(trace.recorded_services.len(), 1);
        assert_eq!(
            trace.recorded_services[0].family,
            crate::SystemCallFamily::Graph
        );
        assert_eq!(trace.recorded_services[0].service_id, 0x88);
        assert_eq!(trace.recorded_services[0].arg_count, 2);
        assert_eq!(trace.recorded_services[0].integer_arg_count, 2);
        assert_eq!(trace.recorded_services[0].min_integer_arg, 0x2a);
        assert_eq!(trace.recorded_services[0].max_integer_arg, 0x2b);
        Ok(())
    }

    #[test]
    fn applies_host_local_writes_before_continuing_current_frame() -> Result<()> {
        let caller = build_synthetic_dsc(&{
            let mut script = vec![0u8; 0x10];
            script.extend_from_slice(&[0x00, 0x20, 0x11, 0x04, 0x00, 0x00, 0x90, 0xbf]);
            script.extend_from_slice(&[
                0x04, 0x00, 0x00, 0x08, 0x02, 0x02, 0x06, 0x00, 0x00, 0x10, 0x30,
            ]);
            let target_operand = push_codeoffset_placeholder(&mut script);
            script.extend_from_slice(&[0x15, 0x00, 0x10, 0x00, 0x20, 0x21, 0x11, 0x17]);
            let target = script.len();
            script.extend_from_slice(&[0x00, 0x07, 0xa0, 0x46, 0x10, 0x00, 0x20, 0x21, 0x11, 0x17]);
            patch_codeoffset(&mut script, target_operand, target);
            script
        });
        let archive_data = build_arc20(&[("caller._bp", caller.as_slice())]);
        let archive = ArcArchive::parse(&archive_data)?;
        let mut scripts = ScriptLibrary::new();
        scripts.mount_archive(&archive)?;
        let host = SystemHost::new(&scripts);
        let entry_id = scripts
            .id_from_index(0)
            .ok_or_else(|| SakuraError::InvalidScript("synthetic caller missing".to_owned()))?;
        let mut runtime = SystemRuntime::new(&scripts, host);
        runtime.push_script(entry_id, Vec::new())?;

        let (summary, trace) = runtime.run_with_service_trace(16, 64, 4)?;

        assert!(summary.completed);
        assert_eq!(summary.service_event_count, 2);
        assert_eq!(trace.recorded_services[0].service_id, 0xbf);
        assert_eq!(
            trace.recorded_services[1].family,
            crate::SystemCallFamily::Sound
        );
        assert_eq!(trace.recorded_services[1].service_id, 0x46);
        assert_eq!(trace.recorded_services[1].min_integer_arg, 7);
        Ok(())
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
