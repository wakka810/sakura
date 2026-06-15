import assert from "node:assert/strict";
import {
  applyScenarioDialogControl,
  closeScenarioDialog,
  createScenarioDialogState,
  openScenarioDialog,
  scenarioDialogControlAt,
  scenarioDialogHoverKey,
} from "../web/scenario-dialog-window.js";

const skin = {
  buttons: {
    yes: image(908, 61),
    no: image(908, 61),
  },
  panels: {
    exit: image(722, 242),
    title: image(722, 242),
    save: image(722, 242),
    overwrite: image(722, 242),
    load: image(722, 242),
    delete: image(722, 242),
    quickSave: image(722, 242),
  },
};

const state = createScenarioDialogState();
assert.equal(openScenarioDialog(state, "exit", "titleExit"), true);
assert.equal(state.open, true);
assert.equal(state.kind, "exit");
assert.equal(state.source, "titleExit");

const yes = scenarioDialogControlAt(516, 422, state, skin);
assert.deepEqual(yes, { kind: "button", action: "yes" });
assert.equal(scenarioDialogHoverKey(yes), "yes");
let result = applyScenarioDialogControl(state, yes);
assert.equal(result.reason, "yes");
assert.equal(result.ok, true);
assert.equal(state.open, false);
assert.equal(state.result, "yes");

assert.equal(openScenarioDialog(state, "title", "scenarioConfigTitle"), true);
const no = scenarioDialogControlAt(764, 422, state, skin);
assert.deepEqual(no, { kind: "button", action: "no" });
result = applyScenarioDialogControl(state, no);
assert.equal(result.reason, "no");
assert.equal(result.ok, false);
assert.equal(state.open, false);
assert.equal(state.result, "no");

assert.equal(openScenarioDialog(state, "missing"), false);
assert.equal(openScenarioDialog(state, "save", "test"), true);
assert.equal(scenarioDialogControlAt(20, 20, state, skin), null);
assert.equal(closeScenarioDialog(state), true);
assert.equal(state.open, false);
assert.equal(state.result, "cancel");

assert.equal(openScenarioDialog(state, "quickSave", "scenarioQuickSaveNotice"), true);
const notice = scenarioDialogControlAt(20, 20, state, skin);
assert.deepEqual(notice, { kind: "notice", action: "ack" });
result = applyScenarioDialogControl(state, { kind: "button", action: "yes" });
assert.equal(result.reason, "ack");
assert.equal(state.open, false);
assert.equal(state.result, "ack");

console.log("scenario_dialog_window=ok");

function image(width, height) {
  return { width, height, pixels: new Uint8Array(width * height * 4) };
}
