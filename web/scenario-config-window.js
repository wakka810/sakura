// Faithful Config window (cnfgwnd._bp, system index 20).
//
// All geometry below is extracted from the decompiled cnfgwnd._bp bytecode
// (output/cfg/cnfg_disasm.txt) and verified against the SGCnfgWnd990000 base
// art, NOT guessed:
//
// * Base bg SGCnfgWnd990000 (1280x720) carries every static label/panel/dotted
//   line / おそい・はやい・うすい・こい / 無音・大きい / vertical キャラクター個別音声 /
//   character names / the "Config" title + feather.
// * 7 value meters (frame arrays valueIDs[0,1,2,9,10,11,12], steps=10 each,
//   trackX[330x3,920x4], rowY[118,182,246 | 118,182,246,310]); each row draws
//   10 step icons at X = trackX + step*28 using SGCnfgWnd000000 (84x22, 4
//   states x21). Fill: step<value -> state0 (pink), step==value -> state2
//   (pink/current), step>value -> state3 (pale outline); hovering an unselected
//   step uses state1 (blue).
// * 6 two-choice rows (Y=309,373,437,501,565,629), left column X=324, right
//   column X=473; each option is its own SGCnfgWnd0N0000/0N0100 button (552x37,
//   4 states x138). The selected option stays state2 even when hovered; only
//   an unselected hovered option uses state1 (blue). The left/right asset
//   assignment was read from the script's image-id table (catalog base 1664,
//   stride 4 per asset).
// * 8 character portraits (SGCnfgWnd100000..110100, 200x130, 2 states x100):
//   columns X=766,876,986,1096, rows Y=386,526.
// * Reset/Title/Back (SGCnfgWnd200000/200100/200200, 556x43, 4 states x139) at
//   the corners: Reset top-left (44,40), Title (940,40) and Back (1092,40)
//   top-right.

const SCREEN_WIDTH = 1280;
const SCREEN_HEIGHT = 720;

// SGCnfgWnd000000 step icon: 4 horizontal states (filled/blue/pressed/pale).
const ICON_STATES = 4;
const METER_STEPS = 10;
const METER_STEP_DX = 28; // icon X = trackX + step*28 (from cnfgwnd._bp loop)

// Value meter rows. `key` maps to the stored 0..1 setting. trackX/y come from
// the frame[228]/frame[164] arrays decoded from the script.
const METER_ROWS = Object.freeze([
  { key: "textSpeed", trackX: 330, y: 118 },
  { key: "autoSpeed", trackX: 330, y: 182 },
  { key: "windowOpacity", trackX: 330, y: 246 },
  { key: "masterVolume", trackX: 920, y: 118 },
  { key: "bgmVolume", trackX: 920, y: 182 },
  { key: "sfxVolume", trackX: 920, y: 246 },
  { key: "voiceVolume", trackX: 920, y: 310 },
]);

// SGCnfgWnd0N0000/0N0100 option buttons: 4 horizontal states x138.
const CHOICE_STATES = 4;
const CHOICE_LEFT_X = 324;
const CHOICE_RIGHT_X = 473;

// Each row carries the left/right option image + value. The asset assigned to
// each column was read from the script's image-id table, e.g. row1 left=010100
// (フルスクリーン), right=010000 (ウィンドウ).
const CHOICE_ROWS = Object.freeze([
  {
    key: "screenMode",
    y: 309,
    left: { image: "fullscreen", value: "fullscreen" },
    right: { image: "window", value: "window" },
  },
  {
    key: "skipMode",
    y: 373,
    left: { image: "skipRead", value: "read" },
    right: { image: "skipAll", value: "all" },
  },
  {
    key: "continueSkipAfterChoice",
    y: 437,
    left: { image: "choiceSkipOn", value: true },
    right: { image: "choiceSkipOff", value: false },
  },
  {
    key: "continueAutoAfterChoice",
    y: 501,
    left: { image: "choiceAutoOn", value: true },
    right: { image: "choiceAutoOff", value: false },
  },
  {
    key: "instantTransitions",
    y: 565,
    left: { image: "instantTransitionOn", value: true },
    right: { image: "instantTransitionOff", value: false },
  },
  {
    key: "carryVoiceOnClick",
    y: 629,
    left: { image: "carryVoiceOn", value: true },
    right: { image: "carryVoiceOff", value: false },
  },
]);

// SGCnfgWnd100000..110100 portraits: 2 horizontal states x100 (color/sepia).
const FACE_STATES = 2;
const FACE_COLUMNS_X = Object.freeze([766, 876, 986, 1096]);
const FACE_ROWS_Y = Object.freeze([386, 526]);
const FACE_COUNT = 8;

// SGCnfgWnd200000/200100/200200 corner buttons: 4 horizontal states x139.
const CORNER_STATES = 4;
const CORNER_BUTTONS = Object.freeze([
  { action: "reset", key: "reset", x: 44, y: 40 },
  { action: "title", key: "title", x: 940, y: 40 },
  { action: "back", key: "back", x: 1092, y: 40 },
]);

const imageCanvasCache = new WeakMap();
export const SCENARIO_CONFIG_STORAGE_KEY = "sakura.config.v1";

export function defaultScenarioConfigSettings() {
  return {
    textSpeed: 0.5,
    autoSpeed: 0.5,
    windowOpacity: 0.6,
    screenMode: "window",
    skipMode: "read",
    continueSkipAfterChoice: false,
    continueAutoAfterChoice: false,
    instantTransitions: false,
    carryVoiceOnClick: true,
    masterVolume: 1,
    bgmVolume: 1,
    sfxVolume: 1,
    voiceVolume: 1,
    characterVoices: Array.from({ length: FACE_COUNT }, () => true),
  };
}

export function normalizedScenarioConfigSettings(value) {
  const defaults = defaultScenarioConfigSettings();
  const source = value && typeof value === "object" ? value : {};
  return {
    textSpeed: clamp01(source.textSpeed ?? defaults.textSpeed),
    autoSpeed: clamp01(source.autoSpeed ?? defaults.autoSpeed),
    windowOpacity: clamp01(source.windowOpacity ?? defaults.windowOpacity),
    screenMode: source.screenMode === "fullscreen" ? "fullscreen" : defaults.screenMode,
    skipMode: source.skipMode === "all" ? "all" : defaults.skipMode,
    continueSkipAfterChoice: source.continueSkipAfterChoice === true,
    continueAutoAfterChoice: source.continueAutoAfterChoice === true,
    instantTransitions: source.instantTransitions === true,
    carryVoiceOnClick: source.carryVoiceOnClick !== false,
    masterVolume: clamp01(source.masterVolume ?? defaults.masterVolume),
    bgmVolume: clamp01(source.bgmVolume ?? defaults.bgmVolume),
    sfxVolume: clamp01(source.sfxVolume ?? defaults.sfxVolume),
    voiceVolume: clamp01(source.voiceVolume ?? defaults.voiceVolume),
    characterVoices: Array.from(
      { length: defaults.characterVoices.length },
      (_, index) => source.characterVoices?.[index] !== false,
    ),
  };
}

export function readStoredScenarioConfigSettings(storage = scenarioConfigStorage()) {
  if (!storage) {
    return null;
  }
  try {
    const encoded = storage.getItem(SCENARIO_CONFIG_STORAGE_KEY);
    if (!encoded) {
      return null;
    }
    const parsed = JSON.parse(encoded);
    return parsed?.version === 1
      ? normalizedScenarioConfigSettings(parsed.settings)
      : null;
  } catch {
    return null;
  }
}

export function storeScenarioConfigSettings(settings, storage = scenarioConfigStorage()) {
  if (!storage) {
    return false;
  }
  try {
    storage.setItem(SCENARIO_CONFIG_STORAGE_KEY, JSON.stringify({
      version: 1,
      settings: normalizedScenarioConfigSettings(settings),
    }));
    return true;
  } catch {
    return false;
  }
}

export function applyScenarioScreenMode(settings, documentRef = globalThis.document) {
  const document = documentRef ?? globalThis.document;
  if (!document) {
    return { ok: false, reason: "document_unavailable" };
  }
  const wantsFullscreen = settings?.screenMode === "fullscreen";
  if (wantsFullscreen) {
    if (document.fullscreenElement) {
      return { ok: true, reason: "already_fullscreen" };
    }
    const target = document.documentElement;
    if (typeof target?.requestFullscreen !== "function") {
      return { ok: false, reason: "fullscreen_unavailable" };
    }
    try {
      const promise = target.requestFullscreen();
      promise?.catch?.(() => {});
      return { ok: true, reason: "fullscreen_requested" };
    } catch {
      return { ok: false, reason: "fullscreen_failed" };
    }
  }
  if (!document.fullscreenElement) {
    return { ok: true, reason: "already_window" };
  }
  if (typeof document.exitFullscreen !== "function") {
    return { ok: false, reason: "exit_fullscreen_unavailable" };
  }
  try {
    const promise = document.exitFullscreen();
    promise?.catch?.(() => {});
    return { ok: true, reason: "exit_fullscreen_requested" };
  } catch {
    return { ok: false, reason: "exit_fullscreen_failed" };
  }
}

export function createScenarioConfigState() {
  return {
    open: false,
    hover: null,
    lastAction: "",
    settings: normalizedScenarioConfigSettings(defaultScenarioConfigSettings()),
  };
}

export function openScenarioConfigWindow(state) {
  state.open = true;
  state.hover = null;
  state.lastAction = "open";
}

export function closeScenarioConfigWindow(state) {
  state.open = false;
  state.hover = null;
  state.lastAction = "closed";
}

export function resetScenarioConfigSettings(state) {
  state.settings = normalizedScenarioConfigSettings(defaultScenarioConfigSettings());
  state.lastAction = "reset";
}

export function scenarioConfigControlAt(x, y, state, skin) {
  if (!state?.open || !skin) {
    return null;
  }
  // Corner buttons (Reset / Title / Back).
  const cornerWidth = imageStateWidth(skin.buttons?.reset, CORNER_STATES);
  const cornerHeight = skin.buttons?.reset?.height ?? 0;
  for (const button of CORNER_BUTTONS) {
    const image = skin.buttons?.[button.key] ?? null;
    if (!image) {
      continue;
    }
    if (
      x >= button.x
      && x < button.x + cornerWidth
      && y >= button.y
      && y < button.y + cornerHeight
    ) {
      return { kind: "button", action: button.action };
    }
  }
  // 10-step value meters.
  const iconWidth = imageStateWidth(skin.sliderMarker, ICON_STATES);
  const iconHeight = skin.sliderMarker?.height ?? 0;
  if (iconWidth > 0) {
    for (const row of METER_ROWS) {
      const trackEnd = row.trackX + (METER_STEPS - 1) * METER_STEP_DX + iconWidth;
      if (x >= row.trackX && x < trackEnd && y >= row.y && y < row.y + iconHeight) {
        const step = clampInt(Math.round((x - row.trackX) / METER_STEP_DX), 0, METER_STEPS - 1);
        return {
          kind: "slider",
          key: row.key,
          step,
          value: step / (METER_STEPS - 1),
        };
      }
    }
  }
  // 2-choice rows.
  for (const row of CHOICE_ROWS) {
    for (const side of ["left", "right"]) {
      const option = row[side];
      const image = skin.rows?.[option.image] ?? null;
      if (!image) {
        continue;
      }
      const colX = side === "left" ? CHOICE_LEFT_X : CHOICE_RIGHT_X;
      const width = imageStateWidth(image, CHOICE_STATES);
      if (x >= colX && x < colX + width && y >= row.y && y < row.y + imageLogicalHeight(image)) {
        return { kind: "choice", key: row.key, value: option.value, side };
      }
    }
  }
  // Character voice portraits.
  const face = faceIndexAt(x, y, skin.faces ?? []);
  if (face !== -1) {
    return { kind: "characterVoice", index: face };
  }
  return null;
}

export function applyScenarioConfigControl(state, control) {
  if (!control) {
    return { handled: false, reason: "none" };
  }
  switch (control.kind) {
    case "button":
      if (control.action === "back") {
        closeScenarioConfigWindow(state);
        return { handled: true, reason: "closed" };
      }
      if (control.action === "reset") {
        resetScenarioConfigSettings(state);
        return { handled: true, reason: "reset" };
      }
      state.lastAction = "title_pending";
      return { handled: true, reason: "title_pending" };
    case "slider":
      state.settings[control.key] = clamp01(control.value);
      state.lastAction = control.key;
      return { handled: true, reason: control.key };
    case "choice":
      state.settings[control.key] = control.value;
      state.lastAction = control.key;
      return { handled: true, reason: control.key };
    case "characterVoice":
      if (Number.isInteger(control.index) && control.index >= 0) {
        state.settings.characterVoices[control.index] =
          state.settings.characterVoices[control.index] !== true;
        state.lastAction = "character_voice";
        return { handled: true, reason: "character_voice" };
      }
      return { handled: false, reason: "invalid_character" };
    default:
      return { handled: false, reason: "unsupported" };
  }
}

export function scenarioConfigHoverKey(control) {
  if (control?.kind === "button") {
    return control.action;
  }
  if (control?.kind === "slider") {
    return `${control.key}:${control.step}`;
  }
  if (control?.kind === "choice") {
    return `${control.key}:${control.side}`;
  }
  if (control?.kind === "characterVoice") {
    return `voice:${control.index}`;
  }
  return null;
}

export function paintScenarioConfigWindow(context, canvas, skin, state) {
  if (!state?.open || !skin) {
    return false;
  }
  context.save();
  context.scale(canvas.width / SCREEN_WIDTH, canvas.height / SCREEN_HEIGHT);
  if (skin.base) {
    drawRgbaImage(context, skin.base, 0, 0);
  } else {
    context.fillStyle = "#0b5eb5";
    context.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
  }
  drawMeterRows(context, skin, state);
  drawChoiceRows(context, skin, state);
  drawCharacterVoices(context, skin, state);
  drawCornerButtons(context, skin, state);
  context.restore();
  return true;
}

function drawMeterRows(context, skin, state) {
  const icon = skin.sliderMarker;
  if (!icon) {
    return;
  }
  for (const row of METER_ROWS) {
    const selected = meterSelectedIndex(state.settings[row.key]);
    const hoveredStep = hoveredMeterStep(state.hover, row.key);
    for (let step = 0; step < METER_STEPS; step += 1) {
      const hovered = hoveredStep === step && step !== selected;
      const sourceIndex = hovered
        ? 1
        : step < selected ? 0 : step === selected ? 2 : 3;
      drawStateImage(
        context,
        icon,
        row.trackX + step * METER_STEP_DX,
        row.y,
        sourceIndex,
        ICON_STATES,
      );
    }
  }
}

function drawChoiceRows(context, skin, state) {
  for (const row of CHOICE_ROWS) {
    for (const side of ["left", "right"]) {
      const option = row[side];
      const image = skin.rows?.[option.image] ?? null;
      if (!image) {
        continue;
      }
      const colX = side === "left" ? CHOICE_LEFT_X : CHOICE_RIGHT_X;
      const selected = state.settings[row.key] === option.value;
      const hovered = state.hover === `${row.key}:${side}`;
      const sourceIndex = selected ? 2 : hovered ? 1 : 0;
      drawStateImage(context, image, colX, row.y, sourceIndex, CHOICE_STATES);
    }
  }
}

function hoveredMeterStep(hover, key) {
  if (typeof hover !== "string") {
    return -1;
  }
  const prefix = `${key}:`;
  if (!hover.startsWith(prefix)) {
    return -1;
  }
  const step = Number.parseInt(hover.slice(prefix.length), 10);
  return Number.isInteger(step) && step >= 0 && step < METER_STEPS ? step : -1;
}

function drawCharacterVoices(context, skin, state) {
  const faces = skin.faces ?? [];
  for (let index = 0; index < Math.min(faces.length, FACE_COUNT); index += 1) {
    const image = faces[index];
    if (!image) {
      continue;
    }
    const x = FACE_COLUMNS_X[index % FACE_COLUMNS_X.length];
    const y = FACE_ROWS_Y[Math.floor(index / FACE_COLUMNS_X.length)];
    const enabled = state.settings.characterVoices[index] !== false;
    drawStateImage(context, image, x, y, enabled ? 0 : 1, FACE_STATES);
  }
}

function drawCornerButtons(context, skin, state) {
  for (const button of CORNER_BUTTONS) {
    const image = skin.buttons?.[button.key] ?? null;
    if (!image) {
      continue;
    }
    const hovered = state.hover === button.action;
    drawStateImage(context, image, button.x, button.y, hovered ? 1 : 0, CORNER_STATES);
  }
}

function drawStateImage(context, image, x, y, sourceIndex, stateCount) {
  const stateWidth = imageStateWidth(image, stateCount);
  const sourceStateWidth = imageSourceStateWidth(image, stateCount);
  context.drawImage(
    rgbaCanvas(image),
    Math.max(0, Math.min(sourceIndex, stateCount - 1)) * sourceStateWidth,
    0,
    sourceStateWidth,
    image.height,
    x,
    y,
    stateWidth,
    imageLogicalHeight(image),
  );
}

// value (0..1) -> selected icon index 0..9. step<value -> filled, ==value ->
// current, >value -> empty. Matches the decoded meter fill comparison.
function meterSelectedIndex(value) {
  return clampInt(Math.round(clamp01(value) * (METER_STEPS - 1)), 0, METER_STEPS - 1);
}

function faceIndexAt(x, y, faces) {
  for (let index = 0; index < Math.min(faces.length, FACE_COUNT); index += 1) {
    const image = faces[index];
    if (!image) {
      continue;
    }
    const colX = FACE_COLUMNS_X[index % FACE_COLUMNS_X.length];
    const rowY = FACE_ROWS_Y[Math.floor(index / FACE_COLUMNS_X.length)];
    const width = imageStateWidth(image, FACE_STATES);
    if (x >= colX && x < colX + width && y >= rowY && y < rowY + imageLogicalHeight(image)) {
      return index;
    }
  }
  return -1;
}

function imageStateWidth(image, stateCount) {
  return image ? Math.floor(imageLogicalWidth(image) / stateCount) : 0;
}

function imageSourceStateWidth(image, stateCount) {
  return image ? Math.floor(image.width / stateCount) : 0;
}

function clamp01(value) {
  return Math.max(0, Math.min(Number(value) || 0, 1));
}

function clampInt(value, min, max) {
  return Math.max(min, Math.min(Math.round(Number(value) || 0), max));
}

function scenarioConfigStorage() {
  return globalThis.window?.localStorage ?? globalThis.localStorage ?? null;
}

function drawRgbaImage(context, image, x, y) {
  context.drawImage(rgbaCanvas(image), x, y, imageLogicalWidth(image), imageLogicalHeight(image));
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
