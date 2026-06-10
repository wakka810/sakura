export function createInputController(canvas, options = {}) {
  const keyboardTarget = options.keyboardTarget ?? window;
  const onChange = options.onChange ?? (() => {});
  const keysDown = new Set();
  const state = {
    totalClickCount: 0,
    totalKeyPressCount: 0,
    pendingClickCount: 0,
    pendingKeyPressCount: 0,
    lastPointer: null,
    pointerValid: false,
    pressedPointerButton: 0,
  };

  canvas.tabIndex = 0;
  canvas.addEventListener("pointerdown", (event) => {
    updatePointerState(canvas, state, event);
    state.pressedPointerButton = state.lastPointer?.button ?? 0;
    state.totalClickCount += 1;
    state.pendingClickCount += 1;
    canvas.focus();
    onChange();
  });
  canvas.addEventListener("pointermove", (event) => {
    updatePointerState(canvas, state, event);
    onChange();
  });
  canvas.addEventListener("pointerup", () => {
    state.pointerValid = false;
    state.pressedPointerButton = 0;
    onChange();
  });
  canvas.addEventListener("pointerleave", () => {
    state.pointerValid = false;
    state.pressedPointerButton = 0;
    onChange();
  });

  keyboardTarget.addEventListener("keydown", (event) => {
    if (!keysDown.has(event.key)) {
      state.totalKeyPressCount += 1;
      state.pendingKeyPressCount += 1;
    }
    keysDown.add(event.key);
    onChange();
  });

  keyboardTarget.addEventListener("keyup", (event) => {
    keysDown.delete(event.key);
    onChange();
  });

  return {
    snapshot: () => ({
      clickCount: state.totalClickCount,
      keyPressCount: state.totalKeyPressCount,
      lastPointer: state.lastPointer,
      keysDown: Array.from(keysDown).sort(),
    }),
    runtimeState: () => {
      const runtimeState = {
        clickCount: state.pendingClickCount,
        keyPressCount: state.pendingKeyPressCount,
        pointerX: state.lastPointer?.x ?? 0,
        pointerY: state.lastPointer?.y ?? 0,
        pointerButton: state.pressedPointerButton,
        pointerValid: state.pointerValid,
        keyEnterDown: keysDown.has("Enter"),
        keySpaceDown: keysDown.has(" "),
        keyUpDown: keysDown.has("ArrowUp"),
        keyDownDown: keysDown.has("ArrowDown"),
        keyLeftDown: keysDown.has("ArrowLeft"),
        keyRightDown: keysDown.has("ArrowRight"),
      };
      state.pendingClickCount = 0;
      state.pendingKeyPressCount = 0;
      return runtimeState;
    },
  };
}

function updatePointerState(canvas, state, event) {
  const rect = canvas.getBoundingClientRect();
  state.lastPointer = {
    x: Math.round(event.clientX - rect.left),
    y: Math.round(event.clientY - rect.top),
    button: Number.isInteger(event.button) ? event.button + 1 : 0,
  };
  state.pointerValid = true;
}
