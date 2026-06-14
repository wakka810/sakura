import { probeLocalScripts } from "./script-probe.js";
import {
  createLocalCatalog,
  createServerCatalog,
  orderFilesByHvl,
  parseHvlManifest,
  readArcIndexPrefix,
} from "./local-catalog.js";
import { countSoundTracePrefix, safeServiceTraceState } from "./service-trace-state.js";
import { emptyHostState } from "./host-state.js";
import { createInitialScenarioPlayer } from "./session-player.js";
import { normalizeScenarioRoute } from "./scenario-routes.js";
import { createAudioMixer } from "./audio-mixer.js";
import { PRIORITY_GRAPH_SERVICE_IDS } from "./graph-renderer.js";

const PAYLOAD_KIND_DSC = 1;
const PAYLOAD_KIND_COMPRESSED_BG = 2;
const PAYLOAD_KIND_BGI_AUDIO = 3;
const DSC_PREFIX_LEN = 16;
const CBG_HEADER_LEN = 0x30;
const LOCAL_CBG_PROBE_MAX_PIXELS = 500_000;
const RUNTIME_FULL_ARCHIVE_MAX_BYTES = 32 * 1024 * 1024;
const SYSTEM_RUNTIME_OK = 1;
const SYSTEM_RUNTIME_CREATE_FAILED = 2;
const SYSTEM_RUNTIME_ARCHIVE_MOUNT_FAILED = 3;
const SYSTEM_RUNTIME_BOOT_PAYLOAD_MISSING = 4;
const SYSTEM_RUNTIME_BOOT_MOUNT_FAILED = 5;
const SYSTEM_RUNTIME_BOOT_WRITE_FAILED = 6;
const SYSTEM_RUNTIME_ASYNC_ERROR = 7;
const SYSTEM_RUNTIME_STAGE_CREATE = 1;
const SYSTEM_RUNTIME_STAGE_BOOT = 2;
const SYSTEM_RUNTIME_STAGE_GRAPH_PROBES = 3;
const SYSTEM_RUNTIME_STAGE_TRACES = 4;
const SYSTEM_RUNTIME_STAGE_BOOTSTRAP_SUMMARY = 5;
const SYSTEM_RUNTIME_STAGE_PROBE_SUMMARY = 6;
const SYSTEM_RUNTIME_STAGE_ENTRY_TRACE_SUMMARY = 7;
const SYSTEM_RUNTIME_STAGE_SOUND_QUEUE = 8;
const SYSTEM_RUNTIME_STAGE_NOTIFY_BEGIN = 10;
const SYSTEM_RUNTIME_STAGE_NOTIFY_DONE = 11;
const SYSTEM_RUNTIME_STAGE_AUDIO_SCHEDULE_BEGIN = 12;
const SYSTEM_RUNTIME_STAGE_AUDIO_SCHEDULE_DONE = 13;
const SYSTEM_RUNTIME_TIMING_CREATE_BEGIN = 101;
const SYSTEM_RUNTIME_TIMING_CREATE_DONE = 102;
const SYSTEM_RUNTIME_TIMING_BOOT_DONE = 103;
const SYSTEM_RUNTIME_TIMING_MOUNTED = 104;
const SYSTEM_RUNTIME_TIMING_QUEUED = 105;
const RUNTIME_AUDIO_FINALIZE_VERSION = 2;
const DEFAULT_ENTRY_SCRIPT_NAME_TEXT = "scrdrv._bp";
const ENTRY_SCRIPT_NAME = new TextEncoder().encode(DEFAULT_ENTRY_SCRIPT_NAME_TEXT);
const LOCAL_GRAPH9C_PROBE_OFFSET = 0x12df;
const LOCAL_GRAPH88_PROBE_OFFSET = 0x197;
const RUNTIME_SESSION_TICK_MS = 50;
const RUNTIME_SESSION_HISTORY_LIMIT = 8;
const RUNTIME_SESSION_QUEUE_HISTORY_LIMIT = 256;
const RUNTIME_SESSION_BOOTSTRAP_EVENTS = 8;
const RUNTIME_SESSION_BOOTSTRAP_MAX_STEPS = 192;
const RUNTIME_SESSION_BOOTSTRAP_READY_GRAPH_SERVICE_IDS = new Set([0x4c, 0x94, 0x95, 0x96]);
const RUNTIME_SESSION_TICK_EVENTS = 1;
const RUNTIME_SESSION_MAX_INSTRUCTIONS = 100000;
const RUNTIME_CREATE_YIELD_INTERVAL = 4;
const RUNTIME_QUEUE_SAFE_ARG_LIMIT = 256;
const RUNTIME_GRAPH_PROBE_SAMPLE_BYTES = 64;
const RUNTIME_GRAPH_PROBE_MAX_CANDIDATES = 12;
const LOCAL_POINTER_BASE = 0x12000000;
const AUX_POINTER_BASE = 0x20000000;
const LOCAL_POINTER_MASK = 0x01ffffff;
const AUX_SLOT0_ARCHIVE_OFFSET = 0x406000;
const AUX_SLOT0_ARCHIVE_BASE = AUX_POINTER_BASE + AUX_SLOT0_ARCHIVE_OFFSET;

function requestedSystemEntryName() {
  try {
    const value = new URLSearchParams(globalThis.window?.location?.search ?? "").get("systemEntry");
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function requestedSystemEntryIndex() {
  try {
    const raw = new URLSearchParams(globalThis.window?.location?.search ?? "").get("systemEntryIndex");
    if (raw === null || raw.length === 0) {
      return null;
    }
    const value = Number.parseInt(raw, 10);
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

function resolveSystemEntryRequest() {
  const index = requestedSystemEntryIndex();
  if (index !== null) {
    return {
      displayName: `index:${index}`,
      index,
      name: null,
    };
  }
  return {
    displayName: requestedSystemEntryName() ?? DEFAULT_ENTRY_SCRIPT_NAME_TEXT,
    index: null,
    name: requestedSystemEntryName() ?? DEFAULT_ENTRY_SCRIPT_NAME_TEXT,
  };
}

function runtimeDiagnosticsEnabled() {
  try {
    return new URLSearchParams(globalThis.window?.location?.search ?? "").get("deepProbe") === "1";
  } catch {
    return false;
  }
}

function runtimeScenarioPreviewEnabled() {
  try {
    return new URLSearchParams(globalThis.window?.location?.search ?? "").get("scenarioPreview") === "1";
  } catch {
    return false;
  }
}

function runtimeProbeImagePreviewEnabled() {
  try {
    return new URLSearchParams(globalThis.window?.location?.search ?? "").get("probeImage") === "1";
  } catch {
    return false;
  }
}

async function yieldToMainThread() {
  await new Promise((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });
}

function encodeSystemEntryName(name) {
  return name === DEFAULT_ENTRY_SCRIPT_NAME_TEXT
    ? ENTRY_SCRIPT_NAME
    : new TextEncoder().encode(name);
}

function fnv1a32Text(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index) & 0xff;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export async function mountLocalInstall(files, core, hooks = {}) {
  return mountLocalFileIterable(files, core, hooks);
}

export async function mountServerInstall(core, hooks = {}) {
  let response;
  try {
    response = await fetch("./api/install/catalog", { cache: "no-store" });
  } catch {
    return null;
  }
  if (!response.ok) {
    return null;
  }
  const payload = await response.json();
  const catalog = createServerCatalog(payload);
  return mountCatalog(catalog, {
    exeCount: payload.exeCount ?? 0,
    arcCount: payload.archiveCount ?? 0,
    arcEntries: payload.entryCount ?? 0,
    arcIndexBytes: 0,
    invalidArcCount: 0,
  }, core, hooks);
}

async function mountLocalFileIterable(files, core, hooks) {
  files = await orderInstallFiles(files, core);
  const catalog = createLocalCatalog();
  const summary = { exeCount: 0, arcCount: 0, arcEntries: 0, arcIndexBytes: 0, invalidArcCount: 0 };
  for await (const file of files) {
    if (file.name === "BGI.exe") {
      summary.exeCount += 1;
    }
    if (file.name.toLowerCase().endsWith(".arc")) {
      const prefix = await readArcIndexPrefix(file);
      if (!prefix) {
        summary.invalidArcCount += 1;
        continue;
      }
      const manifest = core.arc20IndexManifest(prefix, file.size);
      if (manifest === null) {
        summary.invalidArcCount += 1;
        continue;
      }
      const mounted = catalog.mountArchive(file, manifest, {
        mountData: file.size <= RUNTIME_FULL_ARCHIVE_MAX_BYTES,
      });
      summary.arcCount += 1;
      summary.arcEntries += mounted.entryCount;
      summary.arcIndexBytes += prefix.byteLength;
    }
  }
  return mountCatalog(catalog, summary, core, hooks);
}

export function syncMountedAudioState(mounted) {
  const state = mounted.audioMixer.state();
  mounted.audio = state.ready;
  mounted.summary.localRuntimeAudioReady = Number(state.ready);
  mounted.summary.localRuntimeAudioQueued = state.queued;
  mounted.summary.localRuntimeAudioPlayAttempts = state.playAttempts;
  mounted.summary.localRuntimeAudioPlaySuccess = state.playSuccess;
  mounted.summary.localRuntimeAudioPlayBlocked = state.playBlocked;
  mounted.safeState.audioReady = state.ready;
  mounted.safeState.audioMixer = state;
}

async function orderInstallFiles(files, core) {
  const list = Array.from(files);
  const hvl = list.find((file) => file.name.toLowerCase() === "bgi.hvl");
  if (!hvl) {
    return list.sort((left, right) => left.name.localeCompare(right.name));
  }
  const packet = core.hvlManifest(new Uint8Array(await hvl.arrayBuffer()));
  if (packet === null) {
    return list.sort((left, right) => left.name.localeCompare(right.name));
  }
  return orderFilesByHvl(list, parseHvlManifest(packet));
}

async function mountCatalog(catalog, summary, core, hooks) {
  const cbgProbe = await probeLocalCbg(catalog, core);
  const audioProbe = await probeLocalAudio(catalog, core);
  const titleImage = await loadTitleImage(catalog, core);
  const menuButtons = await loadMenuButtons(catalog, core);
  const bootScreens = await loadBootScreens(catalog, core);
  const messageWindow = await loadMessageWindow(catalog, core);
  const logWindow = await loadLogWindow(catalog, core);
  const userDataWindow = await loadUserDataWindow(catalog, core);
  const configWindow = await loadConfigWindow(catalog, core);
  const audioMixer = createAudioMixer();
  const playerState = { active: false };
  const fullSummary = {
    ...summary,
    ...catalog.summary(),
    ...cbgProbe.summary,
    ...audioProbe.summary,
    ...emptyScriptProbeSummary(),
    localRuntimeMountReady: Number(summary.exeCount > 0 && summary.arcCount > 0),
    localRuntimeRenderProbe: Number(cbgProbe.image !== null),
    localRuntimeAudioReady: 0,
    localRuntimeAudioQueued: 0,
    localRuntimeAudioPlayAttempts: 0,
    localRuntimeAudioPlaySuccess: 0,
    localRuntimeAudioPlayBlocked: 0,
    localRuntimeAudioPrepareAttempts: 0,
    localRuntimeAudioPrepareErrors: 0,
    localRuntimeAudioPostErrors: 0,
    localRuntimeAudioScheduleErrors: 0,
    localRuntimeAudioPostStage: 0,
    localRuntimeAudioFinalizeVersion: RUNTIME_AUDIO_FINALIZE_VERSION,
    localRuntimeAudioProbeOggBytes: audioProbe.ogg?.byteLength ?? 0,
    localRuntimeScenarioSessionReady: Number(playerState.active === true),
    localRuntimeScenarioSessionEventKind: playerState.eventKind ?? 0,
    localRuntimeScenarioSessionMode: playerState.mode ?? 0,
    localRuntimeScenarioSessionPayloadBytes: playerState.payloadLength ?? 0,
    localRuntimeScenarioSessionSaveBytes: playerState.lastSaveBytes ?? 0,
    localRuntimeScenarioSessionLoadBytes: playerState.lastLoadBytes ?? 0,
    localRuntimeScenarioSessionScanCount: 0,
    localRuntimeScenarioSessionScanSkipLarge: 0,
    localSystemRuntimeStatus: 0,
    localSystemRuntimeAsyncErrorStage: 0,
    localSystemRuntimeTimingStage: 0,
    localSystemRuntimeTimingElapsedMs: 0,
    localSystemRuntimeNotifyErrors: 0,
    localSystemRuntimeReady: 0,
    localSystemRuntimeManifestCount: 0,
    localSystemRuntimeBootPayloadReady: 0,
    localSystemRuntimeDscScriptCount: 0,
    localSystemRuntimeScriptCount: 0,
    localSystemRuntimeSystemScriptCount: 0,
    localSystemRuntimeScenarioScriptCount: 0,
    localSystemRuntimeBootstrapReady: 0,
    localSystemRuntimeBootstrapEvents: 0,
    localSystemRuntimeBootstrapServices: 0,
    localSystemRuntimeBootstrapUserCalls: 0,
    localSystemRuntimeBootstrapCompleted: 0,
    localSystemRuntimeBootstrapLimited: 0,
    localSystemRuntimeBootstrapSys40: 0,
    localSystemRuntimeBootstrapGraph88: 0,
    localSystemRuntimeBootstrapGraph9c: 0,
    localSystemRuntimeBootstrapSoundService: 0,
    localSystemRuntimeHostServiceCount: 0,
    localSystemRuntimeHostLoadProgramCount: 0,
    localSystemRuntimeHostFileQueryCount: 0,
    localSystemRuntimeHostGraphFormatCount: 0,
    localSystemRuntimeHostGraphRenderTextCount: 0,
    localSystemRuntimeHostSoundPlayCount: 0,
    localSystemRuntimeHostSoundServiceCount: 0,
    localSystemRuntimeHostLastSoundId: 0,
    localSystemRuntimeHostLastSoundArgCount: 0,
    localSystemRuntimeHostLastSoundIntegerArgs: 0,
    localSystemRuntimeHostLastAssetStringLen: 0,
    localSystemRuntimeHostLastAssetStringHash: 0,
    localSystemRuntimeHostLastAssetQueryServiceId: 0,
    localSystemRuntimeHostLastAssetFound: 0,
    localSystemRuntimeHostLastLoadedScriptStringLen: 0,
    localSystemRuntimeHostLastLoadedScriptStringHash: 0,
    localSystemRuntimeHostLastLoadedScriptFound: 0,
    localSystemRuntimeHostSoundAfterAssetQueryCount: 0,
    localSystemRuntimeGraph9cProbeReady: 0,
    localSystemRuntimeGraph9cProbeEvents: 0,
    localSystemRuntimeGraph9cProbeGraph9c: 0,
    localSystemRuntimeGraph9cProbeGraph88: 0,
    localSystemRuntimeGraph9cProbeSoundService: 0,
    localSystemRuntimeGraph9cProbeFirstGraph9cArgs: 0,
    localSystemRuntimeGraph9cProbeFirstGraph9cTopKind: 0,
    localSystemRuntimeGraph88ProbeReady: 0,
    localSystemRuntimeGraph88ProbeEvents: 0,
    localSystemRuntimeGraph88ProbeGraph9c: 0,
    localSystemRuntimeGraph88ProbeGraph88: 0,
    localSystemRuntimeGraph88ProbeSoundService: 0,
    localSystemRuntimeGraph88ProbeFirstGraph88Args: 0,
    localSystemRuntimeGraph88ProbeFirstGraph88TopKind: 0,
    localSystemRuntimeServiceTraceReady: 0,
    localSystemRuntimeServiceTraceTotal: 0,
    localSystemRuntimeServiceTraceRecorded: 0,
    localSystemRuntimeServiceTraceFirstFamily: 0,
    localSystemRuntimeServiceTraceFirstId: 0,
    localSystemRuntimeServiceTraceFirstArgs: 0,
    localSystemRuntimeServiceTraceFirstTopKind: 0,
    localSystemRuntimeEntryTraceReady: 0,
    localSystemRuntimeEntryTraceTotal: 0,
    localSystemRuntimeEntryTraceFirstFamily: 0,
    localSystemRuntimeEntryTraceFirstId: 0,
    localSystemRuntimeEntryTraceFirstArgs: 0,
    localSystemRuntimeEntryTraceFirstStringArgs: 0,
    localSystemRuntimeEntryTraceFirstStringLen: 0,
    localSystemRuntimeEntryTraceFirstStringHash: 0,
    localSystemRuntimeEntryTraceFirstInstructionOffset: 0,
    localSystemRuntimeEntryTraceSoundPrefixCount: 0,
    localSystemRuntimeEntryHostSoundServiceCount: 0,
    localSystemRuntimeEntryHostLastSoundId: 0,
    localSystemRuntimeEntryHostLastSoundArgCount: 0,
    localSystemRuntimeEntryHostLastAssetStringLen: 0,
    localSystemRuntimeEntryHostLastAssetStringHash: 0,
    localSystemRuntimeEntryHostLastAssetFound: 0,
    localSystemRuntimeEntryHostSoundAfterAssetQueryCount: 0,
    localSystemRuntimeEntrySoundQueueReady: 0,
    localSystemRuntimeEntrySoundQueueRecorded: 0,
    localSystemRuntimeEntrySoundQueueFirstId: 0,
    localSystemRuntimeEntrySoundQueueFirstArgs: 0,
    localSystemRuntimeEntrySoundQueueFirstOffset: 0,
    localSystemRuntimeEntryGraphQueueReady: 0,
    localSystemRuntimeEntryGraphQueueRecorded: 0,
    localSystemRuntimeEntryGraphQueueFirstId: 0,
    localSystemRuntimeEntryGraphQueueFirstArgs: 0,
    localSystemRuntimeEntryGraphQueueFirstOffset: 0,
    localSystemRuntimeSessionReady: 0,
    localSystemRuntimeSessionStepCount: 0,
    localSystemRuntimeSessionLastEventCount: 0,
    localSystemRuntimeSessionLastServiceCount: 0,
    localSystemRuntimeSessionLastCompleted: 0,
    localSystemRuntimeSessionLastLimited: 0,
    localSystemRuntimeSessionLastFamily: 0,
    localSystemRuntimeSessionLastId: 0,
    localSystemRuntimeSessionLastArgCount: 0,
    localSystemRuntimeSessionLastTopKind: 0,
    localSystemRuntimeSessionFrameScriptIndex: 0,
    localSystemRuntimeSessionFrameCursor: 0,
    localSystemRuntimeSessionFrameLastInstructionOffset: 0,
    localSystemRuntimeSessionHostServiceCount: 0,
    localSystemRuntimeSessionHostFileQueryCount: 0,
    localSystemRuntimeSessionHostGraphFormatCount: 0,
    localSystemRuntimeSessionHostGraphRenderTextCount: 0,
    localSystemRuntimeSessionHostSoundServiceCount: 0,
    localSystemRuntimeSessionHostLastAssetQueryServiceId: 0,
    localSystemRuntimeSessionHostLastAssetFound: 0,
    localSystemRuntimeSessionHostLastLoadedScriptStringLen: 0,
    localSystemRuntimeSessionHostLastLoadedScriptFound: 0,
    localSystemRuntimeSessionHostSoundAfterAssetQueryCount: 0,
    localSystemRuntimeSessionTraceReady: 0,
    localSystemRuntimeSessionTraceTotal: 0,
    localSystemRuntimeSessionTraceRecorded: 0,
    localSystemRuntimeSessionTraceFirstFamily: 0,
    localSystemRuntimeSessionTraceFirstId: 0,
    localSystemRuntimeSessionTraceFirstArgs: 0,
    localSystemRuntimeSessionTraceFirstStringArgs: 0,
    localSystemRuntimeSessionTraceFirstStringLen: 0,
    localSystemRuntimeSessionTraceFirstInstructionOffset: 0,
    localSystemRuntimeSessionSys1cCount: 0,
    localSystemRuntimeSessionSys49Count: 0,
    localSystemRuntimeSessionSys5fCount: 0,
    localSystemRuntimeSessionGraphBfCount: 0,
    localSystemRuntimeSessionLocal44: 0,
    localSystemRuntimeSessionLocal48: 0,
    localSystemRuntimeSessionLocal64: 0,
    localSystemRuntimeSessionLocal68: 0,
    localSystemRuntimeSessionLocal3952: 0,
    localSystemRuntimeSessionLocal3956: 0,
    localSystemRuntimeSessionLocal3992: 0,
    localSystemRuntimeSessionLocal3996: 0,
    localSystemRuntimeSessionLocal4024: 0,
    localSystemRuntimeSessionLocal4028: 0,
    localSystemRuntimeSessionLocal7100: 0,
    localSystemRuntimeSessionLocal7104: 0,
    localSystemRuntimeSessionLocal7108: 0,
    localSystemRuntimeSessionLocal7112: 0,
  };
  const mounted = {
    catalog,
    bootImage: runtimeProbeImagePreviewEnabled() ? cbgProbe.image : null,
    audioOgg: audioProbe.ogg,
    audio: false,
    audioMixer,
    runtimeHandle: 0,
    runtimeSessionHandle: 0,
    runtimeSessionTimer: 0,
    runtimeSessionPaused: false,
    runtimeSessionEntryScriptIndex: null,
    runtimeSessionEntryOffset: null,
    runtimeSessionEntryName: resolveSystemEntryRequest().displayName,
    destroyed: false,
    scenarioPreviewEnabled: runtimeScenarioPreviewEnabled(),
    titleImage,
    menuButtons,
    bootScreens,
    messageWindow,
    logWindow,
    userDataWindow,
    configWindow,
    bootPhase: 0,
    stage: runtimeScenarioPreviewEnabled()
      ? "scenario"
      : bootScreens.length > 0
        ? "boot"
        : titleImage
          ? "title"
          : "scenario",
    player: null,
    summary: fullSummary,
      safeState: {
        mounted: fullSummary.localRuntimeMountReady === 1,
        renderedLocalImage: fullSummary.localRuntimeRenderProbe === 1,
        audioReady: fullSummary.localRuntimeAudioReady === 1,
        audioMixer: audioMixer.state(),
        player: playerState,
        serviceTrace: { ready: false, total: 0, recorded: 0, events: [] },
        systemHost: emptyHostState(),
        archiveCount: fullSummary.arcCount,
        canonicalEntryCount: fullSummary.arcCanonicalEntries,
        scriptCount: fullSummary.localScenarioScripts + fullSummary.localSystemScripts,
        runtimeGraphQueue: { ready: false, recorded: 0, events: [] },
        runtimeGraphHistoryQueue: { ready: false, recorded: 0, events: [] },
        runtimeSession: createRuntimeSessionState(),
        entryServiceTrace: { ready: false, total: 0, recorded: 0, events: [] },
      },
  };
  mounted.destroy = () => {
    destroyMountedInstall(mounted, core);
  };
  mounted.pauseRuntimeSession = () => {
    mounted.runtimeSessionPaused = true;
    stopRuntimeSessionLoop(mounted);
    return mounted.safeState.runtimeSession;
  };
  mounted.resumeRuntimeSession = () => {
    mounted.runtimeSessionPaused = false;
    startRuntimeSessionLoop(mounted, core, hooks);
    return mounted.safeState.runtimeSession;
  };
  mounted.stepRuntimeSession = (
    maxEvents = 1,
    maxInstructionsPerEvent = RUNTIME_SESSION_MAX_INSTRUCTIONS,
  ) => stepMountedRuntimeSession(
    mounted,
    core,
    hooks,
    maxEvents,
    maxInstructionsPerEvent,
  ).then((packet) => {
    if (packet === null) {
      mounted.summary.localSystemRuntimeNotifyErrors += 1;
      notifyRuntimeUpdate(hooks, mounted);
      return null;
    }
    updateRuntimeSessionState(mounted, packet);
    hooks.paint?.(mounted);
    notifyRuntimeUpdate(hooks, mounted);
    return packet;
  });
  mounted.startScenario = () => {
    if (mounted.stage === "scenario" && (mounted.player || mounted.scenarioPlayerQueued)) {
      return mounted.scenarioPlayerPromise ?? Promise.resolve(mounted.player ?? null);
    }
    mounted.stage = "scenario";
    return queueScenarioPlayer(catalog, core, mounted, hooks);
  };
  mounted.loadScenarioFromStorage = async (slotIndex = 0) => {
    let loadResult = null;
    mounted.stage = "scenario";
    const player = await queueScenarioPlayer(catalog, core, mounted, hooks, {
      afterReady: async (readyPlayer) => {
        loadResult = await readyPlayer.loadFromStorage(slotIndex);
        return loadResult;
      },
    });
    if (!player) {
      return { ok: false, bytes: 0, reason: "no_player" };
    }
    if (loadResult === null) {
      loadResult = await player.loadFromStorage(slotIndex);
    }
    mounted.summary.localRuntimeScenarioSessionLoadBytes = player.safeState.lastLoadBytes ?? 0;
    mounted.safeState.player = player.safeState;
    hooks.paint?.(mounted);
    notifyUpdate(hooks, mounted);
    return loadResult;
  };
  if (mounted.scenarioPreviewEnabled) {
    queueScenarioPlayer(catalog, core, mounted, hooks);
  }
  startSystemRuntime(catalog, core, mounted, hooks);
  queueScriptProbe(catalog, core, fullSummary, hooks);
  return mounted;
}

function startSystemRuntime(catalog, core, mounted, hooks) {
  const startedAt = performance.now();
  const markTiming = (stage) => {
    mounted.summary.localSystemRuntimeTimingStage = stage;
    mounted.summary.localSystemRuntimeTimingElapsedMs = Math.round(
      performance.now() - startedAt,
    );
  };
  let asyncStage = SYSTEM_RUNTIME_STAGE_CREATE;
  markTiming(SYSTEM_RUNTIME_TIMING_QUEUED);
  markTiming(SYSTEM_RUNTIME_TIMING_CREATE_BEGIN);
  void createRuntimeFromCatalog(catalog, core).then(async (runtimeState) => {
      if (!isActive(hooks, mounted) || runtimeState.handle === 0) {
        if (runtimeState.handle !== 0) {
          core.runtimeDestroy(runtimeState.handle);
        }
        if (isActive(hooks, mounted)) {
          markTiming(SYSTEM_RUNTIME_TIMING_CREATE_DONE);
          mounted.summary.localSystemRuntimeStatus = runtimeState.status;
          mounted.summary.localSystemRuntimeReady = 0;
          mounted.summary.localSystemRuntimeManifestCount = runtimeState.manifestCount;
          mounted.summary.localSystemRuntimeBootPayloadReady = runtimeState.bootPayloadReady;
          mounted.summary.localSystemRuntimeDscScriptCount = runtimeState.dscScripts;
          mounted.summary.localSystemRuntimeScriptCount = 0;
          mounted.summary.localSystemRuntimeSystemScriptCount = 0;
          mounted.summary.localSystemRuntimeScenarioScriptCount = 0;
          mounted.summary.localSystemRuntimeBootstrapReady = 0;
          notifyUpdate(hooks, mounted);
        }
        return;
      }
      const diagnosticsEnabled = runtimeDiagnosticsEnabled();
      asyncStage = SYSTEM_RUNTIME_STAGE_BOOT;
      markTiming(SYSTEM_RUNTIME_TIMING_CREATE_DONE);
      await yieldToMainThread();
      const bootstrap = core.runtimeBoot(runtimeState.handle);
      markTiming(SYSTEM_RUNTIME_TIMING_BOOT_DONE);
      const entryScriptIndex = runtimeState.entryScriptIndex;
      let graph9cProbe = null;
      let graph88Probe = null;
      let serviceTrace = null;
      let entryTrace = null;
      let entrySoundQueue = null;
      let entryGraphQueue = null;
      let staticEntryGraphQueue = null;
      mounted.runtimeHandle = runtimeState.handle;
      mounted.runtimeSessionHandle = 0;
      mounted.summary.localSystemRuntimeStatus =
        bootstrap === null ? SYSTEM_RUNTIME_BOOT_WRITE_FAILED : runtimeState.status;
      mounted.summary.localSystemRuntimeAsyncErrorStage = 0;
      mounted.runtimeSessionEntryName =
        runtimeState.entryScriptName ?? resolveSystemEntryRequest().displayName;
      asyncStage = SYSTEM_RUNTIME_STAGE_BOOTSTRAP_SUMMARY;
      mounted.summary.localSystemRuntimeReady = Number(bootstrap !== null);
      mounted.summary.localSystemRuntimeManifestCount = runtimeState.manifestCount;
      mounted.summary.localSystemRuntimeBootPayloadReady = runtimeState.bootPayloadReady;
      mounted.summary.localSystemRuntimeDscScriptCount = runtimeState.dscScripts;
      mounted.summary.localSystemRuntimeEntryScriptRequestedLen =
        mounted.runtimeSessionEntryName.length;
      mounted.summary.localSystemRuntimeEntryScriptRequestedHash =
        fnv1a32Text(mounted.runtimeSessionEntryName);
      mounted.summary.localSystemRuntimeEntryScriptResolved = Number(entryScriptIndex !== null);
      mounted.summary.localSystemRuntimeEntryScriptIndex =
        entryScriptIndex === null ? 0 : entryScriptIndex;
      mounted.summary.localSystemRuntimeScriptCount = bootstrap?.scriptCount ?? 0;
      mounted.summary.localSystemRuntimeSystemScriptCount = bootstrap?.systemScriptCount ?? 0;
      mounted.summary.localSystemRuntimeScenarioScriptCount = bootstrap?.scenarioScriptCount ?? 0;
      mounted.summary.localSystemRuntimeBootstrapReady = Number(bootstrap !== null);
      mounted.summary.localSystemRuntimeBootstrapEvents = bootstrap?.eventCount ?? 0;
      mounted.summary.localSystemRuntimeBootstrapServices = bootstrap?.serviceEventCount ?? 0;
      mounted.summary.localSystemRuntimeBootstrapUserCalls = bootstrap?.userCallEventCount ?? 0;
      mounted.summary.localSystemRuntimeBootstrapCompleted = bootstrap?.completed ?? 0;
      mounted.summary.localSystemRuntimeBootstrapLimited = bootstrap?.eventLimited ?? 0;
      mounted.summary.localSystemRuntimeBootstrapSys40 = bootstrap?.sys40Count ?? 0;
      mounted.summary.localSystemRuntimeBootstrapGraph88 = bootstrap?.graph88Count ?? 0;
      mounted.summary.localSystemRuntimeBootstrapGraph9c = bootstrap?.graph9cCount ?? 0;
      mounted.summary.localSystemRuntimeBootstrapSoundService = bootstrap?.soundServiceCount ?? 0;
      mounted.summary.localSystemRuntimeHostServiceCount = bootstrap?.hostState.serviceCount ?? 0;
      mounted.summary.localSystemRuntimeHostLoadProgramCount =
        bootstrap?.hostState.loadProgramCount ?? 0;
      mounted.summary.localSystemRuntimeHostFileQueryCount =
        bootstrap?.hostState.fileQueryCount ?? 0;
      mounted.summary.localSystemRuntimeHostGraphFormatCount =
        bootstrap?.hostState.graphFormatCount ?? 0;
      mounted.summary.localSystemRuntimeHostGraphRenderTextCount =
        bootstrap?.hostState.graphRenderTextCount ?? 0;
      mounted.summary.localSystemRuntimeHostSoundPlayCount =
        bootstrap?.hostState.soundPlayCount ?? 0;
      mounted.summary.localSystemRuntimeHostSoundServiceCount =
        bootstrap?.hostState.soundServiceCount ?? 0;
      mounted.summary.localSystemRuntimeHostLastSoundId =
        bootstrap?.hostState.lastSoundServiceId ?? 0;
      mounted.summary.localSystemRuntimeHostLastSoundArgCount =
        bootstrap?.hostState.lastSoundArgCount ?? 0;
      mounted.summary.localSystemRuntimeHostLastSoundIntegerArgs =
        bootstrap?.hostState.lastSoundIntegerArgCount ?? 0;
      mounted.summary.localSystemRuntimeHostLastAssetStringLen =
        bootstrap?.hostState.lastAssetStringLen ?? 0;
      mounted.summary.localSystemRuntimeHostLastAssetStringHash =
        bootstrap?.hostState.lastAssetStringHash ?? 0;
      mounted.summary.localSystemRuntimeHostLastAssetQueryServiceId =
        bootstrap?.hostState.lastAssetQueryServiceId ?? 0;
      mounted.summary.localSystemRuntimeHostLastAssetFound =
        bootstrap?.hostState.lastAssetFound ?? 0;
      mounted.summary.localSystemRuntimeHostLastLoadedScriptStringLen =
        bootstrap?.hostState.lastLoadedScriptStringLen ?? 0;
      mounted.summary.localSystemRuntimeHostLastLoadedScriptStringHash =
        bootstrap?.hostState.lastLoadedScriptStringHash ?? 0;
      mounted.summary.localSystemRuntimeHostLastLoadedScriptFound =
        bootstrap?.hostState.lastLoadedScriptFound ?? 0;
      mounted.summary.localSystemRuntimeHostSoundAfterAssetQueryCount =
        bootstrap?.hostState.soundAfterAssetQueryCount ?? 0;
      mounted.safeState.systemHost = bootstrap?.hostState ?? emptyHostState();
      if (diagnosticsEnabled && entryScriptIndex !== null) {
        asyncStage = SYSTEM_RUNTIME_STAGE_GRAPH_PROBES;
        await yieldToMainThread();
        graph9cProbe = core.runtimeSystemProbe(
          runtimeState.handle,
          entryScriptIndex,
          LOCAL_GRAPH9C_PROBE_OFFSET,
        );
        graph88Probe = core.runtimeSystemProbe(
          runtimeState.handle,
          entryScriptIndex,
          LOCAL_GRAPH88_PROBE_OFFSET,
        );
      }
      asyncStage = SYSTEM_RUNTIME_STAGE_PROBE_SUMMARY;
      mounted.summary.localSystemRuntimeGraph9cProbeReady = Number(graph9cProbe !== null);
      mounted.summary.localSystemRuntimeGraph9cProbeEvents = graph9cProbe?.eventCount ?? 0;
      mounted.summary.localSystemRuntimeGraph9cProbeGraph9c = graph9cProbe?.graph9cCount ?? 0;
      mounted.summary.localSystemRuntimeGraph9cProbeGraph88 = graph9cProbe?.graph88Count ?? 0;
      mounted.summary.localSystemRuntimeGraph9cProbeSoundService = graph9cProbe?.soundServiceCount ?? 0;
      mounted.summary.localSystemRuntimeGraph9cProbeFirstGraph9cArgs =
        graph9cProbe?.firstGraph9cArgCount ?? 0;
      mounted.summary.localSystemRuntimeGraph9cProbeFirstGraph9cTopKind =
        graph9cProbe?.firstGraph9cTopKind ?? 0;
      mounted.summary.localSystemRuntimeGraph88ProbeReady = Number(graph88Probe !== null);
      mounted.summary.localSystemRuntimeGraph88ProbeEvents = graph88Probe?.eventCount ?? 0;
      mounted.summary.localSystemRuntimeGraph88ProbeGraph9c = graph88Probe?.graph9cCount ?? 0;
      mounted.summary.localSystemRuntimeGraph88ProbeGraph88 = graph88Probe?.graph88Count ?? 0;
      mounted.summary.localSystemRuntimeGraph88ProbeSoundService = graph88Probe?.soundServiceCount ?? 0;
      mounted.summary.localSystemRuntimeGraph88ProbeFirstGraph88Args =
        graph88Probe?.firstGraph88ArgCount ?? 0;
      mounted.summary.localSystemRuntimeGraph88ProbeFirstGraph88TopKind =
        graph88Probe?.firstGraph88TopKind ?? 0;
      if (diagnosticsEnabled) {
        asyncStage = SYSTEM_RUNTIME_STAGE_TRACES;
        await yieldToMainThread();
        serviceTrace = core.runtimeServiceTrace(runtimeState.handle, 0, null, 32);
        if (entryScriptIndex !== null) {
          entryTrace = core.runtimeServiceTrace(
            runtimeState.handle,
            entryScriptIndex,
            null,
            32,
          );
        }
      }
      mounted.summary.localSystemRuntimeServiceTraceReady = Number(serviceTrace !== null);
      mounted.summary.localSystemRuntimeServiceTraceTotal = serviceTrace?.totalServiceCount ?? 0;
      mounted.summary.localSystemRuntimeServiceTraceRecorded = serviceTrace?.recordedCount ?? 0;
      const firstService = serviceTrace?.events?.[0] ?? null;
      mounted.summary.localSystemRuntimeServiceTraceFirstFamily = firstService?.family ?? 0;
      mounted.summary.localSystemRuntimeServiceTraceFirstId = firstService?.serviceId ?? 0;
      mounted.summary.localSystemRuntimeServiceTraceFirstArgs = firstService?.argCount ?? 0;
      mounted.summary.localSystemRuntimeServiceTraceFirstTopKind = firstService?.topKind ?? 0;
      mounted.safeState.serviceTrace = safeServiceTraceState(serviceTrace);
      asyncStage = SYSTEM_RUNTIME_STAGE_ENTRY_TRACE_SUMMARY;
      mounted.summary.localSystemRuntimeEntryTraceReady = Number(entryTrace !== null);
      mounted.summary.localSystemRuntimeEntryTraceTotal = entryTrace?.totalServiceCount ?? 0;
      const firstEntryService = entryTrace?.events?.[0] ?? null;
      mounted.summary.localSystemRuntimeEntryTraceFirstFamily = firstEntryService?.family ?? 0;
      mounted.summary.localSystemRuntimeEntryTraceFirstId = firstEntryService?.serviceId ?? 0;
      mounted.summary.localSystemRuntimeEntryTraceFirstArgs = firstEntryService?.argCount ?? 0;
      mounted.summary.localSystemRuntimeEntryTraceFirstStringArgs =
        firstEntryService?.stringArgCount ?? 0;
      mounted.summary.localSystemRuntimeEntryTraceFirstStringLen =
        firstEntryService?.firstStringLength ?? 0;
      mounted.summary.localSystemRuntimeEntryTraceFirstStringHash =
        firstEntryService?.firstStringHash ?? 0;
      mounted.summary.localSystemRuntimeEntryTraceFirstInstructionOffset =
        firstEntryService?.instructionOffset ?? 0;
      mounted.summary.localSystemRuntimeEntryTraceSoundPrefixCount =
        countSoundTracePrefix(entryTrace);
      mounted.summary.localSystemRuntimeEntryHostSoundServiceCount =
        entryTrace?.hostState?.soundServiceCount ?? 0;
      mounted.summary.localSystemRuntimeEntryHostLastSoundId =
        entryTrace?.hostState?.lastSoundServiceId ?? 0;
      mounted.summary.localSystemRuntimeEntryHostLastSoundArgCount =
        entryTrace?.hostState?.lastSoundArgCount ?? 0;
      mounted.summary.localSystemRuntimeEntryHostLastAssetStringLen =
        entryTrace?.hostState?.lastAssetStringLen ?? 0;
      mounted.summary.localSystemRuntimeEntryHostLastAssetStringHash =
        entryTrace?.hostState?.lastAssetStringHash ?? 0;
      mounted.summary.localSystemRuntimeEntryHostLastAssetFound =
        entryTrace?.hostState?.lastAssetFound ?? 0;
      mounted.summary.localSystemRuntimeEntryHostSoundAfterAssetQueryCount =
        entryTrace?.hostState?.soundAfterAssetQueryCount ?? 0;
      mounted.safeState.entryServiceTrace = safeServiceTraceState(entryTrace);
      if (entryScriptIndex !== null) {
        staticEntryGraphQueue = core.runtimeGraphQueue(runtimeState.handle, entryScriptIndex, null);
        mounted.runtimeSessionEntryScriptIndex = entryScriptIndex;
        mounted.runtimeSessionEntryOffset = null;
        const sessionHandle = core.runtimeSessionCreate(runtimeState.handle, entryScriptIndex, null);
        mounted.runtimeSessionHandle = sessionHandle;
        mounted.safeState.runtimeSession = createRuntimeSessionState();
        if (sessionHandle !== 0) {
          const firstStep = await warmMountedRuntimeSession(
            mounted,
            core,
            hooks,
          );
          if (firstStep === null) {
            core.runtimeSessionDestroy(sessionHandle);
            mounted.runtimeSessionHandle = 0;
          } else {
            entrySoundQueue = mounted.safeState.entrySoundQueue ?? null;
            entryGraphQueue = mounted.safeState.entryGraphQueue ?? null;
          }
        }
      }
      if (entrySoundQueue === null && diagnosticsEnabled && entryScriptIndex !== null) {
        asyncStage = SYSTEM_RUNTIME_STAGE_SOUND_QUEUE;
        await yieldToMainThread();
        entrySoundQueue = core.runtimeSoundQueue(runtimeState.handle, entryScriptIndex, null);
      }
      if (entryGraphQueue === null && staticEntryGraphQueue !== null) {
        entryGraphQueue = captureRuntimeGraphQueueMemory(
          core,
          mounted.runtimeSessionHandle,
          safeGraphQueueState(staticEntryGraphQueue),
          mounted.safeState.entryGraphQueue,
        );
      } else if (entryGraphQueue !== null && staticEntryGraphQueue !== null) {
        entryGraphQueue = mergeRuntimeQueueState(
          captureRuntimeGraphQueueMemory(
            core,
            mounted.runtimeSessionHandle,
            safeGraphQueueState(staticEntryGraphQueue),
            mounted.safeState.entryGraphQueue,
          ),
          entryGraphQueue,
        );
      }
      const firstSoundEvent = entrySoundQueue?.events?.[0] ?? null;
      const firstGraphEvent = entryGraphQueue?.events?.[0] ?? null;
      mounted.summary.localSystemRuntimeEntrySoundQueueReady = Number(entrySoundQueue !== null);
      mounted.summary.localSystemRuntimeEntrySoundQueueRecorded =
        entrySoundQueue?.recordedCount ?? entrySoundQueue?.recorded ?? 0;
      mounted.summary.localSystemRuntimeEntrySoundQueueFirstId =
        firstSoundEvent?.serviceId ?? 0;
      mounted.summary.localSystemRuntimeEntrySoundQueueFirstArgs =
        firstSoundEvent?.argCount ?? 0;
      mounted.summary.localSystemRuntimeEntrySoundQueueFirstOffset =
        firstSoundEvent?.instructionOffset ?? 0;
      if (entrySoundQueue !== null) {
        mounted.safeState.entrySoundQueue = safeSoundQueueState(entrySoundQueue);
      }
      mounted.summary.localSystemRuntimeEntryGraphQueueReady = Number(entryGraphQueue !== null);
      mounted.summary.localSystemRuntimeEntryGraphQueueRecorded =
        entryGraphQueue?.recordedCount ?? entryGraphQueue?.recorded ?? 0;
      mounted.summary.localSystemRuntimeEntryGraphQueueFirstId =
        firstGraphEvent?.serviceId ?? 0;
      mounted.summary.localSystemRuntimeEntryGraphQueueFirstArgs =
        firstGraphEvent?.argCount ?? 0;
      mounted.summary.localSystemRuntimeEntryGraphQueueFirstOffset =
        firstGraphEvent?.instructionOffset ?? 0;
      if (entryGraphQueue !== null) {
        mounted.safeState.entryGraphQueue = entryGraphQueue.ready === true
          ? entryGraphQueue
          : safeGraphQueueState(entryGraphQueue);
      }
      hooks.paint?.(mounted);
      asyncStage = SYSTEM_RUNTIME_STAGE_NOTIFY_BEGIN;
      notifyRuntimeUpdate(hooks, mounted);
      asyncStage = SYSTEM_RUNTIME_STAGE_NOTIFY_DONE;
      startRuntimeSessionLoop(mounted, core, hooks);
      asyncStage = SYSTEM_RUNTIME_STAGE_AUDIO_SCHEDULE_BEGIN;
      scheduleRuntimeAudioFinalization(mounted, hooks, entrySoundQueue);
      asyncStage = SYSTEM_RUNTIME_STAGE_AUDIO_SCHEDULE_DONE;
    }).catch((error) => {
      if (!isActive(hooks, mounted)) {
        return;
      }
      mounted.safeState.runtimeError = String(error?.stack ?? error ?? "unknown runtime error");
      if (asyncStage >= SYSTEM_RUNTIME_STAGE_NOTIFY_BEGIN) {
        mounted.summary.localSystemRuntimeAsyncErrorStage = asyncStage ?? 0;
        if (asyncStage >= SYSTEM_RUNTIME_STAGE_AUDIO_SCHEDULE_BEGIN) {
          mounted.summary.localRuntimeAudioPostErrors += 1;
        } else {
          mounted.summary.localSystemRuntimeNotifyErrors += 1;
        }
        notifyRuntimeUpdate(hooks, mounted);
        return;
      }
      mounted.summary.localSystemRuntimeStatus = SYSTEM_RUNTIME_ASYNC_ERROR;
      mounted.summary.localSystemRuntimeAsyncErrorStage = asyncStage ?? 0;
      mounted.summary.localSystemRuntimeReady = 0;
      mounted.summary.localSystemRuntimeScriptCount = 0;
      mounted.summary.localSystemRuntimeSystemScriptCount = 0;
      mounted.summary.localSystemRuntimeScenarioScriptCount = 0;
      mounted.summary.localSystemRuntimeBootstrapReady = 0;
      notifyUpdate(hooks, mounted);
    });
}

function queueScenarioPlayer(catalog, core, mounted, hooks, options = {}) {
  if (mounted.scenarioPlayerQueued || mounted.player) {
    return mounted.scenarioPlayerPromise ?? Promise.resolve(mounted.player ?? null);
  }
  mounted.scenarioPlayerQueued = true;
  const requestedScenario = new URLSearchParams(window.location.search).get("scenarioName") ?? "";
  const preferredScenario = /^[A-Za-z0-9_]+$/.test(requestedScenario)
    ? requestedScenario
    : "00_op_01";
  const route = normalizeScenarioRoute(
    new URLSearchParams(window.location.search).get("route"),
  );
  const promise = createInitialScenarioPlayer(catalog, core, preferredScenario, route).then(async (player) => {
    if (!isActive(hooks, mounted) || player === null) {
      player?.destroy();
      if (isActive(hooks, mounted)) {
        const probe = createInitialScenarioPlayer.lastProbe;
        mounted.summary.localRuntimeScenarioSessionScanCount = probe.scanned;
        mounted.summary.localRuntimeScenarioSessionScanSkipLarge = probe.skippedLarge;
        notifyUpdate(hooks, mounted);
      }
      return null;
    }
    mounted.player = player;
    player.skin = mounted.messageWindow;
    player.logSkin = mounted.logWindow;
    player.userDataSkin = mounted.userDataWindow;
    player.configSkin = mounted.configWindow;
    player.audioMixer = mounted.audioMixer;
    if (typeof options.afterReady === "function") {
      await options.afterReady(player);
    }
    const playerState = player.safeState;
    mounted.summary.localRuntimeScenarioSessionReady = Number(playerState.active === true);
    mounted.summary.localRuntimeScenarioSessionEventKind = playerState.eventKind ?? 0;
    mounted.summary.localRuntimeScenarioSessionMode = playerState.mode ?? 0;
    mounted.summary.localRuntimeScenarioSessionPayloadBytes = playerState.payloadLength ?? 0;
    mounted.summary.localRuntimeScenarioSessionSaveBytes = playerState.lastSaveBytes ?? 0;
    mounted.summary.localRuntimeScenarioSessionLoadBytes = playerState.lastLoadBytes ?? 0;
    mounted.summary.localRuntimeScenarioSessionScanCount = playerState.scanCount ?? 0;
    mounted.summary.localRuntimeScenarioSessionScanSkipLarge = playerState.scanSkippedLarge ?? 0;
    mounted.safeState.player = playerState;
    mounted.safeState.scriptCount =
      mounted.summary.localScenarioScripts + mounted.summary.localSystemScripts;
    hooks.paint?.(mounted);
    notifyUpdate(hooks, mounted);
    player.startAutomatic(() => {
      if (!isActive(hooks, mounted)) {
        return;
      }
      mounted.safeState.player = player.safeState;
      mounted.summary.localRuntimeScenarioSessionEventKind = player.safeState.eventKind ?? 0;
      mounted.summary.localRuntimeScenarioSessionMode = player.safeState.mode ?? 0;
      mounted.summary.localRuntimeScenarioSessionPayloadBytes =
        player.safeState.payloadLength ?? 0;
      hooks.paint?.(mounted);
      notifyUpdate(hooks, mounted);
    });
    return player;
  }).catch(() => {
    if (isActive(hooks, mounted)) {
      mounted.summary.localRuntimeScenarioSessionReady = 0;
      notifyUpdate(hooks, mounted);
    }
    return null;
  }).finally(() => {
    mounted.scenarioPlayerQueued = false;
    mounted.scenarioPlayerPromise = null;
  });
  mounted.scenarioPlayerPromise = promise;
  return promise;
}

function queueScriptProbe(catalog, core, fullSummary, hooks) {
  if (new URLSearchParams(window.location.search).get("deepProbe") !== "1") {
    return;
  }
  globalThis.setTimeout(() => {
    void probeLocalScripts(catalog, core).then((scriptSummary) => {
      if (!isSummaryActive(hooks, fullSummary)) {
        return;
      }
      Object.assign(fullSummary, scriptSummary);
      hooks.onSummary?.(fullSummary);
    });
  }, 0);
}

function emptyScriptProbeSummary() {
  return {
    localDscSummarized: 0,
    localDscInvalid: 0,
    localScenarioScripts: 0,
    localSystemScripts: 0,
    localScenarioEventMessages: 0,
    localScenarioEventChoices: 0,
    localScenarioVmFirstEvents: 0,
    localScenarioVmFirstInvalid: 0,
    localScenarioVmFirstEventKindText: "",
    localScenarioSessionProbes: 0,
    localScenarioSessionInvalid: 0,
    localScenarioSessionEventKindText: "",
    localScenarioSessionModeText: "",
    localScenarioSessionBacklogEntries: 0,
    localScenarioSessionRestoreMatches: 0,
    localSystemUserScriptCalls: 0,
    localSystemUserScriptDispatches: 0,
    localSystemUserScriptDispatchTop: "",
    localSystemTraceDispatchArgBucketText: "",
    localSystemTraceDispatchFfTopKindText: "",
    localSystemTraceDispatch00TopKindText: "",
    localSystemTraceExtFfTopKindText: "",
    localSystemTraceExtFfArgBucketText: "",
    localSystemTraceSound00TopKindText: "",
    localSystemTraceSound00ArgBucketText: "",
    localSystemTraceGraph68TopKindText: "",
    localSystemTraceGraph68ArgBucketText: "",
    localSystemVmFirstEvents: 0,
    localSystemVmFirstInvalid: 0,
    localSystemVmFirstEventKindText: "",
    localSystemVmDefaultHostEvents: 0,
    localSystemVmDefaultHostInvalid: 0,
    localSystemVmDefaultHostCompleted: 0,
    localSystemVmDefaultHostEventLimited: 0,
    localSystemVmDefaultHostLastEventKindText: "",
    localSystemGraphcalls: 0,
    localSystemSoundcalls: 0,
  };
}

async function createRuntimeFromCatalog(catalog, core) {
  const handle = core.runtimeCreate();
  if (handle === 0) {
    return { handle: 0, dscScripts: 0, manifestCount: 0, bootPayloadReady: 0, status: SYSTEM_RUNTIME_CREATE_FAILED };
  }
  let fullArchiveCount = 0;
  let fullArchiveBytes = 0;
  let manifestCount = 0;
  let mountedDscScripts = 0;
  const archives = Array.from(catalog.archives());
  const recordsByArchive = groupCatalogRecordsByArchive(catalog);
  for (let archiveIndex = 0; archiveIndex < archives.length; archiveIndex += 1) {
    const archive = archives[archiveIndex];
    const archiveRecords = recordsByArchive.get(archiveIndex) ?? [];
    if (archive.file && archive.size <= RUNTIME_FULL_ARCHIVE_MAX_BYTES) {
      const payload = new Uint8Array(await archive.file.arrayBuffer());
      if (core.runtimeMountArchiveData(handle, archive.name ?? new Uint8Array(), payload) !== 1) {
        core.runtimeDestroy(handle);
        return {
          handle: 0,
          dscScripts: mountedDscScripts,
          manifestCount,
          bootPayloadReady: 0,
          status: SYSTEM_RUNTIME_ARCHIVE_MOUNT_FAILED,
        };
      }
      fullArchiveCount += 1;
      fullArchiveBytes += archive.size;
      continue;
    }
    if (shouldMountArchiveDataEagerly(archive, archiveRecords)) {
      const fullArchive = await readCatalogArchivePayload(catalog, archiveIndex);
      if (fullArchive?.payload instanceof Uint8Array) {
        if (
          core.runtimeMountArchiveData(
            handle,
            archive.name ?? new Uint8Array(),
            fullArchive.payload,
          ) !== 1
        ) {
          core.runtimeDestroy(handle);
          return {
            handle: 0,
            dscScripts: mountedDscScripts,
            manifestCount,
            bootPayloadReady: 0,
            status: SYSTEM_RUNTIME_ARCHIVE_MOUNT_FAILED,
          };
        }
        mountedDscScripts += countMountedRuntimeScripts(
          handle,
          archiveRecords,
          core,
          isEagerSystemScriptRecord,
        );
        fullArchiveCount += 1;
        fullArchiveBytes += archive.size;
        if (archiveIndex % RUNTIME_CREATE_YIELD_INTERVAL === 0) {
          await yieldToMainThread();
        }
        continue;
      }
    }
    if (archive.manifest === null || !Number.isSafeInteger(archive.size)) {
      continue;
    }
    if (
      core.runtimeMountArchiveManifest(
        handle,
        archive.name ?? new Uint8Array(),
        archive.manifest,
        archive.size,
      ) !== 1
    ) {
      core.runtimeDestroy(handle);
      return {
        handle: 0,
        dscScripts: mountedDscScripts,
        manifestCount,
        bootPayloadReady: 0,
        status: SYSTEM_RUNTIME_ARCHIVE_MOUNT_FAILED,
      };
    }
    manifestCount += 1;
    mountedDscScripts += await mountRuntimeArchiveDscScripts(
      handle,
      archiveRecords,
      catalog,
      core,
      { eagerOnly: true },
    );
    if (archiveIndex % RUNTIME_CREATE_YIELD_INTERVAL === 0) {
      await yieldToMainThread();
    }
  }
  const bootName = new TextEncoder().encode("ipl._bp");
  let bootPayloadReady = 1;
  if (core.runtimeScriptIndexByName(handle, bootName) === null) {
    const bootPayload = await catalog.readPayloadByNameBytes(bootName);
    if (bootPayload === null) {
      core.runtimeDestroy(handle);
      return {
        handle: 0,
        dscScripts: mountedDscScripts,
        manifestCount,
        bootPayloadReady: 0,
        status: SYSTEM_RUNTIME_BOOT_PAYLOAD_MISSING,
      };
    }
    if (core.runtimeMountDscScript(handle, bootName, bootPayload) === 0) {
      core.runtimeDestroy(handle);
      return {
        handle: 0,
        dscScripts: mountedDscScripts,
        manifestCount,
        bootPayloadReady: 1,
        status: SYSTEM_RUNTIME_BOOT_MOUNT_FAILED,
      };
    }
    mountedDscScripts += 1;
    bootPayloadReady = 1;
  }
  const entryRequest = resolveSystemEntryRequest();
  const entryScriptIndex = entryRequest.index ?? core.runtimeScriptIndexByName(
    handle,
    encodeSystemEntryName(entryRequest.name),
  );
  return {
    handle,
    dscScripts: mountedDscScripts,
    entryScriptIndex,
    entryScriptName: entryRequest.displayName,
    manifestCount,
    fullArchiveCount,
    fullArchiveBytes,
    bootPayloadReady,
    status: SYSTEM_RUNTIME_OK,
  };
}

function isEagerSystemScriptRecord(record) {
  if (!(record?.name instanceof Uint8Array) || record.name.byteLength < 4) {
    return false;
  }
  const name = new TextDecoder("ascii").decode(record.name).toLowerCase();
  return name.endsWith("._bp");
}

function shouldMountArchiveDataEagerly(archive, records) {
  return !archive?.file
    && Number.isSafeInteger(archive?.size)
    && archive.size <= RUNTIME_FULL_ARCHIVE_MAX_BYTES
    && records.some(isEagerSystemScriptRecord);
}

function countMountedRuntimeScripts(handle, records, core, predicate = () => true) {
  let count = 0;
  for (const record of records) {
    if (!predicate(record)) {
      continue;
    }
    if (core.runtimeScriptIndexByName(handle, record.name) !== null) {
      count += 1;
    }
  }
  return count;
}

function groupCatalogRecordsByArchive(catalog) {
  const grouped = new Map();
  for (const record of catalog.records()) {
    const archiveIndex = record?.archiveIndex;
    if (!Number.isInteger(archiveIndex) || archiveIndex < 0) {
      continue;
    }
    const bucket = grouped.get(archiveIndex);
    if (bucket) {
      bucket.push(record);
      continue;
    }
    grouped.set(archiveIndex, [record]);
  }
  return grouped;
}

async function mountRuntimeArchiveDscScripts(handle, records, catalog, core, options = {}) {
  let mounted = 0;
  const eagerOnly = options.eagerOnly === true;
  const candidates = eagerOnly ? records.filter(isEagerSystemScriptRecord) : records;
  let scanned = 0;
  for (const record of candidates) {
    scanned += 1;
    if (!await isDscCatalogRecord(record, catalog, core)) {
      if (scanned % RUNTIME_CREATE_YIELD_INTERVAL === 0) {
        await yieldToMainThread();
      }
      continue;
    }
    const payload = await catalog.readPayload(record);
    if (core.runtimeMountDscScript(handle, record.name, payload) !== 0) {
      mounted += 1;
    }
    if (scanned % RUNTIME_CREATE_YIELD_INTERVAL === 0) {
      await yieldToMainThread();
    }
  }
  return mounted;
}

async function isDscCatalogRecord(record, catalog, core) {
  if (record?.kind === PAYLOAD_KIND_DSC) {
    return true;
  }
  if (record?.kind !== null) {
    return false;
  }
  const prefix = await catalog.readPrefix(record, DSC_PREFIX_LEN);
  return core.payloadKind(prefix) === PAYLOAD_KIND_DSC;
}

async function readCatalogArchivePayload(catalog, archiveIndex) {
  let selected = null;
  let currentIndex = 0;
  for (const archive of catalog.archives()) {
    if (currentIndex === archiveIndex) {
      selected = archive;
      break;
    }
    currentIndex += 1;
  }
  if (!selected?.name) {
    return null;
  }
  const payload = await catalog.readArchivePayloadByNameBytes(selected.name);
  if (!(payload instanceof Uint8Array)) {
    return null;
  }
  return {
    payload,
    dataStart: selected.dataStart ?? 0,
  };
}

async function probeLocalCbg(catalog, core) {
  let largeSkipped = 0;
  for (const record of catalog.recordsByKind(PAYLOAD_KIND_COMPRESSED_BG)) {
    if (record.kind !== PAYLOAD_KIND_COMPRESSED_BG) {
      if (record.kind !== null) {
        continue;
      }
      const prefix = await catalog.readPrefix(record, CBG_HEADER_LEN);
      if (core.payloadKind(prefix.slice(0, 16)) !== PAYLOAD_KIND_COMPRESSED_BG) {
        continue;
      }
      if (prefix.byteLength < CBG_HEADER_LEN) {
        continue;
      }
      if (cbgPixelCount(prefix) > LOCAL_CBG_PROBE_MAX_PIXELS) {
        largeSkipped += 1;
        continue;
      }
      const payload = await catalog.readPayload(record);
      const rgba = decodeMountedImage(core, payload);
      return { image: rgba, summary: { localCbgDecoded: rgba === null ? 0 : 1, localCbgLargeSkipped: largeSkipped } };
    }
    if (record.meta?.pixels && record.meta.pixels > LOCAL_CBG_PROBE_MAX_PIXELS) {
      largeSkipped += 1;
      continue;
    }
    const prefix = await catalog.readPrefix(record, CBG_HEADER_LEN);
    if (prefix.byteLength < CBG_HEADER_LEN) {
      continue;
    }
    if (cbgPixelCount(prefix) > LOCAL_CBG_PROBE_MAX_PIXELS) {
      largeSkipped += 1;
      continue;
    }
    const payload = await catalog.readPayload(record);
    const rgba = decodeMountedImage(core, payload);
    return { image: rgba, summary: { localCbgDecoded: rgba === null ? 0 : 1, localCbgLargeSkipped: largeSkipped } };
  }
  return { image: null, summary: { localCbgDecoded: 0, localCbgLargeSkipped: largeSkipped } };
}

async function loadBootScreens(catalog, core) {
  const names = ["makuralogo", "att01", "att02"];
  const screens = [];
  for (const name of names) {
    try {
      const payload = await catalog.readPayloadByNameBytes(new TextEncoder().encode(name));
      if (!payload) continue;
      const image = decodeMountedImage(core, payload);
      if (image) screens.push({ name, image });
    } catch (_) {}
  }
  return screens;
}

async function loadMenuButtons(catalog, core) {
  // Title menu buttons are 4-state sprite sheets (idle/hover/pressed/disabled), states laid out horizontally.
  const defs = [["Start","SGTitle000000"],["Load","SGTitle000100"],["Config","SGTitle000200"],["Exit","SGTitle000300"]];
  const out = [];
  for (const [label, name] of defs) {
    try {
      const payload = await catalog.readPayloadByNameBytes(new TextEncoder().encode(name));
      if (!payload) continue;
      const image = decodeMountedImage(core, payload);
      if (image) out.push({ label, image, stateWidth: Math.floor(image.width / 4), stateHeight: image.height });
    } catch (_) {}
  }
  return out;
}

async function loadTitleImage(catalog, core) {
  try {
    const payload = await catalog.readPayloadByNameBytes(new TextEncoder().encode("SGTitle990000"));
    if (!payload) return null;
    return decodeMountedImage(core, payload);
  } catch (_) {
    return null;
  }
}

async function loadMessageWindow(catalog, core) {
  const controlNames = Array.from(
    { length: 10 },
    (_, index) => `SGMsgWnd000${index}00`,
  );
  const [panel, nameplate, ...controlImages] = await Promise.all([
    loadNamedImage(catalog, core, "SGMsgWnd990000"),
    loadNamedImage(catalog, core, "SGMsgWnd990100"),
    ...controlNames.map((name) => loadNamedImage(catalog, core, name)),
  ]);
  return {
    panel,
    nameplate,
    controls: controlImages
      .filter((image) => image !== null)
      .map((image) => ({
        image,
        stateWidth: Math.floor(image.width / 4),
        stateHeight: image.height,
      })),
  };
}

async function loadLogWindow(catalog, core) {
  const [
    lineUp,
    lineDown,
    pageUp,
    pageDown,
    thumb,
    voice,
    panel,
    track,
  ] = await Promise.all([
    loadNamedImage(catalog, core, "SGLogWnd000000"),
    loadNamedImage(catalog, core, "SGLogWnd000100"),
    loadNamedImage(catalog, core, "SGLogWnd010000"),
    loadNamedImage(catalog, core, "SGLogWnd010100"),
    loadNamedImage(catalog, core, "SGLogWnd100000"),
    loadNamedImage(catalog, core, "SGLogWnd200000"),
    loadNamedImage(catalog, core, "SGLogWnd990000"),
    loadNamedImage(catalog, core, "SGLogWnd990100"),
  ]);
  return {
    panel,
    track,
    lineUp: logControl(lineUp),
    lineDown: logControl(lineDown),
    pageUp: logControl(pageUp),
    pageDown: logControl(pageDown),
    thumb: logControl(thumb),
    voice: logControl(voice),
  };
}

async function loadUserDataWindow(catalog, core) {
  const [
    saveBase,
    loadBase,
    saveSlot,
    loadSlot,
    previous,
    next,
    load,
    back,
    save,
    ...digits
  ] = await Promise.all([
    loadNamedImage(catalog, core, "SGUsDtWnd990000"),
    loadNamedImage(catalog, core, "SGUsDtWnd990100"),
    loadNamedImage(catalog, core, "SGUsDtWnd900000"),
    loadNamedImage(catalog, core, "SGUsDtWnd900100"),
    loadNamedImage(catalog, core, "SGUsDtWnd100000"),
    loadNamedImage(catalog, core, "SGUsDtWnd100100"),
    loadNamedImage(catalog, core, "SGUsDtWnd200000"),
    loadNamedImage(catalog, core, "SGUsDtWnd200100"),
    loadNamedImage(catalog, core, "SGUsDtWnd200600"),
    ...Array.from(
      { length: 10 },
      (_, index) => loadNamedImage(catalog, core, `SGUsDtWnd00000${index}`),
    ),
  ]);
  return {
    saveBase,
    loadBase,
    saveSlot,
    loadSlot,
    buttons: { previous, next, load, back, save },
    digits,
  };
}

async function loadConfigWindow(catalog, core) {
  const [
    base,
    sliderMarker,
    windowed,
    fullscreen,
    skipRead,
    skipAll,
    choiceSkipOff,
    choiceSkipOn,
    choiceAutoOff,
    choiceAutoOn,
    instantTransitionOff,
    instantTransitionOn,
    carryVoiceOff,
    carryVoiceOn,
    reset,
    title,
    back,
    ...faces
  ] = await Promise.all([
    loadNamedImage(catalog, core, "SGCnfgWnd990000"),
    loadNamedImage(catalog, core, "SGCnfgWnd000000"),
    loadNamedImage(catalog, core, "SGCnfgWnd010000"),
    loadNamedImage(catalog, core, "SGCnfgWnd010100"),
    loadNamedImage(catalog, core, "SGCnfgWnd020000"),
    loadNamedImage(catalog, core, "SGCnfgWnd020100"),
    loadNamedImage(catalog, core, "SGCnfgWnd030000"),
    loadNamedImage(catalog, core, "SGCnfgWnd030100"),
    loadNamedImage(catalog, core, "SGCnfgWnd040000"),
    loadNamedImage(catalog, core, "SGCnfgWnd040100"),
    loadNamedImage(catalog, core, "SGCnfgWnd050000"),
    loadNamedImage(catalog, core, "SGCnfgWnd050100"),
    loadNamedImage(catalog, core, "SGCnfgWnd060000"),
    loadNamedImage(catalog, core, "SGCnfgWnd060100"),
    loadNamedImage(catalog, core, "SGCnfgWnd200000"),
    loadNamedImage(catalog, core, "SGCnfgWnd200100"),
    loadNamedImage(catalog, core, "SGCnfgWnd200200"),
    ...[
      "SGCnfgWnd100000",
      "SGCnfgWnd100100",
      "SGCnfgWnd100200",
      "SGCnfgWnd100300",
      "SGCnfgWnd100400",
      "SGCnfgWnd100500",
      "SGCnfgWnd110000",
      "SGCnfgWnd110100",
    ].map((name) => loadNamedImage(catalog, core, name)),
  ]);
  return {
    base,
    sliderMarker,
    rows: {
      window: windowed,
      fullscreen,
      skipRead,
      skipAll,
      choiceSkipOff,
      choiceSkipOn,
      choiceAutoOff,
      choiceAutoOn,
      instantTransitionOff,
      instantTransitionOn,
      carryVoiceOff,
      carryVoiceOn,
    },
    buttons: { reset, title, back },
    faces,
  };
}

function logControl(image) {
  if (image === null) return null;
  return {
    image,
    stateWidth: Math.floor(image.width / 2),
    stateHeight: image.height,
  };
}

async function loadNamedImage(catalog, core, name) {
  try {
    const payload = await catalog.readPayloadByNameBytes(new TextEncoder().encode(name));
    return payload ? decodeMountedImage(core, payload) : null;
  } catch {
    return null;
  }
}

function decodeMountedImage(core, payload) {
  const decode = core?.imageRgba ?? core?.cbgRgba ?? null;
  return typeof decode === "function" ? decode(payload) : null;
}

async function probeLocalAudio(catalog, core) {
  for (const record of catalog.recordsByKind(PAYLOAD_KIND_BGI_AUDIO)) {
    if (record.kind !== PAYLOAD_KIND_BGI_AUDIO) {
      if (record.kind !== null) {
        continue;
      }
      const prefix = await catalog.readPrefix(record, 16);
      if (core.payloadKind(prefix.slice(0, 8)) !== PAYLOAD_KIND_BGI_AUDIO) {
        continue;
      }
    }
    const payload = await catalog.readPayload(record);
    const ogg = core.bgiAudioOgg(payload);
    if (ogg === null) {
      continue;
    }
    return {
      ogg,
      summary: {
        localAudioUnwrapped:
          new TextDecoder("ascii").decode(ogg.slice(0, 4)) === "OggS" ? 1 : 0,
      },
    };
  }
  return { ogg: null, summary: { localAudioUnwrapped: 0 } };
}

function cbgPixelCount(header) {
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  return view.getUint16(0x10, true) * view.getUint16(0x12, true);
}

function bytesEqual(left, right) {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function isActive(hooks, mounted) {
  return hooks.isActive?.(mounted) ?? true;
}

function isSummaryActive(hooks, summary) {
  return hooks.isSummaryActive?.(summary) ?? true;
}

function notifyUpdate(hooks, mounted) {
  hooks.onUpdate?.(mounted);
}

function notifyRuntimeUpdate(hooks, mounted) {
  try {
    notifyUpdate(hooks, mounted);
  } catch {
    mounted.summary.localSystemRuntimeNotifyErrors += 1;
  }
}

function updateAudioMixerSummary(mounted) {
  syncMountedAudioState(mounted);
}

function prepareAudioMixer(mounted, ogg, queue) {
  mounted.summary.localRuntimeAudioPrepareAttempts += 1;
  try {
    mounted.audioMixer.prepare(ogg, queue);
  } catch {
    mounted.summary.localRuntimeAudioPrepareErrors += 1;
  }
}

function finalizeRuntimeAudio(mounted, hooks, ogg, queue) {
  try {
    mounted.summary.localRuntimeAudioPostStage = 1;
    prepareAudioMixer(mounted, ogg, queue);
    mounted.summary.localRuntimeAudioPostStage = 2;
    updateAudioMixerSummary(mounted);
    mounted.summary.localRuntimeAudioPostStage = 3;
    publishAudioControl(mounted, hooks);
    mounted.summary.localRuntimeAudioPostStage = 4;
  } catch {
    mounted.summary.localRuntimeAudioPostErrors += 1;
    updateAudioMixerSummary(mounted);
  }
}

function scheduleRuntimeAudioFinalization(mounted, hooks, queue) {
  try {
    mounted.summary.localRuntimeAudioScheduleErrors = 0;
    const timer = globalThis.setTimeout;
    if (typeof timer !== "function") {
      mounted.summary.localRuntimeAudioScheduleErrors = 1;
      mounted.summary.localRuntimeAudioPostErrors += 1;
      return;
    }
    globalThis.setTimeout(() => {
      if (!isActive(hooks, mounted)) {
        return;
      }
      finalizeRuntimeAudio(mounted, hooks, mounted.audioOgg, queue);
      notifyRuntimeUpdate(hooks, mounted);
    }, 0);
  } catch {
    mounted.summary.localRuntimeAudioPostErrors += 1;
  }
}

function publishAudioControl(mounted, hooks) {
  const playQueued = async () => {
    const result = await mounted.audioMixer.playFirstQueued();
    updateAudioMixerSummary(mounted);
    notifyRuntimeUpdate(hooks, mounted);
    return result;
  };
  globalThis.sakuraPlayQueuedAudio = playQueued;
  globalThis.__sakuraPlayQueuedAudio = playQueued;
  if (typeof globalThis.window === "object" && globalThis.window !== null) {
    globalThis.window.sakuraPlayQueuedAudio = playQueued;
    globalThis.window.__sakuraPlayQueuedAudio = playQueued;
  }
}

function createRuntimeSessionState() {
  return {
    ready: false,
    steps: 0,
    entryScriptName: "",
    entryScriptIndex: 0,
    pendingAsset: null,
    serviceTrace: { ready: false, total: 0, recorded: 0, events: [], hostState: {} },
    last: null,
    recent: [],
  };
}

function updateRuntimeSessionState(mounted, packet) {
  const nextSteps = (mounted.safeState.runtimeSession?.steps ?? 0) + 1;
  const recent = [packet, ...(mounted.safeState.runtimeSession?.recent ?? [])]
    .slice(0, RUNTIME_SESSION_HISTORY_LIMIT);
  mounted.safeState.runtimeSession = {
    ready: true,
    steps: nextSteps,
    entryScriptName: mounted.runtimeSessionEntryName ?? "",
    entryScriptIndex: mounted.runtimeSessionEntryScriptIndex ?? 0,
    pendingAsset: packet.pendingAsset ?? null,
    serviceTrace: mounted.safeState.runtimeSession?.serviceTrace
      ?? { ready: false, total: 0, recorded: 0, events: [], hostState: {} },
    last: packet,
    recent,
  };
  mounted.summary.localSystemRuntimeSessionReady = 1;
  mounted.summary.localSystemRuntimeSessionStepCount = nextSteps;
  mounted.summary.localSystemRuntimeSessionLastEventCount = packet.eventCount ?? 0;
  mounted.summary.localSystemRuntimeSessionLastServiceCount = packet.serviceEventCount ?? 0;
  mounted.summary.localSystemRuntimeSessionLastCompleted = Number(packet.completed === true);
  mounted.summary.localSystemRuntimeSessionLastLimited = Number(packet.eventLimited === true);
  mounted.summary.localSystemRuntimeSessionLastFamily = packet.lastFamily ?? 0;
  mounted.summary.localSystemRuntimeSessionLastId = packet.lastServiceId ?? 0;
  mounted.summary.localSystemRuntimeSessionLastArgCount = packet.lastArgCount ?? 0;
  mounted.summary.localSystemRuntimeSessionLastTopKind = packet.lastTopKind ?? 0;
  mounted.summary.localSystemRuntimeSessionFrameScriptIndex = packet.frameScriptIndex ?? 0;
  mounted.summary.localSystemRuntimeSessionFrameCursor = packet.frameCursor ?? 0;
  mounted.summary.localSystemRuntimeSessionFrameLastInstructionOffset =
    packet.frameLastInstructionOffset ?? 0;
  mounted.summary.localSystemRuntimeSessionHostServiceCount = packet.hostServiceCount ?? 0;
  mounted.summary.localSystemRuntimeSessionHostFileQueryCount = packet.hostFileQueryCount ?? 0;
  mounted.summary.localSystemRuntimeSessionHostGraphFormatCount =
    packet.hostGraphFormatCount ?? 0;
  mounted.summary.localSystemRuntimeSessionHostGraphRenderTextCount =
    packet.hostGraphRenderTextCount ?? 0;
  mounted.summary.localSystemRuntimeSessionHostSoundServiceCount =
    packet.hostSoundServiceCount ?? 0;
  mounted.summary.localSystemRuntimeSessionHostLastAssetQueryServiceId =
    packet.hostLastAssetQueryServiceId ?? 0;
  mounted.summary.localSystemRuntimeSessionHostLastAssetFound =
    Number(packet.hostLastAssetFound === true);
  mounted.summary.localSystemRuntimeSessionHostLastLoadedScriptStringLen =
    packet.hostLastLoadedScriptStringLen ?? 0;
  mounted.summary.localSystemRuntimeSessionHostLastLoadedScriptFound =
    Number(packet.hostLastLoadedScriptFound === true);
  mounted.summary.localSystemRuntimeSessionHostSoundAfterAssetQueryCount =
    packet.hostSoundAfterAssetQueryCount ?? 0;
  mounted.summary.localSystemRuntimeSessionSys1cCount = packet.sys1cCount ?? 0;
  mounted.summary.localSystemRuntimeSessionSys49Count = packet.sys49Count ?? 0;
  mounted.summary.localSystemRuntimeSessionSys5fCount = packet.sys5fCount ?? 0;
  mounted.summary.localSystemRuntimeSessionGraphBfCount = packet.graphBfCount ?? 0;
  mounted.summary.localSystemRuntimeSessionLocal44 = packet.local44 ?? 0;
  mounted.summary.localSystemRuntimeSessionLocal48 = packet.local48 ?? 0;
  mounted.summary.localSystemRuntimeSessionLocal64 = packet.local64 ?? 0;
  mounted.summary.localSystemRuntimeSessionLocal68 = packet.local68 ?? 0;
  mounted.summary.localSystemRuntimeSessionLocal1076 = packet.local1076 ?? 0;
  mounted.summary.localSystemRuntimeSessionLocal1152 = packet.local1152 ?? 0;
  mounted.summary.localSystemRuntimeSessionLocal3952 = packet.local3952 ?? 0;
  mounted.summary.localSystemRuntimeSessionLocal3956 = packet.local3956 ?? 0;
  mounted.summary.localSystemRuntimeSessionLocal3992 = packet.local3992 ?? 0;
  mounted.summary.localSystemRuntimeSessionLocal3996 = packet.local3996 ?? 0;
  mounted.summary.localSystemRuntimeSessionLocal4024 = packet.local4024 ?? 0;
  mounted.summary.localSystemRuntimeSessionLocal4028 = packet.local4028 ?? 0;
  mounted.summary.localSystemRuntimeSessionLocal7100 = packet.local7100 ?? 0;
  mounted.summary.localSystemRuntimeSessionLocal7104 = packet.local7104 ?? 0;
  mounted.summary.localSystemRuntimeSessionLocal7108 = packet.local7108 ?? 0;
  mounted.summary.localSystemRuntimeSessionLocal7112 = packet.local7112 ?? 0;
  mounted.summary.localSystemRuntimeHostServiceCount = packet.hostServiceCount ?? 0;
  mounted.summary.localSystemRuntimeHostFileQueryCount = packet.hostFileQueryCount ?? 0;
  mounted.summary.localSystemRuntimeHostGraphFormatCount = packet.hostGraphFormatCount ?? 0;
  mounted.summary.localSystemRuntimeHostGraphRenderTextCount =
    packet.hostGraphRenderTextCount ?? 0;
  mounted.summary.localSystemRuntimeHostSoundServiceCount = packet.hostSoundServiceCount ?? 0;
  mounted.summary.localSystemRuntimeHostLastAssetQueryServiceId =
    packet.hostLastAssetQueryServiceId ?? 0;
  mounted.summary.localSystemRuntimeHostLastAssetFound = Number(packet.hostLastAssetFound === true);
  mounted.summary.localSystemRuntimeHostLastLoadedScriptStringLen =
    packet.hostLastLoadedScriptStringLen ?? 0;
  mounted.summary.localSystemRuntimeHostLastLoadedScriptFound =
    Number(packet.hostLastLoadedScriptFound === true);
  mounted.summary.localSystemRuntimeHostSoundAfterAssetQueryCount =
    packet.hostSoundAfterAssetQueryCount ?? 0;
  mounted.safeState.systemHost = {
    ...mounted.safeState.systemHost,
    serviceCount: packet.hostServiceCount ?? 0,
    lastFamily: packet.lastFamily ?? 0,
    lastServiceId: packet.lastServiceId ?? 0,
    lastArgCount: packet.lastArgCount ?? 0,
    lastTopKind: packet.lastTopKind ?? 0,
    fileQueryCount: packet.hostFileQueryCount ?? 0,
    graphFormatCount: packet.hostGraphFormatCount ?? 0,
    graphRenderTextCount: packet.hostGraphRenderTextCount ?? 0,
    soundServiceCount: packet.hostSoundServiceCount ?? 0,
    lastAssetQueryServiceId: packet.hostLastAssetQueryServiceId ?? 0,
    lastAssetFound: Number(packet.hostLastAssetFound === true),
    lastLoadedScriptStringLen: packet.hostLastLoadedScriptStringLen ?? 0,
    lastLoadedScriptFound: Number(packet.hostLastLoadedScriptFound === true),
    soundAfterAssetQueryCount: packet.hostSoundAfterAssetQueryCount ?? 0,
  };
}

async function resolveMountedRuntimePendingAsset(mounted, core) {
  if (mounted.destroyed || mounted.runtimeSessionHandle === 0) {
    return false;
  }
  const pending = core.runtimeSessionPendingAsset(mounted.runtimeSessionHandle);
  if (pending === null || !(pending.name instanceof Uint8Array)) {
    return false;
  }
  const payload = await mounted.catalog.readPayloadByNameBytes(pending.name)
    ?? await mounted.catalog.readArchivePayloadByNameBytes(pending.name);
  if (payload === null) {
    return false;
  }
  return core.runtimeSessionSupplyAsset(
    mounted.runtimeSessionHandle,
    pending.name,
    payload,
  ) === 1;
}

function startRuntimeSessionLoop(mounted, core, hooks) {
  stopRuntimeSessionLoop(mounted);
  if (mounted.destroyed || mounted.runtimeSessionHandle === 0) {
    return;
  }
  if (mounted.runtimeSessionPaused) {
    return;
  }
  const tick = () => {
    mounted.runtimeSessionTimer = 0;
    if (
      mounted.destroyed ||
      mounted.runtimeSessionHandle === 0 ||
      mounted.runtimeSessionPaused ||
      !isActive(hooks, mounted)
    ) {
      return;
    }
    void (async () => {
      let shouldContinue = true;
      try {
        const packet = await stepMountedRuntimeSession(
          mounted,
          core,
          hooks,
          RUNTIME_SESSION_TICK_EVENTS,
          RUNTIME_SESSION_MAX_INSTRUCTIONS,
        );
        if (packet === null) {
          mounted.summary.localSystemRuntimeNotifyErrors += 1;
          notifyRuntimeUpdate(hooks, mounted);
          shouldContinue = false;
          return;
        }
        updateRuntimeSessionState(mounted, packet);
        hooks.paint?.(mounted);
        notifyRuntimeUpdate(hooks, mounted);
        if (packet.completed === true) {
          shouldContinue = restartMountedRuntimeSession(mounted, core);
        }
      } catch (error) {
        mounted.summary.localSystemRuntimeNotifyErrors += 1;
        mounted.safeState.runtimeError = String(error?.stack ?? error ?? "runtime session loop error");
        notifyRuntimeUpdate(hooks, mounted);
        shouldContinue = false;
      } finally {
        if (
          shouldContinue
          && !mounted.destroyed
          && mounted.runtimeSessionHandle !== 0
          && mounted.runtimeSessionPaused !== true
          && isActive(hooks, mounted)
        ) {
          mounted.runtimeSessionTimer = globalThis.setTimeout(tick, RUNTIME_SESSION_TICK_MS);
        }
      }
    })();
  };
  mounted.runtimeSessionTimer = globalThis.setTimeout(tick, RUNTIME_SESSION_TICK_MS);
}

export async function stepMountedRuntimeSession(
  mounted,
  core,
  hooks,
  maxEvents = 1,
  maxInstructionsPerEvent = RUNTIME_SESSION_MAX_INSTRUCTIONS,
) {
  if (mounted.destroyed || mounted.runtimeSessionHandle === 0) {
    return null;
  }
  const runtimeInput = hooks.runtimeInput?.() ?? null;
  if (runtimeInput !== null && mounted.runtimeHandle !== 0) {
    core.runtimeSetInput(mounted.runtimeHandle, runtimeInput);
  }
  const packet = core.runtimeSessionStep(
    mounted.runtimeSessionHandle,
    maxEvents,
    maxInstructionsPerEvent,
  );
  if (packet?.pendingAsset) {
    updateRuntimeSessionQueues(mounted, core, hooks);
    const supplied = await resolveMountedRuntimePendingAsset(mounted, core);
    if (!supplied) {
      return packet;
    }
    const resumed = core.runtimeSessionStep(
      mounted.runtimeSessionHandle,
      maxEvents,
      maxInstructionsPerEvent,
    );
    if (resumed !== null) {
      updateRuntimeSessionQueues(mounted, core, hooks);
    }
    return resumed;
  }
  if (packet !== null) {
    updateRuntimeSessionQueues(mounted, core, hooks);
  }
  return packet;
}

export function restartMountedRuntimeSession(mounted, core) {
  if (
    mounted.destroyed ||
    mounted.runtimeHandle === 0 ||
    !Number.isInteger(mounted.runtimeSessionEntryScriptIndex)
  ) {
    return false;
  }
  if (mounted.runtimeSessionHandle !== 0) {
    core.runtimeSessionDestroy(mounted.runtimeSessionHandle);
    mounted.runtimeSessionHandle = 0;
  }
  const sessionHandle = core.runtimeSessionCreate(
    mounted.runtimeHandle,
    mounted.runtimeSessionEntryScriptIndex,
    mounted.runtimeSessionEntryOffset,
  );
  if (sessionHandle === 0) {
    return false;
  }
  mounted.runtimeSessionHandle = sessionHandle;
  mounted.safeState.runtimeSession = createRuntimeSessionState();
  return true;
}

function updateRuntimeSessionQueues(mounted, core, hooks) {
  let soundQueueChanged = false;
  let graphQueueChanged = false;
  if (mounted.runtimeSessionHandle === 0) {
    return;
  }
  const serviceTrace = core.runtimeSessionServiceTrace(mounted.runtimeSessionHandle);
  if (serviceTrace !== null) {
    const safeTrace = safeServiceTraceState(serviceTrace);
    const firstServiceEvent = safeTrace.events?.[0] ?? null;
    mounted.summary.localSystemRuntimeSessionTraceReady = 1;
    mounted.summary.localSystemRuntimeSessionTraceTotal = safeTrace.total ?? 0;
    mounted.summary.localSystemRuntimeSessionTraceRecorded = safeTrace.recorded ?? 0;
    mounted.summary.localSystemRuntimeSessionTraceFirstFamily = firstServiceEvent?.family ?? 0;
    mounted.summary.localSystemRuntimeSessionTraceFirstId = firstServiceEvent?.serviceId ?? 0;
    mounted.summary.localSystemRuntimeSessionTraceFirstArgs = firstServiceEvent?.argCount ?? 0;
    mounted.summary.localSystemRuntimeSessionTraceFirstStringArgs =
      firstServiceEvent?.stringArgCount ?? 0;
    mounted.summary.localSystemRuntimeSessionTraceFirstStringLen =
      firstServiceEvent?.firstStringLength ?? 0;
    mounted.summary.localSystemRuntimeSessionTraceFirstInstructionOffset =
      firstServiceEvent?.instructionOffset ?? 0;
    mounted.safeState.runtimeSession = {
      ...(mounted.safeState.runtimeSession ?? createRuntimeSessionState()),
      serviceTrace: safeTrace,
    };
  }
  const soundQueue = core.runtimeSessionSoundQueue(mounted.runtimeSessionHandle);
  if (soundQueue !== null) {
    const nextSoundQueue = mergeRuntimeQueueState(
      mounted.safeState.entrySoundQueue,
      safeSoundQueueState(soundQueue),
    );
    soundQueueChanged = runtimeQueueChanged(mounted.safeState.entrySoundQueue, nextSoundQueue);
    const firstSoundEvent = nextSoundQueue.events?.[0] ?? null;
    mounted.summary.localSystemRuntimeEntrySoundQueueReady = 1;
    mounted.summary.localSystemRuntimeEntrySoundQueueRecorded =
      nextSoundQueue.recorded ?? 0;
    mounted.summary.localSystemRuntimeEntrySoundQueueFirstId =
      firstSoundEvent?.serviceId ?? 0;
    mounted.summary.localSystemRuntimeEntrySoundQueueFirstArgs =
      firstSoundEvent?.argCount ?? 0;
    mounted.summary.localSystemRuntimeEntrySoundQueueFirstOffset =
      firstSoundEvent?.instructionOffset ?? 0;
    mounted.safeState.entrySoundQueue = nextSoundQueue;
  }
  const graphQueue = core.runtimeSessionGraphQueue(mounted.runtimeSessionHandle);
  if (graphQueue !== null) {
    const capturedGraphQueue = captureRuntimeGraphQueueMemory(
      core,
      mounted.runtimeSessionHandle,
      safeGraphQueueState(graphQueue),
      mounted.safeState.runtimeGraphQueue,
    );
    const nextRuntimeGraphQueue = capturedGraphQueue.ready === true
      ? capturedGraphQueue
      : safeGraphQueueState(capturedGraphQueue);
    const nextGraphHistoryQueue = mergeRuntimeQueueState(
      mounted.safeState.runtimeGraphHistoryQueue,
      capturedGraphQueue,
    );
    graphQueueChanged = runtimeQueueChanged(
      mounted.safeState.runtimeGraphQueue,
      nextRuntimeGraphQueue,
    ) || runtimeQueueChanged(mounted.safeState.runtimeGraphHistoryQueue, nextGraphHistoryQueue);
    const firstGraphEvent = nextGraphHistoryQueue.events?.[0] ?? null;
    mounted.summary.localSystemRuntimeEntryGraphQueueReady = 1;
    mounted.summary.localSystemRuntimeEntryGraphQueueRecorded =
      nextGraphHistoryQueue.recorded ?? 0;
    mounted.summary.localSystemRuntimeEntryGraphQueueFirstId =
      firstGraphEvent?.serviceId ?? 0;
    mounted.summary.localSystemRuntimeEntryGraphQueueFirstArgs =
      firstGraphEvent?.argCount ?? 0;
    mounted.summary.localSystemRuntimeEntryGraphQueueFirstOffset =
      firstGraphEvent?.instructionOffset ?? 0;
    mounted.safeState.runtimeGraphQueue = nextRuntimeGraphQueue;
    mounted.safeState.runtimeGraphHistoryQueue = nextGraphHistoryQueue;
    mounted.safeState.entryGraphQueue = nextGraphHistoryQueue;
    if (runtimeDiagnosticsEnabled()) {
      mounted.safeState.graphProbe = buildRuntimeGraphProbe(
        core,
        mounted.runtimeSessionHandle,
        nextRuntimeGraphQueue,
      );
    } else {
      mounted.safeState.graphProbe = { ready: false, probeCount: 0, probes: [] };
    }
  }
  if (graphQueueChanged) {
    hooks.paint?.(mounted);
  }
  if (soundQueueChanged) {
    finalizeRuntimeAudio(mounted, hooks, mounted.audioOgg, mounted.safeState.entrySoundQueue);
  }
}

async function warmMountedRuntimeSession(mounted, core, hooks) {
  let lastPacket = null;
  for (let step = 0; step < RUNTIME_SESSION_BOOTSTRAP_MAX_STEPS; step += 1) {
    const packet = await stepMountedRuntimeSession(
      mounted,
      core,
      hooks,
      step === 0 ? RUNTIME_SESSION_BOOTSTRAP_EVENTS : 1,
      RUNTIME_SESSION_MAX_INSTRUCTIONS,
    );
    if (packet === null) {
      return null;
    }
    updateRuntimeSessionState(mounted, packet);
    lastPacket = packet;
    if (runtimeSessionBootstrapReady(mounted, step + 1)) {
      break;
    }
    if (packet.completed === true && !restartMountedRuntimeSession(mounted, core)) {
      break;
    }
    await yieldToMainThread();
  }
  hooks.paint?.(mounted);
  notifyRuntimeUpdate(hooks, mounted);
  return lastPacket;
}

function runtimeSessionBootstrapReady(mounted, stepCount) {
  if (!mounted?.safeState) {
    return false;
  }
  const queue = mounted.safeState.entryGraphQueue;
  if (queue?.ready === true && Array.isArray(queue.events)) {
    for (const event of queue.events) {
      if (RUNTIME_SESSION_BOOTSTRAP_READY_GRAPH_SERVICE_IDS.has(event?.serviceId ?? 0)) {
        return true;
      }
    }
  }
  return stepCount >= RUNTIME_SESSION_BOOTSTRAP_MAX_STEPS;
}

function captureRuntimeGraphQueueMemory(core, sessionHandle, queue, previous = null) {
  if (!queue || queue.ready !== true || !Array.isArray(queue.events) || queue.events.length === 0) {
    return queue;
  }
  const previousByKey = new Map(
    (previous?.events ?? []).map((event) => [runtimeQueueEventKey(event), event]),
  );
  return {
    ...queue,
    events: queue.events.map((event) => {
      const cached = previousByKey.get(runtimeQueueEventKey(event)) ?? null;
      if (cached?.memorySamples) {
        return {
          ...event,
          memorySamples: cached.memorySamples,
        };
      }
      return captureRuntimeGraphEventMemory(core, sessionHandle, event);
    }),
  };
}

function captureRuntimeGraphEventMemory(core, sessionHandle, event) {
  if (!event || !Array.isArray(event.args) || event.args.length === 0) {
    return event;
  }
  const memorySamples = [];
  const seen = new Set();
  for (const candidate of collectRuntimeGraphMemoryCandidates(event)) {
    if (!Number.isSafeInteger(candidate.address) || candidate.address <= 0) {
      continue;
    }
    const key = `${candidate.kind}:${candidate.address >>> 0}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const bytes = core.runtimeSessionMemory(
      sessionHandle,
      candidate.address >>> 0,
      RUNTIME_GRAPH_PROBE_SAMPLE_BYTES,
    );
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
      continue;
    }
    const nonZeroCount = countNonZeroBytes(bytes);
    if (nonZeroCount === 0) {
      continue;
    }
    memorySamples.push({
      kind: candidate.kind,
      argIndex: candidate.argIndex,
      rawValue: candidate.rawValue >>> 0,
      address: candidate.address >>> 0,
      byteLength: bytes.length,
      nonZeroCount,
      previewHex: bytesToHex(bytes),
      previewU32: bytesToU32(bytes, 8),
      asciiHints: extractAsciiHints(bytes),
    });
  }
  if (memorySamples.length === 0) {
    return event;
  }
  return {
    ...event,
    memorySamples,
  };
}

function collectRuntimeGraphMemoryCandidates(event) {
  const candidates = [];
  const args = event?.args ?? [];
  const prefersLocalOffsets = event?.family === 1 && (
    event?.serviceId === 0x4c
    || event?.serviceId === 0x56
    || event?.serviceId === 0x16
    || event?.serviceId === 0x11
    || event?.serviceId === 0x13
    || event?.serviceId === 0x18
    || event?.serviceId === 0x57
  );
  if (event?.serviceId === 0x65) {
    maybePushRuntimeGraphEventMemoryCandidate(
      candidates,
      "source-layer-offset",
      3,
      normalizeLocalPointerCandidate(args[3]?.value),
      args[3]?.value,
    );
    maybePushRuntimeGraphEventMemoryCandidate(
      candidates,
      "source-layer-aux-offset",
      3,
      normalizeAuxPointerCandidate(args[3]?.value),
      args[3]?.value,
    );
    maybePushRuntimeGraphEventMemoryCandidate(
      candidates,
      "source-layer-archive-slot0-offset",
      3,
      normalizeAuxArchiveSlot0OffsetCandidate(args[3]?.value),
      args[3]?.value,
    );
  }
  if (event?.serviceId === 0x85 || event?.serviceId === 0x86) {
    maybePushRuntimeGraphEventMemoryCandidate(
      candidates,
      "window-memory-offset",
      6,
      normalizeLocalPointerCandidate(args[6]?.value),
      args[6]?.value,
    );
    maybePushRuntimeGraphEventMemoryCandidate(
      candidates,
      "window-memory-aux-offset",
      6,
      normalizeAuxPointerCandidate(args[6]?.value),
      args[6]?.value,
    );
    maybePushRuntimeGraphEventMemoryCandidate(
      candidates,
      "window-memory-archive-slot0-offset",
      6,
      normalizeAuxArchiveSlot0OffsetCandidate(args[6]?.value),
      args[6]?.value,
    );
  }
  if (event?.serviceId === 0x96 && args.length === 1 && args[0]?.kind === 1) {
    maybePushRuntimeGraphEventMemoryCandidate(
      candidates,
      "archive-slot0-offset",
      0,
      normalizeAuxArchiveSlot0OffsetCandidate(args[0]?.value),
      args[0]?.value,
    );
  }
  args.forEach((arg, index) => {
    if (arg?.kind === 6) {
      maybePushRuntimeGraphEventMemoryCandidate(
        candidates,
        "local-pointer",
        index,
        LOCAL_POINTER_BASE | ((arg.value ?? 0) & LOCAL_POINTER_MASK),
        arg.value,
      );
      return;
    }
    if (arg?.kind === 1) {
      if (prefersLocalOffsets) {
        maybePushRuntimeGraphEventMemoryCandidate(
          candidates,
          "local-offset",
          index,
          normalizeLocalPointerCandidate(arg.value),
          arg.value,
        );
      }
      maybePushRuntimeGraphEventMemoryCandidate(
        candidates,
        "raw-address",
        index,
        normalizeRawAddressCandidate(arg.value),
        arg.value,
      );
      maybePushRuntimeGraphEventMemoryCandidate(
        candidates,
        "aux-offset",
        index,
        normalizeAuxPointerCandidate(arg.value),
        arg.value,
      );
    }
  });
  return candidates;
}

function maybePushRuntimeGraphEventMemoryCandidate(candidates, kind, argIndex, address, rawValue) {
  if (!Number.isSafeInteger(address) || address <= 0 || address === 0xffffffff) {
    return;
  }
  candidates.push({
    kind,
    argIndex,
    address: address >>> 0,
    rawValue: Number.isSafeInteger(rawValue) ? rawValue >>> 0 : 0,
  });
}

function mergeRuntimeQueueState(previous, next) {
  if (next === null || next.ready !== true) {
    return previous ?? next;
  }
  const previousEvents = previous?.events ?? [];
  const mergedEvents = [...previousEvents];
  const mergedKeys = new Map(
    mergedEvents.map((event, index) => [runtimeQueueEventKey(event), index]),
  );
  for (const event of next.events ?? []) {
    const key = runtimeQueueEventKey(event);
    if (mergedKeys.has(key)) {
      const index = mergedKeys.get(key);
      if (Number.isInteger(index) && index >= 0) {
        mergedEvents[index] = mergeRuntimeQueueEvent(mergedEvents[index], event);
      }
      continue;
    }
    mergedKeys.set(key, mergedEvents.length);
    mergedEvents.push(event);
  }
  const trimmedEvents = trimRuntimeQueueEvents(mergedEvents);
  return {
    ...next,
    totalServices: Math.max(previous?.totalServices ?? 0, next.totalServices ?? 0),
    recordedServices: Math.max(previous?.recordedServices ?? 0, next.recordedServices ?? 0),
    recorded: trimmedEvents.length,
    events: trimmedEvents,
  };
}

function mergeRuntimeQueueEvent(previous, next) {
  if (!previous) {
    return next;
  }
  if (!next) {
    return previous;
  }
  const nextMemorySamples = Array.isArray(next.memorySamples) ? next.memorySamples : [];
  const previousMemorySamples = Array.isArray(previous.memorySamples) ? previous.memorySamples : [];
  if (nextMemorySamples.length === 0 && previousMemorySamples.length === 0) {
    return previous;
  }
  return {
    ...previous,
    ...next,
    memorySamples: nextMemorySamples.length > 0 ? nextMemorySamples : previousMemorySamples,
  };
}

function trimRuntimeQueueEvents(events) {
  if (events.length <= RUNTIME_SESSION_QUEUE_HISTORY_LIMIT) {
    return events;
  }
  const preservedHead = events.slice(0, Math.min(RUNTIME_SESSION_BOOTSTRAP_EVENTS, events.length));
  const preservedHeadKeys = new Set(
    preservedHead.map((event) => runtimeQueueEventKey(event)),
  );
  const priorityEvents = [];
  const tailEvents = [];
  for (const event of events) {
    const key = runtimeQueueEventKey(event);
    if (preservedHeadKeys.has(key)) {
      continue;
    }
    if (PRIORITY_GRAPH_SERVICE_IDS.has(event.serviceId)) {
      priorityEvents.push(event);
    }
  }
  const reservedHeadBudget = preservedHead.length;
  const availableBudget = Math.max(0, RUNTIME_SESSION_QUEUE_HISTORY_LIMIT - reservedHeadBudget);
  const priorityBudget = Math.min(priorityEvents.length, availableBudget);
  const priorityKeys = new Set(
    priorityEvents.slice(-priorityBudget).map((event) => runtimeQueueEventKey(event)),
  );
  for (const event of events) {
    const key = runtimeQueueEventKey(event);
    if (preservedHeadKeys.has(key) || priorityKeys.has(key)) {
      continue;
    }
    tailEvents.push(event);
  }
  const tailBudget = Math.max(0, availableBudget - priorityBudget);
  return [
    ...preservedHead,
    ...tailEvents.slice(-tailBudget),
    ...priorityEvents.slice(-priorityBudget),
  ];
}

function runtimeQueueEventKey(event) {
  const args = (event.args ?? []).map((arg) => (
    `${arg.kind ?? 0}:${arg.value ?? 0}:${arg.len ?? 0}:${arg.hash ?? 0}`
  )).join("|");
  const inlineStrings = (event.inlineStrings ?? []).map((item) => (
    `${item.argIndex ?? 0}:${item.byteLength ?? 0}:${item.fullLength ?? 0}:${item.hash ?? 0}:${item.text ?? ""}`
  )).join("|");
  return [
    event.family ?? 0,
    event.serviceId ?? 0,
    event.instructionOffset ?? 0,
    event.argCount ?? 0,
    event.topKind ?? 0,
    event.integerArgCount ?? 0,
    event.minIntegerArg ?? 0,
    event.maxIntegerArg ?? 0,
    event.stringArgCount ?? 0,
    event.firstStringLength ?? 0,
    event.firstStringHash ?? 0,
    args,
    inlineStrings,
  ].join(":");
}

function buildRuntimeGraphProbe(core, sessionHandle, queue) {
  const probes = [];
  for (const candidate of collectRuntimeGraphProbeCandidates(queue?.events ?? [])) {
    const bytes = core.runtimeSessionMemory(
      sessionHandle,
      candidate.address,
      RUNTIME_GRAPH_PROBE_SAMPLE_BYTES,
    );
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
      continue;
    }
    probes.push({
      ...candidate,
      byteLength: bytes.length,
      nonZeroCount: countNonZeroBytes(bytes),
      previewHex: bytesToHex(bytes),
      previewU32: bytesToU32(bytes, 4),
      asciiHints: extractAsciiHints(bytes),
    });
    if (probes.length === RUNTIME_GRAPH_PROBE_MAX_CANDIDATES) {
      break;
    }
  }
  return {
    ready: probes.length > 0,
    probeCount: probes.length,
    probes,
  };
}

function collectRuntimeGraphProbeCandidates(events) {
  const candidates = [];
  const seen = new Set();
  for (const event of events) {
    for (const candidate of collectRuntimeGraphMemoryCandidates(event)) {
      maybePushRuntimeGraphProbeCandidate(
        candidates,
        seen,
        event,
        candidate.argIndex,
        candidate.kind,
        candidate.address,
        candidate.rawValue,
      );
    }
  }
  return candidates;
}

function maybePushRuntimeGraphProbeCandidate(
  candidates,
  seen,
  event,
  argIndex,
  type,
  address,
  rawValue,
) {
  if (!Number.isSafeInteger(address) || address <= 0 || address === 0xffffffff) {
    return;
  }
  const key = `${type}:${address >>> 0}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  candidates.push({
    type,
    serviceId: event?.serviceId ?? 0,
    instructionOffset: event?.instructionOffset ?? 0,
    argIndex,
    rawValue: Number.isSafeInteger(rawValue) ? rawValue >>> 0 : 0,
    address: address >>> 0,
  });
}

function normalizeLocalPointerCandidate(value) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > LOCAL_POINTER_MASK) {
    return null;
  }
  return LOCAL_POINTER_BASE | (value & LOCAL_POINTER_MASK);
}

function normalizeAuxPointerCandidate(value) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > LOCAL_POINTER_MASK) {
    return null;
  }
  return AUX_POINTER_BASE | (value & LOCAL_POINTER_MASK);
}

function normalizeAuxArchiveSlot0OffsetCandidate(value) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > LOCAL_POINTER_MASK) {
    return null;
  }
  return AUX_SLOT0_ARCHIVE_BASE + (value & LOCAL_POINTER_MASK);
}

function normalizeRawAddressCandidate(value) {
  if (
    !Number.isSafeInteger(value)
    || value < LOCAL_POINTER_BASE
    || value > 0xffffffff
    || value === 0xffffffff
  ) {
    return null;
  }
  return value >>> 0;
}

function countNonZeroBytes(bytes) {
  let count = 0;
  for (const byte of bytes) {
    if (byte !== 0) {
      count += 1;
    }
  }
  return count;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToU32(bytes, maxValues) {
  const out = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const limit = Math.min(Math.floor(bytes.byteLength / 4), maxValues);
  for (let index = 0; index < limit; index += 1) {
    out.push(view.getUint32(index * 4, true));
  }
  return out;
}

function extractAsciiHints(bytes) {
  const text = Array.from(bytes, (byte) => (
    byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : "\0"
  )).join("");
  return text
    .split("\0")
    .map((item) => item.trim())
    .filter((item) => item.length >= 4)
    .slice(0, 4);
}

export const __testOnlyMergeRuntimeQueueState = mergeRuntimeQueueState;
export const __testOnlyWarmMountedRuntimeSession = warmMountedRuntimeSession;
export const __testOnlyRuntimeSessionBootstrapReady = runtimeSessionBootstrapReady;

function runtimeQueueChanged(previous, next) {
  if (previous?.recorded !== next?.recorded) {
    return true;
  }
  const prevEvents = previous?.events ?? [];
  const nextEvents = next?.events ?? [];
  if (prevEvents.length !== nextEvents.length) {
    return true;
  }
  for (let index = 0; index < nextEvents.length; index += 1) {
    if (
      prevEvents[index]?.serviceId !== nextEvents[index]?.serviceId ||
      prevEvents[index]?.instructionOffset !== nextEvents[index]?.instructionOffset ||
      prevEvents[index]?.argCount !== nextEvents[index]?.argCount
    ) {
      return true;
    }
    const previousSamples = prevEvents[index]?.memorySamples ?? [];
    const nextSamples = nextEvents[index]?.memorySamples ?? [];
    if (previousSamples.length !== nextSamples.length) {
      return true;
    }
  }
  return false;
}

function stopRuntimeSessionLoop(mounted) {
  if (mounted.runtimeSessionTimer !== 0) {
    globalThis.clearTimeout(mounted.runtimeSessionTimer);
    mounted.runtimeSessionTimer = 0;
  }
}

function destroyMountedInstall(mounted, core) {
  if (!mounted || mounted.destroyed === true) {
    return;
  }
  mounted.destroyed = true;
  stopRuntimeSessionLoop(mounted);
  if (mounted.player?.destroy) {
    mounted.player.destroy();
    mounted.player = null;
  }
  if (mounted.runtimeSessionHandle !== 0) {
    core.runtimeSessionDestroy(mounted.runtimeSessionHandle);
    mounted.runtimeSessionHandle = 0;
  }
  if (mounted.runtimeHandle !== 0) {
    core.runtimeDestroy(mounted.runtimeHandle);
    mounted.runtimeHandle = 0;
  }
}

function safeSoundQueueState(queue) {
  if (queue === null) {
    return { ready: false, recorded: 0, events: [] };
  }
  return {
    ready: true,
    totalServices: queue.totalServiceCount,
    recordedServices: queue.recordedServiceCount,
    recorded: queue.recordedCount,
    events: queue.events.map((event) => ({
      eventIndex: event.eventIndex,
      depth: event.depth,
      scriptIndex: event.scriptIndex ?? queue.scriptIndex ?? 0,
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
      args: safeQueueArgs(event.args),
    })),
  };
}

function safeGraphQueueState(queue) {
  if (queue === null) {
    return { ready: false, recorded: 0, events: [] };
  }
  return {
    ready: true,
    totalServices: queue.totalServiceCount,
    recordedServices: queue.recordedServiceCount,
    recorded: queue.recordedCount,
    events: queue.events.map((event) => ({
      eventIndex: event.eventIndex,
      depth: event.depth,
      scriptIndex: event.scriptIndex ?? queue.scriptIndex ?? 0,
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
      args: safeQueueArgs(event.args),
      inlineStrings: safeInlineStrings(event.inlineStrings),
    })),
  };
}

function safeQueueArgs(args) {
  return (args ?? []).slice(0, RUNTIME_QUEUE_SAFE_ARG_LIMIT).map((arg) => ({
    kind: arg.kind ?? 0,
    value: arg.value ?? 0,
    len: arg.len ?? 0,
    hash: arg.hash ?? 0,
  }));
}

function safeInlineStrings(items) {
  return (items ?? []).slice(0, 4).map((item) => ({
    argIndex: item.argIndex ?? 0,
    byteLength: item.byteLength ?? 0,
    fullLength: item.fullLength ?? 0,
    hash: item.hash ?? 0,
    text: typeof item.text === "string" ? item.text : "",
  }));
}
