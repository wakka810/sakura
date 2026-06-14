function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function clampUnit(value) {
  return Number.isFinite(value) ? clamp(value, 0, 1) : 0;
}

function colorComponent(value) {
  return Number.isInteger(value) ? clamp(value, 0, 256) : 0;
}

function filterStrength(value) {
  return Number.isInteger(value) ? clamp(value, 0, 256) : 0;
}

function filterMode(value) {
  return Number.isInteger(value) ? clamp(value, 0, 3) : 0;
}

function filterConfig(intArgs) {
  return {
    r: colorComponent(intArgs[3]),
    g: colorComponent(intArgs[4]),
    b: colorComponent(intArgs[5]),
    strength: filterStrength(intArgs[6]),
    mode: filterMode(intArgs[7]),
  };
}

function cloneConfig(config) {
  return config ? { ...config } : null;
}

const PRESET_FILTERS = Object.freeze([
  Object.freeze({ r: 0, g: 0, b: 0, strength: 256, mode: 0 }),
  Object.freeze({ r: 255, g: 255, b: 255, strength: 256, mode: 0 }),
  Object.freeze({ r: 255, g: 255, b: 255, strength: 256, mode: 1 }),
  Object.freeze({ r: 255, g: 255, b: 255, strength: 256, mode: 2 }),
  Object.freeze({ r: 255, g: 255, b: 255, strength: 256, mode: 3 }),
]);

export function createScenarioFilterState() {
  return {
    current: null,
    transition: null,
  };
}

export function beginScenarioColorFilter(state, intArgs) {
  const durationMs = positiveDuration(intArgs[1]);
  return beginFilterTransition(state, filterConfig(intArgs), durationMs);
}

export function beginScenarioPresetFilter(state, presetIndex, intArgs) {
  const target = PRESET_FILTERS[presetIndex];
  if (!target) {
    return 0;
  }
  return beginFilterTransition(state, target, positiveDuration(intArgs[1]));
}

function beginFilterTransition(state, targetConfig, durationMs) {
  const target = cloneConfig(targetConfig);
  if (durationMs === 0) {
    state.current = target;
    state.transition = null;
    return 0;
  }
  state.transition = {
    from: cloneConfig(state.current),
    to: target,
    progress: 0,
  };
  return durationMs;
}

export function clearScenarioColorFilter(state, intArgs) {
  const durationMs = positiveDuration(intArgs[1]);
  if (durationMs === 0) {
    state.current = null;
    state.transition = null;
    return 0;
  }
  state.transition = {
    from: cloneConfig(state.current),
    to: null,
    progress: 0,
  };
  return durationMs;
}

export function setScenarioFilterProgress(state, progress) {
  if (state.transition) {
    state.transition.progress = clampUnit(progress);
  }
}

export function finishScenarioFilterTransition(state) {
  if (!state.transition) {
    return;
  }
  state.current = cloneConfig(state.transition.to);
  state.transition = null;
}

export function snapshotScenarioFilter(state) {
  return cloneConfig(state.current);
}

export function restoreScenarioFilter(state, snapshot) {
  state.current = cloneConfig(snapshot);
  state.transition = null;
}

export function isValidScenarioFilterSnapshot(snapshot) {
  return snapshot === null || (
    snapshot
    && Number.isInteger(snapshot.r)
    && snapshot.r >= 0
    && snapshot.r <= 256
    && Number.isInteger(snapshot.g)
    && snapshot.g >= 0
    && snapshot.g <= 256
    && Number.isInteger(snapshot.b)
    && snapshot.b >= 0
    && snapshot.b <= 256
    && Number.isInteger(snapshot.strength)
    && snapshot.strength >= 0
    && snapshot.strength <= 256
    && Number.isInteger(snapshot.mode)
    && snapshot.mode >= 0
    && snapshot.mode <= 3
  );
}

export function resolvedScenarioFilter(state) {
  const transition = state.transition;
  if (!transition) {
    return cloneConfig(state.current);
  }
  const progress = clampUnit(transition.progress);
  const from = transition.from;
  const to = transition.to;
  if (from === null && to === null) {
    return null;
  }
  if (from === null) {
    return { ...to, strength: Math.round(to.strength * progress) };
  }
  if (to === null) {
    return { ...from, strength: Math.round(from.strength * (1 - progress)) };
  }
  return {
    r: interpolate(from.r, to.r, progress),
    g: interpolate(from.g, to.g, progress),
    b: interpolate(from.b, to.b, progress),
    strength: interpolate(from.strength, to.strength, progress),
    mode: progress < 0.5 ? from.mode : to.mode,
  };
}

export function applyScenarioFilter(context, canvas, state) {
  const filter = resolvedScenarioFilter(state);
  if (!filter || filter.strength === 0) {
    return false;
  }
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  filterScenarioPixels(image.data, filter);
  context.putImageData(image, 0, 0);
  return true;
}

export function filterScenarioPixels(pixels, filter) {
  const strength = filterStrength(filter.strength);
  if (filter.mode === 0) {
    return;
  }
  const inverse = 256 - strength;
  for (let offset = 0; offset + 3 < pixels.length; offset += 4) {
    const r = pixels[offset];
    const g = pixels[offset + 1];
    const b = pixels[offset + 2];
    if (filter.mode === 1) {
      pixels[offset] = Math.min(255, r + ((filter.r * strength) >> 8));
      pixels[offset + 1] = Math.min(255, g + ((filter.g * strength) >> 8));
      pixels[offset + 2] = Math.min(255, b + ((filter.b * strength) >> 8));
      continue;
    }
    if (filter.mode === 2) {
      const luminance = (r * 77 + g * 151 + b * 28) >> 8;
      pixels[offset] = ((r * inverse) + (((luminance * filter.r) >> 8) * strength)) >> 8;
      pixels[offset + 1] = ((g * inverse) + (((luminance * filter.g) >> 8) * strength)) >> 8;
      pixels[offset + 2] = ((b * inverse) + (((luminance * filter.b) >> 8) * strength)) >> 8;
      continue;
    }
    pixels[offset] = ((r * inverse) + (filter.r * strength)) >> 8;
    pixels[offset + 1] = ((g * inverse) + (filter.g * strength)) >> 8;
    pixels[offset + 2] = ((b * inverse) + (filter.b * strength)) >> 8;
  }
}

function interpolate(from, to, progress) {
  return Math.round(from + (to - from) * progress);
}

function positiveDuration(value) {
  return Number.isInteger(value) && value > 0 ? Math.min(value, 600_000) : 0;
}
