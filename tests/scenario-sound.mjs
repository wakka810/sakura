import assert from "node:assert/strict";
import {
  scenarioSfxPlaybackPlan,
  scenarioVoiceCharacterIndex,
  scenarioVoiceEnabled,
} from "../web/session-player.js";

assert.deepEqual(
  scenarioSfxPlaybackPlan({
    opcode: 0x01a0,
    intArgs: [64, 128, 7],
    stringArgs: ["se_thunder"],
  }),
  {
    opcode: 0x01a0,
    name: "se_thunder",
    channel: 7,
    pan: 64,
    volume: 1,
  },
);

assert.deepEqual(
  scenarioSfxPlaybackPlan({
    opcode: 0x01a1,
    intArgs: [64],
    stringArgs: ["se0744"],
  }),
  {
    opcode: 0x01a1,
    name: "se0744",
    channel: 0,
    pan: 64,
    volume: 0.5,
  },
);

assert.equal(
  scenarioSfxPlaybackPlan({
    opcode: 0x01a0,
    intArgs: [64, 128, 0],
    stringArgs: ["../bad"],
  }),
  null,
);

assert.equal(
  scenarioSfxPlaybackPlan({
    opcode: 0x01a3,
    intArgs: [1000, 0],
    stringArgs: [],
  }),
  null,
);

assert.equal(scenarioVoiceCharacterIndex("rnd_000001"), 0);
assert.equal(scenarioVoiceCharacterIndex("szd_000001"), 1);
assert.equal(scenarioVoiceCharacterIndex("mkd_000001"), 2);
assert.equal(scenarioVoiceCharacterIndex("aid_000001"), 3);
assert.equal(scenarioVoiceCharacterIndex("hrd_000001"), 4);
assert.equal(scenarioVoiceCharacterIndex("ymd_000001"), 5);
assert.equal(scenarioVoiceCharacterIndex("kid_000577"), 6);
assert.equal(scenarioVoiceCharacterIndex("ked_000001"), 7);

const voiceSettings = { characterVoices: [true, true, true, false, true, true, false, false] };
assert.equal(scenarioVoiceEnabled(voiceSettings, "aid_000001"), false);
assert.equal(scenarioVoiceEnabled(voiceSettings, "rnd_000001"), true);
assert.equal(scenarioVoiceEnabled(voiceSettings, "kid_000577"), false);
assert.equal(scenarioVoiceEnabled(voiceSettings, "ked_000001"), false);

console.log("scenario_sound=ok");
