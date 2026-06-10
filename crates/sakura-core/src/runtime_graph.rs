use crate::system_runtime::{
    SystemServiceTrace, SystemServiceTraceEvent, SYSTEM_SERVICE_TRACE_ARG_SLOTS,
    SYSTEM_SERVICE_TRACE_INLINE_STRING_LIMIT, SYSTEM_SERVICE_TRACE_INLINE_STRING_MAX_BYTES,
};
use crate::SystemCallFamily;

const RUNTIME_QUEUE_ARG_SLOT_LEN: usize = 16;
const RUNTIME_GRAPH_INLINE_STRING_HEADER_LEN: usize = 16;
const RUNTIME_GRAPH_INLINE_STRING_SLOT_LEN: usize =
    16 + SYSTEM_SERVICE_TRACE_INLINE_STRING_MAX_BYTES;
pub(crate) const RUNTIME_GRAPH_EVENT_LEN: usize =
    52
        + SYSTEM_SERVICE_TRACE_ARG_SLOTS * RUNTIME_QUEUE_ARG_SLOT_LEN
        + RUNTIME_GRAPH_INLINE_STRING_HEADER_LEN
        + SYSTEM_SERVICE_TRACE_INLINE_STRING_LIMIT * RUNTIME_GRAPH_INLINE_STRING_SLOT_LEN;
pub(crate) const RUNTIME_GRAPH_MAX_EVENTS: usize = 256;
pub(crate) const RUNTIME_GRAPH_QUEUE_PACKET_LEN: usize =
    32 + RUNTIME_GRAPH_EVENT_LEN * RUNTIME_GRAPH_MAX_EVENTS;
const RUNTIME_GRAPH_HEAD_SAMPLE_EVENTS: usize = 8;

pub(crate) fn write_graph_queue_packet(
    out: &mut [u8],
    script_index: usize,
    offset: Option<usize>,
    record_limit: usize,
    trace: &SystemServiceTrace,
) {
    out[..RUNTIME_GRAPH_QUEUE_PACKET_LEN].fill(0);
    write_u32(out, 0, 1);
    write_u32(out, 4, script_index as u32);
    write_u32(out, 8, offset.unwrap_or(u32::MAX as usize) as u32);
    write_u32(out, 12, trace.total_service_count as u32);
    write_u32(out, 16, trace.recorded_services.len() as u32);
    write_u32(out, 20, record_limit as u32);
    let selected = select_graph_events(trace);
    let queued = selected.len();
    write_u32(out, 24, queued as u32);

    let mut cursor = 32usize;
    for event in selected {
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
        write_inline_strings(
            out,
            cursor + 52 + SYSTEM_SERVICE_TRACE_ARG_SLOTS * RUNTIME_QUEUE_ARG_SLOT_LEN,
            event,
        );
        cursor += RUNTIME_GRAPH_EVENT_LEN;
    }
}

fn select_graph_events(trace: &SystemServiceTrace) -> Vec<&SystemServiceTraceEvent> {
    let graph_events: Vec<_> = trace
        .recorded_services
        .iter()
        .filter(|event| event.family == SystemCallFamily::Graph)
        .collect();
    let mut selected = Vec::with_capacity(graph_events.len().min(RUNTIME_GRAPH_MAX_EVENTS));

    for event in graph_events.iter().take(RUNTIME_GRAPH_HEAD_SAMPLE_EVENTS) {
        selected.push(*event);
    }
    for event in graph_events
        .iter()
        .filter(|event| is_priority_graph_service(event.service_id))
    {
        push_unique_graph_event(&mut selected, event);
    }
    for event in graph_events {
        push_unique_graph_event(&mut selected, event);
    }
    selected
}

fn push_unique_graph_event<'a>(
    selected: &mut Vec<&'a SystemServiceTraceEvent>,
    event: &'a SystemServiceTraceEvent,
) {
    if selected.len() == RUNTIME_GRAPH_MAX_EVENTS
        || selected.iter().any(|selected| {
            selected.event_index == event.event_index || same_graph_event(selected, event)
        })
    {
        return;
    }
    selected.push(event);
}

fn is_priority_graph_service(service_id: u8) -> bool {
    matches!(
        service_id,
        0x10
            | 0x11
            | 0x13
            | 0x31
            | 0x32
            | 0x34
            | 0x37
            | 0x38
            | 0x4c
            | 0x50
            | 0x56
            | 0x57
            | 0x80
            | 0x85
            | 0x86
            | 0x88
            | 0x89
            | 0x8a
            | 0x8b
            | 0x8c
            | 0x94
            | 0x95
            | 0x96
            | 0x98
            | 0x99
            | 0x9a
            | 0x9c
            | 0x9d
            | 0xb8
            | 0xba
            | 0xbc
            | 0xbf
            | 0xe4
            | 0xe5
            | 0xe8
    )
}

fn same_graph_event(left: &SystemServiceTraceEvent, right: &SystemServiceTraceEvent) -> bool {
    left.service_id == right.service_id
        && left.instruction_offset == right.instruction_offset
        && left.arg_count == right.arg_count
        && left.top_kind == right.top_kind
        && left.arg_slots == right.arg_slots
}

fn family_code(family: SystemCallFamily) -> u8 {
    match family {
        SystemCallFamily::System => 0,
        SystemCallFamily::Graph => 1,
        SystemCallFamily::Sound => 2,
        SystemCallFamily::External => 3,
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

fn write_inline_strings(
    out: &mut [u8],
    offset: usize,
    event: &crate::system_runtime::SystemServiceTraceEvent,
) {
    let inline_count = event
        .inline_strings
        .len()
        .min(SYSTEM_SERVICE_TRACE_INLINE_STRING_LIMIT);
    write_u32(out, offset, inline_count as u32);
    let mut cursor = offset + RUNTIME_GRAPH_INLINE_STRING_HEADER_LEN;
    for item in event.inline_strings.iter().take(inline_count) {
        write_u32(out, cursor, item.arg_index.min(u32::MAX as usize) as u32);
        write_u32(out, cursor + 4, item.byte_len.min(u32::MAX as usize) as u32);
        write_u32(out, cursor + 8, item.full_len.min(u32::MAX as usize) as u32);
        write_u32(out, cursor + 12, item.hash);
        let copy_len = item
            .byte_len
            .min(SYSTEM_SERVICE_TRACE_INLINE_STRING_MAX_BYTES)
            .min(item.bytes.len());
        out[cursor + 16..cursor + 16 + copy_len].copy_from_slice(&item.bytes[..copy_len]);
        cursor += RUNTIME_GRAPH_INLINE_STRING_SLOT_LEN;
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
    fn writes_only_safe_graph_events() {
        let trace = SystemServiceTrace {
            total_service_count: 3,
            recorded_services: vec![
                event(SystemCallFamily::Sound, 0x70, 1),
                event(SystemCallFamily::Graph, 0x68, 2),
                event(SystemCallFamily::Graph, 0x64, 3),
            ],
        };
        let mut packet = vec![0xff; RUNTIME_GRAPH_QUEUE_PACKET_LEN];

        write_graph_queue_packet(&mut packet, 214, None, RUNTIME_GRAPH_MAX_EVENTS, &trace);

        assert_eq!(read_u32(&packet, 0), 1);
        assert_eq!(read_u32(&packet, 4), 214);
        assert_eq!(read_u32(&packet, 8), u32::MAX);
        assert_eq!(read_u32(&packet, 12), 3);
        assert_eq!(read_u32(&packet, 16), 3);
        assert_eq!(read_u32(&packet, 24), 2);
        assert_eq!(read_u32(&packet, 32), 2);
        assert_eq!(read_u32(&packet, 40), 0x68);
        assert_eq!(read_u32(&packet, 48), 1);
        assert_eq!(read_u32(&packet, 32 + RUNTIME_GRAPH_EVENT_LEN), 3);
        assert_eq!(read_u32(&packet, 40 + RUNTIME_GRAPH_EVENT_LEN), 0x64);
    }

    #[test]
    fn caps_graph_events_without_losing_late_target_records() {
        let mut recorded_services = Vec::new();
        for index in 0..80 {
            recorded_services.push(event(SystemCallFamily::Sound, 0x24, index));
        }
        recorded_services.push(event(SystemCallFamily::Graph, 0x88, 80));
        let trace = SystemServiceTrace {
            total_service_count: 81,
            recorded_services,
        };
        let mut packet = vec![0xff; RUNTIME_GRAPH_QUEUE_PACKET_LEN];

        write_graph_queue_packet(&mut packet, 22, None, 4096, &trace);

        assert_eq!(read_u32(&packet, 12), 81);
        assert_eq!(read_u32(&packet, 16), 81);
        assert_eq!(read_u32(&packet, 20), 4096);
        assert_eq!(read_u32(&packet, 24), 1);
        assert_eq!(read_u32(&packet, 32), 80);
        assert_eq!(read_u32(&packet, 40), 0x88);
    }

    #[test]
    fn prioritizes_late_render_events_after_graph_polling_noise() {
        let mut recorded_services = Vec::new();
        for index in 0..80 {
            recorded_services.push(event(SystemCallFamily::Graph, 0x1f, index));
        }
        recorded_services.push(event(SystemCallFamily::Graph, 0xba, 80));
        recorded_services.push(event(SystemCallFamily::Graph, 0xbc, 81));
        recorded_services.push(event(SystemCallFamily::Graph, 0xbf, 82));
        let trace = SystemServiceTrace {
            total_service_count: 83,
            recorded_services,
        };
        let mut packet = vec![0xff; RUNTIME_GRAPH_QUEUE_PACKET_LEN];

        write_graph_queue_packet(&mut packet, 22, None, 4096, &trace);

        assert_eq!(read_u32(&packet, 24), 83);
        assert_eq!(read_u32(&packet, 40), 0x1f);
        assert_eq!(read_u32(&packet, 40 + 8 * RUNTIME_GRAPH_EVENT_LEN), 0xba);
        assert_eq!(read_u32(&packet, 40 + 9 * RUNTIME_GRAPH_EVENT_LEN), 0xbc);
        assert_eq!(read_u32(&packet, 40 + 10 * RUNTIME_GRAPH_EVENT_LEN), 0xbf);
    }

    #[test]
    fn prioritizes_late_graph_scene_load_events_after_graph_polling_noise() {
        let mut recorded_services = Vec::new();
        for index in 0..80 {
            recorded_services.push(event(SystemCallFamily::Graph, 0x1f, index));
        }
        recorded_services.push(event(SystemCallFamily::Graph, 0x10, 80));
        recorded_services.push(event(SystemCallFamily::Graph, 0x9d, 81));
        let trace = SystemServiceTrace {
            total_service_count: 82,
            recorded_services,
        };
        let mut packet = vec![0xff; RUNTIME_GRAPH_QUEUE_PACKET_LEN];

        write_graph_queue_packet(&mut packet, 22, None, 4096, &trace);

        assert_eq!(read_u32(&packet, 24), 82);
        assert_eq!(read_u32(&packet, 40), 0x1f);
        assert_eq!(read_u32(&packet, 40 + 8 * RUNTIME_GRAPH_EVENT_LEN), 0x10);
        assert_eq!(read_u32(&packet, 32 + 8 * RUNTIME_GRAPH_EVENT_LEN), 80);
        assert_eq!(read_u32(&packet, 40 + 9 * RUNTIME_GRAPH_EVENT_LEN), 0x9d);
        assert_eq!(read_u32(&packet, 32 + 9 * RUNTIME_GRAPH_EVENT_LEN), 81);
    }

    #[test]
    fn deduplicates_repeated_graph_output_events_with_same_signature() {
        let repeated = SystemServiceTraceEvent {
            event_index: 80,
            depth: 1,
            script_index: 22,
            family: SystemCallFamily::Graph,
            service_id: 0xbf,
            arg_count: 2,
            top_kind: 1,
            integer_arg_count: 1,
            min_integer_arg: 2,
            max_integer_arg: 2,
            string_arg_count: 0,
            first_string_len: 0,
            first_string_hash: 0,
            instruction_offset: 0x5d9,
            arg_slots: {
                let mut slots = empty_arg_slots();
                slots[0] = crate::system_runtime::SystemServiceTraceArg {
                    kind: 6,
                    value: 0x0c34,
                    len: 0,
                    hash: 0,
                };
                slots[1] = crate::system_runtime::SystemServiceTraceArg {
                    kind: 1,
                    value: 2,
                    len: 0,
                    hash: 0,
                };
                slots
            },
            inline_strings: Vec::new(),
        };
        let trace = SystemServiceTrace {
            total_service_count: 4,
            recorded_services: vec![
                event(SystemCallFamily::Graph, 0x80, 1),
                repeated.clone(),
                SystemServiceTraceEvent {
                    event_index: 81,
                    ..repeated.clone()
                },
                SystemServiceTraceEvent {
                    event_index: 82,
                    service_id: 0xbc,
                    instruction_offset: 0x68f,
                    ..repeated
                },
            ],
        };
        let mut packet = vec![0xff; RUNTIME_GRAPH_QUEUE_PACKET_LEN];

        write_graph_queue_packet(&mut packet, 22, None, 4096, &trace);

        assert_eq!(read_u32(&packet, 24), 4);
        assert_eq!(read_u32(&packet, 40), 0x80);
        assert_eq!(read_u32(&packet, 40 + RUNTIME_GRAPH_EVENT_LEN), 0xbf);
        assert_eq!(read_u32(&packet, 32 + RUNTIME_GRAPH_EVENT_LEN), 80);
        assert_eq!(read_u32(&packet, 40 + 2 * RUNTIME_GRAPH_EVENT_LEN), 0xbf);
        assert_eq!(read_u32(&packet, 32 + 2 * RUNTIME_GRAPH_EVENT_LEN), 81);
        assert_eq!(read_u32(&packet, 40 + 3 * RUNTIME_GRAPH_EVENT_LEN), 0xbc);
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
