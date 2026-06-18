import assert from "node:assert/strict";
import {
  SCENE_REPLAY_UNLOCK_CGS,
  TITLE_SCENE_REPLAY_ENTRIES,
  titleSceneRowUnlocked,
} from "../web/title-scene-select.js";

// --- map covers all 14 replay rows, with sane evNNNN prefixes ---
assert.equal(TITLE_SCENE_REPLAY_ENTRIES.length, 14);
for (const entry of TITLE_SCENE_REPLAY_ENTRIES) {
  const prefixes = SCENE_REPLAY_UNLOCK_CGS[entry.scenarioName];
  assert.ok(Array.isArray(prefixes) && prefixes.length > 0, `missing unlock CGs for ${entry.scenarioName}`);
  for (const p of prefixes) {
    assert.match(p, /^ev[0-9]{4}$/, `bad prefix ${p} for ${entry.scenarioName}`);
  }
}

// --- locked when nothing viewed ---
assert.equal(titleSceneRowUnlocked("h_rn_01", new Set()), false);
assert.equal(titleSceneRowUnlocked("h_ai_01", new Set()), false);

// --- unlocked when any of the row's scene CGs (any variant) is viewed ---
assert.equal(titleSceneRowUnlocked("h_rn_01", new Set(["ev0101a"])), true);
assert.equal(titleSceneRowUnlocked("h_rn_01", new Set(["ev0101z"])), true, "variant letter still matches the prefix");
assert.equal(titleSceneRowUnlocked("h_rn_04", new Set(["ev0107a"])), true);
assert.equal(titleSceneRowUnlocked("h_ai_01", new Set(["ev5102k"])), true);
assert.equal(titleSceneRowUnlocked("h_sz_02", new Set(["bg1000a", "ev1103d"])), true);

// --- unrelated CGs do not unlock ---
assert.equal(titleSceneRowUnlocked("h_rn_01", new Set(["ev9999a", "bg1018a"])), false);
assert.equal(titleSceneRowUnlocked("h_rn_01", new Set(["ev0103a"])), false, "ev0103 belongs to rn_02, not rn_01");

// --- shared ev0102 (rn_01 & rn_02, co-located in 03_olympia_05) unlocks both ---
assert.equal(titleSceneRowUnlocked("h_rn_01", new Set(["ev0102a"])), true);
assert.equal(titleSceneRowUnlocked("h_rn_02", new Set(["ev0102a"])), true);

// --- defensive: unmapped row fails open; bad input stays locked ---
assert.equal(titleSceneRowUnlocked("does_not_exist", new Set()), true);
assert.equal(titleSceneRowUnlocked("h_rn_01", null), false);
assert.equal(titleSceneRowUnlocked("h_rn_01", ["ev0101a"]), false, "non-Set input is rejected");

console.log("title_scene_unlock=ok");
