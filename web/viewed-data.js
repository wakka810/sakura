// Persistent runtime "viewed/seen" data — the browser-side mirror of the
// content-tracking sections the original engine keeps in `BGI.gdb`.
//
// The Ethornell engine records, in BGI.gdb, what the player has seen so the
// title Extra rooms can unlock and the opening can be skipped on replay:
//
//   * read text   — CFlag named bit-arrays per script (handled separately by
//                   the `sakura.read.events.v1` read-event store / skip-read).
//   * viewed CG   — the GDB "viewed-image" string table (gallery unlock).
//   * heard BGM   — tracks the music room unlocks.
//   * viewed scene— replay scenes the SceneSelect room unlocks.
//   * seen movie  — the opening movie (0x01bf), so it is forced on first view
//                   and skippable afterwards.
//
// The shipped BGI.gdb sidecar provides the pre-seeded viewed-image set; this
// module persists everything the player views at runtime (localStorage
// `sakura.viewed.v1`) and is unioned with the sidecar where content unlocks.

export const VIEWED_DATA_STORAGE_KEY = "sakura.viewed.v1";
export const VIEWED_CATEGORIES = Object.freeze(["cg", "bgm", "scene", "movie"]);
const VIEWED_NAME_PATTERN = /^[a-z0-9_]+$/;
const VIEWED_CATEGORY_LIMIT = 8192;

function viewedDataStorage() {
  try {
    return globalThis.window?.localStorage ?? globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function emptyViewedData() {
  return {
    cg: new Set(),
    bgm: new Set(),
    scene: new Set(),
    movie: new Set(),
  };
}

/** Normalizes a candidate asset/scene name to a persistable key, or null. */
export function normalizeViewedName(name) {
  if (typeof name !== "string") {
    return null;
  }
  const key = name.trim().toLowerCase();
  return VIEWED_NAME_PATTERN.test(key) ? key : null;
}

/** Loads the persisted viewed-data sets (empty sets when absent/corrupt). */
export function loadViewedData(storage = viewedDataStorage()) {
  const data = emptyViewedData();
  try {
    const encoded = storage?.getItem(VIEWED_DATA_STORAGE_KEY);
    if (!encoded) {
      return data;
    }
    const parsed = JSON.parse(encoded);
    if (parsed?.version === 1 && parsed.viewed && typeof parsed.viewed === "object") {
      for (const category of VIEWED_CATEGORIES) {
        const list = parsed.viewed[category];
        if (Array.isArray(list)) {
          for (const entry of list) {
            const key = normalizeViewedName(entry);
            if (key) {
              data[category].add(key);
            }
          }
        }
      }
    }
  } catch {
    return emptyViewedData();
  }
  return data;
}

function persistViewedData(data, storage = viewedDataStorage()) {
  if (!storage) {
    return false;
  }
  try {
    storage.setItem(
      VIEWED_DATA_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        viewed: {
          cg: [...data.cg],
          bgm: [...data.bgm],
          scene: [...data.scene],
          movie: [...data.movie],
        },
      }),
    );
    return true;
  } catch {
    return false;
  }
}

/** True when `name` is already recorded in `category`. */
export function viewedDataHas(data, category, name) {
  const set = data?.[category];
  if (!(set instanceof Set)) {
    return false;
  }
  const key = normalizeViewedName(name);
  return key !== null && set.has(key);
}

/**
 * Records `name` under `category`, persisting the change. Returns true when the
 * entry is newly added (false for duplicates / invalid names).
 */
export function recordViewed(data, category, name, storage = viewedDataStorage()) {
  const set = data?.[category];
  if (!(set instanceof Set) || !VIEWED_CATEGORIES.includes(category)) {
    return false;
  }
  const key = normalizeViewedName(name);
  if (key === null || set.has(key)) {
    return false;
  }
  if (set.size >= VIEWED_CATEGORY_LIMIT) {
    return false;
  }
  set.add(key);
  persistViewedData(data, storage);
  return true;
}

/** Small numeric snapshot for runtime-state diagnostics. */
export function viewedDataSnapshot(data) {
  return {
    cgCount: data?.cg?.size ?? 0,
    bgmCount: data?.bgm?.size ?? 0,
    sceneCount: data?.scene?.size ?? 0,
    movieCount: data?.movie?.size ?? 0,
  };
}
