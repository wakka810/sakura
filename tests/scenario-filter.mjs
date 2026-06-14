import {
  beginScenarioColorFilter,
  beginScenarioPresetFilter,
  clearScenarioColorFilter,
  createScenarioFilterState,
  filterScenarioPixels,
  finishScenarioFilterTransition,
  resolvedScenarioFilter,
  setScenarioFilterProgress,
  snapshotScenarioFilter,
} from "../web/scenario-filter.js";

const state = createScenarioFilterState();
const duration = beginScenarioColorFilter(state, [1, 500, 0, 245, 103, 184, 250, 2]);
if (duration !== 500) {
  throw new Error("filter start duration was not preserved");
}
setScenarioFilterProgress(state, 0.5);
if (resolvedScenarioFilter(state)?.strength !== 125) {
  throw new Error("filter start transition did not interpolate strength");
}
finishScenarioFilterTransition(state);

const snapshot = snapshotScenarioFilter(state);
if (snapshot?.r !== 245 || snapshot.g !== 103 || snapshot.b !== 184 || snapshot.mode !== 2) {
  throw new Error("filter state did not commit");
}

const pixels = new Uint8ClampedArray([100, 150, 200, 255]);
filterScenarioPixels(pixels, snapshot);
const luminance = (100 * 77 + 150 * 151 + 200 * 28) >> 8;
const expectedRed = ((100 * 6) + (((luminance * 245) >> 8) * 250)) >> 8;
if (pixels[0] !== expectedRed || pixels[3] !== 255) {
  throw new Error("mode-2 colorization did not match the BGI integer formula");
}

const grayscalePreset = createScenarioFilterState();
if (beginScenarioPresetFilter(grayscalePreset, 3, [1, 1]) !== 1) {
  throw new Error("preset grayscale duration was not preserved");
}
setScenarioFilterProgress(grayscalePreset, 1);
finishScenarioFilterTransition(grayscalePreset);
if (
  grayscalePreset.current?.r !== 255
  || grayscalePreset.current.g !== 255
  || grayscalePreset.current.b !== 255
  || grayscalePreset.current.strength !== 256
  || grayscalePreset.current.mode !== 2
) {
  throw new Error("preset grayscale configuration was not committed");
}

const whitePreset = createScenarioFilterState();
if (beginScenarioPresetFilter(whitePreset, 4, [1, 500]) !== 500) {
  throw new Error("preset white-fade duration was not preserved");
}
setScenarioFilterProgress(whitePreset, 1);
finishScenarioFilterTransition(whitePreset);
if (whitePreset.current?.mode !== 3 || whitePreset.current.strength !== 256) {
  throw new Error("preset white-fade configuration was not committed");
}

const copied = new Uint8ClampedArray([20, 40, 80, 255]);
filterScenarioPixels(copied, {
  r: 255,
  g: 255,
  b: 255,
  strength: 256,
  mode: 0,
});
if (copied[0] !== 20 || copied[1] !== 40 || copied[2] !== 80 || copied[3] !== 255) {
  throw new Error("mode-0 filter did not preserve the source pixels");
}

if (clearScenarioColorFilter(state, [1, 1000]) !== 1000) {
  throw new Error("filter clear duration was not preserved");
}
setScenarioFilterProgress(state, 1);
finishScenarioFilterTransition(state);
if (resolvedScenarioFilter(state) !== null) {
  throw new Error("filter clear did not remove the filter");
}

console.log("scenario_filter=ok");
