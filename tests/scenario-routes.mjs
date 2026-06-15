import assert from "node:assert/strict";
import {
  DEFAULT_SCENARIO_ROUTE,
  SCENARIO_MAIN_ROUTE_IDS,
  SCENARIO_ROUTE_IDS,
  isValidScenarioName,
  normalizeScenarioName,
  normalizeScenarioRoute,
  scenarioChapterChoices,
  scenarioNameBytes,
  scenarioMainRouteChoices,
  scenarioNameInRoute,
  scenarioPlaybackPlan,
  scenarioRouteChoices,
  scenarioRouteSummary,
  scenarioSequenceForRoute,
} from "../web/scenario-routes.js";

assert.equal(DEFAULT_SCENARIO_ROUTE, "pi");
assert.deepEqual(SCENARIO_MAIN_ROUTE_IDS, ["an", "pi", "rn", "ze"]);
assert.deepEqual(SCENARIO_ROUTE_IDS, ["an", "pi", "rn", "ze", "iv", "v", "vi"]);
assert.equal(normalizeScenarioName("  ED01 "), "ed01");
assert.equal(normalizeScenarioName("  06_.Y_01 "), "06_.y_01");
assert.equal(normalizeScenarioName("../bad", "00_op_01"), "00_op_01");
assert.equal(isValidScenarioName("04_what_is_mind.h_01"), true);
assert.equal(isValidScenarioName("../bad"), false);
assert.equal(isValidScenarioName("bad..name"), false);
assert.equal(
  Buffer.from(scenarioNameBytes("04_What_is_mind.H_01")).toString("hex"),
  "30345f776861745f69735f6d696e6481485f3031",
);
assert.equal(Buffer.from(scenarioNameBytes("06_.Y_08")).toString("hex"), "30365f87595f3038");
assert.equal(normalizeScenarioRoute("RN"), "rn");
assert.equal(normalizeScenarioRoute("unknown"), "pi");

const expectedEndings = {
  an: "ed04",
  pi: "ed01",
  rn: "ed02",
  ze: "ed03",
  iv: "ed05",
  v: "ed06",
  vi: "ed07",
};
for (const [route, ending] of Object.entries(expectedEndings)) {
  const sequence = scenarioSequenceForRoute(route);
  assert.equal(sequence.at(-1), ending);
  assert.equal(new Set(sequence).size, sequence.length);
  if (SCENARIO_MAIN_ROUTE_IDS.includes(route)) {
    assert.equal(sequence[0], "00_op_01");
    assert.ok(sequence.includes("02_abend_14"));
  }
  assert.equal(scenarioRouteSummary(route).endingScenario, ending);
  assert.equal(scenarioNameInRoute(ending.toUpperCase(), route), true);
}

assert.deepEqual(
  scenarioRouteChoices().map((choice) => [choice.routeId, choice.endingScenario]),
  [
    ["an", "ed04"], ["pi", "ed01"], ["rn", "ed02"], ["ze", "ed03"],
    ["iv", "ed05"], ["v", "ed06"], ["vi", "ed07"],
  ],
);
assert.deepEqual(
  scenarioMainRouteChoices().map((choice) => [choice.routeId, choice.endingScenario]),
  [["an", "ed04"], ["pi", "ed01"], ["rn", "ed02"], ["ze", "ed03"]],
);

const piChapters = scenarioChapterChoices("pi");
assert.deepEqual(
  piChapters.map((chapter) => chapter.scenarioName),
  ["00_op_01", "01_fruhlingsbeginn_01", "02_abend_01", "03_picapica_01", "ed01"],
);
assert.ok(piChapters.every((chapter) => chapter.scenarioIndex >= 0));

const expectedChapters = {
  an: ["00_op_01", "01_fruhlingsbeginn_01", "02_abend_01", "03_andoe_01", "ed04"],
  pi: ["00_op_01", "01_fruhlingsbeginn_01", "02_abend_01", "03_picapica_01", "ed01"],
  rn: ["00_op_01", "01_fruhlingsbeginn_01", "02_abend_01", "03_olympia_01", "ed02"],
  ze: ["00_op_01", "01_fruhlingsbeginn_01", "02_abend_01", "03_zypressen_01", "ed03"],
  iv: ["04_what_is_mind.h_01", "ed05"],
  v: ["05_the_happy_prince_01", "ed06"],
  vi: ["06_.y_01", "ed07"],
};
for (const [route, chapters] of Object.entries(expectedChapters)) {
  const choices = scenarioChapterChoices(route);
  assert.deepEqual(choices.map((chapter) => chapter.scenarioName), chapters);
  assert.deepEqual(choices.map((chapter) => chapter.routeId), chapters.map(() => route));
  assert.equal(new Set(choices.map((chapter) => chapter.scenarioIndex)).size, choices.length);
}

const ze = scenarioSequenceForRoute("ze");
assert.deepEqual(
  ze.slice(ze.indexOf("03_zypressen_06"), ze.indexOf("03_zypressen_06a") + 1),
  ["03_zypressen_06", "03_marchen_01", "03_marchen_02", "03_zypressen_06a"],
);

const resumed = scenarioPlaybackPlan("02_Abend_pi04", "pi");
assert.equal(resumed.routeId, "pi");
assert.equal(resumed.sequence[resumed.scenarioIndex], "02_abend_pi04");

const isolated = scenarioPlaybackPlan("custom_test", "an");
assert.deepEqual(isolated.sequence, ["custom_test"]);

const dotted = scenarioPlaybackPlan("04_What_is_mind.H_02", "iv");
assert.equal(dotted.routeId, "iv");
assert.equal(dotted.sequence[dotted.scenarioIndex], "04_what_is_mind.h_02");

console.log("scenario_routes=ok");
