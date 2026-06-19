const SCREEN_WIDTH = 1280;
const SCREEN_HEIGHT = 720;
const PANEL_X = 279;
const PANEL_Y = 239;
const BUTTON_Y = 392;
const BUTTON_STATE_COUNT = 4;
const BUTTON_GAP = 20;

const PANEL_KEYS = Object.freeze({
  exit: "exit",
  title: "title",
  save: "save",
  overwrite: "overwrite",
  load: "load",
  delete: "delete",
  quickSave: "quickSave",
});
const NOTICE_KINDS = new Set(["quickSave"]);

const imageCanvasCache = new WeakMap();

export function createScenarioDialogState() {
  return {
    open: false,
    kind: "",
    source: "",
    hover: null,
    lastAction: "",
    result: "",
  };
}

export function openScenarioDialog(state, kind, source = "") {
  if (!state || !PANEL_KEYS[kind]) {
    return false;
  }
  state.open = true;
  state.kind = kind;
  state.source = source;
  state.hover = null;
  state.lastAction = "open";
  state.result = "";
  return true;
}

export function closeScenarioDialog(state, result = "cancel") {
  if (!state) {
    return false;
  }
  state.open = false;
  state.hover = null;
  state.lastAction = "closed";
  state.result = result;
  return true;
}

export function scenarioDialogControlAt(x, y, state, skin) {
  if (!state?.open || !skin) {
    return null;
  }
  const panel = dialogPanelImage(state, skin);
  const yes = skin.buttons?.yes ?? null;
  const no = skin.buttons?.no ?? null;
  if (NOTICE_KINDS.has(state.kind)) {
    return panel ? { kind: "notice", action: "ack" } : null;
  }
  if (!panel || !yes || !no) {
    return null;
  }
  const scaled = {
    x: x * SCREEN_WIDTH / SCREEN_WIDTH,
    y: y * SCREEN_HEIGHT / SCREEN_HEIGHT,
  };
  const stateWidth = imageStateWidth(yes, BUTTON_STATE_COUNT);
  const totalWidth = stateWidth * 2 + BUTTON_GAP;
  const yesX = PANEL_X + Math.round((imageLogicalWidth(panel) - totalWidth) / 2);
  const noX = yesX + stateWidth + BUTTON_GAP;
  if (
    scaled.y >= BUTTON_Y
    && scaled.y < BUTTON_Y + imageLogicalHeight(yes)
    && scaled.x >= yesX
    && scaled.x < yesX + stateWidth
  ) {
    return { kind: "button", action: "yes" };
  }
  if (
    scaled.y >= BUTTON_Y
    && scaled.y < BUTTON_Y + imageLogicalHeight(no)
    && scaled.x >= noX
    && scaled.x < noX + stateWidth
  ) {
    return { kind: "button", action: "no" };
  }
  return null;
}

export function applyScenarioDialogControl(state, control) {
  if (!control) {
    return { handled: false, reason: "none" };
  }
  if (NOTICE_KINDS.has(state?.kind)) {
    closeScenarioDialog(state, "ack");
    return { handled: true, reason: "ack", ok: true };
  }
  if (control.kind === "notice") {
    closeScenarioDialog(state, "ack");
    return { handled: true, reason: "ack", ok: true };
  }
  if (control.kind !== "button") {
    return { handled: false, reason: "unsupported" };
  }
  const result = control.action === "yes" ? "yes" : "no";
  closeScenarioDialog(state, result);
  return { handled: true, reason: result, ok: result === "yes" };
}

export function scenarioDialogHoverKey(control) {
  return control?.kind === "button" ? control.action : null;
}

export function paintScenarioDialogWindow(context, canvas, skin, state) {
  if (!state?.open || !skin) {
    return false;
  }
  const panel = dialogPanelImage(state, skin);
  const yes = skin.buttons?.yes ?? null;
  const no = skin.buttons?.no ?? null;
  if (!panel) {
    return false;
  }
  context.save();
  context.scale(canvas.width / SCREEN_WIDTH, canvas.height / SCREEN_HEIGHT);
  drawRgbaImage(context, panel, PANEL_X, PANEL_Y);
  if (NOTICE_KINDS.has(state.kind)) {
    context.restore();
    return true;
  }
  if (!yes || !no) {
    context.restore();
    return false;
  }
  const stateWidth = imageStateWidth(yes, BUTTON_STATE_COUNT);
  const totalWidth = stateWidth * 2 + BUTTON_GAP;
  const yesX = PANEL_X + Math.round((imageLogicalWidth(panel) - totalWidth) / 2);
  const noX = yesX + stateWidth + BUTTON_GAP;
  drawStateImage(context, yes, yesX, BUTTON_Y, state.hover === "yes" ? 1 : 0);
  drawStateImage(context, no, noX, BUTTON_Y, state.hover === "no" ? 1 : 0);
  context.restore();
  return true;
}

function dialogPanelImage(state, skin) {
  return skin.panels?.[PANEL_KEYS[state.kind]] ?? null;
}

function drawStateImage(context, image, x, y, sourceIndex) {
  const stateWidth = imageStateWidth(image, BUTTON_STATE_COUNT);
  const sourceStateWidth = imageSourceStateWidth(image, BUTTON_STATE_COUNT);
  context.drawImage(
    rgbaCanvas(image),
    Math.max(0, Math.min(sourceIndex, BUTTON_STATE_COUNT - 1)) * sourceStateWidth,
    0,
    sourceStateWidth,
    image.height,
    x,
    y,
    stateWidth,
    imageLogicalHeight(image),
  );
}

function imageStateWidth(image, stateCount) {
  return image ? Math.floor(imageLogicalWidth(image) / stateCount) : 0;
}

function imageSourceStateWidth(image, stateCount) {
  return image ? Math.floor(image.width / stateCount) : 0;
}

function drawRgbaImage(context, image, x, y) {
  context.drawImage(rgbaCanvas(image), x, y, imageLogicalWidth(image), imageLogicalHeight(image));
}

function imageLogicalWidth(image) {
  return Number.isFinite(image?.logicalWidth) && image.logicalWidth > 0
    ? image.logicalWidth
    : image?.width ?? 0;
}

function imageLogicalHeight(image) {
  return Number.isFinite(image?.logicalHeight) && image.logicalHeight > 0
    ? image.logicalHeight
    : image?.height ?? 0;
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
