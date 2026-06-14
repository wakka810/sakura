import assert from "node:assert/strict";
import {
  applyScenarioConfigControl,
  closeScenarioConfigWindow,
  createScenarioConfigState,
  normalizedScenarioConfigSettings,
  openScenarioConfigWindow,
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

const slider = scenarioConfigControlAt(590, 150, state, skin);
assert.equal(slider?.kind, "slider");
assert.equal(slider.key, "textSpeed");
assert.equal(scenarioConfigHoverKey(slider), "textSpeed");
let result = applyScenarioConfigControl(state, slider);
assert.equal(result.reason, "textSpeed");
assert.equal(state.settings.textSpeed, 1);

const screenMode = scenarioConfigControlAt(450, 320, state, skin);
assert.equal(screenMode?.kind, "choice");
assert.equal(screenMode.key, "screenMode");
applyScenarioConfigControl(state, screenMode);
assert.equal(state.settings.screenMode, "fullscreen");

const face = scenarioConfigControlAt(748, 390, state, skin);
assert.deepEqual(face, { kind: "characterVoice", index: 0 });
applyScenarioConfigControl(state, face);
assert.equal(state.settings.characterVoices[0], false);

const reset = scenarioConfigControlAt(408, 680, state, skin);
assert.deepEqual(reset, { kind: "button", action: "reset" });
result = applyScenarioConfigControl(state, reset);
assert.equal(result.reason, "reset");
assert.equal(state.settings.textSpeed, 0.5);
assert.equal(state.settings.characterVoices[0], true);

const title = scenarioConfigControlAt(582, 680, state, skin);
assert.deepEqual(title, { kind: "button", action: "title" });
result = applyScenarioConfigControl(state, title);
assert.equal(result.reason, "title_pending");
assert.equal(state.open, true);

const back = scenarioConfigControlAt(756, 680, state, skin);
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

console.log("scenario_config_window=ok");

function image(width, height) {
  return { width, height, pixels: new Uint8Array(width * height * 4) };
}
