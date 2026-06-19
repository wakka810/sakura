import assert from "node:assert/strict";
import {
  captureLocalStorageSnapshot,
  normalizeCloudStateSnapshot,
  restoreLocalStorageSnapshot,
} from "../web/cloud-state.js";

const storage = memoryStorage({
  "sakura.session.slot.0": "save-record",
  "sakura.config.v1": JSON.stringify({ version: 1 }),
  "external.key": "kept because cloud state mirrors the whole origin",
});

const snapshot = captureLocalStorageSnapshot(storage);
assert.equal(snapshot.version, 1);
assert.equal(snapshot.metadata.keyCount, 3);
assert.equal(snapshot.localStorage["sakura.session.slot.0"], "save-record");
assert.equal(snapshot.localStorage["external.key"], "kept because cloud state mirrors the whole origin");

storage.setItem("sakura.session.slot.0", "changed");
storage.setItem("temporary", "remove");
const restore = restoreLocalStorageSnapshot(snapshot, storage);
assert.equal(restore.ok, true);
assert.equal(restore.keyCount, 3);
assert.equal(storage.getItem("sakura.session.slot.0"), "save-record");
assert.equal(storage.getItem("temporary"), null);
assert.equal(storage.getItem("external.key"), "kept because cloud state mirrors the whole origin");

assert.throws(() => normalizeCloudStateSnapshot({
  version: 1,
  localStorage: { "bad": 1 },
}), /must be a string/);

console.log("cloud_state=ok");

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    key(index) {
      return Array.from(values.keys()).sort()[index] ?? null;
    },
    getItem(key) {
      return values.get(String(key)) ?? null;
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
    removeItem(key) {
      values.delete(String(key));
    },
    clear() {
      values.clear();
    },
  };
}
