import {
  createScenarioScreenShake,
  createPresetScenarioShake,
  scenarioShakeOffset,
} from "../web/scenario-shake.js";

const shake = createPresetScenarioShake(1, 3, 1000);
if (
  shake.durationMs !== 1680
  || shake.periodMs !== 60
  || shake.cycles !== 28
  || shake.decayPercent !== 12
  || shake.engineStrength !== 400
) {
  throw new Error("0x03f1 strong preset does not match scrgrp1._bp");
}

const initial = scenarioShakeOffset(shake, 1000);
if (!initial.active || initial.x !== 18 || initial.y !== 18) {
  throw new Error("preset direction and engine amplitude scaling are incorrect");
}

const afterOneCycle = scenarioShakeOffset(shake, 1060);
if (!afterOneCycle.active || afterOneCycle.x >= initial.x || afterOneCycle.y >= initial.y) {
  throw new Error("preset decay was not applied per vibration cycle");
}

const finished = scenarioShakeOffset(shake, 2680);
if (finished.active || finished.x !== 0 || finished.y !== 0) {
  throw new Error("preset shake did not terminate after period times count");
}

const weak = createPresetScenarioShake(0, 0, 0);
if (weak.durationMs !== 240 || weak.vectorX !== 1 || weak.vectorY !== 0) {
  throw new Error("0x03f1 weak horizontal preset is incorrect");
}

const screenShake = createScenarioScreenShake([0, 10, 2, 25, 5, 240], 2000);
if (
  screenShake.durationMs !== 240
  || screenShake.mode !== 0
  || screenShake.cycles !== 2
  || screenShake.decayPercent !== 25
  || screenShake.peakPixels !== 5
) {
  throw new Error("0x0232 screen shake arguments were not decoded");
}

const screenInitial = scenarioShakeOffset(screenShake, 2000);
if (!screenInitial.active || screenInitial.x !== 0 || screenInitial.y !== -5) {
  throw new Error(`0x0232 initial triangular offset drifted ${JSON.stringify(screenInitial)}`);
}

const screenMid = scenarioShakeOffset(screenShake, 2060);
if (!screenMid.active || screenMid.x !== 0 || screenMid.y !== 5) {
  throw new Error(`0x0232 first-cycle triangular peak drifted ${JSON.stringify(screenMid)}`);
}

const screenDecayed = scenarioShakeOffset(screenShake, 2180);
if (!screenDecayed.active || screenDecayed.x !== 0 || screenDecayed.y !== 4) {
  throw new Error(`0x0232 cycle decay drifted ${JSON.stringify(screenDecayed)}`);
}

console.log("scenario_shake=ok");
