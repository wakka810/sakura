import {
  buildSafeRuntimeState,
  publishSafeRuntimeState,
  readSafeRuntimeState,
} from "../web/runtime-state-export.js";

const document = createFakeDocument();
const payload = publishSafeRuntimeState(document, {
  mounted: true,
  renderedLocalImage: true,
  audioReady: true,
  summary: {
    localRuntimeAudioQueued: 42,
    unsafeText: "not exported",
  },
  player: {
    active: true,
    eventCount: 7,
    text: "not exported",
  },
  input: {
    clickCount: 1,
    keyPressCount: 2,
    lastPointer: { x: 12, y: 34, button: 0 },
    keysDown: ["Enter"],
  },
  graphRender: {
    applied: true,
    priorityCommandCount: 3,
    unsafeText: "not exported",
  },
  runtimeSession: {
    ready: true,
    steps: 4,
    entryScriptName: "scrmsg._bp",
    entryScriptIndex: 5,
    pendingAsset: {
      serviceId: 0x31,
      size: 4096,
      nameLength: 12,
      unsafeText: "not exported",
    },
    serviceTrace: {
      ready: true,
      total: 2,
      recorded: 1,
      events: [
        {
          eventIndex: 1,
          family: 0,
          serviceId: 0x40,
          argCount: 4,
          stringArgCount: 1,
          firstStringLength: 10,
          instructionOffset: 0x18,
          unsafeText: "not exported",
        },
      ],
      hostState: { serviceCount: 9, unsafeText: "not exported" },
    },
    last: {
      eventCount: 64,
      serviceEventCount: 64,
      sys1cCount: 6,
      local1076: 3,
      local1152: 5,
      unsafeText: "not exported",
    },
    recent: [
      {
        eventCount: 64,
        graphBfCount: 2,
        unsafeText: "not exported",
      },
    ],
  },
  runtimeGraphQueue: {
    ready: true,
    recorded: 1,
    events: [
      {
        eventIndex: 4,
        family: 1,
        serviceId: 0x85,
        argCount: 7,
        instructionOffset: 0x195,
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
    ],
  },
  runtimeGraphHistoryQueue: {
    ready: true,
    recorded: 2,
    events: [
      {
        eventIndex: 4,
        family: 1,
        serviceId: 0x85,
        argCount: 7,
        instructionOffset: 0x195,
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
        eventIndex: 5,
        family: 1,
        serviceId: 0x88,
        argCount: 7,
        instructionOffset: 0x1f0,
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
  entryGraphQueue: {
    ready: true,
    recorded: 1,
    events: [
      {
        eventIndex: 3,
        family: 1,
        serviceId: 0x9c,
        argCount: 2,
        instructionOffset: 0x12df,
        firstStringHash: 0x12345678,
        unsafeText: "not exported",
        args: [
          { kind: 1, value: 9, len: 0, hash: 0 },
          { kind: 2, value: 0, len: 12, hash: 0xfeed },
        ],
        memorySamples: [
          {
            kind: "window-memory-offset",
            argIndex: 6,
            rawValue: 0xf750,
            address: 0x1200f750,
            byteLength: 64,
            nonZeroCount: 12,
            previewHex: "01020304",
            previewU32: [1, 2, 3, 4],
            asciiHints: ["hello"],
            unsafeText: "not exported",
          },
        ],
      },
    ],
  },
});

const roundtrip = readSafeRuntimeState(document);
if (
  payload.version !== 1 ||
  roundtrip.runtimeGraphQueue.recorded !== 1 ||
  roundtrip.runtimeGraphQueue.events[0].serviceId !== 0x85 ||
  roundtrip.runtimeGraphHistoryQueue.recorded !== 2 ||
  roundtrip.runtimeGraphHistoryQueue.events[1].serviceId !== 0x88 ||
  roundtrip.entryGraphQueue.recorded !== 1 ||
  roundtrip.entryGraphQueue.events[0].family !== 1 ||
  roundtrip.entryGraphQueue.events[0].serviceId !== 0x9c ||
  roundtrip.entryGraphQueue.events[0].args[1].hash !== 0xfeed ||
  roundtrip.entryGraphQueue.events[0].memorySamples[0].address !== 0x1200f750 ||
  roundtrip.entryGraphQueue.events[0].memorySamples[0].previewU32[2] !== 3 ||
  roundtrip.graphRender.applied !== true ||
  roundtrip.graphRender.priorityCommandCount !== 3 ||
  roundtrip.runtimeSession.ready !== true ||
  roundtrip.runtimeSession.steps !== 4 ||
  roundtrip.runtimeSession.entryScriptName !== "scrmsg._bp" ||
  roundtrip.runtimeSession.entryScriptIndex !== 5 ||
  roundtrip.runtimeSession.pendingAsset.serviceId !== 0x31 ||
  roundtrip.runtimeSession.pendingAsset.size !== 4096 ||
  roundtrip.runtimeSession.serviceTrace.recorded !== 1 ||
  roundtrip.runtimeSession.serviceTrace.events[0].serviceId !== 0x40 ||
  roundtrip.runtimeSession.serviceTrace.hostState.serviceCount !== 9 ||
  roundtrip.runtimeSession.last.eventCount !== 64 ||
  roundtrip.runtimeSession.last.local1076 !== 3 ||
  roundtrip.runtimeSession.last.local1152 !== 5 ||
  roundtrip.runtimeSession.recent[0].graphBfCount !== 2 ||
  "unsafeText" in roundtrip.runtimeSession.last ||
  "unsafeText" in roundtrip.runtimeSession.serviceTrace.events[0] ||
  "unsafeText" in roundtrip.entryGraphQueue.events[0].memorySamples[0] ||
  "unsafeText" in roundtrip.graphRender ||
  roundtrip.summary.localRuntimeAudioQueued !== 42 ||
  "unsafeText" in roundtrip.summary ||
  "text" in roundtrip.player ||
  document.documentElement.dataset.runtimeSafeStateVersion !== "1"
) {
  throw new Error(`unexpected safe runtime export ${JSON.stringify(roundtrip)}`);
}

const empty = buildSafeRuntimeState(null);
if (empty.mounted || empty.entrySoundQueue.events.length !== 0) {
  throw new Error(`unexpected empty safe runtime export ${JSON.stringify(empty)}`);
}

console.log("runtime_state_export_smoke=ok");

function createFakeDocument() {
  const elements = new Map();
  const body = {
    appendChild(element) {
      elements.set(element.id, element);
    },
  };
  return {
    body,
    documentElement: { dataset: {} },
    createElement(tagName) {
      return {
        tagName,
        hidden: false,
        id: "",
        textContent: "",
        type: "",
      };
    },
    getElementById(id) {
      return elements.get(id) ?? null;
    },
  };
}
