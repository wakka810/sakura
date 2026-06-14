// Default message reveal speed. The engine reads ms/char from cnfgwnd/gdb
// config (dword_5514C0); 30ms/char is the typical BGI default and matches the
// reference pacing closely. `revealMsPerChar = 0` means instant (used by
// deterministic automation so capture/test advance counts are unchanged).
export const DEFAULT_REVEAL_MS_PER_CHAR = 30;

export function createScenarioMessageVisualState() {
  return {
    event: null,
    opacity: 0,
    transition: null,
    // Typing reveal: characters appear over time at revealMsPerChar.
    revealStartedAt: 0,
    revealCharCount: 0,
    revealMsPerChar: DEFAULT_REVEAL_MS_PER_CHAR,
    revealComplete: true,
  };
}

export function showScenarioMessageVisual(state, event, options = {}) {
  const changed = state.event !== event;
  state.event = event;
  if (state.transition === null || state.transition.toOpacity === 0) {
    state.opacity = 1;
    state.transition = null;
  }
  if (changed) {
    beginScenarioMessageReveal(state, options);
  }
}

// Start (or restart) the typing reveal for the current message.
export function beginScenarioMessageReveal(state, options = {}) {
  const total = Number.isInteger(options.charCount) ? options.charCount : 0;
  const perChar = Number.isInteger(options.msPerChar)
    ? options.msPerChar
    : state.revealMsPerChar;
  state.revealCharCount = total;
  state.revealMsPerChar = perChar;
  state.revealStartedAt = options.now ?? currentTime();
  state.revealComplete = perChar <= 0 || total <= 0;
}

// Characters currently visible for the message (Infinity once complete).
export function resolvedScenarioMessageReveal(state, now = currentTime()) {
  if (state === null || state === undefined) {
    return Infinity;
  }
  if (state.revealComplete || state.revealMsPerChar <= 0) {
    return Infinity;
  }
  const elapsed = Math.max(0, now - state.revealStartedAt);
  const shown = Math.floor(elapsed / state.revealMsPerChar);
  if (shown >= state.revealCharCount) {
    return Infinity;
  }
  return shown;
}

// True while characters are still appearing.
export function isScenarioMessageRevealing(state, now = currentTime()) {
  return resolvedScenarioMessageReveal(state, now) !== Infinity;
}

// Skip the reveal so the full message is shown at once.
export function completeScenarioMessageReveal(state) {
  state.revealComplete = true;
}

export function beginScenarioMessageShow(state, durationMs, now = currentTime()) {
  return beginScenarioMessageTransition(state, durationMs, 1, now);
}

export function beginScenarioMessageHide(state, durationMs, now = currentTime()) {
  return beginScenarioMessageTransition(state, durationMs, 0, now);
}

export function finishScenarioMessageTransition(state) {
  if (state.transition === null) {
    return;
  }
  state.opacity = state.transition.toOpacity;
  state.transition = null;
  if (state.opacity === 0) {
    state.event = null;
  }
}

export function resolvedScenarioMessageVisual(state, now = currentTime()) {
  if (state === null || state === undefined) {
    return null;
  }
  if (state.transition === null) {
    if (state.opacity <= 0) {
      return null;
    }
    return {
      event: state.event,
      opacity: state.opacity,
    };
  }
  const elapsed = Math.max(0, now - state.transition.startedAt);
  const progress = Math.min(1, elapsed / state.transition.durationMs);
  return {
    event: state.event,
    opacity: state.transition.fromOpacity
      + (state.transition.toOpacity - state.transition.fromOpacity) * progress,
  };
}

function beginScenarioMessageTransition(state, durationMs, toOpacity, now) {
  const duration = normalizedDuration(durationMs);
  const resolved = resolvedScenarioMessageVisual(state, now);
  const fromOpacity = resolved?.opacity ?? 0;
  if (duration === 0 || fromOpacity === toOpacity) {
    state.opacity = toOpacity;
    state.transition = null;
    if (toOpacity === 0) {
      state.event = null;
    }
    return duration;
  }
  state.opacity = fromOpacity;
  state.transition = {
    startedAt: now,
    durationMs: duration,
    fromOpacity,
    toOpacity,
  };
  return duration;
}

export function clearScenarioMessageVisual(state) {
  if (state === null || state === undefined) {
    return;
  }
  if (state.event === null && state.opacity === 0 && state.transition === null) {
    return;
  }
  state.event = null;
  state.opacity = 0;
  state.transition = null;
}

function normalizedDuration(value) {
  return Number.isInteger(value) && value > 0 ? Math.min(value, 600_000) : 0;
}

function currentTime() {
  return globalThis.performance?.now() ?? Date.now();
}
