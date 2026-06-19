import { bgiMinchoFont } from "./bgi-fonts.js";
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

// Per-row unlock keys for the scene-recollection room (おまけ→シーン回想).
//
// The original `omakescene._bp` locks each row via the BGI.gdb viewed-image
// table (the same mechanism the CG gallery uses), NOT a CFlag/read flag: each
// row shows a locked `_off` / unlocked `_on` thumbnail. A row's recollection
// scene (`h_rn_01`, …) is replay-only, but the SAME event-CGs are shown in the
// route during normal play (verified by `sakura-cli scenario-image-audit`:
// every CG below appears in a route scenario such as `03_olympia_05`, never
// only in the `h_*` replay). So a row unlocks once any of its scene's CGs is in
// the viewed-image record. Prefixes are 6-char `evNNNN` stems; the viewed set
// stores full lowercased basenames (`ev0101a`), matched with `startsWith`.
export const SCENE_REPLAY_UNLOCK_CGS = Object.freeze({
  h_rn_01: Object.freeze(["ev0101", "ev0102"]), // 03_olympia_05
  h_rn_02: Object.freeze(["ev0102", "ev0103"]), // 03_olympia_05
  h_rn_03: Object.freeze(["ev0104", "ev0105", "ev0106"]), // 03_olympia_06
  h_rn_04: Object.freeze(["ev0107"]), // 03_olympia_09
  h_mk_01: Object.freeze(["ev4100", "ev4104"]), // 03_picapica_09
  h_mk_02: Object.freeze(["ev4101", "ev4102"]), // 03_picapica_13
  h_hr_01: Object.freeze(["ev2103", "ev2104", "ev2105"]), // 03_zypressen_12
  h_hr_02: Object.freeze(["ev2106", "ev2107"]), // 03_zypressen_13
  h_ym_01: Object.freeze(["ev2100", "ev2101", "ev2102"]), // 03_marchen_01
  h_sz_01: Object.freeze(["ev1100", "ev1101"]), // 03_andoe_03
  h_sz_02: Object.freeze(["ev1102", "ev1103", "ev1104"]), // 03_andoe_04
  h_sz_03: Object.freeze(["ev1105", "ev1106"]), // 03_andoe_05
  h_sz_04: Object.freeze(["ev1107"]), // 03_andoe_05
  h_ai_01: Object.freeze(["ev5100", "ev5101", "ev5102"]), // 05_the_happy_prince_08b
});

/**
 * True when a scene-recollection row is unlocked, i.e. any of its scene's
 * event-CGs is present in the viewed-image record. Pure: the host supplies the
 * viewed CG set (lowercased basenames) and handles any automation force-unlock.
 * Unmapped rows fail open (treated as unlocked) so a data gap never hides a row.
 */
export function titleSceneRowUnlocked(scenarioName, viewedCgSet) {
  const prefixes = SCENE_REPLAY_UNLOCK_CGS[scenarioName];
  if (!prefixes) {
    return true;
  }
  if (!(viewedCgSet instanceof Set) || viewedCgSet.size === 0) {
    return false;
  }
  for (const name of viewedCgSet) {
    if (typeof name !== "string") {
      continue;
    }
    for (const prefix of prefixes) {
      if (name.startsWith(prefix)) {
        return true;
      }
    }
  }
  return false;
}

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

export function paintTitleSceneSelect(context, canvas, state, buttons = {}, imageCache = null, lockedSet = null) {
  if (!state?.open) {
    return false;
  }
  context.save();
  context.font = bgiMinchoFont(17);
  context.textBaseline = "top";
  for (const choice of titleSceneChoices()) {
    paintSceneCell(
      context,
      choice,
      state.hoverIndex === choice.index,
      imageCache,
      lockedSet?.has?.(choice.index) ?? false,
    );
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

function paintSceneCell(context, choice, hovered, imageCache, locked = false) {
  const rect = titleSceneCellRect(choice.index);
  const image = imageForAsset(imageCache, choice.thumbnailAssetName);
  if (image) {
    drawTitleSceneThumbnail(context, image, rect, hovered);
  } else {
    paintFallbackSceneCell(context, rect, choice, hovered);
  }
  if (locked) {
    paintSceneLockOverlay(context, rect);
  }
  context.lineWidth = hovered ? 3 : 1;
  context.strokeStyle = hovered ? "rgba(108, 174, 255, 0.95)" : "rgba(255, 255, 255, 0.54)";
  context.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);
}

// Locked rows: the original swaps in the `H_thum_*_off` sprite. We approximate
// with a darkening overlay and a small padlock so unseen scenes read as locked.
function paintSceneLockOverlay(context, rect) {
  context.fillStyle = "rgba(0, 0, 0, 0.66)";
  context.fillRect(rect.x, rect.y, rect.width, rect.height);
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  context.save();
  context.strokeStyle = "rgba(232, 232, 236, 0.9)";
  context.fillStyle = "rgba(232, 232, 236, 0.9)";
  context.lineWidth = 3;
  context.beginPath();
  context.arc(cx, cy - 6, 8, Math.PI, 2 * Math.PI); // shackle
  context.stroke();
  context.fillRect(cx - 11, cy - 6, 22, 16); // body
  context.restore();
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
  const logicalStateWidth = imageLogicalWidth(image) / THUMBNAIL_STATE_COUNT;
  const logicalSourceWidth = stateWidth > 0 ? logicalStateWidth : imageLogicalWidth(image);
  const logicalHeight = imageLogicalHeight(image);
  const state = hovered && image.width >= sourceWidth * THUMBNAIL_STATE_COUNT ? 2 : 1;
  const sourceX = Math.min(state, Math.max(0, Math.floor(image.width / sourceWidth) - 1)) * sourceWidth;
  const scale = Math.min(rect.width / logicalSourceWidth, rect.height / logicalHeight);
  const drawWidth = Math.max(1, Math.round(logicalSourceWidth * scale));
  const drawHeight = Math.max(1, Math.round(logicalHeight * scale));
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
