const SCREEN_WIDTH = 1280;
const SCREEN_HEIGHT = 720;
export const USER_DATA_SLOTS_PER_PAGE = 9;

const SLOT_WIDTH = 392;
const SLOT_HEIGHT = 160;
const SLOT_GAP_X = 24;
const SLOT_GAP_Y = 12;
const SLOT_X = 28;
const SLOT_Y = 112;
const BUTTON_Y = 650;
const BUTTONS = Object.freeze([
  { kind: "previous", key: "previous", x: 448, y: BUTTON_Y },
  { kind: "next", key: "next", x: 596, y: BUTTON_Y },
  { kind: "action", saveKey: "save", loadKey: "load", x: 744, y: BUTTON_Y },
  { kind: "back", key: "back", x: 892, y: BUTTON_Y },
]);
const imageCanvasCache = new WeakMap();

export function createScenarioUserDataState() {
  return {
    open: false,
    mode: "save",
    page: 0,
    hover: null,
    selectedSlot: 0,
  };
}

export function openScenarioUserDataWindow(state, mode) {
  state.open = true;
  state.mode = mode === "load" ? "load" : "save";
  state.hover = null;
  state.selectedSlot = state.page * USER_DATA_SLOTS_PER_PAGE;
}

export function closeScenarioUserDataWindow(state) {
  state.open = false;
  state.hover = null;
}

export function scenarioUserDataControlAt(x, y, state, skin) {
  if (!state?.open || !skin) {
    return null;
  }
  const scaled = scalePoint(x, y);
  const slot = slotAt(scaled.x, scaled.y, state.page);
  if (slot !== null) {
    return { kind: "slot", slot };
  }
  for (const button of BUTTONS) {
    const image = buttonImage(skin, state.mode, button);
    const stateWidth = imageStateWidth(image);
    if (
      image
      && scaled.x >= button.x
      && scaled.x < button.x + stateWidth
      && scaled.y >= button.y
      && scaled.y < button.y + image.height
    ) {
      return {
        kind: button.kind,
        action: button.kind === "action" ? state.mode : button.kind,
      };
    }
  }
  return null;
}

export function applyScenarioUserDataControl(state, control, actions) {
  if (!control) {
    return { handled: false, reason: "none" };
  }
  switch (control.kind) {
    case "slot":
      state.selectedSlot = control.slot;
      return state.mode === "save"
        ? actions.save(control.slot)
        : actions.load(control.slot);
    case "previous":
      state.page = Math.max(0, state.page - 1);
      state.selectedSlot = state.page * USER_DATA_SLOTS_PER_PAGE;
      return { handled: true, reason: "page" };
    case "next":
      state.page = Math.min(99, state.page + 1);
      state.selectedSlot = state.page * USER_DATA_SLOTS_PER_PAGE;
      return { handled: true, reason: "page" };
    case "action":
      return state.mode === "save"
        ? actions.save(state.selectedSlot)
        : actions.load(state.selectedSlot);
    case "back":
      closeScenarioUserDataWindow(state);
      return { handled: true, reason: "closed" };
    default:
      return { handled: false, reason: "unsupported" };
  }
}

export function userDataHoverKey(control) {
  if (control?.kind === "slot") {
    return `slot:${control.slot}`;
  }
  return control?.action ?? control?.kind ?? null;
}

export function paintScenarioUserDataWindow(context, canvas, skin, state, records) {
  if (!state?.open || !skin) {
    return false;
  }
  context.save();
  context.scale(canvas.width / SCREEN_WIDTH, canvas.height / SCREEN_HEIGHT);
  const base = state.mode === "load" ? skin.loadBase : skin.saveBase;
  if (base) {
    drawRgbaImage(context, base, 0, 0);
  } else {
    context.fillStyle = state.mode === "load" ? "#0b76a6" : "#8c3c78";
    context.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
  }
  drawSlots(context, skin, state, records);
  drawButtons(context, skin, state);
  context.restore();
  return true;
}

function drawSlots(context, skin, state, records) {
  for (let index = 0; index < USER_DATA_SLOTS_PER_PAGE; index += 1) {
    const slot = state.page * USER_DATA_SLOTS_PER_PAGE + index;
    const column = index % 3;
    const row = Math.floor(index / 3);
    const x = SLOT_X + column * (SLOT_WIDTH + SLOT_GAP_X);
    const y = SLOT_Y + row * (SLOT_HEIGHT + SLOT_GAP_Y);
    const frame = state.mode === "load" ? skin.loadSlot : skin.saveSlot;
    if (frame) {
      drawRgbaImage(context, frame, x, y);
    }
    const hover = state.hover === `slot:${slot}`;
    if (hover) {
      context.save();
      context.globalAlpha = 0.22;
      context.fillStyle = state.mode === "load" ? "#43c8ff" : "#ff6fbd";
      context.fillRect(x + 4, y + 4, SLOT_WIDTH - 8, SLOT_HEIGHT - 8);
      context.restore();
    }
    drawSlotNumber(context, skin, slot, x + 18, y + 14);
    drawSlotRecord(context, records[index], x, y);
  }
}

function drawSlotRecord(context, record, x, y) {
  context.save();
  context.fillStyle = "#2c2925";
  context.textBaseline = "top";
  context.font = "20px 'Noto Serif CJK JP', 'Yu Mincho', 'MS Mincho', serif";
  if (!record?.exists) {
    context.globalAlpha = 0.55;
    context.fillText("No Data", x + 76, y + 56);
    context.restore();
    return;
  }
  context.fillText(record.scenarioName || "Scenario", x + 76, y + 24);
  context.font = "16px 'Noto Serif CJK JP', 'Yu Mincho', 'MS Mincho', serif";
  context.fillText(`Event ${record.eventCount ?? 0}`, x + 76, y + 56);
  if (record.savedAt) {
    context.fillText(record.savedAt, x + 76, y + 82);
  }
  const text = (record.text ?? "").replace(/\s+/g, " ").slice(0, 34);
  if (text) {
    context.fillText(text, x + 76, y + 110);
  }
  context.restore();
}

function drawSlotNumber(context, skin, slot, x, y) {
  const text = String(slot + 1).padStart(2, "0");
  let cursor = x;
  for (const digit of text) {
    const image = skin.digits?.[Number(digit)] ?? null;
    if (image) {
      drawRgbaImage(context, image, cursor, y);
      cursor += image.width;
    }
  }
}

function drawButtons(context, skin, state) {
  for (const button of BUTTONS) {
    const image = buttonImage(skin, state.mode, button);
    if (!image) continue;
    const stateWidth = imageStateWidth(image);
    const sourceIndex = state.hover === (button.kind === "action" ? state.mode : button.kind)
      ? 1
      : 0;
    context.drawImage(
      rgbaCanvas(image),
      sourceIndex * stateWidth,
      0,
      stateWidth,
      image.height,
      button.x,
      button.y,
      stateWidth,
      image.height,
    );
  }
}

function buttonImage(skin, mode, button) {
  const key = button.kind === "action"
    ? (mode === "load" ? button.loadKey : button.saveKey)
    : button.key;
  return skin.buttons?.[key] ?? null;
}

function imageStateWidth(image) {
  return image ? Math.floor(image.width / 4) : 0;
}

function slotAt(x, y, page) {
  for (let index = 0; index < USER_DATA_SLOTS_PER_PAGE; index += 1) {
    const column = index % 3;
    const row = Math.floor(index / 3);
    const slotX = SLOT_X + column * (SLOT_WIDTH + SLOT_GAP_X);
    const slotY = SLOT_Y + row * (SLOT_HEIGHT + SLOT_GAP_Y);
    if (
      x >= slotX
      && x < slotX + SLOT_WIDTH
      && y >= slotY
      && y < slotY + SLOT_HEIGHT
    ) {
      return page * USER_DATA_SLOTS_PER_PAGE + index;
    }
  }
  return null;
}

function scalePoint(x, y) {
  return {
    x: x * SCREEN_WIDTH / SCREEN_WIDTH,
    y: y * SCREEN_HEIGHT / SCREEN_HEIGHT,
  };
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
