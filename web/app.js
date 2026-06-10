import { createInputController } from "./input.js";
import { createCore, loadCore } from "./core-wasm.js";
import {
  mountLocalInstall,
  mountServerInstall,
  syncMountedAudioState,
} from "./install-runtime.js";
import { formatInstallSummary } from "./install-summary.js";
import { bindScenarioPlayerInput, paintScenarioEvent } from "./session-player.js";
import { renderGraphQueue, summarizeGraphQueue } from "./graph-renderer.js";
import { publishSafeRuntimeState } from "./runtime-state-export.js";
import { safeInstallSummary } from "./safe-summary.js";

const statusEl = document.querySelector("#core-status");
const outputEl = document.querySelector("#probe-output");
const openButton = document.querySelector("#open-install");
const saveButton = document.querySelector("#save-session");
const loadButton = document.querySelector("#load-session");
const playAudioButton = document.querySelector("#play-audio");
const installFilesInput = document.querySelector("#install-files");
const canvas = document.querySelector("#stage");
const context = canvas.getContext("2d", { alpha: false });
const SUMMARY_RENDER_INTERVAL_MS = 250;
const RUNTIME_DOM_PUBLISH_INTERVAL_MS = 250;
let installProbeTimer = 0;
let installProbeSerial = 0;
let activeInstall = null;
let stageNonBlackSampleCount = 0;
let lastSummaryRenderAt = 0;
let pendingSummary = null;
let summaryRenderTimer = 0;
let lastRuntimeDomPublishAt = 0;
let pendingRuntimeDomState = null;
let runtimeDomPublishTimer = 0;
const input = createInputController(canvas, {
  keyboardTarget: window,
  onChange: publishRuntimeState,
});

function isCurrentInstall(mounted) {
  return mounted !== null
    && mounted !== undefined
    && mounted.destroyed !== true
    && activeInstall === mounted;
}

function exposeActiveInstallDebug() {
  globalThis.__sakuraActiveInstall = activeInstall;
  if (globalThis.window) {
    window.__sakuraActiveInstall = activeInstall;
  }
}

function bindRuntimeSessionControls() {
  const pause = () => activeInstall?.pauseRuntimeSession?.() ?? null;
  const resume = () => activeInstall?.resumeRuntimeSession?.() ?? null;
  const step = async (maxEvents = 1, maxInstructionsPerEvent = 100000) => (
    await (activeInstall?.stepRuntimeSession?.(maxEvents, maxInstructionsPerEvent) ?? null)
  );
  const readMemory = (address, length) => {
    if (
      !activeInstall
      || activeInstall.destroyed === true
      || activeInstall.runtimeSessionHandle === 0
    ) {
      return null;
    }
    return core.runtimeSessionMemory(
      activeInstall.runtimeSessionHandle,
      address >>> 0,
      length >>> 0,
    );
  };
  globalThis.sakuraPauseRuntimeSession = pause;
  globalThis.__sakuraPauseRuntimeSession = pause;
  globalThis.sakuraResumeRuntimeSession = resume;
  globalThis.__sakuraResumeRuntimeSession = resume;
  globalThis.sakuraStepRuntimeSession = step;
  globalThis.__sakuraStepRuntimeSession = step;
  globalThis.sakuraRuntimeSessionMemory = readMemory;
  globalThis.__sakuraRuntimeSessionMemory = readMemory;
  if (globalThis.window) {
    window.sakuraPauseRuntimeSession = pause;
    window.__sakuraPauseRuntimeSession = pause;
    window.sakuraResumeRuntimeSession = resume;
    window.__sakuraResumeRuntimeSession = resume;
    window.sakuraStepRuntimeSession = step;
    window.__sakuraStepRuntimeSession = step;
    window.sakuraRuntimeSessionMemory = readMemory;
    window.__sakuraRuntimeSessionMemory = readMemory;
  }
}

const wasm = await loadCore();
const core = createCore(wasm.instance.exports);
statusEl.textContent = `ABI ${core.version()}`;
paintBootFrame(core);
bindRuntimeSessionControls();
publishRuntimeState(true);
void bootServerInstall();

openButton.addEventListener("click", () => {
  installFilesInput.click();
});

saveButton.addEventListener("click", () => {
  const result = activeInstall?.player?.saveToStorage();
  if (result?.ok) {
    activeInstall.summary.localRuntimeScenarioSessionSaveBytes = result.bytes;
  }
  if (activeInstall) {
    renderInstallSummaryText(activeInstall.summary, true);
  }
  publishRuntimeState(true);
});

loadButton.addEventListener("click", () => {
  const result = activeInstall?.player?.loadFromStorage();
  if (result?.ok) {
    activeInstall.summary.localRuntimeScenarioSessionLoadBytes = result.bytes;
    paintMountedFrame(activeInstall);
  }
  if (activeInstall) {
    renderInstallSummaryText(activeInstall.summary, true);
  }
  publishRuntimeState(true);
});

playAudioButton.addEventListener("click", () => {
  void playQueuedAudio();
});

installFilesInput.addEventListener("input", scheduleInstallProbe); installFilesInput.addEventListener("change", scheduleInstallProbe);
bindScenarioPlayerInput(canvas, () => activeInstall, () => {
  paintMountedFrame(activeInstall);
  publishRuntimeState(true);
});

function scheduleInstallProbe() {
  if (installProbeTimer !== 0) {
    window.clearTimeout(installProbeTimer);
  }
  installProbeTimer = window.setTimeout(() => {
    installProbeTimer = 0;
    void probeSelectedInstallFiles();
  }, 0);
}

async function probeSelectedInstallFiles() {
  const files = Array.from(installFilesInput.files ?? []);
  if (files.length === 0) {
    return;
  }
  const serial = ++installProbeSerial;
  const mounted = await mountLocalInstall(files, core, createInstallHooks());
  if (serial === installProbeSerial) {
    activeInstall?.destroy?.();
    activeInstall = mounted;
    exposeActiveInstallDebug();
    bindRuntimeSessionControls();
    paintMountedFrame(activeInstall);
    publishRuntimeState(true);
    renderInstallSummaryText(mounted.summary, true);
  } else {
    mounted.destroy?.();
  }
}

function publishRuntimeState(force = false) {
  const summary = safeInstallSummary(activeInstall?.summary);
  const state = {
    ...(activeInstall?.safeState ?? { mounted: false }),
    summary,
    player: activeInstall?.player?.safeState ?? { active: false },
    input: input.snapshot(),
    entrySoundQueue: activeInstall?.safeState?.entrySoundQueue ?? {
      ready: false,
      recorded: 0,
      events: [],
    },
    runtimeGraphQueue: activeInstall?.safeState?.runtimeGraphQueue ?? {
      ready: false,
      recorded: 0,
      events: [],
    },
    runtimeGraphHistoryQueue: activeInstall?.safeState?.runtimeGraphHistoryQueue ?? {
      ready: false,
      recorded: 0,
      events: [],
    },
    entryGraphQueue: activeInstall?.safeState?.entryGraphQueue ?? {
      ready: false,
      recorded: 0,
      events: [],
    },
  };
  const graphRender = summarizeGraphQueue(state.runtimeGraphHistoryQueue);
  const runtimeSession = state.runtimeSession ?? {
    ready: false,
    steps: 0,
    pendingAsset: null,
    serviceTrace: { ready: false, total: 0, recorded: 0, events: [] },
    last: null,
    recent: [],
  };
  globalThis.sakuraRuntimeState = state;
  globalThis.__sakuraRuntimeState = state;
  if (globalThis.window) {
    window.sakuraRuntimeState = state;
    window.__sakuraRuntimeState = state;
  }
  if (force) {
    pendingRuntimeDomState = null;
    if (runtimeDomPublishTimer !== 0) {
      window.clearTimeout(runtimeDomPublishTimer);
      runtimeDomPublishTimer = 0;
    }
    flushRuntimeDomState(state);
    return;
  }
  const now = performance.now();
  const elapsed = now - lastRuntimeDomPublishAt;
  if (lastRuntimeDomPublishAt === 0 || elapsed >= RUNTIME_DOM_PUBLISH_INTERVAL_MS) {
    flushRuntimeDomState(state);
    return;
  }
  pendingRuntimeDomState = state;
  if (runtimeDomPublishTimer !== 0) {
    return;
  }
  runtimeDomPublishTimer = window.setTimeout(() => {
    runtimeDomPublishTimer = 0;
    const queued = pendingRuntimeDomState;
    pendingRuntimeDomState = null;
    if (queued) {
      flushRuntimeDomState(queued);
    }
  }, Math.max(0, RUNTIME_DOM_PUBLISH_INTERVAL_MS - elapsed));
}

function flushRuntimeDomState(state) {
  const summary = state.summary ?? safeInstallSummary(null);
  const graphRender = summarizeGraphQueue(state.runtimeGraphHistoryQueue);
  const runtimeSession = state.runtimeSession ?? {
    ready: false,
    steps: 0,
    pendingAsset: null,
    serviceTrace: { ready: false, total: 0, recorded: 0, events: [] },
    last: null,
    recent: [],
  };
  const safePayload = publishSafeRuntimeState(document, state);
  document.documentElement.dataset.runtimeMounted = String(state.mounted === true);
  document.documentElement.dataset.runtimeRendered = String(state.renderedLocalImage === true);
  document.documentElement.dataset.runtimeAudioReady = String(state.audioReady === true);
  document.documentElement.dataset.runtimeAudioQueued = String(summary.localRuntimeAudioQueued);
  document.documentElement.dataset.runtimeAudioPlayAttempts = String(
    summary.localRuntimeAudioPlayAttempts,
  );
  document.documentElement.dataset.runtimeAudioPlaySuccess = String(
    summary.localRuntimeAudioPlaySuccess,
  );
  document.documentElement.dataset.runtimeAudioPlayBlocked = String(
    summary.localRuntimeAudioPlayBlocked,
  );
  document.documentElement.dataset.runtimeAudioPrepareAttempts = String(
    summary.localRuntimeAudioPrepareAttempts,
  );
  document.documentElement.dataset.runtimeAudioPrepareErrors = String(
    summary.localRuntimeAudioPrepareErrors,
  );
  document.documentElement.dataset.runtimeAudioPostErrors = String(
    summary.localRuntimeAudioPostErrors,
  );
  document.documentElement.dataset.runtimeAudioPostStage = String(
    summary.localRuntimeAudioPostStage,
  );
  document.documentElement.dataset.runtimeAudioScheduleErrors = String(
    summary.localRuntimeAudioScheduleErrors,
  );
  document.documentElement.dataset.runtimeAudioFinalizeVersion = String(
    summary.localRuntimeAudioFinalizeVersion,
  );
  document.documentElement.dataset.runtimeAudioProbeOggBytes = String(
    summary.localRuntimeAudioProbeOggBytes,
  );
  document.documentElement.dataset.runtimePlayerActive = String(state.player?.active === true);
  document.documentElement.dataset.runtimePlayerEventCount = String(state.player?.eventCount ?? 0);
  document.documentElement.dataset.runtimeReady = String(summary.localSystemRuntimeReady);
  document.documentElement.dataset.runtimeAsyncErrorStage = String(
    summary.localSystemRuntimeAsyncErrorStage,
  );
  document.documentElement.dataset.runtimeTimingStage = String(
    summary.localSystemRuntimeTimingStage,
  );
  document.documentElement.dataset.runtimeTimingElapsedMs = String(
    summary.localSystemRuntimeTimingElapsedMs,
  );
  document.documentElement.dataset.runtimeNotifyErrors = String(
    summary.localSystemRuntimeNotifyErrors,
  );
  document.documentElement.dataset.runtimeScriptCount = String(summary.localSystemRuntimeScriptCount);
  document.documentElement.dataset.runtimeHostServiceCount = String(
    summary.localSystemRuntimeHostServiceCount,
  );
  document.documentElement.dataset.runtimeServiceTraceTotal = String(
    summary.localSystemRuntimeServiceTraceTotal,
  );
  document.documentElement.dataset.runtimeSoundServiceCount = String(
    summary.localSystemRuntimeHostSoundServiceCount,
  );
  document.documentElement.dataset.runtimeLastSoundId = String(
    summary.localSystemRuntimeHostLastSoundId,
  );
  document.documentElement.dataset.runtimeEntryTraceTotal = String(
    summary.localSystemRuntimeEntryTraceTotal,
  );
  document.documentElement.dataset.runtimeEntryTraceFirstFamily = String(
    summary.localSystemRuntimeEntryTraceFirstFamily,
  );
  document.documentElement.dataset.runtimeEntryTraceFirstId = String(
    summary.localSystemRuntimeEntryTraceFirstId,
  );
  document.documentElement.dataset.runtimeEntryTraceFirstStringArgs = String(
    summary.localSystemRuntimeEntryTraceFirstStringArgs,
  );
  document.documentElement.dataset.runtimeEntryTraceFirstStringLen = String(
    summary.localSystemRuntimeEntryTraceFirstStringLen,
  );
  document.documentElement.dataset.runtimeEntryTraceFirstInstructionOffset = String(
    summary.localSystemRuntimeEntryTraceFirstInstructionOffset,
  );
  document.documentElement.dataset.runtimeEntryTraceSoundPrefixCount = String(
    summary.localSystemRuntimeEntryTraceSoundPrefixCount,
  );
  document.documentElement.dataset.runtimeEntryHostSoundServiceCount = String(
    summary.localSystemRuntimeEntryHostSoundServiceCount,
  );
  document.documentElement.dataset.runtimeEntryHostLastSoundId = String(
    summary.localSystemRuntimeEntryHostLastSoundId,
  );
  document.documentElement.dataset.runtimeEntryHostLastAssetStringLen = String(
    summary.localSystemRuntimeEntryHostLastAssetStringLen,
  );
  document.documentElement.dataset.runtimeEntryHostLastAssetStringHash = String(
    summary.localSystemRuntimeEntryHostLastAssetStringHash,
  );
  document.documentElement.dataset.runtimeEntryHostLastAssetFound = String(
    summary.localSystemRuntimeEntryHostLastAssetFound,
  );
  document.documentElement.dataset.runtimeEntryHostSoundAfterAssetQueryCount = String(
    summary.localSystemRuntimeEntryHostSoundAfterAssetQueryCount,
  );
  document.documentElement.dataset.runtimeEntrySoundQueueReady = String(
    summary.localSystemRuntimeEntrySoundQueueReady,
  );
  document.documentElement.dataset.runtimeEntrySoundQueueRecorded = String(
    summary.localSystemRuntimeEntrySoundQueueRecorded,
  );
  document.documentElement.dataset.runtimeEntrySoundQueueFirstId = String(
    summary.localSystemRuntimeEntrySoundQueueFirstId,
  );
  document.documentElement.dataset.runtimeEntrySoundQueueFirstArgs = String(
    summary.localSystemRuntimeEntrySoundQueueFirstArgs,
  );
  document.documentElement.dataset.runtimeEntrySoundQueueFirstOffset = String(
    summary.localSystemRuntimeEntrySoundQueueFirstOffset,
  );
  document.documentElement.dataset.runtimeEntrySoundQueueIds = formatSoundQueueField(
    state.entrySoundQueue,
    "serviceId",
  );
  document.documentElement.dataset.runtimeEntrySoundQueueOffsets = formatSoundQueueField(
    state.entrySoundQueue,
    "instructionOffset",
  );
  document.documentElement.dataset.runtimeEntrySoundQueueArgCounts = formatSoundQueueField(
    state.entrySoundQueue,
    "argCount",
  );
  document.documentElement.dataset.runtimeEntryGraphQueueReady = String(
    summary.localSystemRuntimeEntryGraphQueueReady,
  );
  document.documentElement.dataset.runtimeEntryGraphQueueRecorded = String(
    summary.localSystemRuntimeEntryGraphQueueRecorded,
  );
  document.documentElement.dataset.runtimeEntryGraphQueueFirstId = String(
    summary.localSystemRuntimeEntryGraphQueueFirstId,
  );
  document.documentElement.dataset.runtimeEntryGraphQueueFirstArgs = String(
    summary.localSystemRuntimeEntryGraphQueueFirstArgs,
  );
  document.documentElement.dataset.runtimeEntryGraphQueueFirstOffset = String(
    summary.localSystemRuntimeEntryGraphQueueFirstOffset,
  );
  document.documentElement.dataset.runtimeEntryGraphQueueIds = formatSoundQueueField(
    state.entryGraphQueue,
    "serviceId",
  );
  document.documentElement.dataset.runtimeEntryGraphQueueOffsets = formatSoundQueueField(
    state.entryGraphQueue,
    "instructionOffset",
  );
  document.documentElement.dataset.runtimeEntryGraphQueueArgCounts = formatSoundQueueField(
    state.entryGraphQueue,
    "argCount",
  );
  document.documentElement.dataset.runtimeCurrentGraphQueueIds = formatSoundQueueField(
    state.runtimeGraphQueue,
    "serviceId",
  );
  document.documentElement.dataset.runtimeCurrentGraphQueueOffsets = formatSoundQueueField(
    state.runtimeGraphQueue,
    "instructionOffset",
  );
  document.documentElement.dataset.runtimeCurrentGraphQueueArgCounts = formatSoundQueueField(
    state.runtimeGraphQueue,
    "argCount",
  );
  document.documentElement.dataset.runtimeCurrentGraphHistoryQueueIds = formatSoundQueueField(
    state.runtimeGraphHistoryQueue,
    "serviceId",
  );
  document.documentElement.dataset.runtimeCurrentGraphHistoryQueueOffsets = formatSoundQueueField(
    state.runtimeGraphHistoryQueue,
    "instructionOffset",
  );
  document.documentElement.dataset.runtimeCurrentGraphHistoryQueueArgCounts = formatSoundQueueField(
    state.runtimeGraphHistoryQueue,
    "argCount",
  );
  document.documentElement.dataset.runtimeGraphRenderReady = String(graphRender.ready);
  document.documentElement.dataset.runtimeGraphRenderCommandCount = String(
    graphRender.commandCount,
  );
  document.documentElement.dataset.runtimeGraphRenderPriorityCommandCount = String(
    graphRender.priorityCommandCount,
  );
  document.documentElement.dataset.runtimeGraphRenderOutputEventCount = String(
    graphRender.outputEventCount,
  );
  document.documentElement.dataset.runtimeGraphRenderSurfaceWidth = String(
    graphRender.surfaceWidth,
  );
  document.documentElement.dataset.runtimeGraphRenderSurfaceHeight = String(
    graphRender.surfaceHeight,
  );
  document.documentElement.dataset.runtimeGraphRenderFirstId = String(graphRender.firstServiceId);
  document.documentElement.dataset.runtimeGraphRenderFirstArgs = String(graphRender.firstArgCount);
  document.documentElement.dataset.runtimeGraphRenderFirstOffset = String(graphRender.firstOffset);
  document.documentElement.dataset.runtimeGraphRenderIds = graphRender.serviceIds;
  document.documentElement.dataset.runtimeGraphRenderPriorityIds = graphRender.priorityServiceIds;
  document.documentElement.dataset.runtimeGraphRenderOffsets = graphRender.offsets;
  document.documentElement.dataset.runtimeGraphRenderArgCounts = graphRender.argCounts;
  document.documentElement.dataset.runtimeGraphRenderArgKinds = graphRender.argKinds;
  document.documentElement.dataset.runtimeGraphRenderArgValues = graphRender.argValues;
  document.documentElement.dataset.runtimeGraphRenderArgLengths = graphRender.argLengths;
  document.documentElement.dataset.runtimeGraphRenderArgHashes = graphRender.argHashes;
  document.documentElement.dataset.runtimeGraphRenderSlot0EntryCount = String(
    state.graphRender?.runtimeSlot0EntryCount ?? 0,
  );
  document.documentElement.dataset.runtimeGraphRenderSlot0MatchedLayerCount = String(
    state.graphRender?.runtimeSlot0MatchedLayerCount ?? 0,
  );
  document.documentElement.dataset.runtimeSessionReady = String(runtimeSession.ready === true);
  document.documentElement.dataset.runtimeSessionSteps = String(runtimeSession.steps ?? 0);
  document.documentElement.dataset.runtimeSessionEntryScriptName =
    String(runtimeSession.entryScriptName ?? "");
  document.documentElement.dataset.runtimeSessionEntryScriptIndex = String(
    runtimeSession.entryScriptIndex ?? 0,
  );
  document.documentElement.dataset.runtimeSessionTraceReady = String(
    runtimeSession.serviceTrace?.ready === true,
  );
  document.documentElement.dataset.runtimeSessionTraceTotal = String(
    runtimeSession.serviceTrace?.total ?? 0,
  );
  document.documentElement.dataset.runtimeSessionTraceRecorded = String(
    runtimeSession.serviceTrace?.recorded ?? 0,
  );
  document.documentElement.dataset.runtimeSessionTraceFirstFamily = String(
    runtimeSession.serviceTrace?.events?.[0]?.family ?? 0,
  );
  document.documentElement.dataset.runtimeSessionTraceFirstId = String(
    runtimeSession.serviceTrace?.events?.[0]?.serviceId ?? 0,
  );
  document.documentElement.dataset.runtimeSessionTraceFirstArgs = String(
    runtimeSession.serviceTrace?.events?.[0]?.argCount ?? 0,
  );
  document.documentElement.dataset.runtimeSessionTraceFirstStringArgs = String(
    runtimeSession.serviceTrace?.events?.[0]?.stringArgCount ?? 0,
  );
  document.documentElement.dataset.runtimeSessionTraceFirstStringLen = String(
    runtimeSession.serviceTrace?.events?.[0]?.firstStringLength ?? 0,
  );
  document.documentElement.dataset.runtimeSessionTraceFirstInstructionOffset = String(
    runtimeSession.serviceTrace?.events?.[0]?.instructionOffset ?? 0,
  );
  document.documentElement.dataset.runtimeSessionTraceIds = formatSoundQueueField(
    runtimeSession.serviceTrace,
    "serviceId",
  );
  document.documentElement.dataset.runtimeSessionTraceOffsets = formatSoundQueueField(
    runtimeSession.serviceTrace,
    "instructionOffset",
  );
  document.documentElement.dataset.runtimeSessionTraceArgCounts = formatSoundQueueField(
    runtimeSession.serviceTrace,
    "argCount",
  );
  document.documentElement.dataset.runtimeSessionLastEvents = String(runtimeSession.last?.eventCount ?? 0);
  document.documentElement.dataset.runtimeSessionLastServices = String(runtimeSession.last?.serviceEventCount ?? 0);
  document.documentElement.dataset.runtimeSessionLastCompleted = String(runtimeSession.last?.completed === true);
  document.documentElement.dataset.runtimeSessionLastLimited = String(runtimeSession.last?.eventLimited === true);
  document.documentElement.dataset.runtimeSessionLastSys1c = String(runtimeSession.last?.sys1cCount ?? 0);
  document.documentElement.dataset.runtimeSessionLastSys49 = String(runtimeSession.last?.sys49Count ?? 0);
  document.documentElement.dataset.runtimeSessionLastSys5f = String(runtimeSession.last?.sys5fCount ?? 0);
  document.documentElement.dataset.runtimeSessionLastGraphBf = String(runtimeSession.last?.graphBfCount ?? 0);
  document.documentElement.dataset.runtimeSessionFrameCursor = String(
    runtimeSession.last?.frameCursor ?? 0,
  );
  document.documentElement.dataset.runtimeSessionFrameLastInstructionOffset = String(
    runtimeSession.last?.frameLastInstructionOffset ?? 0,
  );
  document.documentElement.dataset.runtimeSessionLocal1076 = String(
    runtimeSession.last?.local1076 ?? 0,
  );
  document.documentElement.dataset.runtimeSessionLocal1152 = String(
    runtimeSession.last?.local1152 ?? 0,
  );
  document.documentElement.dataset.runtimeSessionLocal3952 = String(
    runtimeSession.last?.local3952 ?? 0,
  );
  document.documentElement.dataset.runtimeSessionLocal3956 = String(
    runtimeSession.last?.local3956 ?? 0,
  );
  document.documentElement.dataset.runtimeSessionLocal3992 = String(
    runtimeSession.last?.local3992 ?? 0,
  );
  document.documentElement.dataset.runtimeSessionLocal3996 = String(
    runtimeSession.last?.local3996 ?? 0,
  );
  document.documentElement.dataset.runtimeSessionLocal7108 = String(
    runtimeSession.last?.local7108 ?? 0,
  );
  document.documentElement.dataset.runtimeSessionLocal7112 = String(
    runtimeSession.last?.local7112 ?? 0,
  );
  document.documentElement.dataset.runtimeSessionPendingAsset = String(
    runtimeSession.pendingAsset !== null,
  );
  document.documentElement.dataset.runtimeSessionPendingAssetServiceId = String(
    runtimeSession.pendingAsset?.serviceId ?? 0,
  );
  document.documentElement.dataset.runtimeSessionPendingAssetSize = String(
    runtimeSession.pendingAsset?.size ?? 0,
  );
  document.documentElement.dataset.runtimeSessionPendingAssetNameLength = String(
    runtimeSession.pendingAsset?.nameLength ?? 0,
  );
  document.documentElement.dataset.runtimeStageNonBlackSampleCount = String(
    sampleStageNonBlackPixels(),
  );
  document.documentElement.dataset.safeStateLen = String(
    JSON.stringify(safePayload ?? {}).length,
  );
  document.documentElement.dataset.runtimeProbeOutputLen = String(outputEl.textContent.length);
  saveButton.disabled = state.player?.active !== true;
  loadButton.disabled = state.player?.active !== true;
  playAudioButton.disabled = state.audioReady !== true;
  lastRuntimeDomPublishAt = performance.now();
}

function sampleStageNonBlackPixels() {
  return stageNonBlackSampleCount;
}

async function playQueuedAudio() {
  const result = await activeInstall?.audioMixer?.playFirstQueued();
  if (result) {
    updateAudioState(activeInstall);
    outputEl.textContent = formatInstallSummary(activeInstall.summary);
    publishRuntimeState(true);
  }
}

function updateAudioState(mounted) {
  syncMountedAudioState(mounted);
}

function formatSoundQueueField(queue, field) {
  return (queue?.events ?? [])
    .slice(0, 8)
    .map((event) => String(event[field] ?? 0))
    .join(",");
}

function createInstallHooks() {
  return {
    isActive: (mounted) => mounted?.destroyed !== true && (activeInstall === null || isCurrentInstall(mounted)),
    isSummaryActive: (summary) => activeInstall?.summary === summary,
    runtimeInput: () => input.runtimeState(),
    paint: paintMountedFrame,
    onUpdate: renderInstallSummary,
    onSummary: renderSummary,
  };
}

function renderInstallSummary(mounted) {
  renderInstallSummaryText(mounted.summary);
  publishRuntimeState();
}

function renderSummary(summary) {
  renderInstallSummaryText(summary);
  publishRuntimeState();
}

function renderInstallSummaryText(summary, immediate = false) {
  if (!summary) {
    return;
  }
  if (immediate) {
    pendingSummary = null;
    if (summaryRenderTimer !== 0) {
      window.clearTimeout(summaryRenderTimer);
      summaryRenderTimer = 0;
    }
    flushInstallSummaryText(summary);
    return;
  }
  const now = performance.now();
  const elapsed = now - lastSummaryRenderAt;
  if (lastSummaryRenderAt === 0 || elapsed >= SUMMARY_RENDER_INTERVAL_MS) {
    flushInstallSummaryText(summary);
    return;
  }
  pendingSummary = summary;
  if (summaryRenderTimer !== 0) {
    return;
  }
  summaryRenderTimer = window.setTimeout(() => {
    summaryRenderTimer = 0;
    const queued = pendingSummary;
    pendingSummary = null;
    if (queued) {
      flushInstallSummaryText(queued);
    }
  }, Math.max(0, SUMMARY_RENDER_INTERVAL_MS - elapsed));
}

function flushInstallSummaryText(summary) {
  outputEl.textContent = formatInstallSummary(summary);
  lastSummaryRenderAt = performance.now();
}

async function bootServerInstall() {
  const mounted = await mountServerInstall(core, createInstallHooks());
  if (mounted === null) {
    outputEl.textContent = "install_probe_version=browser-1\nlocal_server_mount_ready=0";
    return;
  }
  if (mounted.destroyed === true) {
    return;
  }
  activeInstall?.destroy?.();
  activeInstall = mounted;
  exposeActiveInstallDebug();
  if (activeInstall?.summary) {
    activeInstall.summary.localSystemRuntimeTimingStage = 104;
  }
  bindRuntimeSessionControls();
  paintMountedFrame(activeInstall);
  publishRuntimeState(true);
  renderInstallSummaryText(mounted.summary, true);
}

function paintMountedFrame(mounted) {
  const image = mounted.bootImage;
  if (image === null) {
    paintBootFrame(core);
    renderMountedGraphQueue(mounted);
    stageNonBlackSampleCount = 1;
    return;
  }

  const frameCanvas = cachedMountedFrameCanvas(mounted, image);

  context.fillStyle = "#000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
  const width = Math.round(image.width * scale);
  const height = Math.round(image.height * scale);
  const x = Math.floor((canvas.width - width) / 2);
  const y = Math.floor((canvas.height - height) / 2);
  context.drawImage(frameCanvas, x, y, width, height);
  renderMountedGraphQueue(mounted);
  paintScenarioEvent(context, canvas, mounted.player?.event ?? null);
  stageNonBlackSampleCount = 1;
}

function cachedMountedFrameCanvas(mounted, image) {
  const cache = mounted.stageFrameCache;
  if (cache?.source === image) {
    return cache.canvas;
  }
  const scratch = document.createElement("canvas");
  scratch.width = image.width;
  scratch.height = image.height;
  scratch
    .getContext("2d", { alpha: false })
    .putImageData(new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height), 0, 0);
  mounted.stageFrameCache = { source: image, canvas: scratch };
  return scratch;
}

function mountedGraphRuntime(mounted) {
  if (!mounted) {
    return null;
  }
  if (mounted.graphRuntime) {
    return mounted.graphRuntime;
  }
  mounted.graphRuntime = {
    catalog: mounted.catalog,
    core,
    requestPaint: () => {
      if (activeInstall === mounted) {
        paintMountedFrame(mounted);
        publishRuntimeState();
      }
    },
    readRuntimeMemory: (address, length) => (
      mounted.destroyed === true
      || mounted.runtimeSessionHandle === 0
        ? null
        : core.runtimeSessionMemory(
          mounted.runtimeSessionHandle,
          address >>> 0,
          length >>> 0,
        )
    ),
  };
  return mounted.graphRuntime;
}

function renderMountedGraphQueue(mounted) {
  const graphRender = renderGraphQueue(
    context,
    canvas,
    mounted?.safeState?.runtimeGraphHistoryQueue,
    mountedGraphRuntime(mounted),
  );
  if (!mounted?.safeState) {
    return;
  }
  mounted.safeState.graphRender = {
    applied: graphRender.applied === true,
    priorityCommandCount: graphRender.priorityEvents.length,
    outputEventCount: graphRender.outputEvents.length,
    surfaceWidth: graphRender.surfaceWidth,
    surfaceHeight: graphRender.surfaceHeight,
    resolvedImageCount: graphRender.resolvedImageCount ?? 0,
    drawnImageCount: graphRender.drawnImageCount ?? 0,
    runtimeSlot0EntryCount: graphRender.runtimeSlot0EntryCount ?? 0,
    runtimeSlot0MatchedLayerCount: graphRender.runtimeSlot0MatchedLayerCount ?? 0,
  };
}

function paintBootFrame(core) {
  void core;
  context.fillStyle = "#111318";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.globalAlpha = 0.38;
  context.fillStyle = "#4874b4";
  context.fillRect(36, 42, 240, 120);
  context.restore();
  context.fillStyle = "#e9edf1";
  context.font = "24px system-ui, sans-serif";
  context.fillText("BGI runtime core loaded", 40, 64);
}
