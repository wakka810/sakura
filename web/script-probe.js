const PAYLOAD_KIND_DSC = 1;
const TRACE_KIND_LABELS = [
  "empty",
  "integer",
  "string",
  "code",
  "handle",
  "user_result",
  "pointer",
  "unknown",
];

export async function probeLocalScripts(catalog, core) {
  const summary = {
    localDscSummarized: 0,
    localDscInvalid: 0,
    localScenarioScripts: 0,
    localSystemScripts: 0,
    localScenarioEventMessages: 0,
    localScenarioEventChoices: 0,
    localScenarioVmFirstEvents: 0,
    localScenarioVmFirstInvalid: 0,
    localScenarioVmFirstEventKinds: Array(5).fill(0),
    localScenarioSessionProbes: 0,
    localScenarioSessionInvalid: 0,
    localScenarioSessionEventKinds: Array(5).fill(0),
    localScenarioSessionModes: Array(5).fill(0),
    localScenarioSessionBacklogEntries: 0,
    localScenarioSessionRestoreMatches: 0,
    localSystemUserScriptCalls: 0,
    localSystemUserScriptDispatches: 0,
    localSystemGraphcalls: 0,
    localSystemSoundcalls: 0,
    localSystemUserScriptDispatchTop: "",
    localSystemTraceDispatchArgBuckets: Array(8).fill(0),
    localSystemTraceDispatchFfTopKind: Array(8).fill(0),
    localSystemTraceDispatch00TopKind: Array(8).fill(0),
    localSystemTraceExtFfTopKind: Array(8).fill(0),
    localSystemTraceExtFfArgBuckets: Array(8).fill(0),
    localSystemTraceSound00TopKind: Array(8).fill(0),
    localSystemTraceSound00ArgBuckets: Array(8).fill(0),
    localSystemTraceGraph68TopKind: Array(8).fill(0),
    localSystemTraceGraph68ArgBuckets: Array(8).fill(0),
    localSystemVmFirstEvents: 0,
    localSystemVmFirstInvalid: 0,
    localSystemVmFirstEventKinds: Array(7).fill(0),
    localSystemVmDefaultHostEvents: 0,
    localSystemVmDefaultHostInvalid: 0,
    localSystemVmDefaultHostCompleted: 0,
    localSystemVmDefaultHostEventLimited: 0,
    localSystemVmDefaultHostLastEventKinds: Array(7).fill(0),
  };
  const dispatchCounts = Array(256).fill(0);

  for (const record of catalog.recordsByKind(PAYLOAD_KIND_DSC)) {
    if (record.kind !== PAYLOAD_KIND_DSC) {
      if (record.kind !== null) {
        continue;
      }
      const prefix = await catalog.readPrefix(record, 16);
      if (core.payloadKind(prefix) !== PAYLOAD_KIND_DSC) {
        continue;
      }
    }
    const payload = await catalog.readPayload(record);
    const script = core.dscScriptSummary(payload);
    if (script === null) {
      summary.localDscInvalid += 1;
      continue;
    }
    summary.localDscSummarized += 1;
    if (script.kind === 1) {
      summary.localScenarioScripts += 1;
      summary.localScenarioEventMessages += script.scenarioEventMessages;
      summary.localScenarioEventChoices += script.scenarioEventChoices;
      const firstEvent = core.dscScenarioFirstEvent(payload);
      if (firstEvent === null) {
        summary.localScenarioVmFirstInvalid += 1;
      } else {
        summary.localScenarioVmFirstEvents += 1;
        summary.localScenarioVmFirstEventKinds[firstEvent.eventKind] =
          (summary.localScenarioVmFirstEventKinds[firstEvent.eventKind] ?? 0) + 1;
      }
      const sessionProbe = core.dscScenarioSessionProbe(payload);
      if (sessionProbe === null) {
        summary.localScenarioSessionInvalid += 1;
      } else {
        summary.localScenarioSessionProbes += 1;
        summary.localScenarioSessionEventKinds[sessionProbe.eventKind] =
          (summary.localScenarioSessionEventKinds[sessionProbe.eventKind] ?? 0) + 1;
        summary.localScenarioSessionModes[sessionProbe.mode] =
          (summary.localScenarioSessionModes[sessionProbe.mode] ?? 0) + 1;
        summary.localScenarioSessionBacklogEntries += sessionProbe.backlogEntries;
        if (
          sessionProbe.snapshotMode === sessionProbe.restoredMode &&
          sessionProbe.snapshotEventCount === sessionProbe.restoredEventCount
        ) {
          summary.localScenarioSessionRestoreMatches += 1;
        }
      }
    } else if (script.kind === 2) {
      summary.localSystemScripts += 1;
      summary.localSystemUserScriptCalls += script.systemUserScriptCalls;
      summary.localSystemUserScriptDispatches += script.systemUserScriptDispatches;
      summary.localSystemGraphcalls += script.systemGraphcalls;
      summary.localSystemSoundcalls += script.systemSoundcalls;
      addCounts(dispatchCounts, script.systemUserScriptDispatchCounts);
      const trace = core.dscSystemTrace(payload);
      if (trace !== null) {
        addCounts(summary.localSystemTraceDispatchArgBuckets, trace.dispatchArgBuckets);
        addCounts(summary.localSystemTraceDispatchFfTopKind, trace.dispatchFfTopKind);
        addCounts(summary.localSystemTraceDispatch00TopKind, trace.dispatch00TopKind);
        addCounts(summary.localSystemTraceExtFfTopKind, trace.extFfTopKind);
        addCounts(summary.localSystemTraceExtFfArgBuckets, trace.extFfArgBuckets);
        addCounts(summary.localSystemTraceSound00TopKind, trace.sound00TopKind);
        addCounts(summary.localSystemTraceSound00ArgBuckets, trace.sound00ArgBuckets);
        addCounts(summary.localSystemTraceGraph68TopKind, trace.graph68TopKind);
        addCounts(summary.localSystemTraceGraph68ArgBuckets, trace.graph68ArgBuckets);
      }
      const firstEvent = core.dscSystemVmFirstEvent(payload);
      if (firstEvent === null) {
        summary.localSystemVmFirstInvalid += 1;
      } else {
        summary.localSystemVmFirstEvents += 1;
        summary.localSystemVmFirstEventKinds[firstEvent.eventKind] =
          (summary.localSystemVmFirstEventKinds[firstEvent.eventKind] ?? 0) + 1;
      }
      const hostRun = core.dscSystemVmDefaultHost(payload);
      if (hostRun === null) {
        summary.localSystemVmDefaultHostInvalid += 1;
      } else {
        summary.localSystemVmDefaultHostEvents += hostRun.eventCount;
        summary.localSystemVmDefaultHostCompleted += hostRun.completed;
        summary.localSystemVmDefaultHostEventLimited += hostRun.eventLimited;
        summary.localSystemVmDefaultHostLastEventKinds[hostRun.lastEventKind] =
          (summary.localSystemVmDefaultHostLastEventKinds[hostRun.lastEventKind] ?? 0) + 1;
      }
    } else {
      summary.localDscInvalid += 1;
    }
  }

  summary.localSystemUserScriptDispatchTop = formatTopCounts(dispatchCounts, 12);
  summary.localScenarioVmFirstEventKindText = formatScenarioEventKindCounts(
    summary.localScenarioVmFirstEventKinds,
  );
  summary.localScenarioSessionEventKindText = formatScenarioEventKindCounts(
    summary.localScenarioSessionEventKinds,
  );
  summary.localScenarioSessionModeText = formatSessionModeCounts(
    summary.localScenarioSessionModes,
  );
  summary.localSystemTraceDispatchArgBucketText = formatBucketCounts(
    summary.localSystemTraceDispatchArgBuckets,
  );
  summary.localSystemTraceDispatchFfTopKindText = formatKindCounts(
    summary.localSystemTraceDispatchFfTopKind,
  );
  summary.localSystemTraceDispatch00TopKindText = formatKindCounts(
    summary.localSystemTraceDispatch00TopKind,
  );
  summary.localSystemTraceExtFfTopKindText = formatKindCounts(
    summary.localSystemTraceExtFfTopKind,
  );
  summary.localSystemTraceExtFfArgBucketText = formatBucketCounts(
    summary.localSystemTraceExtFfArgBuckets,
  );
  summary.localSystemTraceSound00TopKindText = formatKindCounts(
    summary.localSystemTraceSound00TopKind,
  );
  summary.localSystemTraceSound00ArgBucketText = formatBucketCounts(
    summary.localSystemTraceSound00ArgBuckets,
  );
  summary.localSystemTraceGraph68TopKindText = formatKindCounts(
    summary.localSystemTraceGraph68TopKind,
  );
  summary.localSystemTraceGraph68ArgBucketText = formatBucketCounts(
    summary.localSystemTraceGraph68ArgBuckets,
  );
  summary.localSystemVmFirstEventKindText = formatEventKindCounts(
    summary.localSystemVmFirstEventKinds,
  );
  summary.localSystemVmDefaultHostLastEventKindText = formatEventKindCounts(
    summary.localSystemVmDefaultHostLastEventKinds,
  );
  return summary;
}

export function parseScriptSummaryPacket(packet) {
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  if (view.getUint32(0, true) !== 1) {
    throw new Error("invalid script summary packet version");
  }
  const systemUserScriptDispatchCounts = [];
  for (let id = 0; id < 256; id += 1) {
    systemUserScriptDispatchCounts.push(view.getUint32(88 + id * 4, true));
  }
  return {
    kind: view.getUint32(4, true),
    decompressedLength: view.getUint32(8, true),
    instructionCount: view.getUint32(12, true),
    scenarioMessages: view.getUint32(16, true),
    scenarioCharacterNames: view.getUint32(20, true),
    scenarioChoices: view.getUint32(24, true),
    scenarioUserFunctions: view.getUint32(28, true),
    scenarioEventMessages: view.getUint32(32, true),
    scenarioEventChoices: view.getUint32(36, true),
    systemSyscalls: view.getUint32(40, true),
    systemGraphcalls: view.getUint32(44, true),
    systemSoundcalls: view.getUint32(48, true),
    systemExtcalls: view.getUint32(52, true),
    systemUserScriptCalls: view.getUint32(56, true),
    systemConditionalJumps: view.getUint32(60, true),
    systemInvalidBlocks: view.getUint32(64, true),
    systemStringOperands: view.getUint32(68, true),
    systemUserScriptLoads: view.getUint32(72, true),
    systemUserScriptFrees: view.getUint32(76, true),
    systemUserScriptReturns: view.getUint32(80, true),
    systemUserScriptDispatches: view.getUint32(84, true),
    systemUserScriptDispatchCounts,
  };
}

export function parseScenarioFirstEventPacket(packet) {
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  if (view.getUint32(0, true) !== 1) {
    throw new Error("invalid scenario VM event packet");
  }
  return {
    eventKind: view.getUint32(4, true),
    opcode: view.getUint32(8, true),
    offset: view.getUint32(12, true),
    nameLength: view.getUint32(16, true),
    textLength: view.getUint32(20, true),
    optionCount: view.getUint32(24, true),
    stringArgCount: view.getUint32(28, true),
  };
}

export function parseScenarioSessionProbePacket(packet) {
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  if (view.getUint32(0, true) !== 1) {
    throw new Error("invalid scenario session probe packet");
  }
  return {
    eventKind: view.getUint32(4, true),
    mode: view.getUint32(8, true),
    eventCount: view.getUint32(12, true),
    backlogEntries: view.getUint32(16, true),
    choiceOptionCount: view.getUint32(20, true),
    snapshotMode: view.getUint32(24, true),
    snapshotEventCount: view.getUint32(28, true),
    restoredMode: view.getUint32(32, true),
    restoredEventCount: view.getUint32(36, true),
  };
}

export function parseSystemTracePacket(packet) {
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  if (view.getUint32(0, true) !== 1 || view.getUint32(4, true) !== 2) {
    throw new Error("invalid system trace packet");
  }
  return {
    instructionCount: view.getUint32(8, true),
    serviceCallCount: view.getUint32(12, true),
    userScriptDispatchCount: view.getUint32(16, true),
    maxStackDepth: view.getUint32(20, true),
    dispatchArgBuckets: readCounts(view, 24),
    dispatchFfTopKind: readCounts(view, 56),
    dispatch00TopKind: readCounts(view, 88),
    extFfTopKind: readCounts(view, 120),
    extFfArgBuckets: readCounts(view, 152),
    sound00TopKind: readCounts(view, 184),
    sound00ArgBuckets: readCounts(view, 216),
    graph68TopKind: readCounts(view, 248),
    graph68ArgBuckets: readCounts(view, 280),
  };
}

export function parseSystemVmFirstEventPacket(packet) {
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  if (view.getUint32(0, true) !== 1) {
    throw new Error("invalid system VM event packet");
  }
  return {
    eventKind: view.getUint32(4, true),
    family: view.getUint32(8, true),
    serviceId: view.getUint32(12, true),
    argCount: view.getUint32(16, true),
    topKind: view.getUint32(20, true),
    argKinds: readCounts(view, 24),
  };
}

export function parseSystemVmDefaultHostPacket(packet) {
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  if (view.getUint32(0, true) !== 1) {
    throw new Error("invalid system VM default-host packet");
  }
  return {
    eventCount: view.getUint32(4, true),
    serviceEventCount: view.getUint32(8, true),
    userCallEventCount: view.getUint32(12, true),
    userLoadEventCount: view.getUint32(16, true),
    userFreeEventCount: view.getUint32(20, true),
    userReturnEventCount: view.getUint32(24, true),
    haltedEventCount: view.getUint32(28, true),
    completed: view.getUint32(32, true),
    eventLimited: view.getUint32(36, true),
    lastEventKind: view.getUint32(40, true),
  };
}

function addCounts(target, source) {
  for (let index = 0; index < target.length; index += 1) {
    target[index] += source[index] ?? 0;
  }
}

function readCounts(view, offset) {
  const counts = [];
  for (let index = 0; index < 8; index += 1) {
    counts.push(view.getUint32(offset + index * 4, true));
  }
  return counts;
}

function formatBucketCounts(counts) {
  return counts.map((count, bucket) => `${bucket}:${count}`).join(",");
}

function formatKindCounts(counts) {
  return counts
    .map((count, kind) => ({ kind, count }))
    .filter(({ count }) => count > 0)
    .sort((left, right) => right.count - left.count || left.kind - right.kind)
    .map(({ kind, count }) => `${TRACE_KIND_LABELS[kind] ?? "invalid"}:${count}`)
    .join(",");
}

function formatScenarioEventKindCounts(counts) {
  const labels = ["none", "message", "choice", "user_function", "halted"];
  return counts
    .map((count, kind) => ({ kind, count }))
    .filter(({ count }) => count > 0)
    .sort((left, right) => right.count - left.count || left.kind - right.kind)
    .map(({ kind, count }) => `${labels[kind] ?? "invalid"}:${count}`)
    .join(",");
}

function formatSessionModeCounts(counts) {
  const labels = ["none", "running", "waiting_message", "waiting_choice", "halted"];
  return counts
    .map((count, kind) => ({ kind, count }))
    .filter(({ count }) => count > 0)
    .sort((left, right) => right.count - left.count || left.kind - right.kind)
    .map(({ kind, count }) => `${labels[kind] ?? "invalid"}:${count}`)
    .join(",");
}

function formatEventKindCounts(counts) {
  const labels = ["none", "service", "user_call", "user_load", "user_free", "user_return", "halted"];
  return counts
    .map((count, kind) => ({ kind, count }))
    .filter(({ count }) => count > 0)
    .map(({ kind, count }) => `${labels[kind] ?? "invalid"}:${count}`)
    .join(",");
}

function formatTopCounts(counts, limit) {
  return counts
    .map((count, id) => ({ id, count }))
    .filter(({ count }) => count > 0)
    .sort((left, right) => right.count - left.count || left.id - right.id)
    .slice(0, limit)
    .map(({ id, count }) => `${id.toString(16).padStart(2, "0")}:${count}`)
    .join(",");
}
