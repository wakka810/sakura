import assert from "node:assert/strict";
import {
  applyScenarioUserDataControl,
  closeScenarioUserDataWindow,
  createScenarioUserDataState,
  openScenarioUserDataWindow,
  scenarioUserDataControlAt,
  userDataHoverKey,
} from "../web/scenario-userdata-window.js";
import { readScenarioSaveSlotSummary } from "../web/session-player.js";

const skin = {
  saveBase: image(1280, 720),
  loadBase: image(1280, 720),
  saveSlot: image(392, 160),
  loadSlot: image(392, 160),
  buttons: {
    previous: image(556, 43),
    next: image(556, 43),
    save: image(576, 52),
    load: image(576, 52),
    back: image(576, 52),
  },
  digits: Array.from({ length: 10 }, () => image(24, 48)),
};

const state = createScenarioUserDataState();
openScenarioUserDataWindow(state, "save");
assert.equal(state.open, true);
assert.equal(state.mode, "save");

const slot = scenarioUserDataControlAt(60, 130, state, skin);
assert.deepEqual(slot, { kind: "slot", slot: 0 });
assert.equal(userDataHoverKey(slot), "slot:0");

let savedSlot = -1;
let loadedSlot = -1;
let result = applyScenarioUserDataControl(state, slot, {
  save: (index) => {
    savedSlot = index;
    return { handled: true, reason: "ok", ok: true };
  },
  load: (index) => {
    loadedSlot = index;
    return { handled: true, reason: "ok", ok: true };
  },
});
assert.equal(result.reason, "ok");
assert.equal(savedSlot, 0);
assert.equal(loadedSlot, -1);

const next = scenarioUserDataControlAt(610, 660, state, skin);
assert.equal(next?.kind, "next");
applyScenarioUserDataControl(state, next, {});
assert.equal(state.page, 1);

openScenarioUserDataWindow(state, "load");
const loadSlot = scenarioUserDataControlAt(60, 130, state, skin);
applyScenarioUserDataControl(state, loadSlot, {
  save: () => {
    throw new Error("unexpected save");
  },
  load: (index) => {
    loadedSlot = index;
    return { handled: true, reason: "ok", ok: true };
  },
});
assert.equal(loadedSlot, 9);

const back = scenarioUserDataControlAt(904, 660, state, skin);
assert.equal(back?.kind, "back");
applyScenarioUserDataControl(state, back, {});
assert.equal(state.open, false);

openScenarioUserDataWindow(state, "load");
closeScenarioUserDataWindow(state);
assert.equal(state.open, false);

const storedValues = new Map();
const storage = {
  getItem: (key) => storedValues.get(key) ?? null,
};
assert.deepEqual(readScenarioSaveSlotSummary(0, storage), { slot: 0, exists: false });
storedValues.set("sakura.session.slot.1", JSON.stringify({
  scenarioName: "00_op_01",
  savedAt: "2026-06-14 12:00:00",
  event: { eventCount: 42, text: "saved text" },
}));
assert.deepEqual(readScenarioSaveSlotSummary(1, storage), {
  slot: 1,
  exists: true,
  scenarioName: "00_op_01",
  eventCount: 42,
  savedAt: "2026-06-14 12:00:00",
  text: "saved text",
});

console.log("scenario_userdata_window=ok");

function image(width, height) {
  return { width, height, pixels: new Uint8Array(width * height * 4) };
}
