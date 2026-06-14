const PRESET_STRENGTH = Object.freeze([100, 200, 300, 400]);
const PRESET_PERIOD_MS = Object.freeze([20, 20, 20, 60]);
const PRESET_CYCLES = Object.freeze([12, 12, 12, 28]);
const PRESET_DECAY_PERCENT = Object.freeze([30, 30, 30, 12]);
const DIRECTION_DEGREES = Object.freeze([0, 45, 90, 135, 90]);
const ENGINE_REFRESH_RATE = 62;

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

export function scenarioShakeOffset(shake, now) {
  if (!shake) {
    return { x: 0, y: 0, active: false };
  }
  const elapsed = now - shake.startedAt;
  if (elapsed < 0 || elapsed >= shake.durationMs) {
    return { x: 0, y: 0, active: false };
  }
  if (shake.kind !== "preset") {
    const decay = 1 - elapsed / shake.durationMs;
    const t = elapsed / 16.6667;
    return {
      x: Math.round(Math.sin(t * 2.17 + shake.phase) * shake.amplitudeX * decay),
      y: Math.round(Math.cos(t * 2.63 + shake.phase) * shake.amplitudeY * decay),
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
