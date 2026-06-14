import {
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

console.log("scenario_shake=ok");
