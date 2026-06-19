import assert from "node:assert/strict";
import {
  applyScenarioConfigControl,
  applyScenarioScreenMode,
  closeScenarioConfigWindow,
  createScenarioConfigState,
  normalizedScenarioConfigSettings,
  openScenarioConfigWindow,
  paintScenarioConfigWindow,
  readStoredScenarioConfigSettings,
  scenarioConfigControlAt,
  scenarioConfigHoverKey,
  storeScenarioConfigSettings,
} from "../web/scenario-config-window.js";

const skin = {
  base: image(1280, 720),
  sliderMarker: image(84, 22),
  rows: {
    window: image(552, 37),
    fullscreen: image(552, 37),
    skipRead: image(552, 37),
    skipAll: image(552, 37),
    choiceSkipOff: image(552, 37),
    choiceSkipOn: image(552, 37),
    choiceAutoOff: image(552, 37),
    choiceAutoOn: image(552, 37),
    instantTransitionOff: image(552, 37),
    instantTransitionOn: image(552, 37),
    carryVoiceOff: image(552, 37),
    carryVoiceOn: image(552, 37),
  },
  buttons: {
    reset: image(556, 43),
    title: image(556, 43),
    back: image(556, 43),
  },
  faces: Array.from({ length: 8 }, () => image(200, 130)),
};

const state = createScenarioConfigState();
openScenarioConfigWindow(state);
assert.equal(state.open, true);

// textSpeed meter: trackX=330, y=118, 10 icons at +28. Last icon (step 9) sits
// at x=330+9*28=582; clicking it sets value=9/9=1.
const slider = scenarioConfigControlAt(582, 125, state, skin);
assert.equal(slider?.kind, "slider");
assert.equal(slider.key, "textSpeed");
assert.equal(slider.step, 9);
assert.equal(scenarioConfigHoverKey(slider), "textSpeed:9");
let result = applyScenarioConfigControl(state, slider);
assert.equal(result.reason, "textSpeed");
assert.equal(state.settings.textSpeed, 1);

// First icon (step 0) -> value 0.
const sliderMin = scenarioConfigControlAt(338, 125, state, skin);
assert.equal(sliderMin.step, 0);
applyScenarioConfigControl(state, sliderMin);
assert.equal(state.settings.textSpeed, 0);

// screenMode row Y=309: left column X=324 is フルスクリーン.
const screenMode = scenarioConfigControlAt(400, 320, state, skin);
assert.equal(screenMode?.kind, "choice");
assert.equal(screenMode.key, "screenMode");
assert.equal(screenMode.side, "left");
assert.equal(scenarioConfigHoverKey(screenMode), "screenMode:left");
applyScenarioConfigControl(state, screenMode);
assert.equal(state.settings.screenMode, "fullscreen");

// Right column X=473 is ウィンドウ.
const windowMode = scenarioConfigControlAt(540, 320, state, skin);
assert.equal(windowMode.side, "right");
applyScenarioConfigControl(state, windowMode);
assert.equal(state.settings.screenMode, "window");

// する/しない rows: left=true, right=false (e.g. continueSkipAfterChoice, Y=437).
const skipOn = scenarioConfigControlAt(400, 450, state, skin);
assert.equal(skipOn.key, "continueSkipAfterChoice");
assert.equal(skipOn.value, true);
applyScenarioConfigControl(state, skipOn);
assert.equal(state.settings.continueSkipAfterChoice, true);

// Portrait grid: columns 766,876,986,1096; rows 386,526. Index 0 = top-left.
const face = scenarioConfigControlAt(780, 400, state, skin);
assert.deepEqual(face, { kind: "characterVoice", index: 0 });
applyScenarioConfigControl(state, face);
assert.equal(state.settings.characterVoices[0], false);

// Index 7 = bottom-right (col 3, row 1).
const face7 = scenarioConfigControlAt(1140, 560, state, skin);
assert.deepEqual(face7, { kind: "characterVoice", index: 7 });

assert.equal(scenarioConfigControlAt(260, 684, state, skin), null);

// Reset top-left (44,40), Title (940,40) + Back (1092,40) top-right.
const reset = scenarioConfigControlAt(60, 55, state, skin);
assert.deepEqual(reset, { kind: "button", action: "reset" });
result = applyScenarioConfigControl(state, reset);
assert.equal(result.reason, "reset");
assert.equal(state.settings.textSpeed, 0.5);
assert.equal(state.settings.characterVoices[0], true);

const title = scenarioConfigControlAt(960, 55, state, skin);
assert.deepEqual(title, { kind: "button", action: "title" });
result = applyScenarioConfigControl(state, title);
assert.equal(result.reason, "title_pending");
assert.equal(state.open, true);

const back = scenarioConfigControlAt(1110, 55, state, skin);
assert.deepEqual(back, { kind: "button", action: "back" });
result = applyScenarioConfigControl(state, back);
assert.equal(result.reason, "closed");
assert.equal(state.open, false);

openScenarioConfigWindow(state);
closeScenarioConfigWindow(state);
assert.equal(state.open, false);

const normalized = normalizedScenarioConfigSettings({
  textSpeed: 2,
  autoSpeed: -1,
  screenMode: "fullscreen",
  skipMode: "all",
  carryVoiceOnClick: false,
  characterVoices: [false, true, false],
});
assert.equal(normalized.textSpeed, 1);
assert.equal(normalized.autoSpeed, 0);
assert.equal(normalized.screenMode, "fullscreen");
assert.equal(normalized.skipMode, "all");
assert.equal(normalized.carryVoiceOnClick, false);
assert.deepEqual(normalized.characterVoices.slice(0, 4), [false, true, false, true]);
assert.equal(Object.hasOwn(normalized, "upscaleEnabled"), false);

const storedValues = new Map();
const storage = {
  getItem: (key) => storedValues.get(key) ?? null,
  setItem: (key, value) => storedValues.set(key, value),
};
assert.equal(storeScenarioConfigSettings({
  textSpeed: 0.25,
  masterVolume: 1.5,
  characterVoices: [false],
}, storage), true);
const loaded = readStoredScenarioConfigSettings(storage);
assert.equal(loaded.textSpeed, 0.25);
assert.equal(loaded.masterVolume, 1);
assert.equal(loaded.characterVoices[0], false);
assert.equal(loaded.characterVoices[1], true);
assert.equal(Object.hasOwn(loaded, "upscaleModel"), false);

let requestedFullscreen = 0;
let exitedFullscreen = 0;
const fakeDocument = {
  fullscreenElement: null,
  documentElement: {
    requestFullscreen() {
      requestedFullscreen += 1;
      fakeDocument.fullscreenElement = fakeDocument.documentElement;
      return Promise.resolve();
    },
  },
  exitFullscreen() {
    exitedFullscreen += 1;
    fakeDocument.fullscreenElement = null;
    return Promise.resolve();
  },
};
assert.deepEqual(
  applyScenarioScreenMode({ screenMode: "fullscreen" }, fakeDocument),
  { ok: true, reason: "fullscreen_requested" },
);
assert.equal(requestedFullscreen, 1);
assert.deepEqual(
  applyScenarioScreenMode({ screenMode: "window" }, fakeDocument),
  { ok: true, reason: "exit_fullscreen_requested" },
);
assert.equal(exitedFullscreen, 1);

{
  installCanvasStubs();
  const drawState = createScenarioConfigState();
  openScenarioConfigWindow(drawState);
  drawState.settings.textSpeed = 5 / 9;
  drawState.hover = "textSpeed:7";
  const context = drawContext();
  paintScenarioConfigWindow(context, { width: 1280, height: 720 }, skin, drawState);
  const hoveredStep = findDraw(context.calls, 330 + 7 * 28, 118);
  assert.equal(hoveredStep.sx, 21, "unselected meter hover uses blue state1");
  const selectedStep = findDraw(context.calls, 330 + 5 * 28, 118);
  assert.equal(selectedStep.sx, 42, "selected meter step remains current state2");

  drawState.settings.screenMode = "fullscreen";
  drawState.hover = "screenMode:left";
  const selectedHoverContext = drawContext();
  paintScenarioConfigWindow(selectedHoverContext, { width: 1280, height: 720 }, skin, drawState);
  const selectedChoice = findDraw(selectedHoverContext.calls, 324, 309);
  assert.equal(selectedChoice.sx, 276, "selected choice hover stays selected state2");

  drawState.hover = "screenMode:right";
  const unselectedHoverContext = drawContext();
  paintScenarioConfigWindow(unselectedHoverContext, { width: 1280, height: 720 }, skin, drawState);
  const unselectedChoice = findDraw(unselectedHoverContext.calls, 473, 309);
  assert.equal(unselectedChoice.sx, 138, "unselected choice hover uses blue state1");
}

console.log("scenario_config_window=ok");

function image(width, height) {
  return { width, height, pixels: new Uint8Array(width * height * 4) };
}

function installCanvasStubs() {
  globalThis.ImageData ??= class ImageData {
    constructor(data, width, height) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  };
  globalThis.document ??= {
    createElement() {
      return {
        width: 0,
        height: 0,
        getContext() {
          return { putImageData() {} };
        },
      };
    },
  };
}

function drawContext() {
  return {
    calls: [],
    save() {},
    restore() {},
    scale() {},
    fillRect() {},
    drawImage(_image, sx, sy, sw, sh, dx, dy, dw, dh) {
      if (arguments.length === 9) {
        this.calls.push({ sx, sy, sw, sh, dx, dy, dw, dh });
      }
    },
  };
}

function findDraw(calls, dx, dy) {
  const call = calls.find((item) => item.dx === dx && item.dy === dy);
  assert.ok(call, `missing draw at ${dx},${dy}`);
  return call;
}
