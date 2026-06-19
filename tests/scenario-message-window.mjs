import assert from "node:assert/strict";
import {
  beginScenarioMessageHide,
  beginScenarioMessageReveal,
  beginScenarioMessageShow,
  completeScenarioMessageReveal,
  createScenarioMessageVisualState,
  finishScenarioMessageTransition,
  isScenarioMessageRevealing,
  resolvedScenarioMessageReveal,
  resolvedScenarioMessageVisual,
  showScenarioMessageVisual,
} from "../web/scenario-message-window.js";

const first = { kind: 1, text: "first" };
const second = { kind: 1, text: "second" };
const state = createScenarioMessageVisualState();

assert.equal(resolvedScenarioMessageVisual(state, 0), null);
showScenarioMessageVisual(state, first);
assert.deepEqual(resolvedScenarioMessageVisual(state, 0), {
  event: first,
  opacity: 1,
});

assert.equal(beginScenarioMessageHide(state, 500, 1000), 500);
assert.equal(resolvedScenarioMessageVisual(state, 1250)?.opacity, 0.5);
assert.equal(resolvedScenarioMessageVisual(state, 1500)?.opacity, 0);
finishScenarioMessageTransition(state);
assert.equal(resolvedScenarioMessageVisual(state, 1500), null);

showScenarioMessageVisual(state, first);
assert.equal(beginScenarioMessageHide(state, 0, 2000), 0);
assert.equal(resolvedScenarioMessageVisual(state, 2000), null);

assert.equal(beginScenarioMessageShow(state, 1000, 3000), 1000);
assert.deepEqual(resolvedScenarioMessageVisual(state, 3500), {
  event: null,
  opacity: 0.5,
});
finishScenarioMessageTransition(state);
assert.deepEqual(resolvedScenarioMessageVisual(state, 4000), {
  event: null,
  opacity: 1,
});

showScenarioMessageVisual(state, second);
assert.deepEqual(resolvedScenarioMessageVisual(state, 4000), {
  event: second,
  opacity: 1,
});

// Inline tag / ruby parsing (BGI `<r reading>base</r>` + style tags).
const { parseScenarioText, stripScenarioTags } = await import(
  "../web/scenario-text.js"
);
const { drawScenarioRichText } = await import("../web/scenario-text.js");
const { bindScenarioPlayerInput, paintScenarioEvent } = await import("../web/session-player.js");

assert.deepEqual(parseScenarioText("AB<r yomi>kanji</r>CD"), [
  { type: "text", text: "AB" },
  { type: "ruby", base: "kanji", reading: "yomi" },
  { type: "text", text: "CD" },
]);
assert.equal(stripScenarioTags("AB<r yomi>kanji</r>CD"), "ABkanjiCD");
// BGI's inline bold/italic tags are styled in the rich renderer; unsupported
// style tags such as <l> are still unwrapped with content preserved.
assert.equal(stripScenarioTags("<i>em</i> and <l>x</l> y"), "em and x y");
assert.deepEqual(parseScenarioText("A<b>B<i>C</i></b>D"), [
  { type: "text", text: "A" },
  { type: "text", text: "B", bold: true },
  { type: "text", text: "C", bold: true, italic: true },
  { type: "text", text: "D" },
]);
assert.deepEqual(parseScenarioText("A<c>red</c>B"), [
  { type: "text", text: "A" },
  { type: "text", text: "red", wordColor: true },
  { type: "text", text: "B" },
]);
assert.equal(stripScenarioTags("A<c>red</c>B"), "AredB");
// cr / t become line breaks.
assert.equal(stripScenarioTags("a<cr>b"), "a\nb");
// Malformed ruby keeps surrounding text without throwing.
assert.equal(stripScenarioTags("pre<r dangling"), "pre<r dangling");

{
  const calls = [];
  const context = {
    font: "20px serif",
    fillStyle: "#111",
    measureText: (text) => ({ width: Array.from(text).length * 10 }),
    fillText(text, x, y) {
      calls.push({ text, x, y, fillStyle: this.fillStyle });
    },
  };
  drawScenarioRichText(
    context,
    "A<c>BC</c>D",
    0,
    0,
    100,
    24,
    1,
    Infinity,
    { wordColor: "rgb(10, 20, 30)" },
  );
  assert.deepEqual(calls.map((call) => [call.text, call.fillStyle]), [
    ["A", "#111"],
    ["B", "rgb(10, 20, 30)"],
    ["C", "rgb(10, 20, 30)"],
    ["D", "#111"],
  ]);
  assert.equal(context.fillStyle, "#111");
}

{
  const calls = [];
  const context = {
    font: "20px serif",
    fillStyle: "#111",
    measureText: (text) => ({ width: Array.from(text).length * 10 }),
    fillText(text, x, y) {
      calls.push({ text, x, y, font: this.font });
    },
  };
  drawScenarioRichText(
    context,
    "A<b>B<i>C</i></b>D",
    0,
    0,
    100,
    24,
    1,
  );
  assert.deepEqual(calls.map((call) => [call.text, call.font]), [
    ["A", "20px serif"],
    ["B", "bold 20px serif"],
    ["C", "italic bold 20px serif"],
    ["D", "20px serif"],
  ]);
  assert.equal(context.font, "20px serif");
}

// Message-control hover help uses shipped SGMsgWnd800xxx images. Skip/Voice use
// disabled visual states when unavailable; Q.Load stays normal when there is no
// quick-save snapshot, so it neither turns blue nor shows its help image.
{
  installCanvasStubs();
  const skin = messageSkin();
  const missingQuickContext = fakePaintContext();
  paintScenarioEvent(
    missingQuickContext,
    { width: 1280, height: 720 },
    { kind: 1, text: "" },
    skin,
    6,
    Infinity,
    0.6,
    { quickSaveSummary: () => ({ exists: false }) },
  );
  assert.equal(missingQuickContext.drawImageCalls.length, 11);
  const missingQuickControls = missingQuickContext.drawImageCalls.filter((call) => call.length === 9);
  assert.equal(missingQuickControls[6][1], 0);

  const enabledSkin = messageSkin();
  const enabledContext = fakePaintContext();
  paintScenarioEvent(
    enabledContext,
    { width: 1280, height: 720 },
    { kind: 1, text: "" },
    enabledSkin,
    6,
    Infinity,
    0.6,
    { quickSaveSummary: () => ({ exists: true }) },
  );
  assert.equal(enabledContext.drawImageCalls.length, 12);
}

// The Q.Load button is not drawn disabled with no quick-save snapshot, but it is
// not interactive either.
{
  const skin = messageSkin();
  const canvas = fakeInputCanvas();
  const player = {
    configState: { open: false, hover: null },
    userDataState: { open: false, hover: null },
    backlogState: { open: false, hoverControl: null },
    backlog: [],
    messageWindowHidden: false,
    event: { kind: 1, text: "" },
    skin,
    safeState: {},
    autoMode: false,
    skipMode: false,
    quickSaveSummary: () => ({ exists: false }),
    cancelAutoSkip() {
      this.cancelledAutoSkip = true;
    },
  };
  let updates = 0;
  bindScenarioPlayerInput(canvas, () => ({ player }), () => {
    updates += 1;
  });
  const point = messageControlClientPoint(canvas, skin, 6);
  canvas.dispatch("pointerup", {
    timeStamp: 100,
    button: 0,
    clientX: point.clientX,
    clientY: point.clientY,
  });
  assert.equal(player.safeState.messageControlClickName, "quick-load");
  assert.equal(player.safeState.messageControlClickResult, "inactive");
  assert.equal(player.safeState.messageControlClickOk, 0);
  assert.equal(player.safeState.inputResult, 4);
  assert.equal(player.cancelledAutoSkip, undefined);
  assert.equal(updates, 1);
}

// Typing reveal: chars appear over time at msPerChar; click completes; 0 = instant.
const reveal = createScenarioMessageVisualState();
beginScenarioMessageReveal(reveal, { charCount: 10, msPerChar: 30, now: 1000 });
assert.equal(resolvedScenarioMessageReveal(reveal, 1000), 0);
assert.equal(resolvedScenarioMessageReveal(reveal, 1090), 3);
assert.equal(isScenarioMessageRevealing(reveal, 1090), true);
assert.equal(resolvedScenarioMessageReveal(reveal, 1400), Infinity); // past end
assert.equal(isScenarioMessageRevealing(reveal, 1400), false);
beginScenarioMessageReveal(reveal, { charCount: 10, msPerChar: 30, now: 2000 });
completeScenarioMessageReveal(reveal);
assert.equal(resolvedScenarioMessageReveal(reveal, 2010), Infinity);
beginScenarioMessageReveal(reveal, { charCount: 10, msPerChar: 0, now: 3000 });
assert.equal(isScenarioMessageRevealing(reveal, 3000), false); // instant

console.log("scenario_message_window=ok");

function messageSkin() {
  return {
    panel: image(1198, 168),
    nameplate: null,
    controls: Array.from({ length: 10 }, () => ({
      image: image(240, 27),
      stateWidth: 60,
      stateHeight: 27,
      sourceStateWidth: 60,
      sourceStateHeight: 27,
    })),
    help: Array.from({ length: 10 }, () => image(440, 20)),
  };
}

function image(width, height) {
  return {
    width,
    height,
    logicalWidth: width,
    logicalHeight: height,
    pixels: new Uint8ClampedArray(width * height * 4),
  };
}

function fakePaintContext() {
  return {
    drawImageCalls: [],
    globalAlpha: 1,
    fillStyle: "",
    font: "",
    textBaseline: "",
    save() {},
    restore() {},
    drawImage(...args) {
      this.drawImageCalls.push(args);
    },
    fillText() {},
    measureText(text) {
      return { width: Array.from(String(text)).length * 10 };
    },
  };
}

function fakeInputCanvas() {
  const windowTarget = fakeEventTarget();
  return {
    ...fakeEventTarget(),
    width: 1280,
    height: 720,
    dataset: {},
    ownerDocument: { defaultView: windowTarget },
    closest() {
      return null;
    },
    getBoundingClientRect() {
      return {
        left: 0,
        top: 0,
        width: this.width,
        height: this.height,
      };
    },
  };
}

function fakeEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, handler) {
      const handlers = listeners.get(type) ?? [];
      handlers.push(handler);
      listeners.set(type, handlers);
    },
    dispatch(type, event) {
      for (const handler of listeners.get(type) ?? []) {
        handler(event);
      }
    },
  };
}

function messageControlClientPoint(canvas, skin, index) {
  const scale = 1.04;
  const controlsWidth = skin.controls.reduce(
    (sum, control) => sum + control.stateWidth * scale,
    0,
  );
  let x = Math.round((canvas.width - skin.panel.width) / 2)
    + skin.panel.width
    - controlsWidth
    - 30;
  for (let i = 0; i < index; i += 1) {
    x += skin.controls[i].stateWidth * scale;
  }
  const control = skin.controls[index];
  const y = canvas.height - skin.panel.height - 23;
  return {
    clientX: x + control.stateWidth * scale / 2,
    clientY: y + control.stateHeight / 2,
  };
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
    createElement(tagName) {
      assert.equal(tagName, "canvas");
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
