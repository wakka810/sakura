export const DEFAULT_SCENARIO_ROUTE = "pi";
export const SCENARIO_MAIN_ROUTE_IDS = Object.freeze(["an", "pi", "rn", "ze"]);
export const SCENARIO_EXTRA_ROUTE_IDS = Object.freeze(["iv", "v", "vi"]);
export const SCENARIO_ROUTE_IDS = Object.freeze([
  ...SCENARIO_MAIN_ROUTE_IDS,
  ...SCENARIO_EXTRA_ROUTE_IDS,
]);

const SCENARIO_NAME_BYTE_HEX = Object.freeze({
  "04_what_is_mind.h_01": "30345f776861745f69735f6d696e6481485f3031",
  "04_what_is_mind.h_02": "30345f776861745f69735f6d696e6481485f3032",
  "06_.y_01": "30365f87595f3031",
  "06_.y_02": "30365f87595f3032",
  "06_.y_03": "30365f87595f3033",
  "06_.y_04": "30365f87595f3034",
  "06_.y_05": "30365f87595f3035",
  "06_.y_06": "30365f87595f3036",
  "06_.y_07": "30365f87595f3037",
  "06_.y_08": "30365f87595f3038",
});

const ASCII_ENCODER = new TextEncoder();

const ROUTE_LABELS = Object.freeze({
  an: "Abend / ANDoE",
  pi: "PicaPica",
  rn: "Olympia",
  ze: "Zypressen",
  iv: "IV / What is mind.H",
  v: "V / The Happy Prince",
  vi: "VI / .Y",
});

const OPENING = [
  "00_op_01", "00_op_02", "00_op_03", "00_op_04",
  "01_fruhlingsbeginn_01", "01_fruhlingsbeginn_02", "01_fruhlingsbeginn_03",
  "01_fruhlingsbeginn_04", "01_fruhlingsbeginn_05", "01_fruhlingsbeginn_06",
  "01_fruhlingsbeginn_end",
];

const ROUTE_SEGMENTS = {
  an: [
    "02_abend_01", "02_abend_02", "02_abend_rn01", "02_abend_03",
    "02_abend_04", "02_abend_an01", "02_abend_an02", "02_abend_ic_0727_cm",
    "02_abend_05", "02_abend_05a", "02_abend_06", "02_abend_ic_0728_cm",
    "02_abend_07", "02_abend_rn03", "02_abend_ic_0729_rn", "02_abend_rn04",
    "02_abend_08", "02_abend_rn05", "02_abend_09", "02_abend_rn06",
    "02_abend_10", "02_abend_ic_0730_cm", "02_abend_11", "02_abend_12",
    "02_abend_13", "02_abend_14",
    "03_andoe_01", "03_andoe_02", "03_andoe_03", "03_andoe_04", "03_andoe_05",
    "ed04",
  ],
  pi: [
    "02_abend_01", "02_abend_02", "02_abend_03", "02_abend_pi01",
    "02_abend_04", "02_abend_pi02", "02_abend_ic_0727_pi", "02_abend_pi03",
    "02_abend_05", "02_abend_05a", "02_abend_06", "02_abend_ic_0728_cm",
    "02_abend_07", "02_abend_pi04", "02_abend_ic_0729_cm", "02_abend_08",
    "02_abend_08a", "02_abend_09", "02_abend_09a", "02_abend_10",
    "02_abend_ic_0730_pi", "02_abend_pi05", "02_abend_11", "02_abend_12",
    "02_abend_pi06", "02_abend_13", "02_abend_14",
    "03_picapica_01", "03_picapica_02", "03_picapica_03", "03_picapica_04",
    "03_picapica_05", "03_picapica_06", "03_picapica_07", "03_picapica_08",
    "03_picapica_09", "03_picapica_10", "03_picapica_11", "03_picapica_12",
    "03_picapica_13", "ed01",
  ],
  rn: [
    "02_abend_01", "02_abend_02", "02_abend_rn01", "02_abend_03",
    "02_abend_04", "02_abend_rn02", "02_abend_rn02b", "02_abend_ic_0727_cm",
    "02_abend_05", "02_abend_05a", "02_abend_06", "02_abend_ic_0728_cm",
    "02_abend_07", "02_abend_rn03", "02_abend_ic_0729_rn", "02_abend_rn04",
    "02_abend_08", "02_abend_rn05", "02_abend_09", "02_abend_rn06",
    "02_abend_10", "02_abend_ic_0730_cm", "02_abend_11", "02_abend_12",
    "02_abend_13", "02_abend_14",
    "03_olympia_01", "03_olympia_02", "03_olympia_03", "03_olympia_04",
    "03_olympia_05", "03_olympia_06", "03_olympia_07", "03_olympia_08",
    "03_olympia_09", "ed02",
  ],
  ze: [
    "02_abend_01", "02_abend_ze01", "02_abend_02", "02_abend_03",
    "02_abend_04", "02_abend_ze02", "02_abend_ic_0727_ze", "02_abend_ze03",
    "02_abend_05", "02_abend_ze04", "02_abend_06", "02_abend_ze05",
    "02_abend_ic_0728_ze", "02_abend_ze06", "02_abend_07", "02_abend_ze07",
    "02_abend_ic_0729_ze", "02_abend_ze08", "02_abend_08", "02_abend_08a",
    "02_abend_09", "02_abend_09a", "02_abend_10", "02_abend_ic_0730_cm",
    "02_abend_11", "02_abend_12", "02_abend_13", "02_abend_14",
    "03_zypressen_01", "03_zypressen_02", "03_zypressen_03", "03_zypressen_04",
    "03_zypressen_05", "03_zypressen_06", "03_marchen_01", "03_marchen_02",
    "03_zypressen_06a", "03_zypressen_07", "03_zypressen_08",
    "03_zypressen_09", "03_zypressen_10", "03_zypressen_11",
    "03_zypressen_12", "03_zypressen_13", "03_zypressen_14", "ed03",
  ],
  iv: [
    "04_what_is_mind.h_01", "04_what_is_mind.h_02", "ed05",
  ],
  v: [
    "05_the_happy_prince_01", "05_the_happy_prince_02", "05_the_happy_prince_03",
    "05_the_happy_prince_04", "05_the_happy_prince_05", "05_the_happy_prince_06",
    "05_the_happy_prince_07", "05_the_happy_prince_08b",
    "05_the_happy_prince_09b", "05_the_happy_prince_08", "ed06",
  ],
  vi: [
    "06_.y_01", "06_.y_02", "06_.y_03", "06_.y_04",
    "06_.y_05", "06_.y_06", "06_.y_07", "06_.y_08", "ed07",
  ],
};

const ROUTES = {};
for (const route of SCENARIO_MAIN_ROUTE_IDS) {
  ROUTES[route] = Object.freeze([...OPENING, ...ROUTE_SEGMENTS[route]]);
}
for (const route of SCENARIO_EXTRA_ROUTE_IDS) {
  ROUTES[route] = Object.freeze([...ROUTE_SEGMENTS[route]]);
}
Object.freeze(ROUTES);

export function normalizeScenarioRoute(value) {
  const route = String(value ?? "").toLowerCase();
  return Object.hasOwn(ROUTES, route) ? route : DEFAULT_SCENARIO_ROUTE;
}

export function scenarioSequenceForRoute(route = DEFAULT_SCENARIO_ROUTE) {
  return ROUTES[normalizeScenarioRoute(route)];
}

export function scenarioRouteChoices() {
  return SCENARIO_ROUTE_IDS.map((routeId) => scenarioRouteSummary(routeId));
}

export function scenarioMainRouteChoices() {
  return SCENARIO_MAIN_ROUTE_IDS.map((routeId) => scenarioRouteSummary(routeId));
}

export function scenarioRouteSummary(route = DEFAULT_SCENARIO_ROUTE) {
  const routeId = normalizeScenarioRoute(route);
  const sequence = scenarioSequenceForRoute(routeId);
  return {
    routeId,
    label: ROUTE_LABELS[routeId],
    firstScenario: sequence[0],
    endingScenario: sequence.at(-1),
    scenarioCount: sequence.length,
  };
}

export function scenarioChapterChoices(route = DEFAULT_SCENARIO_ROUTE) {
  const routeId = normalizeScenarioRoute(route);
  const sequence = scenarioSequenceForRoute(routeId);
  const picks = [
    sequence[0],
    sequence.find((name) => name.startsWith("01_")),
    sequence.find((name) => name.startsWith("02_")),
    sequence.find((name) => name.startsWith("03_")),
    sequence.find((name) => name.startsWith("04_")),
    sequence.find((name) => name.startsWith("05_")),
    sequence.find((name) => name.startsWith("06_")),
    sequence.at(-1),
  ].filter(Boolean);
  const seen = new Set();
  return picks
    .filter((name) => {
      if (seen.has(name)) {
        return false;
      }
      seen.add(name);
      return true;
    })
    .map((scenarioName) => ({
      routeId,
      scenarioName,
      scenarioIndex: sequence.indexOf(scenarioName),
    }));
}

export function scenarioNameInRoute(name, route = DEFAULT_SCENARIO_ROUTE) {
  const normalizedName = normalizeScenarioName(name);
  return normalizedName !== ""
    && scenarioSequenceForRoute(route).includes(normalizedName);
}

export function normalizeScenarioName(value, fallback = "") {
  const normalized = String(value ?? "").trim().toLowerCase();
  return isValidScenarioName(normalized) ? normalized : fallback;
}

export function isValidScenarioName(value) {
  if (typeof value !== "string") {
    return false;
  }
  const name = value.trim();
  return /^[A-Za-z0-9_.]+$/.test(name)
    && !name.includes("..")
    && !name.startsWith(".")
    && !name.endsWith(".");
}

export function scenarioNameBytes(value) {
  const normalized = normalizeScenarioName(value);
  if (normalized === "") {
    return new Uint8Array();
  }
  const hex = SCENARIO_NAME_BYTE_HEX[normalized];
  return typeof hex === "string" ? hexToBytes(hex) : ASCII_ENCODER.encode(normalized);
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export function scenarioPlaybackPlan(name, route = DEFAULT_SCENARIO_ROUTE) {
  const normalizedName = normalizeScenarioName(name);
  const routeId = normalizeScenarioRoute(route);
  const sequence = scenarioSequenceForRoute(routeId);
  const scenarioIndex = sequence.indexOf(normalizedName);
  if (scenarioIndex < 0) {
    return { routeId, scenarioIndex: 0, sequence: Object.freeze([normalizedName]) };
  }
  return { routeId, scenarioIndex, sequence };
}
