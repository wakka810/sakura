import { parseRgbaPacket } from "./core-wasm.js";

const DEFAULT_RETRY_MS = 500;
const MAX_POLL_ATTEMPTS = 240;
const POLL_VISIBILITY_GRACE_MS = 1000;
const MODEL_IDS = new Set(["realesrgan", "hat", "waifu2x"]);
const QUALITY_MODES = new Set(["fast", "quality"]);
const SCALES = new Set([1, 2]);
const pendingPolls = new Map();
let capabilitiesPromise = null;

export const DEFAULT_UPSCALE_SETTINGS = Object.freeze({
  upscaleEnabled: false,
  upscaleScale: 2,
  upscaleModel: "waifu2x",
  upscaleQualityMode: "fast",
});
export const UPSCALE_SETTINGS_STORAGE_KEY = "sakura.upscale.v1";
export const UPSCALE_SETTING_OPTIONS = Object.freeze({
  scales: [1, 2],
  models: ["waifu2x", "hat", "realesrgan"],
  modes: ["fast", "quality"],
});

export function normalizeUpscaleSettings(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  const scale = Number.parseInt(source.upscaleScale ?? DEFAULT_UPSCALE_SETTINGS.upscaleScale, 10);
  const model = String(source.upscaleModel ?? DEFAULT_UPSCALE_SETTINGS.upscaleModel).toLowerCase();
  const qualityMode = String(
    source.upscaleQualityMode ?? DEFAULT_UPSCALE_SETTINGS.upscaleQualityMode,
  ).toLowerCase();
  return {
    upscaleEnabled: (source.upscaleEnabled ?? DEFAULT_UPSCALE_SETTINGS.upscaleEnabled) === true,
    upscaleScale: SCALES.has(scale) ? scale : DEFAULT_UPSCALE_SETTINGS.upscaleScale,
    upscaleModel: MODEL_IDS.has(model) ? model : DEFAULT_UPSCALE_SETTINGS.upscaleModel,
    upscaleQualityMode: QUALITY_MODES.has(qualityMode)
      ? qualityMode
      : DEFAULT_UPSCALE_SETTINGS.upscaleQualityMode,
  };
}

export function readStoredUpscaleSettings(storage = upscaleSettingsStorage()) {
  if (!storage) {
    return normalizeUpscaleSettings(DEFAULT_UPSCALE_SETTINGS);
  }
  try {
    const encoded = storage.getItem(UPSCALE_SETTINGS_STORAGE_KEY);
    if (!encoded) {
      return normalizeUpscaleSettings(DEFAULT_UPSCALE_SETTINGS);
    }
    const parsed = JSON.parse(encoded);
    return parsed?.version === 1
      ? normalizeUpscaleSettings(parsed.settings)
      : normalizeUpscaleSettings(DEFAULT_UPSCALE_SETTINGS);
  } catch {
    return normalizeUpscaleSettings(DEFAULT_UPSCALE_SETTINGS);
  }
}

export function storeUpscaleSettings(settings, storage = upscaleSettingsStorage()) {
  if (!storage) {
    return false;
  }
  try {
    storage.setItem(UPSCALE_SETTINGS_STORAGE_KEY, JSON.stringify({
      version: 1,
      settings: normalizeUpscaleSettings(settings),
    }));
    return true;
  } catch {
    return false;
  }
}

function upscaleSettingsStorage() {
  return globalThis.window?.localStorage ?? globalThis.localStorage ?? null;
}

export async function readUpscaleCapabilities() {
  capabilitiesPromise ??= (async () => {
    const response = await fetch("./api/upscale/capabilities", { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  })().catch(() => null);
  return await capabilitiesPromise;
}

export async function loadImageAsset(catalog, core, nameBytes, options = {}) {
  const record = catalog.findByNameBytes(nameBytes);
  if (record === null) {
    return null;
  }
  return await loadImageRecord(catalog, core, record, options);
}

export async function loadImageRecord(catalog, core, record, options = {}) {
  if (!record) {
    return null;
  }
  const role = options.role ?? "visible";
  const settings = normalizeUpscaleSettings(options.settings ?? {});
  const imageCache = options.cache instanceof Map ? options.cache : null;
  const upscaleLocation = settings.upscaleEnabled && settings.upscaleScale > 1
    ? catalog.serverRecordLocation?.(record)
    : null;

  if (upscaleLocation) {
    const upscaleKey = imageCacheKey("upscale", record, settings, role);
    const cached = imageCache?.get(upscaleKey);
    if (cached) {
      return cached;
    }
    const result = await fetchUpscaledImage(upscaleLocation, settings, role);
    if (result.status === "ready") {
      imageCache?.set(upscaleKey, result.image);
      trimImageCache(imageCache, options.cacheLimit);
      return result.image;
    }
    if (result.status === "pending") {
      scheduleUpscalePoll(upscaleKey, upscaleLocation, settings, role, imageCache, options);
    }
  }

  const originalKey = imageCacheKey("original", record, DEFAULT_UPSCALE_SETTINGS, role);
  const originalCached = imageCache?.get(originalKey);
  if (originalCached) {
    return originalCached;
  }
  const payload = await catalog.readPayload(record);
  const image = core.imageRgba(payload);
  if (image === null) {
    return null;
  }
  image.logicalWidth = image.width;
  image.logicalHeight = image.height;
  image.upscaled = false;
  imageCache?.set(originalKey, image);
  trimImageCache(imageCache, options.cacheLimit);
  return image;
}

async function fetchUpscaledImage(location, settings, role) {
  const url = new URL("./api/upscale/asset", globalThis.window?.location?.href ?? "http://127.0.0.1/");
  url.searchParams.set("archive", String(location.archive));
  url.searchParams.set("entry", String(location.entry));
  url.searchParams.set("scale", String(settings.upscaleScale));
  url.searchParams.set("model", settings.upscaleModel);
  url.searchParams.set("mode", settings.upscaleQualityMode);
  url.searchParams.set("role", role);
  let response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch {
    return { status: "unavailable" };
  }
  if (response.status === 202) {
    let retryAfterMs = DEFAULT_RETRY_MS;
    try {
      const body = await response.json();
      retryAfterMs = Math.max(100, Math.min(2000, Number(body.retryAfterMs) || DEFAULT_RETRY_MS));
    } catch {
      // Keep the default polling interval.
    }
    return { status: "pending", retryAfterMs };
  }
  if (!response.ok) {
    return { status: "unavailable" };
  }
  const packet = new Uint8Array(await response.arrayBuffer());
  const image = parseRgbaPacket(packet);
  const logicalWidth = Number.parseInt(response.headers.get("X-Sakura-Logical-Width") ?? "", 10);
  const logicalHeight = Number.parseInt(response.headers.get("X-Sakura-Logical-Height") ?? "", 10);
  image.logicalWidth = Number.isSafeInteger(logicalWidth) && logicalWidth > 0 ? logicalWidth : image.width;
  image.logicalHeight = Number.isSafeInteger(logicalHeight) && logicalHeight > 0 ? logicalHeight : image.height;
  image.upscaleScale = settings.upscaleScale;
  image.upscaled = true;
  return { status: "ready", image };
}

function scheduleUpscalePoll(cacheKey, location, settings, role, imageCache, options) {
  if (pendingPolls.has(cacheKey)) {
    return;
  }
  const state = {
    attempts: 0,
    stopped: false,
    imageCache,
    startedAt: nowMs(),
  };
  pendingPolls.set(cacheKey, state);
  const tick = async () => {
    if (shouldStopPolling(state, options) || state.attempts >= MAX_POLL_ATTEMPTS) {
      pendingPolls.delete(cacheKey);
      return;
    }
    state.attempts += 1;
    const result = await fetchUpscaledImage(location, settings, role);
    if (result.status === "ready") {
      imageCache?.set(cacheKey, result.image);
      trimImageCache(imageCache, options.cacheLimit);
      pendingPolls.delete(cacheKey);
      if (isPollStillWanted(state, options)) {
        options.onReady?.(cacheKey, result.image);
      }
      return;
    }
    if (result.status !== "pending") {
      pendingPolls.delete(cacheKey);
      return;
    }
    globalThis.setTimeout(tick, result.retryAfterMs ?? DEFAULT_RETRY_MS);
  };
  globalThis.setTimeout(tick, DEFAULT_RETRY_MS);
}

export function cancelUpscalePollsForCache(imageCache) {
  if (!imageCache) {
    return 0;
  }
  let count = 0;
  for (const [key, state] of pendingPolls) {
    if (state.imageCache === imageCache) {
      state.stopped = true;
      pendingPolls.delete(key);
      count += 1;
    }
  }
  return count;
}

function shouldStopPolling(state, options) {
  if (state.stopped) {
    return true;
  }
  return !isPollStillWanted(state, options);
}

function isPollStillWanted(state, options) {
  if (typeof options.isStillWanted !== "function") {
    return true;
  }
  if (nowMs() - state.startedAt < POLL_VISIBILITY_GRACE_MS) {
    return true;
  }
  try {
    return options.isStillWanted() !== false;
  } catch {
    return false;
  }
}

function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function imageCacheKey(prefix, record, settings, role) {
  return [
    prefix,
    record.archiveIndex,
    record.entryIndex ?? -1,
    record.offset,
    record.size,
    settings.upscaleScale,
    settings.upscaleModel,
    settings.upscaleQualityMode,
    role,
  ].join(":");
}

function trimImageCache(imageCache, limit) {
  if (!(imageCache instanceof Map) || !Number.isSafeInteger(limit) || limit < 1) {
    return;
  }
  while (imageCache.size > limit) {
    const first = imageCache.keys().next().value;
    imageCache.delete(first);
  }
}
