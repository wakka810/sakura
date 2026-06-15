import assert from "node:assert/strict";
import { DEFAULT_SCENARIO_ROUTE } from "../web/scenario-routes.js";
import {
  applyTitleSceneControl,
  closeTitleSceneSelect,
  createTitleSceneSelectState,
  openTitleSceneSelect,
  titleSceneCellRect,
  titleSceneChoices,
  titleSceneControlAt,
  titleSceneHoverKey,
  TITLE_SCENE_CELL_HEIGHT,
  TITLE_SCENE_CELL_WIDTH,
  TITLE_SCENE_GRID_X,
  TITLE_SCENE_GRID_Y,
} from "../web/title-scene-select.js";

assert.deepEqual(TITLE_SCENE_GRID_X, [40, 185, 330, 475, 620]);
assert.deepEqual(TITLE_SCENE_GRID_Y, [125, 235, 345, 455]);
assert.equal(TITLE_SCENE_CELL_WIDTH, 140);
assert.equal(TITLE_SCENE_CELL_HEIGHT, 105);

const choices = titleSceneChoices();
assert.equal(choices.length, 14);
assert.deepEqual(
  choices.map((choice) => [
    choice.index,
    choice.routeId,
    choice.scenarioName,
    choice.thumbnailAssetName,
    choice.replayId,
    choice.scriptSlot,
    choice.scriptPage,
    choice.row,
    choice.column,
  ]),
  [
    [0, DEFAULT_SCENARIO_ROUTE, "h_rn_01", "h_thum_rn_01", 103, 0, 0, 0, 0],
    [1, DEFAULT_SCENARIO_ROUTE, "h_rn_02", "h_thum_rn_02", 104, 1, 0, 0, 1],
    [2, DEFAULT_SCENARIO_ROUTE, "h_rn_03", "h_thum_rn_03", 105, 2, 0, 0, 2],
    [3, DEFAULT_SCENARIO_ROUTE, "h_rn_04", "h_thum_rn_04", 106, 3, 0, 0, 3],
    [4, DEFAULT_SCENARIO_ROUTE, "h_mk_01", "h_thum_mk_01", 101, 4, 0, 0, 4],
    [5, DEFAULT_SCENARIO_ROUTE, "h_mk_02", "h_thum_mk_02", 102, 5, 0, 1, 0],
    [6, DEFAULT_SCENARIO_ROUTE, "h_hr_01", "h_thum_hr_01", 107, 6, 0, 1, 1],
    [7, DEFAULT_SCENARIO_ROUTE, "h_hr_02", "h_thum_hr_02", 108, 7, 0, 1, 2],
    [8, DEFAULT_SCENARIO_ROUTE, "h_ym_01", "h_thum_ym_01", 109, 0, 1, 1, 3],
    [9, DEFAULT_SCENARIO_ROUTE, "h_sz_01", "h_thum_sz_01", 110, 1, 1, 1, 4],
    [10, DEFAULT_SCENARIO_ROUTE, "h_sz_02", "h_thum_sz_02", 111, 2, 1, 2, 0],
    [11, DEFAULT_SCENARIO_ROUTE, "h_sz_03", "h_thum_sz_03", 112, 3, 1, 2, 1],
    [12, DEFAULT_SCENARIO_ROUTE, "h_sz_04", "h_thum_sz_04", 113, 4, 1, 2, 2],
    [13, DEFAULT_SCENARIO_ROUTE, "h_ai_01", "h_thum_ai_01", 114, 5, 1, 2, 3],
  ],
);

assert.deepEqual(titleSceneCellRect(0), { x: 40, y: 125, width: 140, height: 105 });
assert.deepEqual(titleSceneCellRect(4), { x: 620, y: 125, width: 140, height: 105 });
assert.deepEqual(titleSceneCellRect(13), { x: 475, y: 345, width: 140, height: 105 });

const state = createTitleSceneSelectState();
assert.equal(titleSceneControlAt(41, 126, state), null);
assert.equal(openTitleSceneSelect(state), true);
assert.equal(state.open, true);

const first = titleSceneControlAt(41, 126, state);
assert.equal(first.kind, "scene");
assert.equal(first.choice.scenarioName, "h_rn_01");
assert.equal(first.choice.thumbnailAssetName, "h_thum_rn_01");
assert.equal(titleSceneHoverKey(first), 0);

const last = titleSceneControlAt(476, 346, state);
assert.equal(last.kind, "scene");
assert.equal(last.choice.routeId, DEFAULT_SCENARIO_ROUTE);
assert.equal(last.choice.scenarioName, "h_ai_01");
assert.equal(last.choice.thumbnailAssetName, "h_thum_ai_01");
assert.equal(titleSceneHoverKey(last), 13);

const back = titleSceneControlAt(981, 611, state, {
  back: { stateWidth: 96, stateHeight: 32 },
});
assert.deepEqual(back, { kind: "back" });
assert.equal(titleSceneHoverKey(back), -2);

const selected = applyTitleSceneControl(state, last);
assert.deepEqual(selected, {
  handled: true,
  action: "select",
  routeId: DEFAULT_SCENARIO_ROUTE,
  scenarioName: "h_ai_01",
  scenarioIndex: 0,
  replayId: 114,
  thumbnailAssetName: "h_thum_ai_01",
});
assert.equal(state.open, false);
assert.equal(state.selectedRoute, DEFAULT_SCENARIO_ROUTE);
assert.equal(state.selectedScenarioName, "h_ai_01");
assert.equal(state.selectedReplayId, 114);
assert.equal(state.selectedThumbnailAssetName, "h_thum_ai_01");

openTitleSceneSelect(state);
assert.equal(closeTitleSceneSelect(state), true);
assert.equal(state.open, false);

console.log("title_scene_select=ok");
