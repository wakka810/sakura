import assert from "node:assert/strict";
import { createInputController } from "../web/input.js";
import { createTwoFingerDoubleTapRecognizer } from "../web/two-finger-double-tap.js";

class FakeCanvas extends EventTarget {
  focused = false;
  tabIndex = -1;

  getBoundingClientRect() {
    return { left: 10.2, top: 19.8 };
  }

  focus() {
    this.focused = true;
  }
}

const keyboardTarget = new EventTarget();
const canvas = new FakeCanvas();
let changeCount = 0;
const input = createInputController(canvas, {
  keyboardTarget,
  onChange: () => {
    changeCount += 1;
  },
});

canvas.dispatchEvent(eventWith("pointerdown", { clientX: 15.4, clientY: 27.6, button: 0 }));
keyboardTarget.dispatchEvent(eventWith("keydown", { key: "Enter" }));
keyboardTarget.dispatchEvent(eventWith("keydown", { key: "Enter" }));
keyboardTarget.dispatchEvent(eventWith("keyup", { key: "Enter" }));

const state = input.snapshot();
if (state.clickCount !== 1 || state.keyPressCount !== 1 || changeCount !== 4) {
  throw new Error(`unexpected input counters ${JSON.stringify({ state, changeCount })}`);
}
if (state.lastPointer.x !== 5 || state.lastPointer.y !== 8 || state.lastPointer.button !== 1) {
  throw new Error(`unexpected pointer state ${JSON.stringify(state.lastPointer)}`);
}
if (state.keysDown.length !== 0 || !canvas.focused) {
  throw new Error("input focus/key release state failed");
}
const runtimeFirst = input.runtimeState();
if (
  runtimeFirst.clickCount !== 1 ||
  runtimeFirst.keyPressCount !== 1 ||
  runtimeFirst.pointerValid !== true ||
  runtimeFirst.pointerButton !== 1 ||
  runtimeFirst.pointerX !== 5 ||
  runtimeFirst.pointerY !== 8
) {
  throw new Error(`unexpected first runtime input ${JSON.stringify(runtimeFirst)}`);
}
const runtimeSecond = input.runtimeState();
if (
  runtimeSecond.clickCount !== 0 ||
  runtimeSecond.keyPressCount !== 0 ||
  runtimeSecond.pointerValid !== true ||
  runtimeSecond.pointerButton !== 1
) {
  throw new Error(`unexpected second runtime input ${JSON.stringify(runtimeSecond)}`);
}

canvas.dispatchEvent(eventWith("pointerup", { button: 0 }));
const runtimeThird = input.runtimeState();
if (runtimeThird.pointerValid !== false) {
  throw new Error(`unexpected third runtime input ${JSON.stringify(runtimeThird)}`);
}

const cancelCanvas = new FakeCanvas();
let cancelChangeCount = 0;
const cancelInput = createInputController(cancelCanvas, {
  keyboardTarget: new EventTarget(),
  onChange: () => {
    cancelChangeCount += 1;
  },
});
cancelCanvas.dispatchEvent(eventWith("pointerdown", {
  clientX: 20,
  clientY: 30,
  button: 0,
  pointerId: 11,
}));
assert.equal(cancelInput.cancelActivePointerClicks(), 1);
assert.equal(cancelInput.snapshot().clickCount, 0);
assert.equal(cancelInput.runtimeState().clickCount, 0);
assert.equal(cancelInput.runtimeState().pointerValid, false);
assert.equal(cancelChangeCount, 2);

const gesture = createTwoFingerDoubleTapRecognizer();
let gestureTime = 1000;
assert.deepEqual(
  gesture.pointerDown(pointerEvent("pointerdown", 21, 100, 100)),
  { suppress: false, recognized: false },
);
assert.deepEqual(
  gesture.pointerDown(pointerEvent("pointerdown", 22, 160, 100)),
  { suppress: true, recognized: false },
);
assert.deepEqual(
  gesture.pointerUp(pointerEvent("pointerup", 21, 100, 100)),
  { suppress: true, recognized: false },
);
assert.deepEqual(
  gesture.pointerUp(pointerEvent("pointerup", 22, 160, 100)),
  { suppress: true, recognized: false },
);
gestureTime += 140;
gesture.pointerDown(pointerEvent("pointerdown", 23, 102, 101));
gesture.pointerDown(pointerEvent("pointerdown", 24, 162, 101));
gesture.pointerUp(pointerEvent("pointerup", 23, 102, 101));
assert.deepEqual(
  gesture.pointerUp(pointerEvent("pointerup", 24, 162, 101)),
  { suppress: true, recognized: true },
);

console.log("input_controller_smoke=ok");

function eventWith(type, properties) {
  const event = new Event(type);
  for (const [key, value] of Object.entries(properties)) {
    Object.defineProperty(event, key, { value });
  }
  return event;
}

function pointerEvent(type, pointerId, clientX, clientY) {
  gestureTime += 20;
  return eventWith(type, {
    pointerType: "touch",
    pointerId,
    clientX,
    clientY,
    timeStamp: gestureTime,
  });
}
