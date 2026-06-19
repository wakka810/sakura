import {
  finishScenarioSceneObjectTransitions,
  paintScenarioSceneObjects,
  setScenarioSceneObjectProgress,
} from "./scenario-scene-objects.js";
import {
  controlMotionLayer,
  motionOffset,
  settleCompletedControlMotions,
} from "./scenario-sprite-motion.js";
import { paintMappedTransition } from "./scenario-transition-mask.js";

const spriteCanvasCache = new WeakMap();

export function createScenarioSpriteState() {
  return {
    layers: new Map(),
    presentedLayers: new Map(),
    motions: new Map(),
    controlMotions: new Map(),
    transitions: new Map(),
    nextLayerOrder: 0,
    sceneObjects: new Map(),
    sceneObjectTransitions: new Map(),
    sceneObjectBackgroundTransition: null,
    sceneObjectMotions: new Map(),
  };
}

export function beginScenarioSpriteTransition(
  state,
  slot,
  image,
  durationMs,
  {
    alpha,
    assetName = "",
    blocking = false,
    eventCount = 0,
    mapAssetName = "",
    mapImage = null,
    now = performance.now(),
    opcode = 0,
    order,
    priority,
    x,
    y,
    z,
  } = {},
) {
  settleReplacedSpriteTransition(state, slot, now);
  const previous = state.layers.get(slot) ?? null;
  const targetOrder = previous?.order
    ?? (
      Number.isInteger(order)
        ? boundedInteger(order, 0, 1_000_000, 0)
        : state.nextLayerOrder++
    );
  const target = image
    ? {
        image,
        slot,
        alpha: alpha === undefined ? previous?.alpha ?? 1 : clampUnit(alpha),
        assetName: validAssetName(assetName),
        order: targetOrder,
        priority: boundedInteger(priority, 0, 128, previous?.priority ?? 0),
        x: optionalCoordinate(x, previous?.x ?? null),
        y: finiteCoordinate(y ?? previous?.y ?? 0),
        z: finiteCoordinate(z ?? previous?.z ?? 0),
      }
    : null;
  if (durationMs <= 0) {
    commitLayer(state, slot, target);
    state.transitions.delete(slot);
    return;
  }
  state.transitions.set(slot, {
    slot,
    from: previous,
    to: target,
    remove: false,
    startedAt: now,
    durationMs,
    blocking,
    eventCount,
    mapAssetName: mapImage ? validAssetName(mapAssetName) : "",
    mapImage,
    opcode,
  });
}

export function updateScenarioSpriteLayer(
  state,
  slot,
  durationMs,
  {
    image,
    assetName,
    alpha,
    blocking = false,
    eventCount = 0,
    now = performance.now(),
    opcode = 0,
    x,
    y,
    z,
  } = {},
) {
  settleReplacedSpriteTransition(state, slot, now);
  const previous = state.layers.get(slot);
  if (!previous) {
    return false;
  }
  const target = {
    ...previous,
    image: image ?? previous.image,
    assetName: assetName === undefined
      ? previous.assetName
      : validAssetName(assetName),
    alpha: alpha === undefined ? previous.alpha : clampUnit(alpha),
    x: optionalCoordinate(x, previous.x),
    y: finiteCoordinate(y ?? previous.y),
    z: finiteCoordinate(z ?? previous.z),
  };
  if (durationMs <= 0) {
    commitLayer(state, slot, target);
    state.transitions.delete(slot);
    return true;
  }
  state.transitions.set(slot, {
    slot,
    from: previous,
    to: target,
    remove: false,
    startedAt: now,
    durationMs,
    blocking,
    eventCount,
    opcode,
  });
  return true;
}

export function removeScenarioSpriteLayer(
  state,
  slot,
  durationMs,
  {
    alpha,
    blocking = false,
    eventCount = 0,
    now = performance.now(),
    opcode = 0,
    x,
    y,
    z,
  } = {},
) {
  settleReplacedSpriteTransition(state, slot, now);
  const previous = state.layers.get(slot);
  if (!previous) {
    state.transitions.delete(slot);
    return false;
  }
  if (durationMs <= 0) {
    state.layers.delete(slot);
    state.transitions.delete(slot);
    return true;
  }
  state.transitions.set(slot, {
    slot,
    from: previous,
    to: {
      ...previous,
      alpha: alpha === undefined ? previous.alpha : clampUnit(alpha),
      x: optionalCoordinate(x, previous.x),
      y: finiteCoordinate(y ?? previous.y),
      z: finiteCoordinate(z ?? previous.z),
    },
    remove: true,
    startedAt: now,
    durationMs,
    blocking,
    eventCount,
    opcode,
  });
  return true;
}

export function setScenarioSpriteProgress(state, progress) {
  setScenarioSceneObjectProgress(state, progress);
}

export function finishScenarioSpriteTransitions(state, now = performance.now()) {
  for (const transition of [...state.transitions.values()]) {
    if (transition.blocking || spriteTransitionProgress(transition, now) >= 1) {
      commitSpriteTransition(state, transition);
    }
  }
  finishScenarioSceneObjectTransitions(state, now);
}

export function clearScenarioSprites(state) {
  state.layers.clear();
  state.presentedLayers.clear();
  state.motions.clear();
  state.controlMotions.clear();
  state.transitions.clear();
  state.nextLayerOrder = 0;
}

export function snapshotScenarioSprites(state, now = performance.now()) {
  settleCompletedSpriteTransitions(state, now);
  return sortedLayers(state.layers)
    .filter(([, layer]) => layer.assetName.length > 0)
    .map(([slot, layer]) => ({
      slot,
      assetName: layer.assetName,
      alpha: layer.alpha,
      order: layer.order,
      priority: layer.priority,
      x: layer.x,
      y: layer.y,
      z: layer.z,
    }));
}

export function snapshotScenarioSpriteTransitions(state, now = performance.now()) {
  settleCompletedSpriteTransitions(state, now);
  return [...state.transitions.values()]
    .sort((left, right) => left.slot - right.slot)
    .map((transition) => ({
      slot: transition.slot,
      remainingMs: Math.max(
        1,
        transition.durationMs - (now - transition.startedAt),
      ),
      remove: transition.remove,
      eventCount: transition.eventCount,
      mapAssetName: transition.mapAssetName,
      opcode: transition.opcode,
      from: snapshotTransitionLayer(transition.from),
      to: snapshotTransitionLayer(transition.to),
    }));
}

export function restoreScenarioSpriteTransition(
  state,
  snapshot,
  {
    fromImage = null,
    mapImage = null,
    now = performance.now(),
    toImage = null,
  } = {},
) {
  const from = restoreTransitionLayer(snapshot.from, fromImage, snapshot.slot);
  const to = restoreTransitionLayer(snapshot.to, toImage, snapshot.slot);
  if (
    !Number.isInteger(snapshot.slot)
    || snapshot.remainingMs <= 0
    || (from === null && to === null)
  ) {
    return false;
  }
  commitLayer(state, snapshot.slot, from);
  state.transitions.set(snapshot.slot, {
    slot: snapshot.slot,
    from,
    to,
    remove: Boolean(snapshot.remove),
    startedAt: now,
    durationMs: snapshot.remainingMs,
    blocking: false,
    eventCount: snapshot.eventCount ?? 0,
    mapAssetName: validAssetName(snapshot.mapAssetName) && mapImage
      ? snapshot.mapAssetName
      : "",
    mapImage,
    opcode: snapshot.opcode ?? 0,
  });
  return true;
}

export function snapshotScenarioSpritePresentation(state, now = performance.now()) {
  settleCompletedControlMotions(state, now);
  settleCompletedSpriteTransitions(state, now);
  const slots = new Set([...state.layers.keys(), ...state.transitions.keys()]);
  return [...slots]
    .sort((left, right) => left - right)
    .map((slot) => presentedSpriteLayer(state, slot, now))
    .filter(Boolean)
    .map((layer) => ({
      ...controlMotionLayer(
        layer,
        state.controlMotions.get(layer.slot),
        now,
      ),
      slot: layer.slot,
    }));
}

export function hasActiveScenarioSpriteMotions(state, now = performance.now()) {
  settleCompletedControlMotions(state, now);
  settleCompletedSpriteTransitions(state, now);
  return state.transitions.size > 0
    || state.motions.size > 0
    || state.controlMotions.size > 0;
}

export function paintScenarioSprites(context, canvas, state) {
  const now = performance.now();
  settleCompletedControlMotions(state, now);
  settleCompletedSpriteTransitions(state, now);
  const slots = new Set([...state.layers.keys(), ...state.transitions.keys()]);
  const layers = [...slots]
    .map((slot) => presentedSpriteLayer(state, slot, now))
    .filter(Boolean)
    .map((layer) => controlMotionLayer(
      layer,
      state.controlMotions.get(layer.slot),
      now,
    ));
  state.presentedLayers.clear();
  for (const layer of layers) {
    state.presentedLayers.set(layer.slot, layer);
  }
  const drawQueue = [];
  for (const layer of layers) {
    const transition = state.transitions.get(layer.slot);
    if (!transition || usesSingleTransitionLayer(transition)) {
      drawQueue.push({
        layer,
        phase: 0,
        transitionAlpha: 1,
        transitionMap: null,
      });
    }
  }
  for (const transition of state.transitions.values()) {
    if (usesSingleTransitionLayer(transition)) {
      continue;
    }
    const progress = spriteTransitionProgress(transition, now);
    if (transition.from) {
      drawQueue.push({
        layer: controlMotionLayer(
          transition.from,
          state.controlMotions.get(transition.slot),
          now,
        ),
        phase: 0,
        transitionAlpha: transition.mapImage ? 1 : 1 - progress,
        transitionMap: null,
      });
    }
    if (transition.to) {
      drawQueue.push({
        layer: controlMotionLayer(
          transition.to,
          state.controlMotions.get(transition.slot),
          now,
        ),
        phase: 1,
        transitionAlpha: progress,
        transitionMap: transition.mapImage
          ? { image: transition.mapImage, progress, transition }
          : null,
      });
    }
  }
  drawQueue.sort((left, right) => (
    left.layer.priority - right.layer.priority
    || left.layer.order - right.layer.order
    || left.phase - right.phase
  ));
  for (const item of drawQueue) {
    drawSpriteLayer(
      context,
      canvas,
      item.layer,
      item.transitionAlpha,
      motionOffset(state, item.layer.slot, now),
      item.transitionMap,
    );
  }
  paintScenarioSceneObjects(context, canvas, state, now);
}

function usesSingleTransitionLayer(transition) {
  return Boolean(
    transition?.from
    && transition.to
    && transition.from.image === transition.to.image,
  );
}

function presentedSpriteLayer(state, slot, now) {
  const transition = state.transitions.get(slot);
  const layer = state.layers.get(slot) ?? transition?.to ?? null;
  if (!transition) {
    return layer;
  }
  const progress = spriteTransitionProgress(transition, now);
  if (!usesSingleTransitionLayer(transition)) {
    return transition.to
      ? { ...transition.to, alpha: transition.to.alpha * progress }
      : transition.from
        ? { ...transition.from, alpha: transition.from.alpha * (1 - progress) }
        : null;
  }
  return {
    ...transition.to,
    alpha: interpolate(transition.from.alpha, transition.to.alpha, progress),
    x: interpolateOptionalCoordinate(transition.from.x, transition.to.x, progress),
    y: interpolate(transition.from.y, transition.to.y, progress),
    z: interpolate(transition.from.z, transition.to.z, progress),
  };
}

function settleCompletedSpriteTransitions(state, now) {
  for (const transition of [...state.transitions.values()]) {
    if (spriteTransitionProgress(transition, now) >= 1) {
      commitSpriteTransition(state, transition);
    }
  }
}

function settleReplacedSpriteTransition(state, slot, now) {
  const transition = state.transitions.get(slot);
  if (!transition) {
    return;
  }
  const presented = presentedSpriteLayer(state, slot, now);
  commitLayer(state, slot, presented);
  state.transitions.delete(slot);
}

function commitSpriteTransition(state, transition) {
  commitLayer(state, transition.slot, transition.remove ? null : transition.to);
  state.transitions.delete(transition.slot);
}

function spriteTransitionProgress(transition, now) {
  return clampUnit((now - transition.startedAt) / transition.durationMs);
}

function snapshotTransitionLayer(layer) {
  return layer
    ? {
        assetName: layer.assetName,
        alpha: layer.alpha,
        order: layer.order,
        priority: layer.priority,
        x: layer.x,
        y: layer.y,
        z: layer.z,
      }
    : null;
}

function restoreTransitionLayer(snapshot, image, slot = 0) {
  if (!snapshot) {
    return null;
  }
  return {
    ...snapshot,
    image,
    order: boundedInteger(snapshot.order, 0, 1_000_000, 0),
    priority: boundedInteger(snapshot.priority, 0, 128, 0),
    slot,
  };
}

function commitLayer(state, slot, layer) {
  if (layer) {
    state.layers.set(slot, layer);
    state.nextLayerOrder = Math.max(state.nextLayerOrder, layer.order + 1);
  } else {
    state.layers.delete(slot);
  }
}

function sortedLayers(layers) {
  return [...layers.entries()].sort(([left], [right]) => left - right);
}

function drawSpriteLayer(
  context,
  canvas,
  layer,
  transitionAlpha,
  offset,
  transitionMap,
) {
  if (!layer || transitionAlpha <= 0) {
    return;
  }
  const image = layer.image;
  const centerX = layer.x === null
    ? spriteCenterX(canvas.width, layer.slot)
    : canvas.width / 2 + layer.x;
  const logicalWidth = imageLogicalWidth(image);
  const logicalHeight = imageLogicalHeight(image);
  const x = Math.round(centerX - logicalWidth / 2 + (offset?.x ?? 0));
  const y = Math.round(canvas.height - logicalHeight + layer.y + (offset?.y ?? 0));
  if (transitionMap) {
    paintMappedTransition(
      context,
      rgbaCanvas(image),
      transitionMap.image,
      transitionMap.progress,
      {
        alpha: layer.alpha,
        cacheKey: transitionMap.transition,
        height: logicalHeight,
        width: logicalWidth,
        x,
        y,
      },
    );
    return;
  }
  context.save();
  context.globalAlpha = clampUnit(layer.alpha * transitionAlpha);
  context.drawImage(rgbaCanvas(image), x, y, logicalWidth, logicalHeight);
  context.restore();
}

function spriteCenterX(canvasWidth, slot) {
  const center = canvasWidth / 2 + (slot - 5) * (canvasWidth * 0.14);
  return Math.max(canvasWidth * 0.17, Math.min(canvasWidth * 0.83, center));
}

function rgbaCanvas(image) {
  const cached = spriteCanvasCache.get(image);
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
  spriteCanvasCache.set(image, scratch);
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

function clampUnit(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function finiteCoordinate(value) {
  return Number.isFinite(value) ? Math.max(-100_000, Math.min(100_000, value)) : 0;
}

function optionalCoordinate(value, fallback) {
  return value === null || value === undefined ? fallback : finiteCoordinate(value);
}

function interpolateOptionalCoordinate(from, to, progress) {
  if (from === null && to === null) {
    return null;
  }
  return interpolate(from ?? to ?? 0, to ?? from ?? 0, progress);
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
  return typeof value === "string" && /^[A-Za-z0-9_]+$/.test(value) ? value : "";
}
