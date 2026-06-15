import { DEFAULT_SCENARIO_ROUTE } from "./scenario-routes.js";

// omakescene._bp embeds these 5x4 scene-grid origins as immediate arrays.
export const TITLE_SCENE_GRID_X = Object.freeze([40, 185, 330, 475, 620]);
export const TITLE_SCENE_GRID_Y = Object.freeze([125, 235, 345, 455]);

export const TITLE_SCENE_CELL_WIDTH = 140;
export const TITLE_SCENE_CELL_HEIGHT = 105;

const THUMBNAIL_STATE_COUNT = 3;
const BACK_X = 980;
const BACK_Y = 610;

// SetupForReplay's 0x013a command stream is the canonical SceneSelect list.
// omakescene._bp still supplies the 5x4 coordinate grid; these entries supply
// the replay id, launch scenario, and shipped H_thum_* thumbnail sheet.
export const TITLE_SCENE_REPLAY_ENTRIES = Object.freeze([
  { index: 0, replayId: 103, routeId: DEFAULT_SCENARIO_ROUTE, scenarioName: "h_rn_01", thumbnailAssetName: "h_thum_rn_01", scriptSlot: 0, scriptPage: 0 },
  { index: 1, replayId: 104, routeId: DEFAULT_SCENARIO_ROUTE, scenarioName: "h_rn_02", thumbnailAssetName: "h_thum_rn_02", scriptSlot: 1, scriptPage: 0 },
  { index: 2, replayId: 105, routeId: DEFAULT_SCENARIO_ROUTE, scenarioName: "h_rn_03", thumbnailAssetName: "h_thum_rn_03", scriptSlot: 2, scriptPage: 0 },
  { index: 3, replayId: 106, routeId: DEFAULT_SCENARIO_ROUTE, scenarioName: "h_rn_04", thumbnailAssetName: "h_thum_rn_04", scriptSlot: 3, scriptPage: 0 },
  { index: 4, replayId: 101, routeId: DEFAULT_SCENARIO_ROUTE, scenarioName: "h_mk_01", thumbnailAssetName: "h_thum_mk_01", scriptSlot: 4, scriptPage: 0 },
  { index: 5, replayId: 102, routeId: DEFAULT_SCENARIO_ROUTE, scenarioName: "h_mk_02", thumbnailAssetName: "h_thum_mk_02", scriptSlot: 5, scriptPage: 0 },
  { index: 6, replayId: 107, routeId: DEFAULT_SCENARIO_ROUTE, scenarioName: "h_hr_01", thumbnailAssetName: "h_thum_hr_01", scriptSlot: 6, scriptPage: 0 },
  { index: 7, replayId: 108, routeId: DEFAULT_SCENARIO_ROUTE, scenarioName: "h_hr_02", thumbnailAssetName: "h_thum_hr_02", scriptSlot: 7, scriptPage: 0 },
  { index: 8, replayId: 109, routeId: DEFAULT_SCENARIO_ROUTE, scenarioName: "h_ym_01", thumbnailAssetName: "h_thum_ym_01", scriptSlot: 0, scriptPage: 1 },
  { index: 9, replayId: 110, routeId: DEFAULT_SCENARIO_ROUTE, scenarioName: "h_sz_01", thumbnailAssetName: "h_thum_sz_01", scriptSlot: 1, scriptPage: 1 },
  { index: 10, replayId: 111, routeId: DEFAULT_SCENARIO_ROUTE, scenarioName: "h_sz_02", thumbnailAssetName: "h_thum_sz_02", scriptSlot: 2, scriptPage: 1 },
  { index: 11, replayId: 112, routeId: DEFAULT_SCENARIO_ROUTE, scenarioName: "h_sz_03", thumbnailAssetName: "h_thum_sz_03", scriptSlot: 3, scriptPage: 1 },
  { index: 12, replayId: 113, routeId: DEFAULT_SCENARIO_ROUTE, scenarioName: "h_sz_04", thumbnailAssetName: "h_thum_sz_04", scriptSlot: 4, scriptPage: 1 },
  { index: 13, replayId: 114, routeId: DEFAULT_SCENARIO_ROUTE, scenarioName: "h_ai_01", thumbnailAssetName: "h_thum_ai_01", scriptSlot: 5, scriptPage: 1 },
]);

export function createTitleSceneSelectState() {
  return {
    open: false,
    hoverIndex: -1,
    lastAction: "",
    selectedRoute: "",
    selectedScenarioName: "",
    selectedReplayId: 0,
    selectedThumbnailAssetName: "",
  };
}

export function openTitleSceneSelect(state) {
  state.open = true;
  state.hoverIndex = -1;
  state.lastAction = "open";
  return true;
}

export function closeTitleSceneSelect(state) {
  if (!state.open) {
    return false;
  }
  state.open = false;
  state.hoverIndex = -1;
  state.lastAction = "back";
  return true;
}

export function titleSceneChoices() {
  return TITLE_SCENE_REPLAY_ENTRIES.map((entry) => ({
    ...entry,
    scenarioIndex: 0,
    row: Math.floor(entry.index / TITLE_SCENE_GRID_X.length),
    column: entry.index % TITLE_SCENE_GRID_X.length,
    rect: titleSceneCellRect(entry.index),
  }));
}

export function titleSceneControlAt(x, y, state, buttons = {}) {
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
  for (const choice of titleSceneChoices()) {
    const cell = titleSceneCellRect(choice.index);
    if (
      x >= cell.x
      && x < cell.x + cell.width
      && y >= cell.y
      && y < cell.y + cell.height
    ) {
      return { kind: "scene", choice };
    }
  }
  return null;
}

export function titleSceneHoverKey(control) {
  if (!control) {
    return -1;
  }
  return control.kind === "scene" ? control.choice.index : -2;
}

export function applyTitleSceneControl(state, control) {
  if (!state?.open || !control) {
    return { handled: false, action: "" };
  }
  if (control.kind === "back") {
    closeTitleSceneSelect(state);
    return { handled: true, action: "back" };
  }
  if (control.kind === "scene") {
    state.open = false;
    state.hoverIndex = -1;
    state.lastAction = "select";
    state.selectedRoute = control.choice.routeId;
    state.selectedScenarioName = control.choice.scenarioName;
    state.selectedReplayId = control.choice.replayId;
    state.selectedThumbnailAssetName = control.choice.thumbnailAssetName;
    return {
      handled: true,
      action: "select",
      routeId: control.choice.routeId,
      scenarioName: control.choice.scenarioName,
      scenarioIndex: control.choice.scenarioIndex,
      replayId: control.choice.replayId,
      thumbnailAssetName: control.choice.thumbnailAssetName,
    };
  }
  return { handled: false, action: "" };
}

export function paintTitleSceneSelect(context, canvas, state, buttons = {}, imageCache = null) {
  if (!state?.open) {
    return false;
  }
  context.save();
  context.font = "17px 'Noto Serif CJK JP', 'Yu Mincho', 'MS Mincho', serif";
  context.textBaseline = "top";
  for (const choice of titleSceneChoices()) {
    paintSceneCell(context, choice, state.hoverIndex === choice.index, imageCache);
  }
  paintBackButton(context, buttons.back, state.hoverIndex === -2);
  context.restore();
  return true;
}

export function titleSceneCellRect(index) {
  const column = index % TITLE_SCENE_GRID_X.length;
  const row = Math.floor(index / TITLE_SCENE_GRID_X.length);
  return {
    x: TITLE_SCENE_GRID_X[column],
    y: TITLE_SCENE_GRID_Y[row],
    width: TITLE_SCENE_CELL_WIDTH,
    height: TITLE_SCENE_CELL_HEIGHT,
  };
}

function paintSceneCell(context, choice, hovered, imageCache) {
  const rect = titleSceneCellRect(choice.index);
  const image = imageForAsset(imageCache, choice.thumbnailAssetName);
  if (image) {
    drawTitleSceneThumbnail(context, image, rect, hovered);
  } else {
    paintFallbackSceneCell(context, rect, choice, hovered);
  }
  context.lineWidth = hovered ? 3 : 1;
  context.strokeStyle = hovered ? "rgba(108, 174, 255, 0.95)" : "rgba(255, 255, 255, 0.54)";
  context.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);
}

function paintFallbackSceneCell(context, rect, choice, hovered) {
  context.fillStyle = hovered ? "rgba(17, 63, 124, 0.78)" : "rgba(8, 33, 69, 0.62)";
  context.fillRect(rect.x, rect.y, rect.width, rect.height);
  context.fillStyle = hovered ? "#1e5dff" : "#ffffff";
  context.fillText(choice.thumbnailAssetName.toUpperCase(), rect.x + 8, rect.y + 10);
}

function drawTitleSceneThumbnail(context, image, rect, hovered) {
  const scratch = titleSceneImageScratch(image);
  const stateWidth = Math.floor(image.width / THUMBNAIL_STATE_COUNT);
  const sourceWidth = stateWidth > 0 ? stateWidth : image.width;
  const state = hovered && image.width >= sourceWidth * THUMBNAIL_STATE_COUNT ? 2 : 1;
  const sourceX = Math.min(state, Math.max(0, Math.floor(image.width / sourceWidth) - 1)) * sourceWidth;
  const scale = Math.min(rect.width / sourceWidth, rect.height / image.height);
  const drawWidth = Math.max(1, Math.round(sourceWidth * scale));
  const drawHeight = Math.max(1, Math.round(image.height * scale));
  const drawX = Math.round(rect.x + (rect.width - drawWidth) / 2);
  const drawY = Math.round(rect.y + (rect.height - drawHeight) / 2);
  context.fillStyle = "#000000";
  context.fillRect(rect.x, rect.y, rect.width, rect.height);
  context.drawImage(
    scratch,
    sourceX,
    0,
    sourceWidth,
    image.height,
    drawX,
    drawY,
    drawWidth,
    drawHeight,
  );
}

function paintBackButton(context, back, hovered) {
  if (back?.image) {
    const scratch = titleSceneImageScratch(back.image);
    context.drawImage(
      scratch,
      (hovered ? 1 : 0) * back.stateWidth,
      0,
      back.stateWidth,
      back.stateHeight,
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

function imageForAsset(imageCache, assetName) {
  return imageCache?.get?.(assetName)?.image ?? null;
}

function titleSceneImageScratch(image) {
  if (image.__titleSceneScratch) {
    return image.__titleSceneScratch;
  }
  const scratch = document.createElement("canvas");
  scratch.width = image.width;
  scratch.height = image.height;
  scratch.getContext("2d", { alpha: true }).putImageData(
    new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height),
    0,
    0,
  );
  image.__titleSceneScratch = scratch;
  return scratch;
}
