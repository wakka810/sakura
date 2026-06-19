import { bgiFontByNumber } from "./bgi-fonts.js";
import { drawBgiText } from "./bgi-text-renderer.js";
import { stripScenarioTags } from "./scenario-text.js";

const VISIBLE_ENTRY_COUNT = 4;
const ENTRY_HEIGHT = 160;
const PANEL_WIDTH = 1280;
const PANEL_HEIGHT = 720;
const CONTROL_X = 1224;
const TRACK_X = 1232;
const TRACK_Y = 104;
const TRACK_HEIGHT = 512;
const THUMB_HEIGHT = 112;
const TEXT_X = 107;
const NAME_Y = 51;
const TEXT_Y = 91;
const VOICE_X = 47;
const VOICE_Y = 32;
const imageCanvasCache = new WeakMap();

export function createScenarioBacklogState() {
  return {
    open: false,
    firstIndex: 0,
    hoverControl: null,
    replayingIndex: -1,
  };
}

export function openScenarioBacklog(state, entryCount) {
  state.open = true;
  state.firstIndex = maxFirstIndex(entryCount);
  state.hoverControl = null;
}

export function closeScenarioBacklog(state) {
  state.open = false;
  state.hoverControl = null;
  state.replayingIndex = -1;
}

export function scrollScenarioBacklog(state, entryCount, delta) {
  const next = Math.max(
    0,
    Math.min(maxFirstIndex(entryCount), state.firstIndex + Math.trunc(delta)),
  );
  const changed = next !== state.firstIndex;
  state.firstIndex = next;
  return changed;
}

export function setScenarioBacklogPosition(state, entryCount, firstIndex) {
  state.firstIndex = Math.max(
    0,
    Math.min(maxFirstIndex(entryCount), Math.trunc(firstIndex)),
  );
}

export function scenarioBacklogControlAt(x, y, state, entries) {
  if (x >= CONTROL_X && x < CONTROL_X + 32) {
    if (y >= 0 && y < 56) return { kind: "page-up" };
    if (y >= 64 && y < 96) return { kind: "line-up" };
    if (y >= 624 && y < 656) return { kind: "line-down" };
    if (y >= 664 && y < 720) return { kind: "page-down" };
  }
  if (x >= TRACK_X && x < TRACK_X + 15 && y >= TRACK_Y && y < TRACK_Y + TRACK_HEIGHT) {
    const thumbY = scenarioBacklogThumbY(state, entries.length);
    if (y < thumbY) return { kind: "page-up" };
    if (y >= thumbY + THUMB_HEIGHT) return { kind: "page-down" };
    return { kind: "thumb" };
  }
  if (x >= 31 && x < 96) {
    const slot = Math.floor((y - VOICE_Y) / ENTRY_HEIGHT);
    const entryIndex = state.firstIndex + slot;
    if (
      slot >= 0
      && slot < VISIBLE_ENTRY_COUNT
      && y < VOICE_Y + slot * ENTRY_HEIGHT + 48
      && entries[entryIndex]?.voiceName
    ) {
      return { kind: "voice", entryIndex };
    }
  }
  return null;
}

export function applyScenarioBacklogControl(state, entryCount, control) {
  switch (control?.kind) {
    case "line-up":
      return scrollScenarioBacklog(state, entryCount, -1);
    case "line-down":
      return scrollScenarioBacklog(state, entryCount, 1);
    case "page-up":
      return scrollScenarioBacklog(state, entryCount, -VISIBLE_ENTRY_COUNT);
    case "page-down":
      return scrollScenarioBacklog(state, entryCount, VISIBLE_ENTRY_COUNT);
    default:
      return false;
  }
}

export function scenarioBacklogThumbY(state, entryCount) {
  const maximum = maxFirstIndex(entryCount);
  const travel = TRACK_HEIGHT - THUMB_HEIGHT;
  return TRACK_Y + (maximum === 0 ? travel : Math.round(state.firstIndex / maximum * travel));
}

export function paintScenarioBacklog(context, canvas, entries, skin, state) {
  if (!state?.open || !skin?.panel) {
    return false;
  }
  context.save();
  context.scale(canvas.width / PANEL_WIDTH, canvas.height / PANEL_HEIGHT);
  drawRgbaImage(context, skin.panel, 0, 0);
  drawLogControls(context, entries.length, skin, state);
  drawLogEntries(context, entries, skin, state);
  context.restore();
  return true;
}

function drawLogControls(context, entryCount, skin, state) {
  drawStateImage(context, skin.pageUp, CONTROL_X, 0, state.hoverControl === "page-up");
  drawStateImage(context, skin.lineUp, CONTROL_X, 64, state.hoverControl === "line-up");
  drawRgbaImage(context, skin.track, TRACK_X, TRACK_Y);
  drawStateImage(
    context,
    skin.thumb,
    CONTROL_X,
    scenarioBacklogThumbY(state, entryCount),
    state.hoverControl === "thumb",
  );
  drawStateImage(context, skin.lineDown, CONTROL_X, 624, state.hoverControl === "line-down");
  drawStateImage(context, skin.pageDown, CONTROL_X, 664, state.hoverControl === "page-down");
}

function drawLogEntries(context, entries, skin, state) {
  context.fillStyle = "#24211f";
  context.textBaseline = "top";
  for (let slot = 0; slot < VISIBLE_ENTRY_COUNT; slot += 1) {
    const entryIndex = state.firstIndex + slot;
    const entry = entries[entryIndex];
    if (!entry) continue;
    const baseY = slot * ENTRY_HEIGHT;
    if (entry.voiceName && skin.voice) {
      drawStateImage(
        context,
        skin.voice,
        VOICE_X - Math.floor((skin.voice.stateWidth - 32) / 2),
        VOICE_Y + baseY,
        state.hoverControl === `voice:${entryIndex}`,
      );
    }
    if (entry.name) {
      context.font = bgiFontByNumber(entry.style?.fontNumber ?? 0, 18, entry.style?.fontWeight === 1 ? "bold" : "");
      drawSpacedWrappedText(context, entry.name, TEXT_X, NAME_Y + baseY, 1080, 32, 1, 0);
    }
    context.font = bgiFontByNumber(entry.style?.fontNumber ?? 0, 20, entry.style?.fontWeight === 1 ? "bold" : "");
    drawSpacedWrappedText(
      context,
      visibleBacklogText(entry.text),
      TEXT_X,
      TEXT_Y + baseY,
      1080,
      40,
      2,
      0,
    );
  }
}

function drawStateImage(context, control, x, y, hovered) {
  if (!control?.image) return;
  const sourceStateWidth = control.sourceStateWidth ?? control.stateWidth;
  const sourceStateHeight = control.sourceStateHeight ?? control.image.height;
  const sourceX = hovered ? sourceStateWidth : 0;
  context.drawImage(
    rgbaCanvas(control.image),
    sourceX,
    0,
    sourceStateWidth,
    sourceStateHeight,
    x,
    y,
    control.stateWidth,
    control.stateHeight,
  );
}

function drawRgbaImage(context, image, x, y) {
  if (!image) return;
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
  if (cached) return cached;
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

function drawSpacedWrappedText(
  context,
  text,
  x,
  y,
  maxWidth,
  lineHeight,
  maxLines,
  spacing,
) {
  let cursorX = x;
  let cursorY = y;
  let lines = 1;
  for (const char of Array.from(text)) {
    if (char === "\n") {
      lines += 1;
      if (lines > maxLines) return;
      cursorX = x;
      cursorY += lineHeight;
      continue;
    }
    const width = context.measureText(char).width;
    if (cursorX > x && cursorX + width > x + maxWidth) {
      lines += 1;
      if (lines > maxLines) return;
      cursorX = x;
      cursorY += lineHeight;
    }
    drawBgiText(context, char, cursorX, cursorY);
    cursorX += width + spacing;
  }
}

function visibleBacklogText(text) {
  const stripped = stripScenarioTags(text);
  return stripped.startsWith("\u3000") ? stripped.slice(1) : stripped;
}

function maxFirstIndex(entryCount) {
  return Math.max(0, entryCount - VISIBLE_ENTRY_COUNT);
}
