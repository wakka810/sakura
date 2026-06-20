export const TWO_FINGER_DOUBLE_TAP_DEFAULTS = Object.freeze({
  maxTapDurationMs: 280,
  maxSecondTapDelayMs: 450,
  maxMovePx: 32,
  maxTapDistancePx: 96,
});

export function createTwoFingerDoubleTapRecognizer(options = {}) {
  const config = {
    ...TWO_FINGER_DOUBLE_TAP_DEFAULTS,
    ...options,
  };
  const activePointers = new Map();
  let sequence = null;
  let lastTap = null;

  function pointerDown(event) {
    if (!isTouchPointer(event)) {
      return noMatch();
    }
    const now = eventTime(event);
    if (activePointers.size === 0) {
      sequence = createSequence(now);
    }
    const point = eventPoint(event, now);
    activePointers.set(pointerKey(event), point);
    updateSequenceForActivePointers();
    return {
      suppress: sequence?.suppress === true,
      recognized: false,
    };
  }

  function pointerMove(event) {
    if (!isTouchPointer(event)) {
      return noMatch();
    }
    const key = pointerKey(event);
    const active = activePointers.get(key);
    if (!active || !sequence) {
      return noMatch();
    }
    active.x = event.clientX;
    active.y = event.clientY;
    if (distance(active.startX, active.startY, active.x, active.y) > config.maxMovePx) {
      sequence.invalid = true;
    }
    if (sequence.suppress && activePointers.size >= 2) {
      sequence.lastCentroid = pointerCentroid(activePointers.values());
    }
    return {
      suppress: sequence.suppress,
      recognized: false,
    };
  }

  function pointerUp(event) {
    if (!isTouchPointer(event)) {
      return noMatch();
    }
    const key = pointerKey(event);
    const active = activePointers.get(key);
    if (active) {
      active.x = event.clientX;
      active.y = event.clientY;
      if (sequence && distance(active.startX, active.startY, active.x, active.y) > config.maxMovePx) {
        sequence.invalid = true;
      }
    }
    if (sequence?.suppress === true && activePointers.size >= 2) {
      sequence.lastCentroid = pointerCentroid(activePointers.values());
    }
    const suppress = sequence?.suppress === true;
    activePointers.delete(key);
    if (activePointers.size !== 0 || !sequence) {
      return { suppress, recognized: false };
    }
    const recognized = finishSequence(eventTime(event));
    sequence = null;
    return { suppress, recognized };
  }

  function pointerCancel(event) {
    if (!isTouchPointer(event)) {
      return noMatch();
    }
    const suppress = sequence?.suppress === true;
    activePointers.clear();
    sequence = null;
    lastTap = null;
    return { suppress, recognized: false };
  }

  function reset() {
    activePointers.clear();
    sequence = null;
    lastTap = null;
  }

  function updateSequenceForActivePointers() {
    if (!sequence) {
      return;
    }
    sequence.maxPointerCount = Math.max(sequence.maxPointerCount, activePointers.size);
    if (activePointers.size >= 2) {
      sequence.suppress = true;
      const centroid = pointerCentroid(activePointers.values());
      sequence.lastCentroid = centroid;
      if (!sequence.firstCentroid) {
        sequence.firstCentroid = centroid;
      }
    }
    if (activePointers.size > 2) {
      sequence.invalid = true;
    }
  }

  function finishSequence(now) {
    const centroid = sequence.lastCentroid ?? sequence.firstCentroid;
    const validTap = sequence.suppress
      && !sequence.invalid
      && sequence.maxPointerCount === 2
      && centroid !== null
      && now - sequence.startedAt <= config.maxTapDurationMs;

    if (!validTap) {
      lastTap = null;
      return false;
    }
    const previous = lastTap;
    lastTap = { time: now, x: centroid.x, y: centroid.y };
    if (
      previous
      && now - previous.time <= config.maxSecondTapDelayMs
      && distance(previous.x, previous.y, centroid.x, centroid.y) <= config.maxTapDistancePx
    ) {
      lastTap = null;
      return true;
    }
    return false;
  }

  return {
    pointerDown,
    pointerMove,
    pointerUp,
    pointerCancel,
    reset,
  };
}

function createSequence(now) {
  return {
    startedAt: now,
    maxPointerCount: 0,
    suppress: false,
    invalid: false,
    firstCentroid: null,
    lastCentroid: null,
  };
}

function noMatch() {
  return { suppress: false, recognized: false };
}

function isTouchPointer(event) {
  return event?.pointerType === "touch";
}

function pointerKey(event) {
  return Number.isInteger(event.pointerId) ? event.pointerId : "touch";
}

function eventTime(event) {
  return Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now();
}

function eventPoint(event, now) {
  return {
    startX: event.clientX,
    startY: event.clientY,
    x: event.clientX,
    y: event.clientY,
    startedAt: now,
  };
}

function pointerCentroid(points) {
  let x = 0;
  let y = 0;
  let count = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
    count += 1;
  }
  if (count === 0) {
    return null;
  }
  return { x: x / count, y: y / count };
}

function distance(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}
