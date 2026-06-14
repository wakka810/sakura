import {
  applyScenarioBacklogControl,
  closeScenarioBacklog,
  createScenarioBacklogState,
  openScenarioBacklog,
  scenarioBacklogControlAt,
  scenarioBacklogThumbY,
  scrollScenarioBacklog,
  setScenarioBacklogPosition,
} from "../web/scenario-backlog.js";

const entries = Array.from({ length: 10 }, (_, index) => ({
  eventCount: index + 1,
  name: "",
  text: `entry-${index}`,
  ...(index === 7 ? { voiceName: "aid_test", voiceVolume: 1 } : {}),
}));
const state = createScenarioBacklogState();

openScenarioBacklog(state, entries.length);
assert(state.open, "open state");
assert(state.firstIndex === 6, "open at newest four entries");
assert(scenarioBacklogThumbY(state, entries.length) === 504, "newest thumb position");

assert(scrollScenarioBacklog(state, entries.length, -1), "line-up changes position");
assert(state.firstIndex === 5, "line-up position");
assert(applyScenarioBacklogControl(state, entries.length, { kind: "page-up" }), "page-up");
assert(state.firstIndex === 1, "page-up moves four entries");
assert(applyScenarioBacklogControl(state, entries.length, { kind: "line-down" }), "line-down");
assert(state.firstIndex === 2, "line-down position");

setScenarioBacklogPosition(state, entries.length, 1000);
assert(state.firstIndex === 6, "position clamps to newest");
setScenarioBacklogPosition(state, entries.length, -1000);
assert(state.firstIndex === 0, "position clamps to oldest");

assert(
  scenarioBacklogControlAt(1230, 20, state, entries)?.kind === "page-up",
  "top page button",
);
assert(
  scenarioBacklogControlAt(1230, 80, state, entries)?.kind === "line-up",
  "top line button",
);
assert(
  scenarioBacklogControlAt(1230, 640, state, entries)?.kind === "line-down",
  "bottom line button",
);
assert(
  scenarioBacklogControlAt(1230, 690, state, entries)?.kind === "page-down",
  "bottom page button",
);

setScenarioBacklogPosition(state, entries.length, 6);
const voice = scenarioBacklogControlAt(60, 32 + 160, state, entries);
assert(voice?.kind === "voice" && voice.entryIndex === 7, "voice replay hit");
assert(scenarioBacklogControlAt(60, 32, state, entries) === null, "non-voice entry");

closeScenarioBacklog(state);
assert(!state.open, "close state");
assert(state.hoverControl === null, "close clears hover");

console.log("scenario_backlog=ok");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
