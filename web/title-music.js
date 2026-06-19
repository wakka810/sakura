import { bgiMinchoFont } from "./bgi-fonts.js";

export const TITLE_MUSIC_TRACKS = Object.freeze([
  "bgm001",
  "bgm002",
  "bgm004",
  "bgm003",
  "bgm007",
  "bgm010",
  "bgm008",
  "bgm011",
  "bgm013",
  "bgm014",
  "bgm016",
  "bgm015",
  "bgm006",
  "bgm017",
  "bgm018",
  "bgm012",
  "bgm024",
  "bgm025",
  "bgm026",
  "bgm028",
  "bgm038",
  "bgm039",
  "bgm009",
  "bgm005",
  "bgm027",
  "bgm023",
  "bgm021",
  "bgm019",
  "bgm020",
  "bgm022",
  "bgm029",
  "bgm030",
  "bgm031",
  "bgm034",
  "bgm042",
  "bgm035",
  "bgm036",
  "bgm032",
  "bgm037",
  "bgm040",
  "bgm033",
  "bgm041",
]);

export const TITLE_MUSIC_PAGE_SIZE = 10;
export const TITLE_MUSIC_ITEM_X = 296;
export const TITLE_MUSIC_ITEM_Y = 104;
export const TITLE_MUSIC_ROW_HEIGHT = 52;

const ITEM_WIDTH = 288;
const ITEM_HEIGHT = 42;
const BACK_X = 980;
const BACK_Y = 610;
const PAGE_COUNT = Math.ceil(TITLE_MUSIC_TRACKS.length / TITLE_MUSIC_PAGE_SIZE);

export function createTitleMusicState() {
  return {
    open: false,
    page: 0,
    hoverIndex: -1,
    selectedIndex: -1,
    selectedAssetName: "",
    lastAction: "",
    lastPlayOk: 0,
    lastPlayReason: "",
  };
}

export function openTitleMusic(state) {
  state.open = true;
  state.hoverIndex = -1;
  state.lastAction = "open";
  return true;
}

export function closeTitleMusic(state) {
  if (!state.open) {
    return false;
  }
  state.open = false;
  state.hoverIndex = -1;
  state.lastAction = "back";
  return true;
}

export function titleMusicPageCount() {
  return PAGE_COUNT;
}

export function titleMusicTracks() {
  return TITLE_MUSIC_TRACKS.map((assetName, index) => titleMusicChoice(index, assetName));
}

export function titleMusicVisibleChoices(state) {
  const page = normalizePage(state?.page ?? 0);
  const start = page * TITLE_MUSIC_PAGE_SIZE;
  return TITLE_MUSIC_TRACKS
    .slice(start, start + TITLE_MUSIC_PAGE_SIZE)
    .map((assetName, row) => titleMusicChoice(start + row, assetName, row));
}

export function titleMusicControlAt(x, y, state, buttons = {}) {
  if (!state?.open) {
    return null;
  }
  const back = buttons.back ?? null;
  const backWidth = back?.stateWidth ?? 96;
  const backHeight = back?.stateHeight ?? 32;
  if (
    x >= BACK_X
    && x < BACK_X + backWidth
    && y >= BACK_Y
    && y < BACK_Y + backHeight
  ) {
    return { kind: "back" };
  }
  for (const choice of titleMusicVisibleChoices(state)) {
    const rect = titleMusicItemRect(choice.index);
    if (
      x >= rect.x
      && x < rect.x + rect.width
      && y >= rect.y
      && y < rect.y + rect.height
    ) {
      return { kind: "track", choice };
    }
  }
  return null;
}

export function titleMusicHoverKey(control) {
  if (!control) {
    return -1;
  }
  return control.kind === "track" ? control.choice.index : -2;
}

export function applyTitleMusicControl(state, control) {
  if (!state?.open || !control) {
    return { handled: false, action: "" };
  }
  if (control.kind === "back") {
    closeTitleMusic(state);
    return { handled: true, action: "back" };
  }
  if (control.kind === "track") {
    state.selectedIndex = control.choice.index;
    state.selectedAssetName = control.choice.assetName;
    state.lastAction = "select";
    state.lastPlayOk = 0;
    state.lastPlayReason = "";
    return {
      handled: true,
      action: "select",
      index: control.choice.index,
      assetName: control.choice.assetName,
    };
  }
  return { handled: false, action: "" };
}

export function titleMusicSetPage(state, page) {
  if (!state) {
    return false;
  }
  const next = normalizePage(page);
  if (state.page === next) {
    return false;
  }
  state.page = next;
  state.hoverIndex = -1;
  state.lastAction = "page";
  return true;
}

export function titleMusicStepPage(state, delta) {
  return titleMusicSetPage(state, (state?.page ?? 0) + delta);
}

export function paintTitleMusic(context, canvas, state, buttons = {}, sprites = null) {
  if (!state?.open) {
    return false;
  }
  context.save();
  const background = sprites?.background ?? null;
  if (background) {
    context.drawImage(titleMusicImageScratch(background), 0, 0, canvas.width, canvas.height);
  } else {
    context.fillStyle = "rgba(245, 247, 238, 0.88)";
    context.fillRect(248, 70, 626, 570);
    context.strokeStyle = "rgba(63, 74, 46, 0.55)";
    context.lineWidth = 2;
    context.strokeRect(248.5, 70.5, 626, 570);
    context.font = bgiMinchoFont(22);
    context.fillStyle = "#23301d";
    context.textBaseline = "top";
    context.fillText("Music", 272, 80);
  }
  context.font = bgiMinchoFont(16);
  for (const choice of titleMusicVisibleChoices(state)) {
    paintMusicCell(
      context,
      choice,
      state.hoverIndex === choice.index,
      state.selectedIndex === choice.index,
      sprites,
    );
  }
  if (!background) {
    context.fillStyle = "rgba(35, 48, 29, 0.82)";
    context.textAlign = "right";
    context.fillText(`${state.page + 1}/${PAGE_COUNT}`, 846, 596);
  }
  context.textAlign = "left";
  paintBackButton(context, buttons.back, state.hoverIndex === -2);
  context.restore();
  return true;
}

export function titleMusicItemRect(index) {
  const row = Math.max(0, index % TITLE_MUSIC_PAGE_SIZE);
  return {
    x: TITLE_MUSIC_ITEM_X,
    y: TITLE_MUSIC_ITEM_Y + row * TITLE_MUSIC_ROW_HEIGHT,
    width: ITEM_WIDTH,
    height: ITEM_HEIGHT,
  };
}

function titleMusicChoice(index, assetName, row = index % TITLE_MUSIC_PAGE_SIZE) {
  return {
    index,
    row,
    page: Math.floor(index / TITLE_MUSIC_PAGE_SIZE),
    assetName,
    label: titleMusicLabel(assetName),
    rect: titleMusicItemRect(index),
  };
}

function paintMusicCell(context, choice, hovered, selected, sprites) {
  const rect = titleMusicItemRect(choice.index);
  const sprite = sprites?.tracks?.get?.(choice.assetName) ?? null;
  if (sprite?.image) {
    const state = selected ? 2 : hovered ? 1 : 0;
    const sourceStateWidth = sprite.sourceStateWidth ?? sprite.stateWidth;
    const sourceStateHeight = sprite.sourceStateHeight ?? sprite.image.height;
    context.drawImage(
      titleMusicImageScratch(sprite.image),
      state * sourceStateWidth,
      0,
      sourceStateWidth,
      sourceStateHeight,
      rect.x,
      rect.y,
      sprite.stateWidth,
      sprite.stateHeight,
    );
    return;
  }
  context.fillStyle = selected
    ? "rgba(164, 201, 226, 0.92)"
    : hovered
      ? "rgba(225, 239, 246, 0.9)"
      : "rgba(255, 255, 255, 0.72)";
  context.fillRect(rect.x, rect.y, rect.width, rect.height);
  context.strokeStyle = selected
    ? "rgba(38, 107, 165, 0.95)"
    : hovered
      ? "rgba(91, 134, 164, 0.82)"
      : "rgba(102, 112, 91, 0.55)";
  context.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width, rect.height);
  context.fillStyle = "#27311d";
  context.fillText(String(choice.index + 1).padStart(2, "0"), rect.x + 14, rect.y + 10);
  context.fillStyle = "#1d252a";
  context.fillText(choice.label, rect.x + 72, rect.y + 10);
}

function paintBackButton(context, back, hovered) {
  if (back?.image) {
    const scratch = titleMusicImageScratch(back.image);
    const sourceStateWidth = back.sourceStateWidth ?? back.stateWidth;
    const sourceStateHeight = back.sourceStateHeight ?? back.image.height;
    context.drawImage(
      scratch,
      (hovered ? 1 : 0) * sourceStateWidth,
      0,
      sourceStateWidth,
      sourceStateHeight,
      BACK_X,
      BACK_Y,
      back.stateWidth,
      back.stateHeight,
    );
    return;
  }
  context.fillStyle = hovered ? "rgba(164, 201, 226, 0.9)" : "rgba(255, 255, 255, 0.86)";
  context.fillRect(BACK_X, BACK_Y, 96, 32);
  context.strokeStyle = "#334";
  context.strokeRect(BACK_X + 0.5, BACK_Y + 0.5, 96, 32);
  context.fillStyle = "#111";
  context.fillText("back", BACK_X + 22, BACK_Y + 7);
}

function titleMusicLabel(assetName) {
  const number = /^bgm(\d+)$/i.exec(assetName)?.[1] ?? assetName;
  return `BGM ${number}`;
}

function normalizePage(page) {
  const value = Number.isInteger(page) ? page : Number.parseInt(String(page), 10);
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(PAGE_COUNT - 1, value));
}

function titleMusicImageScratch(image) {
  if (image.__titleMusicScratch) {
    return image.__titleMusicScratch;
  }
  const scratch = document.createElement("canvas");
  scratch.width = image.width;
  scratch.height = image.height;
  scratch.getContext("2d", { alpha: true }).putImageData(
    new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height),
    0,
    0,
  );
  image.__titleMusicScratch = scratch;
  return scratch;
}
