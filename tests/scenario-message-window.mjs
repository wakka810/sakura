import assert from "node:assert/strict";
import {
  beginScenarioMessageHide,
  beginScenarioMessageReveal,
  beginScenarioMessageShow,
  completeScenarioMessageReveal,
  createScenarioMessageVisualState,
  finishScenarioMessageTransition,
  isScenarioMessageRevealing,
  resolvedScenarioMessageReveal,
  resolvedScenarioMessageVisual,
  showScenarioMessageVisual,
} from "../web/scenario-message-window.js";

const first = { kind: 1, text: "first" };
const second = { kind: 1, text: "second" };
const state = createScenarioMessageVisualState();

assert.equal(resolvedScenarioMessageVisual(state, 0), null);
showScenarioMessageVisual(state, first);
assert.deepEqual(resolvedScenarioMessageVisual(state, 0), {
  event: first,
  opacity: 1,
});

assert.equal(beginScenarioMessageHide(state, 500, 1000), 500);
assert.equal(resolvedScenarioMessageVisual(state, 1250)?.opacity, 0.5);
assert.equal(resolvedScenarioMessageVisual(state, 1500)?.opacity, 0);
finishScenarioMessageTransition(state);
assert.equal(resolvedScenarioMessageVisual(state, 1500), null);

showScenarioMessageVisual(state, first);
assert.equal(beginScenarioMessageHide(state, 0, 2000), 0);
assert.equal(resolvedScenarioMessageVisual(state, 2000), null);

assert.equal(beginScenarioMessageShow(state, 1000, 3000), 1000);
assert.deepEqual(resolvedScenarioMessageVisual(state, 3500), {
  event: null,
  opacity: 0.5,
});
finishScenarioMessageTransition(state);
assert.deepEqual(resolvedScenarioMessageVisual(state, 4000), {
  event: null,
  opacity: 1,
});

showScenarioMessageVisual(state, second);
assert.deepEqual(resolvedScenarioMessageVisual(state, 4000), {
  event: second,
  opacity: 1,
});

// Inline tag / ruby parsing (BGI `<r reading>base</r>` + style tags).
const { parseScenarioText, stripScenarioTags } = await import(
  "../web/scenario-text.js"
);

assert.deepEqual(parseScenarioText("AB<r yomi>kanji</r>CD"), [
  { type: "text", text: "AB" },
  { type: "ruby", base: "kanji", reading: "yomi" },
  { type: "text", text: "CD" },
]);
assert.equal(stripScenarioTags("AB<r yomi>kanji</r>CD"), "ABkanjiCD");
// Style tags are unwrapped, content preserved.
assert.equal(stripScenarioTags("<i>em</i> and <l>x</l> y"), "em and x y");
// cr / t become line breaks.
assert.equal(stripScenarioTags("a<cr>b"), "a\nb");
// Malformed ruby keeps surrounding text without throwing.
assert.equal(stripScenarioTags("pre<r dangling"), "pre<r dangling");

// Typing reveal: chars appear over time at msPerChar; click completes; 0 = instant.
const reveal = createScenarioMessageVisualState();
beginScenarioMessageReveal(reveal, { charCount: 10, msPerChar: 30, now: 1000 });
assert.equal(resolvedScenarioMessageReveal(reveal, 1000), 0);
assert.equal(resolvedScenarioMessageReveal(reveal, 1090), 3);
assert.equal(isScenarioMessageRevealing(reveal, 1090), true);
assert.equal(resolvedScenarioMessageReveal(reveal, 1400), Infinity); // past end
assert.equal(isScenarioMessageRevealing(reveal, 1400), false);
beginScenarioMessageReveal(reveal, { charCount: 10, msPerChar: 30, now: 2000 });
completeScenarioMessageReveal(reveal);
assert.equal(resolvedScenarioMessageReveal(reveal, 2010), Infinity);
beginScenarioMessageReveal(reveal, { charCount: 10, msPerChar: 0, now: 3000 });
assert.equal(isScenarioMessageRevealing(reveal, 3000), false); // instant

console.log("scenario_message_window=ok");
