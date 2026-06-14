export const DEFAULT_SCENARIO_ROUTE = "pi";

const OPENING = [
  "00_op_01", "00_op_02", "00_op_03", "00_op_04",
  "01_fruhlingsbeginn_01", "01_fruhlingsbeginn_02", "01_fruhlingsbeginn_03",
  "01_fruhlingsbeginn_04", "01_fruhlingsbeginn_05", "01_fruhlingsbeginn_06",
  "01_fruhlingsbeginn_end",
];

const ROUTES = {
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
};

for (const [route, chapters] of Object.entries(ROUTES)) {
  ROUTES[route] = Object.freeze([...OPENING, ...chapters]);
}

export function normalizeScenarioRoute(value) {
  const route = String(value ?? "").toLowerCase();
  return Object.hasOwn(ROUTES, route) ? route : DEFAULT_SCENARIO_ROUTE;
}

export function scenarioSequenceForRoute(route = DEFAULT_SCENARIO_ROUTE) {
  return ROUTES[normalizeScenarioRoute(route)];
}

export function scenarioPlaybackPlan(name, route = DEFAULT_SCENARIO_ROUTE) {
  const normalizedName = String(name ?? "").toLowerCase();
  const routeId = normalizeScenarioRoute(route);
  const sequence = scenarioSequenceForRoute(routeId);
  const scenarioIndex = sequence.indexOf(normalizedName);
  if (scenarioIndex < 0) {
    return { routeId, scenarioIndex: 0, sequence: Object.freeze([normalizedName]) };
  }
  return { routeId, scenarioIndex, sequence };
}
