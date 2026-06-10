export function safeServiceTraceState(trace) {
  if (trace === null) {
    return { ready: false, total: 0, recorded: 0, events: [] };
  }
  return {
    ready: true,
    total: trace.totalServiceCount,
    recorded: trace.recordedCount,
    events: trace.events.map((event) => ({
      eventIndex: event.eventIndex,
      depth: event.depth,
      family: event.family,
      serviceId: event.serviceId,
      argCount: event.argCount,
      topKind: event.topKind,
      integerArgCount: event.integerArgCount,
      minIntegerArg: event.minIntegerArg,
      maxIntegerArg: event.maxIntegerArg,
      stringArgCount: event.stringArgCount,
      firstStringLength: event.firstStringLength,
      firstStringHash: event.firstStringHash,
      instructionOffset: event.instructionOffset,
    })),
    hostState: trace.hostState,
  };
}

export function countSoundTracePrefix(trace) {
  let count = 0;
  for (const event of trace?.events ?? []) {
    if (event.family !== 2) {
      break;
    }
    count += 1;
  }
  return count;
}
