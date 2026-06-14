import assert from "node:assert/strict";
import {
  DEFAULT_SCENARIO_ROUTE,
  normalizeScenarioRoute,
  scenarioPlaybackPlan,
  scenarioSequenceForRoute,
} from "../web/scenario-routes.js";

assert.equal(DEFAULT_SCENARIO_ROUTE, "pi");
assert.equal(normalizeScenarioRoute("RN"), "rn");
assert.equal(normalizeScenarioRoute("unknown"), "pi");

const expectedEndings = { an: "ed04", pi: "ed01", rn: "ed02", ze: "ed03" };
for (const [route, ending] of Object.entries(expectedEndings)) {
  const sequence = scenarioSequenceForRoute(route);
  assert.equal(sequence[0], "00_op_01");
  assert.equal(sequence.at(-1), ending);
  assert.equal(new Set(sequence).size, sequence.length);
  assert.ok(sequence.includes("02_abend_14"));
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

console.log("scenario_routes=ok");
