const FULL_APERTURE = Object.freeze({
  centerX: 640,
  centerY: 360,
  width: 1280,
  height: 720,
  feather: 0,
});

export function createScenarioApertureState() {
  return {
    pending: null,
    current: null,
    from: null,
    to: null,
    progress: 1,
    transitioning: false,
  };
}

export function configureScenarioAperture(state, intArgs) {
  const next = parseApertureArgs(intArgs);
  state.pending = next;
  return next;
}

export function configureScenarioApertureBand(state, intArgs) {
  const args = Array.isArray(intArgs) ? intArgs : [];
  const height = boundedNumber(args[3] ?? 0, 0, 720, 0);
  const next = normalizeAperture({
    centerX: 640,
    centerY: 360,
    width: 1280,
    height,
    feather: 0,
  });
  state.pending = next;
  return next;
}

export function beginScenarioAperture(state, target, durationMs) {
  const to = normalizeAperture(target);
  const from = resolvedScenarioAperture(state) ?? FULL_APERTURE;
  if (durationMs <= 0) {
    state.current = isFullAperture(to) ? null : to;
    state.from = null;
    state.to = null;
    state.progress = 1;
    state.transitioning = false;
    return;
  }
  state.from = from;
  state.to = to;
  state.progress = 0;
  state.transitioning = true;
}

export function beginPendingScenarioAperture(state, durationMs) {
  beginScenarioAperture(state, state.pending ?? FULL_APERTURE, durationMs);
}

export function clearScenarioAperture(state, durationMs) {
  state.pending = FULL_APERTURE;
  beginScenarioAperture(state, FULL_APERTURE, durationMs);
}

export function setScenarioApertureProgress(state, progress) {
  if (state.transitioning) {
    state.progress = clampUnit(progress);
  }
}

export function finishScenarioApertureTransition(state) {
  if (!state.transitioning) {
    return;
  }
  const target = normalizeAperture(state.to);
  state.current = isFullAperture(target) ? null : target;
  state.from = null;
  state.to = null;
  state.progress = 1;
  state.transitioning = false;
}

export function paintScenarioAperture(context, canvas, state) {
  const aperture = resolvedScenarioAperture(state);
  if (!aperture || isFullAperture(aperture)) {
    return false;
  }
  const left = Math.max(0, Math.round(aperture.centerX - aperture.width / 2));
  const right = Math.min(canvas.width, Math.round(aperture.centerX + aperture.width / 2));
  const top = Math.max(0, Math.round(aperture.centerY - aperture.height / 2));
  const bottom = Math.min(canvas.height, Math.round(aperture.centerY + aperture.height / 2));
  context.save();
  context.fillStyle = "#000";
  context.fillRect(0, 0, canvas.width, top);
  context.fillRect(0, bottom, canvas.width, canvas.height - bottom);
  context.fillRect(0, top, left, bottom - top);
  context.fillRect(right, top, canvas.width - right, bottom - top);
  paintFeather(context, canvas, { left, right, top, bottom }, aperture.feather);
  context.restore();
  return true;
}

export function snapshotScenarioAperture(state) {
  const current = resolvedScenarioAperture(state);
  if (!current || isFullAperture(current)) {
    return null;
  }
  return { ...current };
}

export function restoreScenarioAperture(state, snapshot) {
  state.pending = null;
  state.from = null;
  state.to = null;
  state.progress = 1;
  state.transitioning = false;
  state.current = snapshot && isValidScenarioApertureSnapshot(snapshot)
    ? normalizeAperture(snapshot)
    : null;
}

export function isValidScenarioApertureSnapshot(snapshot) {
  return snapshot === undefined
    || snapshot === null
    || (
      Number.isFinite(snapshot.centerX)
      && Number.isFinite(snapshot.centerY)
      && Number.isFinite(snapshot.width)
      && Number.isFinite(snapshot.height)
      && Number.isFinite(snapshot.feather)
      && Math.abs(snapshot.centerX) <= 100_000
      && Math.abs(snapshot.centerY) <= 100_000
      && snapshot.width >= 0
      && snapshot.width <= 100_000
      && snapshot.height >= 0
      && snapshot.height <= 100_000
      && snapshot.feather >= 0
      && snapshot.feather <= 2_000
    );
}

export function resolvedScenarioAperture(state) {
  if (!state?.transitioning) {
    return state?.current ?? null;
  }
  return interpolateAperture(
    normalizeAperture(state.from),
    normalizeAperture(state.to),
    state.progress,
  );
}

function parseApertureArgs(intArgs) {
  const args = Array.isArray(intArgs) ? intArgs : [];
  if (args.length >= 9) {
    const height = boundedNumber(args[3], 0, 720, 720);
    const width = boundedNumber(args[5], 0, 1280, 1280);
    const feather = boundedNumber(Math.max(args[7] ?? 0, args[8] ?? 0), 0, 320, 0);
    return normalizeAperture({ centerX: 640, centerY: 360, width, height, feather });
  }
  if (
    args.length >= 7
    && args[3] >= 720
    && args[4] >= 1280
    && args[5] === 0
    && args[6] === 0
  ) {
    return FULL_APERTURE;
  }
  if (args.length >= 7) {
    return normalizeAperture({
      centerY: args[3],
      centerX: args[4],
      height: args[5],
      width: args[6],
      feather: boundedNumber(args[7] ?? 0, 0, 320, 0),
    });
  }
  return FULL_APERTURE;
}

function interpolateAperture(from, to, progress) {
  const t = clampUnit(progress);
  return normalizeAperture({
    centerX: interpolate(from.centerX, to.centerX, t),
    centerY: interpolate(from.centerY, to.centerY, t),
    width: interpolate(from.width, to.width, t),
    height: interpolate(from.height, to.height, t),
    feather: interpolate(from.feather, to.feather, t),
  });
}

function normalizeAperture(value) {
  if (!value) {
    return FULL_APERTURE;
  }
  return {
    centerX: boundedNumber(value.centerX, -100_000, 100_000, 640),
    centerY: boundedNumber(value.centerY, -100_000, 100_000, 360),
    width: boundedNumber(value.width, 0, 100_000, 1280),
    height: boundedNumber(value.height, 0, 100_000, 720),
    feather: boundedNumber(value.feather, 0, 2_000, 0),
  };
}

function isFullAperture(aperture) {
  return aperture.width >= 1279 && aperture.height >= 719;
}

function paintFeather(context, canvas, box, feather) {
  const size = Math.min(Math.round(feather), 320);
  if (size <= 0 || box.left >= box.right || box.top >= box.bottom) {
    return;
  }
  if (box.top > 0) {
    const gradient = context.createLinearGradient(0, box.top - size, 0, box.top);
    gradient.addColorStop(0, "rgba(0,0,0,1)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = gradient;
    context.fillRect(0, Math.max(0, box.top - size), canvas.width, size);
  }
  if (box.bottom < canvas.height) {
    const gradient = context.createLinearGradient(0, box.bottom, 0, box.bottom + size);
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(1, "rgba(0,0,0,1)");
    context.fillStyle = gradient;
    context.fillRect(0, box.bottom, canvas.width, size);
  }
}

function boundedNumber(value, minimum, maximum, fallback) {
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;
}

function clampUnit(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function interpolate(from, to, progress) {
  return from + (to - from) * progress;
}
