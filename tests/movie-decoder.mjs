import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createCore } from "../web/core-wasm.js";

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
