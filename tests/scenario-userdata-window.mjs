import assert from "node:assert/strict";
import {
  applyScenarioUserDataControl,
  closeScenarioUserDataWindow,
  createScenarioUserDataState,
  openScenarioUserDataWindow,
  scenarioUserDataControlAt,
  userDataHoverKey,
  USER_DATA_TOTAL_PAGES,
} from "../web/scenario-userdata-window.js";
import {
  readScenarioQuickSaveSummary,
  readScenarioSaveSlotSummary,
} from "../web/session-player.js";

const skin = {
  saveBase: image(1280, 720),
  loadBase: image(1280, 720),
  saveSlot: image(392, 160),
  loadSlot: image(392, 160),
  buttons: {
    // top-nav sheets (556x43, 4 states)
    top: image(556, 43),
    previous: image(556, 43),
    next: image(556, 43),
    last: image(556, 43),
    // bottom-row sheets (576x52, 4 states)
    load: image(576, 52),
    save: image(576, 52),
    back: image(576, 52),
    exit: image(576, 52),
    delete: image(576, 52),
    move: image(576, 52),
    copy: image(576, 52),
  },
  digits: Array.from({ length: 10 }, () => image(24, 48)),
};

const state = createScenarioUserDataState();
openScenarioUserDataWindow(state, "save");
assert.equal(state.open, true);
assert.equal(state.mode, "save");
assert.equal(state.page, 0);

// --- Slot hit-test + save action ---
const slot = scenarioUserDataControlAt(60, 130, state, skin);
assert.deepEqual(slot, { kind: "slot", slot: 0 });
assert.equal(userDataHoverKey(slot), "slot:0");

let savedSlot = -1;
let loadedSlot = -1;
const slotResult = applyScenarioUserDataControl(state, slot, {
  save: (index) => {
    savedSlot = index;
    return { handled: true, reason: "ok", ok: true };
  },
  load: (index) => {
    loadedSlot = index;
    return { handled: true, reason: "ok", ok: true };
  },
});
assert.equal(slotResult.reason, "ok");
assert.equal(savedSlot, 0);
assert.equal(loadedSlot, -1);

// --- Top nav: Top is disabled on the first page, Next/Last/Previous are not ---
assert.equal(scenarioUserDataControlAt(100, 60, state, skin), null, "Top disabled on page 0");
const next = scenarioUserDataControlAt(1000, 60, state, skin);
assert.deepEqual(next, { kind: "nav", action: "next" });
assert.equal(userDataHoverKey(next), "next");
applyScenarioUserDataControl(state, next, {});
assert.equal(state.page, 1);

// On page 1 the Top button becomes active again.
const top = scenarioUserDataControlAt(100, 60, state, skin);
assert.deepEqual(top, { kind: "nav", action: "top" });
applyScenarioUserDataControl(state, top, {});
assert.equal(state.page, 0);

// Last jumps to the final page; once there Last is disabled.
const last = scenarioUserDataControlAt(1150, 60, state, skin);
assert.deepEqual(last, { kind: "nav", action: "last" });
applyScenarioUserDataControl(state, last, {});
assert.equal(state.page, USER_DATA_TOTAL_PAGES - 1);
assert.equal(scenarioUserDataControlAt(1150, 60, state, skin), null, "Last disabled on final page");

// Previous walks back one page from the final page.
const previous = scenarioUserDataControlAt(260, 60, state, skin);
assert.deepEqual(previous, { kind: "nav", action: "previous" });
applyScenarioUserDataControl(state, previous, {});
assert.equal(state.page, USER_DATA_TOTAL_PAGES - 2);

// --- Mode toggle: on the Save screen the left button switches to Load ---
state.page = 0;
const toggle = scenarioUserDataControlAt(100, 670, state, skin);
assert.deepEqual(toggle, { kind: "toggle", action: "load" });
applyScenarioUserDataControl(state, toggle, {});
assert.equal(state.mode, "load");

// In Load mode a slot click triggers load, and the left button switches to Save.
const loadSlot = scenarioUserDataControlAt(60, 130, state, skin);
applyScenarioUserDataControl(state, loadSlot, {
  save: () => {
    throw new Error("unexpected save in load mode");
  },
  load: (index) => {
    loadedSlot = index;
    return { handled: true, reason: "ok", ok: true };
  },
});
assert.equal(loadedSlot, 0);
const toggleBack = scenarioUserDataControlAt(100, 670, state, skin);
assert.deepEqual(toggleBack, { kind: "toggle", action: "save" });

// --- Delete/Move/Copy are always disabled (not hittable) ---
assert.equal(scenarioUserDataControlAt(580, 670, state, skin), null, "Delete disabled");
assert.equal(scenarioUserDataControlAt(720, 670, state, skin), null, "Move disabled");
assert.equal(scenarioUserDataControlAt(880, 670, state, skin), null, "Copy disabled");

// --- Back / Exit close the window ---
const back = scenarioUserDataControlAt(270, 670, state, skin);
assert.deepEqual(back, { kind: "close", action: "back" });
applyScenarioUserDataControl(state, back, {});
assert.equal(state.open, false);

openScenarioUserDataWindow(state, "save");
const exit = scenarioUserDataControlAt(420, 670, state, skin);
assert.deepEqual(exit, { kind: "close", action: "exit" });
applyScenarioUserDataControl(state, exit, {});
assert.equal(state.open, false);

openScenarioUserDataWindow(state, "load");
closeScenarioUserDataWindow(state);
assert.equal(state.open, false);

// --- Save summary now carries backgroundName for thumbnails ---
const storedValues = new Map();
const storage = {
  getItem: (key) => storedValues.get(key) ?? null,
};
assert.deepEqual(readScenarioSaveSlotSummary(0, storage), { slot: 0, exists: false });
assert.deepEqual(readScenarioQuickSaveSummary(storage), { slot: 0, exists: false });
storedValues.set("sakura.session.slot.1", JSON.stringify({
  scenarioName: "00_op_01",
  savedAt: "2026-06-14 12:00:00",
  event: { eventCount: 42, text: "saved text" },
  visual: { backgroundName: "EV_op01a" },
}));
assert.deepEqual(readScenarioSaveSlotSummary(1, storage), {
  slot: 1,
  exists: true,
  scenarioName: "00_op_01",
  eventCount: 42,
  savedAt: "2026-06-14 12:00:00",
  text: "saved text",
  backgroundName: "EV_op01a",
});
storedValues.set("sakura.session.quick", JSON.stringify({
  scenarioName: "02_abend_01",
  savedAt: "2026-06-15 18:30:00",
  event: { eventCount: 7, text: "quick text" },
}));
assert.deepEqual(readScenarioSaveSlotSummary(0, storage), { slot: 0, exists: false });
assert.deepEqual(readScenarioQuickSaveSummary(storage), {
  slot: 0,
  exists: true,
  scenarioName: "02_abend_01",
  eventCount: 7,
  savedAt: "2026-06-15 18:30:00",
  text: "quick text",
  backgroundName: "",
});

console.log("scenario_userdata_window=ok");

function image(width, height) {
  return { width, height, pixels: new Uint8Array(width * height * 4) };
}
