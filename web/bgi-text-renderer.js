const MASK_ALPHA_THRESHOLD = 64;
const TEXT_CACHE_LIMIT = 4096;
const textMaskCache = new Map();

export function drawBgiText(context, text, x, y) {
  const rendered = renderBgiTextMask(context, text);
  if (!rendered) {
    context.fillText(text, x, y);
    return;
  }
  context.drawImage(rendered.canvas, x - rendered.pad, y - rendered.pad);
}

function renderBgiTextMask(context, text) {
  if (
    typeof document === "undefined"
    || typeof document.createElement !== "function"
    || typeof ImageData === "undefined"
    || typeof context?.measureText !== "function"
  ) {
    return null;
  }
  const font = String(context.font ?? "");
  const fillStyle = String(context.fillStyle ?? "#000");
  const baseline = String(context.textBaseline ?? "alphabetic");
  const key = `${font}\n${fillStyle}\n${baseline}\n${text}`;
  const cached = textMaskCache.get(key);
  if (cached) {
    textMaskCache.delete(key);
    textMaskCache.set(key, cached);
    return cached;
  }
  const scratch = document.createElement("canvas");
  const scratchContext = scratch.getContext?.("2d", { alpha: true });
  if (
    !scratchContext
    || typeof scratchContext.getImageData !== "function"
    || typeof scratchContext.putImageData !== "function"
  ) {
    return null;
  }
  scratchContext.font = font;
  scratchContext.textBaseline = baseline;
  const metrics = scratchContext.measureText(text);
  const fontPx = fontPixelSize(font);
  const width = Math.max(1, Math.ceil(metrics.width + fontPx));
  const height = Math.max(1, Math.ceil(fontPx * 1.8));
  const pad = Math.max(2, Math.ceil(fontPx * 0.25));
  scratch.width = width + pad * 2;
  scratch.height = height + pad * 2;
  scratchContext.font = font;
  scratchContext.textBaseline = baseline;
  scratchContext.fillStyle = fillStyle;
  scratchContext.fillText(text, pad, pad);
  const image = scratchContext.getImageData(0, 0, scratch.width, scratch.height);
  const data = image.data;
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset + 3] = data[offset + 3] > MASK_ALPHA_THRESHOLD ? 255 : 0;
  }
  scratchContext.putImageData(image, 0, 0);
  const rendered = { canvas: scratch, pad };
  textMaskCache.set(key, rendered);
  if (textMaskCache.size > TEXT_CACHE_LIMIT) {
    textMaskCache.delete(textMaskCache.keys().next().value);
  }
  return rendered;
}

function fontPixelSize(font) {
  const match = String(font).match(/(\d+(?:\.\d+)?)px/);
  const px = match ? Number(match[1]) : 24;
  return Number.isFinite(px) && px > 0 ? px : 24;
}
