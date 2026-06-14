const DEFAULT_FRAME_RATE = 30;
const MAX_MOVIE_BYTES = 32 * 1024 * 1024;
const MAX_CATCH_UP_FRAMES = 240;

export function createScenarioMovieState(core) {
  return { core, objects: new Map() };
}

export function setScenarioMovieObject(
  state,
  id,
  payload,
  {
    canvasFactory = defaultCanvasFactory,
    elapsedMs = 0,
    now = performance.now(),
  } = {},
) {
  if (
    !(payload instanceof Uint8Array)
    || payload.byteLength === 0
    || payload.byteLength > MAX_MOVIE_BYTES
  ) {
    return null;
  }
  const movie = {
    id: boundedId(id),
    canvas: canvasFactory(),
    decoderHandle: 0,
    frameRate: DEFAULT_FRAME_RATE,
    decodedFrames: 0,
    startedAt: now - boundedElapsed(elapsedMs),
  };
  if (!initializeDecoder(state, movie, payload)) {
    return null;
  }
  state.objects.set(movie.id, movie);
  return {
    width: movie.canvas.width,
    height: movie.canvas.height,
    canvas: movie.canvas,
  };
}

export function clearScenarioMovieObject(state, id) {
  const key = boundedId(id);
  const movie = state.objects.get(key);
  if (!movie) {
    return false;
  }
  state.core.movieDecoderDestroy(movie.decoderHandle);
  state.objects.delete(key);
  return true;
}

export function clearScenarioMovies(state) {
  for (const id of [...state.objects.keys()]) {
    clearScenarioMovieObject(state, id);
  }
}

export function advanceScenarioMovies(
  state,
  sceneObjectState,
  now = performance.now(),
) {
  let active = false;
  for (const [id, movie] of [...state.objects]) {
    if (!sceneObjectState.sceneObjects.has(id)) {
      clearScenarioMovieObject(state, id);
      continue;
    }
    active = true;
    const targetFrames = Math.floor(
      Math.max(0, now - movie.startedAt) * movie.frameRate / 1000,
    ) + 1;
    let remaining = Math.min(
      Math.max(0, targetFrames - movie.decodedFrames),
      MAX_CATCH_UP_FRAMES,
    );
    let resets = 0;
    let frameChanged = false;
    while (remaining > 0) {
      if (state.core.movieDecoderDecodeNext(movie.decoderHandle)) {
        movie.decodedFrames += 1;
        remaining -= 1;
        frameChanged = true;
      } else if (resets >= 1 || !resetDecoder(state, movie)) {
        clearScenarioMovieObject(state, id);
        active = false;
        break;
      } else {
        resets += 1;
      }
    }
    if (frameChanged && !renderCurrentFrame(state, movie)) {
      clearScenarioMovieObject(state, id);
      active = false;
    }
  }
  return active;
}

export function hasActiveScenarioMovies(state, sceneObjectState) {
  for (const id of state.objects.keys()) {
    if (sceneObjectState.sceneObjects.has(id)) {
      return true;
    }
  }
  return false;
}

export function scenarioMovieElapsedMs(state, id, now = performance.now()) {
  const movie = state.objects.get(boundedId(id));
  return movie ? boundedElapsed(now - movie.startedAt) : 0;
}

function resetDecoder(state, movie) {
  if (movie.decoderHandle === 0) {
    return false;
  }
  if (!state.core.movieDecoderReset(movie.decoderHandle)) {
    return false;
  }
  return true;
}

function initializeDecoder(state, movie, payload) {
  const handle = state.core.movieDecoderCreate(payload);
  if (handle === 0) {
    return false;
  }
  const width = state.core.movieDecoderWidth(handle);
  const height = state.core.movieDecoderHeight(handle);
  const frameRate = state.core.movieDecoderFrameRate(handle);
  if (
    width <= 0
    || height <= 0
    || !Number.isFinite(frameRate)
    || frameRate <= 0
  ) {
    state.core.movieDecoderDestroy(handle);
    return false;
  }
  movie.decoderHandle = handle;
  movie.canvas.width = width;
  movie.canvas.height = height;
  movie.frameRate = frameRate;
  return true;
}

function renderCurrentFrame(state, movie) {
  const pixels = state.core.movieDecoderRgba(movie.decoderHandle);
  if (!(pixels instanceof Uint8ClampedArray)) {
    return false;
  }
  const context = movie.canvas.getContext("2d");
  if (!context) {
    return false;
  }
  const image = typeof ImageData === "function"
    ? new ImageData(pixels, movie.canvas.width, movie.canvas.height)
    : context.createImageData(movie.canvas.width, movie.canvas.height);
  if (image.data !== pixels) {
    image.data.set(pixels);
  }
  context.putImageData(image, 0, 0);
  return true;
}

function defaultCanvasFactory() {
  return document.createElement("canvas");
}

function boundedId(value) {
  return Number.isInteger(value) ? Math.max(0, Math.min(value, 255)) : 0;
}

function boundedElapsed(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(value, 600_000)) : 0;
}
