export const CLOUD_STATE_VERSION = 1;
export const CLOUD_STATE_API_PATH = "./api/cloud-state";

const encoder = new TextEncoder();

export function captureLocalStorageSnapshot(storage = cloudStateStorage()) {
  if (!storage) {
    throw new Error("localStorage is unavailable");
  }
  const localStorage = Object.create(null);
  for (const key of storageKeys(storage)) {
    const value = storage.getItem(key);
    if (typeof value === "string") {
      localStorage[key] = value;
    }
  }
  return normalizeCloudStateSnapshot({
    version: CLOUD_STATE_VERSION,
    savedAt: timestampNow(),
    origin: globalThis.window?.location?.origin ?? "",
    localStorage,
  });
}

export function normalizeCloudStateSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("cloud state must be an object");
  }
  if (value.version !== CLOUD_STATE_VERSION) {
    throw new Error("unsupported cloud state version");
  }
  const source = value.localStorage;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new Error("cloud state localStorage must be an object");
  }
  const localStorage = Object.create(null);
  for (const key of Object.keys(source).sort()) {
    if (typeof key !== "string" || key.length > 4096) {
      throw new Error("cloud state contains an invalid key");
    }
    const item = source[key];
    if (typeof item !== "string") {
      throw new Error(`cloud state value for ${key} must be a string`);
    }
    localStorage[key] = item;
  }
  const savedAt = typeof value.savedAt === "string" && value.savedAt.length <= 64
    ? value.savedAt
    : "";
  const origin = typeof value.origin === "string" && value.origin.length <= 2048
    ? value.origin
    : "";
  const byteLength = encodedByteLength(localStorage);
  return {
    version: CLOUD_STATE_VERSION,
    savedAt,
    origin,
    localStorage,
    metadata: {
      keyCount: Object.keys(localStorage).length,
      byteLength,
    },
  };
}

export function restoreLocalStorageSnapshot(snapshot, storage = cloudStateStorage()) {
  if (!storage) {
    throw new Error("localStorage is unavailable");
  }
  const normalized = normalizeCloudStateSnapshot(snapshot);
  const backup = captureLocalStorageSnapshot(storage);
  try {
    storage.clear();
    for (const [key, value] of Object.entries(normalized.localStorage)) {
      storage.setItem(key, value);
    }
  } catch (error) {
    restoreSnapshotWithoutBackup(storage, backup);
    throw error;
  }
  return {
    ok: true,
    keyCount: normalized.metadata.keyCount,
    byteLength: normalized.metadata.byteLength,
  };
}

export async function saveCloudStateSnapshot(
  snapshot = captureLocalStorageSnapshot(),
  fetchRef = globalThis.fetch,
) {
  if (typeof fetchRef !== "function") {
    throw new Error("fetch is unavailable");
  }
  const normalized = normalizeCloudStateSnapshot(snapshot);
  const response = await fetchRef(CLOUD_STATE_API_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(normalized),
    cache: "no-store",
  });
  const body = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(body?.message ?? body?.error ?? `cloud save failed: ${response.status}`);
  }
  return {
    ok: true,
    metadata: body?.metadata ?? normalized.metadata,
  };
}

export async function loadCloudStateSnapshot(fetchRef = globalThis.fetch) {
  if (typeof fetchRef !== "function") {
    throw new Error("fetch is unavailable");
  }
  const response = await fetchRef(CLOUD_STATE_API_PATH, { cache: "no-store" });
  if (response.status === 404) {
    return null;
  }
  const body = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(body?.message ?? body?.error ?? `cloud load failed: ${response.status}`);
  }
  return normalizeCloudStateSnapshot(body);
}

export function cloudStateSummary(snapshot) {
  const normalized = normalizeCloudStateSnapshot(snapshot);
  return {
    savedAt: normalized.savedAt,
    origin: normalized.origin,
    keyCount: normalized.metadata.keyCount,
    byteLength: normalized.metadata.byteLength,
  };
}

function restoreSnapshotWithoutBackup(storage, snapshot) {
  storage.clear();
  for (const [key, value] of Object.entries(snapshot.localStorage)) {
    storage.setItem(key, value);
  }
}

function storageKeys(storage) {
  if (typeof storage.length === "number" && typeof storage.key === "function") {
    const keys = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (typeof key === "string") {
        keys.push(key);
      }
    }
    return keys.sort();
  }
  return Object.keys(storage).sort();
}

function encodedByteLength(localStorage) {
  return encoder.encode(JSON.stringify(localStorage)).byteLength;
}

function timestampNow() {
  return new Date().toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
}

function cloudStateStorage() {
  try {
    return globalThis.window?.localStorage ?? globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
