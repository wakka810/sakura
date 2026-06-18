import assert from "node:assert/strict";
import {
  scenarioCanSkipCurrent,
  scenarioChoiceAutoSkipResumeMode,
  scenarioEffectiveAutomaticDurationMs,
  scenarioReadEventKey,
} from "../web/session-player.js";

const baseSettings = {
  continueSkipAfterChoice: false,
  continueAutoAfterChoice: false,
};

assert.equal(scenarioChoiceAutoSkipResumeMode({
  skipMode: true,
  autoMode: false,
  configState: { settings: baseSettings },
}), "");

assert.equal(scenarioChoiceAutoSkipResumeMode({
  skipMode: true,
  autoMode: false,
  configState: { settings: { ...baseSettings, continueSkipAfterChoice: true } },
}), "skip");

assert.equal(scenarioChoiceAutoSkipResumeMode({
  skipMode: false,
  autoMode: true,
  configState: { settings: { ...baseSettings, continueAutoAfterChoice: true } },
}), "auto");

assert.equal(scenarioChoiceAutoSkipResumeMode({
  skipMode: true,
  autoMode: true,
  configState: {
    settings: {
      continueSkipAfterChoice: true,
      continueAutoAfterChoice: true,
    },
  },
}), "skip");

assert.equal(scenarioCanSkipCurrent({
  skipMode: false,
  configState: { settings: { skipMode: "all" } },
}), false);

assert.equal(scenarioCanSkipCurrent({
  skipMode: true,
  configState: { settings: { skipMode: "all" } },
}), true);

assert.equal(scenarioCanSkipCurrent({
  skipMode: true,
  configState: { settings: { skipMode: "read" } },
}), false);

const readEvent = {
  kind: 1,
  eventCount: 12,
  opcode: 0x0140,
  name: "name",
  textLength: 24,
};
const readPlayer = {
  skipMode: true,
  safeState: { scenarioName: "00_op_01" },
  configState: { settings: { skipMode: "read" } },
  event: readEvent,
  readEventKeys: new Set(),
};
const readKey = scenarioReadEventKey(readPlayer, readEvent);
assert.equal(readKey, "00_op_01:12:320:4:24");
assert.equal(scenarioCanSkipCurrent(readPlayer), false);
readPlayer.readEventKeys.add(readKey);
assert.equal(scenarioCanSkipCurrent(readPlayer), true);

const instantPlayer = {
  configState: { settings: { instantTransitions: true } },
  safeState: {},
};
assert.equal(
  scenarioEffectiveAutomaticDurationMs(instantPlayer, { kind: 5 }, 300),
  0,
);
assert.equal(instantPlayer.safeState.instantTransitionAppliedCount, 1);
assert.equal(instantPlayer.safeState.instantTransitionOriginalDurationMs, 300);
assert.equal(
  scenarioEffectiveAutomaticDurationMs(
    { configState: { settings: { instantTransitions: true } }, safeState: {} },
    { kind: 7 },
    300,
  ),
  300,
);
assert.equal(
  scenarioEffectiveAutomaticDurationMs(
    { configState: { settings: { instantTransitions: false } }, safeState: {} },
    { kind: 5 },
    300,
  ),
  300,
);

console.log("scenario_choice_resume=ok");
