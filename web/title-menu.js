export const TITLE_CLEAR_STORAGE_KEY = "sakura.title.clear.v1";
export const TITLE_CLEAR_RECORD_VERSION = 1;
export const TITLE_MENU_MODE_MAIN = "main";
export const TITLE_MENU_MODE_EXTRA = "extra";

const MAIN_LOCKED_CONTROLS = Object.freeze([
  titleControl("Start", "start", 232, 556),
  titleControl("Load", "load", 464, 556),
  titleControl("Config", "config", 696, 556),
  titleControl("Exit", "exit", 928, 556),
]);

const MAIN_EXTRA_CONTROLS = Object.freeze([
  titleControl("Start", "start", 116, 556),
  titleControl("Load", "load", 348, 556),
  titleControl("Config", "config", 580, 556),
  titleControl("Extra", "extra", 812, 556),
  titleControl("Exit", "exit", 1044, 556),
]);

const EXTRA_CONTROLS = Object.freeze([
  titleControl("Graphic", "graphic", 232, 556),
  titleControl("Scene", "scene", 464, 556),
  titleControl("Music", "music", 696, 556),
  titleControl("back", "back", 928, 556),
  titleControl("IV", "route", 348, 585, { routeId: "iv" }),
  titleControl("V", "route", 580, 585, { routeId: "v" }),
  titleControl("VI", "route", 812, 585, { routeId: "vi" }),
]);

export function normalizeTitleMenuMode(value) {
  return value === TITLE_MENU_MODE_EXTRA ? TITLE_MENU_MODE_EXTRA : TITLE_MENU_MODE_MAIN;
}

export function titleMenuControls(mode = TITLE_MENU_MODE_MAIN, extraUnlocked = false) {
  if (normalizeTitleMenuMode(mode) === TITLE_MENU_MODE_EXTRA) {
    return EXTRA_CONTROLS;
  }
  return extraUnlocked ? MAIN_EXTRA_CONTROLS : MAIN_LOCKED_CONTROLS;
}

export function readTitleClearState(storage = titleStorage()) {
  const empty = { version: TITLE_CLEAR_RECORD_VERSION, routes: {} };
  const encoded = storage?.getItem(TITLE_CLEAR_STORAGE_KEY);
  if (!encoded) {
    return empty;
  }
  try {
    const value = JSON.parse(encoded);
    if (!value || typeof value !== "object" || value.version !== TITLE_CLEAR_RECORD_VERSION) {
      return empty;
    }
    const routes = value.routes && typeof value.routes === "object" ? value.routes : {};
    const cleanRoutes = {};
    for (const [routeId, route] of Object.entries(routes)) {
      if (!isValidRouteId(routeId) || !route || typeof route !== "object") {
        continue;
      }
      cleanRoutes[routeId] = {
        endingScenario: typeof route.endingScenario === "string" ? route.endingScenario : "",
        clearedAt: typeof route.clearedAt === "string" ? route.clearedAt : "",
      };
    }
    return { version: TITLE_CLEAR_RECORD_VERSION, routes: cleanRoutes };
  } catch {
    return empty;
  }
}

export function titleExtraUnlocked(storage = titleStorage()) {
  return Object.keys(readTitleClearState(storage).routes).length > 0;
}

export function recordTitleRouteClear(routeId, endingScenario = "", storage = titleStorage()) {
  if (!storage || !isValidRouteId(routeId)) {
    return false;
  }
  const state = readTitleClearState(storage);
  state.routes[routeId] = {
    endingScenario: String(endingScenario ?? "").toLowerCase(),
    clearedAt: new Date().toISOString().replace("T", " ").replace(/\.\d{3}Z$/, ""),
  };
  storage.setItem(TITLE_CLEAR_STORAGE_KEY, JSON.stringify(state));
  return true;
}

function titleControl(label, action, x, y, extra = {}) {
  return Object.freeze({
    label,
    sprite: label,
    action,
    x,
    y,
    enabled: extra.enabled !== false,
    routeId: extra.routeId ?? "",
  });
}

function isValidRouteId(value) {
  return /^(an|pi|rn|ze|iv|v|vi)$/.test(String(value ?? ""));
}

function titleStorage() {
  return globalThis.window?.localStorage ?? globalThis.localStorage ?? null;
}
