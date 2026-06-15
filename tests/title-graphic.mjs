import assert from "node:assert/strict";
import {
  applyTitleGraphicControl,
  closeTitleGraphic,
  createTitleGraphicState,
  openTitleGraphic,
  titleGraphicAssets,
  titleGraphicCellRect,
  titleGraphicControlAt,
  titleGraphicHoverKey,
  titleGraphicPageCount,
  titleGraphicSetPage,
  titleGraphicStepPage,
  titleGraphicVisibleChoices,
  TITLE_GRAPHIC_BUTTON_STEP_X,
  TITLE_GRAPHIC_BUTTON_X,
  TITLE_GRAPHIC_BUTTON_Y,
  TITLE_GRAPHIC_CELL_STEP_X,
  TITLE_GRAPHIC_CELL_STEP_Y,
  TITLE_GRAPHIC_CELL_X,
  TITLE_GRAPHIC_CELL_Y,
  TITLE_GRAPHIC_PAGE_SIZE,
  TITLE_GRAPHIC_SCRIPT_THUMBNAIL_NAMES,
} from "../web/title-graphic.js";

const textEncoder = new TextEncoder();

function bytes(value) {
  return textEncoder.encode(value);
}

function fakeCatalog() {
  const archives = [
    { name: bytes("data01000.arc") },
    { name: bytes("data02000.arc") },
    { name: bytes("sysgrp.arc") },
    { name: bytes("data03xxx.arc") },
  ];
  const records = [
    { name: bytes("evb000a"), archiveIndex: 0, size: 100 },
    { name: bytes("ev_thum_001"), archiveIndex: 0, size: 50 },
    { name: bytes("EVB000A"), archiveIndex: 1, size: 100 },
    { name: bytes("ev7001a"), archiveIndex: 1, size: 200 },
    { name: bytes("bg1000a"), archiveIndex: 0, size: 300 },
    { name: bytes("evsys00"), archiveIndex: 2, size: 400 },
    { name: bytes("evlate00"), archiveIndex: 3, size: 500 },
  ];
  for (let index = 0; index < 14; index += 1) {
    records.push({ name: bytes(`evtest${String(index).padStart(2, "0")}`), archiveIndex: index % 2, size: 10 });
  }
  return {
    archives: () => archives.values(),
    records: () => records.values(),
  };
}

function fakeThumbnailCatalog() {
  const archives = [
    { name: bytes("data02099.arc") },
    { name: bytes("data02502.arc") },
    { name: bytes("data02503.arc") },
  ];
  const records = [
    { name: bytes("ev0001a"), archiveIndex: 2, size: 200 },
    { name: bytes("ev_thum_2"), archiveIndex: 1, size: 30 },
    { name: bytes("ev_thum_0"), archiveIndex: 1, size: 10 },
    { name: bytes("ev_thum_1"), archiveIndex: 0, size: 25 },
    { name: bytes("ev_thum_1"), archiveIndex: 1, size: 20 },
  ];
  return {
    archives: () => archives.values(),
    records: () => records.values(),
  };
}

function fakeScriptOrderThumbnailCatalog() {
  const archives = [
    { name: bytes("data02099.arc") },
    { name: bytes("data02502.arc") },
  ];
  const records = [
    { name: bytes("ev_thum_141"), archiveIndex: 0, size: 12 },
    { name: bytes("ev_thum_32"), archiveIndex: 1, size: 20 },
    { name: bytes("ev_thum_137"), archiveIndex: 1, size: 21 },
    { name: bytes("ev_thum_31"), archiveIndex: 1, size: 22 },
    { name: bytes("ev_thum_45b"), archiveIndex: 1, size: 23 },
    { name: bytes("ev_thum_136"), archiveIndex: 1, size: 24 },
  ];
  return {
    archives: () => archives.values(),
    records: () => records.values(),
  };
}

assert.equal(TITLE_GRAPHIC_SCRIPT_THUMBNAIL_NAMES.length, 140);
assert.deepEqual(TITLE_GRAPHIC_SCRIPT_THUMBNAIL_NAMES.slice(30, 35), [
  "ev_thum_30",
  "ev_thum_31",
  "ev_thum_136",
  "ev_thum_32",
  "ev_thum_137",
]);
assert.equal(TITLE_GRAPHIC_SCRIPT_THUMBNAIL_NAMES.includes("ev_thum_45b"), true);
assert.equal(TITLE_GRAPHIC_SCRIPT_THUMBNAIL_NAMES.includes("ev_thum_141"), false);

const thumbnailAssets = titleGraphicAssets(fakeThumbnailCatalog());
assert.equal(thumbnailAssets.length, 3);
assert.equal(thumbnailAssets[0].assetName, "ev_thum_0");
assert.equal(thumbnailAssets[0].fullAssetName, "evb000b");
assert.equal(thumbnailAssets[0].unlocked, true);
assert.equal(thumbnailAssets[1].assetName, "ev_thum_1");
assert.equal(thumbnailAssets[1].archiveName, "data02502.arc");
assert.equal(thumbnailAssets[1].fullAssetName, "ev6000a");
assert.equal(thumbnailAssets[2].assetName, "ev_thum_2");

const lockedThumbnailAssets = titleGraphicAssets(fakeThumbnailCatalog(), {
  viewedImages: new Set(["ev6000a"]),
});
assert.equal(lockedThumbnailAssets.length, 3);
assert.equal(lockedThumbnailAssets[0].locked, true);
assert.equal(lockedThumbnailAssets[1].unlocked, true);
assert.equal(lockedThumbnailAssets[2].locked, true);

const scriptOrderAssets = titleGraphicAssets(fakeScriptOrderThumbnailCatalog());
assert.deepEqual(scriptOrderAssets.map((asset) => asset.assetName), [
  "ev_thum_31",
  "ev_thum_136",
  "ev_thum_32",
  "ev_thum_137",
  "ev_thum_45b",
]);
assert.equal(scriptOrderAssets[4].fullAssetName, "ev4010a");

const assets = titleGraphicAssets(fakeCatalog());
assert.equal(assets.length, 16);
assert.equal(assets[0].assetName, "evb000a");
assert.equal(assets[1].assetName, "evtest00");
assert.equal(assets[8].assetName, "ev7001a");
assert.equal(assets.at(-1).assetName, "evtest13");
assert.equal(titleGraphicPageCount(assets.length), 2);

assert.deepEqual(titleGraphicCellRect(0), {
  x: TITLE_GRAPHIC_CELL_X,
  y: TITLE_GRAPHIC_CELL_Y,
  width: 291,
  height: 170,
});
assert.deepEqual(titleGraphicCellRect(5), {
  x: TITLE_GRAPHIC_CELL_X + TITLE_GRAPHIC_CELL_STEP_X,
  y: TITLE_GRAPHIC_CELL_Y + TITLE_GRAPHIC_CELL_STEP_Y,
  width: 291,
  height: 170,
});

const state = createTitleGraphicState();
assert.equal(titleGraphicControlAt(TITLE_GRAPHIC_CELL_X, TITLE_GRAPHIC_CELL_Y, state, assets), null);
assert.equal(openTitleGraphic(state), true);
assert.equal(titleGraphicVisibleChoices(state, assets).length, TITLE_GRAPHIC_PAGE_SIZE);

const first = titleGraphicControlAt(TITLE_GRAPHIC_CELL_X + 1, TITLE_GRAPHIC_CELL_Y + 1, state, assets);
assert.equal(first.kind, "graphic");
assert.equal(first.choice.assetName, "evb000a");
assert.equal(titleGraphicHoverKey(first), 0);

const selected = applyTitleGraphicControl(state, first, assets.length);
assert.deepEqual(selected, {
  handled: true,
  action: "select",
  index: 0,
  assetName: "evb000a",
  fullAssetName: "evb000a",
});
assert.equal(state.selectedIndex, 0);
assert.equal(state.selectedAssetName, "evb000a");
assert.equal(state.viewerOpen, true);
assert.equal(state.viewerAssetName, "evb000a");
const viewer = titleGraphicControlAt(10, 10, state, assets);
assert.equal(viewer.kind, "viewer");
assert.equal(titleGraphicHoverKey(viewer), -1);

const lockedState = createTitleGraphicState();
const lockedAssets = titleGraphicAssets(fakeCatalog(), { viewedImages: new Set(["evtest00"]) });
openTitleGraphic(lockedState);
const lockedFirst = titleGraphicControlAt(
  TITLE_GRAPHIC_CELL_X + 1,
  TITLE_GRAPHIC_CELL_Y + 1,
  lockedState,
  lockedAssets,
);
assert.equal(lockedFirst.kind, "graphic");
assert.equal(lockedFirst.choice.locked, true);
assert.equal(titleGraphicHoverKey(lockedFirst), -1);
assert.deepEqual(applyTitleGraphicControl(lockedState, lockedFirst, lockedAssets.length), {
  handled: true,
  action: "locked",
  index: 0,
  assetName: "evb000a",
});
assert.equal(lockedState.viewerOpen, false);

assert.equal(titleGraphicSetPage(state, 1, assets.length), true);
assert.equal(state.page, 1);
assert.equal(state.viewerOpen, false);
assert.equal(titleGraphicVisibleChoices(state, assets).length, 8);
assert.equal(titleGraphicStepPage(state, 1, assets.length), false);
assert.equal(state.page, 1);
assert.equal(titleGraphicStepPage(state, -1, assets.length), true);
assert.equal(state.page, 0);

const next = titleGraphicControlAt(
  TITLE_GRAPHIC_BUTTON_X + TITLE_GRAPHIC_BUTTON_STEP_X + 1,
  TITLE_GRAPHIC_BUTTON_Y + 1,
  state,
  assets,
);
assert.deepEqual(applyTitleGraphicControl(state, next, assets.length), {
  handled: true,
  action: "page",
  changed: true,
  page: 1,
});

const top = titleGraphicControlAt(
  TITLE_GRAPHIC_BUTTON_X + TITLE_GRAPHIC_BUTTON_STEP_X * 2 + 1,
  TITLE_GRAPHIC_BUTTON_Y + 1,
  state,
  assets,
);
assert.deepEqual(applyTitleGraphicControl(state, top, assets.length), {
  handled: true,
  action: "page",
  changed: true,
  page: 0,
});

const back = titleGraphicControlAt(
  TITLE_GRAPHIC_BUTTON_X + TITLE_GRAPHIC_BUTTON_STEP_X * 4 + 1,
  TITLE_GRAPHIC_BUTTON_Y + 1,
  state,
  assets,
);
assert.equal(back.kind, "button");
assert.equal(back.action, "back");
assert.equal(titleGraphicHoverKey(back), -2);
assert.deepEqual(applyTitleGraphicControl(state, back, assets.length), { handled: true, action: "back" });
assert.equal(state.open, false);
assert.equal(closeTitleGraphic(state), false);

console.log("title_graphic=ok");
