import assert from "node:assert/strict";
import {
  loadViewedData,
  normalizeViewedName,
  recordViewed,
  viewedDataHas,
  viewedDataSnapshot,
  VIEWED_DATA_STORAGE_KEY,
} from "../web/viewed-data.js";

// In-memory storage stub mirroring localStorage's getItem/setItem.
function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
  };
}

// --- name normalization ---
assert.equal(normalizeViewedName("EV4001A"), "ev4001a");
assert.equal(normalizeViewedName(" bgm001 "), "bgm001");
assert.equal(normalizeViewedName("00_op_01"), "00_op_01");
assert.equal(normalizeViewedName("../bad"), null);
assert.equal(normalizeViewedName("bad name"), null);
assert.equal(normalizeViewedName(""), null);
assert.equal(normalizeViewedName(null), null);

// --- empty load ---
const empty = makeStorage();
const data = loadViewedData(empty);
assert.deepEqual(viewedDataSnapshot(data), { cgCount: 0, bgmCount: 0, sceneCount: 0, movieCount: 0 });

// --- record + dedup + persist ---
assert.equal(recordViewed(data, "cg", "EV4001A", empty), true);
assert.equal(recordViewed(data, "cg", "ev4001a", empty), false, "duplicate (case-insensitive) not re-added");
assert.equal(recordViewed(data, "cg", "../bad", empty), false, "invalid name rejected");
assert.equal(recordViewed(data, "bogus", "x", empty), false, "unknown category rejected");
assert.equal(recordViewed(data, "bgm", "bgm040", empty), true);
assert.equal(recordViewed(data, "scene", "00_op_01", empty), true);
assert.equal(recordViewed(data, "movie", "op", empty), true);

assert.equal(viewedDataHas(data, "cg", "ev4001a"), true);
assert.equal(viewedDataHas(data, "cg", "EV4001A"), true);
assert.equal(viewedDataHas(data, "cg", "ev9999z"), false);
assert.equal(viewedDataHas(data, "movie", "op"), true);
assert.deepEqual(viewedDataSnapshot(data), { cgCount: 1, bgmCount: 1, sceneCount: 1, movieCount: 1 });

// --- persistence round-trip: a fresh load sees the persisted entries ---
const reloaded = loadViewedData(empty);
assert.equal(viewedDataHas(reloaded, "cg", "ev4001a"), true);
assert.equal(viewedDataHas(reloaded, "bgm", "bgm040"), true);
assert.equal(viewedDataHas(reloaded, "scene", "00_op_01"), true);
assert.equal(viewedDataHas(reloaded, "movie", "op"), true);

// --- stored payload shape ---
const stored = JSON.parse(empty.getItem(VIEWED_DATA_STORAGE_KEY));
assert.equal(stored.version, 1);
assert.deepEqual(stored.viewed.cg, ["ev4001a"]);
assert.deepEqual(stored.viewed.movie, ["op"]);

// --- corrupt payload loads as empty ---
const corrupt = makeStorage({ [VIEWED_DATA_STORAGE_KEY]: "{not json" });
assert.deepEqual(viewedDataSnapshot(loadViewedData(corrupt)), { cgCount: 0, bgmCount: 0, sceneCount: 0, movieCount: 0 });

// --- absent storage is safe ---
assert.equal(recordViewed(loadViewedData(null), "cg", "ev0001a", null), true);

console.log("viewed_data=ok");
