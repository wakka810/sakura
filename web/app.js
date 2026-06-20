import { createInputController } from "./input.js";
import {
  BGI_GOTHIC_FAMILY,
  BGI_MINCHO_FAMILY,
  bgiGothicFont,
  bgiMinchoFont,
} from "./bgi-fonts.js";
import { createCore, loadCore } from "./core-wasm.js";
import {
  readFullscreenState,
  toggleFullscreenMode,
} from "./fullscreen.js";
import {
  mountLocalInstall,
  mountServerInstall,
  refreshMountedImageAssets,
  syncMountedAudioState,
} from "./install-runtime.js";
import { formatInstallSummary } from "./install-summary.js";
import {
  bindScenarioPlayerInput,
  paintScenarioOverlay,
  paintScenarioScene,
  readScenarioQuickSaveSummary,
  readScenarioSaveSlotSummary,
  scenarioScreenOffset,
} from "./session-player.js";
import { renderGraphQueue, summarizeGraphQueue } from "./graph-renderer.js";
import { publishSafeRuntimeState } from "./runtime-state-export.js";
import { safeInstallSummary } from "./safe-summary.js";
import {
  applyScenarioConfigControl,
  applyScenarioScreenMode,
  closeScenarioConfigWindow,
  createScenarioConfigState,
  openScenarioConfigWindow,
  paintScenarioConfigWindow,
  readStoredScenarioConfigSettings,
  scenarioConfigControlAt,
  scenarioConfigHoverKey,
  storeScenarioConfigSettings,
} from "./scenario-config-window.js";
import {
  applyScenarioDialogControl,
  closeScenarioDialog,
  createScenarioDialogState,
  openScenarioDialog,
  paintScenarioDialogWindow,
  scenarioDialogControlAt,
  scenarioDialogHoverKey,
} from "./scenario-dialog-window.js";
import {
  applyScenarioUserDataControl,
  closeScenarioUserDataWindow,
  createScenarioUserDataState,
  openScenarioUserDataWindow,
  paintScenarioUserDataWindow,
  resolveUserDataPreviewImage,
  scenarioUserDataControlAt,
  userDataHoverKey,
  USER_DATA_SLOTS_PER_PAGE,
  USER_DATA_TOTAL_PAGES,
} from "./scenario-userdata-window.js";
import {
  applyTitleSceneControl,
  closeTitleSceneSelect,
  createTitleSceneSelectState,
  openTitleSceneSelect,
  paintTitleSceneSelect,
  titleSceneChoices,
  titleSceneControlAt,
  titleSceneHoverKey,
  titleSceneRowUnlocked,
} from "./title-scene-select.js";
import {
  applyTitleMusicControl,
  closeTitleMusic,
  createTitleMusicState,
  openTitleMusic,
  paintTitleMusic,
  titleMusicControlAt,
  titleMusicHoverKey,
  titleMusicStepPage,
  titleMusicTracks,
  titleMusicVisibleChoices,
} from "./title-music.js";
import {
  applyTitleGraphicControl,
  closeTitleGraphic,
  closeTitleGraphicViewer,
  createTitleGraphicState,
  openTitleGraphic,
  paintTitleGraphic,
  TITLE_GRAPHIC_PAGE_SIZE,
  titleGraphicAssets,
  titleGraphicChromeAssetNames,
  titleGraphicControlAt,
  titleGraphicHoverKey,
  titleGraphicStepPage,
  titleGraphicVisibleChoices,
} from "./title-graphic.js";
import { scenarioSequenceForRoute } from "./scenario-routes.js";
import { loadViewedData } from "./viewed-data.js";
import {
  readTitleClearState,
  normalizeTitleMenuMode,
  titleExtraUnlocked,
  titleMenuControls,
  TITLE_MENU_MODE_EXTRA,
  TITLE_MENU_MODE_MAIN,
} from "./title-menu.js";
import {
  loadImageAsset,
  normalizeUpscaleSettings,
  readStoredUpscaleSettings,
  storeUpscaleSettings,
} from "./upscale-client.js";
import { createTwoFingerDoubleTapRecognizer } from "./two-finger-double-tap.js";
import {
  captureLocalStorageSnapshot,
  loadCloudStateSnapshot,
  restoreLocalStorageSnapshot,
  saveCloudStateSnapshot,
} from "./cloud-state.js";
import { createEngineManagementOverlay } from "./engine-management-overlay.js";

const statusEl = document.querySelector("#core-status");
const outputEl = document.querySelector("#probe-output");
const openButton = document.querySelector("#open-install");
const saveButton = document.querySelector("#save-session");
const loadButton = document.querySelector("#load-session");
const playAudioButton = document.querySelector("#play-audio");
const installFilesInput = document.querySelector("#install-files");
const canvas = document.querySelector("#stage");
const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
const STAGE_LOGICAL_WIDTH = 1280;
const STAGE_LOGICAL_HEIGHT = 720;
const scenarioLogicalCanvas = {
  get width() {
    return STAGE_LOGICAL_WIDTH;
  },
  get height() {
    return STAGE_LOGICAL_HEIGHT;
  },
  get dataset() {
    return canvas.dataset;
  },
  getBoundingClientRect() {
    return canvas.getBoundingClientRect();
  },
};
const runtimeDiagnosticsEnabled =
  new URLSearchParams(window.location.search).get("debug") === "1";
document.documentElement.dataset.runtimeDiagnostics = String(runtimeDiagnosticsEnabled);
const runtimeQuery = new URLSearchParams(window.location.search);
const titleExtraForced = runtimeQuery.get("unlockExtra") === "1" || runtimeQuery.get("showExtra") === "1";
const titleGraphicForceUnlock = runtimeQuery.get("unlockExtra") === "1"
  || runtimeQuery.get("unlockGraphic") === "1";
const titleSceneForceUnlock = runtimeQuery.get("unlockExtra") === "1"
  || runtimeQuery.get("unlockScene") === "1";
const assetNameEncoder = new TextEncoder();
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
let suppressNextTitleClick = false;
const input = createInputController(canvas, {
  keyboardTarget: window,
  onChange: publishRuntimeState,
});
const engineManager = createEngineManagementOverlay({
  upscaleSettings: readStoredUpscaleSettings(),
  onUpscaleChange: (settings) => {
    storeUpscaleSettings(settings);
    applyUpscaleSettingsToMounted(activeInstall, settings, { refresh: true });
    publishRuntimeState(true);
  },
  onCloudSave: saveCloudRuntimeState,
  onCloudLoad: () => loadCloudRuntimeState({ reload: true }),
  onCloudRefresh: refreshCloudRuntimeState,
  readSystemInfo: readEngineManagerInfo,
  readFullscreenState: readHostFullscreenState,
  onFullscreenToggle: toggleHostFullscreen,
});
document.body.append(engineManager.element);
const engineManagerGesture = createTwoFingerDoubleTapRecognizer();
syncHostFullscreenState();
document.addEventListener("fullscreenchange", syncHostFullscreenState);
document.addEventListener("webkitfullscreenchange", syncHostFullscreenState);
exposeEngineManagerDebug();
void preloadBgiFonts();

async function preloadBgiFonts() {
  if (typeof document.fonts?.load !== "function") {
    return;
  }
  await Promise.allSettled([
    document.fonts.load(`20px ${BGI_GOTHIC_FAMILY}`),
    document.fonts.load(`20px ${BGI_MINCHO_FAMILY}`),
  ]);
  if (activeInstall) {
    paintMountedFrame(activeInstall);
    publishRuntimeState();
  }
}

function isCurrentInstall(mounted) {
  return mounted !== null
    && mounted !== undefined
    && mounted.destroyed !== true
    && activeInstall === mounted;
}

function configureStageCanvasForMounted(mounted) {
  const scale = stageBackingScaleForMounted(mounted);
  const width = STAGE_LOGICAL_WIDTH * scale;
  const height = STAGE_LOGICAL_HEIGHT * scale;
  canvas.dataset.logicalWidth = String(STAGE_LOGICAL_WIDTH);
  canvas.dataset.logicalHeight = String(STAGE_LOGICAL_HEIGHT);
  canvas.dataset.backingScale = String(scale);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return scale;
}

function stageBackingScaleForMounted(mounted) {
  const settings = mountedUpscaleSettings(mounted);
  if (settings.upscaleEnabled !== true) {
    return 1;
  }
  const scale = Number.parseInt(settings.upscaleScale ?? "2", 10);
  return scale === 2 ? 2 : 1;
}

function mountedUpscaleSettings(mounted) {
  return normalizeUpscaleSettings(mounted?.upscaleSettings ?? engineManager.settings);
}

function applyUpscaleSettingsToMounted(mounted, settings, options = {}) {
  if (!mounted || mounted.destroyed === true) {
    return;
  }
  const normalized = normalizeUpscaleSettings(settings);
  const previous = JSON.stringify(mounted.upscaleSettings ?? null);
  mounted.upscaleSettings = normalized;
  mounted.safeState.upscaleEnabled = Number(normalized.upscaleEnabled === true);
  mounted.safeState.upscaleScale = normalized.upscaleScale;
  mounted.safeState.upscaleModel = normalized.upscaleModel;
  mounted.safeState.upscaleQualityMode = normalized.upscaleQualityMode;
  const changed = previous !== JSON.stringify(normalized);
  mounted.player?.applyUpscaleSettings?.(normalized, {
    refresh: options.refresh === true && changed,
  });
  mounted.graphRuntime = null;
  if (options.refresh === true && changed) {
    mounted.sharedImageAssetCache?.clear?.();
    mounted.titleGraphicImageCache?.clear?.();
    mounted.titleSceneImageCache?.clear?.();
    mounted.titleGraphicChromeCache?.clear?.();
    mounted.userDataThumbnailCache?.clear?.();
    prepareTitleGraphicPage(mounted);
    prepareTitleGraphicChrome(mounted);
    prepareTitleSceneThumbnails(mounted);
  }
  if (normalized.upscaleEnabled === true || (options.refresh === true && changed)) {
    void refreshMountedChromeAssets(mounted, normalized);
  }
  if (isCurrentInstall(mounted)) {
    paintMountedFrame(mounted);
    publishRuntimeState(true);
  }
}

function refreshMountedChromeAssets(mounted, settings) {
  return refreshMountedImageAssets(mounted, settings, {
    onReady: () => {
      if (!isCurrentInstall(mounted)) {
        return;
      }
      void refreshMountedChromeAssets(mounted, settings);
      paintMountedFrame(mounted);
      publishRuntimeState(true);
    },
  }).then((updated) => {
    if (updated && isCurrentInstall(mounted)) {
      mounted.__bootPhases = null;
      paintMountedFrame(mounted);
      publishRuntimeState(true);
    }
    return updated;
  }).catch(() => false);
}

function exposeActiveInstallDebug() {
  globalThis.__sakuraActiveInstall = activeInstall;
  if (globalThis.window) {
    window.__sakuraActiveInstall = activeInstall;
  }
}

function exposeEngineManagerDebug() {
  const saveCloud = () => saveCloudRuntimeState();
  const loadCloud = (options = {}) => loadCloudRuntimeState(options);
  const refreshCloud = () => refreshCloudRuntimeState();
  globalThis.__sakuraEngineManager = engineManager;
  globalThis.sakuraSaveCloudState = saveCloud;
  globalThis.__sakuraSaveCloudState = saveCloud;
  globalThis.sakuraLoadCloudState = loadCloud;
  globalThis.__sakuraLoadCloudState = loadCloud;
  globalThis.sakuraRefreshCloudState = refreshCloud;
  globalThis.__sakuraRefreshCloudState = refreshCloud;
  if (globalThis.window) {
    window.__sakuraEngineManager = engineManager;
    window.sakuraSaveCloudState = saveCloud;
    window.__sakuraSaveCloudState = saveCloud;
    window.sakuraLoadCloudState = loadCloud;
    window.__sakuraLoadCloudState = loadCloud;
    window.sakuraRefreshCloudState = refreshCloud;
    window.__sakuraRefreshCloudState = refreshCloud;
  }
}

async function saveCloudRuntimeState() {
  const snapshot = captureLocalStorageSnapshot();
  return await saveCloudStateSnapshot(snapshot);
}

async function loadCloudRuntimeState(options = {}) {
  const snapshot = await loadCloudStateSnapshot();
  if (!snapshot) {
    return { ok: false, reason: "cloud_state_missing", restoredKeyCount: 0, metadata: null };
  }
  const restore = restoreLocalStorageSnapshot(snapshot);
  if (options.reload !== false) {
    window.setTimeout(() => window.location.reload(), 250);
  }
  return {
    ok: true,
    reason: "ok",
    restoredKeyCount: restore.keyCount,
    metadata: snapshot.metadata,
  };
}

async function refreshCloudRuntimeState() {
  const snapshot = await loadCloudStateSnapshot();
  return snapshot ? { ok: true, metadata: snapshot.metadata } : { ok: false, metadata: null };
}

function readEngineManagerInfo() {
  const mounted = activeInstall;
  const player = mounted?.player ?? null;
  const progress = readProgressSummary();
  const scale = canvas.dataset.backingScale ?? "1";
  const settings = mountedUpscaleSettings(mounted);
  return {
    progress,
    system: {
      mounted: mounted?.destroyed !== true && mounted !== null,
      stage: mounted?.stage ?? "",
      scenarioName: player?.safeState?.scenarioName ?? "",
      scenarioRoute: player?.safeState?.scenarioRoute ?? "",
      eventCount: player?.event?.eventCount ?? 0,
      canvas: `${canvas.width}x${canvas.height} @${scale}x`,
      audioQueued: mounted?.safeState?.entrySoundQueue?.recorded ?? 0,
      runtimeReady: mounted?.safeState?.runtimeSession?.ready === true,
      fullscreen: readHostFullscreenState().active ? "Yes" : "No",
      upscale: settings.upscaleEnabled
        ? `${settings.upscaleScale}x ${settings.upscaleModel} ${settings.upscaleQualityMode}`
        : "Off",
    },
  };
}

function readHostFullscreenState() {
  return readFullscreenState(document);
}

function toggleHostFullscreen() {
  const result = toggleFullscreenMode(document);
  syncHostFullscreenState();
  return result;
}

function syncHostFullscreenState() {
  const active = readHostFullscreenState().active;
  document.documentElement.dataset.fullscreen = String(active);
  engineManager?.refresh?.();
  publishRuntimeState(true);
}

function readProgressSummary() {
  const totalSlots = USER_DATA_TOTAL_PAGES * USER_DATA_SLOTS_PER_PAGE;
  let saveSlotCount = 0;
  for (let slot = 0; slot < totalSlots; slot += 1) {
    if (readScenarioSaveSlotSummary(slot).exists) {
      saveSlotCount += 1;
    }
  }
  const quickSave = readScenarioQuickSaveSummary();
  const titleClear = readTitleClearState();
  const viewed = loadViewedData();
  const readEventCount = readScenarioReadEventCount();
  const storage = safeLocalStorageMetadata();
  return {
    saveSlotCount,
    saveSlotTotal: totalSlots,
    quickSaveExists: quickSave.exists === true,
    titleClearRouteCount: Object.keys(titleClear.routes ?? {}).length,
    readEventCount,
    viewed: {
      cg: viewed.cg?.size ?? 0,
      bgm: viewed.bgm?.size ?? 0,
      scene: viewed.scene?.size ?? 0,
      movie: viewed.movie?.size ?? 0,
    },
    localStorageKeyCount: storage.keyCount,
    localStorageBytes: storage.byteLength,
  };
}

function readScenarioReadEventCount() {
  try {
    const encoded = window.localStorage?.getItem("sakura.read.events.v1");
    const parsed = encoded ? JSON.parse(encoded) : null;
    return Array.isArray(parsed?.keys) ? parsed.keys.length : 0;
  } catch {
    return 0;
  }
}

function safeLocalStorageMetadata() {
  try {
    return captureLocalStorageSnapshot().metadata;
  } catch {
    return { keyCount: 0, byteLength: 0 };
  }
}

function bindRuntimeSessionControls() {
  const pause = () => activeInstall?.pauseRuntimeSession?.() ?? null;
  const resume = () => activeInstall?.resumeRuntimeSession?.() ?? null;
  const step = async (maxEvents = 1, maxInstructionsPerEvent = 100000) => (
    await (activeInstall?.stepRuntimeSession?.(maxEvents, maxInstructionsPerEvent) ?? null)
  );
  const startScenarioRoute = async (route, scenarioName = "") => {
    const mounted = activeInstall;
    if (!mounted || mounted.destroyed === true || !mounted.startScenarioRoute) {
      return { ok: false, reason: "not_mounted" };
    }
    const player = await mounted.startScenarioRoute(route, scenarioName);
    paintMountedFrame(mounted);
    publishRuntimeState(true);
    return player?.safeState
      ? {
        ok: true,
        reason: "ok",
        route: player.safeState.scenarioRoute,
        scenarioName: player.safeState.scenarioName,
        scenarioIndex: player.safeState.scenarioIndex,
      }
      : { ok: false, reason: "no_player" };
  };
  const openTitleSceneSelectApi = () => {
    const mounted = activeInstall;
    if (!mounted || mounted.destroyed === true || mounted.stage !== "title") {
      return { ok: false, reason: "not_title" };
    }
    return openTitleSceneSelectHost(mounted);
  };
  const titleSceneChoicesApi = () => titleSceneChoices().map((choice) => ({
    index: choice.index,
    route: choice.routeId,
    scenarioName: choice.scenarioName,
    scenarioIndex: choice.scenarioIndex,
    replayId: choice.replayId,
    thumbnailAssetName: choice.thumbnailAssetName,
    scriptSlot: choice.scriptSlot,
    scriptPage: choice.scriptPage,
    row: choice.row,
    column: choice.column,
  }));
  const openTitleMusicApi = () => {
    const mounted = activeInstall;
    if (!mounted || mounted.destroyed === true || mounted.stage !== "title") {
      return { ok: false, reason: "not_title" };
    }
    return openTitleMusicHost(mounted);
  };
  const openTitleGraphicApi = () => {
    const mounted = activeInstall;
    if (!mounted || mounted.destroyed === true || mounted.stage !== "title") {
      return { ok: false, reason: "not_title" };
    }
    return openTitleGraphicHost(mounted);
  };
  const titleGraphicAssetsApi = () => {
    const mounted = activeInstall;
    if (!mounted || mounted.destroyed === true) {
      return [];
    }
    const state = mounted.titleGraphicState ?? null;
    const assets = mountedTitleGraphicAssets(mounted);
    const choices = state?.open ? titleGraphicVisibleChoices(state, assets) : assets;
    return choices.map((choice) => ({
      index: choice.index,
      page: choice.page ?? Math.floor(choice.index / TITLE_GRAPHIC_PAGE_SIZE),
      row: choice.row ?? (choice.index % TITLE_GRAPHIC_PAGE_SIZE),
      assetName: choice.assetName,
      fullAssetName: choice.fullAssetName || choice.assetName,
      label: choice.label,
      archiveName: choice.archiveName,
      size: choice.size,
      unlocked: choice.unlocked !== false,
      locked: choice.locked === true,
      rect: choice.rect ?? null,
    }));
  };
  const titleMusicTracksApi = () => {
    const mounted = activeInstall;
    const state = mounted?.titleMusicState ?? null;
    const choices = state?.open ? titleMusicVisibleChoices(state) : titleMusicTracks();
    return choices.map((choice) => ({
      index: choice.index,
      page: choice.page,
      row: choice.row,
      assetName: choice.assetName,
      label: choice.label,
      rect: choice.rect,
    }));
  };
  const titleMenuControlsApi = () => {
    const mounted = activeInstall;
    if (!mounted || mounted.destroyed === true || mounted.stage !== "title") {
      return [];
    }
    if (titleSceneIsOpen(mounted) || titleMusicIsOpen(mounted) || titleGraphicIsOpen(mounted)) {
      return [];
    }
    return currentTitleMenuControls(mounted).map((control, index) => ({
      index,
      label: control.label,
      action: control.action,
      routeId: control.routeId,
      x: control.x,
      y: control.y,
      enabled: control.enabled,
    }));
  };
  const selectTitleSceneApi = async (index) => {
    const mounted = activeInstall;
    const sceneIndex = Number.parseInt(String(index), 10);
    const choice = titleSceneChoices().find((item) => item.index === sceneIndex) ?? null;
    if (!mounted || mounted.destroyed === true || mounted.stage !== "title") {
      return { ok: false, reason: "not_title" };
    }
    if (!choice) {
      return { ok: false, reason: "scene_not_found" };
    }
    openTitleSceneSelectHost(mounted);
    if (titleSceneRowLocked(choice.scenarioName)) {
      return { ok: false, reason: "scene_locked" };
    }
    return handleTitleSceneResult(
      mounted,
      applyTitleSceneControl(ensureTitleSceneState(mounted), { kind: "scene", choice }),
    );
  };
  const selectTitleMusicApi = async (index) => {
    const mounted = activeInstall;
    const musicIndex = Number.parseInt(String(index), 10);
    const choice = titleMusicTracks().find((item) => item.index === musicIndex) ?? null;
    if (!mounted || mounted.destroyed === true || mounted.stage !== "title") {
      return { ok: false, reason: "not_title" };
    }
    if (!choice) {
      return { ok: false, reason: "music_not_found" };
    }
    openTitleMusicHost(mounted);
    return handleTitleMusicResult(
      mounted,
      applyTitleMusicControl(ensureTitleMusicState(mounted), { kind: "track", choice }),
    );
  };
  const selectTitleGraphicApi = async (index) => {
    const mounted = activeInstall;
    const graphicIndex = Number.parseInt(String(index), 10);
    if (!mounted || mounted.destroyed === true || mounted.stage !== "title") {
      return { ok: false, reason: "not_title" };
    }
    const assets = mountedTitleGraphicAssets(mounted);
    const choice = assets.find((item) => item.index === graphicIndex) ?? null;
    if (!choice) {
      return { ok: false, reason: "graphic_not_found" };
    }
    openTitleGraphicHost(mounted);
    const graphicState = ensureTitleGraphicState(mounted);
    graphicState.page = Math.max(0, Math.floor(choice.index / TITLE_GRAPHIC_PAGE_SIZE));
    prepareTitleGraphicPage(mounted);
    return handleTitleGraphicResult(
      mounted,
      applyTitleGraphicControl(
        graphicState,
        { kind: "graphic", choice },
        assets.length,
      ),
    );
  };
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
  globalThis.sakuraStartScenarioRoute = startScenarioRoute;
  globalThis.__sakuraStartScenarioRoute = startScenarioRoute;
  globalThis.sakuraOpenTitleSceneSelect = openTitleSceneSelectApi;
  globalThis.__sakuraOpenTitleSceneSelect = openTitleSceneSelectApi;
  globalThis.sakuraTitleSceneChoices = titleSceneChoicesApi;
  globalThis.__sakuraTitleSceneChoices = titleSceneChoicesApi;
  globalThis.sakuraSelectTitleScene = selectTitleSceneApi;
  globalThis.__sakuraSelectTitleScene = selectTitleSceneApi;
  globalThis.sakuraOpenTitleMusic = openTitleMusicApi;
  globalThis.__sakuraOpenTitleMusic = openTitleMusicApi;
  globalThis.sakuraTitleMusicTracks = titleMusicTracksApi;
  globalThis.__sakuraTitleMusicTracks = titleMusicTracksApi;
  globalThis.sakuraSelectTitleMusic = selectTitleMusicApi;
  globalThis.__sakuraSelectTitleMusic = selectTitleMusicApi;
  globalThis.sakuraOpenTitleGraphic = openTitleGraphicApi;
  globalThis.__sakuraOpenTitleGraphic = openTitleGraphicApi;
  globalThis.sakuraTitleGraphicAssets = titleGraphicAssetsApi;
  globalThis.__sakuraTitleGraphicAssets = titleGraphicAssetsApi;
  globalThis.sakuraSelectTitleGraphic = selectTitleGraphicApi;
  globalThis.__sakuraSelectTitleGraphic = selectTitleGraphicApi;
  globalThis.sakuraTitleMenuControls = titleMenuControlsApi;
  globalThis.__sakuraTitleMenuControls = titleMenuControlsApi;
  globalThis.sakuraRuntimeSessionMemory = readMemory;
  globalThis.__sakuraRuntimeSessionMemory = readMemory;
  if (globalThis.window) {
    window.sakuraPauseRuntimeSession = pause;
    window.__sakuraPauseRuntimeSession = pause;
    window.sakuraResumeRuntimeSession = resume;
    window.__sakuraResumeRuntimeSession = resume;
    window.sakuraStepRuntimeSession = step;
    window.__sakuraStepRuntimeSession = step;
    window.sakuraStartScenarioRoute = startScenarioRoute;
    window.__sakuraStartScenarioRoute = startScenarioRoute;
    window.sakuraOpenTitleSceneSelect = openTitleSceneSelectApi;
    window.__sakuraOpenTitleSceneSelect = openTitleSceneSelectApi;
    window.sakuraTitleSceneChoices = titleSceneChoicesApi;
    window.__sakuraTitleSceneChoices = titleSceneChoicesApi;
    window.sakuraSelectTitleScene = selectTitleSceneApi;
    window.__sakuraSelectTitleScene = selectTitleSceneApi;
    window.sakuraOpenTitleMusic = openTitleMusicApi;
    window.__sakuraOpenTitleMusic = openTitleMusicApi;
    window.sakuraTitleMusicTracks = titleMusicTracksApi;
    window.__sakuraTitleMusicTracks = titleMusicTracksApi;
    window.sakuraSelectTitleMusic = selectTitleMusicApi;
    window.__sakuraSelectTitleMusic = selectTitleMusicApi;
    window.sakuraOpenTitleGraphic = openTitleGraphicApi;
    window.__sakuraOpenTitleGraphic = openTitleGraphicApi;
    window.sakuraTitleGraphicAssets = titleGraphicAssetsApi;
    window.__sakuraTitleGraphicAssets = titleGraphicAssetsApi;
    window.sakuraSelectTitleGraphic = selectTitleGraphicApi;
    window.__sakuraSelectTitleGraphic = selectTitleGraphicApi;
    window.sakuraTitleMenuControls = titleMenuControlsApi;
    window.__sakuraTitleMenuControls = titleMenuControlsApi;
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

loadButton.addEventListener("click", async () => {
  const result = activeInstall?.player
    ? await activeInstall.player.loadFromStorage()
    : null;
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
canvas.addEventListener("pointermove", (event) => {
  const mounted = activeInstall;
  if (!dialogIsOpen(mounted)) {
    return;
  }
  if (updateDialogHover(mounted, event.clientX, event.clientY)) {
    paintMountedFrame(mounted);
    publishRuntimeState();
  }
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);
canvas.addEventListener("mousemove", (event) => {
  const mounted = activeInstall;
  if (!dialogIsOpen(mounted)) {
    return;
  }
  if (updateDialogHover(mounted, event.clientX, event.clientY)) {
    paintMountedFrame(mounted);
    publishRuntimeState();
  }
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);
canvas.addEventListener("pointerup", (event) => {
  const mounted = activeInstall;
  if (!dialogIsOpen(mounted)) {
    return;
  }
  if (event.button === 2) {
    applyDialogControl(mounted, { kind: "button", action: "no" });
  } else {
    applyDialogClick(mounted, event.clientX, event.clientY);
  }
  suppressNextTitleClick = true;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);
canvas.addEventListener("mousemove", (event) => {
  const mounted = activeInstall;
  if (!mounted || mounted.stage !== "title") return;
  if (titleConfigIsOpen(mounted)) {
    if (updateTitleConfigHover(mounted, event.clientX, event.clientY)) {
      paintMountedFrame(mounted);
      publishRuntimeState();
    }
    return;
  }
  if (titleUserDataIsOpen(mounted)) {
    if (updateTitleUserDataHover(mounted, event.clientX, event.clientY)) {
      paintMountedFrame(mounted);
      publishRuntimeState();
    }
    return;
  }
  if (titleGraphicIsOpen(mounted)) {
    if (updateTitleGraphicHover(mounted, event.clientX, event.clientY)) {
      paintMountedFrame(mounted);
      publishRuntimeState();
    }
    return;
  }
  if (titleSceneIsOpen(mounted)) {
    if (updateTitleSceneHover(mounted, event.clientX, event.clientY)) {
      paintMountedFrame(mounted);
      publishRuntimeState();
    }
    return;
  }
  if (titleMusicIsOpen(mounted)) {
    if (updateTitleMusicHover(mounted, event.clientX, event.clientY)) {
      paintMountedFrame(mounted);
      publishRuntimeState();
    }
    return;
  }
  const hit = titleMenuHit(mounted, event.clientX, event.clientY);
  if (hit !== mounted.hoverIndex) {
    // Cursor-move SFX (SSE000000) plays when the selection lands on a new
    // button, matching the original title menu behaviour.
    if (hit >= 0) {
      playTitleSfx(mounted, TITLE_SFX_CURSOR);
    }
    mounted.hoverIndex = hit;
    paintMountedFrame(mounted);
  }
});
canvas.addEventListener("pointerup", (event) => {
  const mounted = activeInstall;
  if (!mounted || mounted.stage !== "title" || !titleConfigIsOpen(mounted)) {
    return;
  }
  if (event.button === 2) {
    closeScenarioConfigWindow(ensureTitleConfigState(mounted));
  } else {
    applyTitleConfigClick(mounted, event.clientX, event.clientY);
    suppressNextTitleClick = true;
  }
  paintMountedFrame(mounted);
  publishRuntimeState(true);
  event.preventDefault();
  event.stopPropagation();
}, true);
canvas.addEventListener("pointerup", (event) => {
  const mounted = activeInstall;
  if (!mounted || mounted.stage !== "title" || !titleUserDataIsOpen(mounted)) {
    return;
  }
  if (event.button === 2) {
    closeScenarioUserDataWindow(ensureTitleUserDataState(mounted));
  } else {
    applyTitleUserDataClick(mounted, event.clientX, event.clientY);
    suppressNextTitleClick = true;
  }
  paintMountedFrame(mounted);
  publishRuntimeState(true);
  event.preventDefault();
  event.stopPropagation();
}, true);
canvas.addEventListener("pointerup", (event) => {
  const mounted = activeInstall;
  if (!mounted || mounted.stage !== "title" || !titleGraphicIsOpen(mounted)) {
    return;
  }
  if (event.button === 2) {
    const state = ensureTitleGraphicState(mounted);
    if (!closeTitleGraphicViewer(state)) {
      closeTitleGraphic(state);
    }
  } else {
    void applyTitleGraphicClick(mounted, event.clientX, event.clientY);
    suppressNextTitleClick = true;
  }
  paintMountedFrame(mounted);
  publishRuntimeState(true);
  event.preventDefault();
  event.stopPropagation();
}, true);
canvas.addEventListener("pointerup", (event) => {
  const mounted = activeInstall;
  if (!mounted || mounted.stage !== "title" || !titleSceneIsOpen(mounted)) {
    return;
  }
  if (event.button === 2) {
    closeTitleSceneSelect(ensureTitleSceneState(mounted));
  } else {
    void applyTitleSceneClick(mounted, event.clientX, event.clientY);
    suppressNextTitleClick = true;
  }
  paintMountedFrame(mounted);
  publishRuntimeState(true);
  event.preventDefault();
  event.stopPropagation();
}, true);
canvas.addEventListener("pointerup", (event) => {
  const mounted = activeInstall;
  if (!mounted || mounted.stage !== "title" || !titleMusicIsOpen(mounted)) {
    return;
  }
  if (event.button === 2) {
    closeTitleMusic(ensureTitleMusicState(mounted));
  } else {
    void applyTitleMusicClick(mounted, event.clientX, event.clientY);
    suppressNextTitleClick = true;
  }
  paintMountedFrame(mounted);
  publishRuntimeState(true);
  event.preventDefault();
  event.stopPropagation();
}, true);
canvas.addEventListener("wheel", (event) => {
  const mounted = activeInstall;
  if (!mounted || mounted.stage !== "title" || !titleGraphicIsOpen(mounted)) {
    return;
  }
  const state = ensureTitleGraphicState(mounted);
  const assets = mountedTitleGraphicAssets(mounted);
  if (titleGraphicStepPage(state, event.deltaY > 0 ? 1 : -1, assets.length)) {
    prepareTitleGraphicPage(mounted);
    paintMountedFrame(mounted);
    publishRuntimeState(true);
  }
  event.preventDefault();
  event.stopPropagation();
}, { passive: false, capture: true });
canvas.addEventListener("wheel", (event) => {
  const mounted = activeInstall;
  if (!mounted || mounted.stage !== "title" || !titleMusicIsOpen(mounted)) {
    return;
  }
  const state = ensureTitleMusicState(mounted);
  if (titleMusicStepPage(state, event.deltaY > 0 ? 1 : -1)) {
    paintMountedFrame(mounted);
    publishRuntimeState(true);
  }
  event.preventDefault();
  event.stopPropagation();
}, { passive: false, capture: true });
function handleEngineManagerGesture(event, phase) {
  const result = engineManagerGesture[phase]?.(event) ?? { suppress: false, recognized: false };
  if (!result.suppress && !result.recognized) {
    return;
  }
  input.cancelActivePointerClicks?.();
  if (result.recognized) {
    engineManager.toggle();
  }
  event.preventDefault();
  event.stopImmediatePropagation();
}
canvas.addEventListener("pointerdown", (event) => {
  handleEngineManagerGesture(event, "pointerDown");
}, { passive: false, capture: true });
canvas.addEventListener("pointermove", (event) => {
  handleEngineManagerGesture(event, "pointerMove");
}, { passive: false, capture: true });
canvas.addEventListener("pointerup", (event) => {
  handleEngineManagerGesture(event, "pointerUp");
}, { passive: false, capture: true });
canvas.addEventListener("pointercancel", (event) => {
  handleEngineManagerGesture(event, "pointerCancel");
}, { passive: false, capture: true });
globalThis.sakuraAdvanceBoot = () => {
  const mounted = activeInstall;
  if (!mounted) return false;
  if (dialogIsOpen(mounted)) {
    return true;
  }
  if (mounted.stage === "boot") { advanceBootPhase(mounted); publishRuntimeState(true); return true; }
  if (mounted.stage === "title") {
    if (
      titleConfigIsOpen(mounted)
      || titleUserDataIsOpen(mounted)
      || titleGraphicIsOpen(mounted)
      || titleSceneIsOpen(mounted)
      || titleMusicIsOpen(mounted)
    ) {
      return true;
    }
    return activateTitleMenu(mounted, 0);
  }
  return false;
};
canvas.addEventListener("click", (event) => {
  const mounted = activeInstall;
  if (!mounted) return;
  retryTitleBgm(mounted);
  if (mounted.stage === "boot") {
    // The original logo->title sequence lets a click/repeated clicks skip the
    // current crossfade or hold and advance toward the title. Advance one phase
    // per click regardless of whether it is a hold or a transition.
    advanceBootPhase(mounted);
    publishRuntimeState(true);
    return;
  }
  if (mounted.stage === "title") {
    if (suppressNextTitleClick) {
      suppressNextTitleClick = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (titleConfigIsOpen(mounted)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (titleUserDataIsOpen(mounted)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (titleGraphicIsOpen(mounted)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (titleSceneIsOpen(mounted)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (titleMusicIsOpen(mounted)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const hit = titleMenuHit(mounted, event.clientX, event.clientY);
    if (activateTitleMenu(mounted, hit)) {
      // Decide/click SFX (SSE000001) on a successful menu activation.
      playTitleSfx(mounted, TITLE_SFX_DECIDE);
      event.preventDefault();
      event.stopPropagation();
    }
  }
}, true);
// Browsers pause media elements when the tab is hidden / loses audio focus.
// When the page becomes visible again, resume the title BGM so it does not
// stay silently stopped.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") {
    return;
  }
  const mounted = activeInstall;
  if (mounted?.stage === "title" && mounted.titleBgmPlaying) {
    mounted.audioMixer?.resumeTrack?.();
  }
  retryTitleBgm(mounted);
});
window.addEventListener("focus", () => {
  const mounted = activeInstall;
  if (mounted?.stage === "title" && mounted.titleBgmPlaying) {
    mounted.audioMixer?.resumeTrack?.();
  }
});
canvas.addEventListener("contextmenu", (event) => {
  if (dialogIsOpen(activeInstall)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }
}, true);
canvas.addEventListener("contextmenu", (event) => {
  const mounted = activeInstall;
  if (
    !mounted
    || mounted.stage !== "title"
    || (
      !titleConfigIsOpen(mounted)
      && !titleUserDataIsOpen(mounted)
      && !titleGraphicIsOpen(mounted)
      && !titleSceneIsOpen(mounted)
      && !titleMusicIsOpen(mounted)
    )
  ) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
}, true);
window.addEventListener("keydown", (event) => {
  const mounted = activeInstall;
  if (
    !dialogIsOpen(mounted)
    || (event.key !== "Escape" && event.key !== "Backspace" && event.key !== "Enter")
  ) {
    return;
  }
  applyDialogControl(mounted, {
    kind: "button",
    action: event.key === "Enter" ? "yes" : "no",
  });
  suppressNextTitleClick = true;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);
window.addEventListener("keydown", (event) => {
  if (event.code === "ControlLeft" && !event.repeat) {
    engineManager.toggle();
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}, true);
window.addEventListener("keydown", (event) => {
  const mounted = activeInstall;
  const titleMusicKeys = new Set(["ArrowLeft", "ArrowRight", "PageUp", "PageDown"]);
  const titleGraphicKeys = new Set(["ArrowLeft", "ArrowRight", "PageUp", "PageDown"]);
  const closeKey = event.key === "Escape" || event.key === "Backspace";
  const musicPageKey = titleMusicKeys.has(event.key) && titleMusicIsOpen(mounted);
  const graphicPageKey = titleGraphicKeys.has(event.key) && titleGraphicIsOpen(mounted);
  if (
    !mounted
    || mounted.stage !== "title"
    || (!closeKey && !musicPageKey && !graphicPageKey)
  ) {
    return;
  }
  if (titleConfigIsOpen(mounted)) {
    if (!closeKey) {
      return;
    }
    closeScenarioConfigWindow(ensureTitleConfigState(mounted));
  } else if (titleUserDataIsOpen(mounted)) {
    if (!closeKey) {
      return;
    }
    closeScenarioUserDataWindow(ensureTitleUserDataState(mounted));
  } else if (titleGraphicIsOpen(mounted)) {
    const state = ensureTitleGraphicState(mounted);
    if (state.viewerOpen) {
      if (!closeKey) {
        return;
      }
      closeTitleGraphicViewer(state);
    } else if (graphicPageKey) {
      const assets = mountedTitleGraphicAssets(mounted);
      titleGraphicStepPage(state, event.key === "ArrowRight" || event.key === "PageDown" ? 1 : -1, assets.length);
      prepareTitleGraphicPage(mounted);
    } else {
      closeTitleGraphic(state);
    }
  } else if (titleSceneIsOpen(mounted)) {
    if (!closeKey) {
      return;
    }
    closeTitleSceneSelect(ensureTitleSceneState(mounted));
  } else if (titleMusicIsOpen(mounted)) {
    const state = ensureTitleMusicState(mounted);
    if (musicPageKey) {
      titleMusicStepPage(state, event.key === "ArrowRight" || event.key === "PageDown" ? 1 : -1);
    } else {
      closeTitleMusic(state);
    }
  } else {
    return;
  }
  paintMountedFrame(mounted);
  publishRuntimeState(true);
  event.preventDefault();
  event.stopPropagation();
}, true);
bindScenarioPlayerInput(canvas, () => activeInstall, () => {
  maybeOpenScenarioTitleDialog(activeInstall);
  maybeOpenPendingScenarioDialog(activeInstall);
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
    applyUpscaleSettingsToMounted(activeInstall, engineManager.settings, { refresh: false });
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
    hostStage: activeInstall?.stage ?? null,
    hostBootPhase: activeInstall?.bootPhase ?? 0,
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
  applyUpscaleSettingsToMounted(activeInstall, engineManager.settings, { refresh: false });
  exposeActiveInstallDebug();
  if (activeInstall?.summary) {
    activeInstall.summary.localSystemRuntimeTimingStage = 104;
  }
  bindRuntimeSessionControls();
  paintMountedFrame(activeInstall);
  if (activeInstall && (activeInstall.stage === "boot" || activeInstall.stage === "title")) stageEnter(activeInstall);
  publishRuntimeState(true);
  renderInstallSummaryText(mounted.summary, true);
}

function titleLayout(image, stageCanvas = scenarioLogicalCanvas) {
  const logicalWidth = imageLogicalWidth(image);
  const logicalHeight = imageLogicalHeight(image);
  const scale = Math.min(stageCanvas.width / logicalWidth, stageCanvas.height / logicalHeight);
  const w = Math.round(logicalWidth * scale);
  const h = Math.round(logicalHeight * scale);
  const x = Math.floor((stageCanvas.width - w) / 2);
  const y = Math.floor((stageCanvas.height - h) / 2);
  return { x, y, w, h };
}

function activateTitleMenu(mounted, index) {
  if (!mounted || mounted.stage !== "title" || !Number.isInteger(index) || index < 0) {
    return false;
  }
  const control = currentTitleMenuControls(mounted)[index] ?? null;
  if (!control) {
    return false;
  }
  mounted.hoverIndex = index;
  if (!control.enabled) {
    mounted.titleLastAction = `${control.action}_disabled`;
    paintMountedFrame(mounted);
    publishRuntimeState(true);
    return true;
  }
  if (control.action === "start") {
    mounted.titleLastAction = "start";
    stopTitleBgm(mounted);
    mounted.startScenario?.();
  } else if (control.action === "load") {
    mounted.titleLastAction = "load";
    openTitleUserDataWindow(mounted);
  } else if (control.action === "config") {
    mounted.titleLastAction = "config";
    openTitleConfigWindow(mounted);
  } else if (control.action === "extra") {
    mounted.titleMenuMode = TITLE_MENU_MODE_EXTRA;
    mounted.hoverIndex = -1;
    mounted.titleLastAction = "extra_open";
  } else if (control.action === "back") {
    mounted.titleMenuMode = TITLE_MENU_MODE_MAIN;
    mounted.hoverIndex = -1;
    mounted.titleLastAction = "extra_back";
  } else if (control.action === "graphic") {
    openTitleGraphicHost(mounted);
  } else if (control.action === "scene") {
    openTitleSceneSelectHost(mounted);
  } else if (control.action === "music") {
    openTitleMusicHost(mounted);
  } else if (control.action === "route") {
    mounted.titleLastAction = `route_${control.routeId}`;
    stopTitleBgm(mounted);
    const scenarioName = scenarioSequenceForRoute(control.routeId)[0] ?? "";
    void mounted.startScenarioRoute?.(control.routeId, scenarioName).then(() => {
      paintMountedFrame(mounted);
      publishRuntimeState(true);
    });
  } else if (control.action === "exit") {
    mounted.titleLastAction = "exit_confirm";
    openMountedDialog(mounted, "exit", "titleExit");
  } else {
    mounted.titleLastAction = `${control.action}_pending`;
  }
  paintMountedFrame(mounted);
  publishRuntimeState(true);
  return true;
}

function ensureDialogState(mounted) {
  if (!mounted.dialogState) {
    mounted.dialogState = createScenarioDialogState();
  }
  return mounted.dialogState;
}

function dialogIsOpen(mounted) {
  return mounted?.dialogState?.open === true;
}

function openMountedDialog(mounted, kind, source) {
  if (!mounted) {
    return false;
  }
  const opened = openScenarioDialog(ensureDialogState(mounted), kind, source);
  if (opened && mounted.stage === "title") {
    mounted.hoverIndex = -1;
  }
  return opened;
}

function updateDialogHover(mounted, clientX, clientY) {
  const state = ensureDialogState(mounted);
  const point = canvasPointFromClient(clientX, clientY);
  const control = scenarioDialogControlAt(point.x, point.y, state, mounted.dialogWindow);
  const next = scenarioDialogHoverKey(control);
  if (state.hover === next) {
    return false;
  }
  state.hover = next;
  return true;
}

function applyDialogClick(mounted, clientX, clientY) {
  const state = ensureDialogState(mounted);
  const point = canvasPointFromClient(clientX, clientY);
  return applyDialogControl(
    mounted,
    scenarioDialogControlAt(point.x, point.y, state, mounted.dialogWindow),
  );
}

function applyDialogControl(mounted, control) {
  const state = ensureDialogState(mounted);
  const kind = state.kind;
  const source = state.source;
  const result = applyScenarioDialogControl(state, control);
  if (result.handled) {
    handleDialogResult(mounted, { ...result, kind, source });
    paintMountedFrame(mounted);
    publishRuntimeState(true);
  }
  return result;
}

function maybeOpenScenarioTitleDialog(mounted) {
  const player = mounted?.player ?? null;
  if (
    !player
    || player.configState?.lastAction !== "title_pending"
    || dialogIsOpen(mounted)
  ) {
    return false;
  }
  player.configState.lastAction = "title_confirm";
  player.syncConfigState?.();
  return openMountedDialog(mounted, "title", "scenarioConfigTitle");
}

function maybeOpenPendingScenarioDialog(mounted) {
  const pending = mounted?.player?.pendingDialogAction ?? null;
  if (!pending || pending.opened === true || dialogIsOpen(mounted)) {
    return false;
  }
  pending.opened = true;
  return openMountedDialog(mounted, pending.kind, pending.source);
}

function handleDialogResult(mounted, result) {
  if (!mounted || !result?.handled) {
    return;
  }
  if (result.reason !== "yes") {
    cancelDialogAction(mounted, result);
    return;
  }
  if (result.source === "titleUserDataLoad") {
    confirmTitleUserDataLoad(mounted);
    return;
  }
  if (isScenarioUserDataDialogSource(result.source)) {
    mounted.player?.confirmPendingDialogAction?.(() => {
      paintMountedFrame(mounted);
      publishRuntimeState(true);
    });
    return;
  }
  if (result.kind === "exit") {
    closeScenarioConfigWindow(ensureTitleConfigState(mounted));
    closeScenarioUserDataWindow(ensureTitleUserDataState(mounted));
    mounted.audioMixer?.destroy?.();
    updateAudioState(mounted);
    mounted.stage = "exited";
    mounted.titleLastAction = "exit_confirmed";
    return;
  }
  if (result.kind === "title") {
    mounted.titleLastAction = "title_confirmed";
    if (result.source === "titleConfigTitle") {
      closeScenarioConfigWindow(ensureTitleConfigState(mounted));
      return;
    }
    returnMountedToTitle(mounted);
  }
}

function cancelDialogAction(mounted, result) {
  if (result.source === "scenarioQuickSaveNotice") {
    if (mounted.player) {
      mounted.player.pendingDialogAction = null;
    }
    return;
  }
  if (result.source === "titleUserDataLoad") {
    mounted.pendingDialogAction = null;
    mounted.titleUserDataLastResult = "load_cancelled";
    mounted.titleUserDataLastOk = 0;
    return;
  }
  if (isScenarioUserDataDialogSource(result.source)) {
    mounted.player?.cancelPendingDialogAction?.("cancelled");
    return;
  }
  if (result.kind === "exit") {
    mounted.titleLastAction = "exit_cancelled";
    return;
  }
  mounted.titleLastAction = "title_cancelled";
  if (result.source === "scenarioConfigTitle" && mounted.player?.configState) {
    mounted.player.configState.lastAction = "title_cancelled";
    mounted.player.syncConfigState?.();
  }
  if (result.source === "titleConfigTitle" && mounted.titleConfigState) {
    mounted.titleConfigState.lastAction = "title_cancelled";
  }
}

function isScenarioUserDataDialogSource(source) {
  return (
    source === "scenarioUserDataSave"
    || source === "scenarioUserDataLoad"
    || source === "scenarioQuickLoad"
  );
}

function requestTitleUserDataLoad(mounted, slot) {
  mounted.pendingDialogAction = {
    action: "titleUserDataLoad",
    slot,
    kind: "load",
    source: "titleUserDataLoad",
  };
  mounted.titleUserDataLastResult = "load_confirm";
  mounted.titleUserDataLastOk = 1;
  openMountedDialog(mounted, "load", "titleUserDataLoad");
}

function confirmTitleUserDataLoad(mounted) {
  const pending = mounted.pendingDialogAction;
  mounted.pendingDialogAction = null;
  const slot = pending?.action === "titleUserDataLoad" ? pending.slot : 0;
  closeScenarioUserDataWindow(ensureTitleUserDataState(mounted));
  stopTitleBgm(mounted);
  mounted.titleUserDataLastResult = "loading";
  mounted.titleUserDataLastOk = 1;
  void mounted.loadScenarioFromStorage?.(slot).then((load) => {
    mounted.titleUserDataLastResult = load?.reason ?? "load_unavailable";
    mounted.titleUserDataLastOk = Number(load?.ok === true);
    paintMountedFrame(mounted);
    publishRuntimeState(true);
  });
}

function returnMountedToTitle(mounted) {
  mounted.audioMixer?.destroy?.();
  mounted.titleBgmPlaying = null;
  updateAudioState(mounted);
  if (mounted.player?.destroy) {
    mounted.player.destroy();
  }
  mounted.player = null;
  mounted.stage = mounted.titleImage ? "title" : "scenario";
  mounted.hoverIndex = -1;
  mounted.titleMenuMode = TITLE_MENU_MODE_MAIN;
  closeScenarioConfigWindow(ensureTitleConfigState(mounted));
  closeScenarioUserDataWindow(ensureTitleUserDataState(mounted));
  closeTitleGraphic(ensureTitleGraphicState(mounted));
  closeTitleSceneSelect(ensureTitleSceneState(mounted));
  closeTitleMusic(ensureTitleMusicState(mounted));
  mounted.summary.localRuntimeScenarioSessionReady = 0;
  mounted.summary.localRuntimeScenarioSessionEventKind = 0;
  mounted.summary.localRuntimeScenarioSessionMode = 0;
  mounted.summary.localRuntimeScenarioSessionPayloadBytes = 0;
  mounted.safeState.player = { active: false };
  if (mounted.stage === "title") {
    stageEnter(mounted);
  }
}

function ensureTitleConfigState(mounted) {
  if (!mounted.titleConfigState) {
    const state = createScenarioConfigState();
    const settings = readStoredScenarioConfigSettings();
    if (settings !== null) {
      state.settings = settings;
    }
    mounted.titleConfigState = state;
  }
  return mounted.titleConfigState;
}

function titleConfigIsOpen(mounted) {
  return mounted?.titleConfigState?.open === true;
}

function openTitleConfigWindow(mounted) {
  const state = ensureTitleConfigState(mounted);
  const settings = readStoredScenarioConfigSettings();
  if (settings !== null) {
    state.settings = settings;
  }
  openScenarioConfigWindow(state);
  applyTitleConfigVolumes(mounted);
}

// Apply the Config master/BGM/SE/voice levels to the title audio mixer so that
// volume changes made at the title screen actually affect the title BGM (and
// any UI SFX), mirroring the in-scenario player's applyConfigSettings().
function applyTitleConfigVolumes(mounted) {
  const settings = mounted?.titleConfigState?.settings ?? readStoredScenarioConfigSettings();
  if (!settings || !mounted?.audioMixer?.setVolumes) {
    return;
  }
  mounted.audioMixer.setVolumes({
    master: settings.masterVolume,
    bgm: settings.bgmVolume,
    sfx: settings.sfxVolume,
    voice: settings.voiceVolume,
  });
}

function updateTitleConfigHover(mounted, clientX, clientY) {
  const state = ensureTitleConfigState(mounted);
  const point = canvasPointFromClient(clientX, clientY);
  const control = scenarioConfigControlAt(point.x, point.y, state, mounted.configWindow);
  const next = scenarioConfigHoverKey(control);
  if (state.hover === next) {
    return false;
  }
  state.hover = next;
  return true;
}

function applyTitleConfigClick(mounted, clientX, clientY) {
  const state = ensureTitleConfigState(mounted);
  const point = canvasPointFromClient(clientX, clientY);
  const control = scenarioConfigControlAt(point.x, point.y, state, mounted.configWindow);
  const result = applyScenarioConfigControl(state, control);
  if (result.handled && result.reason !== "title_pending") {
    applyTitleConfigVolumes(mounted);
    if (result.reason === "screenMode") {
      const screenMode = applyScenarioScreenMode(state.settings);
      mounted.titleConfigScreenModeResult = screenMode.reason;
      mounted.titleConfigScreenModeOk = Number(screenMode.ok);
    }
    storeScenarioConfigSettings(state.settings);
  } else if (result.reason === "title_pending") {
    storeScenarioConfigSettings(state.settings);
    state.lastAction = "title_confirm";
    openMountedDialog(mounted, "title", "titleConfigTitle");
  }
  return result;
}

function canvasPointFromClient(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) * (canvasLogicalWidth() / rect.width),
    y: (clientY - rect.top) * (canvasLogicalHeight() / rect.height),
  };
}

function canvasLogicalWidth() {
  const value = Number.parseInt(canvas.dataset.logicalWidth ?? "", 10);
  return Number.isSafeInteger(value) && value > 0 ? value : canvas.width;
}

function canvasLogicalHeight() {
  const value = Number.parseInt(canvas.dataset.logicalHeight ?? "", 10);
  return Number.isSafeInteger(value) && value > 0 ? value : canvas.height;
}

function ensureTitleUserDataState(mounted) {
  if (!mounted.titleUserDataState) {
    mounted.titleUserDataState = createScenarioUserDataState();
  }
  return mounted.titleUserDataState;
}

function titleUserDataIsOpen(mounted) {
  return mounted?.titleUserDataState?.open === true;
}

function openTitleUserDataWindow(mounted) {
  const state = ensureTitleUserDataState(mounted);
  openScenarioUserDataWindow(state, "load");
}

function updateTitleUserDataHover(mounted, clientX, clientY) {
  const state = ensureTitleUserDataState(mounted);
  const point = canvasPointFromClient(clientX, clientY);
  const control = scenarioUserDataControlAt(point.x, point.y, state, mounted.userDataWindow);
  const next = userDataHoverKey(control);
  if (state.hover === next) {
    return false;
  }
  state.hover = next;
  return true;
}

function applyTitleUserDataClick(mounted, clientX, clientY) {
  const state = ensureTitleUserDataState(mounted);
  const point = canvasPointFromClient(clientX, clientY);
  const control = scenarioUserDataControlAt(point.x, point.y, state, mounted.userDataWindow);
  const result = applyScenarioUserDataControl(state, control, {
    save: () => ({ handled: true, ok: false, reason: "title_save_unsupported" }),
    load: (slot) => {
      const summary = readScenarioSaveSlotSummary(slot);
      if (!summary.exists) {
        return { handled: true, ok: false, reason: "missing_snapshot" };
      }
      requestTitleUserDataLoad(mounted, slot);
      return { handled: true, ok: true, reason: "load_confirm" };
    },
  });
  mounted.titleUserDataLastResult = result.reason ?? "";
  mounted.titleUserDataLastOk = Number(result.ok ?? result.handled ?? false);
  return result;
}

function titleUserDataSlotRecords(mounted) {
  const state = ensureTitleUserDataState(mounted);
  const start = state.page * USER_DATA_SLOTS_PER_PAGE;
  return Array.from(
    { length: USER_DATA_SLOTS_PER_PAGE },
    (_, index) => {
      const summary = readScenarioSaveSlotSummary(start + index);
      if (summary.exists && summary.previewDataUrl) {
        summary.thumbnail = resolveTitleUserDataPreviewThumbnail(mounted, summary.previewDataUrl);
      } else if (summary.exists && summary.backgroundName) {
        summary.thumbnail = resolveTitleUserDataThumbnail(mounted, summary.backgroundName);
      }
      return summary;
    },
  );
}

function resolveTitleUserDataPreviewThumbnail(mounted, dataUrl) {
  if (!mounted.userDataPreviewThumbnailCache) {
    mounted.userDataPreviewThumbnailCache = new Map();
  }
  return resolveUserDataPreviewImage(dataUrl, mounted.userDataPreviewThumbnailCache, () => {
    if (isCurrentInstall(mounted) && titleUserDataIsOpen(mounted)) {
      paintMountedFrame(mounted);
      publishRuntimeState();
    }
  });
}

// Decode the saved scene CG into a thumbnail for the title-screen Load window,
// async + cached, repainting when ready (mirrors loadTitleSceneImage).
function resolveTitleUserDataThumbnail(mounted, assetName) {
  if (!/^[A-Za-z0-9_]+$/.test(String(assetName))) {
    return null;
  }
  if (!mounted.userDataThumbnailCache) {
    mounted.userDataThumbnailCache = new Map();
  }
  const cache = mounted.userDataThumbnailCache;
  const cached = cache.get(assetName);
  if (cached) {
    return cached.image ?? null;
  }
  cache.set(assetName, { status: "loading", image: null });
  void (async () => {
    let image = null;
    try {
      image = await loadMountedImageAsset(mounted, assetName, "visible", (readyImage) => {
        cache.set(assetName, { status: "ready", image: readyImage });
        if (isCurrentInstall(mounted) && titleUserDataIsOpen(mounted)) {
          paintMountedFrame(mounted);
          publishRuntimeState();
        }
      });
    } catch {
      image = null;
    }
    cache.set(assetName, { status: image ? "ready" : "missing", image });
    if (isCurrentInstall(mounted) && titleUserDataIsOpen(mounted)) {
      paintMountedFrame(mounted);
      publishRuntimeState();
    }
  })();
  return null;
}

function ensureTitleGraphicState(mounted) {
  if (!mounted.titleGraphicState) {
    mounted.titleGraphicState = createTitleGraphicState();
  }
  return mounted.titleGraphicState;
}

function titleGraphicIsOpen(mounted) {
  return mounted?.titleGraphicState?.open === true;
}

function mountedTitleGraphicAssets(mounted) {
  if (!mounted) {
    return [];
  }
  const sidecar = mounted.gdbViewedImages instanceof Set ? mounted.gdbViewedImages : new Set();
  // The original unlocks gallery CGs from the BGI.gdb viewed-image table, which
  // the engine appends to as the player sees each CG. We union the shipped
  // sidecar set with the CGs recorded at runtime (sakura.viewed.v1) so CGs seen
  // in play unlock their gallery thumbnails.
  const runtimeViewed = loadViewedData().cg;
  const viewedImages = runtimeViewed.size === 0
    ? sidecar
    : new Set([...sidecar, ...runtimeViewed]);
  const forceUnlock = titleGraphicForceUnlock;
  const viewedSignature = viewedImages.size;
  if (
    mounted.titleGraphicAssetsCache?.catalog === mounted.catalog
    && mounted.titleGraphicAssetsCache?.viewedSignature === viewedSignature
    && mounted.titleGraphicAssetsCache?.forceUnlock === forceUnlock
  ) {
    return mounted.titleGraphicAssetsCache.assets;
  }
  const assets = titleGraphicAssets(mounted.catalog, { viewedImages, forceUnlock });
  mounted.titleGraphicAssetsCache = {
    catalog: mounted.catalog,
    viewedSignature,
    forceUnlock,
    assets,
  };
  return assets;
}

function openTitleGraphicHost(mounted) {
  if (!mounted || mounted.stage !== "title") {
    return { ok: false, reason: "not_title" };
  }
  if (dialogIsOpen(mounted)) {
    return { ok: false, reason: "dialog_open" };
  }
  closeScenarioConfigWindow(ensureTitleConfigState(mounted));
  closeScenarioUserDataWindow(ensureTitleUserDataState(mounted));
  closeTitleSceneSelect(ensureTitleSceneState(mounted));
  closeTitleMusic(ensureTitleMusicState(mounted));
  const state = ensureTitleGraphicState(mounted);
  const assets = mountedTitleGraphicAssets(mounted);
  if (state.selectedIndex < 0 && assets.length > 0) {
    const firstUnlocked = assets.find((asset) => asset.unlocked !== false) ?? assets[0];
    state.selectedIndex = firstUnlocked.index;
    state.selectedAssetName = firstUnlocked.assetName;
  }
  openTitleGraphic(state);
  mounted.hoverIndex = -1;
  mounted.titleLastAction = "graphic_open";
  prepareTitleGraphicChrome(mounted);
  prepareTitleGraphicPage(mounted);
  paintMountedFrame(mounted);
  publishRuntimeState(true);
  return {
    ok: true,
    reason: "ok",
    assetCount: assets.length,
  };
}

function updateTitleGraphicHover(mounted, clientX, clientY) {
  const state = ensureTitleGraphicState(mounted);
  const point = canvasPointFromClient(clientX, clientY);
  const assets = mountedTitleGraphicAssets(mounted);
  const control = titleGraphicControlAt(point.x, point.y, state, assets, mounted.titleButtonSprites);
  const next = titleGraphicHoverKey(control);
  if (state.hoverIndex === next) {
    return false;
  }
  state.hoverIndex = next;
  return true;
}

async function applyTitleGraphicClick(mounted, clientX, clientY) {
  const state = ensureTitleGraphicState(mounted);
  const point = canvasPointFromClient(clientX, clientY);
  const assets = mountedTitleGraphicAssets(mounted);
  const control = titleGraphicControlAt(point.x, point.y, state, assets, mounted.titleButtonSprites);
  return await handleTitleGraphicResult(
    mounted,
    applyTitleGraphicControl(state, control, assets.length),
  );
}

async function handleTitleGraphicResult(mounted, result) {
  if (!mounted || !result?.handled) {
    return { ok: false, reason: "not_handled" };
  }
  const state = ensureTitleGraphicState(mounted);
  if (result.action === "back") {
    mounted.titleLastAction = "graphic_back";
    paintMountedFrame(mounted);
    publishRuntimeState(true);
    return { ok: true, reason: "back", action: "back" };
  }
  if (result.action === "page") {
    mounted.titleLastAction = "graphic_page";
    prepareTitleGraphicPage(mounted);
    paintMountedFrame(mounted);
    publishRuntimeState(true);
    return { ok: true, reason: "page", action: "page", page: result.page };
  }
  if (result.action === "viewer_back") {
    mounted.titleLastAction = "graphic_viewer_back";
    paintMountedFrame(mounted);
    publishRuntimeState(true);
    return { ok: true, reason: "viewer_back", action: "viewer_back" };
  }
  if (result.action === "locked") {
    mounted.titleLastAction = "graphic_locked";
    paintMountedFrame(mounted);
    publishRuntimeState(true);
    return {
      ok: false,
      reason: "locked",
      action: "locked",
      index: result.index,
      assetName: result.assetName,
    };
  }
  if (result.action !== "select") {
    return { ok: false, reason: "unknown_action" };
  }
  mounted.titleLastAction = "graphic_select";
  const fullAssetName = result.fullAssetName || result.assetName;
  const image = await loadTitleGraphicImage(mounted, fullAssetName);
  state.lastLoadOk = Number(image !== null);
  state.lastLoadReason = image ? "ok" : "asset_missing";
  state.viewerLoadOk = state.lastLoadOk;
  state.viewerLoadReason = state.lastLoadReason;
  paintMountedFrame(mounted);
  publishRuntimeState(true);
  return {
    ok: image !== null,
    reason: state.lastLoadReason,
    action: "select",
    index: result.index,
    assetName: result.assetName,
    fullAssetName,
    assetReady: Number(image !== null),
  };
}

function prepareTitleGraphicPage(mounted) {
  if (!mounted || !titleGraphicIsOpen(mounted)) {
    return;
  }
  const state = ensureTitleGraphicState(mounted);
  const assets = mountedTitleGraphicAssets(mounted);
  const choices = titleGraphicVisibleChoices(state, assets);
  const selected = assets.find((asset) => asset.index === state.selectedIndex) ?? null;
  const preloadAssets = selected ? [selected, ...choices] : choices;
  const assetNames = new Set(
    preloadAssets
      .filter((choice) => choice?.locked !== true)
      .map((choice) => choice.assetName),
  );
  if (state.viewerOpen && state.viewerAssetName) {
    assetNames.add(state.viewerAssetName);
  }
  for (const assetName of assetNames) {
    void loadTitleGraphicImage(mounted, assetName).then(() => {
      if (isCurrentInstall(mounted) && titleGraphicIsOpen(mounted)) {
        paintMountedFrame(mounted);
        publishRuntimeState();
      }
    });
  }
}

function prepareTitleGraphicChrome(mounted) {
  if (!mounted || !titleGraphicIsOpen(mounted)) {
    return;
  }
  for (const assetName of titleGraphicChromeAssetNames()) {
    void loadTitleGraphicChromeImage(mounted, assetName).then(() => {
      if (isCurrentInstall(mounted) && titleGraphicIsOpen(mounted)) {
        paintMountedFrame(mounted);
        publishRuntimeState();
      }
    });
  }
}

async function loadMountedImageAsset(mounted, assetName, role, onReady) {
  if (!mounted?.catalog || !mounted?.core) {
    return null;
  }
  if (!mounted.sharedImageAssetCache) {
    mounted.sharedImageAssetCache = new Map();
  }
  const settings = mountedUpscaleSettings(mounted);
  const settingsKey = JSON.stringify(settings);
  return await loadImageAsset(mounted.catalog, mounted.core, assetNameEncoder.encode(assetName), {
    cache: mounted.sharedImageAssetCache,
    cacheLimit: 96,
    role,
    settings,
    isStillWanted: () => !mounted.destroyed
      && isCurrentInstall(mounted)
      && JSON.stringify(mountedUpscaleSettings(mounted)) === settingsKey,
    onReady: (_cacheKey, readyImage) => {
      if (!isCurrentInstall(mounted)) {
        return;
      }
      if (JSON.stringify(mountedUpscaleSettings(mounted)) !== settingsKey) {
        return;
      }
      onReady?.(readyImage);
      publishRuntimeState(true);
    },
  });
}

async function loadTitleGraphicChromeImage(mounted, assetName) {
  if (!/^[A-Za-z0-9_]+$/.test(String(assetName ?? ""))) {
    return null;
  }
  if (!mounted.titleGraphicChromeCache) {
    mounted.titleGraphicChromeCache = new Map();
  }
  const cached = mounted.titleGraphicChromeCache.get(assetName);
  if (cached?.status === "ready" || cached?.status === "missing" || cached?.status === "error") {
    return cached.image ?? null;
  }
  if (cached?.promise) {
    return cached.promise;
  }
  const promise = (async () => {
    try {
      const image = await loadMountedImageAsset(mounted, assetName, "ui", (readyImage) => {
        mounted.titleGraphicChromeCache.set(assetName, { status: "ready", image: readyImage });
        paintMountedFrame(mounted);
      });
      mounted.titleGraphicChromeCache.set(assetName, {
        status: image ? "ready" : "missing",
        image,
      });
      return image;
    } catch {
      mounted.titleGraphicChromeCache.set(assetName, { status: "error", image: null });
      return null;
    }
  })();
  mounted.titleGraphicChromeCache.set(assetName, { status: "loading", image: null, promise });
  return promise;
}

async function loadTitleGraphicImage(mounted, assetName) {
  if (!/^[A-Za-z0-9_]+$/.test(String(assetName ?? ""))) {
    return null;
  }
  if (!mounted.titleGraphicImageCache) {
    mounted.titleGraphicImageCache = new Map();
  }
  const cached = mounted.titleGraphicImageCache.get(assetName);
  if (cached?.status === "ready" || cached?.status === "missing" || cached?.status === "error") {
    return cached.image ?? null;
  }
  if (cached?.promise) {
    return cached.promise;
  }
  const promise = (async () => {
    try {
      const image = await loadMountedImageAsset(mounted, assetName, "visible", (readyImage) => {
        mounted.titleGraphicImageCache.set(assetName, { status: "ready", image: readyImage });
        paintMountedFrame(mounted);
      });
      mounted.titleGraphicImageCache.set(assetName, {
        status: image ? "ready" : "missing",
        image,
      });
      return image;
    } catch {
      mounted.titleGraphicImageCache.set(assetName, { status: "error", image: null });
      return null;
    }
  })();
  mounted.titleGraphicImageCache.set(assetName, { status: "loading", image: null, promise });
  return promise;
}

function ensureTitleSceneState(mounted) {
  if (!mounted.titleSceneState) {
    mounted.titleSceneState = createTitleSceneSelectState();
  }
  return mounted.titleSceneState;
}

// Scene-recollection per-row lock (faithful omakescene viewed-image-table rule):
// a row is locked until one of its scene's CGs is in the runtime viewed-image
// record (sakura.viewed.v1 .cg). `?unlockScene=1` / `?unlockExtra=1` force it
// open for automation.
function titleSceneRowLocked(scenarioName) {
  if (titleSceneForceUnlock) {
    return false;
  }
  return !titleSceneRowUnlocked(scenarioName, loadViewedData().cg);
}

function titleSceneLockedIndexSet() {
  const locked = new Set();
  if (titleSceneForceUnlock) {
    return locked;
  }
  const viewedCg = loadViewedData().cg;
  for (const choice of titleSceneChoices()) {
    if (!titleSceneRowUnlocked(choice.scenarioName, viewedCg)) {
      locked.add(choice.index);
    }
  }
  return locked;
}

function titleSceneIsOpen(mounted) {
  return mounted?.titleSceneState?.open === true;
}

function openTitleSceneSelectHost(mounted) {
  if (!mounted || mounted.stage !== "title") {
    return { ok: false, reason: "not_title" };
  }
  if (dialogIsOpen(mounted)) {
    return { ok: false, reason: "dialog_open" };
  }
  closeScenarioConfigWindow(ensureTitleConfigState(mounted));
  closeScenarioUserDataWindow(ensureTitleUserDataState(mounted));
  closeTitleGraphic(ensureTitleGraphicState(mounted));
  closeTitleMusic(ensureTitleMusicState(mounted));
  const state = ensureTitleSceneState(mounted);
  openTitleSceneSelect(state);
  mounted.titleSceneLockedSet = titleSceneLockedIndexSet();
  prepareTitleSceneThumbnails(mounted);
  mounted.hoverIndex = -1;
  mounted.titleLastAction = "scene_open";
  paintMountedFrame(mounted);
  publishRuntimeState(true);
  return {
    ok: true,
    reason: "ok",
    choiceCount: titleSceneChoices().length,
    lockedCount: mounted.titleSceneLockedSet.size,
  };
}

function prepareTitleSceneThumbnails(mounted) {
  if (!mounted || !titleSceneIsOpen(mounted)) {
    return;
  }
  for (const choice of titleSceneChoices()) {
    void loadTitleSceneImage(mounted, choice.thumbnailAssetName).then(() => {
      if (isCurrentInstall(mounted) && titleSceneIsOpen(mounted)) {
        paintMountedFrame(mounted);
        publishRuntimeState();
      }
    });
  }
}

async function loadTitleSceneImage(mounted, assetName) {
  if (!/^[A-Za-z0-9_]+$/.test(String(assetName ?? ""))) {
    return null;
  }
  if (!mounted.titleSceneImageCache) {
    mounted.titleSceneImageCache = new Map();
  }
  const cached = mounted.titleSceneImageCache.get(assetName);
  if (cached?.status === "ready" || cached?.status === "missing" || cached?.status === "error") {
    return cached.image ?? null;
  }
  if (cached?.promise) {
    return cached.promise;
  }
  const promise = (async () => {
    try {
      const image = await loadMountedImageAsset(mounted, assetName, "visible", (readyImage) => {
        mounted.titleSceneImageCache.set(assetName, { status: "ready", image: readyImage });
        paintMountedFrame(mounted);
      });
      mounted.titleSceneImageCache.set(assetName, {
        status: image ? "ready" : "missing",
        image,
      });
      return image;
    } catch {
      mounted.titleSceneImageCache.set(assetName, { status: "error", image: null });
      return null;
    }
  })();
  mounted.titleSceneImageCache.set(assetName, { status: "loading", image: null, promise });
  return promise;
}

function updateTitleSceneHover(mounted, clientX, clientY) {
  const state = ensureTitleSceneState(mounted);
  const point = canvasPointFromClient(clientX, clientY);
  const control = titleSceneControlAt(point.x, point.y, state, mounted.titleButtonSprites);
  const next = titleSceneHoverKey(control);
  if (state.hoverIndex === next) {
    return false;
  }
  state.hoverIndex = next;
  return true;
}

async function applyTitleSceneClick(mounted, clientX, clientY) {
  const state = ensureTitleSceneState(mounted);
  const point = canvasPointFromClient(clientX, clientY);
  const control = titleSceneControlAt(point.x, point.y, state, mounted.titleButtonSprites);
  if (control?.kind === "scene" && titleSceneRowLocked(control.choice.scenarioName)) {
    mounted.titleLastAction = "scene_locked";
    return { ok: false, reason: "scene_locked" };
  }
  return await handleTitleSceneResult(mounted, applyTitleSceneControl(state, control));
}

async function handleTitleSceneResult(mounted, result) {
  if (!mounted || !result?.handled) {
    return { ok: false, reason: "not_handled" };
  }
  if (result.action === "back") {
    mounted.titleLastAction = "scene_back";
    paintMountedFrame(mounted);
    publishRuntimeState(true);
    return { ok: true, reason: "back", action: "back" };
  }
  if (result.action !== "select") {
    return { ok: false, reason: "unknown_action" };
  }
  mounted.titleLastAction = "scene_select";
  stopTitleBgm(mounted);
  const player = await mounted.startScenarioRoute?.(result.routeId, result.scenarioName);
  paintMountedFrame(mounted);
  publishRuntimeState(true);
  return player?.safeState
    ? {
      ok: true,
      reason: "ok",
      action: "select",
      route: player.safeState.scenarioRoute,
      scenarioName: player.safeState.scenarioName,
      scenarioIndex: player.safeState.scenarioIndex,
      replayId: result.replayId,
      thumbnailAssetName: result.thumbnailAssetName,
    }
    : { ok: false, reason: "no_player" };
}

function ensureTitleMusicState(mounted) {
  if (!mounted.titleMusicState) {
    mounted.titleMusicState = createTitleMusicState();
  }
  return mounted.titleMusicState;
}

function titleMusicIsOpen(mounted) {
  return mounted?.titleMusicState?.open === true;
}

function openTitleMusicHost(mounted) {
  if (!mounted || mounted.stage !== "title") {
    return { ok: false, reason: "not_title" };
  }
  if (dialogIsOpen(mounted)) {
    return { ok: false, reason: "dialog_open" };
  }
  closeScenarioConfigWindow(ensureTitleConfigState(mounted));
  closeScenarioUserDataWindow(ensureTitleUserDataState(mounted));
  closeTitleGraphic(ensureTitleGraphicState(mounted));
  closeTitleSceneSelect(ensureTitleSceneState(mounted));
  const state = ensureTitleMusicState(mounted);
  openTitleMusic(state);
  mounted.hoverIndex = -1;
  mounted.titleLastAction = "music_open";
  paintMountedFrame(mounted);
  publishRuntimeState(true);
  return {
    ok: true,
    reason: "ok",
    trackCount: titleMusicTracks().length,
  };
}

function updateTitleMusicHover(mounted, clientX, clientY) {
  const state = ensureTitleMusicState(mounted);
  const point = canvasPointFromClient(clientX, clientY);
  const control = titleMusicControlAt(point.x, point.y, state, mounted.titleButtonSprites);
  const next = titleMusicHoverKey(control);
  if (state.hoverIndex === next) {
    return false;
  }
  state.hoverIndex = next;
  return true;
}

async function applyTitleMusicClick(mounted, clientX, clientY) {
  const state = ensureTitleMusicState(mounted);
  const point = canvasPointFromClient(clientX, clientY);
  const control = titleMusicControlAt(point.x, point.y, state, mounted.titleButtonSprites);
  return await handleTitleMusicResult(mounted, applyTitleMusicControl(state, control));
}

async function handleTitleMusicResult(mounted, result) {
  if (!mounted || !result?.handled) {
    return { ok: false, reason: "not_handled" };
  }
  const state = ensureTitleMusicState(mounted);
  if (result.action === "back") {
    mounted.titleLastAction = "music_back";
    paintMountedFrame(mounted);
    publishRuntimeState(true);
    return { ok: true, reason: "back", action: "back" };
  }
  if (result.action !== "select") {
    return { ok: false, reason: "unknown_action" };
  }
  mounted.titleLastAction = "music_select";
  const ogg = await loadTitleMusicAudio(mounted, result.assetName);
  const play = await mounted.audioMixer?.playTrack?.(ogg, { loop: true, volume: 1 });
  state.lastPlayOk = Number(play?.ok === true);
  state.lastPlayReason = play?.reason ?? (ogg ? "unavailable" : "asset_missing");
  paintMountedFrame(mounted);
  publishRuntimeState(true);
  return {
    ok: play?.ok === true,
    reason: state.lastPlayReason,
    action: "select",
    index: result.index,
    assetName: result.assetName,
    assetReady: Number(ogg !== null),
  };
}

async function loadTitleMusicAudio(mounted, assetName) {
  if (!/^[A-Za-z0-9_]+$/.test(String(assetName ?? ""))) {
    return null;
  }
  if (!mounted.titleMusicAudioCache) {
    mounted.titleMusicAudioCache = new Map();
  }
  if (!mounted.titleMusicAudioCache.has(assetName)) {
    const payload = await mounted.catalog?.readPayloadByNameBytes?.(assetNameEncoder.encode(assetName));
    const ogg = payload ? mounted.core?.bgiAudioOgg?.(payload) ?? null : null;
    mounted.titleMusicAudioCache.set(assetName, ogg);
  }
  return mounted.titleMusicAudioCache.get(assetName) ?? null;
}

// title._bp plays a looping title BGM: bgm040 on the clean title, bgm035 once
// any route has been cleared (the ternary on the title-clear flag, vol 128).
// Autoplay policy can block the first attempt when the title is reached by boot
// auto-advance without a click; retryTitleBgm() re-attempts on the next gesture.
function titleBgmAssetName() {
  return titleExtraUnlocked() ? "bgm035" : "bgm040";
}

async function startTitleBgm(mounted) {
  if (!mounted || mounted.stage !== "title") {
    return;
  }
  const name = titleBgmAssetName();
  if (mounted.titleBgmPlaying === name) {
    return;
  }
  const ogg = await loadTitleMusicAudio(mounted, name);
  if (!ogg || !mounted || mounted.stage !== "title") {
    return;
  }
  const result = await mounted.audioMixer?.playTrack?.(ogg, { loop: true, volume: 1 });
  if (result?.ok === true) {
    mounted.titleBgmPlaying = name;
    mounted.titleBgmPendingRetry = false;
    applyTitleConfigVolumes(mounted);
  } else {
    mounted.titleBgmPendingRetry = true;
  }
  updateAudioState(mounted);
}

function stopTitleBgm(mounted) {
  if (!mounted || !mounted.titleBgmPlaying) {
    return;
  }
  mounted.audioMixer?.stopTrack?.();
  mounted.titleBgmPlaying = null;
  mounted.titleBgmPendingRetry = false;
}

function retryTitleBgm(mounted) {
  if (mounted?.stage === "title" && mounted.titleBgmPendingRetry === true) {
    void startTitleBgm(mounted);
  }
}

// Title menu sound effects. title._bp registers system.arc SSE000000 to sound
// slot 16 (cursor / hover-move) and SSE000001 to slot 17 (decide / click) via
// `service:Sound:20`; the menu button widget plays them on hover-enter and on
// click. Both are DSC-compressed `bw ` Ogg waves (decoded by core.bgiAudioOgg).
const TITLE_SFX_CURSOR = "SSE000000";
const TITLE_SFX_DECIDE = "SSE000001";
// Dedicated one-shot channel (top of the mixer's 9) so UI SFX never collide
// with scenario SE; UI SFX only play at the title in any case.
const TITLE_SFX_CHANNEL = 8;

// Reuse one persistent Audio element per UI sound. The previous mixer.playSfx
// path created a brand-new Audio element + blob URL on every hover; rapid mouse
// movement across the menu churned hundreds of elements, which stutters the main
// thread and can interrupt the BGM. Decoding the Ogg once and replaying the same
// element (currentTime = 0) avoids that churn entirely.
async function loadTitleSfxElement(mounted, name) {
  if (!mounted.titleSfxElements) {
    mounted.titleSfxElements = new Map();
  }
  if (!mounted.titleSfxElements.has(name)) {
    let element = null;
    const payload = await mounted.catalog?.readPayloadByNameBytes?.(assetNameEncoder.encode(name));
    const ogg = payload ? mounted.core?.bgiAudioOgg?.(payload) ?? null : null;
    if (ogg) {
      element = new Audio();
      element.preload = "auto";
      element.src = URL.createObjectURL(new Blob([ogg], { type: "audio/ogg" }));
    }
    mounted.titleSfxElements.set(name, element);
  }
  return mounted.titleSfxElements.get(name) ?? null;
}

// UI SFX volume follows the Config master/SE levels, like the in-engine SE bus.
function titleSfxVolume(mounted) {
  const settings = mounted?.titleConfigState?.settings ?? readStoredScenarioConfigSettings();
  const master = settings ? settings.masterVolume : 1;
  const sfx = settings ? settings.sfxVolume : 1;
  return Math.max(0, Math.min((Number(master) || 0) * (Number(sfx) || 0), 1));
}

function playTitleSfx(mounted, name) {
  if (!mounted) {
    return;
  }
  void loadTitleSfxElement(mounted, name).then((element) => {
    if (!element) {
      return;
    }
    try {
      element.volume = titleSfxVolume(mounted);
      element.currentTime = 0;
      const played = element.play();
      if (played && typeof played.catch === "function") {
        played.catch(() => {});
      }
    } catch {
      // ignore transient play/seek races
    }
  });
}

const TITLE_NOAUTO = typeof location !== "undefined" && (location.search || "").includes("noauto");
let stageFadeAlpha = 1;
let stageAnimRunning = false;
let stageAnimTimer = 0;
let stageAnimGeneration = 0;


const BOOT_FADE_MS = 450;
const BOOT_HOLD_MS = [2600, 6000, 6000];  // logo, warning1, warning2 auto-advance holds

function stageEnter(mounted) {
  mounted.stageEnteredAt = performance.now();
  stageAnimGeneration += 1;
  clearStageAnimTimer();
  stageAnimRunning = false;
  startStageAnim(mounted);
  if (mounted.stage === "title") {
    applyTitleConfigVolumes(mounted);
    void startTitleBgm(mounted);
  } else {
    stopTitleBgm(mounted);
  }
}

function clearStageAnimTimer() {
  if (stageAnimTimer !== 0) {
    window.clearTimeout(stageAnimTimer);
    stageAnimTimer = 0;
  }
}

function scheduleStageAnimStep(step, delayMs = 0) {
  clearStageAnimTimer();
  if (delayMs > 17) {
    stageAnimTimer = window.setTimeout(() => {
      stageAnimTimer = 0;
      requestAnimationFrame(step);
    }, delayMs);
    return;
  }
  requestAnimationFrame(step);
}

function startStageAnim(mounted) {
  if (stageAnimRunning) return;
  stageAnimRunning = true;
  const generation = stageAnimGeneration;
  const step = () => {
    if (generation !== stageAnimGeneration) {
      return;
    }
    const m = activeInstall;
    if (!m || (m.stage !== "boot" && m.stage !== "title")) { stageAnimRunning = false; return; }
    const stage = m.stage;
    const t = performance.now() - (m.stageEnteredAt ?? 0);
    stageFadeAlpha = Math.min(1, t / BOOT_FADE_MS);
    if (stage === "boot" && !TITLE_NOAUTO) {
      const phases = bootPhaseList(m);
      const cur = phases[Math.min(m.bootPhase, phases.length - 1)];
      if (t >= cur.dur) {
        advanceBootPhase(m);
        return;
      }
      paintMountedFrame(m);
      if (cur.hold) {
        scheduleStageAnimStep(step, Math.max(0, cur.dur - t));
        return;
      }
      scheduleStageAnimStep(step);
      return;
    }
    if (stage === "boot" && TITLE_NOAUTO) {
      const phases = bootPhaseList(m);
      const cur = phases[Math.min(m.bootPhase, phases.length - 1)];
      paintMountedFrame(m);
      if (cur.hold || t >= cur.dur) {
        stageAnimRunning = false;
        return;
      }
      scheduleStageAnimStep(step);
      return;
    }
    paintMountedFrame(m);
    if (stage === "title" && t >= BOOT_FADE_MS) {
      stageAnimRunning = false;
      return;
    }
    scheduleStageAnimStep(step);
  };
  scheduleStageAnimStep(step);
}

function imageScratch(image) {
  if (image.__scratch) return image.__scratch;
  const c = document.createElement("canvas");
  c.width = image.width;
  c.height = image.height;
  c.getContext("2d", { alpha: true }).putImageData(
    new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height), 0, 0);
  image.__scratch = c;
  return c;
}

function imageLogicalWidth(image) {
  return Number.isFinite(image?.logicalWidth) && image.logicalWidth > 0
    ? image.logicalWidth
    : image?.width ?? 0;
}

function imageLogicalHeight(image) {
  return Number.isFinite(image?.logicalHeight) && image.logicalHeight > 0
    ? image.logicalHeight
    : image?.height ?? 0;
}

function paintTitleScreen(mounted, stageCanvas = scenarioLogicalCanvas) {
  const image = mounted.titleImage;
  context.fillStyle = "#000";
  context.fillRect(0, 0, stageCanvas.width, stageCanvas.height);
  context.save();
  context.globalAlpha = stageFadeAlpha;
  const { x, y, w, h } = titleLayout(image, stageCanvas);
  context.drawImage(imageScratch(image), x, y, w, h);
  const scale = w / imageLogicalWidth(image);
  if (!titleGraphicIsOpen(mounted) && !titleSceneIsOpen(mounted) && !titleMusicIsOpen(mounted)) {
    const controls = currentTitleMenuControls(mounted);
    for (let i = 0; i < controls.length; i += 1) {
      const control = controls[i];
      const button = mounted.titleButtonSprites?.[control.sprite] ?? null;
      if (button?.image) {
        const state = !control.enabled ? 3 : (mounted.hoverIndex === i ? 1 : 0);
        const sourceStateWidth = button.sourceStateWidth ?? button.stateWidth;
        const sourceStateHeight = button.sourceStateHeight ?? button.image.height;
        context.drawImage(
          imageScratch(button.image),
          state * sourceStateWidth,
          0,
          sourceStateWidth,
          sourceStateHeight,
          Math.round(x + control.x * scale),
          Math.round(y + control.y * scale),
          button.stateWidth * scale,
          button.stateHeight * scale,
        );
      } else {
        paintFallbackTitleButton(context, control, mounted.hoverIndex === i, x, y, scale);
      }
    }
  }
  context.restore();
  paintScenarioUserDataWindow(
    context,
    stageCanvas,
    mounted.userDataWindow,
    mounted.titleUserDataState,
    titleUserDataIsOpen(mounted) ? titleUserDataSlotRecords(mounted) : [],
  );
  paintScenarioConfigWindow(context, stageCanvas, mounted.configWindow, mounted.titleConfigState);
  paintTitleGraphic(
    context,
    stageCanvas,
    mounted.titleGraphicState,
    mountedTitleGraphicAssets(mounted),
    mounted.titleButtonSprites,
    mounted.titleGraphicImageCache,
    mounted.titleGraphicChromeCache,
  );
  paintTitleSceneSelect(
    context,
    stageCanvas,
    mounted.titleSceneState,
    mounted.titleButtonSprites,
    mounted.titleSceneImageCache,
    mounted.titleSceneLockedSet,
  );
  paintTitleMusic(context, stageCanvas, mounted.titleMusicState, mounted.titleButtonSprites, mounted.titleMusicSprites);
  paintScenarioDialogWindow(context, stageCanvas, mounted.dialogWindow, mounted.dialogState);
  stageNonBlackSampleCount = 1;
}

function titleMenuHit(mounted, clientX, clientY) {
  const image = mounted.titleImage;
  if (!image) return -1;
  const rect = canvas.getBoundingClientRect();
  const px = (clientX - rect.left) * (canvasLogicalWidth() / rect.width);
  const py = (clientY - rect.top) * (canvasLogicalHeight() / rect.height);
  const { x, y, w } = titleLayout(image, scenarioLogicalCanvas);
  const scale = w / imageLogicalWidth(image);
  const controls = currentTitleMenuControls(mounted);
  for (let i = controls.length - 1; i >= 0; i -= 1) {
    const control = controls[i];
    const button = mounted.titleButtonSprites?.[control.sprite] ?? null;
    const width = (button?.stateWidth ?? 114) * scale;
    const height = (button?.stateHeight ?? 64) * scale;
    const left = x + control.x * scale;
    const top = y + control.y * scale;
    if (px >= left && px < left + width && py >= top && py < top + height) {
      return i;
    }
  }
  return -1;
}

function currentTitleMenuControls(mounted) {
  return titleMenuControls(
    normalizeTitleMenuMode(mounted?.titleMenuMode),
    titleExtraForced || titleExtraUnlocked(),
  );
}

function paintFallbackTitleButton(ctx, control, hovered, x, y, scale) {
  ctx.save();
  ctx.font = bgiMinchoFont(36, "bold");
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = control.enabled ? (hovered ? "#dcefff" : "#ffffff") : "rgba(255,255,255,0.42)";
  ctx.fillText(control.label, x + control.x * scale, y + control.y * scale);
  ctx.restore();
}

function paintBootScreen(mounted, stageCanvas = scenarioLogicalCanvas) {
  const phases = bootPhaseList(mounted);
  const i = Math.min(mounted.bootPhase, phases.length - 1);
  const cur = phases[i];
  const prev = i > 0 ? phases[i - 1] : { color: "#000" };
  const t = performance.now() - (mounted.stageEnteredAt ?? 0);
  const progress = cur.hold ? 1 : Math.min(1, t / cur.dur);
  context.fillStyle = "#000";
  context.fillRect(0, 0, stageCanvas.width, stageCanvas.height);
  drawPhaseLayer(prev, 1, stageCanvas);
  drawPhaseLayer(cur, progress, stageCanvas);
  stageNonBlackSampleCount = 1;
}

// Faithful boot sequence from makerlogo: white->logo->white->att01->att02->black, crossfades+holds (ms).
function bootPhaseList(mounted) {
  if (mounted.__bootPhases) return mounted.__bootPhases;
  const get = (n) => (mounted.bootScreens ?? []).find((sc) => sc.name === n)?.image ?? null;
  const logo = get("makuralogo"), a1 = get("att01"), a2 = get("att02");
  const list = [
    { color: "#fff", dur: 3000 },
    { image: logo, dur: 3000 },
    { image: logo, dur: 5000, hold: true },
    { color: "#fff", dur: 3000 },
    { image: a1, dur: 2500 },
    { image: a1, dur: 5000, hold: true },
    { image: a2, dur: 2500 },
    { image: a2, dur: 5000, hold: true },
    { color: "#000", dur: 1500 },
  ].filter((ph) => ph.color || ph.image);
  mounted.__bootPhases = list;
  return list;
}

function drawPhaseLayer(phase, alpha, stageCanvas = scenarioLogicalCanvas) {
  if (!phase) return;
  context.save();
  context.globalAlpha = Math.max(0, Math.min(1, alpha));
  if (phase.color) {
    context.fillStyle = phase.color;
    context.fillRect(0, 0, stageCanvas.width, stageCanvas.height);
  } else if (phase.image) {
    const { x, y, w, h } = titleLayout(phase.image, stageCanvas);
    context.drawImage(imageScratch(phase.image), x, y, w, h);
  }
  context.restore();
}

function bootPhaseIsHold(mounted) {
  const phases = bootPhaseList(mounted);
  return !!phases[Math.min(mounted.bootPhase ?? 0, phases.length - 1)]?.hold;
}

function advanceBootPhase(mounted) {
  const phases = bootPhaseList(mounted);
  mounted.bootPhase = (mounted.bootPhase ?? 0) + 1;
  if (mounted.bootPhase >= phases.length) {
    mounted.stage = mounted.titleImage ? "title" : "scenario";
    if (mounted.stage === "scenario") mounted.startScenario?.();
  }
  stageEnter(mounted);
}

function paintMountedFrame(mounted) {
  if (!mounted) {
    return;
  }
  const backingScale = configureStageCanvasForMounted(mounted);
  if (mounted.stage === "exited") {
    context.fillStyle = "#000";
    context.fillRect(0, 0, canvas.width, canvas.height);
    stageNonBlackSampleCount = 0;
    return;
  }
  if (mounted.stage === "boot" && mounted.bootScreens?.length) {
    context.save();
    context.scale(backingScale, backingScale);
    paintBootScreen(mounted, scenarioLogicalCanvas);
    context.restore();
    return;
  }
  if (mounted.stage === "title" && mounted.titleImage) {
    context.save();
    context.scale(backingScale, backingScale);
    paintTitleScreen(mounted, scenarioLogicalCanvas);
    context.restore();
    return;
  }
  if (mounted.stage === "scenario" && mounted.player) {
    if (!mounted.player.onOverlayRepaint) {
      mounted.player.onOverlayRepaint = () => {
        if (isCurrentInstall(mounted)) {
          paintMountedFrame(mounted);
          publishRuntimeState();
        }
      };
    }
    const offset = scenarioScreenOffset(mounted.player);
    context.fillStyle = "#000";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.scale(backingScale, backingScale);
    context.translate(offset.x, offset.y);
    const painted = paintScenarioScene(context, scenarioLogicalCanvas, mounted.player, { clear: false });
    paintScenarioOverlay(
      context,
      scenarioLogicalCanvas,
      mounted.player,
      mounted.messageWindow,
    );
    context.restore();
    context.save();
    context.scale(backingScale, backingScale);
    paintScenarioDialogWindow(
      context,
      scenarioLogicalCanvas,
      mounted.dialogWindow,
      mounted.dialogState,
    );
    context.restore();
    if (!painted) {
      return;
    }
    stageNonBlackSampleCount = 1;
    return;
  }
  if (mounted.stage === "scenario") {
    context.fillStyle = "#000";
    context.fillRect(0, 0, canvas.width, canvas.height);
    stageNonBlackSampleCount = 0;
    return;
  }
  const image = mounted.bootImage;
  if (image === null) {
    context.save();
    context.scale(backingScale, backingScale);
    paintBootFrame(core, scenarioLogicalCanvas);
    renderMountedGraphQueue(mounted, scenarioLogicalCanvas);
    paintScenarioOverlay(
      context,
      scenarioLogicalCanvas,
      mounted.player,
      mounted.messageWindow,
    );
    context.restore();
    stageNonBlackSampleCount = 1;
    return;
  }

  const frameCanvas = cachedMountedFrameCanvas(mounted, image);

  context.fillStyle = "#000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.scale(backingScale, backingScale);
  const logicalWidth = imageLogicalWidth(image);
  const logicalHeight = imageLogicalHeight(image);
  const scale = Math.min(scenarioLogicalCanvas.width / logicalWidth, scenarioLogicalCanvas.height / logicalHeight);
  const width = Math.round(logicalWidth * scale);
  const height = Math.round(logicalHeight * scale);
  const x = Math.floor((scenarioLogicalCanvas.width - width) / 2);
  const y = Math.floor((scenarioLogicalCanvas.height - height) / 2);
  context.drawImage(frameCanvas, x, y, width, height);
  renderMountedGraphQueue(mounted, scenarioLogicalCanvas);
  paintScenarioOverlay(
    context,
    scenarioLogicalCanvas,
    mounted.player,
    mounted.messageWindow,
  );
  context.restore();
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
    imageCache: mounted.sharedImageAssetCache,
    imageCacheLimit: 192,
    upscaleSettings: mountedUpscaleSettings(mounted),
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

function renderMountedGraphQueue(mounted, stageCanvas = canvas) {
  const graphRender = renderGraphQueue(
    context,
    stageCanvas,
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
    debug: {
      sourceLayers: (graphRender.layers ?? [])
        .filter((layer) => layer.type === "source-layer")
        .slice(0, 8)
        .map((layer) => ({
          x: layer.x,
          y: layer.y,
          width: layer.width,
          height: layer.height,
          sourceMemory: layer.sourceMemory ?? null,
          runtimeMemory: layer.runtimeMemory ?? null,
        })),
      titleImageContexts: graphRender.titleImageContexts ?? [],
      runtimeSlot0Entries: (graphRender.runtimeSlot0?.entries ?? [])
        .slice(0, 30)
        .map((entry) => ({ name: entry.name, offset: entry.offset, size: entry.size })),
    },
  };
}

function paintBootFrame(core, stageCanvas = scenarioLogicalCanvas) {
  void core;
  context.fillStyle = "#111318";
  context.fillRect(0, 0, stageCanvas.width, stageCanvas.height);
  if (!runtimeDiagnosticsEnabled) {
    return;
  }
  context.save();
  context.globalAlpha = 0.38;
  context.fillStyle = "#4874b4";
  context.fillRect(36, 42, 240, 120);
  context.restore();
  context.fillStyle = "#e9edf1";
  context.font = bgiGothicFont(24);
  context.fillText("BGI runtime core loaded", 40, 64);
}
