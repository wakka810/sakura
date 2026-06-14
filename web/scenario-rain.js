const DEFAULT_RAIN = Object.freeze({
  alpha: 0.75,
  angleDeg: 90,
  density: 10,
  red: 255,
  green: 255,
  blue: 255,
  speed: 5,
});

export function createScenarioRainState() {
  return {
    active: false,
    alpha: DEFAULT_RAIN.alpha,
    angleDeg: DEFAULT_RAIN.angleDeg,
    density: DEFAULT_RAIN.density,
    fadeMs: 0,
    red: DEFAULT_RAIN.red,
    green: DEFAULT_RAIN.green,
    blue: DEFAULT_RAIN.blue,
    speed: DEFAULT_RAIN.speed,
    startedAt: 0,
  };
}

export function setScenarioRainColor(state, intArgs) {
  state.alpha = clampByte(intArgs[0] ?? 192) / 255;
  state.red = clampByte(intArgs[1] ?? DEFAULT_RAIN.red);
  state.green = clampByte(intArgs[2] ?? DEFAULT_RAIN.green);
  state.blue = clampByte(intArgs[3] ?? DEFAULT_RAIN.blue);
}

export function setScenarioRainMotion(state, intArgs) {
  state.speed = boundedInteger(intArgs[0] ?? DEFAULT_RAIN.speed, 1, 60);
  state.angleDeg = boundedInteger(intArgs[2] ?? DEFAULT_RAIN.angleDeg, -360, 360);
}

export function setScenarioRainFade(state, intArgs) {
  state.fadeMs = boundedInteger(intArgs[0] ?? 0, 0, 600_000);
}

export function setScenarioRainDensity(state, intArgs) {
  state.density = boundedInteger(intArgs[0] ?? DEFAULT_RAIN.density, 0, 100);
}

export function setScenarioRainActive(state, intArgs, now = performance.now()) {
  const active = (intArgs.at(-1) ?? 0) !== 0;
  if (active && !state.active) {
    state.startedAt = now;
  }
  state.active = active;
}

export function hasActiveScenarioRain(state) {
  return state?.active === true && state.density > 0;
}

export function paintScenarioRain(context, canvas, state, now = performance.now()) {
  if (!hasActiveScenarioRain(state)) {
    return false;
  }
  const count = Math.min(800, Math.max(0, Math.round(state.density * 24)));
  if (count === 0) {
    return false;
  }
  const elapsed = Math.max(0, now - state.startedAt);
  const angle = state.angleDeg * Math.PI / 180;
  const length = 18 + Math.min(42, state.speed * 4);
  const dx = Math.cos(angle) * length;
  const dy = Math.sin(angle) * length;
  const fall = elapsed * (0.18 + state.speed * 0.055);
  const drift = elapsed * Math.cos(angle) * 0.035;
  const alpha = Math.min(0.9, state.alpha * 0.55);
  context.save();
  context.globalAlpha *= alpha;
  context.strokeStyle = `rgb(${state.red}, ${state.green}, ${state.blue})`;
  context.lineWidth = state.speed >= 8 ? 1.25 : 1;
  context.beginPath();
  for (let index = 0; index < count; index += 1) {
    const seedA = pseudoRandom(index * 2 + 1);
    const seedB = pseudoRandom(index * 2 + 2);
    const x = modulo(seedA * (canvas.width + 240) + drift, canvas.width + 240) - 120;
    const y = modulo(seedB * (canvas.height + 240) + fall, canvas.height + 240) - 120;
    context.moveTo(x, y);
    context.lineTo(x + dx, y + dy);
  }
  context.stroke();
  context.restore();
  return true;
}

export function snapshotScenarioRain(state) {
  if (!hasActiveScenarioRain(state)) {
    return null;
  }
  return {
    active: true,
    alpha: state.alpha,
    angleDeg: state.angleDeg,
    density: state.density,
    fadeMs: state.fadeMs,
    red: state.red,
    green: state.green,
    blue: state.blue,
    speed: state.speed,
  };
}

export function restoreScenarioRain(state, snapshot, now = performance.now()) {
  Object.assign(state, createScenarioRainState());
  if (!snapshot || !isValidScenarioRainSnapshot(snapshot)) {
    return;
  }
  Object.assign(state, {
    active: snapshot.active === true,
    alpha: snapshot.alpha,
    angleDeg: snapshot.angleDeg,
    density: snapshot.density,
    fadeMs: snapshot.fadeMs,
    red: snapshot.red,
    green: snapshot.green,
    blue: snapshot.blue,
    speed: snapshot.speed,
    startedAt: now,
  });
}

export function isValidScenarioRainSnapshot(snapshot) {
  return snapshot === undefined
    || snapshot === null
    || (
      snapshot.active === true
      && Number.isFinite(snapshot.alpha)
      && snapshot.alpha >= 0
      && snapshot.alpha <= 1
      && Number.isInteger(snapshot.angleDeg)
      && snapshot.angleDeg >= -360
      && snapshot.angleDeg <= 360
      && Number.isInteger(snapshot.density)
      && snapshot.density >= 0
      && snapshot.density <= 100
      && Number.isInteger(snapshot.fadeMs)
      && snapshot.fadeMs >= 0
      && snapshot.fadeMs <= 600_000
      && Number.isInteger(snapshot.red)
      && snapshot.red >= 0
      && snapshot.red <= 255
      && Number.isInteger(snapshot.green)
      && snapshot.green >= 0
      && snapshot.green <= 255
      && Number.isInteger(snapshot.blue)
      && snapshot.blue >= 0
      && snapshot.blue <= 255
      && Number.isInteger(snapshot.speed)
      && snapshot.speed >= 1
      && snapshot.speed <= 60
    );
}

function pseudoRandom(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function modulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function clampByte(value) {
  return boundedInteger(value, 0, 255);
}

function boundedInteger(value, minimum, maximum) {
  return Number.isInteger(value) ? Math.max(minimum, Math.min(maximum, value)) : minimum;
}
