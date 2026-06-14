const transitionMaskCache = new WeakMap();
const alphaMaskCache = new WeakMap();
const maskedImageCache = new WeakMap();
const DEFAULT_EDGE_WIDTH = 16;

export function paintMappedTransition(
  context,
  source,
  mapImage,
  progress,
  {
    alpha = 1,
    cacheKey = mapImage,
    height = source.height,
    width = source.width,
    x = 0,
    y = 0,
  } = {},
) {
  if (!source || !mapImage || progress <= 0 || alpha <= 0) {
    return;
  }
  if (progress >= 1) {
    context.save();
    context.globalAlpha = clampUnit(alpha);
    context.drawImage(source, x, y, width, height);
    context.restore();
    return;
  }

  const scratch = mappedTransitionCanvas(cacheKey, source, mapImage, progress);
  context.save();
  context.globalAlpha = clampUnit(alpha);
  context.drawImage(scratch, x, y, width, height);
  context.restore();
}

export function mappedTransitionAlpha(mapValue, progress, edgeWidth = DEFAULT_EDGE_WIDTH) {
  const normalizedProgress = clampUnit(progress);
  if (normalizedProgress <= 0) {
    return 0;
  }
  if (normalizedProgress >= 1) {
    return 255;
  }
  const edge = Math.max(1, Math.min(128, edgeWidth));
  const threshold = normalizedProgress * (255 + edge * 2) - edge;
  return Math.round(clampUnit((threshold - mapValue + edge) / (edge * 2)) * 255);
}

export function paintAlphaMappedImage(
  context,
  source,
  mapImage,
  {
    alpha = 1,
    cacheKey = source,
    height = source.height,
    width = source.width,
    x = 0,
    y = 0,
  } = {},
) {
  if (!source || !mapImage || alpha <= 0) {
    return;
  }
  const masked = maskedImageCanvas(cacheKey, source, mapImage);
  context.save();
  context.globalAlpha = clampUnit(alpha);
  context.drawImage(masked, x, y, width, height);
  context.restore();
}

function mappedTransitionCanvas(cacheKey, source, mapImage, progress) {
  let cached = transitionMaskCache.get(cacheKey);
  if (
    !cached
    || cached.width !== source.width
    || cached.height !== source.height
    || cached.mapImage !== mapImage
  ) {
    cached = createTransitionCache(source, mapImage);
    transitionMaskCache.set(cacheKey, cached);
  }

  const progressStep = Math.max(1, Math.min(255, Math.round(progress * 255)));
  if (cached.progressStep !== progressStep) {
    updateMaskAlpha(cached, progressStep / 255);
    cached.maskContext.putImageData(cached.maskData, 0, 0);
    cached.progressStep = progressStep;
  }

  cached.context.clearRect(0, 0, cached.width, cached.height);
  cached.context.globalCompositeOperation = "source-over";
  cached.context.drawImage(source, 0, 0);
  cached.context.globalCompositeOperation = "destination-in";
  cached.context.drawImage(
    cached.maskCanvas,
    0,
    0,
    cached.mapImage.width,
    cached.mapImage.height,
    0,
    0,
    cached.width,
    cached.height,
  );
  cached.context.globalCompositeOperation = "source-over";
  return cached.canvas;
}

function maskedImageCanvas(cacheKey, source, mapImage) {
  let cached = maskedImageCache.get(cacheKey);
  if (
    !cached
    || cached.width !== source.width
    || cached.height !== source.height
    || cached.mapImage !== mapImage
  ) {
    cached = createMaskedImageCache(source, mapImage);
    maskedImageCache.set(cacheKey, cached);
  }
  cached.context.clearRect(0, 0, cached.width, cached.height);
  cached.context.globalCompositeOperation = "source-over";
  cached.context.drawImage(source, 0, 0);
  cached.context.globalCompositeOperation = "destination-in";
  cached.context.drawImage(
    alphaMaskCanvas(mapImage),
    0,
    0,
    mapImage.width,
    mapImage.height,
    0,
    0,
    cached.width,
    cached.height,
  );
  cached.context.globalCompositeOperation = "source-over";
  return cached.canvas;
}

function createMaskedImageCache(source, mapImage) {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  return {
    canvas,
    context: canvas.getContext("2d", { alpha: true }),
    height: source.height,
    mapImage,
    width: source.width,
  };
}

function alphaMaskCanvas(mapImage) {
  let cached = alphaMaskCache.get(mapImage);
  if (
    cached
    && cached.width === mapImage.width
    && cached.height === mapImage.height
  ) {
    return cached.canvas;
  }
  const canvas = document.createElement("canvas");
  canvas.width = mapImage.width;
  canvas.height = mapImage.height;
  const context = canvas.getContext("2d", { alpha: true });
  const data = context.createImageData(mapImage.width, mapImage.height);
  const pixels = mapImage.pixels;
  for (let sourceOffset = 0, targetOffset = 0;
    sourceOffset < pixels.length;
    sourceOffset += 4, targetOffset += 4) {
    data.data[targetOffset] = 255;
    data.data[targetOffset + 1] = 255;
    data.data[targetOffset + 2] = 255;
    data.data[targetOffset + 3] = pixels[sourceOffset];
  }
  context.putImageData(data, 0, 0);
  cached = { canvas, height: mapImage.height, width: mapImage.width };
  alphaMaskCache.set(mapImage, cached);
  return canvas;
}

function createTransitionCache(source, mapImage) {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = mapImage.width;
  maskCanvas.height = mapImage.height;
  const maskContext = maskCanvas.getContext("2d", { alpha: true });
  const maskData = maskContext.createImageData(mapImage.width, mapImage.height);
  for (let offset = 0; offset < maskData.data.length; offset += 4) {
    maskData.data[offset] = 255;
    maskData.data[offset + 1] = 255;
    maskData.data[offset + 2] = 255;
  }
  return {
    canvas,
    context: canvas.getContext("2d", { alpha: true }),
    height: source.height,
    mapImage,
    maskCanvas,
    maskContext,
    maskData,
    progressStep: -1,
    width: source.width,
  };
}

function updateMaskAlpha(cached, progress) {
  const mapPixels = cached.mapImage.pixels;
  const maskPixels = cached.maskData.data;
  for (let sourceOffset = 0, targetOffset = 3;
    sourceOffset < mapPixels.length;
    sourceOffset += 4, targetOffset += 4) {
    maskPixels[targetOffset] = mappedTransitionAlpha(mapPixels[sourceOffset], progress);
  }
}

function clampUnit(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
