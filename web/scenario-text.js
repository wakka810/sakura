// Parses BGI/Ethornell inline message tags and renders ruby (furigana).
//
// Ground truth: the engine's message formatter (BGI.exe sub at ~0x460000) scans
// for `<` (0x3C) … `>` (0x3E) tag spans and matches a fixed tag table:
//   ruby, r, /r, cr, c, /c, l, /l, t  (plus b/i style tags).
// The shipped scenario text uses ruby as `<r READING>BASE</r>`, e.g.
// `<r うすくれない>薄紅</r>` renders the small kana READING above BASE.
// Other tags (`<i>`, `<l>`, `<b>`, `<c …>`) wrap content we keep but do not
// style yet. `<t>` and `<cr>` are spacing/forced-break controls.

const RUBY_SCALE = 0.5;
const RUBY_GAP = 2;

// Tokenize a raw message string into a flat list of segments:
//   { type: "text", text }              plain run
//   { type: "ruby", base, reading }     a furigana unit
// Unknown/style tags are unwrapped (their text content is preserved).
export function parseScenarioText(raw) {
  const segments = [];
  let plain = "";
  const flushPlain = () => {
    if (plain.length > 0) {
      segments.push({ type: "text", text: plain });
      plain = "";
    }
  };
  let i = 0;
  const n = raw.length;
  while (i < n) {
    const ch = raw[i];
    if (ch !== "<") {
      plain += ch;
      i += 1;
      continue;
    }
    const close = raw.indexOf(">", i + 1);
    if (close < 0) {
      // Unterminated tag — treat the rest literally.
      plain += raw.slice(i);
      break;
    }
    const body = raw.slice(i + 1, close);
    const space = body.indexOf(" ");
    const name = (space < 0 ? body : body.slice(0, space)).toLowerCase();
    if (name === "r") {
      const reading = space < 0 ? "" : body.slice(space + 1);
      const end = raw.indexOf("</r>", close + 1);
      if (end < 0) {
        // Malformed ruby — keep the inner text only.
        i = close + 1;
        continue;
      }
      const base = raw.slice(close + 1, end);
      flushPlain();
      segments.push({ type: "ruby", base, reading });
      i = end + 4;
      continue;
    }
    if (name === "cr" || name === "t") {
      // Forced break / tab-stop spacing controls — render as a newline.
      plain += "\n";
      i = close + 1;
      continue;
    }
    // Any other tag (ruby alias, c/l/b/i and their closers): drop the marker,
    // keep surrounding text. Closing tags like `/c` have name starting with "/".
    i = close + 1;
  }
  flushPlain();
  return segments;
}

// Measure the advance width of one segment at the context's current font.
function segmentWidth(context, seg) {
  if (seg.type === "ruby") {
    const baseW = context.measureText(seg.base).width;
    const readW = rubyReadingWidth(context, seg.reading);
    return Math.max(baseW, readW);
  }
  return context.measureText(seg.text).width;
}

function rubyReadingWidth(context, reading) {
  const font = context.font;
  context.font = scaledFont(font, RUBY_SCALE);
  const w = context.measureText(reading).width;
  context.font = font;
  return w;
}

function scaledFont(font, scale) {
  // font is like "29px 'Noto Serif CJK JP', …" — scale the leading px size.
  return font.replace(/(\d+(?:\.\d+)?)px/, (_, px) =>
    `${Math.max(1, Math.round(Number(px) * scale))}px`);
}

// Expand a raw string into atomic layout units: single chars for plain text,
// whole ruby units (which must not be split across lines).
function layoutUnits(raw) {
  const units = [];
  for (const seg of parseScenarioText(raw)) {
    if (seg.type === "ruby") {
      units.push(seg);
    } else {
      for (const chunk of seg.text) {
        units.push({ type: "char", text: chunk });
      }
    }
  }
  return units;
}

// How many characters one unit contributes to the reveal counter. A ruby unit
// reveals over the length of its base text (the reading appears with the base).
function unitCharCount(u) {
  if (u.type === "ruby") {
    return Math.max(1, Array.from(u.base).length);
  }
  return u.text === "\n" ? 0 : 1;
}

// Total revealable character count of a message (for typing-reveal timing).
export function countScenarioTextChars(raw) {
  let total = 0;
  for (const u of layoutUnits(raw)) {
    total += unitCharCount(u);
  }
  return total;
}

// Draw rich message text with ruby and word wrapping. Mirrors drawWrappedText:
// breaks on width, honors `\n`, caps at maxLines. `x,y` is the top-left of the
// first line baseline-top; ruby is drawn above each base run. `maxChars` limits
// how many leading characters are revealed (for the typing animation); the line
// layout is always computed from the full text so it never reflows mid-reveal.
export function drawScenarioRichText(
  context,
  raw,
  x,
  y,
  maxWidth,
  lineHeight,
  maxLines,
  maxChars = Infinity,
) {
  const units = layoutUnits(raw);
  const baseFont = context.font;

  // Wrap into lines first (using full unit widths) so the reveal does not reflow.
  const wrapped = [];
  let line = [];
  let lineWidth = 0;
  for (const u of units) {
    if (u.type === "char" && u.text === "\n") {
      wrapped.push(line);
      line = [];
      lineWidth = 0;
      if (wrapped.length >= maxLines) break;
      continue;
    }
    const w = segmentWidth(context, u);
    if (lineWidth + w > maxWidth && line.length > 0) {
      wrapped.push(line);
      line = [u];
      lineWidth = w;
      if (wrapped.length >= maxLines) break;
    } else {
      line.push(u);
      lineWidth += w;
    }
  }
  if (line.length > 0 && wrapped.length < maxLines) {
    wrapped.push(line);
  }

  let revealed = 0;
  for (let li = 0; li < wrapped.length && li < maxLines; li += 1) {
    const lineY = y + li * lineHeight;
    let penX = x;
    for (const u of wrapped[li]) {
      const cost = unitCharCount(u);
      if (u.type === "ruby") {
        const baseW = context.measureText(u.base).width;
        const readW = rubyReadingWidth(context, u.reading);
        const cell = Math.max(baseW, readW);
        if (revealed < maxChars) {
          const baseChars = Array.from(u.base);
          const visN = Math.min(baseChars.length, Math.max(0, maxChars - revealed));
          const visBase = baseChars.slice(0, visN).join("");
          context.fillText(visBase, penX + (cell - baseW) / 2, lineY);
          if (u.reading && visN >= baseChars.length) {
            context.font = scaledFont(baseFont, RUBY_SCALE);
            const rsize = rubyFontPx(baseFont);
            context.fillText(
              u.reading,
              penX + (cell - readW) / 2,
              lineY - rsize - RUBY_GAP,
            );
            context.font = baseFont;
          }
        }
        penX += cell;
      } else if (revealed < maxChars) {
        context.fillText(u.text, penX, lineY);
        penX += context.measureText(u.text).width;
      }
      revealed += cost;
      if (revealed >= maxChars && Number.isFinite(maxChars)) {
        context.font = baseFont;
        // Continue laying out remaining lines? No — once budget is spent, stop.
        return;
      }
    }
  }
  context.font = baseFont;
}

function rubyFontPx(font) {
  const m = font.match(/(\d+(?:\.\d+)?)px/);
  const px = m ? Number(m[1]) : 24;
  return Math.max(1, Math.round(px * RUBY_SCALE));
}

// Strip all inline tags to plain base text (for backlog/voice-association use).
export function stripScenarioTags(raw) {
  return parseScenarioText(raw)
    .map((seg) => (seg.type === "ruby" ? seg.base : seg.text))
    .join("");
}
