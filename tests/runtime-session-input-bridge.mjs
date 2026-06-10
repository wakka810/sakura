import {
  __testOnlyMergeRuntimeQueueState,
  __testOnlyRuntimeSessionBootstrapReady,
  __testOnlyWarmMountedRuntimeSession,
  restartMountedRuntimeSession,
  stepMountedRuntimeSession,
} from "../web/install-runtime.js";

const calls = [];
const core = {
  runtimeSetInput(handle, input) {
    calls.push(["input", handle, input]);
    return 1;
  },
  runtimeSessionSoundQueue(handle) {
    calls.push(["sound", handle]);
    return { recordedCount: 1, events: [{ serviceId: 0x70, argCount: 1, instructionOffset: 0x10 }] };
  },
  runtimeSessionServiceTrace(handle) {
    calls.push(["trace", handle]);
    return {
      totalServiceCount: 1,
      recordedCount: 1,
      events: [{ family: 0, serviceId: 0x40, argCount: 4, stringArgCount: 1, firstStringLength: 10, instructionOffset: 0x18 }],
      hostState: {},
    };
  },
  runtimeSessionGraphQueue(handle) {
    calls.push(["graph", handle]);
    return {
      recordedCount: 1,
      events: [
        {
          serviceId: 0x85,
          argCount: 7,
          instructionOffset: 0x20,
          args: [
            { kind: 1, value: 1, len: 0, hash: 0 },
            { kind: 1, value: 0, len: 0, hash: 0 },
            { kind: 1, value: 0, len: 0, hash: 0 },
            { kind: 1, value: 1, len: 0, hash: 0 },
            { kind: 1, value: 256, len: 0, hash: 0 },
            { kind: 1, value: 0, len: 0, hash: 0 },
            { kind: 1, value: 0xf750, len: 0, hash: 0 },
          ],
        },
      ],
    };
  },
  runtimeSessionMemory(handle, address, length) {
    calls.push(["memory", handle, address, length]);
    if (address === 0x2000f750 || address === 0x2000fd00 || address === 0x20415750) {
      return new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd].slice(0, length));
    }
    if (address === 0x20447bd4) {
      return new Uint8Array([0xde, 0xad, 0xfa, 0xce].slice(0, length));
    }
    return new Uint8Array([0x12, 0x34, 0x56, 0x78].slice(0, length));
  },
  runtimeSessionStep(handle, maxEvents, maxInstructionsPerEvent) {
    calls.push(["step", handle, maxEvents, maxInstructionsPerEvent]);
    return { ok: true, eventCount: 1 };
  },
  runtimeSessionPendingAsset() {
    return null;
  },
  runtimeSessionSupplyAsset() {
    throw new Error("runtimeSessionSupplyAsset should not be called in this smoke test");
  },
};

const mounted = {
  destroyed: false,
  runtimeHandle: 17,
  runtimeSessionHandle: 23,
  audioOgg: new Uint8Array([0x4f, 0x67, 0x67, 0x53]),
  audioMixer: {
    prepare() {
      return true;
    },
    state() {
      return {
        ready: true,
        queued: 1,
        playAttempts: 0,
        playSuccess: 0,
        playBlocked: 0,
      };
    },
  },
  summary: {},
  safeState: {},
};

const hooks = {
  runtimeInput: () => ({
    clickCount: 3,
    keyPressCount: 5,
    pointerX: 7,
    pointerY: 11,
    pointerButton: 0,
    pointerValid: true,
    keyEnterDown: false,
    keySpaceDown: true,
    keyUpDown: false,
    keyDownDown: false,
    keyLeftDown: false,
    keyRightDown: false,
  }),
};

const packet = await stepMountedRuntimeSession(mounted, core, hooks, 9, 1234);
if (!packet?.ok) {
  throw new Error("runtime session step did not return packet");
}
if (
  calls[0][0] !== "input" ||
  calls[1][0] !== "step" ||
  calls[2][0] !== "trace" ||
  calls[3][0] !== "sound" ||
  calls[4][0] !== "graph"
) {
  throw new Error(`unexpected call order ${JSON.stringify(calls)}`);
}
if (
  calls[0][1] !== 17
  || calls[1][1] !== 23
  || calls[2][1] !== 23
  || calls[3][1] !== 23
  || calls[4][1] !== 23
) {
  throw new Error(`unexpected handles ${JSON.stringify(calls)}`);
}
if (calls[1][2] !== 9 || calls[1][3] !== 1234) {
  throw new Error(`unexpected step args ${JSON.stringify(calls)}`);
}
if (
  mounted.summary.localSystemRuntimeSessionTraceRecorded !== 1 ||
  mounted.safeState.runtimeSession.serviceTrace.events[0].serviceId !== 0x40 ||
  mounted.summary.localSystemRuntimeEntrySoundQueueRecorded !== 1 ||
  mounted.summary.localSystemRuntimeEntryGraphQueueRecorded !== 1 ||
  mounted.safeState.entrySoundQueue.events[0].serviceId !== 0x70 ||
  mounted.safeState.runtimeGraphQueue.events[0].serviceId !== 0x85 ||
  mounted.safeState.runtimeGraphHistoryQueue.events[0].serviceId !== 0x85 ||
  mounted.safeState.entryGraphQueue.events[0].serviceId !== 0x85 ||
  !mounted.safeState.runtimeGraphQueue.events[0].memorySamples.some((sample) => (
    sample.address === 0x1200f750 && sample.previewU32[0] === 0x78563412
  )) ||
  !mounted.safeState.runtimeGraphHistoryQueue.events[0].memorySamples.some((sample) => (
    sample.address === 0x1200f750 && sample.previewU32[0] === 0x78563412
  )) ||
  !mounted.safeState.entryGraphQueue.events[0].memorySamples.some((sample) => (
    sample.address === 0x1200f750 && sample.previewU32[0] === 0x78563412
  )) ||
  !mounted.safeState.entryGraphQueue.events[0].memorySamples.some((sample) => (
    sample.address === 0x2000f750 && sample.previewU32[0] === 0xddccbbaa
  )) ||
  !mounted.safeState.entryGraphQueue.events[0].memorySamples.some((sample) => (
    sample.address === 0x20415750 && sample.previewU32[0] === 0xddccbbaa
  ))
) {
  throw new Error(`unexpected queue update ${JSON.stringify(mounted)}`);
}

const memoryCalls = calls.filter((call) => call[0] === "memory");
if (
  !memoryCalls.some((call) => call[1] === 23 && call[2] === 0x1200f750 && call[3] === 64) ||
  !memoryCalls.some((call) => call[1] === 23 && call[2] === 0x2000f750 && call[3] === 64) ||
  !memoryCalls.some((call) => call[1] === 23 && call[2] === 0x20415750 && call[3] === 64)
) {
  throw new Error(`missing runtime graph memory probes ${JSON.stringify(calls)}`);
}

console.log("runtime_session_input_bridge_smoke=ok");

const mergedGraphQueue = __testOnlyMergeRuntimeQueueState(
  { ready: true, recorded: 0, events: [] },
  {
    ready: true,
    recorded: 70,
    events: [
      { eventIndex: 1, serviceId: 0x10, instructionOffset: 0x2d0, argCount: 2, args: [] },
      ...Array.from({ length: 69 }, (_, index) => ({
        eventIndex: index + 2,
        serviceId: 0x1f,
        instructionOffset: 0x400 + index,
        argCount: 0,
        args: [],
      })),
    ],
  },
);
if (
  mergedGraphQueue.events.length !== 70 ||
  !mergedGraphQueue.events.some((event) => (
    event.serviceId === 0x10 && event.instructionOffset === 0x2d0
  ))
) {
  throw new Error(`priority graph event was trimmed from merged queue ${JSON.stringify(mergedGraphQueue)}`);
}

console.log("runtime_session_graph_queue_priority_smoke=ok");

const mergedStringGraphQueue = __testOnlyMergeRuntimeQueueState(
  { ready: true, recorded: 0, events: [] },
  {
    ready: true,
    recorded: 1,
    events: [
      {
        eventIndex: 1,
        serviceId: 0x10,
        instructionOffset: 0xa29,
        argCount: 3,
        topKind: 2,
        integerArgCount: 1,
        minIntegerArg: 0xecf,
        maxIntegerArg: 0xecf,
        stringArgCount: 2,
        firstStringLength: 10,
        firstStringHash: 0xbed43bdb,
        args: [
          { kind: 1, value: 0xecf, len: 0, hash: 0 },
          { kind: 2, value: 0, len: 10, hash: 0xbed43bdb },
          { kind: 2, value: 0, len: 14, hash: 0xb219d22f },
        ],
        inlineStrings: [
          { argIndex: 1, byteLength: 10, fullLength: 10, hash: 0xd6f16ebb, text: "sysgrp.arc" },
          { argIndex: 2, byteLength: 14, fullLength: 14, hash: 0xb219d22f, text: "SGMsgWnd000000" },
        ],
      },
    ],
  },
);
const mergedStringGraphQueueNext = __testOnlyMergeRuntimeQueueState(
  mergedStringGraphQueue,
  {
    ready: true,
    recorded: 1,
    events: [
      {
        eventIndex: 1,
        serviceId: 0x10,
        instructionOffset: 0xa29,
        argCount: 3,
        topKind: 2,
        integerArgCount: 1,
        minIntegerArg: 0xecf,
        maxIntegerArg: 0xecf,
        stringArgCount: 2,
        firstStringLength: 10,
        firstStringHash: 0xbed43bdb,
        args: [
          { kind: 1, value: 0xecf, len: 0, hash: 0 },
          { kind: 2, value: 0, len: 10, hash: 0xbed43bdb },
          { kind: 2, value: 0, len: 14, hash: 0xd381d4e4 },
        ],
        inlineStrings: [
          { argIndex: 1, byteLength: 10, fullLength: 10, hash: 0xd6f16ebb, text: "sysgrp.arc" },
          { argIndex: 2, byteLength: 14, fullLength: 14, hash: 0xd381d4e4, text: "SGMsgWnd000100" },
        ],
      },
    ],
  },
);
if (
  mergedStringGraphQueueNext.events.length !== 2 ||
  !mergedStringGraphQueueNext.events.some((event) => (
    event.inlineStrings?.some((item) => item.text === "SGMsgWnd000000")
  )) ||
  !mergedStringGraphQueueNext.events.some((event) => (
    event.inlineStrings?.some((item) => item.text === "SGMsgWnd000100")
  ))
) {
  throw new Error(`string graph events were deduplicated incorrectly ${JSON.stringify(mergedStringGraphQueueNext)}`);
}

console.log("runtime_session_graph_queue_string_identity_smoke=ok");

const mergedMemoryGraphQueue = __testOnlyMergeRuntimeQueueState(
  {
    ready: true,
    recorded: 1,
    events: [
      {
        eventIndex: 1,
        serviceId: 0x65,
        instructionOffset: 0x87,
        argCount: 4,
        args: [
          { kind: 1, value: 0, len: 0, hash: 0 },
          { kind: 1, value: 0, len: 0, hash: 0 },
          { kind: 1, value: 0x100, len: 0, hash: 0 },
          { kind: 1, value: 0xfd00, len: 0, hash: 0 },
        ],
      },
    ],
  },
  {
    ready: true,
    recorded: 1,
    events: [
      {
        eventIndex: 1,
        serviceId: 0x65,
        instructionOffset: 0x87,
        argCount: 4,
        args: [
          { kind: 1, value: 0, len: 0, hash: 0 },
          { kind: 1, value: 0, len: 0, hash: 0 },
          { kind: 1, value: 0x100, len: 0, hash: 0 },
          { kind: 1, value: 0xfd00, len: 0, hash: 0 },
        ],
        memorySamples: [
          {
            kind: "source-layer-aux-offset",
            argIndex: 3,
            rawValue: 0xfd00,
            address: 0x2000fd00,
            byteLength: 4,
            nonZeroCount: 4,
            previewHex: "deadbeef",
            previewU32: [0xefbeadde],
            asciiHints: [],
          },
        ],
      },
    ],
  },
);
if (
  mergedMemoryGraphQueue.events.length !== 1 ||
  mergedMemoryGraphQueue.events[0].memorySamples?.[0]?.address !== 0x2000fd00
) {
  throw new Error(`graph queue did not upgrade duplicate event with memory samples ${JSON.stringify(mergedMemoryGraphQueue)}`);
}

console.log("runtime_session_graph_queue_memory_upgrade_smoke=ok");

const mergedBootstrapGraphQueue = __testOnlyMergeRuntimeQueueState(
  {
    ready: true,
    recorded: 2,
    events: [
      {
        eventIndex: 1,
        serviceId: 0x65,
        instructionOffset: 0x87,
        argCount: 4,
        args: [
          { kind: 1, value: 0, len: 0, hash: 0 },
          { kind: 1, value: 0, len: 0, hash: 0 },
          { kind: 1, value: 0x100, len: 0, hash: 0 },
          { kind: 1, value: 0xfd00, len: 0, hash: 0 },
        ],
      },
      {
        eventIndex: 2,
        serviceId: 0x80,
        instructionOffset: 0xc2,
        argCount: 4,
        args: [
          { kind: 1, value: 1280, len: 0, hash: 0 },
          { kind: 1, value: 206, len: 0, hash: 0 },
          { kind: 1, value: 1280, len: 0, hash: 0 },
          { kind: 1, value: 206, len: 0, hash: 0 },
        ],
      },
    ],
  },
  {
    ready: true,
    recorded: 2,
    events: [
      {
        eventIndex: 3,
        serviceId: 0x85,
        instructionOffset: 0x195,
        argCount: 7,
        args: [
          { kind: 1, value: 1, len: 0, hash: 0 },
          { kind: 1, value: 0, len: 0, hash: 0 },
          { kind: 1, value: 0, len: 0, hash: 0 },
          { kind: 1, value: 1, len: 0, hash: 0 },
          { kind: 1, value: 0x100, len: 0, hash: 0 },
          { kind: 1, value: 0, len: 0, hash: 0 },
          { kind: 1, value: 0xf750, len: 0, hash: 0 },
        ],
      },
      {
        eventIndex: 4,
        serviceId: 0x88,
        instructionOffset: 0x1f0,
        argCount: 7,
        args: [
          { kind: 1, value: 1, len: 0, hash: 0 },
          { kind: 1, value: 0, len: 0, hash: 0 },
          { kind: 1, value: 0, len: 0, hash: 0 },
          { kind: 1, value: 0, len: 0, hash: 0 },
          { kind: 1, value: 0, len: 0, hash: 0 },
          { kind: 1, value: 0, len: 0, hash: 0 },
          { kind: 1, value: 0, len: 0, hash: 0 },
        ],
      },
    ],
  },
);
if (
  mergedBootstrapGraphQueue.events.length !== 4
  || mergedBootstrapGraphQueue.events[0].serviceId !== 0x65
  || mergedBootstrapGraphQueue.events[1].serviceId !== 0x80
  || !mergedBootstrapGraphQueue.events.some((event) => (
    event.serviceId === 0x85 && event.instructionOffset === 0x195
  ))
) {
  throw new Error(`bootstrap graph context was not preserved ${JSON.stringify(mergedBootstrapGraphQueue)}`);
}

console.log("runtime_session_graph_queue_bootstrap_context_smoke=ok");

const bootstrapGraphCore = {
  runtimeSessionMemory(handle, address, length) {
    calls.push(["bootstrap-memory", handle, address, length]);
    if (address === 0x2000fd00) {
      return new Uint8Array([0xde, 0xad, 0xbe, 0xef].slice(0, length));
    }
    return new Uint8Array(length);
  },
};
const bootstrapMounted = {
  destroyed: false,
  runtimeHandle: 17,
  runtimeSessionHandle: 23,
  audioOgg: new Uint8Array([0x4f, 0x67, 0x67, 0x53]),
  audioMixer: mounted.audioMixer,
  summary: {},
  safeState: {
    runtimeSession: { ready: false, steps: 0, serviceTrace: { ready: false, total: 0, recorded: 0, events: [], hostState: {} }, recent: [], last: null, pendingAsset: null, entryScriptName: "", entryScriptIndex: 0 },
    entrySoundQueue: { ready: false, recorded: 0, events: [] },
    entryGraphQueue: { ready: false, recorded: 0, events: [] },
  },
};
const bootstrapHooks = {
  runtimeInput: () => null,
};
const bootstrapPacket = {
  ok: true,
  eventCount: 1,
  pendingAsset: null,
};
const bootstrapStepCore = {
  runtimeSetInput() { return 1; },
  runtimeSessionStep() { return bootstrapPacket; },
  runtimeSessionPendingAsset() { return null; },
  runtimeSessionSupplyAsset() { return 0; },
  runtimeSessionServiceTrace() { return null; },
  runtimeSessionSoundQueue() { return null; },
  runtimeSessionGraphQueue() {
    return {
      recordedCount: 1,
      events: [
        {
          serviceId: 0x65,
          argCount: 4,
          instructionOffset: 0x87,
          args: [
            { kind: 1, value: 0, len: 0, hash: 0 },
            { kind: 1, value: 0, len: 0, hash: 0 },
            { kind: 1, value: 0x100, len: 0, hash: 0 },
            { kind: 1, value: 0xfd00, len: 0, hash: 0 },
          ],
        },
      ],
    };
  },
  runtimeSessionMemory: bootstrapGraphCore.runtimeSessionMemory,
};
await stepMountedRuntimeSession(bootstrapMounted, bootstrapStepCore, bootstrapHooks, 1, 64);
if (
  bootstrapMounted.safeState.entryGraphQueue.events[0].memorySamples?.some((sample) => (
    sample.address === 0x2000fd00 && sample.previewU32[0] === 0xefbeadde
  )) !== true
) {
  throw new Error(`bootstrap graph queue memory samples missing aux probe ${JSON.stringify(bootstrapMounted.safeState.entryGraphQueue)}`);
}

console.log("runtime_session_graph_queue_bootstrap_memory_smoke=ok");

const titleGraphMounted = {
  destroyed: false,
  runtimeHandle: 17,
  runtimeSessionHandle: 31,
  audioOgg: new Uint8Array([0x4f, 0x67, 0x67, 0x53]),
  audioMixer: bootstrapMounted.audioMixer,
  summary: {},
  safeState: {
    runtimeSession: { ready: true, stepCount: 0, lastPacketOk: true, lastEventCount: 0 },
    runtimeGraphQueue: { ready: false, recorded: 0, events: [] },
    runtimeGraphHistoryQueue: { ready: false, recorded: 0, events: [] },
    entrySoundQueue: { ready: false, recorded: 0, events: [] },
    entryGraphQueue: { ready: false, recorded: 0, events: [] },
  },
};
const titleGraphCore = {
  runtimeSetInput() { return 1; },
  runtimeSessionStep() { return bootstrapPacket; },
  runtimeSessionPendingAsset() { return null; },
  runtimeSessionSupplyAsset() { return 0; },
  runtimeSessionServiceTrace() { return null; },
  runtimeSessionSoundQueue() { return null; },
  runtimeSessionGraphQueue() {
    return {
      recordedCount: 1,
      events: [
        {
          serviceId: 0x96,
          argCount: 1,
          instructionOffset: 0x1fce,
          args: [
            { kind: 1, value: 0x41bd4, len: 0, hash: 0 },
          ],
        },
      ],
    };
  },
  runtimeSessionMemory: core.runtimeSessionMemory,
};
await stepMountedRuntimeSession(titleGraphMounted, titleGraphCore, bootstrapHooks, 1, 64);
if (
  titleGraphMounted.safeState.runtimeGraphQueue.events[0].memorySamples?.some((sample) => (
    sample.address === 0x20447bd4 && sample.previewU32[0] === 0xcefaadde
  )) !== true ||
  titleGraphMounted.safeState.runtimeGraphHistoryQueue.events[0].memorySamples?.some((sample) => (
    sample.address === 0x20447bd4 && sample.previewU32[0] === 0xcefaadde
  )) !== true ||
  titleGraphMounted.safeState.entryGraphQueue.events[0].memorySamples?.some((sample) => (
    sample.address === 0x20447bd4 && sample.previewU32[0] === 0xcefaadde
  )) !== true
) {
  throw new Error(`title graph archive-slot probe missing ${JSON.stringify(titleGraphMounted.safeState.entryGraphQueue)}`);
}

console.log("runtime_session_graph_queue_title_archive_probe_smoke=ok");

const titleImageMounted = {
  destroyed: false,
  runtimeHandle: 17,
  runtimeSessionHandle: 41,
  audioOgg: new Uint8Array([0x4f, 0x67, 0x67, 0x53]),
  audioMixer: bootstrapMounted.audioMixer,
  summary: {},
  safeState: {
    runtimeSession: { ready: true, stepCount: 0, lastPacketOk: true, lastEventCount: 0 },
    runtimeGraphQueue: { ready: false, recorded: 0, events: [] },
    runtimeGraphHistoryQueue: { ready: false, recorded: 0, events: [] },
    entrySoundQueue: { ready: false, recorded: 0, events: [] },
    entryGraphQueue: { ready: false, recorded: 0, events: [] },
  },
};
const titleImageCore = {
  runtimeSetInput() { return 1; },
  runtimeSessionStep() { return bootstrapPacket; },
  runtimeSessionPendingAsset() { return null; },
  runtimeSessionSupplyAsset() { return 0; },
  runtimeSessionServiceTrace() { return null; },
  runtimeSessionSoundQueue() { return null; },
  runtimeSessionGraphQueue() {
    return {
      recordedCount: 1,
      events: [
        {
          family: 1,
          serviceId: 0x56,
          argCount: 7,
          instructionOffset: 0x385,
          args: [
            { kind: 1, value: 0, len: 0, hash: 0 },
            { kind: 1, value: 0, len: 0, hash: 0 },
            { kind: 1, value: 0, len: 0, hash: 0 },
            { kind: 1, value: 0x434, len: 0, hash: 0 },
            { kind: 1, value: 1, len: 0, hash: 0 },
            { kind: 1, value: 0, len: 0, hash: 0 },
            { kind: 1, value: 0xf730, len: 0, hash: 0 },
          ],
        },
      ],
    };
  },
  runtimeSessionMemory(handle, address, length) {
    if (address === 0x12000434) {
      return new Uint8Array([
        0x33, 0x02, 0x00, 0x10, 0xfa, 0x03, 0x00, 0x10,
        0x69, 0x05, 0x00, 0x10, 0x45, 0x06, 0x00, 0x10,
      ].slice(0, length));
    }
    return new Uint8Array(length);
  },
};
await stepMountedRuntimeSession(titleImageMounted, titleImageCore, bootstrapHooks, 1, 64);
if (
  titleImageMounted.safeState.runtimeGraphHistoryQueue.events[0].memorySamples?.some((sample) => (
    sample.kind === "local-offset"
    && sample.argIndex === 3
    && sample.address === 0x12000434
    && sample.previewU32[0] === 0x10000233
  )) !== true
) {
  throw new Error(`title graph image local-offset probe missing ${JSON.stringify(titleImageMounted.safeState.runtimeGraphHistoryQueue)}`);
}

console.log("runtime_session_graph_queue_title_image_local_probe_smoke=ok");

if (__testOnlyRuntimeSessionBootstrapReady({
  safeState: {
    entryGraphQueue: {
      ready: true,
      events: [{ serviceId: 0x85 }, { serviceId: 0x88 }],
    },
  },
}, 8) !== false) {
  throw new Error("bootstrap readiness should stay false for early title graph queue");
}

if (__testOnlyRuntimeSessionBootstrapReady({
  safeState: {
    entryGraphQueue: {
      ready: true,
      events: [{ serviceId: 0x85 }, { serviceId: 0x96 }],
    },
  },
}, 8) !== true) {
  throw new Error("bootstrap readiness should become true once late title graph services appear");
}

console.log("runtime_session_bootstrap_ready_smoke=ok");

const warmCalls = [];
let warmGraphStep = 0;
const warmMounted = {
  destroyed: false,
  runtimeHandle: 17,
  runtimeSessionHandle: 41,
  runtimeSessionEntryScriptIndex: 5,
  runtimeSessionEntryOffset: null,
  runtimeSessionEntryName: "scrdrv._bp",
  audioOgg: new Uint8Array([0x4f, 0x67, 0x67, 0x53]),
  audioMixer: bootstrapMounted.audioMixer,
  runtimeSessionPaused: false,
  summary: {},
  safeState: {
    systemHost: {},
    runtimeSession: {
      ready: false,
      steps: 0,
      entryScriptName: "",
      entryScriptIndex: 0,
      pendingAsset: null,
      serviceTrace: { ready: false, total: 0, recorded: 0, events: [], hostState: {} },
      last: null,
      recent: [],
    },
    entrySoundQueue: { ready: false, recorded: 0, events: [] },
    runtimeGraphHistoryQueue: { ready: false, recorded: 0, events: [] },
    entryGraphQueue: { ready: false, recorded: 0, events: [] },
  },
};
const warmHooks = {
  runtimeInput: () => null,
  paint() {
    warmCalls.push(["paint"]);
  },
  onRuntime() {
    warmCalls.push(["runtime"]);
  },
};
const warmCore = {
  runtimeSetInput() { return 1; },
  runtimeSessionStep(handle, maxEvents, maxInstructionsPerEvent) {
    warmCalls.push(["step", handle, maxEvents, maxInstructionsPerEvent]);
    return {
      ok: true,
      eventCount: 1,
      completed: false,
      pendingAsset: null,
      frameScriptIndex: 5,
    };
  },
  runtimeSessionPendingAsset() { return null; },
  runtimeSessionSupplyAsset() { return 0; },
  runtimeSessionServiceTrace(handle) {
    warmCalls.push(["trace", handle]);
    return null;
  },
  runtimeSessionSoundQueue(handle) {
    warmCalls.push(["sound", handle]);
    return null;
  },
  runtimeSessionGraphQueue(handle) {
    warmCalls.push(["graph", handle]);
    warmGraphStep += 1;
    return {
      recordedCount: warmGraphStep,
      events: warmGraphStep < 3
        ? [
          {
            serviceId: 0x85,
            argCount: 7,
            instructionOffset: 0x100 + warmGraphStep,
            args: [
              { kind: 1, value: 1, len: 0, hash: 0 },
              { kind: 1, value: 0, len: 0, hash: 0 },
              { kind: 1, value: 0, len: 0, hash: 0 },
              { kind: 1, value: 1, len: 0, hash: 0 },
              { kind: 1, value: 0x100, len: 0, hash: 0 },
              { kind: 1, value: 0, len: 0, hash: 0 },
              { kind: 1, value: 0xf750, len: 0, hash: 0 },
            ],
          },
        ]
        : [
          {
            serviceId: 0x85,
            argCount: 7,
            instructionOffset: 0x100 + warmGraphStep,
            args: [
              { kind: 1, value: 1, len: 0, hash: 0 },
              { kind: 1, value: 0, len: 0, hash: 0 },
              { kind: 1, value: 0, len: 0, hash: 0 },
              { kind: 1, value: 1, len: 0, hash: 0 },
              { kind: 1, value: 0x100, len: 0, hash: 0 },
              { kind: 1, value: 0, len: 0, hash: 0 },
              { kind: 1, value: 0xf750, len: 0, hash: 0 },
            ],
          },
          {
            serviceId: 0x96,
            argCount: 1,
            instructionOffset: 0x1fce,
            args: [{ kind: 1, value: 0x41bd4, len: 0, hash: 0 }],
          },
        ],
    };
  },
  runtimeSessionMemory: core.runtimeSessionMemory,
};
const warmedPacket = await __testOnlyWarmMountedRuntimeSession(warmMounted, warmCore, warmHooks);
if (
  warmedPacket?.ok !== true ||
  warmMounted.safeState.runtimeSession.steps !== 3 ||
  warmGraphStep !== 3 ||
  warmMounted.safeState.runtimeGraphHistoryQueue.events.some((event) => event.serviceId === 0x96) !== true ||
  warmMounted.safeState.entryGraphQueue.events.some((event) => event.serviceId === 0x96) !== true ||
  warmCalls.filter((call) => call[0] === "step").length !== 3
) {
  throw new Error(`warm bootstrap did not continue until late graph service ${JSON.stringify({ warmCalls, warmGraphStep, warmMounted })}`);
}

console.log("runtime_session_warm_bootstrap_smoke=ok");

const memoryProbe = core.runtimeSessionMemory(23, 0x20406000, 4);
if (
  calls.at(-1)?.[0] !== "memory" ||
  calls.at(-1)?.[1] !== 23 ||
  calls.at(-1)?.[2] !== 0x20406000 ||
  calls.at(-1)?.[3] !== 4 ||
  memoryProbe[0] !== 0x12 ||
  memoryProbe[3] !== 0x78
) {
  throw new Error(`unexpected runtime session memory probe ${JSON.stringify(calls)} ${JSON.stringify(Array.from(memoryProbe ?? []))}`);
}

console.log("runtime_session_memory_probe_smoke=ok");

const restartCalls = [];
const restartCore = {
  runtimeSessionDestroy(handle) {
    restartCalls.push(["destroy", handle]);
    return 1;
  },
  runtimeSessionCreate(runtimeHandle, scriptIndex, offset) {
    restartCalls.push(["create", runtimeHandle, scriptIndex, offset]);
    return 77;
  },
};
const restartMounted = {
  destroyed: false,
  runtimeHandle: 17,
  runtimeSessionHandle: 23,
  runtimeSessionEntryScriptIndex: 5,
  runtimeSessionEntryOffset: null,
  safeState: { runtimeSession: { ready: true, steps: 9, last: { completed: true }, recent: [] } },
};
if (restartMountedRuntimeSession(restartMounted, restartCore) !== true) {
  throw new Error("runtime session restart should succeed");
}
if (
  JSON.stringify(restartCalls) !== JSON.stringify([
    ["destroy", 23],
    ["create", 17, 5, null],
  ])
) {
  throw new Error(`unexpected restart calls ${JSON.stringify(restartCalls)}`);
}
if (
  restartMounted.runtimeSessionHandle !== 77 ||
  restartMounted.safeState.runtimeSession.ready !== false ||
  restartMounted.safeState.runtimeSession.steps !== 0
) {
  throw new Error(`unexpected restart state ${JSON.stringify(restartMounted)}`);
}

console.log("runtime_session_restart_smoke=ok");
