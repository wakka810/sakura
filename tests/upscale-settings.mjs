import assert from "node:assert/strict";
import {
  DEFAULT_UPSCALE_SETTINGS,
  normalizeUpscaleSettings,
  readStoredUpscaleSettings,
  storeUpscaleSettings,
  UPSCALE_SETTINGS_STORAGE_KEY,
} from "../web/upscale-client.js";

assert.deepEqual(normalizeUpscaleSettings(), DEFAULT_UPSCALE_SETTINGS);
assert.deepEqual(normalizeUpscaleSettings({
  upscaleEnabled: true,
  upscaleScale: 2,
  upscaleModel: "hat",
  upscaleQualityMode: "quality",
}), {
  upscaleEnabled: true,
  upscaleScale: 2,
  upscaleModel: "hat",
  upscaleQualityMode: "quality",
});
assert.deepEqual(normalizeUpscaleSettings({
  upscaleEnabled: true,
  upscaleScale: 4,
  upscaleModel: "bad",
  upscaleQualityMode: "bad",
}), {
  upscaleEnabled: true,
  upscaleScale: DEFAULT_UPSCALE_SETTINGS.upscaleScale,
  upscaleModel: DEFAULT_UPSCALE_SETTINGS.upscaleModel,
  upscaleQualityMode: DEFAULT_UPSCALE_SETTINGS.upscaleQualityMode,
});

const values = new Map();
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
};
assert.equal(storeUpscaleSettings({
  upscaleEnabled: true,
  upscaleScale: 2,
  upscaleModel: "waifu2x",
  upscaleQualityMode: "fast",
}, storage), true);
assert.equal(values.has(UPSCALE_SETTINGS_STORAGE_KEY), true);
assert.deepEqual(readStoredUpscaleSettings(storage), {
  upscaleEnabled: true,
  upscaleScale: 2,
  upscaleModel: "waifu2x",
  upscaleQualityMode: "fast",
});

console.log("upscale_settings=ok");
