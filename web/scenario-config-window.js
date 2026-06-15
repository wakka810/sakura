const SCREEN_WIDTH = 1280;
const SCREEN_HEIGHT = 720;
const BUTTON_Y = 668;
const BUTTONS = Object.freeze([
  { kind: "reset", key: "reset", x: 396, y: BUTTON_Y },
  { kind: "title", key: "title", x: 570, y: BUTTON_Y },
  { kind: "back", key: "back", x: 744, y: BUTTON_Y },
]);
// Slider track geometry derived from the SGCnfgWnd990000 base image: the
// dotted grooves the marker rides sit at y=167/231/295/359, and the draggable
// span lies between the おそい/はやい (left) and 無音/大きい (right) labels. The
// marker (SGCnfgWnd000000) is drawn with track.y as its top, so track.y is the
// groove row minus half the 22px marker height (=11). x0/x1 stay inside the
// label gaps so a min/max value never lands the marker on the label text.
const SLIDER_TRACKS = Object.freeze({
  textSpeed: { x0: 372, x1: 562, y: 156 },
  autoSpeed: { x0: 372, x1: 562, y: 220 },
  windowOpacity: { x0: 372, x1: 562, y: 284 },
  masterVolume: { x0: 958, x1: 1150, y: 156 },
  bgmVolume: { x0: 958, x1: 1150, y: 220 },
  sfxVolume: { x0: 958, x1: 1150, y: 284 },
  voiceVolume: { x0: 958, x1: 1150, y: 348 },
});
const CHOICE_ROWS = Object.freeze([
  {
    key: "screenMode",
    y: 309,
    options: ["window", "fullscreen"],
    imageKeys: ["window", "fullscreen"],
  },
  {
    key: "skipMode",
    y: 373,
    options: ["read", "all"],
    imageKeys: ["skipRead", "skipAll"],
  },
  {
    key: "continueSkipAfterChoice",
    y: 437,
    options: [false, true],
    imageKeys: ["choiceSkipOff", "choiceSkipOn"],
  },
  {
    key: "continueAutoAfterChoice",
    y: 501,
    options: [false, true],
    imageKeys: ["choiceAutoOff", "choiceAutoOn"],
  },
  {
    key: "instantTransitions",
    y: 565,
    options: [false, true],
    imageKeys: ["instantTransitionOff", "instantTransitionOn"],
  },
  {
    key: "carryVoiceOnClick",
    y: 629,
    options: [false, true],
    imageKeys: ["carryVoiceOff", "carryVoiceOn"],
  },
]);
const CHOICE_X = 430;
const CHOICE_HIT_X = 300;
const CHOICE_HIT_WIDTH = 320;
const FACE_X = 746;
const FACE_Y = 386;
const FACE_GAP_X = 112;
const FACE_GAP_Y = 140;
const FACE_COLUMNS = 4;
const FACE_STATE_COUNT = 2;
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
    characterVoices: Array.from({ length: 8 }, () => true),
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
  state.settings = defaultScenarioConfigSettings();
  state.lastAction = "reset";
}

export function scenarioConfigControlAt(x, y, state, skin) {
  if (!state?.open || !skin) {
    return null;
  }
  const scaled = {
    x: x * SCREEN_WIDTH / SCREEN_WIDTH,
    y: y * SCREEN_HEIGHT / SCREEN_HEIGHT,
  };
  for (const button of BUTTONS) {
    const image = skin.buttons?.[button.key] ?? null;
    const stateWidth = imageStateWidth(image, 4);
    if (
      image
      && scaled.x >= button.x
      && scaled.x < button.x + stateWidth
      && scaled.y >= button.y
      && scaled.y < button.y + image.height
    ) {
      return { kind: "button", action: button.kind };
    }
  }
  for (const [key, track] of Object.entries(SLIDER_TRACKS)) {
    if (
      scaled.x >= track.x0 - 18
      && scaled.x <= track.x1 + 18
      && scaled.y >= track.y - 12
      && scaled.y <= track.y + 24
    ) {
      return {
        kind: "slider",
        key,
        value: clamp01((scaled.x - track.x0) / (track.x1 - track.x0)),
      };
    }
  }
  for (const row of CHOICE_ROWS) {
    if (
      scaled.x >= CHOICE_HIT_X
      && scaled.x < CHOICE_HIT_X + CHOICE_HIT_WIDTH
      && scaled.y >= row.y - 4
      && scaled.y < row.y + 45
    ) {
      return { kind: "choice", key: row.key };
    }
  }
  const face = faceIndexAt(scaled.x, scaled.y, skin.faces?.[0] ?? null);
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
      toggleChoiceSetting(state.settings, control.key);
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
  if (control?.kind === "slider" || control?.kind === "choice") {
    return control.key;
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
  drawSliders(context, skin, state);
  drawChoiceRows(context, skin, state);
  drawCharacterVoices(context, skin, state);
  drawButtons(context, skin, state);
  context.restore();
  return true;
}

function drawSliders(context, skin, state) {
  const marker = skin.sliderMarker;
  if (!marker) {
    return;
  }
  const stateWidth = imageStateWidth(marker, 2);
  for (const [key, track] of Object.entries(SLIDER_TRACKS)) {
    const value = clamp01(state.settings[key]);
    const x = Math.round(track.x0 + (track.x1 - track.x0) * value - stateWidth / 2);
    const sourceIndex = state.hover === key ? 1 : 0;
    context.drawImage(
      rgbaCanvas(marker),
      sourceIndex * stateWidth,
      0,
      stateWidth,
      marker.height,
      x,
      track.y,
      stateWidth,
      marker.height,
    );
  }
}

function drawChoiceRows(context, skin, state) {
  for (const row of CHOICE_ROWS) {
    const index = selectedChoiceIndex(state.settings, row);
    const image = skin.rows?.[row.imageKeys[index]] ?? null;
    if (!image) {
      continue;
    }
    drawStateImage(context, image, CHOICE_X, row.y, state.hover === row.key ? 1 : 0, 4);
  }
}

function drawCharacterVoices(context, skin, state) {
  const faces = skin.faces ?? [];
  for (let index = 0; index < faces.length; index += 1) {
    const image = faces[index];
    if (!image) {
      continue;
    }
    const column = index % FACE_COLUMNS;
    const row = Math.floor(index / FACE_COLUMNS);
    const x = FACE_X + column * FACE_GAP_X;
    const y = FACE_Y + row * FACE_GAP_Y;
    const enabled = state.settings.characterVoices[index] !== false;
    const sourceIndex = enabled ? 0 : 1;
    drawStateImage(context, image, x, y, sourceIndex, FACE_STATE_COUNT);
    if (state.hover === `voice:${index}`) {
      context.save();
      context.globalAlpha = 0.2;
      context.fillStyle = enabled ? "#26b6ff" : "#ff5fb3";
      context.fillRect(x, y, Math.floor(image.width / FACE_STATE_COUNT), image.height);
      context.restore();
    }
  }
}

function drawButtons(context, skin, state) {
  for (const button of BUTTONS) {
    const image = skin.buttons?.[button.key] ?? null;
    if (!image) {
      continue;
    }
    drawStateImage(
      context,
      image,
      button.x,
      button.y,
      state.hover === button.kind ? 1 : 0,
      4,
    );
  }
}

function drawStateImage(context, image, x, y, sourceIndex, stateCount) {
  const stateWidth = imageStateWidth(image, stateCount);
  context.drawImage(
    rgbaCanvas(image),
    Math.max(0, Math.min(sourceIndex, stateCount - 1)) * stateWidth,
    0,
    stateWidth,
    image.height,
    x,
    y,
    stateWidth,
    image.height,
  );
}

function selectedChoiceIndex(settings, row) {
  const value = settings[row.key];
  const index = row.options.findIndex((option) => option === value);
  return index >= 0 ? index : 0;
}

function toggleChoiceSetting(settings, key) {
  const row = CHOICE_ROWS.find((item) => item.key === key);
  if (!row) {
    return;
  }
  const current = selectedChoiceIndex(settings, row);
  settings[key] = row.options[(current + 1) % row.options.length];
}

function faceIndexAt(x, y, firstFace) {
  if (!firstFace) {
    return -1;
  }
  const stateWidth = Math.floor(firstFace.width / FACE_STATE_COUNT);
  for (let index = 0; index < 8; index += 1) {
    const column = index % FACE_COLUMNS;
    const row = Math.floor(index / FACE_COLUMNS);
    const faceX = FACE_X + column * FACE_GAP_X;
    const faceY = FACE_Y + row * FACE_GAP_Y;
    if (
      x >= faceX
      && x < faceX + stateWidth
      && y >= faceY
      && y < faceY + firstFace.height
    ) {
      return index;
    }
  }
  return -1;
}

function imageStateWidth(image, stateCount) {
  return image ? Math.floor(image.width / stateCount) : 0;
}

function clamp01(value) {
  return Math.max(0, Math.min(Number(value) || 0, 1));
}

function scenarioConfigStorage() {
  return globalThis.window?.localStorage ?? globalThis.localStorage ?? null;
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
