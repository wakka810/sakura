const SAFE_STATE_ELEMENT_ID = "sakura-runtime-safe-state";
const SAFE_STATE_VERSION = 1;
const SAFE_QUEUE_ARG_LIMIT = 256;

export function publishSafeRuntimeState(documentRef, state) {
  const document = documentRef ?? globalThis.document;
  if (!document) {
    return null;
  }
  const element = ensureSafeStateElement(document);
  const payload = buildSafeRuntimeState(state);
  element.textContent = JSON.stringify(payload);
  document.documentElement.dataset.runtimeSafeStateVersion = String(SAFE_STATE_VERSION);
  return payload;
}

export function readSafeRuntimeState(documentRef) {
  const document = documentRef ?? globalThis.document;
  const text = document?.getElementById(SAFE_STATE_ELEMENT_ID)?.textContent ?? "";
  if (text.length === 0) {
    return null;
  }
  return JSON.parse(text);
}

export function buildSafeRuntimeState(state) {
  return {
    version: SAFE_STATE_VERSION,
    mounted: state?.mounted === true,
    renderedLocalImage: state?.renderedLocalImage === true,
    audioReady: state?.audioReady === true,
    summary: safeNumberObject(state?.summary),
    player: safeNumberObject(state?.player),
    input: safeInputState(state?.input),
    audioMixer: safeNumberObject(state?.audioMixer),
    serviceTrace: safeTraceState(state?.serviceTrace),
    entryServiceTrace: safeTraceState(state?.entryServiceTrace),
    systemHost: safeNumberObject(state?.systemHost),
    graphRender: safeNumberObject(state?.graphRender),
    graphProbe: safeGraphProbeState(state?.graphProbe),
    runtimeSession: safeRuntimeSessionState(state?.runtimeSession),
    entrySoundQueue: safeQueueState(state?.entrySoundQueue),
    runtimeGraphQueue: safeQueueState(state?.runtimeGraphQueue),
    runtimeGraphHistoryQueue: safeQueueState(state?.runtimeGraphHistoryQueue),
    entryGraphQueue: safeQueueState(state?.entryGraphQueue),
  };
}

function ensureSafeStateElement(document) {
  let element = document.getElementById(SAFE_STATE_ELEMENT_ID);
  if (element !== null) {
    return element;
  }
  element = document.createElement("script");
  element.id = SAFE_STATE_ELEMENT_ID;
  element.type = "application/json";
  element.hidden = true;
  document.body.appendChild(element);
  return element;
}

function safeTraceState(trace) {
  return {
    ready: trace?.ready === true,
    total: finiteNumber(trace?.total),
    recorded: finiteNumber(trace?.recorded),
    events: safeEventList(trace?.events),
    hostState: safeNumberObject(trace?.hostState),
  };
}

function safeQueueState(queue) {
  return {
    ready: queue?.ready === true,
    totalServices: finiteNumber(queue?.totalServices),
    recordedServices: finiteNumber(queue?.recordedServices),
    recorded: finiteNumber(queue?.recorded),
    events: safeEventList(queue?.events),
  };
}

function safeEventList(events) {
  if (!Array.isArray(events)) {
    return [];
  }
  return events.map((event) => ({
    eventIndex: finiteNumber(event?.eventIndex),
    depth: finiteNumber(event?.depth),
    family: finiteNumber(event?.family),
    serviceId: finiteNumber(event?.serviceId),
    argCount: finiteNumber(event?.argCount),
    topKind: finiteNumber(event?.topKind),
    integerArgCount: finiteNumber(event?.integerArgCount),
    minIntegerArg: finiteNumber(event?.minIntegerArg),
    maxIntegerArg: finiteNumber(event?.maxIntegerArg),
    stringArgCount: finiteNumber(event?.stringArgCount),
    firstStringLength: finiteNumber(event?.firstStringLength),
    firstStringHash: finiteNumber(event?.firstStringHash),
    instructionOffset: finiteNumber(event?.instructionOffset),
    args: safeQueueArgs(event?.args),
    inlineStrings: safeInlineStrings(event?.inlineStrings),
    memorySamples: safeMemorySamples(event?.memorySamples),
  }));
}

function safeQueueArgs(args) {
  if (!Array.isArray(args)) {
    return [];
  }
  return args.slice(0, SAFE_QUEUE_ARG_LIMIT).map((arg) => ({
    kind: finiteNumber(arg?.kind),
    value: finiteNumber(arg?.value),
    len: finiteNumber(arg?.len),
    hash: finiteNumber(arg?.hash),
  }));
}

function safeInlineStrings(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.slice(0, 4).map((item) => ({
    argIndex: finiteNumber(item?.argIndex),
    byteLength: finiteNumber(item?.byteLength),
    fullLength: finiteNumber(item?.fullLength),
    hash: finiteNumber(item?.hash),
    text: typeof item?.text === "string" ? item.text : "",
  }));
}

function safeMemorySamples(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.slice(0, 8).map((item) => ({
    kind: typeof item?.kind === "string" ? item.kind : "",
    argIndex: finiteNumber(item?.argIndex),
    rawValue: finiteNumber(item?.rawValue),
    address: finiteNumber(item?.address),
    byteLength: finiteNumber(item?.byteLength),
    nonZeroCount: finiteNumber(item?.nonZeroCount),
    previewHex: typeof item?.previewHex === "string" ? item.previewHex : "",
    previewU32: Array.isArray(item?.previewU32)
      ? item.previewU32.slice(0, 8).map((value) => finiteNumber(value))
      : [],
    asciiHints: Array.isArray(item?.asciiHints)
      ? item.asciiHints.slice(0, 8).map((value) => String(value))
      : [],
  }));
}

function safeGraphProbeState(probe) {
  return {
    ready: probe?.ready === true,
    probeCount: finiteNumber(probe?.probeCount),
    probes: Array.isArray(probe?.probes)
      ? probe.probes.slice(0, 16).map((item) => ({
          type: typeof item?.type === "string" ? item.type : "",
          serviceId: finiteNumber(item?.serviceId),
          instructionOffset: finiteNumber(item?.instructionOffset),
          argIndex: finiteNumber(item?.argIndex),
          rawValue: finiteNumber(item?.rawValue),
          address: finiteNumber(item?.address),
          byteLength: finiteNumber(item?.byteLength),
          nonZeroCount: finiteNumber(item?.nonZeroCount),
          previewHex: typeof item?.previewHex === "string" ? item.previewHex : "",
          previewU32: Array.isArray(item?.previewU32)
            ? item.previewU32.slice(0, 8).map((value) => finiteNumber(value))
            : [],
          asciiHints: Array.isArray(item?.asciiHints)
            ? item.asciiHints.slice(0, 8).map((value) => String(value))
            : [],
        }))
      : [],
  };
}

function safeRuntimeSessionState(session) {
  return {
    ready: session?.ready === true,
    steps: finiteNumber(session?.steps),
    entryScriptName: typeof session?.entryScriptName === "string" ? session.entryScriptName : "",
    entryScriptIndex: finiteNumber(session?.entryScriptIndex),
    pendingAsset: session?.pendingAsset
      ? {
          serviceId: finiteNumber(session.pendingAsset.serviceId),
          size: finiteNumber(session.pendingAsset.size),
          nameLength: finiteNumber(session.pendingAsset.nameLength),
        }
      : null,
    serviceTrace: safeTraceState(session?.serviceTrace),
    last: safeNumberObject(session?.last),
    recent: Array.isArray(session?.recent)
      ? session.recent.slice(0, 8).map((item) => safeNumberObject(item))
      : [],
  };
}

function safeInputState(input) {
  return {
    clickCount: finiteNumber(input?.clickCount),
    keyPressCount: finiteNumber(input?.keyPressCount),
    lastPointer: input?.lastPointer
      ? {
          x: finiteNumber(input.lastPointer.x),
          y: finiteNumber(input.lastPointer.y),
          button: finiteNumber(input.lastPointer.button),
        }
      : null,
    keysDown: Array.isArray(input?.keysDown)
      ? input.keysDown.map((key) => String(key)).slice(0, 16)
      : [],
  };
}

function safeNumberObject(value) {
  const out = {};
  if (!value || typeof value !== "object") {
    return out;
  }
  for (const [key, item] of Object.entries(value)) {
    if (Number.isFinite(item)) {
      out[key] = item;
    } else if (typeof item === "boolean") {
      out[key] = item;
    }
  }
  return out;
}

function finiteNumber(value) {
  return Number.isFinite(value) ? value : 0;
}
