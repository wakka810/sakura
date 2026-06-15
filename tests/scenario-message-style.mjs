import assert from "node:assert/strict";
import {
  applyScenarioMessageStylePatch,
  createScenarioMessageStyleState,
  resolveScenarioMessageTextLayout,
} from "../web/session-player.js";

// 0x014c sets font number/size/weight. The opening scenarios carry e.g.
// (0,40,0) for emphasis and (0,28,0) for the default body size.
{
  const style = createScenarioMessageStyleState();
  applyScenarioMessageStylePatch(style, 0x014c, [0, 40, 0]);
  assert.equal(style.fontSize, 40);
  assert.equal(style.fontWeight, 0);
  applyScenarioMessageStylePatch(style, 0x014c, [0, 28, 1]);
  assert.equal(style.fontSize, 28);
  assert.equal(style.fontWeight, 1);
}

// Out-of-range font sizes are rejected (fall back to the window default).
{
  const style = createScenarioMessageStyleState();
  applyScenarioMessageStylePatch(style, 0x014c, [0, 0, 0]);
  assert.equal(style.fontSize, null);
  applyScenarioMessageStylePatch(style, 0x014c, [0, 9999, 0]);
  assert.equal(style.fontSize, null);
}

// 0x014d sets font number/height/width/weight.
{
  const style = createScenarioMessageStyleState();
  applyScenarioMessageStylePatch(style, 0x014d, [0, 32, 24, 1]);
  assert.equal(style.fontHeight, 32);
  assert.equal(style.fontWidth, 24);
  assert.equal(style.fontWeight, 1);
}

// 0x0147 sets the text output position (x, y, flag).
{
  const style = createScenarioMessageStyleState();
  applyScenarioMessageStylePatch(style, 0x0147, [48, 25, 1]);
  assert.equal(style.textX, 48);
  assert.equal(style.textY, 25);
  assert.equal(style.textPositionFlag, 1);
}

// 0x0145 carries text speed plus the unit selector used by scrmsg._bp's
// environment-backed text-origin handler.
{
  const style = createScenarioMessageStyleState();
  applyScenarioMessageStylePatch(style, 0x0145, [5, 1]);
  assert.equal(style.textSpeed, 5);
  assert.equal(style.textUnit, 1);
  applyScenarioMessageStylePatch(style, 0x0145, [0, 0]);
  assert.equal(style.textSpeed, 0);
  assert.equal(style.textUnit, 0);
}

// 0x0141/0x0142 are scrmsg message-process/window plumbing. The VM now emits
// them through the same ABI event so they are observable, but they do not mutate
// text-style state.
{
  const style = createScenarioMessageStyleState();
  applyScenarioMessageStylePatch(style, 0x014c, [0, 40, 1]);
  applyScenarioMessageStylePatch(style, 0x0141, []);
  applyScenarioMessageStylePatch(style, 0x0142, []);
  assert.equal(style.fontSize, 40);
  assert.equal(style.fontWeight, 1);
  assert.equal(style.textX, null);
  assert.equal(style.wordColor, null);
}

// 0x0144 and 0x0146 are rare scrmsg plumbing handlers registered at
// scrmsg._bp handlers 0x1543 and 0x187c. Keep their state observable without
// inventing a visible effect.
{
  const style = createScenarioMessageStyleState();
  applyScenarioMessageStylePatch(style, 0x0144, [1]);
  assert.equal(style.messageProcessMode, 1);
  applyScenarioMessageStylePatch(style, 0x0146, [1, 0]);
  assert.equal(style.messageWindowMode, 1);
  assert.equal(style.messageWindowSubMode, 0);
}

// 0x014e / 0x014f set monologue / per-word colors as rgb() strings.
{
  const style = createScenarioMessageStyleState();
  applyScenarioMessageStylePatch(style, 0x014e, [255, 128, 0]);
  assert.equal(style.monologueColor, "rgb(255, 128, 0)");
  applyScenarioMessageStylePatch(style, 0x014f, [10, 20, 30]);
  assert.equal(style.wordColor, "rgb(10, 20, 30)");
  // Out-of-range channels reject the whole color.
  applyScenarioMessageStylePatch(style, 0x014e, [256, 0, 0]);
  assert.equal(style.monologueColor, null);
}

// Explicit 0x0147 coordinates draw on the scenario text layer, not inside the
// bottom message-window panel; the default path remains the shipped panel origin.
{
  const canvas = { width: 1280, height: 720 };
  const skin = { panel: { width: 1132, height: 176 } };
  const panelLayout = resolveScenarioMessageTextLayout(canvas, skin, null, 38);
  assert.deepEqual(panelLayout, {
    x: 149,
    y: 578,
    maxWidth: 997,
    maxLines: 3,
    drawPanel: true,
  });

  const style = createScenarioMessageStyleState();
  applyScenarioMessageStylePatch(style, 0x0147, [30, 20, 1]);
  const positioned = resolveScenarioMessageTextLayout(canvas, skin, style, 52);
  assert.equal(positioned.x, 30);
  assert.equal(positioned.y, 20);
  assert.equal(positioned.maxWidth, 1190);
  assert.equal(positioned.maxLines, 13);
  assert.equal(positioned.drawPanel, false);
}

console.log("scenario_message_style=ok");
