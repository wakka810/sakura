import assert from "node:assert/strict";
import {
  applyScenarioUserDataControl,
  closeScenarioUserDataWindow,
  createScenarioUserDataState,
  openScenarioUserDataWindow,
  paintScenarioUserDataWindow,
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
  preview: { dataUrl: "data:image/png;base64,QUJDRA==" },
}));
assert.deepEqual(readScenarioSaveSlotSummary(1, storage), {
  slot: 1,
  exists: true,
  scenarioName: "00_op_01",
  eventCount: 42,
  savedAt: "2026-06-14 12:00:00",
  text: "saved text",
  backgroundName: "EV_op01a",
  previewDataUrl: "data:image/png;base64,QUJDRA==",
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

// --- Slot painting follows usdtwnd._bp geometry ---
const paintOps = [];
installCanvasStubs();
openScenarioUserDataWindow(state, "save");
paintScenarioUserDataWindow(
  fakeContext(paintOps),
  { width: 1280, height: 720 },
  skin,
  state,
  [{
    exists: true,
    thumbnail: image(1280, 720),
    savedAt: "2026-06-18 07:52:30",
    text: "　ただ、舞い散る桜を見ている。",
  }],
);

const thumbnailDraw = paintOps.find((op) =>
  op.kind === "drawImage"
  && op.args.length === 9
  && Math.round(op.args[5]) === 80
  && Math.round(op.args[6]) === 122
);
assert.ok(thumbnailDraw, "thumbnail draw uses usdtwnd._bp slot offset 36,12");
assert.equal(Math.round(thumbnailDraw.args[7]), 160);
assert.equal(Math.round(thumbnailDraw.args[8]), 90);

const dateDraws = paintOps.filter((op) => op.kind === "fillText" && op.y === 128);
const timeDraws = paintOps.filter((op) => op.kind === "fillText" && op.y === 150);
assert.equal(dateDraws.map((op) => op.text).join(""), "26/06/18");
assert.equal(timeDraws.map((op) => op.text).join(""), "07:52:30");
assert.deepEqual(dateDraws.map((op) => [op.text, op.x, op.y]), [
  ["2", 254, 128],
  ["6", 271.5, 128],
  ["/", 289, 128],
  ["0", 306.5, 128],
  ["6", 324, 128],
  ["/", 341.5, 128],
  ["1", 359, 128],
  ["8", 376.5, 128],
]);
assert.equal(timeDraws[0].x, 254);
assert.equal(timeDraws[0].y, 150);
assert.match(dateDraws[0].font, /MS Gothic/);
assert.equal(dateDraws[0].letterSpacing, undefined);
assert.equal(paintOps.some((op) => op.kind === "fillText" && op.text === "26/06/18.07:52:30"), false);

const bodyDraw = paintOps.find((op) => op.kind === "fillText" && op.text.startsWith("　ただ、"));
assert.ok(bodyDraw, "slot body text rendered");
assert.equal(bodyDraw.x, 80);
assert.equal(bodyDraw.y, 222);
assert.match(bodyDraw.font, /MS Gothic/);

console.log("scenario_userdata_window=ok");

function image(width, height) {
  return { width, height, pixels: new Uint8Array(width * height * 4) };
}

function installCanvasStubs() {
  if (!globalThis.ImageData) {
    globalThis.ImageData = class ImageData {
      constructor(data, width, height) {
        this.data = data;
        this.width = width;
        this.height = height;
      }
    };
  }
  globalThis.document = {
    createElement: () => ({
      getContext: () => ({
        putImageData: () => {},
      }),
    }),
  };
}

function fakeContext(ops) {
  return {
    fillStyle: "",
    font: "",
    textBaseline: "",
    save() {},
    restore() {},
    scale(x, y) {
      ops.push({ kind: "scale", x, y });
    },
    beginPath() {},
    rect() {},
    clip() {},
    fillRect(x, y, width, height) {
      ops.push({ kind: "fillRect", x, y, width, height });
    },
    drawImage(...args) {
      ops.push({ kind: "drawImage", args });
    },
    fillText(text, x, y) {
      ops.push({
        kind: "fillText",
        text,
        x,
        y,
        font: this.font,
        fillStyle: this.fillStyle,
        letterSpacing: this.letterSpacing,
      });
    },
    measureText(text) {
      return { width: [...text].length * 16 };
    },
  };
}
