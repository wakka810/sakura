import { paintAlphaMappedImage } from "./scenario-transition-mask.js";
import {
  createScenarioDirectionalMotion,
  restoreScenarioMotion,
  scenarioMotionOffset,
  snapshotScenarioMotion,
} from "./scenario-sprite-motion.js";

const sceneObjectCanvasCache = new WeakMap();
const BACKGROUND_PRIORITY_CUTOFF = 128;

export function clearScenarioSceneObjects(state) {
  state.sceneObjects.clear();
  state.sceneObjectTransitions.clear();
  state.sceneObjectBackgroundTransition = null;
  state.sceneObjectMotions?.clear();
}

export function setScenarioSceneObject(
  state,
  id,
  image,
  {
    assetName = "",
    x = 0,
    y = 0,
    z = 0,
    anchorX = 0,
    anchorY = 0,
    alpha = 1,
    priority = 0,
    blendMode = 0,
    isMovie = false,
    maskAssetName = "",
    maskImage = null,
    animation = null,
  } = {},
) {
  state.sceneObjects.set(id, {
    id,
    image,
    assetName: validAssetName(assetName),
    x: finiteCoordinate(x),
    y: finiteCoordinate(y),
    z: finiteCoordinate(z),
    anchorX: finiteCoordinate(anchorX),
    anchorY: finiteCoordinate(anchorY),
    alpha: clampUnit(alpha),
    priority: boundedInteger(priority, 0, 255, 0),
    blendMode: boundedInteger(blendMode, 0, 8, 0),
    isMovie: isMovie === true,
    maskAssetName: maskImage ? validAssetName(maskAssetName) : "",
    maskImage,
    maskCacheKey: {},
    animation: normalizeAnimation(image, animation),
  });
  state.sceneObjectTransitions.delete(id);
  state.sceneObjectBackgroundTransition?.ids.delete(id);
  state.sceneObjectMotions?.delete(id);
}

export function moveScenarioSceneObject(
  state,
  id,
  { x, y, z, alpha },
  durationMs,
  { blocking = false, now = performance.now() } = {},
) {
  settleReplacedTransition(state, id, now);
  const object = state.sceneObjects.get(id);
  if (!object) {
    return false;
  }
  const to = {
    x: finiteCoordinate(x),
    y: finiteCoordinate(y),
    z: finiteCoordinate(z),
    alpha: alpha === undefined ? object.alpha : clampUnit(alpha),
  };
  if (durationMs <= 0) {
    Object.assign(object, to);
    return true;
  }
  state.sceneObjectTransitions.set(id, {
    type: "move",
    id,
    from: { x: object.x, y: object.y, z: object.z, alpha: object.alpha },
    to,
    startedAt: now,
    durationMs,
    blocking,
  });
  return true;
}

export function fadeScenarioSceneObject(
  state,
  id,
  durationMs,
  { blocking = false, now = performance.now() } = {},
) {
  settleReplacedTransition(state, id, now);
  const object = state.sceneObjects.get(id);
  if (!object) {
    return false;
  }
  if (durationMs <= 0) {
    state.sceneObjects.delete(id);
    return true;
  }
  state.sceneObjectTransitions.set(id, {
    type: "fade",
    id,
    from: { x: object.x, y: object.y, z: object.z, alpha: object.alpha },
    to: { x: object.x, y: object.y, z: object.z, alpha: 0 },
    startedAt: now,
    durationMs,
    blocking,
  });
  return true;
}

export function restoreScenarioSceneObjectTransition(
  state,
  id,
  snapshot,
  now = performance.now(),
) {
  const object = state.sceneObjects.get(id);
  if (!object || !snapshot || snapshot.remainingMs <= 0) {
    return false;
  }
  const type = snapshot.type === "fade" ? "fade" : "move";
  const to = type === "fade"
    ? { x: object.x, y: object.y, z: object.z, alpha: 0 }
    : {
        x: finiteCoordinate(snapshot.to.x),
        y: finiteCoordinate(snapshot.to.y),
        z: finiteCoordinate(snapshot.to.z),
        alpha: clampUnit(snapshot.to.alpha),
      };
  state.sceneObjectTransitions.set(id, {
    type,
    id,
    from: { x: object.x, y: object.y, z: object.z, alpha: object.alpha },
    to,
    startedAt: now,
    durationMs: snapshot.remainingMs,
    blocking: false,
  });
  return true;
}

export function startScenarioSceneObjectDirectionalMotion(
  state,
  id,
  intArgs,
  now = performance.now(),
) {
  const object = state.sceneObjects.get(id);
  if (!object) {
    return false;
  }
  ensureSceneObjectMotions(state).set(
    id,
    createScenarioDirectionalMotion(intArgs, now),
  );
  return true;
}

export function restoreScenarioSceneObjectMotion(
  state,
  id,
  snapshot,
  now = performance.now(),
) {
  const object = state.sceneObjects.get(id);
  const motion = restoreScenarioMotion(snapshot, now);
  if (!object || !motion) {
    return false;
  }
  ensureSceneObjectMotions(state).set(id, motion);
  return true;
}

export function stopScenarioSceneObjectMotion(state, id) {
  return ensureSceneObjectMotions(state).delete(id);
}

export function removeScenarioSceneObject(state, id) {
  const key = boundedInteger(id, 0, 255, -1);
  if (key < 0) {
    return false;
  }
  const hadObject = state.sceneObjects.delete(key);
  const hadTransition = state.sceneObjectTransitions.delete(key);
  const hadMotion = ensureSceneObjectMotions(state).delete(key);
  state.sceneObjectBackgroundTransition?.ids.delete(key);
  return hadObject || hadTransition || hadMotion;
}

export function stopScenarioSceneObjectTransitions(state, now = performance.now()) {
  let stopped = 0;
  for (const id of [...state.sceneObjectTransitions.keys()]) {
    settleReplacedTransition(state, id, now);
    stopped += 1;
  }
  return stopped;
}

export function beginScenarioBackgroundObjectRemoval(
  state,
  durationMs,
  { fade = true } = {},
) {
  const ids = new Set(
    [...state.sceneObjects.values()]
      .filter((object) => object.priority < BACKGROUND_PRIORITY_CUTOFF)
      .map((object) => object.id),
  );
  if (ids.size === 0) {
    state.sceneObjectBackgroundTransition = null;
    return;
  }
  if (durationMs <= 0) {
    for (const id of ids) {
      state.sceneObjects.delete(id);
      state.sceneObjectTransitions.delete(id);
    }
    state.sceneObjectBackgroundTransition = null;
    return;
  }
  state.sceneObjectBackgroundTransition = { fade, ids, progress: 0 };
}

export function setScenarioSceneObjectProgress(state, progress) {
  const value = clampUnit(progress);
  if (state.sceneObjectBackgroundTransition) {
    state.sceneObjectBackgroundTransition.progress = value;
  }
}

export function finishScenarioSceneObjectTransitions(state, now = performance.now()) {
  for (const transition of [...state.sceneObjectTransitions.values()]) {
    if (transition.blocking || transitionProgress(transition, now) >= 1) {
      commitTransition(state, transition);
    }
  }
  const background = state.sceneObjectBackgroundTransition;
  if (background) {
    for (const id of background.ids) {
      state.sceneObjects.delete(id);
      state.sceneObjectTransitions.delete(id);
    }
    state.sceneObjectBackgroundTransition = null;
  }
}

export function snapshotScenarioSceneObjects(state, now = performance.now()) {
  settleCompletedTransitions(state, now);
  return [...state.sceneObjects.values()]
    .sort((left, right) => left.id - right.id)
    .filter((object) => object.assetName.length > 0)
    .map((object) => snapshotSceneObject(state, object, now));
}

export function hasActiveScenarioSceneObjectVisuals(state, now = performance.now()) {
  settleCompletedTransitions(state, now);
  return state.sceneObjectTransitions.size > 0
    || ensureSceneObjectMotions(state).size > 0
    || [...state.sceneObjects.values()].some((object) => (
      object.animation?.sequenceStyle === 1
    ));
}

export function scenarioSceneObjectFrameIndex(object, now = performance.now()) {
  const animation = object?.animation;
  if (!animation) {
    return 0;
  }
  const elapsedMs = Math.max(0, now - animation.startedAt);
  const frame = Math.floor(elapsedMs / animation.frameIntervalMs);
  if (animation.sequenceStyle === 1) {
    return frame % animation.frameCount;
  }
  return Math.min(frame, animation.frameCount - 1);
}

export function paintScenarioSceneObjects(context, canvas, state, now = performance.now()) {
  settleCompletedTransitions(state, now);
  const objects = [...state.sceneObjects.values()].map((object) => (
    presentedSceneObject(state, object, now)
  ));
  objects.sort((left, right) => (
    left.priority - right.priority
    || right.z - left.z
    || left.id - right.id
  ));
  for (const object of objects) {
    if (object.alpha <= 0) {
      continue;
    }
    const frameIndex = scenarioSceneObjectFrameIndex(object, now);
    const frameCount = object.animation?.frameCount ?? 1;
    const frameWidth = object.image.width / frameCount;
    const logicalFrameWidth = imageLogicalWidth(object.image) / frameCount;
    const logicalHeight = imageLogicalHeight(object.image);
    context.save();
    context.globalAlpha = object.alpha;
    context.globalCompositeOperation = sceneObjectCompositeOperation(object.blendMode);
    drawSceneObjectFrame(context, canvas, object, frameIndex, frameWidth, logicalFrameWidth, logicalHeight);
    context.restore();
  }
}

function drawSceneObjectFrame(
  context,
  canvas,
  object,
  frameIndex,
  frameWidth,
  logicalFrameWidth,
  logicalHeight,
) {
  const source = rgbaCanvas(object.image);
  const x = sceneObjectDestinationX(canvas, object);
  const y = Math.round(canvas.height / 2 + object.y - object.anchorY);
  if (object.maskImage) {
    paintAlphaMappedImage(
      context,
      frameSourceCanvas(source, object.image.height, frameIndex, frameWidth),
      object.maskImage,
      {
        alpha: object.alpha,
        cacheKey: object.maskCacheKey ?? object,
        height: logicalHeight,
        width: logicalFrameWidth,
        x,
        y,
      },
    );
    return;
  }
  context.drawImage(
    source,
    frameIndex * frameWidth,
    0,
    frameWidth,
    object.image.height,
    x,
    y,
    logicalFrameWidth,
    logicalHeight,
  );
}

function frameSourceCanvas(source, height, frameIndex, frameWidth) {
  if (frameIndex === 0 && frameWidth === source.width) {
    return source;
  }
  const scratch = document.createElement("canvas");
  scratch.width = frameWidth;
  scratch.height = height;
  scratch.getContext("2d").drawImage(
    source,
    frameIndex * frameWidth,
    0,
    frameWidth,
    height,
    0,
    0,
    frameWidth,
    height,
  );
  return scratch;
}

function sceneObjectDestinationX(canvas, object) {
  return Math.round(canvas.width / 2 + object.x - object.anchorX);
}

function presentedSceneObject(state, object, now, { includeMotion = true } = {}) {
  let presented = object;
  const transition = state.sceneObjectTransitions.get(object.id);
  if (transition) {
    const progress = transitionProgress(transition, now);
    presented = {
      ...object,
      x: interpolate(transition.from.x, transition.to.x, progress),
      y: interpolate(transition.from.y, transition.to.y, progress),
      z: interpolate(transition.from.z, transition.to.z, progress),
      alpha: interpolate(transition.from.alpha, transition.to.alpha, progress),
    };
  }
  const background = state.sceneObjectBackgroundTransition;
  if (background?.fade && background.ids.has(object.id)) {
    presented = {
      ...presented,
      alpha: presented.alpha * (1 - clampUnit(background.progress)),
    };
  }
  const motion = includeMotion ? ensureSceneObjectMotions(state).get(object.id) : null;
  if (motion) {
    const offset = scenarioMotionOffset(motion, now);
    presented = {
      ...presented,
      x: presented.x + offset.x,
      y: presented.y + offset.y,
    };
  }
  return presented;
}

function snapshotSceneObject(state, object, now) {
  const presented = presentedSceneObject(state, object, now, { includeMotion: false });
  const transition = state.sceneObjectTransitions.get(object.id);
  return {
    id: object.id,
    assetName: object.assetName,
    x: presented.x,
    y: presented.y,
    z: presented.z,
    anchorX: object.anchorX,
    anchorY: object.anchorY,
    alpha: presented.alpha,
    priority: object.priority,
    blendMode: object.blendMode,
    isMovie: object.isMovie,
    maskAssetName: object.maskAssetName,
    animation: snapshotAnimation(object.animation, now),
    motion: snapshotScenarioMotion(ensureSceneObjectMotions(state).get(object.id), now),
    transition: transition
      ? {
          type: transition.type,
          remainingMs: Math.max(1, transition.durationMs - (now - transition.startedAt)),
          to: { ...transition.to },
        }
      : null,
  };
}

function settleCompletedTransitions(state, now) {
  for (const transition of [...state.sceneObjectTransitions.values()]) {
    if (transitionProgress(transition, now) >= 1) {
      commitTransition(state, transition);
    }
  }
}

function settleReplacedTransition(state, id, now) {
  const transition = state.sceneObjectTransitions.get(id);
  const object = state.sceneObjects.get(id);
  if (!transition || !object) {
    state.sceneObjectTransitions.delete(id);
    return;
  }
  const presented = presentedSceneObject(state, object, now);
  Object.assign(object, {
    x: presented.x,
    y: presented.y,
    z: presented.z,
    alpha: presented.alpha,
  });
  state.sceneObjectTransitions.delete(id);
}

function commitTransition(state, transition) {
  const object = state.sceneObjects.get(transition.id);
  if (object) {
    if (transition.type === "fade") {
      state.sceneObjects.delete(transition.id);
      state.sceneObjectMotions?.delete(transition.id);
    } else {
      Object.assign(object, transition.to);
    }
  }
  state.sceneObjectTransitions.delete(transition.id);
}

function transitionProgress(transition, now) {
  return clampUnit((now - transition.startedAt) / transition.durationMs);
}

function normalizeAnimation(image, animation) {
  if (!animation) {
    return null;
  }
  const frameCount = boundedInteger(animation.frameCount, 2, 32, 0);
  const frameIntervalMs = boundedInteger(animation.frameIntervalMs, 1, 600_000, 0);
  const sequenceStyle = boundedInteger(animation.sequenceStyle, 0, 3, -1);
  if (
    frameCount === 0
    || frameIntervalMs === 0
    || sequenceStyle < 0
    || image.width % frameCount !== 0
  ) {
    return null;
  }
  const elapsedMs = Number.isFinite(animation.elapsedMs)
    ? Math.max(0, Math.min(animation.elapsedMs, 10_000_000))
    : 0;
  return {
    frameCount,
    frameIntervalMs,
    sequenceStyle,
    startedAt: performance.now() - elapsedMs,
  };
}

function snapshotAnimation(animation, now) {
  if (!animation) {
    return null;
  }
  const cycleMs = animation.frameCount * animation.frameIntervalMs;
  const elapsedMs = Math.max(0, now - animation.startedAt);
  return {
    frameCount: animation.frameCount,
    frameIntervalMs: animation.frameIntervalMs,
    sequenceStyle: animation.sequenceStyle,
    elapsedMs: animation.sequenceStyle === 1 && cycleMs > 0
      ? elapsedMs % cycleMs
      : Math.min(elapsedMs, cycleMs),
  };
}

function rgbaCanvas(image) {
  if (image?.canvas) {
    return image.canvas;
  }
  const cached = sceneObjectCanvasCache.get(image);
  if (cached) {
    return cached;
  }
  const scratch = document.createElement("canvas");
  scratch.width = image.width;
  scratch.height = image.height;
  const context = scratch.getContext("2d");
  context.putImageData(
    new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height),
    0,
    0,
  );
  sceneObjectCanvasCache.set(image, scratch);
  return scratch;
}

function imageLogicalWidth(image) {
  return Number.isFinite(image?.logicalWidth) && image.logicalWidth > 0
    ? image.logicalWidth
    : image?.width ?? 0;
}

function imageLogicalHeight(image) {
  return Number.isFinite(image?.logicalHeight) && image.logicalHeight > 0
    ? image.logicalHeight
    : image?.height ?? 0;
}

function sceneObjectCompositeOperation(blendMode) {
  switch (blendMode) {
    case 1:
      return "lighter";
    case 2:
      return "difference";
    case 3:
      return "multiply";
    default:
      return "source-over";
  }
}

function clampUnit(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function finiteCoordinate(value) {
  return Number.isFinite(value) ? Math.max(-100_000, Math.min(100_000, value)) : 0;
}

function boundedInteger(value, minimum, maximum, fallback) {
  return Number.isInteger(value)
    ? Math.max(minimum, Math.min(value, maximum))
    : fallback;
}

function interpolate(from, to, progress) {
  return from + (to - from) * progress;
}

function validAssetName(value) {
  return typeof value === "string" && /^[A-Za-z0-9_.-]+$/.test(value) ? value : "";
}

function ensureSceneObjectMotions(state) {
  if (!state.sceneObjectMotions) {
    state.sceneObjectMotions = new Map();
  }
  return state.sceneObjectMotions;
}
