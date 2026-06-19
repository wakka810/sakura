#!/usr/bin/env node
import fs from 'node:fs';

const tracePath = process.argv[2] ?? 'サクラノ詩/dump/trace_hover_help.jsonl';
const showAll = process.argv.includes('--all');
const decoder = new TextDecoder('shift_jis', { fatal: false });

const relevantPattern =
  /[\u3040-\u30ff\u3400-\u9fff]|Auto|Skip|Log|Save|Load|Q\.?Save|Q\.?Load|System|Voice|Hide|auto|skip|save|load|voice|system/i;

function decodeHex(hex) {
  if (!hex || hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return decoder.decode(bytes).replace(/\0+$/g, '');
}

function addText(map, ev, text, raw, meta) {
  const variants = [];
  if (typeof text === 'string' && text.length > 0) variants.push(text);
  const decoded = decodeHex(raw);
  if (decoded && decoded !== text) variants.push(decoded);
  for (const value of variants) {
    if (!showAll && !relevantPattern.test(value)) continue;
    const key = `${ev}\t${value}`;
    const entry = map.get(key) ?? {
      ev,
      text: value,
      count: 0,
      sample: meta,
      raw,
    };
    entry.count += 1;
    if (!entry.sample && meta) entry.sample = meta;
    map.set(key, entry);
  }
}

const rows = new Map();
const lines = fs.readFileSync(tracePath, 'utf8').split(/\r?\n/);
let parsed = 0;
let bad = 0;

for (const line of lines) {
  if (!line.trim()) continue;
  const jsonStart = line.indexOf('{');
  if (jsonStart < 0) {
    bad += 1;
    continue;
  }
  let event;
  try {
    event = JSON.parse(line.slice(jsonStart));
    parsed += 1;
  } catch (_) {
    bad += 1;
    continue;
  }
  if (!['render_text', 'api_text', 'vm_string', 'load_string', 'convert_text', 'layout_text', 'layout_segment'].includes(event.ev)) continue;
  const meta = {
    ev: event.ev,
    api: event.api ?? event.fn ?? null,
    x: event.x ?? null,
    y: event.y ?? null,
    cur: event.cur ?? null,
  };
  addText(rows, event.ev, event.text, event.raw, meta);
  addText(rows, event.ev, event.text2, event.raw2, meta);
  addText(rows, event.ev, event.srcText, event.raw, meta);
  addText(rows, event.ev, event.dstText, event.raw, meta);
}

const out = [...rows.values()].sort((a, b) => b.count - a.count || a.ev.localeCompare(b.ev) || a.text.localeCompare(b.text));
for (const row of out) {
  const where = row.sample ? ` ${JSON.stringify(row.sample)}` : '';
  console.log(`${String(row.count).padStart(5)} ${row.ev} ${JSON.stringify(row.text)}${where}`);
}

console.error(`parsed=${parsed} bad=${bad} shown=${out.length} path=${tracePath}`);
