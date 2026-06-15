import assert from "node:assert/strict";
import { scenarioSfxPlaybackPlan } from "../web/session-player.js";

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

console.log("scenario_sound=ok");
