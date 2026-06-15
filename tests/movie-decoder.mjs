import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createCore } from "../web/core-wasm.js";
import {
  advanceScenarioMovies,
  clearScenarioMovieObject,
  createScenarioMovieState,
  setScenarioMovieObject,
  waitForScenarioMovieObjectEnd,
} from "../web/scenario-movies.js";

const wasm = await readFile(resolve("web/pkg/sakura_core.wasm"));
const fixture = new Uint8Array(
  await readFile(resolve("tests/fixtures/mpeg1-bframes.mpg")),
);
const { instance } = await WebAssembly.instantiate(wasm, {});
const core = createCore(instance.exports);
const handle = core.movieDecoderCreate(fixture);

if (handle === 0) {
  throw new Error("failed to create MPEG-1 decoder");
}

try {
  if (
    core.movieDecoderWidth(handle) !== 32
    || core.movieDecoderHeight(handle) !== 32
    || Math.abs(core.movieDecoderFrameRate(handle) - 30) > 0.001
  ) {
    throw new Error("unexpected MPEG-1 sequence header");
  }

  let frameCount = 0;
  let firstFrame = null;
  while (core.movieDecoderDecodeNext(handle)) {
    frameCount += 1;
    if (firstFrame === null) {
      firstFrame = core.movieDecoderRgba(handle)?.slice() ?? null;
    }
  }
  if (frameCount !== 12 || core.movieDecoderDecodedFrames(handle) !== 12) {
    throw new Error(`MPEG-1 B-frame decode count mismatch: ${frameCount}`);
  }
  if (
    firstFrame === null
    || firstFrame.byteLength !== 32 * 32 * 4
    || !hasVisibleRange(firstFrame)
  ) {
    throw new Error("decoded MPEG-1 RGBA frame is invalid");
  }
  if (
    !core.movieDecoderReset(handle)
    || !core.movieDecoderDecodeNext(handle)
    || core.movieDecoderDecodedFrames(handle) !== 1
  ) {
    throw new Error("MPEG-1 decoder reset failed");
  }
} finally {
  if (!core.movieDecoderDestroy(handle)) {
    throw new Error("MPEG-1 decoder destroy failed");
  }
}

{
  let decodeCalls = 0;
  let destroyCalls = 0;
  const fakeCore = {
    movieDecoderCreate: () => 1,
    movieDecoderDestroy: () => {
      destroyCalls += 1;
      return true;
    },
    movieDecoderReset: () => true,
    movieDecoderWidth: () => 2,
    movieDecoderHeight: () => 2,
    movieDecoderFrameRate: () => 30,
    movieDecoderDecodeNext: () => {
      decodeCalls += 1;
      return decodeCalls === 1;
    },
    movieDecoderRgba: () => new Uint8ClampedArray(2 * 2 * 4),
  };
  const context = {
    createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
    putImageData: () => {},
  };
  const canvasFactory = () => ({
    width: 0,
    height: 0,
    getContext: () => context,
  });
  const movies = createScenarioMovieState(fakeCore);
  const sceneObjects = {
    sceneObjects: new Map([[7, { id: 7 }]]),
    sceneObjectTransitions: new Map([[7, { id: 7 }]]),
    sceneObjectMotions: new Map([[7, { id: 7 }]]),
  };
  const image = setScenarioMovieObject(
    movies,
    7,
    new Uint8Array([0, 1, 2, 3]),
    { canvasFactory, loop: false, now: 1000 },
  );
  if (image === null) {
    throw new Error("fake movie object was not created");
  }
  let completed = false;
  const completedPromise = waitForScenarioMovieObjectEnd(movies, 7).then(() => {
    completed = true;
  });
  const active = advanceScenarioMovies(movies, sceneObjects, 1200);
  await completedPromise;
  if (
    active !== false
    || movies.objects.size !== 0
    || sceneObjects.sceneObjects.size !== 0
    || sceneObjects.sceneObjectTransitions.size !== 0
    || sceneObjects.sceneObjectMotions.size !== 0
    || destroyCalls !== 1
  ) {
    throw new Error("non-looping movie did not clean up at EOF");
  }
  if (!completed) {
    throw new Error("movie completion waiter did not resolve at EOF");
  }
}

{
  let destroyCalls = 0;
  const fakeCore = {
    movieDecoderCreate: () => 2,
    movieDecoderDestroy: () => {
      destroyCalls += 1;
      return true;
    },
    movieDecoderReset: () => true,
    movieDecoderWidth: () => 2,
    movieDecoderHeight: () => 2,
    movieDecoderFrameRate: () => 30,
    movieDecoderDecodeNext: () => true,
    movieDecoderRgba: () => new Uint8ClampedArray(2 * 2 * 4),
  };
  const canvasFactory = () => ({
    width: 0,
    height: 0,
    getContext: () => ({
      createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
      putImageData: () => {},
    }),
  });
  const movies = createScenarioMovieState(fakeCore);
  setScenarioMovieObject(movies, 3, new Uint8Array([0, 1, 2, 3]), { canvasFactory });
  let completed = false;
  const completedPromise = waitForScenarioMovieObjectEnd(movies, 3).then(() => {
    completed = true;
  });
  if (!clearScenarioMovieObject(movies, 3)) {
    throw new Error("clearScenarioMovieObject returned false for active movie");
  }
  await completedPromise;
  if (!completed || destroyCalls !== 1) {
    throw new Error("movie completion waiter did not resolve on explicit clear");
  }
}

console.log("movie_decoder_smoke=ok");

function hasVisibleRange(pixels) {
  let minimum = 255;
  let maximum = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    minimum = Math.min(minimum, pixels[index], pixels[index + 1], pixels[index + 2]);
    maximum = Math.max(maximum, pixels[index], pixels[index + 1], pixels[index + 2]);
  }
  return minimum < 32 && maximum > 192;
}
