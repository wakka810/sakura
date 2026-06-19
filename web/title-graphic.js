import { bgiMinchoFont } from "./bgi-fonts.js";

export const TITLE_GRAPHIC_COLUMNS = 4;
export const TITLE_GRAPHIC_ROWS = 2;
export const TITLE_GRAPHIC_PAGE_SIZE = TITLE_GRAPHIC_COLUMNS * TITLE_GRAPHIC_ROWS;
export const TITLE_GRAPHIC_CELL_X = 52;
export const TITLE_GRAPHIC_CELL_Y = 144;
export const TITLE_GRAPHIC_CELL_STEP_X = 294;
export const TITLE_GRAPHIC_CELL_STEP_Y = 268;
export const TITLE_GRAPHIC_BUTTON_X = 36;
export const TITLE_GRAPHIC_BUTTON_Y = 650;
export const TITLE_GRAPHIC_BUTTON_STEP_X = 148;

const STAGE_WIDTH = 1280;
const STAGE_HEIGHT = 720;
const CELL_WIDTH = 291;
const CELL_HEIGHT = 170;
const THUMBNAIL_X = 6;
const THUMBNAIL_Y = 6;
const THUMBNAIL_WIDTH = 280;
const THUMBNAIL_HEIGHT = 158;
const BUTTON_WIDTH = 139;
const BUTTON_HEIGHT = 43;
const BUTTON_SHEET_STATES = 4;
const PAGE_NUMBER_X = 1085;
const PAGE_COUNT_X = 1164;
const PAGE_NUMBER_Y = 662;
const PAGE_FONT = bgiMinchoFont(25, "bold");
const ASSET_DECODER = new TextDecoder("ascii", { fatal: false });

const CHROME_ASSET_NAMES = Object.freeze([
  "SGCG990000",
  "SGCG100000",
  "SGCG800001",
  "SGCG000000",
  "SGCG000100",
  "SGCG000200",
  "SGCG000300",
  "SGCG000400",
]);

const GRAPHIC_BUTTONS = Object.freeze([
  { action: "previous", assetName: "SGCG000000", hoverKey: -3, page: "previous" },
  { action: "next", assetName: "SGCG000100", hoverKey: -4, page: "next" },
  { action: "top", assetName: "SGCG000200", hoverKey: -5, page: "top" },
  { action: "last", assetName: "SGCG000300", hoverKey: -6, page: "last" },
  { action: "back", assetName: "SGCG000400", hoverKey: -2, page: null },
]);

// SetupForGallery's 0x0139 command stream is the canonical CG thumbnail order.
// The UI still renders omakecg._bp's 4x2 page grid; this list only defines the
// asset sequence and filters script-external archive leftovers.
export const TITLE_GRAPHIC_SCRIPT_THUMBNAIL_NAMES = Object.freeze([
  "ev_thum_0", "ev_thum_1", "ev_thum_2", "ev_thum_3", "ev_thum_4",
  "ev_thum_5", "ev_thum_6", "ev_thum_7", "ev_thum_8", "ev_thum_9",
  "ev_thum_10", "ev_thum_11", "ev_thum_12", "ev_thum_13", "ev_thum_14",
  "ev_thum_15", "ev_thum_16", "ev_thum_17", "ev_thum_18", "ev_thum_19",
  "ev_thum_20", "ev_thum_21", "ev_thum_22", "ev_thum_23", "ev_thum_24",
  "ev_thum_25", "ev_thum_26", "ev_thum_27", "ev_thum_28", "ev_thum_29",
  "ev_thum_30", "ev_thum_31", "ev_thum_136", "ev_thum_32", "ev_thum_137",
  "ev_thum_33", "ev_thum_133", "ev_thum_34", "ev_thum_35", "ev_thum_36",
  "ev_thum_37", "ev_thum_38", "ev_thum_39", "ev_thum_40", "ev_thum_42",
  "ev_thum_43", "ev_thum_44", "ev_thum_45", "ev_thum_45b", "ev_thum_46",
  "ev_thum_47", "ev_thum_48", "ev_thum_129", "ev_thum_49", "ev_thum_50",
  "ev_thum_51", "ev_thum_52", "ev_thum_53", "ev_thum_54", "ev_thum_55",
  "ev_thum_56", "ev_thum_57", "ev_thum_58", "ev_thum_59", "ev_thum_60",
  "ev_thum_61", "ev_thum_62", "ev_thum_138", "ev_thum_63", "ev_thum_64",
  "ev_thum_65", "ev_thum_66", "ev_thum_67", "ev_thum_68", "ev_thum_69",
  "ev_thum_70", "ev_thum_71", "ev_thum_72", "ev_thum_73", "ev_thum_74",
  "ev_thum_75", "ev_thum_134", "ev_thum_76", "ev_thum_77", "ev_thum_78",
  "ev_thum_79", "ev_thum_80", "ev_thum_81", "ev_thum_82", "ev_thum_83",
  "ev_thum_84", "ev_thum_139", "ev_thum_85", "ev_thum_86", "ev_thum_87",
  "ev_thum_88", "ev_thum_89", "ev_thum_90", "ev_thum_91", "ev_thum_92",
  "ev_thum_93", "ev_thum_94", "ev_thum_95", "ev_thum_96", "ev_thum_97",
  "ev_thum_98", "ev_thum_99", "ev_thum_100", "ev_thum_101", "ev_thum_102",
  "ev_thum_130", "ev_thum_103", "ev_thum_104", "ev_thum_105", "ev_thum_106",
  "ev_thum_132", "ev_thum_107", "ev_thum_108", "ev_thum_109", "ev_thum_110",
  "ev_thum_111", "ev_thum_112", "ev_thum_113", "ev_thum_114", "ev_thum_115",
  "ev_thum_116", "ev_thum_117", "ev_thum_118", "ev_thum_119", "ev_thum_120",
  "ev_thum_121", "ev_thum_122", "ev_thum_124", "ev_thum_131", "ev_thum_135",
  "ev_thum_125", "ev_thum_126", "ev_thum_127", "ev_thum_128", "ev_thum_140",
]);

const TITLE_GRAPHIC_SCRIPT_THUMBNAIL_ORDER = new Map(
  TITLE_GRAPHIC_SCRIPT_THUMBNAIL_NAMES.map((name, index) => [name, index]),
);

const THUMBNAIL_FULL_ASSET_NAMES = new Map([
  [0, "evb000b"],
  [1, "ev6000a"],
  [2, "evb001c"],
  [3, "ev7001c"],
  [4, "ev5000e"],
  [5, "ev5001a"],
  [6, "ev1000a"],
  [7, "ev4000d"],
  [8, "ev4001a"],
  [9, "ev6001a"],
  [10, "ev0000a"],
  [11, "ev5002a"],
  [12, "evb002a"],
  [13, "ev0001b"],
  [14, "ev2001d"],
  [15, "ev4002f"],
  [16, "evb003b"],
  [17, "ev3000a"],
  [18, "evb004a"],
  [19, "ev0002c"],
  [20, "ev5003a"],
  [21, "ev4003a"],
  [22, "ev0003a"],
  [23, "ev5004a"],
  [24, "ev4004a"],
  [25, "ev4103c_nup"],
  [26, "eva001a"],
  [27, "ev5005a"],
  [28, "evb005d"],
  [29, "ev5006b"],
  [30, "ev2002a"],
  [31, "ev3001b"],
  [32, "ev5007b"],
  [33, "ev2003d"],
  [34, "ev0009c"],
  [35, "ev4008g"],
  [36, "ev4009c"],
  [37, "ev4006a"],
  [38, "ev4005a"],
  [39, "ev4007a"],
  [40, "ev4103a"],
  [42, "ev4104a"],
  [43, "ev4100a"],
  [44, "ev4101p"],
  [45, "ev4102a"],
  [46, "ev9000b"],
  [47, "ev0005a"],
  [48, "ev0006c"],
  [49, "ev0004c"],
  [50, "ev0008d"],
  [51, "ev0100a"],
  [52, "ev0101a"],
  [53, "ev0102a"],
  [54, "ev0103n"],
  [55, "ev0009a"],
  [56, "ev0104a"],
  [57, "ev0105a"],
  [58, "ev0106a"],
  [59, "ev0010a"],
  [60, "ev0011a"],
  [61, "ev0012a"],
  [62, "ev0107c"],
  [63, "ev2006a"],
  [64, "ev7002a"],
  [65, "ev2007a"],
  [66, "ev2008g"],
  [67, "ev2009b"],
  [68, "ev2010f"],
  [69, "ev2011a"],
  [70, "ev3003b"],
  [71, "ev2012a"],
  [72, "ev2103c"],
  [73, "ev2104a"],
  [74, "ev2105a"],
  [75, "ev2106a"],
  [76, "ev2107c"],
  [77, "ev3004a"],
  [78, "ev2004a"],
  [79, "ev2100a"],
  [80, "ev2101b"],
  [81, "ev2102h"],
  [82, "ev3002a"],
  [83, "ev1001b"],
  [84, "evb007g"],
  [85, "ev1002a"],
  [86, "evb008o"],
  [87, "ev1100a"],
  [88, "ev1101a"],
  [89, "ev0013a"],
  [90, "ev1102d"],
  [91, "ev1103o"],
  [92, "ev1104a"],
  [93, "ev1105f"],
  [94, "ev1106a"],
  [95, "ev1107e"],
  [96, "ev1003a"],
  [97, "ev1004a"],
  [98, "evb010c"],
  [99, "ev8000d"],
  [100, "ev8102c"],
  [101, "ev8001a"],
  [102, "ev8005a"],
  [103, "ev5008a"],
  [104, "ev6002i"],
  [105, "ev5009a"],
  [106, "ev5010a"],
  [107, "ev7003a"],
  [108, "ev7004a"],
  [109, "evb012a"],
  [110, "ev5011a"],
  [111, "ev0014a"],
  [112, "ev0015c"],
  [113, "ev9002a"],
  [114, "ev5012a"],
  [115, "ev5100a"],
  [116, "ev5101a"],
  [117, "ev5102k"],
  [118, "ev7005a"],
  [119, "evb011b"],
  [120, "evb013i"],
  [121, "ev9001b"],
  [122, "ev9004b"],
  [124, "ev4012a"],
  [125, "evb014a"],
  [126, "ev7007g"],
  [127, "ev5013b"],
  [128, "ev5014a"],
  [129, "eva002a"],
  [130, "evb010j"],
  [131, "evb012c"],
  [132, "ev5001b"],
  [133, "evb015a"],
  [134, "ev2106i"],
  [135, "ev7008a"],
  [136, "ev4004a"],
  [137, "ev7003b_d"],
  [138, "ev2006f"],
  [139, "ev7008d_ase"],
  [140, "ev3004f"],
  [141, "ev7009a"],
]);

const THUMBNAIL_FULL_ASSET_NAMES_BY_NAME = new Map([
  ["ev_thum_45b", "ev4010a"],
]);

export function titleGraphicChromeAssetNames() {
  return CHROME_ASSET_NAMES;
}

export function createTitleGraphicState() {
  return {
    open: false,
    page: 0,
    hoverIndex: -1,
    selectedIndex: -1,
    selectedAssetName: "",
    viewerOpen: false,
    viewerAssetName: "",
    viewerLoadOk: 0,
    viewerLoadReason: "",
    lastAction: "",
    lastLoadOk: 0,
    lastLoadReason: "",
  };
}

export function openTitleGraphic(state) {
  state.open = true;
  state.hoverIndex = -1;
  state.lastAction = "open";
  return true;
}

export function closeTitleGraphic(state) {
  if (!state.open) {
    return false;
  }
  state.open = false;
  state.viewerOpen = false;
  state.hoverIndex = -1;
  state.lastAction = "back";
  return true;
}

export function titleGraphicAssets(catalog, options = {}) {
  const unlock = normalizeTitleGraphicUnlock(options);
  const records = Array.from(catalog?.records?.() ?? []);
  const archives = Array.from(catalog?.archives?.() ?? []);
  const thumbnailAssets = titleGraphicThumbnailAssets(records, archives, unlock);
  if (thumbnailAssets.length > 0) {
    return thumbnailAssets;
  }
  const seen = new Set();
  const assets = [];
  for (const record of records) {
    const assetName = asciiAssetName(record?.name).toLowerCase();
    if (!/^ev[a-z0-9_]{1,46}$/.test(assetName)) {
      continue;
    }
    if (assetName.startsWith("ev_thum")) {
      continue;
    }
    const archiveName = asciiAssetName(archives[record.archiveIndex]?.name).toLowerCase();
    if (archiveName !== "" && !/^data0[12].*\.arc$/.test(archiveName)) {
      continue;
    }
    if (seen.has(assetName)) {
      continue;
    }
    seen.add(assetName);
    const unlocked = titleGraphicAssetUnlocked(assetName, assetName, unlock);
    assets.push({
      index: assets.length,
      assetName,
      label: assetName.toUpperCase(),
      archiveName,
      size: Number.isFinite(record?.size) ? record.size : 0,
      unlocked,
      locked: !unlocked,
    });
  }
  assets.sort(compareGraphicAssets);
  return assets.map((asset, index) => ({ ...asset, index }));
}

function titleGraphicThumbnailAssets(records, archives, unlock) {
  const byAssetName = new Map();
  for (const record of records) {
    const assetName = asciiAssetName(record?.name).toLowerCase();
    const match = /^ev_thum_(\d+[a-z0-9]*)$/.exec(assetName);
    if (!match) {
      continue;
    }
    const archiveName = asciiAssetName(archives[record.archiveIndex]?.name).toLowerCase();
    if (archiveName !== "" && !/^data02.*\.arc$/.test(archiveName)) {
      continue;
    }
    const gallerySlot = Number.parseInt(match[1], 10);
    if (!Number.isSafeInteger(gallerySlot)) {
      continue;
    }
    const scriptOrder = TITLE_GRAPHIC_SCRIPT_THUMBNAIL_ORDER.get(assetName) ?? null;
    const fullAssetName = titleGraphicFullAssetName(assetName, gallerySlot);
    const unlocked = titleGraphicAssetUnlocked(assetName, fullAssetName, unlock);
    const candidate = {
      index: 0,
      assetName,
      thumbnailAssetName: assetName,
      fullAssetName,
      label: `CG ${scriptOrder ?? gallerySlot}`,
      archiveName,
      gallerySlot,
      scriptOrder,
      size: Number.isFinite(record?.size) ? record.size : 0,
      unlocked,
      locked: !unlocked,
    };
    const current = byAssetName.get(assetName);
    if (!current || compareThumbnailCandidate(candidate, current) < 0) {
      byAssetName.set(assetName, candidate);
    }
  }
  const assets = Array.from(byAssetName.values());
  const canonicalAssets = assets.filter((asset) => asset.scriptOrder !== null);
  return (canonicalAssets.length > 0 ? canonicalAssets : assets)
    .sort(compareThumbnailAssets)
    .map((asset, index) => ({ ...asset, index }));
}

export function titleGraphicPageCount(assetCount) {
  return Math.max(1, Math.ceil(Math.max(0, assetCount) / TITLE_GRAPHIC_PAGE_SIZE));
}

export function titleGraphicVisibleChoices(state, assets) {
  const page = normalizePage(state?.page ?? 0, assets.length);
  const start = page * TITLE_GRAPHIC_PAGE_SIZE;
  return assets
    .slice(start, start + TITLE_GRAPHIC_PAGE_SIZE)
    .map((asset, rowIndex) => titleGraphicChoice(asset, rowIndex));
}

export function titleGraphicControlAt(x, y, state, assets) {
  if (!state?.open) {
    return null;
  }
  if (state.viewerOpen) {
    return x >= 0 && x < STAGE_WIDTH && y >= 0 && y < STAGE_HEIGHT
      ? { kind: "viewer", action: "viewer_back" }
      : null;
  }
  for (const button of titleGraphicButtonControls(state, assets.length)) {
    if (
      x >= button.x
      && x < button.x + BUTTON_WIDTH
      && y >= button.y
      && y < button.y + BUTTON_HEIGHT
    ) {
      return button;
    }
  }
  for (const choice of titleGraphicVisibleChoices(state, assets)) {
    const cell = titleGraphicCellRect(choice.index);
    if (
      x >= cell.x
      && x < cell.x + cell.width
      && y >= cell.y
      && y < cell.y + cell.height
    ) {
      return { kind: "graphic", choice };
    }
  }
  return null;
}

export function titleGraphicHoverKey(control) {
  if (!control) {
    return -1;
  }
  if (control.kind === "graphic") {
    return control.choice.locked ? -1 : control.choice.index;
  }
  if (control.kind === "button") {
    return control.enabled ? control.hoverKey : -1;
  }
  return -1;
}

export function applyTitleGraphicControl(state, control, assetCount = 0) {
  if (!state?.open || !control) {
    return { handled: false, action: "" };
  }
  if (control.kind === "button" && control.action === "back") {
    closeTitleGraphic(state);
    return { handled: true, action: "back" };
  }
  if (control.kind === "viewer") {
    closeTitleGraphicViewer(state);
    return { handled: true, action: "viewer_back" };
  }
  if (control.kind === "button") {
    if (!control.enabled) {
      return { handled: true, action: "page", changed: false, page: state.page };
    }
    const changed = control.page === "previous"
      ? titleGraphicStepPage(state, -1, assetCount)
      : control.page === "next"
        ? titleGraphicStepPage(state, 1, assetCount)
        : control.page === "top"
          ? titleGraphicSetPage(state, 0, assetCount)
          : titleGraphicSetPage(state, titleGraphicPageCount(assetCount) - 1, assetCount);
    return { handled: true, action: "page", changed, page: state.page };
  }
  if (control.kind === "graphic") {
    if (control.choice.locked) {
      state.lastAction = "locked";
      return {
        handled: true,
        action: "locked",
        index: control.choice.index,
        assetName: control.choice.assetName,
      };
    }
    state.selectedIndex = control.choice.index;
    state.selectedAssetName = control.choice.assetName;
    state.viewerOpen = true;
    state.viewerAssetName = control.choice.fullAssetName || control.choice.assetName;
    state.viewerLoadOk = 0;
    state.viewerLoadReason = "";
    state.lastAction = "select";
    state.lastLoadOk = 0;
    state.lastLoadReason = "";
    return {
      handled: true,
      action: "select",
      index: control.choice.index,
      assetName: control.choice.assetName,
      fullAssetName: state.viewerAssetName,
    };
  }
  return { handled: false, action: "" };
}

export function titleGraphicSetPage(state, page, assetCount = 0) {
  if (!state) {
    return false;
  }
  const next = normalizePage(page, assetCount);
  if (state.page === next) {
    return false;
  }
  state.page = next;
  state.hoverIndex = -1;
  state.viewerOpen = false;
  state.lastAction = "page";
  return true;
}

export function titleGraphicStepPage(state, delta, assetCount = 0) {
  return titleGraphicSetPage(state, (state?.page ?? 0) + delta, assetCount);
}

export function titleGraphicCellRect(index) {
  const rowIndex = Math.max(0, index % TITLE_GRAPHIC_PAGE_SIZE);
  const column = rowIndex % TITLE_GRAPHIC_COLUMNS;
  const row = Math.floor(rowIndex / TITLE_GRAPHIC_COLUMNS);
  return {
    x: TITLE_GRAPHIC_CELL_X + column * TITLE_GRAPHIC_CELL_STEP_X,
    y: TITLE_GRAPHIC_CELL_Y + row * TITLE_GRAPHIC_CELL_STEP_Y,
    width: CELL_WIDTH,
    height: CELL_HEIGHT,
  };
}

export function paintTitleGraphic(
  context,
  canvas,
  state,
  assets,
  _buttons = {},
  imageCache = null,
  chromeCache = null,
) {
  if (!state?.open) {
    return false;
  }
  const pageCount = titleGraphicPageCount(assets.length);
  context.save();
  if (state.viewerOpen) {
    paintGraphicViewer(context, canvas, state, imageCache);
    context.restore();
    return true;
  }
  paintGraphicBackground(context, canvas, chromeCache);
  for (const choice of titleGraphicVisibleChoices(state, assets)) {
    paintGraphicCell(
      context,
      choice,
      state.hoverIndex === choice.index,
      state.selectedIndex === choice.index,
      imageCache,
      chromeCache,
    );
  }
  paintGraphicPageOverlay(context, chromeCache);
  paintGraphicPageNumbers(context, state.page + 1, pageCount);
  for (const button of titleGraphicButtonControls(state, assets.length)) {
    paintGraphicButton(context, button, state.hoverIndex === button.hoverKey, chromeCache);
  }
  context.restore();
  return true;
}

function titleGraphicChoice(asset, rowIndex) {
  return {
    ...asset,
    row: rowIndex,
    page: Math.floor(asset.index / TITLE_GRAPHIC_PAGE_SIZE),
    rect: titleGraphicCellRect(asset.index),
    fullAssetName: asset.fullAssetName || asset.assetName,
    unlocked: asset.unlocked !== false,
    locked: asset.locked === true,
  };
}

export function closeTitleGraphicViewer(state) {
  if (!state?.viewerOpen) {
    return false;
  }
  state.viewerOpen = false;
  state.hoverIndex = -1;
  state.lastAction = "viewer_back";
  return true;
}

function titleGraphicFullAssetName(assetName, gallerySlot) {
  return THUMBNAIL_FULL_ASSET_NAMES_BY_NAME.get(assetName)
    || THUMBNAIL_FULL_ASSET_NAMES.get(gallerySlot)
    || assetName;
}

function normalizeTitleGraphicUnlock(options) {
  const viewedImages = options?.viewedImages instanceof Set ? options.viewedImages : null;
  return {
    forceUnlock: options?.forceUnlock === true,
    viewedImages: viewedImages ?? new Set(),
  };
}

function titleGraphicAssetUnlocked(assetName, fullAssetName, unlock) {
  if (unlock.forceUnlock) {
    return true;
  }
  return unlock.viewedImages?.has(assetName)
    || unlock.viewedImages?.has(fullAssetName)
    || false;
}

function titleGraphicButtonControls(state, assetCount) {
  const pageCount = titleGraphicPageCount(assetCount);
  return GRAPHIC_BUTTONS.map((button, index) => {
    const enabled = button.action === "back"
      || (button.page === "previous" && (state?.page ?? 0) > 0)
      || (button.page === "next" && (state?.page ?? 0) + 1 < pageCount)
      || (button.page === "top" && (state?.page ?? 0) > 0)
      || (button.page === "last" && (state?.page ?? 0) + 1 < pageCount);
    return {
      ...button,
      kind: "button",
      x: TITLE_GRAPHIC_BUTTON_X + TITLE_GRAPHIC_BUTTON_STEP_X * index,
      y: TITLE_GRAPHIC_BUTTON_Y,
      enabled,
    };
  });
}

function paintGraphicCell(context, choice, hovered, selected, imageCache, chromeCache) {
  const rect = titleGraphicCellRect(choice.index);
  const image = choice.locked ? null : imageForAsset(imageCache, choice.assetName);
  if (image) {
    drawTitleGraphicImage(
      context,
      image,
      choice.assetName,
      rect.x + THUMBNAIL_X,
      rect.y + THUMBNAIL_Y,
      THUMBNAIL_WIDTH,
      THUMBNAIL_HEIGHT,
    );
  } else {
    const placeholder = chromeImage(chromeCache, "SGCG800001");
    if (placeholder) {
      context.drawImage(titleGraphicImageScratch(placeholder), rect.x, rect.y, rect.width, rect.height);
    } else {
      context.fillStyle = "rgba(11, 155, 218, 0.76)";
      context.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
  }
  if (choice.locked) {
    return;
  }
  context.lineWidth = selected || hovered ? 4 : 2;
  context.strokeStyle = selected
    ? "rgba(255, 75, 165, 0.96)"
    : hovered
      ? "rgba(103, 218, 255, 0.96)"
      : "rgba(220, 245, 255, 0.82)";
  context.strokeRect(rect.x + 1.5, rect.y + 1.5, rect.width - 3, rect.height - 3);
}

function paintGraphicBackground(context, canvas, chromeCache) {
  const background = chromeImage(chromeCache, "SGCG990000");
  if (background) {
    context.drawImage(
      titleGraphicImageScratch(background),
      0,
      0,
      canvas.width,
      canvas.height,
    );
    return;
  }
  context.fillStyle = "#136b8f";
  context.fillRect(0, 0, canvas.width, canvas.height);
}

function paintGraphicPageOverlay(context, chromeCache) {
  const overlay = chromeImage(chromeCache, "SGCG100000");
  if (overlay) {
    context.drawImage(
      titleGraphicImageScratch(overlay),
      0,
      0,
      imageLogicalWidth(overlay),
      imageLogicalHeight(overlay),
    );
  }
}

function paintGraphicPageNumbers(context, page, pageCount) {
  context.save();
  context.font = PAGE_FONT;
  context.textBaseline = "top";
  context.textAlign = "center";
  context.shadowColor = "rgba(255,255,255,0.95)";
  context.shadowBlur = 2;
  context.lineWidth = 3;
  context.strokeStyle = "rgba(255,255,255,0.85)";
  context.fillStyle = "#1d1d1d";
  const current = String(page);
  const total = String(pageCount);
  context.strokeText(current, PAGE_NUMBER_X, PAGE_NUMBER_Y);
  context.fillText(current, PAGE_NUMBER_X, PAGE_NUMBER_Y);
  context.strokeText(total, PAGE_COUNT_X, PAGE_NUMBER_Y);
  context.fillText(total, PAGE_COUNT_X, PAGE_NUMBER_Y);
  context.restore();
}

function paintGraphicButton(context, button, hovered, chromeCache) {
  const sheet = chromeImage(chromeCache, button.assetName);
  const state = !button.enabled ? 3 : hovered ? 1 : 0;
  if (sheet) {
    const stateWidth = Math.floor(sheet.width / BUTTON_SHEET_STATES);
    context.drawImage(
      titleGraphicImageScratch(sheet),
      state * stateWidth,
      0,
      stateWidth,
      sheet.height,
      button.x,
      button.y,
      BUTTON_WIDTH,
      BUTTON_HEIGHT,
    );
    return;
  }
  context.fillStyle = button.enabled ? "rgba(206, 232, 255, 0.86)" : "rgba(190, 190, 190, 0.72)";
  context.fillRect(button.x, button.y, BUTTON_WIDTH, BUTTON_HEIGHT);
  context.strokeStyle = hovered ? "#49b7df" : "#ffffff";
  context.strokeRect(button.x + 0.5, button.y + 0.5, BUTTON_WIDTH - 1, BUTTON_HEIGHT - 1);
}

function paintGraphicViewer(context, canvas, state, imageCache) {
  context.fillStyle = "#000000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const image = imageForAsset(imageCache, state.viewerAssetName)
    || imageForAsset(imageCache, state.selectedAssetName);
  if (image) {
    drawContainedImage(context, image, 0, 0, canvas.width, canvas.height);
    return;
  }
  context.fillStyle = "rgba(255, 255, 255, 0.75)";
  context.font = bgiMinchoFont(24);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("Now Loading", canvas.width / 2, canvas.height / 2);
}

function imageForAsset(imageCache, assetName) {
  return imageCache?.get?.(assetName)?.image ?? null;
}

function chromeImage(chromeCache, assetName) {
  return chromeCache?.get?.(assetName)?.image ?? null;
}

function drawContainedImage(context, image, x, y, width, height) {
  const logicalWidth = imageLogicalWidth(image);
  const logicalHeight = imageLogicalHeight(image);
  const scale = Math.min(width / logicalWidth, height / logicalHeight);
  const drawWidth = Math.max(1, Math.round(logicalWidth * scale));
  const drawHeight = Math.max(1, Math.round(logicalHeight * scale));
  const drawX = Math.round(x + (width - drawWidth) / 2);
  const drawY = Math.round(y + (height - drawHeight) / 2);
  context.drawImage(titleGraphicImageScratch(image), drawX, drawY, drawWidth, drawHeight);
}

function drawTitleGraphicImage(context, image, assetName, x, y, width, height) {
  const logicalWidth = imageLogicalWidth(image);
  const logicalHeight = imageLogicalHeight(image);
  if (/^ev_thum_\d+$/i.test(String(assetName ?? "")) && logicalWidth >= 600 && logicalHeight >= 113) {
    const sourceScaleX = image.width / logicalWidth;
    const sourceScaleY = image.height / logicalHeight;
    context.drawImage(
      titleGraphicImageScratch(image),
      Math.round(200 * sourceScaleX),
      0,
      Math.round(200 * sourceScaleX),
      Math.round(113 * sourceScaleY),
      x,
      y,
      width,
      height,
    );
    return;
  }
  drawContainedImage(context, image, x, y, width, height);
}

function normalizePage(page, assetCount) {
  const value = Number.isInteger(page) ? page : Number.parseInt(String(page), 10);
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(titleGraphicPageCount(assetCount) - 1, value));
}

function asciiAssetName(value) {
  if (value instanceof Uint8Array) {
    const end = value.indexOf(0);
    return ASSET_DECODER.decode(end >= 0 ? value.slice(0, end) : value).trim();
  }
  return typeof value === "string" ? value.trim() : "";
}

function compareGraphicAssets(left, right) {
  const leftArchive = graphicArchiveRank(left.archiveName);
  const rightArchive = graphicArchiveRank(right.archiveName);
  if (leftArchive !== rightArchive) {
    return leftArchive - rightArchive;
  }
  return left.assetName.localeCompare(right.assetName, "en", { numeric: true });
}

function compareThumbnailCandidate(left, right) {
  const archive = thumbnailArchiveRank(left.archiveName) - thumbnailArchiveRank(right.archiveName);
  if (archive !== 0) {
    return archive;
  }
  return left.size - right.size;
}

function compareThumbnailAssets(left, right) {
  const leftOrder = thumbnailScriptOrder(left);
  const rightOrder = thumbnailScriptOrder(right);
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }
  return (
    left.gallerySlot - right.gallerySlot
    || left.assetName.localeCompare(right.assetName, "en", { numeric: true })
    || compareGraphicAssets(left, right)
  );
}

function thumbnailScriptOrder(asset) {
  return asset.scriptOrder === null
    ? Number.MAX_SAFE_INTEGER
    : asset.scriptOrder;
}

function graphicArchiveRank(archiveName) {
  const match = /^data0([12])(\d+)\.arc$/i.exec(archiveName);
  if (!match) {
    return Number.MAX_SAFE_INTEGER;
  }
  const family = Number.parseInt(match[1], 10);
  const number = Number.parseInt(match[2], 10);
  if (family === 2 && number >= 500 && number <= 504) {
    return 100000 + number;
  }
  return family * 100000 + number;
}

function thumbnailArchiveRank(archiveName) {
  const normalized = String(archiveName ?? "").toLowerCase();
  if (normalized === "data02502.arc") {
    return 0;
  }
  if (/^data02.*\.arc$/.test(normalized)) {
    return 1;
  }
  return 2;
}

function titleGraphicImageScratch(image) {
  if (image.__titleGraphicScratch) {
    return image.__titleGraphicScratch;
  }
  const scratch = document.createElement("canvas");
  scratch.width = image.width;
  scratch.height = image.height;
  scratch.getContext("2d", { alpha: true }).putImageData(
    new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height),
    0,
    0,
  );
  image.__titleGraphicScratch = scratch;
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
