import {
  beginScenarioSpriteTransition,
  clearScenarioSprites,
  createScenarioSpriteState,
  finishScenarioSpriteTransitions,
  hasActiveScenarioSpriteMotions,
  paintScenarioSprites,
  removeScenarioSpriteLayer,
  restoreScenarioSpriteTransition,
  setScenarioSpriteProgress,
  snapshotScenarioSprites,
  snapshotScenarioSpriteTransitions,
  updateScenarioSpriteLayer,
} from "./scenario-sprites.js";
import {
  beginScenarioSpriteControlMotion,
  restoreScenarioMotion,
  restoreScenarioSpriteControlMotion,
  snapshotScenarioSpriteControlMotions,
  snapshotScenarioSpriteMotions,
  startScenarioSpriteVerticalShake,
  stopScenarioSpriteControlMotion,
  stopScenarioSpriteMotion,
} from "./scenario-sprite-motion.js";
import {
  beginScenarioBackgroundObjectRemoval,
  clearScenarioSceneObjects,
  fadeScenarioSceneObject,
  hasActiveScenarioSceneObjectVisuals,
  moveScenarioSceneObject,
  restoreScenarioSceneObjectMotion,
  restoreScenarioSceneObjectTransition,
  setScenarioSceneObject,
  startScenarioSceneObjectDirectionalMotion,
  stopScenarioSceneObjectMotion,
  snapshotScenarioSceneObjects,
} from "./scenario-scene-objects.js";
import {
  applyScenarioFilter,
  beginScenarioColorFilter,
  beginScenarioPresetFilter,
  clearScenarioColorFilter,
  createScenarioFilterState,
  finishScenarioFilterTransition,
  isValidScenarioFilterSnapshot,
  restoreScenarioFilter,
  setScenarioFilterProgress,
  snapshotScenarioFilter,
} from "./scenario-filter.js";
import {
  beginPendingScenarioAperture,
  beginScenarioAperture,
  clearScenarioAperture,
  configureScenarioAperture,
  configureScenarioApertureBand,
  createScenarioApertureState,
  finishScenarioApertureTransition,
  isValidScenarioApertureSnapshot,
  paintScenarioAperture,
  restoreScenarioAperture,
  setScenarioApertureProgress,
  snapshotScenarioAperture,
} from "./scenario-aperture.js";
import {
  createScenarioRainState,
  hasActiveScenarioRain,
  isValidScenarioRainSnapshot,
  paintScenarioRain,
  restoreScenarioRain,
  setScenarioRainActive,
  setScenarioRainColor,
  setScenarioRainDensity,
  setScenarioRainFade,
  setScenarioRainMotion,
  snapshotScenarioRain,
} from "./scenario-rain.js";
import {
  createPresetScenarioShake,
  scenarioShakeOffset,
} from "./scenario-shake.js";
import { paintMappedTransition } from "./scenario-transition-mask.js";
import {
  advanceScenarioMovies,
  clearScenarioMovieObject,
  clearScenarioMovies,
  createScenarioMovieState,
  hasActiveScenarioMovies,
  scenarioMovieElapsedMs,
  setScenarioMovieObject,
} from "./scenario-movies.js";
import { readFirstArc20EntryPayloadByExtension } from "./local-catalog.js";
import {
  normalizeScenarioRoute,
  scenarioPlaybackPlan,
  scenarioSequenceForRoute,
} from "./scenario-routes.js";
import {
  applyScenarioBacklogControl,
  closeScenarioBacklog,
  createScenarioBacklogState,
  openScenarioBacklog,
  paintScenarioBacklog,
  scenarioBacklogControlAt,
  scrollScenarioBacklog,
  setScenarioBacklogPosition,
} from "./scenario-backlog.js";
import {
  beginScenarioMessageHide,
  beginScenarioMessageShow,
  completeScenarioMessageReveal,
  createScenarioMessageVisualState,
  DEFAULT_REVEAL_MS_PER_CHAR,
  finishScenarioMessageTransition,
  isScenarioMessageRevealing,
  resolvedScenarioMessageReveal,
  resolvedScenarioMessageVisual,
  showScenarioMessageVisual,
} from "./scenario-message-window.js";
import {
  applyScenarioUserDataControl,
  closeScenarioUserDataWindow,
  createScenarioUserDataState,
  openScenarioUserDataWindow,
  paintScenarioUserDataWindow,
  scenarioUserDataControlAt,
  userDataHoverKey,
  USER_DATA_SLOTS_PER_PAGE,
} from "./scenario-userdata-window.js";
import {
  applyScenarioConfigControl,
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
  countScenarioTextChars,
  drawScenarioRichText,
  stripScenarioTags,
} from "./scenario-text.js";

const PAYLOAD_KIND_DSC = 1;
const SCENARIO_KIND = 1;
const EVENT_MESSAGE = 1;
const EVENT_CHOICE = 2;
const EVENT_USER_FUNCTION = 3;
const EVENT_HALTED = 4;
const EVENT_GRAPH = 5;
const EVENT_WAIT = 6;
const EVENT_SOUND = 7;
const EVENT_MESSAGE_CONTROL = 8;
const MESSAGE_WINDOW_SHOW = 0x0150;
const MESSAGE_WINDOW_SHOW_TIMED = 0x0152;
const MESSAGE_CONTROL_AUTO = 0;
const MESSAGE_CONTROL_SKIP = 1;
const MESSAGE_CONTROL_LOG = 2;
const MESSAGE_CONTROL_SAVE = 3;
const MESSAGE_CONTROL_LOAD = 4;
const MESSAGE_CONTROL_QUICK_SAVE = 5;
const MESSAGE_CONTROL_QUICK_LOAD = 6;
const MESSAGE_CONTROL_SYSTEM = 7;
const MESSAGE_CONTROL_VOICE = 8;
const MESSAGE_CONTROL_HIDE = 9;
const MESSAGE_CONTROL_NAMES = Object.freeze([
  "auto",
  "skip",
  "log",
  "save",
  "load",
  "quick-save",
  "quick-load",
  "system",
  "voice",
  "hide",
]);
const EMPTY_MESSAGE_WINDOW_EVENT = Object.freeze({
  kind: EVENT_MESSAGE,
  name: "",
  text: "",
});
const SOUND_BGM_PLAY = 0x0180;
const SOUND_BGM_STOP = 0x0184;
const SOUND_BGM_FADE_OUT = 0x0185;
const SOUND_BGM_CHANGE_VOLUME = 0x0186;
const SOUND_LOOPING_SE_PLAY = 0x0190;
const SOUND_LOOPING_SE_STOP = 0x0194;
const SOUND_LOOPING_SE_FADE_OUT = 0x0195;
const SOUND_LOOPING_SE_CHANGE_VOLUME = 0x0196;
const SOUND_SE_PLAY = 0x01a1;
const SOUND_SE_STOP = 0x01a2;
const SOUND_SE_FADE_OUT = 0x01a3;
const SOUND_SE_WAIT = 0x01a4;
const SOUND_VOICE_PLAY_EX = 0x01a8;
const SOUND_VOICE_PLAY = 0x01a9;
const SOUND_VOICE_STOP = 0x01aa;
const SOUND_VOICE_WAIT = 0x01ac;
const GRAPH_SHAKE_START = 0x0232;
const GRAPH_SHAKE_UPDATE = 0x0233;
const GRAPH_SPRITE_SHAKE_START = 0x0236;
const GRAPH_SPRITE_SHAKE_STOP = 0x0237;
const GRAPH_SCENE_OBJECT_MOTION_START = 0x0238;
const GRAPH_SCENE_OBJECT_MOTION_STOP = 0x0239;
const GRAPH_SET_BACKGROUND_BASE = 0x0240;
const GRAPH_SHOW = 0x0280;
const GRAPH_SHOW_WITH_MAP = 0x0281;
const GRAPH_FADE_TO_BLACK = 0x0288;
const GRAPH_FADE_TO_BLACK_WITH_MAP = 0x0289;
const GRAPH_BANK_SPRITE = 0x02c0;
const GRAPH_UPDATE_SPRITE = 0x02c2;
const GRAPH_UPDATE_SPRITE_EX = 0x02c3;
const GRAPH_SHOW_SPRITE = 0x02c4;
const GRAPH_REPLACE_SPRITE = 0x02c6;
const GRAPH_REMOVE_SPRITE = 0x02c8;
const GRAPH_BANK_SPRITE_WITH_MAP = 0x02ce;
const GRAPH_TERMINATE_BANKED_SPRITE = 0x02dc;
const GRAPH_DRAW_SCENE_OBJECT = 0x0300;
const GRAPH_DRAW_MOVIE_OBJECT = 0x0301;
const GRAPH_ANIMATE_SCENE_OBJECT = 0x0302;
const GRAPH_FADE_SCENE_OBJECT = 0x0306;
const GRAPH_MOVE_SCENE_OBJECT = 0x0308;
const GRAPH_CONTROL_SPRITE = 0x030e;
const GRAPH_APERTURE_START = 0x0340;
const GRAPH_APERTURE_CLEAR = 0x0348;
const GRAPH_APERTURE_CONFIGURE = 0x0350;
const GRAPH_APERTURE_BAND = 0x0351;
const GRAPH_START_COLOR_FILTER = 0x0380;
const GRAPH_CLEAR_COLOR_FILTER = 0x0388;
const GRAPH_PRESET_FILTER_FIRST = 0x0390;
const GRAPH_PRESET_FILTER_LAST = 0x0394;
const GRAPH_PRESET_FILTER_MODES = Object.freeze([0, 0, 1, 2, 3]);
const GRAPH_RAIN_TOGGLE = 0x03d0;
const GRAPH_RAIN_COLOR = 0x03d2;
const GRAPH_RAIN_MOTION = 0x03d5;
const GRAPH_RAIN_FADE = 0x03d6;
const GRAPH_RAIN_DENSITY = 0x03d8;
const GRAPH_PRESET_SHAKE = 0x03f1;
const SAVE_SLOT_KEY = "sakura.session.slot.0";
const SAVE_SLOT_KEY_PREFIX = "sakura.session.slot.";
const SAVE_RECORD_VERSION = 14;
const SUPPORTED_SAVE_RECORD_VERSIONS = new Set([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, SAVE_RECORD_VERSION]);
const SCENARIO_BACKLOG_LIMIT = 512;
const INITIAL_SCENARIO_MAX_BYTES = 256 * 1024;
const SCENARIO_IMAGE_CACHE_LIMIT = 32;
const SCENARIO_AUDIO_CACHE_LIMIT = 96;
const decoder = new TextDecoder("shift_jis");
const encoder = new TextEncoder();
const imageCanvasCache = new WeakMap();
let blackTransitionCanvas = null;

function asciiName(nameBytes) {
  if (!nameBytes) return "";
  let s = "";
  for (const b of nameBytes) { if (b === 0) break; s += String.fromCharCode(b); }
  return s;
}

// Try a specific scenario record by exact entry name (e.g. the opening 00_op_01).
async function tryScenarioByName(catalog, core, wantName, route) {
  const normalizedName = wantName.toLowerCase();
  const handle = await createScenarioHandle(catalog, core, normalizedName);
  if (handle === 0) return null;
  const plan = scenarioPlaybackPlan(normalizedName, route);
  const player = createPlayer(
    catalog,
    core,
    handle,
    plan.sequence,
    plan.scenarioIndex,
    plan.routeId,
  );
  player.loadConfigSettings();
  if (!player.step()) { core.scenarioSessionDestroy(handle); return null; }
  player.safeState.scenarioName = normalizedName;
  player.safeState.scenarioRoute = plan.routeId;
  return player;
}

export async function createInitialScenarioPlayer(
  catalog,
  core,
  preferredName = "00_op_01",
  route = "pi",
) {
  // Faithful playback starts at the opening narration (00_op_01).
  const opening = await tryScenarioByName(catalog, core, preferredName, route);
  if (opening) {
    createInitialScenarioPlayer.lastProbe = { scanned: 1, skippedLarge: 0, ready: true };
    return opening;
  }
  let scanned = 0;
  let skippedLarge = 0;
  createInitialScenarioPlayer.lastProbe = { scanned, skippedLarge, ready: false };
  for (const record of catalog.recordsByKind(PAYLOAD_KIND_DSC)) {
    if (record.size > INITIAL_SCENARIO_MAX_BYTES) {
      skippedLarge += 1;
      continue;
    }
    if (record.kind !== PAYLOAD_KIND_DSC) {
      if (record.kind !== null) {
        continue;
      }
      const prefix = await catalog.readPrefix(record, 16);
      if (core.payloadKind(prefix) !== PAYLOAD_KIND_DSC) {
        continue;
      }
    }
    scanned += 1;
    const payload = await catalog.readPayload(record);
    const summary = core.dscScriptSummary(payload);
    if (summary?.kind !== SCENARIO_KIND) {
      continue;
    }
    const handle = core.scenarioSessionCreate(payload);
    if (handle === 0) {
      continue;
    }
    const name = asciiName(record.name).toLowerCase();
    const fallbackRoute = normalizeScenarioRoute(route);
    const player = createPlayer(catalog, core, handle, [name], 0, fallbackRoute);
    player.loadConfigSettings();
    if (!player.step()) {
      core.scenarioSessionDestroy(handle);
      continue;
    }
    player.safeState.scenarioName = name;
    player.safeState.scenarioRoute = fallbackRoute;
    player.safeState.scanCount = scanned;
    player.safeState.scanSkippedLarge = skippedLarge;
    createInitialScenarioPlayer.lastProbe = { scanned, skippedLarge, ready: true };
    return player;
  }
  createInitialScenarioPlayer.lastProbe = { scanned, skippedLarge, ready: false };
  return null;
}

createInitialScenarioPlayer.lastProbe = { scanned: 0, skippedLarge: 0, ready: false };

export function readScenarioSaveSlotSummary(slotIndex, storage = scenarioStorage()) {
  const encoded = storage?.getItem(saveSlotKey(slotIndex)) ?? (
    normalizeSaveSlot(slotIndex) === 0 ? storage?.getItem(SAVE_SLOT_KEY) : null
  );
  if (!encoded) {
    return { slot: normalizeSaveSlot(slotIndex), exists: false };
  }
  try {
    const value = JSON.parse(encoded);
    return {
      slot: normalizeSaveSlot(slotIndex),
      exists: true,
      scenarioName: typeof value.scenarioName === "string" ? value.scenarioName : "",
      eventCount: Number.isInteger(value.event?.eventCount) ? value.event.eventCount : 0,
      savedAt: typeof value.savedAt === "string" ? value.savedAt : "",
      text: typeof value.event?.text === "string" ? value.event.text : "",
    };
  } catch {
    return { slot: normalizeSaveSlot(slotIndex), exists: false };
  }
}

export function bindScenarioPlayerInput(canvas, getMounted, onUpdate) {
  const target = canvas.closest(".stage") ?? canvas;
  const keyboard = canvas.ownerDocument.defaultView;
  let lastInputTime = -1;
  const advance = (event) => {
    if (event.timeStamp === lastInputTime) {
      return;
    }
    lastInputTime = event.timeStamp;
    const player = getMounted()?.player;
    if (!player) {
      return;
    }
    const point = canvasPointFromEvent(canvas, event);
    const pointerButton = Number.isInteger(event.button) ? event.button : 0;
    if (player.configState.open) {
      if (pointerButton === 2) {
        player.closeConfigWindow();
      } else {
        const control = point
          ? scenarioConfigControlAt(point.x, point.y, player.configState, player.configSkin)
          : null;
        player.applyConfigControl(control);
      }
      player.safeState.inputResult = 4;
      onUpdate();
      return;
    }
    if (player.userDataState.open) {
      if (pointerButton === 2) {
        player.closeUserDataWindow();
      } else {
        const control = point
          ? scenarioUserDataControlAt(point.x, point.y, player.userDataState, player.userDataSkin)
          : null;
        player.applyUserDataControl(control, onUpdate);
      }
      player.safeState.inputResult = 4;
      onUpdate();
      return;
    }
    if (player.backlogState.open) {
      if (pointerButton === 2) {
        player.closeBacklog();
      } else {
        const control = point
          ? scenarioBacklogControlAt(point.x, point.y, player.backlogState, player.backlog)
          : null;
        if (control?.kind === "voice") {
          void player.replayBacklogVoice(control.entryIndex).then(onUpdate);
        } else if (!applyScenarioBacklogControl(
          player.backlogState,
          player.backlog.length,
          control,
        )) {
          player.closeBacklog();
        } else {
          player.syncBacklogState();
        }
      }
      player.safeState.inputResult = 4;
      onUpdate();
      return;
    }
    if (pointerButton === 2) {
      return;
    }
    if (player.messageWindowHidden && isStableSaveEvent(player.event)) {
      player.setMessageWindowHidden(false);
      player.safeState.inputResult = 4;
      onUpdate();
      return;
    }
    if (
      point
      && isStableSaveEvent(player.event)
      && handleMessageControlClick(
        player,
        messageControlIndexAt(canvas, player.skin, point.x, point.y),
        onUpdate,
      )
    ) {
      player.safeState.inputResult = 4;
      onUpdate();
      return;
    }
    // A manual click cancels Auto/Skip (standard VN behavior) and acts normally.
    if (player.autoMode || player.skipMode) {
      player.cancelAutoSkip();
      player.safeState.inputResult = 4;
      onUpdate();
      return;
    }
    let inputResult = -1;
    if (
      player.event.kind === EVENT_MESSAGE
      && isScenarioMessageRevealing(player.messageVisual)
    ) {
      // First click while typing only completes the reveal; it does not advance.
      completeScenarioMessageReveal(player.messageVisual);
      inputResult = 5;
    } else if (isAutomaticEvent(player.event)) {
      inputResult = player.skipAutomatic() ? 3 : 0;
    } else if (
      player.event.kind === EVENT_MESSAGE
      && player.advanceMessage() === 1
      && player.step()
    ) {
      inputResult = 1;
    } else if (
      player.event.kind === EVENT_CHOICE &&
      player.event.options.length > 0 &&
      player.selectChoice(choiceIndexFromEvent(event, canvas, player.event.options.length)) === 1 &&
      player.step()
    ) {
      inputResult = 2;
    }
    player.safeState.inputResult = inputResult;
    onUpdate();
    player.startAutomatic(onUpdate);
  };
  canvas.addEventListener("pointerup", advance);
  if (target !== canvas) {
    target.addEventListener("pointerup", advance);
  }
  canvas.addEventListener("pointermove", (event) => {
    const player = getMounted()?.player;
    if (!player) return;
    const point = canvasPointFromEvent(canvas, event);
    if (player.configState.open) {
      const control = point
        ? scenarioConfigControlAt(point.x, point.y, player.configState, player.configSkin)
        : null;
      const next = scenarioConfigHoverKey(control);
      if (next !== player.configState.hover) {
        player.configState.hover = next;
        onUpdate();
      }
      return;
    }
    if (player.userDataState.open) {
      const control = point
        ? scenarioUserDataControlAt(point.x, point.y, player.userDataState, player.userDataSkin)
        : null;
      const next = userDataHoverKey(control);
      if (next !== player.userDataState.hover) {
        player.userDataState.hover = next;
        onUpdate();
      }
      return;
    }
    if (player.backlogState.open) {
      const control = point
        ? scenarioBacklogControlAt(point.x, point.y, player.backlogState, player.backlog)
        : null;
      const next = backlogHoverKey(control);
      if (next !== player.backlogState.hoverControl) {
        player.backlogState.hoverControl = next;
        onUpdate();
      }
      return;
    }
    const next = point && isStableSaveEvent(player.event) && !player.messageWindowHidden
      ? messageControlIndexAt(canvas, player.skin, point.x, point.y)
      : -1;
    if (next !== player.messageControlHover) {
      player.messageControlHover = next;
      onUpdate();
    }
  });
  canvas.addEventListener("pointerleave", () => {
    const player = getMounted()?.player;
    if (!player) return;
    if (
      player.configState.hover !== null
      || player.userDataState.hover !== null
      || player.backlogState.hoverControl !== null
      || player.messageControlHover !== -1
    ) {
      player.configState.hover = null;
      player.userDataState.hover = null;
      player.backlogState.hoverControl = null;
      player.messageControlHover = -1;
      onUpdate();
    }
  });
  canvas.addEventListener("wheel", (event) => {
    const player = getMounted()?.player;
    if (!player || !isStableSaveEvent(player.event) || player.configState.open) return;
    if (!player.backlogState.open && event.deltaY < 0 && player.backlog.length > 0) {
      player.openBacklog();
    } else if (player.backlogState.open) {
      player.scrollBacklog(event.deltaY > 0 ? 1 : -1);
    } else {
      return;
    }
    event.preventDefault();
    player.safeState.inputResult = 4;
    onUpdate();
  }, { passive: false });
  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });
  keyboard.addEventListener("keyup", (event) => {
    const player = getMounted()?.player;
    if (player?.configState.open) {
      if (event.key === "Escape" || event.key === "Backspace") {
        player.closeConfigWindow();
        player.safeState.inputResult = 4;
        onUpdate();
      }
      return;
    }
    if (player?.userDataState.open) {
      if (event.key === "Escape" || event.key === "Backspace") {
        player.closeUserDataWindow();
        player.safeState.inputResult = 4;
        onUpdate();
      }
      return;
    }
    if (player?.backlogState.open) {
      if (event.key === "ArrowUp") player.scrollBacklog(-1);
      else if (event.key === "ArrowDown") player.scrollBacklog(1);
      else if (event.key === "PageUp") player.scrollBacklog(-4);
      else if (event.key === "PageDown") player.scrollBacklog(4);
      else if (event.key === "Home") player.setBacklogPosition(0);
      else if (event.key === "End") player.setBacklogPosition(player.backlog.length);
      else player.closeBacklog();
      player.safeState.inputResult = 4;
      onUpdate();
      return;
    }
    if (event.key === "Control") {
      // Ctrl toggles Skip mode (held-to-skip feel via the rAF driver).
      player.autoAdvanceUpdate = onUpdate;
      player.toggleSkipMode();
      onUpdate();
      return;
    }
    if (event.key === "a" || event.key === "A") {
      player.autoAdvanceUpdate = onUpdate;
      player.toggleAutoMode();
      onUpdate();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      advance({ timeStamp: event.timeStamp, clientY: Number.NaN });
    }
  });
  const advanceScenario = () => {
    advance({ timeStamp: performance.now() });
    return getMounted()?.player?.safeState ?? { active: false };
  };
  const saveScenario = () => {
    const player = getMounted()?.player;
    const result = player?.saveToStorage() ?? { ok: false, bytes: 0, reason: "no_player" };
    onUpdate();
    return result;
  };
  const loadScenario = async () => {
    const player = getMounted()?.player;
    const result = player
      ? await player.loadFromStorage()
      : { ok: false, bytes: 0, reason: "no_player" };
    onUpdate();
    return result;
  };
  const toggleAuto = () => {
    const player = getMounted()?.player;
    if (!player) return { autoMode: 0, skipMode: 0 };
    player.autoAdvanceUpdate = onUpdate;
    player.toggleAutoMode();
    onUpdate();
    return { autoMode: player.safeState.autoMode, skipMode: player.safeState.skipMode };
  };
  const toggleSkip = () => {
    const player = getMounted()?.player;
    if (!player) return { autoMode: 0, skipMode: 0 };
    player.autoAdvanceUpdate = onUpdate;
    player.toggleSkipMode();
    onUpdate();
    return { autoMode: player.safeState.autoMode, skipMode: player.safeState.skipMode };
  };
  globalThis.sakuraAdvanceScenario = advanceScenario;
  globalThis.__sakuraAdvanceScenario = advanceScenario;
  globalThis.sakuraSaveSession = saveScenario;
  globalThis.__sakuraSaveSession = saveScenario;
  globalThis.sakuraLoadSession = loadScenario;
  globalThis.__sakuraLoadSession = loadScenario;
  globalThis.sakuraToggleAuto = toggleAuto;
  globalThis.sakuraToggleSkip = toggleSkip;
  if (globalThis.window) {
    window.sakuraAdvanceScenario = advanceScenario;
    window.__sakuraAdvanceScenario = advanceScenario;
    window.sakuraSaveSession = saveScenario;
    window.__sakuraSaveSession = saveScenario;
    window.sakuraLoadSession = loadScenario;
    window.__sakuraLoadSession = loadScenario;
    window.sakuraToggleAuto = toggleAuto;
    window.sakuraToggleSkip = toggleSkip;
  }
}

export function paintScenarioScene(context, canvas, player, { clear = true } = {}) {
  if (!player) {
    return false;
  }
  if (clear) {
    context.fillStyle = "#000";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  const scene = player.scene;
  const mappedBlackTransition = Boolean(
    scene.transitioning
    && scene.target === null
    && scene.targetName === null
    && scene.transitionMap,
  );
  if (scene.transitioning) {
    drawSceneImage(context, canvas, scene.current, 1);
    if (scene.transitionMap) {
      if (scene.target) {
        drawMappedSceneImage(
          context,
          canvas,
          scene.target,
          scene.transitionMap,
          scene.progress,
          scene,
        );
      }
    } else {
      drawSceneImage(context, canvas, scene.target, scene.progress);
    }
    if (scene.target === null && !scene.transitionMap) {
      context.fillStyle = `rgba(0, 0, 0, ${scene.progress})`;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
  } else {
    drawSceneImage(context, canvas, scene.current, 1);
  }
  advanceScenarioMovies(scene.movies, scene.sprites);
  paintScenarioSprites(context, canvas, scene.sprites);
  if (mappedBlackTransition) {
    drawMappedSceneBlack(
      context,
      canvas,
      scene.transitionMap,
      scene.progress,
      scene,
    );
  }
  paintScenarioRain(context, canvas, scene.rain);
  paintScenarioAperture(context, canvas, scene.aperture);
  applyScenarioFilter(context, canvas, scene.filter);
  return true;
}

export function scenarioScreenOffset(player) {
  const shake = player?.scene?.shake ?? null;
  const offset = scenarioShakeOffset(shake, performance.now());
  if (shake && !offset.active) {
    player.scene.shake = null;
  }
  return offset;
}

export function paintScenarioOverlay(context, canvas, player, skin = null) {
  if (
    paintScenarioConfigWindow(
      context,
      canvas,
      player?.configSkin ?? null,
      player?.configState ?? null,
    )
  ) {
    return;
  }
  if (
    paintScenarioUserDataWindow(
      context,
      canvas,
      player?.userDataSkin ?? null,
      player?.userDataState ?? null,
      player?.userDataSlotSummaries?.() ?? [],
    )
  ) {
    return;
  }
  if (
    paintScenarioBacklog(
      context,
      canvas,
      player?.backlog ?? [],
      player?.logSkin ?? null,
      player?.backlogState ?? null,
    )
  ) {
    return;
  }
  if (player?.messageWindowHidden) {
    return;
  }
  const visual = resolvedScenarioMessageVisual(player?.messageVisual ?? null);
  if (visual === null || visual.opacity <= 0) {
    return;
  }
  const maxChars = resolvedScenarioMessageReveal(player?.messageVisual ?? null);
  context.save();
  context.globalAlpha *= visual.opacity;
  paintScenarioEvent(
    context,
    canvas,
    visual.event ?? EMPTY_MESSAGE_WINDOW_EVENT,
    skin,
    player?.messageControlHover ?? -1,
    maxChars,
    player?.messageWindowOpacity ?? 0.6,
  );
  context.restore();
}

export function paintScenarioEvent(
  context,
  canvas,
  event,
  skin = null,
  hoverControl = -1,
  maxChars = Infinity,
  messageWindowOpacity = 0.6,
) {
  if (event === null || event.kind === EVENT_HALTED) {
    return;
  }
  if (
    event.kind !== EVENT_MESSAGE
    && event.kind !== EVENT_CHOICE
  ) {
    return;
  }
  if (skin?.panel) {
    paintMessageWindow(context, canvas, event, skin, hoverControl, maxChars, messageWindowOpacity);
    return;
  }
  const boxHeight = 146;
  const x = 64;
  const y = canvas.height - boxHeight - 34;
  context.fillStyle = "rgba(0, 0, 0, 0.78)";
  context.fillRect(x, y, canvas.width - x * 2, boxHeight);
  context.strokeStyle = "rgba(255, 255, 255, 0.45)";
  context.strokeRect(x, y, canvas.width - x * 2, boxHeight);
  context.fillStyle = "#f7f3e8";
  context.font = "24px 'Noto Sans CJK JP', 'Yu Gothic', 'MS Gothic', sans-serif";
  if (event.kind === EVENT_MESSAGE) {
    drawScenarioRichText(context, event.text, x + 24, y + 48, canvas.width - x * 2 - 48, 30, 3, maxChars);
  } else if (event.kind === EVENT_CHOICE) {
    event.options.slice(0, 3).forEach((option, index) => {
      context.fillText(`${index + 1}. ${stripScenarioTags(option)}`, x + 24, y + 42 + index * 34);
    });
  } else if (event.kind === EVENT_USER_FUNCTION) {
    context.fillText(event.name, x + 24, y + 48);
  }
}

function paintMessageWindow(
  context,
  canvas,
  event,
  skin,
  hoverControl,
  maxChars = Infinity,
  messageWindowOpacity = 0.6,
) {
  const panelX = Math.round((canvas.width - skin.panel.width) / 2);
  const panelY = canvas.height - skin.panel.height;
  context.save();
  context.globalAlpha = Math.max(0.25, Math.min(Number(messageWindowOpacity) || 0.6, 1));
  drawRgbaImage(context, skin.panel, panelX, panelY);
  context.restore();

  const controlScale = 1.04;
  const controlsWidth = skin.controls.reduce(
    (sum, control) => sum + control.stateWidth * controlScale,
    0,
  );
  let controlX = panelX + skin.panel.width - controlsWidth - 30;
  const controlY = panelY - 23;
  skin.controls.forEach((control, index) => {
    const controlWidth = control.stateWidth * controlScale;
    context.drawImage(
      rgbaCanvas(control.image),
      index === hoverControl ? control.stateWidth : 0,
      0,
      control.stateWidth,
      control.stateHeight,
      controlX,
      controlY,
      controlWidth,
      control.stateHeight,
    );
    controlX += controlWidth;
  });

  context.save();
  context.fillStyle = "#0a0a08";
  context.font = "29px 'Noto Serif CJK JP', 'Yu Mincho', 'MS Mincho', serif";
  context.textBaseline = "top";
  if (event.kind === EVENT_MESSAGE) {
    if (event.name && skin.nameplate) {
      drawRgbaImage(context, skin.nameplate, panelX + 38, panelY - 30);
      context.font = "21px 'Noto Serif CJK JP', 'Yu Mincho', 'MS Mincho', serif";
      context.fillText(stripScenarioTags(event.name), panelX + 64, panelY - 16);
      context.font = "29px 'Noto Serif CJK JP', 'Yu Mincho', 'MS Mincho', serif";
    }
    drawScenarioRichText(
      context,
      visibleMessageText(event.text),
      panelX + 75,
      panelY + 34,
      skin.panel.width - 135,
      38,
      3,
      maxChars,
    );
  } else if (event.kind === EVENT_CHOICE) {
    event.options.slice(0, 3).forEach((option, index) => {
      context.fillText(`${index + 1}. ${stripScenarioTags(option)}`, panelX + 75, panelY + 42 + index * 38);
    });
  }
  context.restore();
}

function visibleMessageText(text) {
  return text.startsWith("\u3000") ? text.slice(1) : text;
}

// Default reveal speed for a new player. Disabled (instant) under automation
// (Playwright sets navigator.webdriver) and when no DOM is present, so
// deterministic capture and unit tests keep their existing advance semantics.
function messageRevealMsPerCharDefault() {
  const nav = globalThis.navigator;
  if (!nav || nav.webdriver === true) {
    return 0;
  }
  return DEFAULT_REVEAL_MS_PER_CHAR;
}

function revealMsPerCharForConfig(settings) {
  return Math.round((1 - clampConfigRatio(settings.textSpeed)) * 60);
}

function autoDelayMsForConfig(settings) {
  return Math.round(2600 - clampConfigRatio(settings.autoSpeed) * 2200);
}

function messageWindowOpacityForConfig(settings) {
  return 0.25 + clampConfigRatio(settings.windowOpacity) * 0.75;
}

function clampConfigRatio(value) {
  return Math.max(0, Math.min(Number(value) || 0, 1));
}

function createPlayer(catalog, core, handle, scenarioSequence, scenarioIndex, routeId = null) {
  return {
    handle,
    routeId,
    scenarioSequence,
    scenarioIndex,
    scenarioLoading: false,
    event: { kind: 0 },
    scene: {
      current: null,
      currentName: null,
      target: null,
      targetName: null,
      progress: 1,
      transitionMap: null,
      transitionMapName: null,
      transitioning: false,
      shake: null,
      sprites: createScenarioSpriteState(),
      movies: createScenarioMovieState(core),
      filter: createScenarioFilterState(),
      aperture: createScenarioApertureState(),
      rain: createScenarioRainState(),
    },
    skin: null,
    logSkin: null,
    userDataSkin: null,
    configSkin: null,
    imageCache: new Map(),
    audioCache: new Map(),
    audioMixer: null,
    backlog: [],
    backlogState: createScenarioBacklogState(),
    userDataState: createScenarioUserDataState(),
    configState: createScenarioConfigState(),
    messageVisual: createScenarioMessageVisualState(),
    messageWindowHidden: false,
    messageControlHover: -1,
    pendingBacklogVoice: null,
    automaticRunning: false,
    automaticSkip: false,
    automaticSkippable: true,
    automaticWake: null,
    automaticFrame: 0,
    visualFrame: 0,
    automaticUpdate: null,
    destroyed: false,
    // Auto/Skip playback modes (real-user features; off under automation).
    autoMode: false,
    skipMode: false,
    autoAdvanceAt: 0,
    messageAdvanceFrame: 0,
    // Typing reveal ms/char. Real users get the engine's char-by-char reveal;
    // automation (Playwright sets navigator.webdriver) and any environment
    // without it stays instant so deterministic capture and tests are unchanged.
    revealMsPerChar: messageRevealMsPerCharDefault(),
    autoAdvanceDelayMs: AUTO_ADVANCE_DELAY_MS,
    messageWindowOpacity: 0.6,
    safeState: safeSessionState(false, null),
    messageRevealOptions() {
      if (this.event?.kind !== EVENT_MESSAGE || this.revealMsPerChar <= 0) {
        return {};
      }
      return {
        charCount: countScenarioTextChars(visibleMessageText(this.event.text)),
        msPerChar: this.revealMsPerChar,
      };
    },
    step() {
      const packet = core.scenarioSessionStep(this.handle);
      if (packet === null) {
        return false;
      }
      this.event = decodeSessionEvent(packet, core.scenarioSessionCurrentPayload(this.handle));
      this.autoAdvanceAt = 0;
      if (isStableSaveEvent(this.event)) {
        showScenarioMessageVisual(this.messageVisual, this.event, this.messageRevealOptions());
        if (this.event.kind === EVENT_MESSAGE) {
          startVisualAnimation(this);
        }
      }
      if (this.event.kind === EVENT_MESSAGE) {
        const voice = this.pendingBacklogVoice;
        this.backlog.push({
          eventCount: this.event.eventCount,
          name: this.event.name,
          text: this.event.text,
          ...(voice === null ? {} : {
            voiceName: voice.name,
            voiceVolume: voice.volume,
          }),
        });
        this.pendingBacklogVoice = null;
        if (this.backlog.length > SCENARIO_BACKLOG_LIMIT) {
          this.backlog.splice(0, this.backlog.length - SCENARIO_BACKLOG_LIMIT);
        }
      }
      this.event.backlogLength = this.backlog.length;
      const previous = this.safeState;
      this.safeState = {
        ...safeSessionState(true, this.event),
        sceneAssetReady: previous.sceneAssetReady ?? 0,
        sceneAssetNameLength: previous.sceneAssetNameLength ?? 0,
        sceneTransitionMs: previous.sceneTransitionMs ?? 0,
        sceneTransitionMapNameLength: previous.sceneTransitionMapNameLength ?? 0,
        sceneTransitionMapReady: previous.sceneTransitionMapReady ?? 0,
        sceneAssetErrors: previous.sceneAssetErrors ?? 0,
        sceneShakeMs: previous.sceneShakeMs ?? 0,
        sceneShakeAmplitudeX: previous.sceneShakeAmplitudeX ?? 0,
        sceneShakeAmplitudeY: previous.sceneShakeAmplitudeY ?? 0,
        sceneShakeUpdateCount: previous.sceneShakeUpdateCount ?? 0,
        scenePresetShakeCount: previous.scenePresetShakeCount ?? 0,
        sceneShakeDirection: previous.sceneShakeDirection ?? 0,
        sceneShakeStrengthIndex: previous.sceneShakeStrengthIndex ?? 0,
        sceneShakePeriodMs: previous.sceneShakePeriodMs ?? 0,
        sceneShakeCycles: previous.sceneShakeCycles ?? 0,
        sceneShakeDecayPercent: previous.sceneShakeDecayPercent ?? 0,
        sceneBankSpriteMs: previous.sceneBankSpriteMs ?? 0,
        sceneBankSpriteNameLength: previous.sceneBankSpriteNameLength ?? 0,
        sceneBankSpriteTerminations: previous.sceneBankSpriteTerminations ?? 0,
        sceneSpriteOpcode: previous.sceneSpriteOpcode ?? 0,
        sceneSpriteEventCount: previous.sceneSpriteEventCount ?? 0,
        sceneSpriteSlot: previous.sceneSpriteSlot ?? 0,
        sceneSpriteCount: previous.sceneSpriteCount ?? 0,
        sceneSpriteTransitions: previous.sceneSpriteTransitions ?? 0,
        sceneSpriteMotionCount: previous.sceneSpriteMotionCount ?? 0,
        sceneObjectId: previous.sceneObjectId ?? 0,
        sceneObjectCount: previous.sceneObjectCount ?? 0,
        sceneObjectAssetReady: previous.sceneObjectAssetReady ?? 0,
        sceneObjectEventCount: previous.sceneObjectEventCount ?? 0,
        sceneMovieCount: previous.sceneMovieCount ?? 0,
        sceneMovieArchiveNameLength: previous.sceneMovieArchiveNameLength ?? 0,
        sceneMovieFrameRate: previous.sceneMovieFrameRate ?? 0,
          sceneFilterCount: previous.sceneFilterCount ?? 0,
          sceneFilterDurationMs: previous.sceneFilterDurationMs ?? 0,
          sceneFilterMode: previous.sceneFilterMode ?? 0,
          sceneFilterStrength: previous.sceneFilterStrength ?? 0,
          sceneApertureCount: previous.sceneApertureCount ?? 0,
          sceneApertureDurationMs: previous.sceneApertureDurationMs ?? 0,
          sceneRainCount: previous.sceneRainCount ?? 0,
          sceneRainActive: previous.sceneRainActive ?? 0,
          sceneRainDensity: previous.sceneRainDensity ?? 0,
          sceneRainSpeed: previous.sceneRainSpeed ?? 0,
          sceneRainAngle: previous.sceneRainAngle ?? 0,
          sceneRainAlpha: previous.sceneRainAlpha ?? 0,
          scenarioUserFunctionCount: previous.scenarioUserFunctionCount ?? 0,
        scenarioUserFunctionNameLength: previous.scenarioUserFunctionNameLength ?? 0,
        messageControlOpcode: previous.messageControlOpcode ?? 0,
        messageControlDurationMs: previous.messageControlDurationMs ?? 0,
        messageControlVisible: previous.messageControlVisible ?? 0,
        messageControlCount: previous.messageControlCount ?? 0,
        messageWindowHidden: previous.messageWindowHidden ?? 0,
        messageControlClickIndex: previous.messageControlClickIndex ?? -1,
        messageControlClickName: previous.messageControlClickName ?? "",
        messageControlClickResult: previous.messageControlClickResult ?? "",
        messageControlClickOk: previous.messageControlClickOk ?? 0,
        userDataOpen: previous.userDataOpen ?? 0,
        userDataMode: previous.userDataMode ?? "",
        userDataPage: previous.userDataPage ?? 0,
        userDataSelectedSlot: previous.userDataSelectedSlot ?? 0,
        userDataLastResult: previous.userDataLastResult ?? "",
        userDataLastOk: previous.userDataLastOk ?? 0,
        configOpen: previous.configOpen ?? 0,
        configHover: previous.configHover ?? "",
        configLastAction: previous.configLastAction ?? "",
        configTextSpeed: previous.configTextSpeed ?? 0,
        configAutoSpeed: previous.configAutoSpeed ?? 0,
        configWindowOpacity: previous.configWindowOpacity ?? 0,
        configMasterVolume: previous.configMasterVolume ?? 0,
        configBgmVolume: previous.configBgmVolume ?? 0,
        configSfxVolume: previous.configSfxVolume ?? 0,
        configVoiceVolume: previous.configVoiceVolume ?? 0,
        bgmAssetReady: previous.bgmAssetReady ?? 0,
        bgmPlayResult: previous.bgmPlayResult ?? 0,
        bgmNameLength: previous.bgmNameLength ?? 0,
        bgmFadeMs: previous.bgmFadeMs ?? 0,
        voiceAssetReady: previous.voiceAssetReady ?? 0,
        voicePlayResult: previous.voicePlayResult ?? 0,
        voiceNameLength: previous.voiceNameLength ?? 0,
        voiceChannel: previous.voiceChannel ?? 0,
        voiceControlOpcode: previous.voiceControlOpcode ?? 0,
        voiceControlCount: previous.voiceControlCount ?? 0,
        voiceWaitInterruptible: previous.voiceWaitInterruptible ?? 0,
        sfxAssetReady: previous.sfxAssetReady ?? 0,
        sfxPlayResult: previous.sfxPlayResult ?? 0,
        sfxNameLength: previous.sfxNameLength ?? 0,
        sfxControlOpcode: previous.sfxControlOpcode ?? 0,
        sfxChannel: previous.sfxChannel ?? 0,
        sfxFadeMs: previous.sfxFadeMs ?? 0,
        sfxControlCount: previous.sfxControlCount ?? 0,
        sfxWaitInterruptible: previous.sfxWaitInterruptible ?? 0,
        loopSfxControlOpcode: previous.loopSfxControlOpcode ?? 0,
        loopSfxFadeMs: previous.loopSfxFadeMs ?? 0,
        loopSfxTargetVolume: previous.loopSfxTargetVolume ?? 0,
        inputResult: previous.inputResult ?? 0,
        lastSaveBytes: previous.lastSaveBytes ?? 0,
        lastLoadBytes: previous.lastLoadBytes ?? 0,
        lastSaveSlot: previous.lastSaveSlot ?? 0,
        lastLoadSlot: previous.lastLoadSlot ?? 0,
        scenarioName: previous.scenarioName,
        scenarioRoute: this.routeId,
        scenarioIndex: this.scenarioIndex,
        scenarioCount: this.scenarioSequence.length,
        scenarioTransitions: previous.scenarioTransitions ?? 0,
        scanCount: previous.scanCount,
        scanSkippedLarge: previous.scanSkippedLarge,
      };
      if (this.event.kind === EVENT_HALTED) {
        this.queueNextScenario();
      }
      return true;
    },
    syncBacklogState() {
      this.safeState.backlogOpen = Number(this.backlogState.open);
      this.safeState.backlogFirstIndex = this.backlogState.firstIndex;
    },
    openBacklog() {
      openScenarioBacklog(this.backlogState, this.backlog.length);
      this.messageControlHover = -1;
      this.syncBacklogState();
    },
    closeBacklog() {
      closeScenarioBacklog(this.backlogState);
      this.syncBacklogState();
    },
    scrollBacklog(delta) {
      const changed = scrollScenarioBacklog(this.backlogState, this.backlog.length, delta);
      this.syncBacklogState();
      return changed;
    },
    setBacklogPosition(firstIndex) {
      setScenarioBacklogPosition(this.backlogState, this.backlog.length, firstIndex);
      this.syncBacklogState();
    },
    openUserDataWindow(mode) {
      this.cancelAutoSkip();
      closeScenarioBacklog(this.backlogState);
      openScenarioUserDataWindow(this.userDataState, mode);
      this.messageControlHover = -1;
      this.safeState.userDataOpen = 1;
      this.safeState.userDataMode = this.userDataState.mode;
    },
    closeUserDataWindow() {
      closeScenarioUserDataWindow(this.userDataState);
      this.safeState.userDataOpen = 0;
      this.safeState.userDataMode = "";
    },
    openConfigWindow() {
      this.cancelAutoSkip();
      closeScenarioBacklog(this.backlogState);
      closeScenarioUserDataWindow(this.userDataState);
      openScenarioConfigWindow(this.configState);
      this.messageControlHover = -1;
      this.syncConfigState();
    },
    closeConfigWindow() {
      closeScenarioConfigWindow(this.configState);
      this.syncConfigState();
    },
    applyConfigControl(control) {
      const result = applyScenarioConfigControl(this.configState, control);
      if (result.handled) {
        this.applyConfigSettings();
        if (result.reason !== "title_pending") {
          this.storeConfigSettings();
        }
      }
      this.syncConfigState();
      return result;
    },
    loadConfigSettings() {
      const settings = readStoredScenarioConfigSettings();
      if (settings !== null) {
        this.configState.settings = settings;
      }
      this.applyConfigSettings();
      this.syncConfigState();
    },
    storeConfigSettings() {
      return storeScenarioConfigSettings(this.configState.settings);
    },
    applyConfigSettings() {
      const settings = this.configState.settings;
      this.revealMsPerChar = revealMsPerCharForConfig(settings);
      this.autoAdvanceDelayMs = autoDelayMsForConfig(settings);
      this.messageWindowOpacity = messageWindowOpacityForConfig(settings);
      this.audioMixer?.setVolumes?.({
        master: settings.masterVolume,
        bgm: settings.bgmVolume,
        sfx: settings.sfxVolume,
        voice: settings.voiceVolume,
      });
    },
    syncConfigState() {
      const settings = this.configState.settings;
      this.safeState.configOpen = Number(this.configState.open);
      this.safeState.configHover = this.configState.hover ?? "";
      this.safeState.configLastAction = this.configState.lastAction ?? "";
      this.safeState.configTextSpeed = Math.round(settings.textSpeed * 100);
      this.safeState.configAutoSpeed = Math.round(settings.autoSpeed * 100);
      this.safeState.configWindowOpacity = Math.round(settings.windowOpacity * 100);
      this.safeState.configMasterVolume = Math.round(settings.masterVolume * 100);
      this.safeState.configBgmVolume = Math.round(settings.bgmVolume * 100);
      this.safeState.configSfxVolume = Math.round(settings.sfxVolume * 100);
      this.safeState.configVoiceVolume = Math.round(settings.voiceVolume * 100);
    },
    applyUserDataControl(control, onUpdate = null) {
      const result = applyScenarioUserDataControl(this.userDataState, control, {
        save: (slot) => {
          const save = this.saveToStorage(slot);
          return { handled: true, reason: save.reason, ok: save.ok };
        },
        load: (slot) => {
          void this.loadFromStorage(slot).then((load) => {
            this.safeState.userDataLastResult = load.reason;
            this.safeState.userDataLastOk = Number(load.ok);
            if (load.ok) {
              this.closeUserDataWindow();
            }
            onUpdate?.();
          });
          return { handled: true, reason: "loading", ok: true };
        },
      });
      this.safeState.userDataOpen = Number(this.userDataState.open);
      this.safeState.userDataMode = this.userDataState.open ? this.userDataState.mode : "";
      this.safeState.userDataPage = this.userDataState.page;
      this.safeState.userDataSelectedSlot = this.userDataState.selectedSlot;
      this.safeState.userDataLastResult = result.reason ?? "";
      this.safeState.userDataLastOk = Number(result.ok ?? result.handled ?? false);
      return result;
    },
    userDataSlotSummaries() {
      const start = this.userDataState.page * USER_DATA_SLOTS_PER_PAGE;
      return Array.from(
        { length: USER_DATA_SLOTS_PER_PAGE },
        (_, index) => this.saveSlotSummary(start + index),
      );
    },
    saveSlotSummary(slotIndex) {
      return readScenarioSaveSlotSummary(slotIndex);
    },
    async replayBacklogVoice(entryIndex) {
      const entry = this.backlog[entryIndex];
      if (!entry?.voiceName || this.audioMixer === null) {
        return { ok: false, reason: "voice_unavailable" };
      }
      const ogg = await loadScenarioAudio(this, catalog, core, entry.voiceName);
      const result = await this.audioMixer.playVoice(ogg, {
        volume: entry.voiceVolume ?? 1,
      });
      this.backlogState.replayingIndex = result.ok ? entryIndex : -1;
      return result;
    },
    async replayCurrentVoice() {
      const eventCount = this.event?.eventCount ?? -1;
      const entryIndex = this.backlog.findLastIndex((entry) => (
        entry.eventCount === eventCount
        && entry.voiceName
      ));
      return entryIndex >= 0
        ? this.replayBacklogVoice(entryIndex)
        : { ok: false, reason: "voice_unavailable" };
    },
    setMessageWindowHidden(hidden) {
      this.messageWindowHidden = hidden === true;
      this.messageControlHover = -1;
      this.safeState.messageWindowHidden = Number(this.messageWindowHidden);
    },
    startAutomatic(onUpdate = null) {
      if (onUpdate) {
        this.automaticUpdate = onUpdate;
      }
      if (this.automaticRunning || !isAutomaticEvent(this.event) || this.destroyed) {
        return;
      }
      this.automaticRunning = true;
      void runAutomaticEvents(this, catalog, core);
    },
    skipAutomatic() {
      if (!this.automaticSkippable) {
        return false;
      }
      this.automaticSkip = true;
      this.automaticWake?.();
      return true;
    },
    setAutoMode(on) {
      this.autoMode = on === true;
      if (this.autoMode) {
        this.skipMode = false;
      }
      this.autoAdvanceAt = 0;
      if (this.autoMode || this.skipMode) {
        startMessageAutoAdvance(this);
      }
      this.safeState.autoMode = Number(this.autoMode);
      this.safeState.skipMode = Number(this.skipMode);
    },
    toggleAutoMode() {
      this.setAutoMode(!this.autoMode);
      return this.autoMode;
    },
    setSkipMode(on) {
      this.skipMode = on === true;
      if (this.skipMode) {
        this.autoMode = false;
        // Cancel any in-progress reveal immediately.
        completeScenarioMessageReveal(this.messageVisual);
        this.skipAutomatic();
      }
      if (this.autoMode || this.skipMode) {
        startMessageAutoAdvance(this);
      }
      this.safeState.autoMode = Number(this.autoMode);
      this.safeState.skipMode = Number(this.skipMode);
    },
    toggleSkipMode() {
      this.setSkipMode(!this.skipMode);
      return this.skipMode;
    },
    cancelAutoSkip() {
      if (this.autoMode || this.skipMode) {
        this.autoMode = false;
        this.skipMode = false;
        this.safeState.autoMode = 0;
        this.safeState.skipMode = 0;
      }
    },
    advanceMessage() {
      return core.scenarioSessionAdvanceMessage(this.handle);
    },
    selectChoice(index) {
      return core.scenarioSessionSelectChoice(this.handle, index);
    },
    save() {
      return core.scenarioSessionSnapshot(this.handle);
    },
    saveToStorage(slotIndex = 0) {
      if (!isStableSaveEvent(this.event) || this.scenarioLoading || this.automaticRunning) {
        return { ok: false, bytes: 0, reason: "unstable_event" };
      }
      const slot = normalizeSaveSlot(slotIndex);
      const saved = this.save();
      if (!saved) {
        return { ok: false, bytes: 0, reason: "snapshot_unavailable" };
      }
      const storage = globalThis.window?.localStorage ?? globalThis.localStorage;
      if (!storage) {
        return { ok: false, bytes: saved.byteLength, reason: "storage_unavailable" };
      }
      const visualNow = performance.now();
      const record = {
        version: SAVE_RECORD_VERSION,
        savedAt: new Date().toISOString().replace("T", " ").replace(/\.\d{3}Z$/, ""),
        slot,
        routeId: this.routeId,
        scenarioSequence: this.scenarioSequence,
        scenarioName: this.safeState.scenarioName,
        scenarioIndex: this.scenarioIndex,
        snapshot: bytesToBase64(saved),
        event: cloneStableEvent(this.event),
        backlog: this.backlog.map((entry) => ({ ...entry })),
        visual: {
          backgroundName: this.scene.currentName,
          sprites: snapshotScenarioSprites(this.scene.sprites, visualNow),
          spriteTransitions: snapshotScenarioSpriteTransitions(
            this.scene.sprites,
            visualNow,
          ),
          motions: snapshotScenarioSpriteMotions(this.scene.sprites),
          controlMotions: snapshotScenarioSpriteControlMotions(this.scene.sprites),
          sceneObjects: snapshotScenarioSceneObjects(this.scene.sprites, visualNow)
            .map((object) => object.isMovie
              ? {
                  ...object,
                  movieElapsedMs: scenarioMovieElapsedMs(
                    this.scene.movies,
                    object.id,
                    visualNow,
                  ),
                }
              : object),
          filter: snapshotScenarioFilter(this.scene.filter),
          aperture: snapshotScenarioAperture(this.scene.aperture),
          rain: snapshotScenarioRain(this.scene.rain),
        },
      };
      const encoded = JSON.stringify(record);
      storage.setItem(saveSlotKey(slot), encoded);
      if (slot === 0) {
        storage.setItem(SAVE_SLOT_KEY, encoded);
      }
      this.safeState.lastSaveBytes = saved.byteLength;
      this.safeState.lastSaveSlot = slot;
      return { ok: true, bytes: saved.byteLength, reason: "ok" };
    },
    async loadFromStorage(slotIndex = 0) {
      if (this.scenarioLoading || this.automaticRunning) {
        return { ok: false, bytes: 0, reason: "player_busy" };
      }
      const slot = normalizeSaveSlot(slotIndex);
      const storage = globalThis.window?.localStorage ?? globalThis.localStorage;
      const encoded = storage?.getItem(saveSlotKey(slot))
        ?? (slot === 0 ? storage?.getItem(SAVE_SLOT_KEY) : null);
      if (encoded === null) {
        return { ok: false, bytes: 0, reason: "missing_snapshot" };
      }
      const parsed = parseSaveRecord(encoded, this.scenarioSequence, this.routeId);
      if (!parsed.ok) {
        return { ok: false, bytes: 0, reason: parsed.reason };
      }
      const result = await this.restoreSaveRecord(parsed.record);
      this.safeState.lastLoadSlot = slot;
      return {
        ok: result.ok,
        bytes: parsed.record.snapshot.byteLength,
        reason: result.reason,
      };
    },
    async restoreSaveRecord(record) {
      const nextHandle = await createScenarioHandle(catalog, core, record.scenarioName);
      if (nextHandle === 0) {
        return { ok: false, reason: "scenario_unavailable" };
      }
      if (
        core.scenarioSessionRestoreSnapshot(nextHandle, record.snapshot) !== 1
        || core.scenarioSessionMode(nextHandle) !== record.event.mode
      ) {
        core.scenarioSessionDestroy(nextHandle);
        return { ok: false, reason: "restore_failed" };
      }
      const visualOk = await restoreSceneVisual(this, catalog, core, record.visual);
      if (!visualOk) {
        core.scenarioSessionDestroy(nextHandle);
        return { ok: false, reason: "visual_restore_failed" };
      }
      core.scenarioSessionDestroy(this.handle);
      this.handle = nextHandle;
      this.routeId = record.routeId;
      this.scenarioSequence = record.scenarioSequence;
      this.scenarioIndex = record.scenarioIndex;
      this.backlog = record.backlog.map((entry) => ({ ...entry }));
      this.pendingBacklogVoice = null;
      closeScenarioBacklog(this.backlogState);
      closeScenarioUserDataWindow(this.userDataState);
      closeScenarioConfigWindow(this.configState);
      this.messageWindowHidden = false;
      this.messageControlHover = -1;
      this.event = record.event;
      showScenarioMessageVisual(this.messageVisual, this.event);
      this.event.backlogLength = this.backlog.length;
      const previous = this.safeState;
      this.safeState = {
        ...safeSessionState(true, record.event),
        scenarioName: record.scenarioName,
        scenarioRoute: record.routeId,
        scenarioIndex: record.scenarioIndex,
        scenarioCount: this.scenarioSequence.length,
        scenarioTransitions: previous.scenarioTransitions ?? 0,
        sceneAssetReady: Number(this.scene.current !== null),
        sceneAssetNameLength: this.scene.currentName?.length ?? 0,
        sceneSpriteCount: this.scene.sprites.layers.size,
        sceneTransitionMapNameLength: Math.max(
          0,
          ...[...this.scene.sprites.transitions.values()]
            .map((transition) => transition.mapAssetName?.length ?? 0),
        ),
        sceneTransitionMapReady: Number(
          [...this.scene.sprites.transitions.values()]
            .some((transition) => Boolean(transition.mapImage)),
        ),
        sceneSpriteMotionCount:
          this.scene.sprites.motions.size + this.scene.sprites.controlMotions.size,
        sceneObjectCount: this.scene.sprites.sceneObjects.size,
        sceneMovieCount: this.scene.movies.objects.size,
        sceneMovieArchiveNameLength: Math.max(
          0,
          ...[...this.scene.movies.objects.values()]
            .map((movie) => this.scene.sprites.sceneObjects
              .get(movie.id)?.assetName?.length ?? 0),
        ),
        sceneMovieFrameRate: Math.round(
          [...this.scene.movies.objects.values()][0]?.frameRate ?? 0,
        ),
        sceneFilterMode: this.scene.filter.current?.mode ?? 0,
        sceneFilterStrength: this.scene.filter.current?.strength ?? 0,
        sceneApertureCount: previous.sceneApertureCount ?? 0,
        sceneApertureDurationMs: previous.sceneApertureDurationMs ?? 0,
        sceneRainCount: previous.sceneRainCount ?? 0,
        sceneRainActive: Number(hasActiveScenarioRain(this.scene.rain)),
        sceneRainDensity: this.scene.rain.density,
        sceneRainSpeed: this.scene.rain.speed,
        sceneRainAngle: this.scene.rain.angleDeg,
        sceneRainAlpha: Math.round(this.scene.rain.alpha * 255),
        lastSaveBytes: previous.lastSaveBytes ?? 0,
        lastLoadBytes: record.snapshot.byteLength,
        lastSaveSlot: previous.lastSaveSlot ?? 0,
        lastLoadSlot: previous.lastLoadSlot ?? 0,
        userDataOpen: 0,
        userDataMode: "",
        userDataPage: this.userDataState.page,
        userDataSelectedSlot: this.userDataState.selectedSlot,
        userDataLastResult: previous.userDataLastResult ?? "",
        userDataLastOk: previous.userDataLastOk ?? 0,
        configOpen: 0,
        configHover: "",
        configLastAction: previous.configLastAction ?? "",
        configTextSpeed: previous.configTextSpeed ?? 0,
        configAutoSpeed: previous.configAutoSpeed ?? 0,
        configWindowOpacity: previous.configWindowOpacity ?? 0,
        configMasterVolume: previous.configMasterVolume ?? 0,
        configBgmVolume: previous.configBgmVolume ?? 0,
        configSfxVolume: previous.configSfxVolume ?? 0,
        configVoiceVolume: previous.configVoiceVolume ?? 0,
        scanCount: previous.scanCount,
        scanSkippedLarge: previous.scanSkippedLarge,
      };
      return { ok: true, reason: "ok" };
    },
    queueNextScenario() {
      if (this.scenarioLoading || this.scenarioIndex + 1 >= this.scenarioSequence.length) {
        return;
      }
      this.scenarioLoading = true;
      const nextIndex = this.scenarioIndex + 1;
      const nextName = this.scenarioSequence[nextIndex];
      void createScenarioHandle(catalog, core, nextName).then((nextHandle) => {
        if (this.destroyed || nextHandle === 0) {
          if (nextHandle !== 0) {
            core.scenarioSessionDestroy(nextHandle);
          }
          return;
        }
        core.scenarioSessionDestroy(this.handle);
        this.handle = nextHandle;
        this.scenarioIndex = nextIndex;
        this.safeState.scenarioName = nextName;
        this.safeState.scenarioIndex = nextIndex;
        this.safeState.scenarioTransitions = (this.safeState.scenarioTransitions ?? 0) + 1;
        if (this.step()) {
          notifyAutomaticUpdate(this);
          this.startAutomatic();
        }
      }).finally(() => {
        this.scenarioLoading = false;
      });
    },
    destroy() {
      this.destroyed = true;
      clearScenarioMovies(this.scene.movies);
      this.automaticWake?.();
      if (this.automaticFrame !== 0) {
        cancelAnimationFrame(this.automaticFrame);
      }
      if (this.visualFrame !== 0) {
        cancelAnimationFrame(this.visualFrame);
      }
      return core.scenarioSessionDestroy(this.handle);
    },
  };
}

async function createScenarioHandle(catalog, core, name) {
  const payload = await catalog.readPayloadByNameBytes(encoder.encode(name));
  if (!payload || core.payloadKind(payload.slice(0, 16)) !== PAYLOAD_KIND_DSC) {
    return 0;
  }
  const summary = core.dscScriptSummary(payload);
  if (summary?.kind !== SCENARIO_KIND) {
    return 0;
  }
  return core.scenarioSessionCreate(payload);
}

async function runAutomaticEvents(player, catalog, core) {
  try {
    while (!player.destroyed && isAutomaticEvent(player.event)) {
      const event = player.event;
      let durationMs = event.durationMs ?? 0;
      let waitUntil = null;
      let afterWait = null;
      let skippable = true;
      let animateMessage = false;
      if (event.kind === EVENT_GRAPH) {
        durationMs = await applyGraphEvent(player, catalog, core, event);
      } else if (event.kind === EVENT_SOUND) {
        const result = await applySoundEvent(player, catalog, core, event);
        if (typeof result === "number") {
          durationMs = result;
        } else {
          durationMs = result.durationMs ?? 0;
          waitUntil = result.waitUntil ?? null;
          afterWait = result.afterWait ?? null;
          skippable = result.skippable ?? true;
        }
      } else if (event.kind === EVENT_USER_FUNCTION) {
        durationMs = applyUserFunctionEvent(player, event);
      } else if (event.kind === EVENT_MESSAGE_CONTROL) {
        const show = (
          event.opcode === MESSAGE_WINDOW_SHOW
          || event.opcode === MESSAGE_WINDOW_SHOW_TIMED
        );
        player.setMessageWindowHidden(false);
        durationMs = show
          ? beginScenarioMessageShow(player.messageVisual, event.durationMs)
          : beginScenarioMessageHide(player.messageVisual, event.durationMs);
        animateMessage = durationMs > 0;
        afterWait = () => finishScenarioMessageTransition(player.messageVisual);
        player.safeState.messageControlOpcode = event.opcode;
        player.safeState.messageControlDurationMs = durationMs;
        player.safeState.messageControlVisible = Number(show);
        player.safeState.messageControlCount =
          (player.safeState.messageControlCount ?? 0) + 1;
      }
      player.automaticSkippable = skippable;
      notifyAutomaticUpdate(player);
      await waitForAutomaticEvent(
        player,
        durationMs,
        event.kind === EVENT_GRAPH,
        waitUntil,
        animateMessage,
      );
      afterWait?.();
      if (player.destroyed) {
        return;
      }
      finishSceneTransition(player);
      player.automaticSkip = false;
      player.automaticSkippable = true;
      if (!player.step()) {
        return;
      }
      notifyAutomaticUpdate(player);
    }
  } finally {
    player.automaticRunning = false;
    player.automaticWake = null;
    player.automaticSkippable = true;
  }
}

function applyUserFunctionEvent(player, event) {
  const name = event.name.toLowerCase();
  if (name === "allclearbustshot" || name === "_allclearbustshot") {
    clearScenarioSprites(player.scene.sprites);
    player.safeState.sceneSpriteCount = 0;
    player.safeState.sceneSpriteMotionCount = 0;
  }
  player.safeState.scenarioUserFunctionCount =
    (player.safeState.scenarioUserFunctionCount ?? 0) + 1;
  player.safeState.scenarioUserFunctionNameLength = event.name.length;
  return 0;
}

async function applySoundEvent(player, catalog, core, event) {
  if (event.opcode === SOUND_BGM_PLAY) {
    const name = event.stringArgs.at(-1) ?? "";
    if (!/^[A-Za-z0-9_]+$/.test(name) || player.audioMixer === null) {
      return 0;
    }
    const ogg = await loadScenarioAudio(player, catalog, core, name);
    const volume = Math.max(0, Math.min(event.intArgs[1] ?? 128, 128)) / 128;
    const result = await player.audioMixer.playTrack(ogg, { loop: true, volume });
    player.safeState.bgmAssetReady = Number(ogg !== null);
    player.safeState.bgmPlayResult = Number(result.ok);
    player.safeState.bgmNameLength = name.length;
    return 0;
  }
  if (event.opcode === SOUND_BGM_STOP) {
    player.audioMixer?.stopTrack();
    return 0;
  }
  if (event.opcode === SOUND_BGM_FADE_OUT) {
    const durationMs = positiveDuration(event.intArgs[1] ?? event.intArgs[0]);
    player.audioMixer?.fadeOut(durationMs);
    player.safeState.bgmFadeMs = durationMs;
    return 0;
  }
  if (event.opcode === SOUND_BGM_CHANGE_VOLUME) {
    const durationMs = positiveDuration(event.intArgs[0]);
    const volume = Math.max(0, Math.min(event.intArgs[1] ?? 128, 128)) / 128;
    player.audioMixer?.changeTrackVolume(volume, durationMs);
    player.safeState.bgmFadeMs = durationMs;
    return 0;
  }
  if (event.opcode === SOUND_VOICE_PLAY || event.opcode === SOUND_VOICE_PLAY_EX) {
    const name = event.stringArgs.findLast(validAssetName) ?? "";
    if (name.length === 0 || player.audioMixer === null) {
      return 0;
    }
    const ogg = await loadScenarioAudio(player, catalog, core, name);
    const volume = event.opcode === SOUND_VOICE_PLAY_EX
      ? Math.max(0, Math.min(event.intArgs[0] ?? 128, 128)) / 128
      : 1;
    const channel = event.opcode === SOUND_VOICE_PLAY_EX
      ? soundChannel(event.intArgs[1])
      : 0;
    player.pendingBacklogVoice = { name, volume };
    const result = await player.audioMixer.playVoice(ogg, { volume, channel });
    player.safeState.voiceAssetReady = Number(ogg !== null);
    player.safeState.voicePlayResult = Number(result.ok);
    player.safeState.voiceNameLength = name.length;
    player.safeState.voiceChannel = channel;
    return 0;
  }
  if (event.opcode === SOUND_VOICE_STOP) {
    const channel = soundChannel(event.intArgs[0]);
    player.audioMixer?.stopVoice?.(channel);
    recordVoiceControl(player, event, channel, false);
    return 0;
  }
  if (event.opcode === SOUND_VOICE_WAIT) {
    const interruptible = (event.intArgs[0] ?? 0) !== 0;
    const channel = soundChannel(event.intArgs[1]);
    const waitUntil = player.audioMixer?.waitForVoice?.(channel) ?? Promise.resolve();
    recordVoiceControl(player, event, channel, interruptible);
    return {
      durationMs: 0,
      waitUntil,
      skippable: interruptible,
      afterWait: () => player.audioMixer?.stopVoice?.(channel),
    };
  }
  if (event.opcode === SOUND_LOOPING_SE_PLAY) {
    const name = event.stringArgs.findLast(validAssetName) ?? "";
    if (name.length === 0 || player.audioMixer === null) {
      return 0;
    }
    const ogg = await loadScenarioAudio(player, catalog, core, name);
    const volume = Math.max(0, Math.min(event.intArgs[1] ?? 128, 128)) / 128;
    const result = await player.audioMixer.playLoopingSfx(ogg, { volume });
    player.safeState.sfxAssetReady = Number(ogg !== null);
    player.safeState.sfxPlayResult = Number(result.ok);
    player.safeState.sfxNameLength = name.length;
    return 0;
  }
  if (event.opcode === SOUND_LOOPING_SE_STOP) {
    player.audioMixer?.stopLoopingSfx();
    recordLoopSfxControl(player, event, 0, 0);
    return 0;
  }
  if (event.opcode === SOUND_LOOPING_SE_FADE_OUT) {
    const durationMs = positiveDuration(event.intArgs[1] ?? event.intArgs[0]);
    player.audioMixer?.fadeOutLoopingSfx(durationMs);
    recordLoopSfxControl(player, event, durationMs, 0);
    return 0;
  }
  if (event.opcode === SOUND_LOOPING_SE_CHANGE_VOLUME) {
    const durationMs = positiveDuration(event.intArgs[0]);
    const volume = Math.max(0, Math.min(event.intArgs[1] ?? 128, 128)) / 128;
    player.audioMixer?.changeLoopingSfxVolume(volume, durationMs);
    recordLoopSfxControl(player, event, durationMs, volume);
    return 0;
  }
  if (event.opcode === SOUND_SE_PLAY) {
    const name = event.stringArgs.findLast(validAssetName) ?? "";
    if (name.length === 0 || player.audioMixer === null) {
      return 0;
    }
    const ogg = await loadScenarioAudio(player, catalog, core, name);
    const volume = Math.max(0, Math.min(event.intArgs[0] ?? 128, 128)) / 128;
    const result = await player.audioMixer.playSfx(ogg, { volume, channel: 0 });
    player.safeState.sfxAssetReady = Number(ogg !== null);
    player.safeState.sfxPlayResult = Number(result.ok);
    player.safeState.sfxNameLength = name.length;
    player.safeState.sfxChannel = 0;
    return 0;
  }
  if (event.opcode === SOUND_SE_STOP) {
    const channel = soundChannel(event.intArgs[0]);
    player.audioMixer?.fadeOutSfx?.(channel, 300);
    recordSfxControl(player, event, channel, 300);
    return 0;
  }
  if (event.opcode === SOUND_SE_FADE_OUT) {
    const durationMs = positiveDuration(event.intArgs[0]);
    const channel = soundChannel(event.intArgs[1]);
    player.audioMixer?.fadeOutSfx?.(channel, durationMs);
    recordSfxControl(player, event, channel, durationMs);
    return 0;
  }
  if (event.opcode === SOUND_SE_WAIT) {
    const interruptible = (event.intArgs[0] ?? 0) !== 0;
    const channel = soundChannel(event.intArgs[1]);
    const waitUntil = player.audioMixer?.waitForSfx?.(channel) ?? Promise.resolve();
    recordSfxControl(player, event, channel, 500);
    player.safeState.sfxWaitInterruptible = Number(interruptible);
    return {
      durationMs: 0,
      waitUntil,
      skippable: interruptible,
      afterWait: () => player.audioMixer?.fadeOutSfx?.(channel, 500),
    };
  }
  return 0;
}

function recordVoiceControl(player, event, channel, interruptible) {
  player.safeState.voiceControlOpcode = event.opcode;
  player.safeState.voiceControlCount = (player.safeState.voiceControlCount ?? 0) + 1;
  player.safeState.voiceChannel = channel;
  player.safeState.voiceWaitInterruptible = Number(interruptible);
}

function recordSfxControl(player, event, channel, durationMs) {
  player.safeState.sfxControlOpcode = event.opcode;
  player.safeState.sfxChannel = channel;
  player.safeState.sfxFadeMs = durationMs;
  player.safeState.sfxControlCount = (player.safeState.sfxControlCount ?? 0) + 1;
}

function recordLoopSfxControl(player, event, durationMs, volume) {
  player.safeState.loopSfxControlOpcode = event.opcode;
  player.safeState.loopSfxFadeMs = durationMs;
  player.safeState.loopSfxTargetVolume = volume;
}

function soundChannel(value) {
  if (!Number.isInteger(value)) {
    return 0;
  }
  return Math.max(0, Math.min(value, 8));
}

async function loadScenarioAudio(player, catalog, core, name) {
  if (!validAssetName(name)) {
    return null;
  }
  const pending = boundedCacheValue(
    player.audioCache,
    name,
    SCENARIO_AUDIO_CACHE_LIMIT,
    async () => {
      const payload = await catalog.readPayloadByNameBytes(encoder.encode(name));
      return payload ? core.bgiAudioOgg(payload) : null;
    },
  );
  return pending;
}

async function applyGraphEvent(player, catalog, core, event) {
  if (event.opcode === GRAPH_SHAKE_START) {
    beginScreenShake(player, event);
    return player.scene.shake?.durationMs ?? 0;
  }
  if (event.opcode === GRAPH_SHAKE_UPDATE) {
    player.safeState.sceneShakeUpdateCount = (player.safeState.sceneShakeUpdateCount ?? 0) + 1;
    return 0;
  }
  if (event.opcode === GRAPH_SPRITE_SHAKE_START) {
    const slot = spriteSlot(event);
    const id = sceneObjectId(event);
    const appliedObjectMotion = (
      player.scene.sprites.sceneObjects.has(id)
      && !player.scene.sprites.layers.has(slot)
      && startScenarioSceneObjectDirectionalMotion(player.scene.sprites, id, event.intArgs)
    );
    if (!appliedObjectMotion) {
      const amplitudeY = Math.abs(event.intArgs.at(-3) ?? 0);
      const periodMs = positiveDuration(event.intArgs.at(-2)) || 240;
      startScenarioSpriteVerticalShake(
        player.scene.sprites,
        slot,
        amplitudeY,
        periodMs,
        (event.intArgs[1] ?? 0) / 10,
      );
    }
    player.safeState.sceneSpriteSlot = slot;
    player.safeState.sceneSpriteMotionCount =
      player.scene.sprites.motions.size + player.scene.sprites.controlMotions.size;
    player.safeState.sceneObjectMotionCount =
      player.scene.sprites.sceneObjectMotions?.size ?? 0;
    startVisualAnimation(player);
    return 0;
  }
  if (event.opcode === GRAPH_SPRITE_SHAKE_STOP) {
    stopScenarioSceneObjectMotion(player.scene.sprites, sceneObjectId(event));
    stopScenarioSpriteMotion(player.scene.sprites, spriteSlot(event));
    player.safeState.sceneSpriteMotionCount =
      player.scene.sprites.motions.size + player.scene.sprites.controlMotions.size;
    player.safeState.sceneObjectMotionCount =
      player.scene.sprites.sceneObjectMotions?.size ?? 0;
    return 0;
  }
  if (event.opcode === GRAPH_SCENE_OBJECT_MOTION_START) {
    const id = sceneObjectId(event);
    const accepted = startScenarioSceneObjectDirectionalMotion(
      player.scene.sprites,
      id,
      event.intArgs,
    );
    if (accepted) {
      startVisualAnimation(player);
    } else {
      startScenarioSpriteVerticalShake(
        player.scene.sprites,
        spriteSlot(event),
        Math.abs(event.intArgs.at(-3) ?? 0),
        positiveDuration(event.intArgs.at(-2)) || 240,
        (event.intArgs[1] ?? 0) / 10,
      );
      startVisualAnimation(player);
    }
    player.safeState.sceneObjectId = id;
    player.safeState.sceneObjectMotionCount =
      player.scene.sprites.sceneObjectMotions?.size ?? 0;
    player.safeState.sceneSpriteMotionCount =
      player.scene.sprites.motions.size + player.scene.sprites.controlMotions.size;
    return 0;
  }
  if (event.opcode === GRAPH_SCENE_OBJECT_MOTION_STOP) {
    const id = sceneObjectId(event);
    const stoppedObject = stopScenarioSceneObjectMotion(player.scene.sprites, id);
    const stoppedSprite = stopScenarioSpriteMotion(player.scene.sprites, spriteSlot(event));
    player.safeState.sceneObjectId = id;
    player.safeState.sceneObjectMotionCount =
      player.scene.sprites.sceneObjectMotions?.size ?? 0;
    player.safeState.sceneSpriteMotionCount =
      player.scene.sprites.motions.size + player.scene.sprites.controlMotions.size;
    player.safeState.sceneObjectMotionStopped = Number(stoppedObject || stoppedSprite);
    return 0;
  }
  if (event.opcode === GRAPH_CONTROL_SPRITE) {
    const spriteId = event.intArgs.at(-1) ?? 0;
    const motionCount = event.intArgs[1] ?? 0;
    if (motionCount <= 0) {
      stopScenarioSpriteControlMotion(player.scene.sprites, spriteId);
    } else {
      const bytes = event.arrayArgs?.[0]?.bytes ?? new Uint8Array();
      beginScenarioSpriteControlMotion(
        player.scene.sprites,
        spriteId,
        event.intArgs[0] ?? 1,
        bytes,
      );
      startVisualAnimation(player);
    }
    player.safeState.sceneSpriteSlot = spriteId >= 32 ? spriteId - 32 : spriteId;
    player.safeState.sceneSpriteMotionCount =
      player.scene.sprites.motions.size + player.scene.sprites.controlMotions.size;
    return 0;
  }
  if (event.opcode === GRAPH_SET_BACKGROUND_BASE) {
    const name = event.stringArgs.at(-1) ?? "";
    const image = await loadScenarioImage(player, catalog, core, name);
    setSceneBaseImage(player, image, name);
    player.safeState.sceneAssetReady = Number(image !== null);
    player.safeState.sceneAssetNameLength = name.length;
    player.safeState.sceneTransitionMapReady = 0;
    player.safeState.sceneTransitionMapNameLength = 0;
    player.safeState.sceneTransitionMs = 0;
    return 0;
  }
  const durationMs = positiveDuration(event.intArgs[0]);
  if (event.opcode === GRAPH_SHOW || event.opcode === GRAPH_SHOW_WITH_MAP) {
    const name = event.stringArgs.at(-1) ?? "";
    const mapName = event.opcode === GRAPH_SHOW_WITH_MAP
      ? event.stringArgs.at(-2) ?? ""
      : "";
    const [image, mapImage] = await Promise.all([
      loadScenarioImage(player, catalog, core, name),
      mapName ? loadScenarioImage(player, catalog, core, mapName) : null,
    ]);
    beginSceneTransition(player, image, durationMs, name, {
      mapImage,
      mapName,
    });
    player.safeState.sceneAssetReady = Number(image !== null);
    player.safeState.sceneAssetNameLength = name.length;
    player.safeState.sceneTransitionMapReady = Number(mapImage !== null);
    player.safeState.sceneTransitionMapNameLength = mapName.length;
    player.safeState.sceneTransitionMs = durationMs;
    return durationMs;
  }
  if (event.opcode === GRAPH_FADE_TO_BLACK) {
    beginSceneTransition(player, null, durationMs, null);
    player.safeState.sceneAssetReady = 0;
    player.safeState.sceneAssetNameLength = 0;
    player.safeState.sceneTransitionMs = durationMs;
    return durationMs;
  }
  if (event.opcode === GRAPH_FADE_TO_BLACK_WITH_MAP) {
    const mapName = event.stringArgs.at(-1) ?? "";
    const mapImage = await loadScenarioImage(player, catalog, core, mapName);
    beginSceneTransition(player, null, durationMs, null, {
      mapImage,
      mapName,
      fadeSceneObjects: false,
    });
    player.safeState.sceneAssetReady = 0;
    player.safeState.sceneAssetNameLength = 0;
    player.safeState.sceneTransitionMapReady = Number(mapImage !== null);
    player.safeState.sceneTransitionMapNameLength = mapName.length;
    player.safeState.sceneTransitionMs = durationMs;
    return durationMs;
  }
  if (event.opcode === GRAPH_BANK_SPRITE) {
    const name = event.stringArgs.at(-1) ?? "";
    const spriteDurationMs = positiveDuration(event.intArgs[2]);
    player.safeState.sceneBankSpriteMs = spriteDurationMs;
    player.safeState.sceneBankSpriteNameLength = name.length;
    return applySpriteImageEvent(player, catalog, core, event, spriteDurationMs);
  }
  if (event.opcode === GRAPH_SHOW_SPRITE) {
    return applySpriteDrawEvent(player, catalog, core, event);
  }
  if (event.opcode === GRAPH_REPLACE_SPRITE) {
    return applySpriteReplaceEvent(player, catalog, core, event);
  }
  if (
    event.opcode === GRAPH_UPDATE_SPRITE
    || event.opcode === GRAPH_UPDATE_SPRITE_EX
  ) {
    return applySpriteUpdateEvent(player, catalog, core, event);
  }
  if (event.opcode === GRAPH_REMOVE_SPRITE) {
    const duration = positiveDuration(event.intArgs[2]);
    const slot = spriteSlot(event);
    removeScenarioSpriteLayer(player.scene.sprites, slot, duration, {
      alpha: scenarioSpriteAlpha(event.intArgs[3]),
      ...spriteTransitionOptions(event),
      x: scenarioSpriteCoordinate(event.intArgs[6]),
      y: scenarioSpriteCoordinate(event.intArgs[5]),
      z: scenarioSpriteCoordinate(event.intArgs[4]),
    });
    recordSpriteEvent(player, event);
    startNonblockingSpriteTransition(player, event, duration);
    return spriteWaitDuration(event, duration);
  }
  if (event.opcode === GRAPH_BANK_SPRITE_WITH_MAP) {
    return applyMappedSpriteImageEvent(player, catalog, core, event);
  }
  if (event.opcode === GRAPH_TERMINATE_BANKED_SPRITE) {
    player.safeState.sceneBankSpriteTerminations =
      (player.safeState.sceneBankSpriteTerminations ?? 0) + 1;
    return 0;
  }
  if (event.opcode === GRAPH_DRAW_SCENE_OBJECT) {
    const name = event.stringArgs.at(-1) ?? "";
    const image = await loadScenarioImage(player, catalog, core, name);
    const id = sceneObjectId(event);
    clearScenarioMovieObject(player.scene.movies, id);
    const duration = positiveDuration(event.intArgs[1]);
    const targetAlpha = scenarioSceneObjectAlpha(event.intArgs[3]);
    const transform = sceneObjectDrawTransform(event);
    if (image !== null) {
      setScenarioSceneObject(player.scene.sprites, id, image, {
        assetName: name,
        alpha: duration > 0 ? 0 : targetAlpha,
        priority: event.intArgs[2] ?? 0,
        ...transform,
      });
      if (duration > 0) {
        moveScenarioSceneObject(
          player.scene.sprites,
          id,
          {
            alpha: targetAlpha,
            z: transform.z,
            y: transform.y,
            x: transform.x,
          },
          duration,
          { blocking: (event.intArgs[0] ?? 0) !== 0 },
        );
        startVisualAnimation(player);
      }
    }
    recordSceneObjectEvent(player, event, image !== null);
    return sceneObjectWaitDuration(event);
  }
  if (event.opcode === GRAPH_DRAW_MOVIE_OBJECT) {
    return applyMovieSceneObjectEvent(player, catalog, core, event);
  }
  if (event.opcode === GRAPH_ANIMATE_SCENE_OBJECT) {
    const name = event.stringArgs.at(-1) ?? "";
    const image = await loadScenarioImage(player, catalog, core, name);
    const id = sceneObjectId(event);
    clearScenarioMovieObject(player.scene.movies, id);
    const frameCount = event.intArgs[16] ?? 0;
    const frameIntervalMs = positiveDuration(event.intArgs[15]);
    const sequenceStyle = event.intArgs[14] ?? -1;
    const animationReady = (
      image !== null
      && frameCount >= 2
      && frameCount <= 32
      && frameIntervalMs > 0
      && image.width % frameCount === 0
      && sequenceStyle >= 0
      && sequenceStyle <= 3
    );
    if (animationReady) {
      setScenarioSceneObject(player.scene.sprites, id, image, {
        assetName: name,
        alpha: scenarioSceneObjectAlpha(event.intArgs[3]),
        priority: event.intArgs[2] ?? 0,
        anchorY: event.intArgs[8] ?? 0,
        anchorX: event.intArgs[9] ?? 0,
        z: event.intArgs[10] ?? 0,
        y: event.intArgs[11] ?? 0,
        x: event.intArgs[12] ?? 0,
        animation: { frameCount, frameIntervalMs, sequenceStyle },
      });
      startVisualAnimation(player);
    }
    recordSceneObjectEvent(player, event, animationReady);
    return sceneObjectWaitDuration(event);
  }
  if (event.opcode === GRAPH_MOVE_SCENE_OBJECT) {
    const duration = positiveDuration(event.intArgs[1]);
    const accepted = moveScenarioSceneObject(
      player.scene.sprites,
      sceneObjectId(event),
      {
        z: event.intArgs[6] ?? 0,
        y: event.intArgs[7] ?? 0,
        x: event.intArgs[8] ?? 0,
        alpha: scenarioSceneObjectAlpha(event.intArgs[4]),
      },
      duration,
      { blocking: (event.intArgs[0] ?? 0) !== 0 },
    );
    if (accepted && duration > 0) {
      startVisualAnimation(player);
    }
    recordSceneObjectEvent(player, event, accepted);
    return sceneObjectWaitDuration(event);
  }
  if (event.opcode === GRAPH_FADE_SCENE_OBJECT) {
    const duration = positiveDuration(event.intArgs[1]);
    const accepted = fadeScenarioSceneObject(
      player.scene.sprites,
      sceneObjectId(event),
      duration,
      { blocking: (event.intArgs[0] ?? 0) !== 0 },
    );
    if (accepted && duration > 0) {
      startVisualAnimation(player);
    }
    recordSceneObjectEvent(player, event, accepted);
    return sceneObjectWaitDuration(event);
  }
  if (event.opcode === GRAPH_APERTURE_CONFIGURE) {
    const duration = positiveDuration(event.intArgs[1]);
    const target = configureScenarioAperture(player.scene.aperture, event.intArgs);
    beginScenarioAperture(player.scene.aperture, target, duration);
    recordApertureEvent(player, duration);
    return event.intArgs[0] === 1 ? duration : 0;
  }
  if (event.opcode === GRAPH_APERTURE_BAND) {
    const duration = positiveDuration(event.intArgs[1]);
    const target = configureScenarioApertureBand(player.scene.aperture, event.intArgs);
    beginScenarioAperture(player.scene.aperture, target, duration);
    recordApertureEvent(player, duration);
    return event.intArgs[0] === 1 ? duration : 0;
  }
  if (event.opcode === GRAPH_APERTURE_START) {
    const duration = positiveDuration(event.intArgs[1]);
    beginPendingScenarioAperture(player.scene.aperture, duration);
    recordApertureEvent(player, duration);
    return event.intArgs[0] === 1 ? duration : 0;
  }
  if (event.opcode === GRAPH_APERTURE_CLEAR) {
    const duration = positiveDuration(event.intArgs[1]);
    clearScenarioAperture(player.scene.aperture, duration);
    recordApertureEvent(player, duration);
    return event.intArgs[0] === 1 ? duration : 0;
  }
  if (event.opcode === GRAPH_RAIN_COLOR) {
    setScenarioRainColor(player.scene.rain, event.intArgs);
    recordRainEvent(player);
    return 0;
  }
  if (event.opcode === GRAPH_RAIN_MOTION) {
    setScenarioRainMotion(player.scene.rain, event.intArgs);
    recordRainEvent(player);
    if (hasActiveScenarioRain(player.scene.rain)) {
      startVisualAnimation(player);
    }
    return 0;
  }
  if (event.opcode === GRAPH_RAIN_FADE) {
    setScenarioRainFade(player.scene.rain, event.intArgs);
    recordRainEvent(player);
    return 0;
  }
  if (event.opcode === GRAPH_RAIN_DENSITY) {
    setScenarioRainDensity(player.scene.rain, event.intArgs);
    recordRainEvent(player);
    if (hasActiveScenarioRain(player.scene.rain)) {
      startVisualAnimation(player);
    }
    return 0;
  }
  if (event.opcode === GRAPH_RAIN_TOGGLE) {
    setScenarioRainActive(player.scene.rain, event.intArgs);
    recordRainEvent(player);
    if (hasActiveScenarioRain(player.scene.rain)) {
      startVisualAnimation(player);
    }
    return 0;
  }
  if (event.opcode === GRAPH_START_COLOR_FILTER) {
    const duration = beginScenarioColorFilter(player.scene.filter, event.intArgs);
    recordFilterEvent(player, event, duration);
    return duration;
  }
  if (event.opcode === GRAPH_CLEAR_COLOR_FILTER) {
    const duration = clearScenarioColorFilter(player.scene.filter, event.intArgs);
    recordFilterEvent(player, event, duration);
    return duration;
  }
  if (
    event.opcode >= GRAPH_PRESET_FILTER_FIRST
    && event.opcode <= GRAPH_PRESET_FILTER_LAST
  ) {
    const presetIndex = event.opcode - GRAPH_PRESET_FILTER_FIRST;
    const duration = beginScenarioPresetFilter(
      player.scene.filter,
      presetIndex,
      event.intArgs,
    );
    recordFilterEvent(
      player,
      event,
      duration,
      GRAPH_PRESET_FILTER_MODES[presetIndex],
      256,
    );
    return duration;
  }
  if (event.opcode === GRAPH_PRESET_SHAKE) {
    beginPresetScreenShake(player, event);
    startVisualAnimation(player);
    return 0;
  }
  return 0;
}

async function applyMovieSceneObjectEvent(player, catalog, core, event) {
  const archiveName = event.stringArgs.at(-1) ?? "";
  const maskName = movieSceneObjectMaskName(event);
  const archivePayload = validArchiveName(archiveName)
    ? await catalog.readArchivePayloadByNameBytes(encoder.encode(archiveName))
    : null;
  const moviePayload = readFirstArc20EntryPayloadByExtension(archivePayload, ".mpg");
  const maskImage = maskName ? await loadScenarioImage(player, catalog, core, maskName) : null;
  const id = sceneObjectId(event);
  clearScenarioMovieObject(player.scene.movies, id);
  const image = moviePayload === null
    ? null
    : setScenarioMovieObject(player.scene.movies, id, moviePayload);
  const durationMs = positiveDuration(event.intArgs[1]);
  const transform = movieSceneObjectTransform(event);
  const targetAlpha = movieSceneObjectAlpha(event.intArgs[3]);
  if (image !== null) {
    setScenarioSceneObject(player.scene.sprites, id, image, {
      assetName: archiveName,
      alpha: durationMs > 0 ? 0 : targetAlpha,
      priority: event.intArgs[2] ?? 0,
      blendMode: transform.blendMode,
      isMovie: true,
      maskAssetName: maskName,
      maskImage,
      x: transform.x,
      y: transform.y,
      z: transform.z,
    });
    if (durationMs > 0) {
      moveScenarioSceneObject(
        player.scene.sprites,
        id,
        { ...transform, alpha: targetAlpha },
        durationMs,
        { blocking: (event.intArgs[0] ?? 0) !== 0 },
      );
    }
    startVisualAnimation(player);
  }
  player.safeState.sceneMovieCount = player.scene.movies.objects.size;
  player.safeState.sceneMovieArchiveNameLength = archiveName.length;
  player.safeState.sceneMovieMaskNameLength = maskName.length;
  player.safeState.sceneMovieMaskReady = maskName && maskImage ? 1 : 0;
  player.safeState.sceneMovieFrameRate = image === null
    ? 0
    : Math.round(player.scene.movies.objects.get(id)?.frameRate ?? 0);
  recordSceneObjectEvent(player, event, image !== null);
  return sceneObjectWaitDuration(event);
}

async function applySpriteImageEvent(player, catalog, core, event, durationMs) {
  const name = event.stringArgs.at(-1) ?? "";
  const image = await loadScenarioImage(player, catalog, core, name);
  const slot = spriteSlot(event);
  const transform = event.opcode === GRAPH_BANK_SPRITE
    ? bankedSpriteTransform(event)
    : {};
  beginScenarioSpriteTransition(player.scene.sprites, slot, image, durationMs, {
    ...transform,
    alpha: 1,
    assetName: name,
    ...spriteTransitionOptions(event),
  });
  recordSpriteEvent(player, event);
  player.safeState.sceneAssetReady = Number(image !== null);
  player.safeState.sceneAssetNameLength = name.length;
  startNonblockingSpriteTransition(player, event, durationMs);
  return spriteWaitDuration(event, durationMs);
}

async function applyMappedSpriteImageEvent(player, catalog, core, event) {
  const durationMs = positiveDuration(event.intArgs[2]);
  const mapName = event.stringArgs.at(-2) ?? "";
  const name = event.stringArgs.at(-1) ?? "";
  const [image, mapImage] = await Promise.all([
    loadScenarioImage(player, catalog, core, name),
    loadScenarioImage(player, catalog, core, mapName),
  ]);
  beginScenarioSpriteTransition(
    player.scene.sprites,
    spriteSlot(event),
    image,
    durationMs,
    {
      ...mappedBankedSpriteTransform(event),
      alpha: 1,
      assetName: name,
      mapAssetName: mapName,
      mapImage,
      ...spriteTransitionOptions(event),
    },
  );
  recordSpriteEvent(player, event);
  player.safeState.sceneAssetReady = Number(image !== null);
  player.safeState.sceneAssetNameLength = name.length;
  player.safeState.sceneTransitionMapReady = Number(mapImage !== null);
  player.safeState.sceneTransitionMapNameLength = mapName.length;
  startNonblockingSpriteTransition(player, event, durationMs);
  return spriteWaitDuration(event, durationMs);
}

async function applySpriteDrawEvent(player, catalog, core, event) {
  const durationMs = positiveDuration(event.intArgs[2]);
  const name = event.stringArgs.at(-1);
  const transform = {
    alpha: scenarioSpriteAlpha(event.intArgs[3]),
    ...spriteTransitionOptions(event),
    x: scenarioSpriteCoordinate(event.intArgs[6]),
    y: scenarioSpriteCoordinate(event.intArgs[5]),
    z: scenarioSpriteCoordinate(event.intArgs[4]),
  };
  if (name === undefined) {
    updateScenarioSpriteLayer(
      player.scene.sprites,
      spriteSlot(event),
      durationMs,
      transform,
    );
    recordSpriteEvent(player, event);
    startNonblockingSpriteTransition(player, event, durationMs);
    return spriteWaitDuration(event, durationMs);
  }
  const image = await loadScenarioImage(player, catalog, core, name);
  beginScenarioSpriteTransition(
    player.scene.sprites,
    spriteSlot(event),
    image,
    durationMs,
    {
      ...transform,
      assetName: name,
    },
  );
  recordSpriteEvent(player, event);
  player.safeState.sceneAssetReady = Number(image !== null);
  player.safeState.sceneAssetNameLength = name.length;
  startNonblockingSpriteTransition(player, event, durationMs);
  return spriteWaitDuration(event, durationMs);
}

async function applySpriteReplaceEvent(player, catalog, core, event) {
  const durationMs = positiveDuration(event.intArgs[2]);
  const name = event.stringArgs.at(-1) ?? "";
  const image = await loadScenarioImage(player, catalog, core, name);
  if (image !== null) {
    updateScenarioSpriteLayer(
      player.scene.sprites,
      spriteSlot(event),
      durationMs,
      { image, assetName: name, ...spriteTransitionOptions(event) },
    );
  }
  recordSpriteEvent(player, event);
  player.safeState.sceneAssetReady = Number(image !== null);
  player.safeState.sceneAssetNameLength = name.length;
  startNonblockingSpriteTransition(player, event, durationMs);
  return spriteWaitDuration(event, durationMs);
}

async function applySpriteUpdateEvent(player, catalog, core, event) {
  const durationMs = positiveDuration(event.intArgs[2]);
  const name = event.stringArgs.at(-1);
  const image = name === undefined
    ? undefined
    : await loadScenarioImage(player, catalog, core, name);
  if (name !== undefined && image === null) {
    recordSpriteEvent(player, event);
    return spriteWaitDuration(event, durationMs);
  }
  updateScenarioSpriteLayer(player.scene.sprites, spriteSlot(event), durationMs, {
    image,
    assetName: name,
    alpha: scenarioSpriteAlpha(event.intArgs[3]),
    ...spriteTransitionOptions(event),
    x: scenarioSpriteCoordinate(event.intArgs[6]),
    y: scenarioSpriteCoordinate(event.intArgs[5]),
    z: scenarioSpriteCoordinate(event.intArgs[4]),
  });
  recordSpriteEvent(player, event);
  if (name !== undefined) {
    player.safeState.sceneAssetReady = 1;
    player.safeState.sceneAssetNameLength = name.length;
  }
  startNonblockingSpriteTransition(player, event, durationMs);
  return spriteWaitDuration(event, durationMs);
}

function mappedBankedSpriteTransform(event) {
  const useAlternate = (event.intArgs[9] ?? 0) !== 0;
  return {
    priority: event.intArgs[3] ?? 0,
    x: scenarioSpriteCoordinate(event.intArgs[useAlternate ? 11 : 8]),
    y: scenarioSpriteCoordinate(event.intArgs[useAlternate ? 10 : 7]),
    z: scenarioSpriteCoordinate(event.intArgs[6]),
  };
}

function bankedSpriteTransform(event) {
  const useAlternate = (event.intArgs[11] ?? 0) !== 0;
  return {
    priority: event.intArgs[3] ?? 0,
    x: scenarioSpriteCoordinate(event.intArgs[useAlternate ? 10 : 14]),
    y: scenarioSpriteCoordinate(event.intArgs[useAlternate ? 9 : 13]),
    z: scenarioSpriteCoordinate(event.intArgs[useAlternate ? 8 : 12]),
  };
}

function spriteTransitionOptions(event) {
  return {
    blocking: spriteWaits(event),
    eventCount: event.eventCount ?? 0,
    opcode: event.opcode ?? 0,
  };
}

function spriteWaits(event) {
  return (event.intArgs[1] ?? 0) !== 0;
}

function spriteWaitDuration(event, durationMs) {
  return spriteWaits(event) ? durationMs : 0;
}

function startNonblockingSpriteTransition(player, event, durationMs) {
  if (durationMs > 0 && !spriteWaits(event)) {
    startVisualAnimation(player);
  }
}

function scenarioSpriteAlpha(transparency) {
  return Number.isInteger(transparency) && transparency >= 0 && transparency <= 256
    ? 1 - transparency / 256
    : undefined;
}

function scenarioSpriteCoordinate(value) {
  return Number.isInteger(value) && value !== -2_147_483_647
    ? value
    : undefined;
}

function recordSpriteEvent(player, event) {
  player.safeState.sceneSpriteOpcode = event.opcode;
  player.safeState.sceneSpriteEventCount = event.eventCount;
  player.safeState.sceneSpriteSlot = spriteSlot(event);
  player.safeState.sceneSpriteTransitions = (player.safeState.sceneSpriteTransitions ?? 0) + 1;
  player.safeState.sceneSpriteCount = new Set([
    ...player.scene.sprites.layers.keys(),
    ...player.scene.sprites.transitions.keys(),
  ]).size;
}

function spriteSlot(event) {
  const value = event.intArgs.at(-1);
  return Number.isInteger(value) ? Math.max(0, Math.min(value, 31)) : 0;
}

function sceneObjectId(event) {
  const value = event.intArgs.at(-1);
  return Number.isInteger(value) ? Math.max(0, Math.min(value, 255)) : 0;
}

function sceneObjectWaitDuration(event) {
  return (event.intArgs[0] ?? 0) === 0
    ? 0
    : positiveDuration(event.intArgs[1]);
}

function sceneObjectDrawTransform(event) {
  const ints = event.intArgs;
  const length = ints.length;
  let anchorY = 0;
  let anchorX = 0;
  if (length >= 17 && ints[9] === 1 && ints[11] === 1) {
    anchorY = (ints[8] ?? 0) / 2;
    anchorX = (ints[10] ?? 0) / 2;
  } else if (length === 16 && ints[9] === 1) {
    anchorY = (ints[8] ?? 0) / 2;
    anchorX = ints[10] ?? 0;
  } else if (length >= 15) {
    anchorY = ints[8] ?? 0;
    anchorX = ints[9] ?? 0;
  }
  return {
    anchorY,
    anchorX,
    z: ints.at(-5) ?? 0,
    y: ints.at(-4) ?? 0,
    x: ints.at(-3) ?? 0,
  };
}

function movieSceneObjectTransform(event) {
  const hasMaskName = event.stringArgs.length > 1;
  return {
    anchorY: 0,
    anchorX: 0,
    z: event.intArgs.at(hasMaskName ? -5 : -6) ?? 0,
    y: event.intArgs.at(hasMaskName ? -4 : -5) ?? 0,
    x: event.intArgs.at(hasMaskName ? -3 : -4) ?? 0,
    blendMode: event.intArgs.at(-2) ?? 0,
  };
}

function movieSceneObjectMaskName(event) {
  const name = event.stringArgs.length > 1 ? event.stringArgs[0] : "";
  return validAssetName(name) ? name : "";
}

function movieSceneObjectAlpha(opacity) {
  const value = Number.isFinite(opacity)
    ? Math.max(0, Math.min(opacity, 256))
    : 0;
  return value / 256;
}

function scenarioSceneObjectAlpha(transparency) {
  const value = Number.isFinite(transparency)
    ? Math.max(0, Math.min(transparency, 256))
    : 0;
  return 1 - value / 256;
}

function recordSceneObjectEvent(player, event, ready) {
  player.safeState.sceneObjectId = sceneObjectId(event);
  player.safeState.sceneObjectCount = player.scene.sprites.sceneObjects.size;
  player.safeState.sceneObjectAssetReady = Number(ready);
  player.safeState.sceneObjectEventCount = event.eventCount ?? 0;
}

function recordFilterEvent(
  player,
  event,
  durationMs,
  mode = event.intArgs[7] ?? 0,
  strength = event.intArgs[6] ?? 0,
) {
  player.safeState.sceneFilterCount = (player.safeState.sceneFilterCount ?? 0) + 1;
  player.safeState.sceneFilterDurationMs = durationMs;
  player.safeState.sceneFilterMode = mode;
  player.safeState.sceneFilterStrength = strength;
}

function recordApertureEvent(player, durationMs) {
  player.safeState.sceneApertureCount = (player.safeState.sceneApertureCount ?? 0) + 1;
  player.safeState.sceneApertureDurationMs = durationMs;
}

function recordRainEvent(player) {
  const rain = player.scene.rain;
  player.safeState.sceneRainCount = (player.safeState.sceneRainCount ?? 0) + 1;
  player.safeState.sceneRainActive = Number(hasActiveScenarioRain(rain));
  player.safeState.sceneRainDensity = rain.density;
  player.safeState.sceneRainSpeed = rain.speed;
  player.safeState.sceneRainAngle = rain.angleDeg;
  player.safeState.sceneRainAlpha = Math.round(rain.alpha * 255);
}

function beginScreenShake(player, event) {
  const durationMs = positiveDuration(event.intArgs.at(-1)) || 240;
  const amplitudeX = Math.max(0, Math.min(Math.abs(event.intArgs[3] ?? event.intArgs[1] ?? 8), 64));
  const amplitudeY = Math.max(0, Math.min(Math.abs(event.intArgs[4] ?? event.intArgs[2] ?? amplitudeX), 64));
  player.scene.shake = {
    startedAt: performance.now(),
    durationMs,
    amplitudeX,
    amplitudeY,
    phase: (event.offset % 97) / 97,
  };
  player.safeState.sceneShakeMs = durationMs;
  player.safeState.sceneShakeAmplitudeX = amplitudeX;
  player.safeState.sceneShakeAmplitudeY = amplitudeY;
}

function beginPresetScreenShake(player, event) {
  player.scene.shake = createPresetScenarioShake(
    event.intArgs[0] ?? 0,
    event.intArgs[1] ?? 0,
    performance.now(),
  );
  const shake = player.scene.shake;
  player.safeState.scenePresetShakeCount = (player.safeState.scenePresetShakeCount ?? 0) + 1;
  player.safeState.sceneShakeMs = shake.durationMs;
  player.safeState.sceneShakeDirection = shake.direction;
  player.safeState.sceneShakeStrengthIndex = shake.strengthIndex;
  player.safeState.sceneShakePeriodMs = shake.periodMs;
  player.safeState.sceneShakeCycles = shake.cycles;
  player.safeState.sceneShakeDecayPercent = shake.decayPercent;
  player.safeState.sceneShakeAmplitudeX = Math.round(Math.abs(shake.amplitude * shake.vectorX));
  player.safeState.sceneShakeAmplitudeY = Math.round(Math.abs(shake.amplitude * shake.vectorY));
}

async function loadScenarioImage(player, catalog, core, name) {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    player.safeState.sceneAssetErrors += 1;
    return null;
  }
  const pending = boundedCacheValue(
    player.imageCache,
    name,
    SCENARIO_IMAGE_CACHE_LIMIT,
    async () => {
      if (name.toLowerCase() === "white") {
        return solidColorImage(1280, 720, 255, 255, 255, 255);
      }
      if (name.toLowerCase() === "black") {
        return solidColorImage(1280, 720, 0, 0, 0, 255);
      }
      const payload = await catalog.readPayloadByNameBytes(encoder.encode(name));
      return payload ? core.imageRgba(payload) : null;
    },
  );
  try {
    const image = await pending;
    if (!image) {
      player.safeState.sceneAssetErrors += 1;
    }
    return image;
  } catch {
    player.safeState.sceneAssetErrors += 1;
    return null;
  }
}

function boundedCacheValue(cache, key, limit, factory) {
  if (cache.has(key)) {
    const value = cache.get(key);
    cache.delete(key);
    cache.set(key, value);
    return value;
  }
  const pending = Promise.resolve().then(factory);
  cache.set(key, pending);
  while (cache.size > limit) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  void pending.catch(() => {
    if (cache.get(key) === pending) {
      cache.delete(key);
    }
  });
  return pending;
}

function solidColorImage(width, height, red, green, blue, alpha) {
  const pixels = new Uint8Array(width * height * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = red;
    pixels[offset + 1] = green;
    pixels[offset + 2] = blue;
    pixels[offset + 3] = alpha;
  }
  return { width, height, pixels };
}

function setSceneBaseImage(player, image, name) {
  player.scene.current = image;
  player.scene.currentName = image === null ? null : name;
  player.scene.target = null;
  player.scene.targetName = null;
  player.scene.progress = 1;
  player.scene.transitionMap = null;
  player.scene.transitionMapName = null;
  player.scene.transitioning = false;
}

function beginSceneTransition(
  player,
  target,
  durationMs,
  targetName,
  {
    mapImage = null,
    mapName = null,
    fadeSceneObjects = true,
    removeSceneObjects = true,
  } = {},
) {
  if (removeSceneObjects) {
    beginScenarioBackgroundObjectRemoval(
      player.scene.sprites,
      durationMs,
      { fade: fadeSceneObjects },
    );
  }
  if (durationMs === 0) {
    player.scene.current = target;
    player.scene.currentName = targetName;
    player.scene.target = null;
    player.scene.targetName = null;
    player.scene.progress = 1;
    player.scene.transitionMap = null;
    player.scene.transitionMapName = null;
    player.scene.transitioning = false;
    return;
  }
  player.scene.target = target;
  player.scene.targetName = targetName;
  player.scene.progress = 0;
  player.scene.transitionMap = mapImage;
  player.scene.transitionMapName = mapImage ? mapName : null;
  player.scene.transitioning = true;
}

function finishSceneTransition(player) {
  if (player.scene.transitioning) {
    player.scene.current = player.scene.target;
    player.scene.currentName = player.scene.targetName;
    player.scene.target = null;
    player.scene.targetName = null;
    player.scene.progress = 1;
    player.scene.transitionMap = null;
    player.scene.transitionMapName = null;
    player.scene.transitioning = false;
  }
  finishScenarioSpriteTransitions(player.scene.sprites);
  finishScenarioFilterTransition(player.scene.filter);
  finishScenarioApertureTransition(player.scene.aperture);
  player.safeState.sceneSpriteCount = player.scene.sprites.layers.size;
  player.safeState.sceneObjectCount = player.scene.sprites.sceneObjects.size;
}

function waitForAutomaticEvent(
  player,
  durationMs,
  animateScene,
  waitUntil = null,
  animateMessage = false,
) {
  if ((durationMs === 0 && waitUntil === null) || player.automaticSkip) {
    if (animateScene) {
      player.scene.progress = 1;
    }
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const startedAt = performance.now();
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      player.automaticWake = null;
      if (player.automaticFrame !== 0) {
        cancelAnimationFrame(player.automaticFrame);
        player.automaticFrame = 0;
      }
      if (animateScene) {
        player.scene.progress = 1;
      }
      notifyAutomaticUpdate(player);
      resolve();
    };
    const frame = (now) => {
      if (player.destroyed || player.automaticSkip) {
        finish();
        return;
      }
      const progress = Math.min(1, (now - startedAt) / durationMs);
      const animateShake = scenarioScreenOffset(player).active;
      if (animateScene) {
        player.scene.progress = progress;
        setScenarioSpriteProgress(player.scene.sprites, progress);
        setScenarioFilterProgress(player.scene.filter, progress);
        setScenarioApertureProgress(player.scene.aperture, progress);
      }
      if (animateScene || animateShake || animateMessage) {
        notifyAutomaticUpdate(player);
      }
      if (progress >= 1) {
        finish();
        return;
      }
      player.automaticFrame = requestAnimationFrame(frame);
    };
    player.automaticWake = finish;
    if (durationMs > 0) {
      player.automaticFrame = requestAnimationFrame(frame);
    }
    if (waitUntil !== null) {
      Promise.resolve(waitUntil).then(finish, finish);
    }
  });
}

function notifyAutomaticUpdate(player) {
  player.safeState.eventKind = player.event.kind;
  player.safeState.eventCount = player.event.eventCount ?? player.safeState.eventCount;
  player.automaticUpdate?.();
}

// Auto/Skip delay after a message is fully revealed before advancing. Skip is
// near-instant; Auto waits a readable beat (plus voice if one is playing).
const AUTO_ADVANCE_DELAY_MS = 1500;
const SKIP_ADVANCE_DELAY_MS = 40;

// rAF driver that advances messages while Auto or Skip mode is active. It only
// touches EVENT_MESSAGE states; automatic (graph/wait/sound) events are driven
// by runAutomaticEvents, which Skip accelerates via automaticSkip. A choice
// stops both modes (the player must decide).
function startMessageAutoAdvance(player) {
  if (player.messageAdvanceFrame !== 0 || player.destroyed) {
    return;
  }
  const frame = () => {
    if (player.destroyed || (!player.autoMode && !player.skipMode)) {
      player.messageAdvanceFrame = 0;
      return;
    }
    if (player.backlogState.open) {
      player.messageAdvanceFrame = requestAnimationFrame(frame);
      return;
    }
    if (player.event.kind === EVENT_CHOICE) {
      // Never auto-pick a choice; leave the modes on but idle until resolved.
      player.messageAdvanceFrame = requestAnimationFrame(frame);
      return;
    }
    if (player.skipMode) {
      // Skip: collapse reveal, accelerate auto-events, advance messages ASAP.
      if (isScenarioMessageRevealing(player.messageVisual)) {
        completeScenarioMessageReveal(player.messageVisual);
      }
      if (isAutomaticEvent(player.event)) {
        player.skipAutomatic();
      } else if (player.event.kind === EVENT_MESSAGE) {
        maybeAutoAdvanceMessage(player, SKIP_ADVANCE_DELAY_MS);
      }
    } else if (player.autoMode) {
      if (player.event.kind === EVENT_MESSAGE
        && !isScenarioMessageRevealing(player.messageVisual)) {
        maybeAutoAdvanceMessage(player, autoDelayForMessage(player));
      } else if (isScenarioMessageRevealing(player.messageVisual)) {
        player.autoAdvanceAt = 0;
      }
    }
    player.messageAdvanceFrame = requestAnimationFrame(frame);
  };
  player.messageAdvanceFrame = requestAnimationFrame(frame);
}

// Auto-mode delay for the current message; extends to cover an active voice clip.
function autoDelayForMessage(player) {
  const base = player.autoAdvanceDelayMs ?? AUTO_ADVANCE_DELAY_MS;
  const voiceMs = player.audioMixer?.activeVoiceRemainingMs?.() ?? 0;
  return Math.max(base, voiceMs);
}

// Advance the current message once its post-reveal delay has elapsed.
function maybeAutoAdvanceMessage(player, delayMs) {
  const now = performance.now();
  if (player.autoAdvanceAt === 0) {
    player.autoAdvanceAt = now + delayMs;
    return;
  }
  if (now < player.autoAdvanceAt) {
    return;
  }
  player.autoAdvanceAt = 0;
  if (player.automaticRunning) {
    return;
  }
  if (player.advanceMessage() === 1 && player.step()) {
    player.autoAdvanceUpdate?.();
    player.startAutomatic(player.automaticUpdate);
  }
}

function startVisualAnimation(player) {
  if (player.visualFrame !== 0 || player.destroyed) {
    return;
  }
  const frame = () => {
    const shakeActive = scenarioScreenOffset(player).active;
    if (player.destroyed) {
      player.visualFrame = 0;
      return;
    }
    const spriteActive = hasActiveScenarioSpriteMotions(player.scene.sprites);
    const sceneObjectActive = hasActiveScenarioSceneObjectVisuals(player.scene.sprites);
    const movieActive = hasActiveScenarioMovies(player.scene.movies, player.scene.sprites);
    const rainActive = hasActiveScenarioRain(player.scene.rain);
    const revealActive = isScenarioMessageRevealing(player.messageVisual);
    const active = spriteActive || sceneObjectActive || movieActive || shakeActive
      || rainActive || revealActive;
    player.safeState.sceneObjectCount = player.scene.sprites.sceneObjects.size;
    player.safeState.sceneRainActive = Number(rainActive);
    notifyAutomaticUpdate(player);
    if (!active) {
      player.visualFrame = 0;
      return;
    }
    player.visualFrame = requestAnimationFrame(frame);
  };
  player.visualFrame = requestAnimationFrame(frame);
}

function positiveDuration(value) {
  return Number.isInteger(value) && value > 0 ? Math.min(value, 600_000) : 0;
}

function isAutomaticEvent(event) {
  return event?.kind === EVENT_GRAPH
    || event?.kind === EVENT_WAIT
    || event?.kind === EVENT_SOUND
    || event?.kind === EVENT_USER_FUNCTION
    || event?.kind === EVENT_MESSAGE_CONTROL;
}

function isStableSaveEvent(event) {
  return event?.kind === EVENT_MESSAGE || event?.kind === EVENT_CHOICE;
}

function cloneStableEvent(event) {
  return JSON.parse(JSON.stringify(event));
}

function parseSaveRecord(encoded, fallbackSequence, fallbackRoute) {
  let value;
  try {
    value = JSON.parse(encoded);
  } catch {
    return { ok: false, reason: "legacy_snapshot_unsupported" };
  }
  const hasSavedRoute = value?.version >= 9
    && typeof value.routeId === "string"
    && normalizeScenarioRoute(value.routeId) === value.routeId;
  const routeId = hasSavedRoute ? value.routeId : fallbackRoute;
  const hasSavedSequence = value?.version >= 11
    && isValidSavedScenarioSequence(value.scenarioSequence);
  const scenarioSequence = hasSavedSequence
    ? value.scenarioSequence
    : hasSavedRoute
    ? scenarioSequenceForRoute(routeId)
    : fallbackSequence;
  if (
    !value
    || !SUPPORTED_SAVE_RECORD_VERSIONS.has(value.version)
    || (value.version >= 9 && !hasSavedRoute)
    || (value.version >= 11 && !hasSavedSequence)
    || typeof value.scenarioName !== "string"
    || !/^[A-Za-z0-9_]+$/.test(value.scenarioName)
    || !Number.isInteger(value.scenarioIndex)
    || scenarioSequence[value.scenarioIndex] !== value.scenarioName
    || typeof value.snapshot !== "string"
    || !isValidSavedEvent(value.event)
    || !isValidSavedBacklog(value.backlog)
    || !isValidSavedVisual(value.visual, value.version)
  ) {
    return { ok: false, reason: "invalid_snapshot" };
  }
  let snapshot;
  try {
    snapshot = base64ToBytes(value.snapshot);
  } catch {
    return { ok: false, reason: "invalid_snapshot" };
  }
  if (snapshot.byteLength < 64 || snapshot.byteLength > 16 * 1024 * 1024) {
    return { ok: false, reason: "invalid_snapshot" };
  }
  return {
    ok: true,
    record: {
      routeId,
      scenarioSequence,
      scenarioName: value.scenarioName,
      scenarioIndex: value.scenarioIndex,
      snapshot,
      event: value.event,
      backlog: value.backlog,
      visual: value.visual,
    },
  };
}

function isValidSavedScenarioSequence(sequence) {
  return Array.isArray(sequence)
    && sequence.length >= 1
    && sequence.length <= 256
    && sequence.every((name) => typeof name === "string" && /^[A-Za-z0-9_]+$/.test(name));
}

function isValidSavedEvent(event) {
  if (!event || !isStableSaveEvent(event) || !Number.isInteger(event.mode)) {
    return false;
  }
  if (event.kind === EVENT_MESSAGE) {
    return event.mode === 2
      && typeof event.name === "string"
      && typeof event.text === "string"
      && event.name.length <= 1024
      && event.text.length <= 64 * 1024
      && Array.isArray(event.intArgs)
      && event.intArgs.length <= 256
      && event.intArgs.every(Number.isInteger);
  }
  return event.mode === 3
    && Array.isArray(event.options)
    && event.options.length > 0
    && event.options.length <= 128
    && event.options.every((option) => typeof option === "string" && option.length <= 4096)
    && Array.isArray(event.intArgs)
    && event.intArgs.length <= 256
    && event.intArgs.every(Number.isInteger);
}

function isValidSavedBacklog(backlog) {
  return Array.isArray(backlog)
    && backlog.length <= SCENARIO_BACKLOG_LIMIT
    && backlog.every((entry) => (
      entry
      && Number.isInteger(entry.eventCount)
      && entry.eventCount > 0
      && typeof entry.name === "string"
      && entry.name.length <= 1024
      && typeof entry.text === "string"
      && entry.text.length <= 64 * 1024
      && (
        entry.voiceName === undefined
        || (
          validAssetName(entry.voiceName)
          && Number.isFinite(entry.voiceVolume)
          && entry.voiceVolume >= 0
          && entry.voiceVolume <= 1
        )
      )
    ));
}

function isValidSavedVisual(visual, version = SAVE_RECORD_VERSION) {
  const motions = visual?.motions ?? [];
  const controlMotions = visual?.controlMotions ?? [];
  const spriteTransitions = visual?.spriteTransitions ?? [];
  const sceneObjects = visual?.sceneObjects ?? [];
  return visual
    && (visual.backgroundName === null || validAssetName(visual.backgroundName))
    && Array.isArray(visual.sprites)
    && visual.sprites.length <= 32
    && visual.sprites.every((sprite) => (
      sprite
      && Number.isInteger(sprite.slot)
      && sprite.slot >= 0
      && sprite.slot <= 31
      && validAssetName(sprite.assetName)
      && Number.isFinite(sprite.alpha)
      && sprite.alpha >= 0
      && sprite.alpha <= 1
      && (
        sprite.order === undefined
        || (
          Number.isInteger(sprite.order)
          && sprite.order >= 0
          && sprite.order <= 1_000_000
        )
      )
      && (
        sprite.priority === undefined
        || (
          Number.isInteger(sprite.priority)
          && sprite.priority >= 0
          && sprite.priority <= 128
        )
      )
      && (
        sprite.x === undefined
        || sprite.x === null
        || (Number.isFinite(sprite.x) && Math.abs(sprite.x) <= 100_000)
      )
      && (sprite.y === undefined || (Number.isFinite(sprite.y) && Math.abs(sprite.y) <= 100_000))
      && (sprite.z === undefined || (Number.isFinite(sprite.z) && Math.abs(sprite.z) <= 100_000))
    ))
    && Array.isArray(spriteTransitions)
    && spriteTransitions.length <= 32
    && spriteTransitions.every(isValidSavedSpriteTransition)
    && Array.isArray(motions)
    && motions.length <= 32
    && motions.every((motion) => (
      motion
      && Number.isInteger(motion.slot)
      && motion.slot >= 0
      && motion.slot <= 31
      && (
        motion.amplitudeX === undefined
        || (
          Number.isFinite(motion.amplitudeX)
          && Math.abs(motion.amplitudeX) <= 400
        )
      )
      && Number.isFinite(motion.amplitudeY)
      && motion.amplitudeY >= 0
      && motion.amplitudeY <= 400
      && Number.isFinite(motion.periodMs)
      && motion.periodMs >= 16
      && motion.periodMs <= 60_000
      && Number.isFinite(motion.phase)
      && (
        motion.directionMode === undefined
        || (
          Number.isInteger(motion.directionMode)
          && motion.directionMode >= 0
          && motion.directionMode <= 10
        )
      )
      && (
        motion.speed === undefined
        || (
          Number.isInteger(motion.speed)
          && motion.speed >= 0
          && motion.speed <= 256
        )
      )
    ))
    && Array.isArray(controlMotions)
    && controlMotions.length <= 32
    && controlMotions.every(isValidSavedControlMotion)
    && Array.isArray(sceneObjects)
    && sceneObjects.length <= 256
    && sceneObjects.every((object) => (
      object
      && Number.isInteger(object.id)
      && object.id >= 0
      && object.id <= 255
      && (
        object.isMovie === true
          ? validArchiveName(object.assetName)
          : validAssetName(object.assetName)
      )
      && (
        object.isMovie !== true
        || (
          (version < 10 && object.movieElapsedMs === undefined)
          || (
            Number.isFinite(object.movieElapsedMs)
            && object.movieElapsedMs >= 0
            && object.movieElapsedMs <= 600_000
          )
        )
      )
      && Number.isFinite(object.x)
      && Math.abs(object.x) <= 100_000
      && Number.isFinite(object.y)
      && Math.abs(object.y) <= 100_000
      && Number.isFinite(object.z)
      && Math.abs(object.z) <= 100_000
      && (
        object.anchorX === undefined
        || (Number.isFinite(object.anchorX) && Math.abs(object.anchorX) <= 100_000)
      )
      && (
        object.anchorY === undefined
        || (Number.isFinite(object.anchorY) && Math.abs(object.anchorY) <= 100_000)
      )
      && Number.isFinite(object.alpha)
      && object.alpha >= 0
      && object.alpha <= 1
      && (
        object.priority === undefined
        || (
          Number.isInteger(object.priority)
          && object.priority >= 0
          && object.priority <= 255
        )
      )
      && (
        object.blendMode === undefined
        || (
          Number.isInteger(object.blendMode)
          && object.blendMode >= 0
          && object.blendMode <= 8
        )
      )
      && (
        object.maskAssetName === undefined
        || object.maskAssetName === ""
        || validAssetName(object.maskAssetName)
      )
      && isValidSavedSceneObjectAnimation(object.animation)
      && isValidSavedSceneObjectMotion(object.motion)
      && isValidSavedSceneObjectTransition(object.transition)
    ))
    && isValidScenarioFilterSnapshot(visual.filter ?? null)
    && isValidScenarioApertureSnapshot(visual.aperture ?? null)
    && isValidScenarioRainSnapshot(visual.rain ?? null);
}

function isValidSavedSpriteTransition(transition) {
  return transition
    && Number.isInteger(transition.slot)
    && transition.slot >= 0
    && transition.slot <= 31
    && Number.isFinite(transition.remainingMs)
    && transition.remainingMs >= 1
    && transition.remainingMs <= 600_000
    && typeof transition.remove === "boolean"
    && (
      transition.eventCount === undefined
      || (
        Number.isInteger(transition.eventCount)
        && transition.eventCount >= 0
        && transition.eventCount <= 100_000_000
      )
    )
    && (
      transition.opcode === undefined
      || (
        Number.isInteger(transition.opcode)
        && transition.opcode >= 0
        && transition.opcode <= 0xffff
      )
    )
    && (
      transition.mapAssetName === undefined
      || transition.mapAssetName === ""
      || validAssetName(transition.mapAssetName)
    )
    && (
      transition.from === null
      || isValidSavedSpriteLayer(transition.from)
    )
    && (
      transition.to === null
      || isValidSavedSpriteLayer(transition.to)
    )
    && (transition.from !== null || transition.to !== null);
}

function isValidSavedSpriteLayer(layer) {
  return layer
    && validAssetName(layer.assetName)
    && Number.isFinite(layer.alpha)
    && layer.alpha >= 0
    && layer.alpha <= 1
    && Number.isInteger(layer.order)
    && layer.order >= 0
    && layer.order <= 1_000_000
    && Number.isInteger(layer.priority)
    && layer.priority >= 0
    && layer.priority <= 128
    && (
      layer.x === null
      || (Number.isFinite(layer.x) && Math.abs(layer.x) <= 100_000)
    )
    && Number.isFinite(layer.y)
    && Math.abs(layer.y) <= 100_000
    && Number.isFinite(layer.z)
    && Math.abs(layer.z) <= 100_000;
}

function isValidSavedSceneObjectAnimation(animation) {
  return animation === undefined
    || animation === null
    || (
      Number.isInteger(animation.frameCount)
      && animation.frameCount >= 2
      && animation.frameCount <= 32
      && Number.isInteger(animation.frameIntervalMs)
      && animation.frameIntervalMs >= 1
      && animation.frameIntervalMs <= 600_000
      && Number.isInteger(animation.sequenceStyle)
      && animation.sequenceStyle >= 0
      && animation.sequenceStyle <= 3
      && Number.isFinite(animation.elapsedMs)
      && animation.elapsedMs >= 0
      && animation.elapsedMs <= 10_000_000
    );
}

function isValidSavedSceneObjectMotion(motion) {
  return motion === undefined
    || motion === null
    || (
      Number.isFinite(motion.amplitudeX)
      && Math.abs(motion.amplitudeX) <= 400
      && Number.isFinite(motion.amplitudeY)
      && Math.abs(motion.amplitudeY) <= 400
      && Number.isInteger(motion.periodMs)
      && motion.periodMs >= 16
      && motion.periodMs <= 60_000
      && Number.isFinite(motion.phase)
      && (
        motion.directionMode === undefined
        || (
          Number.isInteger(motion.directionMode)
          && motion.directionMode >= 0
          && motion.directionMode <= 10
        )
      )
      && (
        motion.speed === undefined
        || (
          Number.isInteger(motion.speed)
          && motion.speed >= 0
          && motion.speed <= 256
        )
      )
    );
}

function isValidSavedSceneObjectTransition(transition) {
  return transition === undefined
    || transition === null
    || (
      (transition.type === "move" || transition.type === "fade")
      && Number.isFinite(transition.remainingMs)
      && transition.remainingMs >= 1
      && transition.remainingMs <= 600_000
      && transition.to
      && Number.isFinite(transition.to.x)
      && Math.abs(transition.to.x) <= 100_000
      && Number.isFinite(transition.to.y)
      && Math.abs(transition.to.y) <= 100_000
      && Number.isFinite(transition.to.z)
      && Math.abs(transition.to.z) <= 100_000
      && Number.isFinite(transition.to.alpha)
      && transition.to.alpha >= 0
      && transition.to.alpha <= 1
    );
}

function isValidSavedControlMotion(motion) {
  return motion
    && Number.isInteger(motion.spriteId)
    && motion.spriteId >= 0
    && motion.spriteId <= 63
    && Number.isInteger(motion.repeatCount)
    && motion.repeatCount >= 0
    && motion.repeatCount <= 16
    && Number.isFinite(motion.elapsedMs)
    && motion.elapsedMs >= 0
    && motion.elapsedMs <= 10_000_000
    && Array.isArray(motion.elements)
    && motion.elements.length >= 1
    && motion.elements.length <= 16
    && motion.elements.every((element) => (
      element
      && Number.isFinite(element.durationMs)
      && element.durationMs >= 0
      && element.durationMs <= 600_000
      && Number.isFinite(element.alpha)
      && element.alpha >= 0
      && element.alpha <= 1
      && Number.isInteger(element.movementMode)
      && element.movementMode >= 0
      && element.movementMode <= 16
      && Number.isInteger(element.rotationMode)
      && element.rotationMode >= 0
      && element.rotationMode <= 16
      && Array.isArray(element.points)
      && element.points.length >= 1
      && element.points.length <= 16
      && element.points.every((point) => (
        point
        && Number.isFinite(point.x)
        && Math.abs(point.x) <= 100_000
        && Number.isFinite(point.y)
        && Math.abs(point.y) <= 100_000
        && Number.isFinite(point.z)
        && Math.abs(point.z) <= 100_000
        && Number.isFinite(point.holdMs)
        && point.holdMs >= 0
        && point.holdMs <= 600_000
      ))
    ));
}

async function restoreSceneVisual(player, catalog, core, visual) {
  const background = visual.backgroundName === null
    ? null
    : await loadScenarioImage(player, catalog, core, visual.backgroundName);
  if (visual.backgroundName !== null && background === null) {
    return false;
  }
  const restoredSprites = [];
  for (const sprite of visual.sprites) {
    const image = await loadScenarioImage(player, catalog, core, sprite.assetName);
    if (image === null) {
      return false;
    }
    restoredSprites.push({ ...sprite, image });
  }
  const restoredSpriteTransitions = [];
  for (const transition of visual.spriteTransitions ?? []) {
    const fromImage = transition.from
      ? await loadScenarioImage(player, catalog, core, transition.from.assetName)
      : null;
    const toImage = transition.to
      ? await loadScenarioImage(player, catalog, core, transition.to.assetName)
      : null;
    const mapImage = transition.mapAssetName
      ? await loadScenarioImage(player, catalog, core, transition.mapAssetName)
      : null;
    if (
      (transition.from && fromImage === null)
      || (transition.to && toImage === null)
      || (transition.mapAssetName && mapImage === null)
    ) {
      return false;
    }
    restoredSpriteTransitions.push({
      transition,
      fromImage,
      mapImage,
      toImage,
    });
  }
  const restoredSceneObjects = [];
  const restoredMovieObjects = [];
  for (const object of visual.sceneObjects ?? []) {
    const maskImage = object.maskAssetName
      ? await loadScenarioImage(player, catalog, core, object.maskAssetName)
      : null;
    if (object.maskAssetName && maskImage === null) {
      return false;
    }
    if (object.isMovie === true) {
      const archivePayload = await catalog.readArchivePayloadByNameBytes(
        encoder.encode(object.assetName),
      );
      const moviePayload = readFirstArc20EntryPayloadByExtension(
        archivePayload,
        ".mpg",
      );
      if (moviePayload === null) {
        return false;
      }
      restoredMovieObjects.push({ ...object, maskImage, moviePayload });
      continue;
    }
    const image = await loadScenarioImage(player, catalog, core, object.assetName);
    if (image === null) {
      return false;
    }
    restoredSceneObjects.push({ ...object, image, maskImage });
  }
  player.scene.current = background;
  player.scene.currentName = visual.backgroundName;
  player.scene.target = null;
  player.scene.targetName = null;
  player.scene.progress = 1;
  player.scene.transitionMap = null;
  player.scene.transitionMapName = null;
  player.scene.transitioning = false;
  player.scene.shake = null;
  restoreScenarioFilter(player.scene.filter, visual.filter ?? null);
  restoreScenarioAperture(player.scene.aperture, visual.aperture ?? null);
  restoreScenarioRain(player.scene.rain, visual.rain ?? null);
  clearScenarioMovies(player.scene.movies);
  clearScenarioSprites(player.scene.sprites);
  clearScenarioSceneObjects(player.scene.sprites);
  for (const sprite of restoredSprites) {
    beginScenarioSpriteTransition(
      player.scene.sprites,
      sprite.slot,
      sprite.image,
      0,
      sprite,
    );
  }
  for (const restored of restoredSpriteTransitions) {
    restoreScenarioSpriteTransition(
      player.scene.sprites,
      restored.transition,
      restored,
    );
  }
  for (const object of restoredSceneObjects) {
    setScenarioSceneObject(player.scene.sprites, object.id, object.image, object);
    if (object.motion !== null && object.motion !== undefined) {
      restoreScenarioSceneObjectMotion(
        player.scene.sprites,
        object.id,
        object.motion,
      );
    }
    if (object.transition !== null && object.transition !== undefined) {
      restoreScenarioSceneObjectTransition(
        player.scene.sprites,
        object.id,
        object.transition,
      );
    }
  }
  for (const object of restoredMovieObjects) {
    const image = setScenarioMovieObject(
      player.scene.movies,
      object.id,
      object.moviePayload,
      { elapsedMs: object.movieElapsedMs ?? 0 },
    );
    if (image === null) {
      return false;
    }
    setScenarioSceneObject(player.scene.sprites, object.id, image, object);
    if (object.motion !== null && object.motion !== undefined) {
      restoreScenarioSceneObjectMotion(
        player.scene.sprites,
        object.id,
        object.motion,
      );
    }
    if (object.transition !== null && object.transition !== undefined) {
      restoreScenarioSceneObjectTransition(
        player.scene.sprites,
        object.id,
        object.transition,
      );
    }
  }
  for (const motion of visual.motions ?? []) {
    const restoredMotion = restoreScenarioMotion(motion);
    if (restoredMotion) {
      player.scene.sprites.motions.set(motion.slot, restoredMotion);
    }
  }
  for (const motion of visual.controlMotions ?? []) {
    restoreScenarioSpriteControlMotion(player.scene.sprites, motion);
  }
  if (
    (visual.motions?.length ?? 0) > 0
    || (visual.controlMotions?.length ?? 0) > 0
    || restoredSpriteTransitions.length > 0
    || restoredSceneObjects.some((object) => (
      object.animation != null || object.transition != null || object.motion != null
    ))
    || restoredMovieObjects.some((object) => (
      object.motion != null
    ))
    || restoredMovieObjects.length > 0
    || hasActiveScenarioRain(player.scene.rain)
  ) {
    startVisualAnimation(player);
  }
  return true;
}

function validAssetName(value) {
  return typeof value === "string" && /^[A-Za-z0-9_]+$/.test(value);
}

function validArchiveName(value) {
  return typeof value === "string" && /^[A-Za-z0-9_]+\.arc$/i.test(value);
}

function decodeSessionEvent(packet, payload) {
  const event = {
    kind: packet.eventKind,
    mode: packet.mode,
    eventCount: packet.eventCount,
    payloadLength: packet.payloadLength,
    backlogLength: packet.backlogLength,
  };
  if (packet.eventKind === EVENT_MESSAGE) {
    const intArgs = decodeI32Values(payload, packet.stringArgCount);
    const textOffset = intArgs.length * 4;
    const nameBytes = payload.slice(textOffset, textOffset + packet.nameLength);
    const textBytes = payload.slice(
      textOffset + packet.nameLength,
      textOffset + packet.nameLength + packet.textLength,
    );
    return {
      ...event,
      opcode: packet.optionCount,
      intArgs,
      name: packet.nameLength === 0 ? "" : decoder.decode(nameBytes),
      text: decoder.decode(textBytes),
      textLength: packet.textLength,
    };
  }
  if (packet.eventKind === EVENT_CHOICE) {
    const intArgs = decodeI32Values(payload, packet.nameLength);
    return {
      ...event,
      opcode: packet.stringArgCount,
      intArgs,
      options: decodeLengthPrefixedStrings(payload, packet.optionCount, intArgs.length * 4),
    };
  }
  if (packet.eventKind === EVENT_USER_FUNCTION) {
    const intArgs = decodeI32Values(payload, packet.textLength);
    const nameOffset = intArgs.length * 4;
    const nameBytes = payload.slice(nameOffset, nameOffset + packet.nameLength);
    return {
      ...event,
      offset: packet.optionCount,
      intArgs,
      name: decoder.decode(nameBytes),
      stringArgCount: packet.stringArgCount,
    };
  }
  if (packet.eventKind === EVENT_SOUND) {
    return decodeCommandEvent(event, packet, payload);
  }
  if (packet.eventKind === EVENT_GRAPH) {
    return decodeCommandEvent(event, packet, payload);
  }
  if (packet.eventKind === EVENT_WAIT) {
    return {
      ...event,
      opcode: packet.optionCount,
      offset: packet.stringArgCount,
      durationMs: packet.nameLength,
    };
  }
  if (packet.eventKind === EVENT_MESSAGE_CONTROL) {
    return {
      ...event,
      opcode: packet.optionCount,
      offset: packet.stringArgCount,
      durationMs: packet.nameLength,
    };
  }
  return event;
}

function decodeCommandEvent(event, packet, payload) {
  const intArgs = decodeI32Values(payload, packet.nameLength);
  const stringSection = decodeLengthPrefixedSection(
    payload,
    packet.textLength,
    intArgs.length * 4,
  );
  return {
    ...event,
    opcode: packet.optionCount,
    offset: packet.stringArgCount,
    intArgs,
    stringArgs: stringSection.values,
    arrayArgs: decodeArrayArgs(payload, stringSection.cursor),
  };
}

function decodeI32Values(payload, count) {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const values = [];
  for (let index = 0; index < count && index * 4 + 4 <= payload.byteLength; index += 1) {
    values.push(view.getInt32(index * 4, true));
  }
  return values;
}

function decodeLengthPrefixedStrings(payload, count, start = 0) {
  return decodeLengthPrefixedSection(payload, count, start).values;
}

function decodeLengthPrefixedSection(payload, count, start = 0) {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const values = [];
  let cursor = start;
  for (let index = 0; index < count && cursor + 4 <= payload.byteLength; index += 1) {
    const length = view.getUint32(cursor, true);
    cursor += 4;
    values.push(decoder.decode(payload.slice(cursor, cursor + length)));
    cursor += length;
  }
  return { values, cursor };
}

function decodeArrayArgs(payload, start) {
  if (start === payload.byteLength) {
    return [];
  }
  if (start + 8 > payload.byteLength) {
    throw new Error("truncated scenario array argument section");
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  if (
    payload[start] !== 0x41
    || payload[start + 1] !== 0x52
    || payload[start + 2] !== 0x52
    || payload[start + 3] !== 0x59
  ) {
    throw new Error("invalid scenario array argument section");
  }
  const count = view.getUint32(start + 4, true);
  if (count > 64) {
    throw new Error("scenario array argument count exceeds limit");
  }
  const values = [];
  let cursor = start + 8;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 12 > payload.byteLength) {
      throw new Error("truncated scenario array argument header");
    }
    const argumentIndex = view.getUint32(cursor, true);
    const address = view.getUint32(cursor + 4, true);
    const length = view.getUint32(cursor + 8, true);
    cursor += 12;
    if (length > payload.byteLength - cursor) {
      throw new Error("truncated scenario array argument payload");
    }
    values.push({
      index: argumentIndex,
      address,
      bytes: payload.slice(cursor, cursor + length),
    });
    cursor += length;
  }
  if (cursor !== payload.byteLength) {
    throw new Error("scenario array argument section length mismatch");
  }
  return values;
}

function canvasPointFromEvent(canvas, event) {
  if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
    return null;
  }
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }
  return {
    x: (event.clientX - rect.left) * canvas.width / rect.width,
    y: (event.clientY - rect.top) * canvas.height / rect.height,
  };
}

function messageControlIndexAt(canvas, skin, x, y) {
  if (!skin?.panel || !Array.isArray(skin.controls)) {
    return -1;
  }
  const scale = 1.04;
  const width = skin.controls.reduce(
    (sum, control) => sum + control.stateWidth * scale,
    0,
  );
  let controlX = Math.round((canvas.width - skin.panel.width) / 2)
    + skin.panel.width
    - width
    - 30;
  const controlY = canvas.height - skin.panel.height - 23;
  for (let index = 0; index < skin.controls.length; index += 1) {
    const control = skin.controls[index];
    const controlWidth = control.stateWidth * scale;
    if (
      x >= controlX
      && x < controlX + controlWidth
      && y >= controlY
      && y < controlY + control.stateHeight
    ) {
      return index;
    }
    controlX += controlWidth;
  }
  return -1;
}

function handleMessageControlClick(player, controlIndex, onUpdate) {
  if (!Number.isInteger(controlIndex) || controlIndex < 0) {
    return false;
  }
  player.safeState.messageControlClickIndex = controlIndex;
  player.safeState.messageControlClickName = MESSAGE_CONTROL_NAMES[controlIndex] ?? "";
  switch (controlIndex) {
    case MESSAGE_CONTROL_AUTO:
      player.autoAdvanceUpdate = onUpdate;
      player.toggleAutoMode();
      player.safeState.messageControlClickResult = "ok";
      player.safeState.messageControlClickOk = 1;
      return true;
    case MESSAGE_CONTROL_SKIP:
      player.autoAdvanceUpdate = onUpdate;
      player.toggleSkipMode();
      player.safeState.messageControlClickResult = "ok";
      player.safeState.messageControlClickOk = 1;
      return true;
    case MESSAGE_CONTROL_LOG:
      player.cancelAutoSkip();
      player.openBacklog();
      player.safeState.messageControlClickResult = "ok";
      player.safeState.messageControlClickOk = 1;
      return true;
    case MESSAGE_CONTROL_SAVE:
      player.openUserDataWindow("save");
      player.safeState.messageControlClickResult = "open_save";
      player.safeState.messageControlClickOk = 1;
      return true;
    case MESSAGE_CONTROL_LOAD:
      player.openUserDataWindow("load");
      player.safeState.messageControlClickResult = "open_load";
      player.safeState.messageControlClickOk = 1;
      return true;
    case MESSAGE_CONTROL_QUICK_SAVE: {
      player.cancelAutoSkip();
      const result = player.saveToStorage();
      player.safeState.messageControlClickResult = result.reason;
      player.safeState.messageControlClickOk = Number(result.ok);
      return true;
    }
    case MESSAGE_CONTROL_QUICK_LOAD:
      player.cancelAutoSkip();
      player.safeState.messageControlClickResult = "loading";
      {
        const clickIndex = controlIndex;
        const clickName = MESSAGE_CONTROL_NAMES[controlIndex] ?? "";
        void player.loadFromStorage().then((result) => {
          player.safeState.messageControlClickIndex = clickIndex;
          player.safeState.messageControlClickName = clickName;
          player.safeState.messageControlClickResult = result.reason;
          player.safeState.messageControlClickOk = Number(result.ok);
          onUpdate?.();
        });
      }
      return true;
    case MESSAGE_CONTROL_VOICE:
      player.cancelAutoSkip();
      player.safeState.messageControlClickResult = "playing";
      {
        const clickIndex = controlIndex;
        const clickName = MESSAGE_CONTROL_NAMES[controlIndex] ?? "";
        void player.replayCurrentVoice().then((result) => {
          player.safeState.messageControlClickIndex = clickIndex;
          player.safeState.messageControlClickName = clickName;
          player.safeState.messageControlClickResult = result.reason ?? (result.ok ? "ok" : "failed");
          player.safeState.messageControlClickOk = Number(result.ok);
          onUpdate?.();
        });
      }
      return true;
    case MESSAGE_CONTROL_HIDE:
      player.cancelAutoSkip();
      player.setMessageWindowHidden(true);
      player.safeState.messageControlClickResult = "ok";
      player.safeState.messageControlClickOk = 1;
      return true;
    case MESSAGE_CONTROL_SYSTEM:
      player.openConfigWindow();
      player.safeState.messageControlClickResult = "open_config";
      player.safeState.messageControlClickOk = 1;
      return true;
    default:
      return false;
  }
}

function backlogHoverKey(control) {
  if (control?.kind === "voice") {
    return `voice:${control.entryIndex}`;
  }
  return control?.kind ?? null;
}

function choiceIndexFromEvent(event, canvas, optionCount) {
  if (!Number.isFinite(event.clientY)) {
    return 0;
  }
  const rect = canvas.getBoundingClientRect();
  const scaleY = canvas.height / rect.height;
  const y = (event.clientY - rect.top) * scaleY;
  const boxY = canvas.height - 146 - 34;
  const index = Math.floor((y - boxY - 26) / 34);
  return Math.min(Math.max(index, 0), optionCount - 1);
}

function safeSessionState(active, event) {
  return {
    active,
    eventKind: event?.kind ?? 0,
    mode: event?.mode ?? 0,
    eventCount: event?.eventCount ?? 0,
    payloadLength: event?.payloadLength ?? 0,
    backlogLength: event?.backlogLength ?? 0,
    backlogOpen: 0,
    backlogFirstIndex: 0,
    autoMode: 0,
    skipMode: 0,
    textLength: event?.textLength ?? 0,
    optionCount: event?.options?.length ?? 0,
    sceneAssetReady: 0,
    sceneAssetNameLength: 0,
    sceneTransitionMs: 0,
    sceneTransitionMapNameLength: 0,
    sceneTransitionMapReady: 0,
    sceneAssetErrors: 0,
    sceneShakeMs: 0,
    sceneShakeAmplitudeX: 0,
    sceneShakeAmplitudeY: 0,
    sceneShakeUpdateCount: 0,
    scenePresetShakeCount: 0,
    sceneShakeDirection: 0,
    sceneShakeStrengthIndex: 0,
    sceneShakePeriodMs: 0,
    sceneShakeCycles: 0,
    sceneShakeDecayPercent: 0,
    sceneBankSpriteMs: 0,
    sceneBankSpriteNameLength: 0,
    sceneBankSpriteTerminations: 0,
    sceneSpriteOpcode: 0,
    sceneSpriteEventCount: 0,
    sceneSpriteSlot: 0,
    sceneSpriteCount: 0,
    sceneSpriteTransitions: 0,
    sceneSpriteMotionCount: 0,
    sceneObjectId: 0,
    sceneObjectCount: 0,
    sceneObjectAssetReady: 0,
    sceneObjectEventCount: 0,
    sceneFilterCount: 0,
    sceneFilterDurationMs: 0,
    sceneFilterMode: 0,
    sceneFilterStrength: 0,
    sceneRainCount: 0,
    sceneRainActive: 0,
    sceneRainDensity: 0,
    sceneRainSpeed: 0,
    sceneRainAngle: 0,
    sceneRainAlpha: 0,
    scenarioUserFunctionCount: 0,
    scenarioUserFunctionNameLength: 0,
    messageControlOpcode: 0,
    messageControlDurationMs: 0,
    messageControlVisible: 0,
    messageControlCount: 0,
    messageWindowHidden: 0,
    messageControlClickIndex: -1,
    messageControlClickName: "",
    messageControlClickResult: "",
    messageControlClickOk: 0,
    scenarioName: "",
    scenarioIndex: 0,
    scenarioCount: 0,
    scenarioTransitions: 0,
    inputResult: 0,
    lastSaveBytes: 0,
    lastLoadBytes: 0,
    lastSaveSlot: 0,
    lastLoadSlot: 0,
    userDataOpen: 0,
    userDataMode: "",
    userDataPage: 0,
    userDataSelectedSlot: 0,
    userDataLastResult: "",
    userDataLastOk: 0,
    configOpen: 0,
    configHover: "",
    configLastAction: "",
    configTextSpeed: 0,
    configAutoSpeed: 0,
    configWindowOpacity: 0,
    configMasterVolume: 0,
    configBgmVolume: 0,
    configSfxVolume: 0,
    configVoiceVolume: 0,
    voiceAssetReady: 0,
    voicePlayResult: 0,
    voiceNameLength: 0,
    voiceChannel: 0,
    voiceControlOpcode: 0,
    voiceControlCount: 0,
    voiceWaitInterruptible: 0,
    sfxAssetReady: 0,
    sfxPlayResult: 0,
    sfxNameLength: 0,
    sfxControlOpcode: 0,
    sfxChannel: 0,
    sfxFadeMs: 0,
    sfxControlCount: 0,
    sfxWaitInterruptible: 0,
    loopSfxControlOpcode: 0,
    loopSfxFadeMs: 0,
    loopSfxTargetVolume: 0,
  };
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function saveSlotKey(slotIndex) {
  return `${SAVE_SLOT_KEY_PREFIX}${normalizeSaveSlot(slotIndex)}`;
}

function scenarioStorage() {
  return globalThis.window?.localStorage ?? globalThis.localStorage ?? null;
}

function normalizeSaveSlot(slotIndex) {
  return Math.max(
    0,
    Math.min(999, Number.isInteger(slotIndex) ? slotIndex : Math.trunc(Number(slotIndex) || 0)),
  );
}

function drawSceneImage(context, canvas, image, alpha) {
  if (!image || alpha <= 0) {
    return;
  }
  const scale = Math.max(canvas.width / image.width, canvas.height / image.height);
  const width = Math.round(image.width * scale);
  const height = Math.round(image.height * scale);
  context.save();
  context.globalAlpha = Math.max(0, Math.min(1, alpha));
  context.drawImage(
    rgbaCanvas(image),
    Math.floor((canvas.width - width) / 2),
    Math.floor((canvas.height - height) / 2),
    width,
    height,
  );
  context.restore();
}

function drawMappedSceneImage(context, canvas, image, mapImage, progress, cacheKey) {
  const scale = Math.max(canvas.width / image.width, canvas.height / image.height);
  const width = Math.round(image.width * scale);
  const height = Math.round(image.height * scale);
  paintMappedTransition(
    context,
    rgbaCanvas(image),
    mapImage,
    progress,
    {
      cacheKey,
      height,
      width,
      x: Math.floor((canvas.width - width) / 2),
      y: Math.floor((canvas.height - height) / 2),
    },
  );
}

function drawMappedSceneBlack(context, canvas, mapImage, progress, cacheKey) {
  if (
    blackTransitionCanvas === null
    || blackTransitionCanvas.width !== canvas.width
    || blackTransitionCanvas.height !== canvas.height
  ) {
    blackTransitionCanvas = document.createElement("canvas");
    blackTransitionCanvas.width = canvas.width;
    blackTransitionCanvas.height = canvas.height;
    const blackContext = blackTransitionCanvas.getContext("2d", { alpha: false });
    blackContext.fillStyle = "#000";
    blackContext.fillRect(0, 0, canvas.width, canvas.height);
  }
  paintMappedTransition(
    context,
    blackTransitionCanvas,
    mapImage,
    progress,
    { cacheKey },
  );
}

function drawRgbaImage(context, image, x, y) {
  context.drawImage(rgbaCanvas(image), x, y, image.width, image.height);
}

function rgbaCanvas(image) {
  const cached = imageCanvasCache.get(image);
  if (cached) {
    return cached;
  }
  const scratch = document.createElement("canvas");
  scratch.width = image.width;
  scratch.height = image.height;
  scratch
    .getContext("2d", { alpha: true })
    .putImageData(
      new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height),
      0,
      0,
    );
  imageCanvasCache.set(image, scratch);
  return scratch;
}

function drawWrappedText(context, text, x, y, maxWidth, lineHeight, maxLines) {
  const chars = Array.from(text);
  let line = "";
  let lines = 0;
  for (const char of chars) {
    const candidate = line + char;
    if (context.measureText(candidate).width > maxWidth && line.length > 0) {
      context.fillText(line, x, y + lines * lineHeight);
      line = char;
      lines += 1;
      if (lines >= maxLines) {
        return;
      }
    } else {
      line = candidate;
    }
  }
  if (line.length > 0 && lines < maxLines) {
    context.fillText(line, x, y + lines * lineHeight);
  }
}
