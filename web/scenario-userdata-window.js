// Faithful Save/Load (UserData) window — reconstruction of usdtwnd._bp
// (system index 22) + the SGUsDtWnd* sysgrp.arc art family.
//
// Geometry/asset assignment was extracted from the shipped SGUsDtWnd* assets
// (sizes/state counts) and the usdtwnd._bp draw script:
//
// * Base bg SGUsDtWnd990000 (save) / 990100 (load), 1280x720 — carries the
//   "Save"/"Load" title + feather and the baked "Page:" label and "/" glyph.
//   The slot cards and every button are drawn ON TOP of the base (none baked).
// * Top-nav buttons SGUsDtWnd1000NN (556x43, 4 states x139), y=40:
//     Previous=100000, Next=100100, Top=100200, Last=100300.
//   Laid out Top(44)/Previous(196) top-left, Next(940)/Last(1092) top-right.
//   Top is disabled on the first page, Last on the last page (Wine page 1/10:
//   Top=gray/disabled, Previous/Next/Last=idle).
// * Bottom buttons SGUsDtWnd2000NN (576x52, 4 states x144), y=650, evenly
//   spaced x=44,200,356,512,668,824 (step 156):
//     Load=200000, Back=200100, Exit=200200, Delete=200300, Move=200400,
//     Copy=200500, Save=200600.
//   Slot 0 is the mode toggle: it shows "Load" (200000, blue idle) on the Save
//   screen and "Save" (200600, blue idle) on the Load screen. Delete/Move/Copy
//   render in their disabled (gray) state — matching the Wine capture.
// * Slot frames SGUsDtWnd900000 (pink, save) / 900100 (blue, load), 392x160.
//   3x3 grid: columns x=44,444,844 (step 400), rows y=110,284,458 (step 174).
// * Digits SGUsDtWnd00000N (24x48, black serif) render the page number around
//   the baked "/" — current page right-aligned, total-page count left-aligned.

import { bgiGothicFont } from "./bgi-fonts.js";
import { drawBgiText } from "./bgi-text-renderer.js";
import { stripScenarioTags } from "./scenario-text.js";

const SCREEN_WIDTH = 1280;
const SCREEN_HEIGHT = 720;

export const USER_DATA_SLOTS_PER_PAGE = 9;
export const USER_DATA_TOTAL_PAGES = 10; // Wine shows "Page: 1 / 10".
export const USER_DATA_PREVIEW_WIDTH = 160;
export const USER_DATA_PREVIEW_HEIGHT = 90;

const BUTTON_STATES = 4; // 0=idle, 1=hover, 2=pressed, 3=disabled.
const USER_DATA_PREVIEW_MAX_DATA_URL_LENGTH = 256 * 1024;

// Slot grid (392x160 frames).
const SLOT_WIDTH = 392;
const SLOT_HEIGHT = 160;
const SLOT_COLUMNS_X = Object.freeze([44, 444, 844]);
const SLOT_ROWS_Y = Object.freeze([110, 284, 458]);

// Slot content offsets (relative to the slot's top-left). usdtwnd._bp draws
// the saved thumbnail image at 36,12 and text buffers at 210,16 / 38,110.
const THUMB_DX = 36;
const THUMB_DY = 12;
const THUMB_W = USER_DATA_PREVIEW_WIDTH;
const THUMB_H = USER_DATA_PREVIEW_HEIGHT;
const DATE_DX = 210;
const DATE_DY = 16;
const DATE_TEXT_DY = 2;
const DATE_LINE_H = 22;
const DATE_CELL_W = 17.5;
const DATE_SCALE_X = 2;
const BODY_DX = 38;
const BODY_DY = 110;
const BODY_TEXT_DX = -2;
const BODY_TEXT_DY = 2;
const BODY_W = 324;
const TEXT_BLUE = "rgb(0, 71, 157)"; // decompiled color 0x479D (usdtwnd._bp @0x1222).
const USER_DATA_DATE_FONT = bgiGothicFont(18);
const USER_DATA_BODY_FONT = bgiGothicFont(18);

// Top navigation buttons (556x43 sheets).
const TOP_Y = 40;
const TOP_BUTTONS = Object.freeze([
  { role: "top", image: "top", x: 44 },
  { role: "previous", image: "previous", x: 196 },
  { role: "next", image: "next", x: 940 },
  { role: "last", image: "last", x: 1092 },
]);

// Bottom row buttons (576x52 sheets).
const BOTTOM_Y = 650;
const BOTTOM_BUTTONS = Object.freeze([
  { role: "toggle", x: 44 }, // image is mode-dependent (load on save screen, save on load screen)
  { role: "back", image: "back", x: 200 },
  { role: "exit", image: "exit", x: 356 },
  { role: "delete", image: "delete", x: 512, alwaysDisabled: true },
  { role: "move", image: "move", x: 668, alwaysDisabled: true },
  { role: "copy", image: "copy", x: 824, alwaysDisabled: true },
]);

// Page-number digits drawn around the baked "/" (center x ~1172). The 24x48
// sprites are scaled down so the visible glyph is ~30px tall, matching Wine.
const PAGE_DIGIT_H = 40;
const PAGE_DIGIT_Y = 654;
const PAGE_CURRENT_RIGHT_X = 1156; // right edge of the current-page number
const PAGE_TOTAL_LEFT_X = 1189; // left edge of the total-page number

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

function lastPageIndex() {
  return USER_DATA_TOTAL_PAGES - 1;
}

// A button is disabled when it cannot act on the current page/mode.
function buttonDisabled(role, state) {
  switch (role) {
    case "top":
      return state.page <= 0;
    case "last":
      return state.page >= lastPageIndex();
    case "delete":
    case "move":
    case "copy":
      return true; // shown in the Wine capture as disabled (gray).
    default:
      return false;
  }
}

// The mode-toggle button shows the OTHER mode's action: "load" on the save
// screen, "save" on the load screen.
function toggleImageKey(state) {
  return state.mode === "save" ? "load" : "save";
}

export function scenarioUserDataControlAt(x, y, state, skin) {
  if (!state?.open || !skin) {
    return null;
  }
  // Slots.
  const slot = slotAt(x, y, state.page);
  if (slot !== null) {
    return { kind: "slot", slot };
  }
  // Top navigation.
  for (const button of TOP_BUTTONS) {
    const image = skin.buttons?.[button.image] ?? null;
    if (!image || buttonDisabled(button.role, state)) {
      continue;
    }
    if (hitButton(x, y, button.x, TOP_Y, image)) {
      return { kind: "nav", action: button.role };
    }
  }
  // Bottom row.
  for (const button of BOTTOM_BUTTONS) {
    if (button.alwaysDisabled || buttonDisabled(button.role, state)) {
      continue;
    }
    const imageKey = button.role === "toggle" ? toggleImageKey(state) : button.image;
    const image = skin.buttons?.[imageKey] ?? null;
    if (!image) {
      continue;
    }
    if (hitButton(x, y, button.x, BOTTOM_Y, image)) {
      if (button.role === "toggle") {
        return { kind: "toggle", action: state.mode === "save" ? "load" : "save" };
      }
      return { kind: button.role === "back" || button.role === "exit" ? "close" : button.role, action: button.role };
    }
  }
  return null;
}

export function applyScenarioUserDataControl(state, control, actions = {}) {
  if (!control) {
    return { handled: false, reason: "none" };
  }
  switch (control.kind) {
    case "slot":
      state.selectedSlot = control.slot;
      return state.mode === "save"
        ? (actions.save?.(control.slot) ?? { handled: true, reason: "save" })
        : (actions.load?.(control.slot) ?? { handled: true, reason: "load" });
    case "nav":
      return applyNav(state, control.action);
    case "toggle":
      state.mode = control.action === "load" ? "load" : "save";
      state.hover = null;
      state.selectedSlot = state.page * USER_DATA_SLOTS_PER_PAGE;
      return { handled: true, reason: `mode_${state.mode}` };
    case "close":
      closeScenarioUserDataWindow(state);
      return { handled: true, reason: "closed" };
    default:
      return { handled: false, reason: "unsupported" };
  }
}

function applyNav(state, action) {
  const last = lastPageIndex();
  switch (action) {
    case "top":
      state.page = 0;
      break;
    case "previous":
      state.page = Math.max(0, state.page - 1);
      break;
    case "next":
      state.page = Math.min(last, state.page + 1);
      break;
    case "last":
      state.page = last;
      break;
    default:
      return { handled: false, reason: "unsupported" };
  }
  state.selectedSlot = state.page * USER_DATA_SLOTS_PER_PAGE;
  return { handled: true, reason: "page" };
}

export function userDataHoverKey(control) {
  if (!control) {
    return null;
  }
  if (control.kind === "slot") {
    return `slot:${control.slot}`;
  }
  return control.action ?? control.kind ?? null;
}

export function normalizeUserDataPreviewDataUrl(value) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > USER_DATA_PREVIEW_MAX_DATA_URL_LENGTH
    || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value)
  ) {
    return "";
  }
  return value;
}

export function resolveUserDataPreviewImage(dataUrl, cache, onReady = null) {
  const normalized = normalizeUserDataPreviewDataUrl(dataUrl);
  if (!normalized || !(cache instanceof Map)) {
    return null;
  }
  const cached = cache.get(normalized);
  if (cached) {
    return cached.image ?? null;
  }
  if (typeof globalThis.Image !== "function") {
    return null;
  }
  cache.set(normalized, { status: "loading", image: null });
  const element = new globalThis.Image();
  element.onload = () => {
    const width = element.naturalWidth || element.width || USER_DATA_PREVIEW_WIDTH;
    const height = element.naturalHeight || element.height || USER_DATA_PREVIEW_HEIGHT;
    const image = { source: element, width, height, logicalWidth: width, logicalHeight: height };
    cache.set(normalized, { status: "ready", image });
    onReady?.(image);
  };
  element.onerror = () => {
    cache.set(normalized, { status: "missing", image: null });
    onReady?.(null);
  };
  element.src = normalized;
  return null;
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
  drawSlots(context, skin, state, records ?? []);
  drawTopButtons(context, skin, state);
  drawBottomButtons(context, skin, state);
  drawPageNumber(context, skin, state);
  context.restore();
  return true;
}

function drawSlots(context, skin, state, records) {
  const frame = state.mode === "load" ? skin.loadSlot : skin.saveSlot;
  for (let index = 0; index < USER_DATA_SLOTS_PER_PAGE; index += 1) {
    const slot = state.page * USER_DATA_SLOTS_PER_PAGE + index;
    const x = SLOT_COLUMNS_X[index % 3];
    const y = SLOT_ROWS_Y[Math.floor(index / 3)];
    if (frame) {
      drawRgbaImage(context, frame, x, y);
    }
    drawSlotRecord(context, records[index], x, y);
  }
}

function drawSlotRecord(context, record, x, y) {
  if (!record?.exists) {
    // Empty slots are blank in the original — no "No Data" label.
    return;
  }
  context.save();
  // Thumbnail (the saved scene CG), fit into the original 160x90 save-data box.
  if (record.thumbnail) {
    drawThumbnailFit(context, record.thumbnail, x + THUMB_DX, y + THUMB_DY, THUMB_W, THUMB_H);
  }
  // usdtwnd._bp builds `%02d/%02d/%02d.%02d:%02d:%02d`, renders it through
  // Graph:9c into buffer 121, then places that buffer at 210,16. The engine's
  // text buffer lays the date and time as two rows in the shipped Load capture.
  const { date, time } = formatSavedAt(record.savedAt);
  context.fillStyle = TEXT_BLUE;
  context.textBaseline = "top";
  context.font = USER_DATA_DATE_FONT;
  if (date) {
    drawFixedCellText(context, date, x + DATE_DX, y + DATE_DY + DATE_TEXT_DY, DATE_CELL_W, DATE_SCALE_X);
  }
  if (time) {
    drawFixedCellText(
      context,
      time,
      x + DATE_DX,
      y + DATE_DY + DATE_TEXT_DY + DATE_LINE_H,
      DATE_CELL_W,
      DATE_SCALE_X,
    );
  }
  // Body text (the saved message line), blue, below the thumbnail.
  const body = normalizeUserDataBodyText(record.text ?? "");
  if (body.trim()) {
    context.font = USER_DATA_BODY_FONT;
    drawTextClipped(context, body, x + BODY_DX + BODY_TEXT_DX, y + BODY_DY + BODY_TEXT_DY, BODY_W);
  }
  context.restore();
}

// "2026-06-17 22:51:20" -> { date: "26/06/17", time: "22:51:20" }
function formatSavedAt(savedAt) {
  if (typeof savedAt !== "string" || savedAt.length === 0) {
    return { date: "", time: "" };
  }
  const match = savedAt.match(
    /(\d{2})(\d{2})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})/,
  );
  if (!match) {
    return { date: "", time: "" };
  }
  const [, , yy, mm, dd, hh, mi, ss] = match;
  const pad = (value) => value.padStart(2, "0");
  return {
    date: `${yy}/${pad(mm)}/${pad(dd)}`,
    time: `${pad(hh)}:${mi}:${ss}`,
  };
}

function normalizeUserDataBodyText(text) {
  return stripScenarioTags(String(text)).replace(/[\r\n\t]+/g, " ");
}

function drawFixedCellText(context, text, x, y, cellWidth, scaleX = 1) {
  let cursor = x;
  for (const ch of text) {
    if (scaleX !== 1 && typeof context.translate === "function" && typeof context.scale === "function") {
      context.save();
      context.translate(cursor, y);
      context.scale(scaleX, 1);
      drawBgiText(context, ch, 0, 0);
      context.restore();
    } else {
      drawBgiText(context, ch, cursor, y);
    }
    cursor += cellWidth;
  }
}

function drawTextClipped(context, text, x, y, maxWidth) {
  let value = text;
  if (context.measureText(value).width <= maxWidth) {
    drawBgiText(context, value, x, y);
    return;
  }
  while (value.length > 1 && context.measureText(`${value}…`).width > maxWidth) {
    value = value.slice(0, -1);
  }
  drawBgiText(context, `${value}…`, x, y);
}

function drawTopButtons(context, skin, state) {
  for (const button of TOP_BUTTONS) {
    const image = skin.buttons?.[button.image] ?? null;
    if (!image) {
      continue;
    }
    const disabled = buttonDisabled(button.role, state);
    const stateIndex = disabled ? 3 : state.hover === button.role ? 1 : 0;
    drawStateImage(context, image, button.x, TOP_Y, stateIndex);
  }
}

function drawBottomButtons(context, skin, state) {
  for (const button of BOTTOM_BUTTONS) {
    const imageKey = button.role === "toggle" ? toggleImageKey(state) : button.image;
    const image = skin.buttons?.[imageKey] ?? null;
    if (!image) {
      continue;
    }
    const disabled = button.alwaysDisabled || buttonDisabled(button.role, state);
    const hoverKey = button.role === "toggle" ? "toggle" : button.role;
    const stateIndex = disabled ? 3 : state.hover === hoverKey ? 1 : 0;
    drawStateImage(context, image, button.x, BOTTOM_Y, stateIndex);
  }
}

function drawPageNumber(context, skin, state) {
  const digits = skin.digits;
  if (!Array.isArray(digits) || digits.length < 10) {
    return;
  }
  drawDigits(context, digits, String(state.page + 1), PAGE_CURRENT_RIGHT_X, PAGE_DIGIT_Y, "right");
  drawDigits(context, digits, String(USER_DATA_TOTAL_PAGES), PAGE_TOTAL_LEFT_X, PAGE_DIGIT_Y, "left");
}

function drawDigits(context, digits, text, anchorX, y, align) {
  const glyphs = [...text].map((ch) => digits[Number(ch)]).filter(Boolean);
  if (glyphs.length === 0) {
    return;
  }
  const scaled = glyphs.map((glyph) => ({
    glyph,
    w: (imageLogicalWidth(glyph) * PAGE_DIGIT_H) / imageLogicalHeight(glyph),
  }));
  const totalWidth = scaled.reduce((sum, item) => sum + item.w, 0);
  let cursor = align === "right" ? anchorX - totalWidth : anchorX;
  for (const item of scaled) {
    context.drawImage(
      rgbaCanvas(item.glyph),
      Math.round(cursor),
      y,
      Math.round(item.w),
      PAGE_DIGIT_H,
    );
    cursor += item.w;
  }
}

function hitButton(x, y, bx, by, image) {
  const width = imageStateWidth(image);
  return x >= bx && x < bx + width && y >= by && y < by + imageLogicalHeight(image);
}

function slotAt(x, y, page) {
  for (let index = 0; index < USER_DATA_SLOTS_PER_PAGE; index += 1) {
    const slotX = SLOT_COLUMNS_X[index % 3];
    const slotY = SLOT_ROWS_Y[Math.floor(index / 3)];
    if (x >= slotX && x < slotX + SLOT_WIDTH && y >= slotY && y < slotY + SLOT_HEIGHT) {
      return page * USER_DATA_SLOTS_PER_PAGE + index;
    }
  }
  return null;
}

function imageStateWidth(image) {
  return image ? Math.floor(imageLogicalWidth(image) / BUTTON_STATES) : 0;
}

function imageSourceStateWidth(image) {
  return image ? Math.floor(image.width / BUTTON_STATES) : 0;
}

function drawStateImage(context, image, x, y, stateIndex) {
  const stateWidth = imageStateWidth(image);
  const sourceStateWidth = imageSourceStateWidth(image);
  context.drawImage(
    rgbaCanvas(image),
    Math.max(0, Math.min(stateIndex, BUTTON_STATES - 1)) * sourceStateWidth,
    0,
    sourceStateWidth,
    image.height,
    x,
    y,
    stateWidth,
    imageLogicalHeight(image),
  );
}

function drawThumbnailFit(context, image, x, y, w, h) {
  const logicalWidth = imageLogicalWidth(image);
  const logicalHeight = imageLogicalHeight(image);
  const scale = Math.min(w / logicalWidth, h / logicalHeight);
  const drawW = logicalWidth * scale;
  const drawH = logicalHeight * scale;
  const dx = x + (w - drawW) / 2;
  const dy = y + (h - drawH) / 2;
  context.save();
  context.beginPath();
  context.rect(x, y, w, h);
  context.clip();
  context.drawImage(
    rgbaCanvas(image),
    0,
    0,
    image.width,
    image.height,
    dx,
    dy,
    drawW,
    drawH,
  );
  context.restore();
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
  if (image?.source) {
    return image.source;
  }
  if (!image?.pixels) {
    return image;
  }
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
