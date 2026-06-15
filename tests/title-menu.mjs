import assert from "node:assert/strict";
import {
  readTitleClearState,
  recordTitleRouteClear,
  titleExtraUnlocked,
  titleMenuControls,
  TITLE_CLEAR_STORAGE_KEY,
  TITLE_MENU_MODE_EXTRA,
  TITLE_MENU_MODE_MAIN,
} from "../web/title-menu.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

assert.deepEqual(
  titleMenuControls(TITLE_MENU_MODE_MAIN, false).map((control) => [
    control.label,
    control.action,
    control.x,
    control.y,
    control.enabled,
  ]),
  [
    ["Start", "start", 232, 556, true],
    ["Load", "load", 464, 556, true],
    ["Config", "config", 696, 556, true],
    ["Exit", "exit", 928, 556, true],
  ],
);

assert.deepEqual(
  titleMenuControls(TITLE_MENU_MODE_MAIN, true).map((control) => [
    control.label,
    control.action,
    control.x,
    control.y,
  ]),
  [
    ["Start", "start", 116, 556],
    ["Load", "load", 348, 556],
    ["Config", "config", 580, 556],
    ["Extra", "extra", 812, 556],
    ["Exit", "exit", 1044, 556],
  ],
);

assert.deepEqual(
  titleMenuControls(TITLE_MENU_MODE_EXTRA, true).map((control) => [
    control.label,
    control.action,
    control.routeId,
    control.x,
    control.y,
    control.enabled,
  ]),
  [
    ["Graphic", "graphic", "", 232, 556, true],
    ["Scene", "scene", "", 464, 556, true],
    ["Music", "music", "", 696, 556, true],
    ["back", "back", "", 928, 556, true],
    ["IV", "route", "iv", 348, 585, true],
    ["V", "route", "v", 580, 585, true],
    ["VI", "route", "vi", 812, 585, true],
  ],
);

const storage = memoryStorage();
assert.equal(titleExtraUnlocked(storage), false);
assert.equal(recordTitleRouteClear("iv", "ed05", storage), true);
assert.equal(titleExtraUnlocked(storage), true);
assert.deepEqual(readTitleClearState(storage).routes.iv.endingScenario, "ed05");
assert.equal(recordTitleRouteClear("bad", "ed99", storage), false);

const encoded = JSON.parse(storage.getItem(TITLE_CLEAR_STORAGE_KEY));
assert.equal(encoded.version, 1);
assert.deepEqual(Object.keys(encoded.routes), ["iv"]);

console.log("title_menu=ok");
