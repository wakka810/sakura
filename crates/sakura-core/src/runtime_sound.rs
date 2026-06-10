use crate::system_runtime::{SystemServiceTrace, SYSTEM_SERVICE_TRACE_ARG_SLOTS};
use crate::SystemCallFamily;

const RUNTIME_QUEUE_ARG_SLOT_LEN: usize = 16;
pub(crate) const RUNTIME_SOUND_EVENT_LEN: usize =
    52 + SYSTEM_SERVICE_TRACE_ARG_SLOTS * RUNTIME_QUEUE_ARG_SLOT_LEN;
pub(crate) const RUNTIME_SOUND_MAX_EVENTS: usize = 64;
pub(crate) const RUNTIME_SOUND_QUEUE_PACKET_LEN: usize =
    32 + RUNTIME_SOUND_EVENT_LEN * RUNTIME_SOUND_MAX_EVENTS;

pub(crate) fn write_sound_queue_packet(
    out: &mut [u8],
    script_index: usize,
    offset: Option<usize>,
    record_limit: usize,
    trace: &SystemServiceTrace,
) {
    out[..RUNTIME_SOUND_QUEUE_PACKET_LEN].fill(0);
    write_u32(out, 0, 1);
    write_u32(out, 4, script_index as u32);
    write_u32(out, 8, offset.unwrap_or(u32::MAX as usize) as u32);
    write_u32(out, 12, trace.total_service_count as u32);
    write_u32(out, 16, trace.recorded_services.len() as u32);
    write_u32(out, 20, record_limit as u32);
    let queued = sound_count(trace).min(RUNTIME_SOUND_MAX_EVENTS);
    write_u32(out, 24, queued as u32);

    let mut cursor = 32usize;
    for event in trace
        .recorded_services
        .iter()
        .filter(|event| event.family == SystemCallFamily::Sound)
        .take(RUNTIME_SOUND_MAX_EVENTS)
    {
        write_u32(out, cursor, event.event_index as u32);
        write_u32(out, cursor + 4, event.depth as u32);
        write_u32(out, cursor + 8, event.service_id.into());
        write_u32(
            out,
            cursor + 12,
            event.arg_count.min(u32::MAX as usize) as u32,
        );
        write_u32(out, cursor + 16, family_code(event.family).into());
        write_u32(out, cursor + 20, event.top_kind.into());
        write_u32(
            out,
            cursor + 24,
            event.integer_arg_count.min(u32::MAX as usize) as u32,
        );
        write_u32(
            out,
            cursor + 28,
            event.min_integer_arg.min(u32::MAX.into()) as u32,
        );
        write_u32(
            out,
            cursor + 32,
            event.max_integer_arg.min(u32::MAX.into()) as u32,
        );
        write_u32(
            out,
            cursor + 36,
            event.string_arg_count.min(u32::MAX as usize) as u32,
        );
        write_u32(
            out,
            cursor + 40,
            event.first_string_len.min(u32::MAX as usize) as u32,
        );
        write_u32(out, cursor + 44, event.first_string_hash as u32);
        write_u32(out, cursor + 48, event.instruction_offset as u32);
        write_arg_slots(out, cursor + 52, event);
        cursor += RUNTIME_SOUND_EVENT_LEN;
    }
}

fn write_arg_slots(
    out: &mut [u8],
    offset: usize,
    event: &crate::system_runtime::SystemServiceTraceEvent,
) {
    for (index, arg) in event.arg_slots.iter().enumerate() {
        let slot = offset + index * RUNTIME_QUEUE_ARG_SLOT_LEN;
        write_u32(out, slot, u32::from(arg.kind));
        write_u32(out, slot + 4, arg.value);
        write_u32(out, slot + 8, arg.len);
        write_u32(out, slot + 12, arg.hash);
    }
}

fn sound_count(trace: &SystemServiceTrace) -> usize {
    trace
        .recorded_services
        .iter()
        .filter(|event| event.family == SystemCallFamily::Sound)
        .count()
}

fn family_code(family: SystemCallFamily) -> u8 {
    match family {
        SystemCallFamily::System => 0,
        SystemCallFamily::Graph => 1,
        SystemCallFamily::Sound => 2,
        SystemCallFamily::External => 3,
    }
}

fn write_u32(out: &mut [u8], offset: usize, value: u32) {
    out[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::system_runtime::SystemServiceTraceEvent;

    fn empty_arg_slots() -> [crate::system_runtime::SystemServiceTraceArg; SYSTEM_SERVICE_TRACE_ARG_SLOTS]
    {
        [crate::system_runtime::SystemServiceTraceArg::default(); SYSTEM_SERVICE_TRACE_ARG_SLOTS]
    }

    #[test]
    fn writes_only_safe_sound_events() {
        let trace = SystemServiceTrace {
            total_service_count: 3,
            recorded_services: vec![
                event(SystemCallFamily::Graph, 0x68, 1),
                event(SystemCallFamily::Sound, 0x70, 2),
                event(SystemCallFamily::Sound, 0x71, 3),
            ],
        };
        let mut packet = vec![0xff; RUNTIME_SOUND_QUEUE_PACKET_LEN];

        write_sound_queue_packet(&mut packet, 214, None, RUNTIME_SOUND_MAX_EVENTS, &trace);

        assert_eq!(read_u32(&packet, 0), 1);
        assert_eq!(read_u32(&packet, 4), 214);
        assert_eq!(read_u32(&packet, 8), u32::MAX);
        assert_eq!(read_u32(&packet, 12), 3);
        assert_eq!(read_u32(&packet, 16), 3);
        assert_eq!(read_u32(&packet, 24), 2);
        assert_eq!(read_u32(&packet, 32), 2);
        assert_eq!(read_u32(&packet, 40), 0x70);
        assert_eq!(read_u32(&packet, 48), 2);
        assert_eq!(read_u32(&packet, 32 + RUNTIME_SOUND_EVENT_LEN), 3);
        assert_eq!(read_u32(&packet, 40 + RUNTIME_SOUND_EVENT_LEN), 0x71);
    }

    #[test]
    fn caps_sound_events_without_losing_late_target_records() {
        let mut recorded_services = Vec::new();
        for index in 0..80 {
            recorded_services.push(event(SystemCallFamily::Graph, 0x10, index));
        }
        recorded_services.push(event(SystemCallFamily::Sound, 0x24, 80));
        let trace = SystemServiceTrace {
            total_service_count: 81,
            recorded_services,
        };
        let mut packet = vec![0xff; RUNTIME_SOUND_QUEUE_PACKET_LEN];

        write_sound_queue_packet(&mut packet, 22, None, 4096, &trace);

        assert_eq!(read_u32(&packet, 12), 81);
        assert_eq!(read_u32(&packet, 16), 81);
        assert_eq!(read_u32(&packet, 20), 4096);
        assert_eq!(read_u32(&packet, 24), 1);
        assert_eq!(read_u32(&packet, 32), 80);
        assert_eq!(read_u32(&packet, 40), 0x24);
    }

    fn event(
        family: SystemCallFamily,
        service_id: u8,
        event_index: usize,
    ) -> SystemServiceTraceEvent {
        SystemServiceTraceEvent {
            event_index,
            depth: 1,
            script_index: 22,
            family,
            service_id,
            arg_count: 1,
            top_kind: 1,
            integer_arg_count: 1,
            min_integer_arg: 0,
            max_integer_arg: 7,
            string_arg_count: 0,
            first_string_len: 0,
            first_string_hash: 0,
            instruction_offset: 0x100 + event_index,
            arg_slots: empty_arg_slots(),
            inline_strings: Vec::new(),
        }
    }

    fn read_u32(data: &[u8], offset: usize) -> u32 {
        u32::from_le_bytes([
            data[offset],
            data[offset + 1],
            data[offset + 2],
            data[offset + 3],
        ])
    }
}
