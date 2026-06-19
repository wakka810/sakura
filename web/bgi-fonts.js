export const BGI_GOTHIC_FAMILY = "'Sakura MS Gothic', 'MS Gothic', 'Noto Sans CJK JP', sans-serif";
// Exact MS Mincho is exposed as "Sakura MS Mincho" by the local server when a
// licensed font file is present. Use the served face name instead of depending
// on host font aliases, which can drift between Linux installations.
export const BGI_MINCHO_FAMILY = "'Sakura MS Mincho', 'Noto Serif CJK JP', serif";
export const BGI_FONT_GOTHIC = 0;
export const BGI_FONT_MINCHO = 1;

export function bgiGothicFont(sizePx, weight = "") {
  return `${fontWeightPrefix(weight)}${Math.trunc(sizePx)}px ${BGI_GOTHIC_FAMILY}`;
}

export function bgiMinchoFont(sizePx, weight = "") {
  return `${fontWeightPrefix(weight)}${Math.trunc(sizePx)}px ${BGI_MINCHO_FAMILY}`;
}

export function bgiFontByNumber(fontNumber, sizePx, weight = "") {
  return fontNumber === BGI_FONT_MINCHO
    ? bgiMinchoFont(sizePx, weight)
    : bgiGothicFont(sizePx, weight);
}

function fontWeightPrefix(weight) {
  if (weight === 1 || weight === true || weight === "bold") {
    return "bold ";
  }
  if (typeof weight === "string" && weight.length > 0) {
    return `${weight} `;
  }
  return "";
}
