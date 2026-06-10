import { inspectGraphQueue, renderGraphQueue, summarizeGraphQueue } from "../web/graph-renderer.js";

const empty = summarizeGraphQueue(null);
if (
  empty.ready ||
  empty.commandCount !== 0 ||
  empty.priorityCommandCount !== 0 ||
  empty.firstServiceId !== 0 ||
  empty.serviceIds !== ""
) {
  throw new Error(`unexpected empty graph render state ${JSON.stringify(empty)}`);
}

const state = summarizeGraphQueue({
  ready: true,
  events: [
    { serviceId: 0x68, argCount: 0, instructionOffset: 0x16b },
    { serviceId: 0x64, argCount: 1, instructionOffset: 0x1ad, args: [{ kind: 1, value: 3, len: 0, hash: 0 }] },
    { serviceId: 0x6e, argCount: 1, instructionOffset: 0xb97, args: [{ kind: 2, value: 0, len: 12, hash: 0x1234 }] },
    { serviceId: 0x80, argCount: 2, instructionOffset: 0x150, args: [{ kind: 1, value: 1280, len: 0, hash: 0 }, { kind: 1, value: 720, len: 0, hash: 0 }] },
    { serviceId: 0xba, argCount: 2, instructionOffset: 0x340, args: [{ kind: 1, value: 2, len: 0, hash: 0 }, { kind: 6, value: 0x200, len: 0, hash: 0 }] },
  ],
});

if (
  !state.ready ||
  state.commandCount !== 5 ||
  state.priorityCommandCount !== 3 ||
  state.outputEventCount !== 1 ||
  state.surfaceWidth !== 1280 ||
  state.surfaceHeight !== 720 ||
  state.stageWidth !== 1280 ||
  state.stageHeight !== 720 ||
  state.windowCount !== 0 ||
  state.polygonCount !== 0 ||
  state.firstServiceId !== 0x68 ||
  state.firstArgCount !== 0 ||
  state.firstOffset !== 0x16b ||
  state.serviceIds !== "104,100,110,128,186" ||
  state.offsets !== "363,429,2967,336,832" ||
  state.argCounts !== "0,1,1,2,2" ||
  state.argKinds !== "0,1,2,1,1" ||
  state.argValues !== "0,3,0,1280,2" ||
  state.argLengths !== "0,0,12,0,0" ||
  state.argHashes !== "0,0,4660,0,0" ||
  state.priorityServiceIds !== "100,128,186"
) {
  throw new Error(`unexpected graph render state ${JSON.stringify(state)}`);
}

const calls = [];
const context = {
  beginPath: () => calls.push(["beginPath"]),
  clip: () => calls.push(["clip"]),
  closePath: () => calls.push(["closePath"]),
  fill: () => calls.push(["fill"]),
  fillStyle: "",
  lineWidth: 0,
  lineTo: (...args) => calls.push(["lineTo", ...args]),
  moveTo: (...args) => calls.push(["moveTo", ...args]),
  rect: (...args) => calls.push(["rect", ...args]),
  stroke: () => calls.push(["stroke"]),
  strokeStyle: "",
  fillRect: (...args) => calls.push(["fillRect", ...args]),
  restore: () => calls.push(["restore"]),
  save: () => calls.push(["save"]),
  strokeRect: (...args) => calls.push(["strokeRect", ...args]),
};
const rendered = renderGraphQueue(context, { width: 1280, height: 720 }, {
  ready: true,
  events: [
    {
      serviceId: 0x10,
      eventIndex: 1,
      instructionOffset: 0x08,
      argCount: 3,
      args: [{ kind: 1, value: 0xfd00 }],
      inlineStrings: [
        { argIndex: 1, text: "sysgrp.arc" },
        { argIndex: 2, text: "SGMsgWnd000000" },
      ],
    },
    { serviceId: 0x80, eventIndex: 2, instructionOffset: 0x10, args: [{ kind: 1, value: 1280 }, { kind: 1, value: 720 }] },
    { serviceId: 0x60, eventIndex: 3, instructionOffset: 0x11, args: [] },
    { serviceId: 0x65, eventIndex: 4, instructionOffset: 0x12, args: [{ kind: 1, value: 1 }, { kind: 1, value: 0 }, { kind: 1, value: 256 }, { kind: 1, value: 0xfd00 }] },
    { serviceId: 0x88, eventIndex: 5, instructionOffset: 0x20, args: [{ kind: 1, value: 1 }, { kind: 1, value: 0 }, { kind: 1, value: 0 }, { kind: 1, value: 1280 }, { kind: 1, value: 720 }] },
    { serviceId: 0xbf, eventIndex: 3, instructionOffset: 0x30, args: [{ kind: 6, value: 0x200 }] },
  ],
}, {
  catalog: {
    async readPayloadByArchiveAndNameBytes(archive, entry) {
      if (
        new TextDecoder("ascii").decode(archive) === "sysgrp.arc"
        && new TextDecoder("ascii").decode(entry) === "SGMsgWnd000000"
      ) {
        return new Uint8Array([1, 2, 3]);
      }
      return null;
    },
    async readPayloadByNameBytes() {
      return null;
    },
  },
  core: {
    cbgRgba(payload) {
      if (payload.length !== 3) {
        throw new Error("unexpected payload lookup");
      }
      return {
        width: 2,
        height: 2,
        stride: 8,
        pixels: new Uint8Array([
          255, 255, 255, 255,
          255, 255, 255, 255,
          255, 255, 255, 255,
          255, 255, 255, 255,
        ]),
      };
    },
  },
  requestPaint() {},
});
if (
  !rendered.applied ||
  rendered.priorityEvents.length !== 6 ||
  rendered.outputEvents.length !== 1 ||
  rendered.surfaceWidth !== 1280 ||
  rendered.surfaceHeight !== 720 ||
  rendered.windows.length !== 1 ||
  rendered.layers.length < 2 ||
  rendered.resolvedImageCount !== 0 ||
  rendered.drawnImageCount !== 0 ||
  calls.filter((call) => call[0] === "save").length !== 1 ||
  calls.filter((call) => call[0] === "clip").length !== 1 ||
  calls.filter((call) => call[0] === "fillRect").length < 1 ||
  calls.some((call) => call[0] === "strokeRect")
) {
  throw new Error(`unexpected graph render draw state ${JSON.stringify({ rendered, calls })}`);
}

const windowCalls = [];
const windowContext = {
  beginPath: () => windowCalls.push(["beginPath"]),
  clip: () => windowCalls.push(["clip"]),
  closePath: () => windowCalls.push(["closePath"]),
  fill: () => windowCalls.push(["fill"]),
  fillStyle: "",
  lineWidth: 0,
  lineTo: (...args) => windowCalls.push(["lineTo", ...args]),
  moveTo: (...args) => windowCalls.push(["moveTo", ...args]),
  rect: (...args) => windowCalls.push(["rect", ...args]),
  stroke: () => windowCalls.push(["stroke"]),
  strokeStyle: "",
  fillRect: (...args) => windowCalls.push(["fillRect", ...args]),
  restore: () => windowCalls.push(["restore"]),
  save: () => windowCalls.push(["save"]),
  strokeRect: (...args) => windowCalls.push(["strokeRect", ...args]),
};
const renderedWindow = renderGraphQueue(windowContext, { width: 1280, height: 720 }, {
  ready: true,
  events: [
    { serviceId: 0x80, eventIndex: 1, instructionOffset: 0x10, args: [{ kind: 1, value: 1280 }, { kind: 1, value: 720 }] },
    {
      serviceId: 0x88,
      eventIndex: 2,
      instructionOffset: 0x14,
      argCount: 9,
      args: [
        { kind: 1, value: 48 },
        { kind: 1, value: 24 },
        { kind: 1, value: 1036 },
        { kind: 1, value: 128 },
        { kind: 1, value: 1 },
        { kind: 1, value: 48 },
        { kind: 1, value: 24 },
        { kind: 1, value: 1036 },
        { kind: 1, value: 128 },
      ],
    },
    {
      serviceId: 0x85,
      eventIndex: 3,
      instructionOffset: 0x18,
      argCount: 7,
      args: [
        { kind: 1, value: 1 },
        { kind: 1, value: 0 },
        { kind: 1, value: 0 },
        { kind: 1, value: 1 },
        { kind: 1, value: 256 },
        { kind: 1, value: 0 },
        { kind: 1, value: 0xf750 },
      ],
    },
    {
      serviceId: 0xe8,
      eventIndex: 4,
      instructionOffset: 0x20,
      argCount: 4,
      args: [
        { kind: 1, value: 0 },
        { kind: 1, value: 0 },
        { kind: 1, value: 42 },
        { kind: 1, value: 544 },
      ],
    },
  ],
}, null);
if (
  !renderedWindow.applied ||
  renderedWindow.windows.length !== 1 ||
  renderedWindow.windows[0].width !== 1132 ||
  renderedWindow.windows[0].height !== 176 ||
  renderedWindow.windows[0].innerRect?.width !== 1036 ||
  windowCalls.filter((call) => call[0] === "strokeRect").length < 2 ||
  windowCalls.filter((call) => call[0] === "fillRect").length < 3
) {
  throw new Error(`unexpected graph window draw state ${JSON.stringify({ renderedWindow, windowCalls })}`);
}

const compressedBgHeader = new Uint8Array(0x30);
new TextEncoder().encodeInto("CompressedBG___\0", compressedBgHeader);
compressedBgHeader[0x10] = 2;
compressedBgHeader[0x12] = 2;
new DataView(compressedBgHeader.buffer).setUint32(0x14, 32, true);
new DataView(compressedBgHeader.buffer).setUint32(0x20, 0, true);
new DataView(compressedBgHeader.buffer).setUint32(0x24, 0, true);
new DataView(compressedBgHeader.buffer).setUint32(0x28, 0, true);
new DataView(compressedBgHeader.buffer).setUint16(0x2e, 1, true);
const archiveBody = new Uint8Array(0x12000);
archiveBody.set(compressedBgHeader, 0xfd20);
const archiveCalls = [];
const memoryContextCalls = [];
const memoryContext = {
  beginPath: () => memoryContextCalls.push(["beginPath"]),
  clip: () => memoryContextCalls.push(["clip"]),
  closePath: () => memoryContextCalls.push(["closePath"]),
  fill: () => memoryContextCalls.push(["fill"]),
  fillStyle: "",
  drawImage: (...args) => memoryContextCalls.push(["drawImage", ...args]),
  lineWidth: 0,
  lineTo: (...args) => memoryContextCalls.push(["lineTo", ...args]),
  moveTo: (...args) => memoryContextCalls.push(["moveTo", ...args]),
  rect: (...args) => memoryContextCalls.push(["rect", ...args]),
  stroke: () => memoryContextCalls.push(["stroke"]),
  strokeStyle: "",
  fillRect: (...args) => memoryContextCalls.push(["fillRect", ...args]),
  restore: () => memoryContextCalls.push(["restore"]),
  save: () => memoryContextCalls.push(["save"]),
};
const memoryRuntime = {
  catalog: {
    async readPayloadByArchiveAndNameBytes() {
      archiveCalls.push("named");
      return null;
    },
    async readPayloadByNameBytes() {
      archiveCalls.push("fallback");
      return null;
    },
    async readArchivePayloadByNameBytes(name) {
      archiveCalls.push(new TextDecoder("ascii").decode(name));
      return archiveBody;
    },
    archiveDataStartByNameBytes() {
      return 0x20;
    },
  },
  core: {
    cbgRgba(payload) {
      if (payload.byteLength !== 0x30) {
        throw new Error(`unexpected archive payload length ${payload.byteLength}`);
      }
      return {
        width: 2,
        height: 2,
        stride: 8,
        pixels: new Uint8Array([
          1, 2, 3, 255,
          4, 5, 6, 255,
          7, 8, 9, 255,
          10, 11, 12, 255,
        ]),
      };
    },
  },
  requestPaint() {},
};
renderGraphQueue(memoryContext, { width: 1280, height: 720 }, {
  ready: true,
  events: [
    { serviceId: 0x80, eventIndex: 1, instructionOffset: 0x10, args: [{ kind: 1, value: 1280 }, { kind: 1, value: 720 }] },
    {
      serviceId: 0x65,
      eventIndex: 2,
      instructionOffset: 0x12,
      argCount: 4,
      args: [{ kind: 1, value: 1 }, { kind: 1, value: 0 }, { kind: 1, value: 256 }, { kind: 1, value: 0xfd00 }],
      memorySamples: [
        {
          kind: "source-layer-aux-offset",
          argIndex: 3,
          rawValue: 0xfd00,
          address: 0x2000fd00,
          byteLength: 64,
          nonZeroCount: 32,
          previewHex: "436f6d7072657373656442475f5f5f00",
          previewU32: [],
          asciiHints: ["CompressedBG___"],
        },
      ],
    },
    { serviceId: 0x88, eventIndex: 3, instructionOffset: 0x20, args: [{ kind: 1, value: 1 }, { kind: 1, value: 0 }, { kind: 1, value: 0 }, { kind: 1, value: 1280 }, { kind: 1, value: 720 }] },
  ],
}, memoryRuntime);
await new Promise((resolve) => setTimeout(resolve, 0));
const rerenderedMemory = renderGraphQueue(memoryContext, { width: 1280, height: 720 }, {
  ready: true,
  events: [
    { serviceId: 0x80, eventIndex: 1, instructionOffset: 0x10, args: [{ kind: 1, value: 1280 }, { kind: 1, value: 720 }] },
    {
      serviceId: 0x65,
      eventIndex: 2,
      instructionOffset: 0x12,
      argCount: 4,
      args: [{ kind: 1, value: 1 }, { kind: 1, value: 0 }, { kind: 1, value: 256 }, { kind: 1, value: 0xfd00 }],
      memorySamples: [
        {
          kind: "source-layer-aux-offset",
          argIndex: 3,
          rawValue: 0xfd00,
          address: 0x2000fd00,
          byteLength: 64,
          nonZeroCount: 32,
          previewHex: "436f6d7072657373656442475f5f5f00",
          previewU32: [],
          asciiHints: ["CompressedBG___"],
        },
      ],
    },
    { serviceId: 0x88, eventIndex: 3, instructionOffset: 0x20, args: [{ kind: 1, value: 1 }, { kind: 1, value: 0 }, { kind: 1, value: 0 }, { kind: 1, value: 1280 }, { kind: 1, value: 720 }] },
  ],
}, memoryRuntime);
if (
  !archiveCalls.includes("data01xxx.arc")
  || rerenderedMemory.drawnImageCount !== 1
  || !memoryContextCalls.some((call) => call[0] === "drawImage")
) {
  throw new Error(`unexpected archive offset layer render ${JSON.stringify({ archiveCalls, rerenderedMemory, memoryContextCalls })}`);
}

const namedCalls = [];
const namedContextCalls = [];
const namedContext = {
  beginPath: () => namedContextCalls.push(["beginPath"]),
  clip: () => namedContextCalls.push(["clip"]),
  closePath: () => namedContextCalls.push(["closePath"]),
  fill: () => namedContextCalls.push(["fill"]),
  fillStyle: "",
  drawImage: (...args) => namedContextCalls.push(["drawImage", ...args]),
  lineWidth: 0,
  lineTo: (...args) => namedContextCalls.push(["lineTo", ...args]),
  moveTo: (...args) => namedContextCalls.push(["moveTo", ...args]),
  rect: (...args) => namedContextCalls.push(["rect", ...args]),
  stroke: () => namedContextCalls.push(["stroke"]),
  strokeStyle: "",
  fillRect: (...args) => namedContextCalls.push(["fillRect", ...args]),
  restore: () => namedContextCalls.push(["restore"]),
  save: () => namedContextCalls.push(["save"]),
};
const namedRuntime = {
  catalog: {
    async readPayloadByArchiveAndNameBytes(archive, entry) {
      namedCalls.push([
        "named",
        new TextDecoder("ascii").decode(archive),
        new TextDecoder("ascii").decode(entry),
      ]);
      if (
        new TextDecoder("ascii").decode(archive) === "data01xxx.arc"
        && new TextDecoder("ascii").decode(entry) === "01_fruhlingsbeginn_03"
      ) {
        return new Uint8Array([7, 8, 9]);
      }
      return null;
    },
    async readPayloadByNameBytes(entry) {
      namedCalls.push(["fallback", new TextDecoder("ascii").decode(entry)]);
      return null;
    },
  },
  core: {
    cbgRgba(payload) {
      if (payload.length !== 3 || payload[0] !== 7) {
        throw new Error(`unexpected named payload ${JSON.stringify(Array.from(payload))}`);
      }
      return {
        width: 2,
        height: 2,
        stride: 8,
        pixels: new Uint8Array([
          12, 13, 14, 255,
          15, 16, 17, 255,
          18, 19, 20, 255,
          21, 22, 23, 255,
        ]),
      };
    },
  },
  requestPaint() {},
};
renderGraphQueue(namedContext, { width: 1280, height: 720 }, {
  ready: true,
  events: [
    { serviceId: 0x80, eventIndex: 1, instructionOffset: 0x10, args: [{ kind: 1, value: 1280 }, { kind: 1, value: 720 }] },
    {
      serviceId: 0x65,
      eventIndex: 2,
      instructionOffset: 0x12,
      argCount: 4,
      args: [{ kind: 1, value: 0 }, { kind: 1, value: 0 }, { kind: 1, value: 256 }, { kind: 1, value: 0xfd00 }],
      memorySamples: [
        {
          kind: "source-layer-aux-offset",
          argIndex: 3,
          rawValue: 0xfd00,
          address: 0x2000fd00,
          byteLength: 64,
          nonZeroCount: 64,
          previewHex: "",
          previewU32: [],
          asciiHints: ["MZg8"],
        },
        {
          kind: "aux-offset",
          argIndex: 2,
          rawValue: 256,
          address: 0x20000100,
          byteLength: 64,
          nonZeroCount: 21,
          previewHex: "",
          previewU32: [],
          asciiHints: ["01_fruhlingsbeginn_03"],
        },
        {
          kind: "aux-offset",
          argIndex: 1,
          rawValue: 1,
          address: 0x20000001,
          byteLength: 64,
          nonZeroCount: 33,
          previewHex: "",
          previewU32: [],
          asciiHints: ["URIKO ARC20", "data01xxx.arc"],
        },
      ],
    },
    { serviceId: 0x88, eventIndex: 3, instructionOffset: 0x20, args: [{ kind: 1, value: 1 }, { kind: 1, value: 0 }, { kind: 1, value: 0 }, { kind: 1, value: 1280 }, { kind: 1, value: 720 }] },
  ],
}, namedRuntime);
await new Promise((resolve) => setTimeout(resolve, 0));
const rerenderedNamed = renderGraphQueue(namedContext, { width: 1280, height: 720 }, {
  ready: true,
  events: [
    { serviceId: 0x80, eventIndex: 1, instructionOffset: 0x10, args: [{ kind: 1, value: 1280 }, { kind: 1, value: 720 }] },
    {
      serviceId: 0x65,
      eventIndex: 2,
      instructionOffset: 0x12,
      argCount: 4,
      args: [{ kind: 1, value: 0 }, { kind: 1, value: 0 }, { kind: 1, value: 256 }, { kind: 1, value: 0xfd00 }],
      memorySamples: [
        {
          kind: "source-layer-aux-offset",
          argIndex: 3,
          rawValue: 0xfd00,
          address: 0x2000fd00,
          byteLength: 64,
          nonZeroCount: 64,
          previewHex: "",
          previewU32: [],
          asciiHints: ["MZg8"],
        },
        {
          kind: "aux-offset",
          argIndex: 2,
          rawValue: 256,
          address: 0x20000100,
          byteLength: 64,
          nonZeroCount: 21,
          previewHex: "",
          previewU32: [],
          asciiHints: ["01_fruhlingsbeginn_03"],
        },
        {
          kind: "aux-offset",
          argIndex: 1,
          rawValue: 1,
          address: 0x20000001,
          byteLength: 64,
          nonZeroCount: 33,
          previewHex: "",
          previewU32: [],
          asciiHints: ["URIKO ARC20", "data01xxx.arc"],
        },
      ],
    },
    { serviceId: 0x88, eventIndex: 3, instructionOffset: 0x20, args: [{ kind: 1, value: 1 }, { kind: 1, value: 0 }, { kind: 1, value: 0 }, { kind: 1, value: 1280 }, { kind: 1, value: 720 }] },
  ],
}, namedRuntime);
if (
  !namedCalls.some((call) => call[0] === "named" && call[1] === "data01xxx.arc" && call[2] === "01_fruhlingsbeginn_03")
  || rerenderedNamed.drawnImageCount !== 1
  || !namedContextCalls.some((call) => call[0] === "drawImage")
) {
  throw new Error(`unexpected named layer render ${JSON.stringify({ namedCalls, rerenderedNamed, namedContextCalls })}`);
}

const nestedArc = buildArc20([
  ["01_fruhlingsbeginn_03", new Uint8Array([31, 32, 33])],
]);
const nestedCalls = [];
const nestedContextCalls = [];
const nestedContext = {
  beginPath: () => nestedContextCalls.push(["beginPath"]),
  clip: () => nestedContextCalls.push(["clip"]),
  closePath: () => nestedContextCalls.push(["closePath"]),
  fill: () => nestedContextCalls.push(["fill"]),
  fillStyle: "",
  drawImage: (...args) => nestedContextCalls.push(["drawImage", ...args]),
  lineWidth: 0,
  lineTo: (...args) => nestedContextCalls.push(["lineTo", ...args]),
  moveTo: (...args) => nestedContextCalls.push(["moveTo", ...args]),
  rect: (...args) => nestedContextCalls.push(["rect", ...args]),
  stroke: () => nestedContextCalls.push(["stroke"]),
  strokeStyle: "",
  fillRect: (...args) => nestedContextCalls.push(["fillRect", ...args]),
  restore: () => nestedContextCalls.push(["restore"]),
  save: () => nestedContextCalls.push(["save"]),
};
const nestedRuntime = {
  catalog: {
    async readPayloadByArchiveAndNameBytes(archive, entry) {
      nestedCalls.push([
        "archive+entry",
        new TextDecoder("ascii").decode(archive),
        new TextDecoder("ascii").decode(entry),
      ]);
      return null;
    },
    async readPayloadByNameBytes(entry) {
      const text = new TextDecoder("ascii").decode(entry);
      nestedCalls.push(["entry", text]);
      if (text === "01_fruhlingsbeginn_01") {
        return nestedArc.data;
      }
      return null;
    },
  },
  core: {
    imageRgba(payload) {
      if (payload.length !== 3 || payload[0] !== 31) {
        throw new Error(`unexpected nested payload ${JSON.stringify(Array.from(payload))}`);
      }
      return {
        width: 2,
        height: 2,
        stride: 8,
        pixels: new Uint8Array([
          1, 2, 3, 255,
          4, 5, 6, 255,
          7, 8, 9, 255,
          10, 11, 12, 255,
        ]),
      };
    },
  },
  requestPaint() {},
};
renderGraphQueue(nestedContext, { width: 1280, height: 720 }, {
  ready: true,
  events: [
    { serviceId: 0x80, eventIndex: 1, instructionOffset: 0x10, args: [{ kind: 1, value: 1280 }, { kind: 1, value: 720 }] },
    {
      serviceId: 0x65,
      eventIndex: 2,
      instructionOffset: 0x12,
      argCount: 4,
      args: [{ kind: 1, value: 0 }, { kind: 1, value: 0 }, { kind: 1, value: 256 }, { kind: 1, value: 0xfd00 }],
      memorySamples: [
        {
          kind: "source-layer-aux-offset",
          argIndex: 3,
          rawValue: 0xfd00,
          address: 0x2000fd00,
          byteLength: 64,
          nonZeroCount: 64,
          previewHex: "",
          previewU32: [],
          asciiHints: ["MZg8"],
        },
        {
          kind: "aux-offset",
          argIndex: 2,
          rawValue: 256,
          address: 0x20000100,
          byteLength: 64,
          nonZeroCount: 21,
          previewHex: "",
          previewU32: [],
          asciiHints: ["01_fruhlingsbeginn_03"],
        },
        {
          kind: "aux-offset",
          argIndex: 1,
          rawValue: 1,
          address: 0x20000001,
          byteLength: 64,
          nonZeroCount: 33,
          previewHex: "",
          previewU32: [],
          asciiHints: ["URIKO ARC20", "01_fruhlingsbeginn_01"],
        },
      ],
    },
    { serviceId: 0x88, eventIndex: 3, instructionOffset: 0x20, args: [{ kind: 1, value: 1 }, { kind: 1, value: 0 }, { kind: 1, value: 0 }, { kind: 1, value: 1280 }, { kind: 1, value: 720 }] },
  ],
}, nestedRuntime);
await new Promise((resolve) => setTimeout(resolve, 0));
const rerenderedNested = renderGraphQueue(nestedContext, { width: 1280, height: 720 }, {
  ready: true,
  events: [
    { serviceId: 0x80, eventIndex: 1, instructionOffset: 0x10, args: [{ kind: 1, value: 1280 }, { kind: 1, value: 720 }] },
    {
      serviceId: 0x65,
      eventIndex: 2,
      instructionOffset: 0x12,
      argCount: 4,
      args: [{ kind: 1, value: 0 }, { kind: 1, value: 0 }, { kind: 1, value: 256 }, { kind: 1, value: 0xfd00 }],
      memorySamples: [
        {
          kind: "source-layer-aux-offset",
          argIndex: 3,
          rawValue: 0xfd00,
          address: 0x2000fd00,
          byteLength: 64,
          nonZeroCount: 64,
          previewHex: "",
          previewU32: [],
          asciiHints: ["MZg8"],
        },
        {
          kind: "aux-offset",
          argIndex: 2,
          rawValue: 256,
          address: 0x20000100,
          byteLength: 64,
          nonZeroCount: 21,
          previewHex: "",
          previewU32: [],
          asciiHints: ["01_fruhlingsbeginn_03"],
        },
        {
          kind: "aux-offset",
          argIndex: 1,
          rawValue: 1,
          address: 0x20000001,
          byteLength: 64,
          nonZeroCount: 33,
          previewHex: "",
          previewU32: [],
          asciiHints: ["URIKO ARC20", "01_fruhlingsbeginn_01"],
        },
      ],
    },
    { serviceId: 0x88, eventIndex: 3, instructionOffset: 0x20, args: [{ kind: 1, value: 1 }, { kind: 1, value: 0 }, { kind: 1, value: 0 }, { kind: 1, value: 1280 }, { kind: 1, value: 720 }] },
  ],
}, nestedRuntime);
if (
  !nestedCalls.some((call) => call[0] === "entry" && call[1] === "01_fruhlingsbeginn_01")
  || rerenderedNested.drawnImageCount !== 1
  || !nestedContextCalls.some((call) => call[0] === "drawImage")
) {
  throw new Error(`unexpected nested named layer render ${JSON.stringify({ nestedCalls, rerenderedNested, nestedContextCalls })}`);
}

const lateContextArc = buildArc20([
  ["01_fruhlingsbeginn_03", new Uint8Array([41, 42, 43])],
]);
const lateContextCalls = [];
const lateContextDraws = [];
const lateContextRuntime = {
  catalog: {
    async readPayloadByArchiveAndNameBytes(archive, entry) {
      lateContextCalls.push([
        "archive+entry",
        new TextDecoder("ascii").decode(archive),
        new TextDecoder("ascii").decode(entry),
      ]);
      return null;
    },
    async readPayloadByNameBytes(entry) {
      const text = new TextDecoder("ascii").decode(entry);
      lateContextCalls.push(["entry", text]);
      if (text === "01_fruhlingsbeginn_01") {
        return lateContextArc.data;
      }
      return null;
    },
  },
  core: {
    imageRgba(payload) {
      if (payload.length !== 3 || payload[0] !== 41) {
        throw new Error(`unexpected late-context payload ${JSON.stringify(Array.from(payload))}`);
      }
      return {
        width: 2,
        height: 2,
        stride: 8,
        pixels: new Uint8Array([
          1, 1, 1, 255,
          2, 2, 2, 255,
          3, 3, 3, 255,
          4, 4, 4, 255,
        ]),
      };
    },
  },
  requestPaint() {},
};
const lateContextCtx = {
  beginPath() {},
  clip() {},
  closePath() {},
  fill() {},
  fillStyle: "",
  drawImage: (...args) => lateContextDraws.push(args),
  lineWidth: 0,
  lineTo() {},
  moveTo() {},
  rect() {},
  stroke() {},
  strokeStyle: "",
  fillRect() {},
  restore() {},
  save() {},
};
const lateContextQueue = {
  ready: true,
  events: [
    { serviceId: 0x80, eventIndex: 1, instructionOffset: 0x10, args: [{ kind: 1, value: 1280 }, { kind: 1, value: 720 }] },
    {
      serviceId: 0x65,
      eventIndex: 2,
      instructionOffset: 0x12,
      argCount: 4,
      args: [{ kind: 1, value: 0 }, { kind: 1, value: 0 }, { kind: 1, value: 256 }, { kind: 1, value: 0xfd00 }],
      memorySamples: [
        {
          kind: "source-layer-aux-offset",
          argIndex: 3,
          rawValue: 0xfd00,
          address: 0x2000fd00,
          byteLength: 64,
          nonZeroCount: 64,
          previewHex: "",
          previewU32: [],
          asciiHints: ["MZg8"],
        },
        {
          kind: "aux-offset",
          argIndex: 2,
          rawValue: 256,
          address: 0x20000100,
          byteLength: 64,
          nonZeroCount: 21,
          previewHex: "",
          previewU32: [],
          asciiHints: ["01_fruhlingsbeginn_03"],
        },
      ],
    },
    {
      serviceId: 0x18,
      eventIndex: 3,
      instructionOffset: 0x20,
      argCount: 6,
      args: [
        { kind: 1, value: 1279 },
        { kind: 1, value: 0 },
        { kind: 1, value: 0 },
        { kind: 1, value: 1076 },
        { kind: 1, value: 1 },
        { kind: 1, value: 256 },
      ],
      memorySamples: [
        {
          kind: "aux-offset",
          argIndex: 0,
          rawValue: 1279,
          address: 0x200004ff,
          byteLength: 64,
          nonZeroCount: 16,
          previewHex: "",
          previewU32: [],
          asciiHints: ["03_zypressen_02"],
        },
        {
          kind: "aux-offset",
          argIndex: 4,
          rawValue: 1,
          address: 0x20000001,
          byteLength: 64,
          nonZeroCount: 33,
          previewHex: "",
          previewU32: [],
          asciiHints: ["URIKO ARC20", "01_fruhlingsbeginn_01"],
        },
        {
          kind: "aux-offset",
          argIndex: 5,
          rawValue: 256,
          address: 0x20000100,
          byteLength: 64,
          nonZeroCount: 21,
          previewHex: "",
          previewU32: [],
          asciiHints: ["01_fruhlingsbeginn_03"],
        },
      ],
    },
    { serviceId: 0x88, eventIndex: 4, instructionOffset: 0x24, args: [{ kind: 1, value: 1 }, { kind: 1, value: 0 }, { kind: 1, value: 0 }, { kind: 1, value: 1280 }, { kind: 1, value: 720 }] },
  ],
};
renderGraphQueue(lateContextCtx, { width: 1280, height: 720 }, lateContextQueue, lateContextRuntime);
await new Promise((resolve) => setTimeout(resolve, 0));
const lateContextRendered = renderGraphQueue(lateContextCtx, { width: 1280, height: 720 }, lateContextQueue, lateContextRuntime);
if (
  !lateContextCalls.some((call) => call[0] === "entry" && call[1] === "01_fruhlingsbeginn_01")
  || lateContextRendered.drawnImageCount !== 1
  || lateContextDraws.length === 0
) {
  throw new Error(`unexpected late-context nested render ${JSON.stringify({ lateContextCalls, lateContextRendered, lateContextDraws })}`);
}

const titleBackfillCalls = [];
const titleBackfillDraws = [];
const titleBackfillArc = buildArc20([
  ["01_fruhlingsbeginn_03", new Uint8Array([51, 52, 53])],
]);
const titleBackfillRuntime = {
  catalog: {
    async readPayloadByArchiveAndNameBytes() {
      return null;
    },
    async readPayloadByNameBytes(entry) {
      const text = new TextDecoder("ascii").decode(entry);
      titleBackfillCalls.push(text);
      if (text === "01_fruhlingsbeginn_01") {
        return titleBackfillArc.data;
      }
      return null;
    },
  },
  core: {
    imageRgba(payload) {
      if (payload.length !== 3 || payload[0] !== 51) {
        throw new Error(`unexpected title-backfill payload ${JSON.stringify(Array.from(payload))}`);
      }
      return {
        width: 2,
        height: 2,
        stride: 8,
        pixels: new Uint8Array([
          1, 2, 3, 255,
          4, 5, 6, 255,
          7, 8, 9, 255,
          10, 11, 12, 255,
        ]),
      };
    },
  },
  requestPaint() {},
};
const titleBackfillContext = {
  beginPath() {},
  clip() {},
  closePath() {},
  fill() {},
  fillStyle: "",
  drawImage: (...args) => titleBackfillDraws.push(args),
  lineWidth: 0,
  lineTo() {},
  moveTo() {},
  rect() {},
  stroke() {},
  strokeStyle: "",
  fillRect() {},
  restore() {},
  save() {},
};
const titleBackfillQueue = {
  ready: true,
  events: [
    { serviceId: 0x80, eventIndex: 1, instructionOffset: 0x10, args: [{ kind: 1, value: 1280 }, { kind: 1, value: 720 }] },
    {
      serviceId: 0x65,
      eventIndex: 2,
      instructionOffset: 0x87,
      argCount: 4,
      args: [{ kind: 1, value: 0 }, { kind: 1, value: 0 }, { kind: 1, value: 0x100 }, { kind: 1, value: 0xfd00 }],
      memorySamples: [],
    },
    {
      serviceId: 0x56,
      eventIndex: 3,
      instructionOffset: 0x385,
      argCount: 7,
      args: [
        { kind: 1, value: 0 },
        { kind: 1, value: 0 },
        { kind: 1, value: 0 },
        { kind: 1, value: 0x434 },
        { kind: 1, value: 1 },
        { kind: 1, value: 0 },
        { kind: 1, value: 0xf730 },
      ],
      memorySamples: [
        {
          kind: "local-offset",
          argIndex: 3,
          rawValue: 0x434,
          address: 0x12000434,
          byteLength: 64,
          nonZeroCount: 34,
          previewHex: "",
          previewU32: [],
          asciiHints: ["UserData"],
        },
      ],
    },
    {
      serviceId: 0x18,
      eventIndex: 4,
      instructionOffset: 0x956,
      argCount: 6,
      args: [
        { kind: 1, value: 0x4ff },
        { kind: 1, value: 0 },
        { kind: 1, value: 0 },
        { kind: 1, value: 0x434 },
        { kind: 1, value: 1 },
        { kind: 1, value: 0x100 },
      ],
      memorySamples: [
        {
          kind: "local-offset",
          argIndex: 3,
          rawValue: 0x434,
          address: 0x12000434,
          byteLength: 64,
          nonZeroCount: 34,
          previewHex: "",
          previewU32: [],
          asciiHints: ["UserData"],
        },
        {
          kind: "aux-offset",
          argIndex: 4,
          rawValue: 1,
          address: 0x20000001,
          byteLength: 64,
          nonZeroCount: 33,
          previewHex: "",
          previewU32: [],
          asciiHints: ["URIKO ARC20", "01_fruhlingsbeginn_01"],
        },
        {
          kind: "aux-offset",
          argIndex: 5,
          rawValue: 0x100,
          address: 0x20000100,
          byteLength: 64,
          nonZeroCount: 21,
          previewHex: "",
          previewU32: [],
          asciiHints: ["01_fruhlingsbeginn_03"],
        },
      ],
    },
    {
      serviceId: 0x4c,
      eventIndex: 5,
      instructionOffset: 0x1507,
      argCount: 2,
      args: [{ kind: 1, value: 1 }, { kind: 1, value: 0 }],
      memorySamples: [
        {
          kind: "aux-offset",
          argIndex: 0,
          rawValue: 1,
          address: 0x20000001,
          byteLength: 64,
          nonZeroCount: 33,
          previewHex: "",
          previewU32: [],
          asciiHints: ["URIKO ARC20", "01_fruhlingsbeginn_01"],
        },
      ],
    },
    { serviceId: 0x88, eventIndex: 6, instructionOffset: 0x20, args: [{ kind: 1, value: 1 }, { kind: 1, value: 0 }, { kind: 1, value: 0 }, { kind: 1, value: 1280 }, { kind: 1, value: 720 }] },
  ],
};
renderGraphQueue(titleBackfillContext, { width: 1280, height: 720 }, titleBackfillQueue, titleBackfillRuntime);
await new Promise((resolve) => setTimeout(resolve, 0));
const titleBackfillRendered = renderGraphQueue(
  titleBackfillContext,
  { width: 1280, height: 720 },
  titleBackfillQueue,
  titleBackfillRuntime,
);
if (
  !titleBackfillCalls.includes("01_fruhlingsbeginn_03")
  || titleBackfillRendered.drawnImageCount !== 1
  || titleBackfillDraws.length === 0
) {
  throw new Error(`unexpected title backfill render ${JSON.stringify({ titleBackfillCalls, titleBackfillRendered, titleBackfillDraws })}`);
}

const ordered = inspectGraphQueue({
  ready: true,
  events: [
    {
      serviceId: 0x88,
      eventIndex: 9,
      instructionOffset: 0x14,
      argCount: 9,
      args: [
        { kind: 1, value: 48 },
        { kind: 1, value: 24 },
        { kind: 1, value: 1036 },
        { kind: 1, value: 128 },
        { kind: 1, value: 1 },
        { kind: 1, value: 48 },
        { kind: 1, value: 24 },
        { kind: 1, value: 1036 },
        { kind: 1, value: 128 },
      ],
    },
    {
      serviceId: 0x85,
      eventIndex: 10,
      instructionOffset: 0x18,
      argCount: 7,
      args: [
        { kind: 1, value: 1 },
        { kind: 1, value: 0 },
        { kind: 1, value: 0 },
        { kind: 1, value: 1 },
        { kind: 1, value: 256 },
        { kind: 1, value: 0 },
        { kind: 1, value: 0xf750 },
      ],
    },
    {
      serviceId: 0xe8,
      eventIndex: 11,
      instructionOffset: 0x20,
      argCount: 6,
      args: [
        { kind: 1, value: 42 },
        { kind: 1, value: 552 },
        { kind: 1, value: 0 },
        { kind: 1, value: 1 },
        { kind: 1, value: 42 },
        { kind: 1, value: 552 },
      ],
    },
  ],
});

if (
  ordered.windows.length !== 1
  || ordered.windows[0].handle !== 1
  || ordered.windows[0].x !== 42
  || ordered.windows[0].y !== 544
  || ordered.windows[0].innerRect?.x !== 90
  || ordered.windows[0].innerRect?.y !== 568
) {
  throw new Error(`unexpected ordered graph window state ${JSON.stringify(ordered)}`);
}

const slot0Archive = buildRuntimeSlot0([
  ["01_fruhlingsbeginn_01", 0x00000, 0x1453f],
  ["01_fruhlingsbeginn_02", 0x1453f, 0x0fdb1],
  ["01_fruhlingsbeginn_03", 0x24300, 0x0bfb6],
]);
const runtimeInspected = inspectGraphQueue({
  ready: true,
  events: [
    { serviceId: 0x80, eventIndex: 1, instructionOffset: 0x10, args: [{ kind: 1, value: 1280 }, { kind: 1, value: 720 }] },
    {
      serviceId: 0x65,
      eventIndex: 2,
      instructionOffset: 0x12,
      argCount: 4,
      args: [{ kind: 1, value: 1 }, { kind: 1, value: 0 }, { kind: 1, value: 256 }, { kind: 1, value: 0xfd00 }],
      memorySamples: [
        {
          kind: "source-layer-archive-slot0-offset",
          argIndex: 3,
          rawValue: 0xfd00,
          address: 0x20415d00,
          byteLength: 64,
          nonZeroCount: 64,
          previewHex: "44534320464f524d415420312e3030",
          previewU32: [],
          asciiHints: ["DSC FORMAT 1.00"],
        },
      ],
    },
  ],
}, {
  readRuntimeMemory(address, length) {
    if (address !== 0x20406000 || length < slot0Archive.length) {
      return null;
    }
    return slot0Archive;
  },
});
if (
  runtimeInspected.runtimeSlot0EntryCount !== 3
  || runtimeInspected.runtimeSlot0Entries[0]?.name !== "01_fruhlingsbeginn_01"
  || runtimeInspected.runtimeLayers.length !== 1
  || runtimeInspected.runtimeLayers[0]?.runtimeMemory.slotMatched !== true
  || runtimeInspected.runtimeLayers[0]?.runtimeMemory.slotEntryName !== "01_fruhlingsbeginn_01"
  || runtimeInspected.runtimeLayers[0]?.runtimeMemory.slotObjectOffset !== 0xfd00
) {
  throw new Error(`unexpected runtime slot0 inspection ${JSON.stringify(runtimeInspected)}`);
}

const titleImageInspected = inspectGraphQueue({
  ready: true,
  events: [
    {
      serviceId: 0x56,
      eventIndex: 1,
      instructionOffset: 0x385,
      argCount: 7,
      args: [
        { kind: 1, value: 0 },
        { kind: 1, value: 0 },
        { kind: 1, value: 0 },
        { kind: 1, value: 0x434 },
        { kind: 1, value: 1 },
        { kind: 1, value: 0 },
        { kind: 1, value: 0xf730 },
      ],
      memorySamples: [
        {
          kind: "local-offset",
          argIndex: 3,
          rawValue: 0x434,
          address: 0x12000434,
          byteLength: 64,
          nonZeroCount: 34,
          previewHex: "",
          previewU32: [],
          asciiHints: ["UserData"],
        },
        {
          kind: "local-offset",
          argIndex: 4,
          rawValue: 1,
          address: 0x12000001,
          byteLength: 64,
          nonZeroCount: 26,
          previewHex: "",
          previewU32: [],
          asciiHints: ["Data\\Sakuran"],
        },
      ],
    },
    {
      serviceId: 0x16,
      eventIndex: 2,
      instructionOffset: 0x902,
      argCount: 2,
      args: [
        { kind: 6, value: 424 },
        { kind: 1, value: 0x434 },
      ],
      memorySamples: [
        {
          kind: "local-offset",
          argIndex: 1,
          rawValue: 0x434,
          address: 0x12000434,
          byteLength: 64,
          nonZeroCount: 34,
          previewHex: "",
          previewU32: [],
          asciiHints: ["UserData"],
        },
      ],
    },
    {
      serviceId: 0x18,
      eventIndex: 3,
      instructionOffset: 0x956,
      argCount: 6,
      args: [
        { kind: 1, value: 0x4ff },
        { kind: 1, value: 0 },
        { kind: 1, value: 0 },
        { kind: 1, value: 0x434 },
        { kind: 1, value: 1 },
        { kind: 1, value: 0x100 },
      ],
      memorySamples: [
        {
          kind: "local-offset",
          argIndex: 3,
          rawValue: 0x434,
          address: 0x12000434,
          byteLength: 64,
          nonZeroCount: 34,
          previewHex: "",
          previewU32: [],
          asciiHints: ["UserData"],
        },
        {
          kind: "local-offset",
          argIndex: 4,
          rawValue: 1,
          address: 0x12000001,
          byteLength: 64,
          nonZeroCount: 26,
          previewHex: "",
          previewU32: [],
          asciiHints: ["Data\\Sakuran"],
        },
      ],
    },
    {
      serviceId: 0x57,
      eventIndex: 4,
      instructionOffset: 0x966,
      argCount: 2,
      args: [
        { kind: 1, value: 0 },
        { kind: 1, value: 0x4ff },
      ],
    },
    {
      serviceId: 0x4c,
      eventIndex: 5,
      instructionOffset: 0x1507,
      argCount: 2,
      args: [
        { kind: 1, value: 1 },
        { kind: 1, value: 0 },
      ],
      memorySamples: [
        {
          kind: "aux-offset",
          argIndex: 0,
          rawValue: 1,
          address: 0x20000001,
          byteLength: 64,
          nonZeroCount: 33,
          previewHex: "",
          previewU32: [],
          asciiHints: ["URIKO ARC20", "01_fruhlingsbeginn_01"],
        },
      ],
    },
  ],
});
if (
  titleImageInspected.titleImageContexts.length !== 1
  || titleImageInspected.titleImageContexts[0]?.localObjectOffset !== 0x434
  || titleImageInspected.titleImageContexts[0]?.layerToken !== 0x4ff
  || titleImageInspected.titleImageContexts[0]?.archiveKey !== 1
  || titleImageInspected.titleImageContexts[0]?.archiveBindingEntryName !== "01_fruhlingsbeginn_01"
  || titleImageInspected.titleImageContexts[0]?.sourceLayerOffset !== 0xf730
) {
  throw new Error(`unexpected title image context ${JSON.stringify(titleImageInspected)}`);
}

const slotNamedCalls = [];
const slotNamedContextCalls = [];
const slotNamedContext = {
  beginPath() {},
  clip() {},
  closePath() {},
  fill() {},
  fillStyle: "",
  drawImage: (...args) => slotNamedContextCalls.push(args),
  lineWidth: 0,
  lineTo() {},
  moveTo() {},
  rect() {},
  stroke() {},
  strokeStyle: "",
  fillRect() {},
  restore() {},
  save() {},
};
const slotNamedRuntime = {
  catalog: {
    async readPayloadByArchiveAndNameBytes(archive, entry) {
      slotNamedCalls.push([
        "named",
        new TextDecoder("ascii").decode(archive),
        new TextDecoder("ascii").decode(entry),
      ]);
      if (new TextDecoder("ascii").decode(entry) === "01_fruhlingsbeginn_01") {
        return compressedBgHeader;
      }
      return null;
    },
    async readPayloadByNameBytes(entry) {
      slotNamedCalls.push(["fallback", new TextDecoder("ascii").decode(entry)]);
      if (new TextDecoder("ascii").decode(entry) === "01_fruhlingsbeginn_01") {
        return compressedBgHeader;
      }
      return null;
    },
  },
  core: {
    imageRgba(payload) {
      if (!(payload instanceof Uint8Array) || payload.length !== compressedBgHeader.length) {
        throw new Error(`unexpected slot-named payload ${payload?.length ?? -1}`);
      }
      return {
        width: 2,
        height: 2,
        stride: 8,
        pixels: new Uint8Array([
          31, 32, 33, 255,
          34, 35, 36, 255,
          37, 38, 39, 255,
          40, 41, 42, 255,
        ]),
      };
    },
  },
  requestPaint() {},
  readRuntimeMemory(address, length) {
    if (address === 0x20406000 && length >= slot0Archive.length) {
      return slot0Archive;
    }
    if (address === 0x20406000 + 0xfd00) {
      return new Uint8Array([0x44, 0x53, 0x43, 0x20].slice(0, length));
    }
    if (address === 0x12000000 + 0xfd00) {
      return new Uint8Array(length);
    }
    return null;
  },
};
renderGraphQueue(slotNamedContext, { width: 1280, height: 720 }, {
  ready: true,
  events: [
    { serviceId: 0x80, eventIndex: 1, instructionOffset: 0x10, args: [{ kind: 1, value: 1280 }, { kind: 1, value: 720 }] },
    {
      serviceId: 0x65,
      eventIndex: 2,
      instructionOffset: 0x12,
      argCount: 4,
      args: [{ kind: 1, value: 1 }, { kind: 1, value: 0 }, { kind: 1, value: 256 }, { kind: 1, value: 0xfd00 }],
      memorySamples: [
        {
          kind: "source-layer-archive-slot0-offset",
          argIndex: 3,
          rawValue: 0xfd00,
          address: 0x20415d00,
          byteLength: 64,
          nonZeroCount: 4,
          previewHex: "44534320",
          previewU32: [0x20435344],
          asciiHints: ["DSC "],
        },
      ],
    },
    { serviceId: 0x88, eventIndex: 3, instructionOffset: 0x20, args: [{ kind: 1, value: 1 }, { kind: 1, value: 0 }, { kind: 1, value: 0 }, { kind: 1, value: 1280 }, { kind: 1, value: 720 }] },
  ],
}, slotNamedRuntime);
await new Promise((resolve) => setTimeout(resolve, 0));
const rerenderedSlotNamed = renderGraphQueue(slotNamedContext, { width: 1280, height: 720 }, {
  ready: true,
  events: [
    { serviceId: 0x80, eventIndex: 1, instructionOffset: 0x10, args: [{ kind: 1, value: 1280 }, { kind: 1, value: 720 }] },
    {
      serviceId: 0x65,
      eventIndex: 2,
      instructionOffset: 0x12,
      argCount: 4,
      args: [{ kind: 1, value: 1 }, { kind: 1, value: 0 }, { kind: 1, value: 256 }, { kind: 1, value: 0xfd00 }],
      memorySamples: [
        {
          kind: "source-layer-archive-slot0-offset",
          argIndex: 3,
          rawValue: 0xfd00,
          address: 0x20415d00,
          byteLength: 64,
          nonZeroCount: 4,
          previewHex: "44534320",
          previewU32: [0x20435344],
          asciiHints: ["DSC "],
        },
      ],
    },
    { serviceId: 0x88, eventIndex: 3, instructionOffset: 0x20, args: [{ kind: 1, value: 1 }, { kind: 1, value: 0 }, { kind: 1, value: 0 }, { kind: 1, value: 1280 }, { kind: 1, value: 720 }] },
  ],
}, slotNamedRuntime);
if (
  !slotNamedCalls.some((call) => call.at(-1) === "01_fruhlingsbeginn_01")
  || rerenderedSlotNamed.drawnImageCount !== 1
  || slotNamedContextCalls.length === 0
) {
  throw new Error(`unexpected runtime slot named render ${JSON.stringify({ slotNamedCalls, rerenderedSlotNamed, slotNamedContextCalls })}`);
}

console.log("graph_renderer_smoke=ok");

function buildArc20(files) {
  const headerLength = 16;
  const entryLength = 128;
  const nameLength = 96;
  const prefixLength = headerLength + files.length * entryLength;
  const payloadLength = files.reduce((total, [, payload]) => total + payload.byteLength, 0);
  const data = new Uint8Array(prefixLength + payloadLength);
  const view = new DataView(data.buffer);
  data.set(new TextEncoder().encode("BURIKO ARC20"), 0);
  view.setUint32(12, files.length, true);
  let payloadOffset = 0;
  for (const [index, [name, payload]] of files.entries()) {
    const entryOffset = headerLength + index * entryLength;
    data.set(new TextEncoder().encode(name), entryOffset);
    view.setUint32(entryOffset + nameLength, payloadOffset, true);
    view.setUint32(entryOffset + nameLength + 4, payload.byteLength, true);
    data.set(payload, prefixLength + payloadOffset);
    payloadOffset += payload.byteLength;
  }
  return { data };
}

function buildRuntimeSlot0(entries) {
  const headerLength = 0x10;
  const entryLength = 0x80;
  const nameLength = 96;
  const data = new Uint8Array(headerLength + entries.length * entryLength);
  const view = new DataView(data.buffer);
  data.set(new TextEncoder().encode("BURI"), 0);
  view.setUint32(4, 992915, true);
  view.setUint32(8, entries.length, true);
  view.setUint32(12, entries.length, true);
  for (const [index, [name, offset, size]] of entries.entries()) {
    const entryOffset = headerLength + index * entryLength;
    data.set(new TextEncoder().encode(name), entryOffset);
    view.setUint32(entryOffset + nameLength, offset, true);
    view.setUint32(entryOffset + nameLength + 4, size, true);
  }
  return data;
}
