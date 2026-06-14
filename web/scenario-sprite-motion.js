export function beginScenarioSpriteControlMotion(
  state,
  spriteId,
  repeatCount,
  bytes,
  startedAt = performance.now(),
) {
  const slot = motionSpriteSlot(spriteId);
  const elements = decodeControlMotionElements(bytes);
  if (elements.length === 0) {
    return stopScenarioSpriteControlMotion(state, spriteId, startedAt);
  }
  state.controlMotions.set(slot, {
    spriteId,
    slot,
    repeatCount: Math.max(0, Math.min(integerOr(repeatCount, 1), 16)),
    elements,
    startedAt,
  });
  return true;
}

export function stopScenarioSpriteControlMotion(
  state,
  spriteId,
  now = performance.now(),
) {
  const slot = motionSpriteSlot(spriteId);
  const motion = state.controlMotions.get(slot);
  const layer = state.layers.get(slot);
  if (motion && layer) {
    state.layers.set(slot, controlMotionLayer(layer, motion, now));
  }
  return state.controlMotions.delete(slot);
}

export function snapshotScenarioSpriteControlMotions(state) {
  const now = performance.now();
  settleCompletedControlMotions(state, now);
  return [...state.controlMotions.values()].map((motion) => ({
    spriteId: motion.spriteId,
    repeatCount: motion.repeatCount,
    elapsedMs: Math.max(0, now - motion.startedAt),
    elements: motion.elements.map((element) => ({
      ...element,
      points: element.points.map((point) => ({ ...point })),
    })),
  }));
}

export function restoreScenarioSpriteControlMotion(
  state,
  snapshot,
  now = performance.now(),
) {
  const slot = motionSpriteSlot(snapshot.spriteId);
  state.controlMotions.set(slot, {
    spriteId: snapshot.spriteId,
    slot,
    repeatCount: snapshot.repeatCount,
    elements: snapshot.elements.map((element) => ({
      ...element,
      points: element.points.map((point) => ({ ...point })),
    })),
    startedAt: now - snapshot.elapsedMs,
  });
}

export function startScenarioSpriteVerticalShake(
  state,
  slot,
  amplitudeY,
  periodMs,
  phase = 0,
) {
  state.motions.set(slot, {
    amplitudeX: 0,
    amplitudeY: Math.max(0, Math.min(Math.abs(amplitudeY), 128)),
    periodMs: Math.max(16, Math.min(periodMs, 60_000)),
    phase,
    startedAt: performance.now(),
  });
}

export function stopScenarioSpriteMotion(state, slot) {
  return state.motions.delete(slot);
}

export function snapshotScenarioSpriteMotions(state) {
  const now = performance.now();
  return [...state.motions.entries()].map(([slot, motion]) => ({
    slot,
    amplitudeX: motion.amplitudeX ?? 0,
    amplitudeY: motion.amplitudeY,
    periodMs: motion.periodMs,
    phase: currentMotionPhase(motion, now),
    directionMode: motion.directionMode,
    speed: motion.speed,
  }));
}

export function controlMotionLayer(layer, motion, now) {
  if (!motion) {
    return layer;
  }
  const totalDuration = motion.elements.reduce(
    (sum, element) => sum + motionElementDuration(element),
    0,
  );
  if (totalDuration <= 0) {
    return applyMotionElements(layer, motion.elements, Number.POSITIVE_INFINITY);
  }
  const fullDuration = totalDuration * motion.repeatCount;
  const elapsed = Math.max(0, now - motion.startedAt);
  const cycleElapsed = motion.repeatCount === 0
    ? elapsed % totalDuration
    : elapsed >= fullDuration
      ? totalDuration
      : elapsed % totalDuration;
  return applyMotionElements(layer, motion.elements, cycleElapsed);
}

export function settleCompletedControlMotions(state, now) {
  for (const [slot, motion] of state.controlMotions) {
    const duration = motion.elements.reduce(
      (sum, element) => sum + motionElementDuration(element),
      0,
    )
      * motion.repeatCount;
    if (motion.repeatCount === 0 || now - motion.startedAt < duration) {
      continue;
    }
    const layer = state.layers.get(slot);
    if (layer) {
      state.layers.set(slot, controlMotionLayer(layer, motion, now));
    }
    state.controlMotions.delete(slot);
  }
}

export function motionOffsetY(state, slot, now) {
  return scenarioMotionOffset(state.motions.get(slot), now).y;
}

export function motionOffset(state, slot, now) {
  return scenarioMotionOffset(state.motions.get(slot), now);
}

export function createScenarioDirectionalMotion(intArgs, startedAt = performance.now()) {
  const directionMode = boundedInteger(intArgs.at(-5), 0, 10, 0);
  const amplitude = Math.min(400, Math.abs(integerOr(intArgs.at(-3), 0)));
  const speed = boundedInteger(intArgs.at(-2), 0, 256, 0);
  const phaseSeed = boundedInteger(intArgs.at(-6), 0, 10_000, 0);
  const angle = DIRECTION_DEGREES[directionMode] * Math.PI / 180;
  return {
    amplitudeX: Math.cos(angle) * amplitude,
    amplitudeY: Math.sin(angle) * amplitude,
    directionMode,
    periodMs: directionalMotionPeriodMs(speed),
    phase: phaseSeed / 10,
    speed,
    startedAt,
  };
}

export function scenarioMotionOffset(motion, now) {
  if (!motion) {
    return { x: 0, y: 0 };
  }
  const phase = currentMotionPhase(motion, now);
  return {
    x: Math.round(Math.sin(phase) * (motion.amplitudeX ?? 0)),
    y: Math.round(Math.sin(phase) * (motion.amplitudeY ?? 0)),
  };
}

export function snapshotScenarioMotion(motion, now = performance.now()) {
  if (!motion) {
    return null;
  }
  return {
    amplitudeX: motion.amplitudeX ?? 0,
    amplitudeY: motion.amplitudeY ?? 0,
    directionMode: motion.directionMode,
    periodMs: motion.periodMs,
    phase: currentMotionPhase(motion, now),
    speed: motion.speed,
  };
}

export function restoreScenarioMotion(snapshot, now = performance.now()) {
  if (!snapshot) {
    return null;
  }
  return {
    amplitudeX: finiteMotionNumber(snapshot.amplitudeX, 0),
    amplitudeY: finiteMotionNumber(snapshot.amplitudeY, 0),
    directionMode: Number.isInteger(snapshot.directionMode)
      ? Math.max(0, Math.min(snapshot.directionMode, 10))
      : undefined,
    periodMs: Math.max(16, Math.min(finiteMotionNumber(snapshot.periodMs, 240), 60_000)),
    phase: finiteMotionNumber(snapshot.phase, 0),
    speed: Number.isInteger(snapshot.speed)
      ? Math.max(0, Math.min(snapshot.speed, 256))
      : undefined,
    startedAt: now,
  };
}

function decodeControlMotionElements(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength % 0x120 !== 0) {
    return [];
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const elements = [];
  for (let offset = 0; offset < bytes.byteLength; offset += 0x120) {
    const pointCount = view.getInt32(offset, true);
    if (pointCount < 1 || pointCount > 16) {
      return [];
    }
    const points = [];
    for (let index = 0; index < pointCount; index += 1) {
      const pointOffset = offset + 0x20 + index * 0x10;
      points.push({
        x: view.getInt32(pointOffset, true),
        y: view.getInt32(pointOffset + 4, true),
        z: view.getInt32(pointOffset + 8, true),
        holdMs: Math.max(0, Math.min(view.getInt32(pointOffset + 12, true), 600_000)),
      });
    }
    elements.push({
      durationMs: Math.max(0, Math.min(view.getInt32(offset + 0x1c, true), 600_000)),
      alpha: 1 - Math.max(0, Math.min(view.getInt32(offset + 0x10, true), 256)) / 256,
      movementMode: view.getInt32(offset + 0x14, true),
      rotationMode: view.getInt32(offset + 0x18, true),
      points,
    });
  }
  return elements;
}

function applyMotionElements(layer, elements, elapsedMs) {
  let current = { ...layer };
  let remaining = elapsedMs;
  for (const element of elements) {
    const duration = motionElementDuration(element);
    if (duration <= 0 || remaining >= duration) {
      current = motionElementLayer(current, element, duration);
      remaining -= duration;
      continue;
    }
    return motionElementLayer(current, element, remaining);
  }
  return current;
}

function motionElementLayer(layer, element, elapsedMs) {
  const points = element.points;
  const segmentDuration = points.length === 0 ? 0 : element.durationMs / points.length;
  const startAlpha = layer.alpha;
  let transitionedMs = 0;
  let remaining = elapsedMs;
  let current = { ...layer };
  for (const point of points) {
    if (segmentDuration > 0 && remaining < segmentDuration) {
      const progress = remaining / segmentDuration;
      return {
        ...current,
        ...interpolatePoint(current, point, progress),
        alpha: interpolate(
          startAlpha,
          element.alpha,
          (transitionedMs + remaining) / element.durationMs,
        ),
      };
    }
    if (segmentDuration > 0) {
      remaining -= segmentDuration;
      transitionedMs += segmentDuration;
    }
    current = {
      ...current,
      x: point.x,
      y: point.y,
      z: point.z,
      alpha: element.durationMs === 0
        ? element.alpha
        : interpolate(startAlpha, element.alpha, transitionedMs / element.durationMs),
    };
    if (remaining < point.holdMs) {
      return current;
    }
    remaining -= point.holdMs;
  }
  return { ...current, alpha: element.alpha };
}

function interpolatePoint(from, to, progress) {
  return {
    x: interpolate(from.x ?? 0, to.x, progress),
    y: interpolate(from.y, to.y, progress),
    z: interpolate(from.z, to.z, progress),
  };
}

function motionElementDuration(element) {
  return element.durationMs
    + element.points.reduce((sum, point) => sum + point.holdMs, 0);
}

function motionSpriteSlot(spriteId) {
  const value = integerOr(spriteId, 0);
  return Math.max(0, Math.min(value >= 32 ? value - 32 : value, 31));
}

function currentMotionPhase(motion, now) {
  return motion.phase + ((now - motion.startedAt) / motion.periodMs) * Math.PI * 2;
}

const DIRECTION_DEGREES = Object.freeze([0, 45, 90, 135, 90, 0, 90, 180, 225, 270, 315]);

function directionalMotionPeriodMs(speed) {
  if (speed <= 0) {
    return 1_000;
  }
  return Math.max(16, Math.min(60_000, Math.round(4_266 / speed)));
}

function boundedInteger(value, minimum, maximum, fallback) {
  return Number.isInteger(value)
    ? Math.max(minimum, Math.min(value, maximum))
    : fallback;
}

function finiteMotionNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function integerOr(value, fallback) {
  return Number.isInteger(value) ? value : fallback;
}

function interpolate(from, to, progress) {
  return from + (to - from) * progress;
}
