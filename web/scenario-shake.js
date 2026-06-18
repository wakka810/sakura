const PRESET_STRENGTH = Object.freeze([100, 200, 300, 400]);
const PRESET_PERIOD_MS = Object.freeze([20, 20, 20, 60]);
const PRESET_CYCLES = Object.freeze([12, 12, 12, 28]);
const PRESET_DECAY_PERCENT = Object.freeze([30, 30, 30, 12]);
const DIRECTION_DEGREES = Object.freeze([0, 45, 90, 135, 90]);
const ENGINE_REFRESH_RATE = 62;
const SHAKE_AXIS_X = Object.freeze([0, 1, 1, 0]);
const SHAKE_AXIS_Y = Object.freeze([1, 0, 1, 0]);

export function createPresetScenarioShake(direction, strengthIndex, startedAt) {
  const preset = clampInteger(strengthIndex, 0, PRESET_STRENGTH.length - 1);
  const directionIndex = clampInteger(direction, 0, DIRECTION_DEGREES.length - 1);
  const engineStrength = PRESET_STRENGTH[preset];
  const periodMs = PRESET_PERIOD_MS[preset];
  const cycles = PRESET_CYCLES[preset];
  const decayPercent = PRESET_DECAY_PERCENT[preset];
  const radians = DIRECTION_DEGREES[directionIndex] * Math.PI / 180;
  return {
    kind: "preset",
    startedAt,
    durationMs: periodMs * cycles,
    direction: directionIndex,
    strengthIndex: preset,
    engineStrength,
    periodMs,
    cycles,
    decayPercent,
    amplitude: engineStrength * ENGINE_REFRESH_RATE / 1000,
    vectorX: Math.cos(radians),
    vectorY: Math.sin(radians),
  };
}

export function createScenarioScreenShake(intArgs, startedAt) {
  const mode = clampInteger(intArgs[0] ?? 0, 0, 3);
  const engineAmplitude = Math.max(0, Math.abs(intArgs[1] ?? 0));
  const cycles = Math.max(1, Math.abs(intArgs[2] ?? 1));
  const decayPercent = clampInteger(intArgs[3] ?? 0, 0, 100);
  const durationMs = positiveDuration(intArgs.at(-1)) || 240;
  return {
    kind: "screen",
    startedAt,
    durationMs,
    mode,
    cycles,
    decayPercent,
    peakPixels: Math.max(1, Math.round(engineAmplitude / 2)),
  };
}

export function scenarioShakeOffset(shake, now) {
  if (!shake) {
    return { x: 0, y: 0, active: false };
  }
  const elapsed = now - shake.startedAt;
  if (elapsed < 0 || elapsed >= shake.durationMs) {
    return { x: 0, y: 0, active: false };
  }
  if (shake.kind === "screen") {
    const cycle = Math.min(
      shake.cycles - 1,
      Math.floor((elapsed * shake.cycles) / shake.durationMs),
    );
    const cycleProgress = ((elapsed * shake.cycles) / shake.durationMs) - cycle;
    const triangular = cycleProgress < 0.5
      ? cycleProgress * 4 - 1
      : 3 - cycleProgress * 4;
    const attenuation = Math.pow(1 - shake.decayPercent / 100, cycle);
    const displacement = Math.round(triangular * shake.peakPixels * attenuation);
    return {
      x: SHAKE_AXIS_X[shake.mode] ? displacement : 0,
      y: SHAKE_AXIS_Y[shake.mode] ? displacement : 0,
      active: true,
    };
  }

  const cycle = elapsed / shake.periodMs;
  const attenuation = Math.pow(1 - shake.decayPercent / 100, Math.floor(cycle));
  const displacement = Math.cos(cycle * Math.PI * 2) * shake.amplitude * attenuation;
  return {
    x: Math.round(displacement * shake.vectorX),
    y: Math.round(displacement * shake.vectorY),
    active: true,
  };
}

function clampInteger(value, minimum, maximum) {
  if (!Number.isInteger(value)) {
    return minimum;
  }
  return Math.max(minimum, Math.min(value, maximum));
}

function positiveDuration(value) {
  return Number.isInteger(value) && value > 0 ? Math.min(value, 600_000) : 0;
}
