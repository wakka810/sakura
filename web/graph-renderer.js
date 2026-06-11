import { readArc20EntryPayload } from "./local-catalog.js";

const TEXT_ENCODER = new TextEncoder();
const BGI_STAGE_WIDTH = 1280;
const BGI_STAGE_HEIGHT = 720;
const OUTPUT_EVENT_SERVICE_IDS = new Set([0xba, 0xbc, 0xbf]);
const GRAPH_ASSET_CACHE = new WeakMap();
const COMPRESSED_BG_MAGIC_TEXT = "CompressedBG___\0";
const AUX_SLOT0_BASE = 0x20000000;
const RUNTIME_SLOT0_BASE = 0x20406000;
const RUNTIME_SLOT0_HEADER_SIZE = 0x10;
const RUNTIME_SLOT0_ENTRY_SIZE = 0x80;
const RUNTIME_SLOT0_ENTRY_NAME_BYTES = 96;
const RUNTIME_SLOT0_DIRECTORY_READ_BYTES = 0x2000;
const TITLE_IMAGE_SERVICE_IDS = new Set([0x11, 0x13, 0x16, 0x18, 0x4c, 0x56, 0x57]);

export const PRIORITY_GRAPH_SERVICE_IDS = new Set([
  0x10, 0x11, 0x13, 0x31, 0x32, 0x34, 0x37, 0x38, 0x4c, 0x50, 0x56, 0x57, 0x60, 0x61, 0x64, 0x65,
  0x80, 0x85, 0x86, 0x88, 0x89, 0x8a, 0x8b, 0x8c, 0x94, 0x95, 0x96, 0x98, 0x99, 0x9a, 0x9c, 0x9d,
  0xb8, 0xba, 0xbc, 0xbf, 0xe4, 0xe5, 0xe8,
]);

export function summarizeGraphQueue(queue) {
  const events = queue?.events ?? [];
  const model = buildGraphRenderModel(events);
  const first = events[0] ?? null;
  return {
    ready: queue?.ready === true,
    commandCount: events.length,
    priorityCommandCount: model.priorityEvents.length,
    outputEventCount: model.outputEvents.length,
    surfaceWidth: model.surfaceWidth,
    surfaceHeight: model.surfaceHeight,
    stageWidth: model.stageWidth,
    stageHeight: model.stageHeight,
    windowCount: model.windows.length,
    polygonCount: model.polygons.length,
    firstServiceId: first?.serviceId ?? 0,
    firstArgCount: first?.argCount ?? 0,
    firstOffset: first?.instructionOffset ?? 0,
    serviceIds: formatEventField(events, "serviceId"),
    priorityServiceIds: formatEventListField(model.priorityEvents, "serviceId"),
    offsets: formatEventField(events, "instructionOffset"),
    argCounts: formatEventField(events, "argCount"),
    argKinds: formatFirstArgField(events, "kind"),
    argValues: formatFirstArgField(events, "value"),
    argLengths: formatFirstArgField(events, "len"),
    argHashes: formatFirstArgField(events, "hash"),
  };
}

export function inspectGraphQueue(queue, runtime = null) {
  const model = buildGraphRenderModel(queue?.events ?? []);
  if (runtime) {
    model.runtimeSlot0 = inspectRuntimeSlot0(runtime);
    attachRuntimeLayerContexts(model, runtime);
  }
  return {
    stageWidth: model.stageWidth,
    stageHeight: model.stageHeight,
    surfaceWidth: model.surfaceWidth,
    surfaceHeight: model.surfaceHeight,
    windows: model.windows.map((window) => ({
      handle: window.handle,
      visible: window.visible,
      x: window.x,
      y: window.y,
      width: window.width,
      height: window.height,
      memoryPointer: window.memoryPointer,
      formatRect: window.formatRect,
      innerRect: window.innerRect,
    })),
    imageLoads: model.imageLoads.map((asset) => ({
      handle: asset.handle,
      archiveName: asset.archiveName,
      entryName: asset.entryName,
      instructionOffset: asset.instructionOffset,
    })),
    layers: model.layers.map((layer) => ({
      type: layer.type,
      targetHandle: layer.targetHandle ?? null,
      sourceHandle: layer.sourceHandle ?? null,
      x: layer.x ?? 0,
      y: layer.y ?? 0,
      width: layer.width ?? 0,
      height: layer.height ?? 0,
      opacity: layer.opacity ?? 1,
    })),
    polygons: model.polygons.map((polygon) => ({
      type: polygon.type,
      x: polygon.x ?? 0,
      y: polygon.y ?? 0,
      points: polygon.points?.map((point) => ({ x: point.x, y: point.y })) ?? [],
      stroke: polygon.stroke ?? null,
      fill: polygon.fill ?? null,
      width: polygon.width ?? 1,
    })),
    runtimeSlot0EntryCount: model.runtimeSlot0.entryCount,
    runtimeSlot0Entries: model.runtimeSlot0.entries.map((entry) => ({
      name: entry.name,
      offset: entry.offset,
      size: entry.size,
    })),
    runtimeLayers: model.layers
      .filter((layer) => layer.type === "source-layer" && layer.runtimeMemory)
      .map((layer) => ({
        targetHandle: layer.targetHandle ?? null,
        sourceHandle: layer.sourceHandle ?? null,
        runtimeMemory: {
          slotEntryName: layer.runtimeMemory.slotEntryName ?? "",
          slotEntryOffset: layer.runtimeMemory.slotEntryOffset ?? 0,
          slotEntrySize: layer.runtimeMemory.slotEntrySize ?? 0,
          slotObjectAddress: layer.runtimeMemory.slotObjectAddress ?? 0,
          slotObjectOffset: layer.runtimeMemory.slotObjectOffset ?? 0,
          slotMatched: layer.runtimeMemory.slotMatched === true,
          sourceKind: layer.runtimeMemory.sourceKind ?? "",
        },
      })),
    titleImageContexts: model.titleImageContexts.map((context) => ({
      localObjectOffset: context.localObjectOffset ?? 0,
      localObjectAddress: context.localObjectAddress ?? 0,
      layerToken: context.layerToken ?? 0,
      archiveKey: context.archiveKey ?? 0,
      archiveBindingEntryName: context.archiveBindingEntryName ?? "",
      sourceLayerEntryName: context.sourceLayerEntryName ?? "",
      sourceLayerKey: context.sourceLayerKey ?? 0,
      sourceLayerOffset: context.sourceLayerOffset ?? 0,
      serviceIds: context.serviceIds.slice(),
      instructionOffsets: context.instructionOffsets.slice(),
    })),
  };
}

export function renderGraphQueue(context, canvas, queue, runtime = null) {
  const events = queue?.events ?? [];
  const model = buildGraphRenderModel(events);
  if (runtime) {
    model.runtimeSlot0 = inspectRuntimeSlot0(runtime);
    attachRuntimeLayerContexts(model, runtime);
  }
  if (!queue?.ready || events.length === 0 || !context || !canvas) {
    return {
      ...model,
      applied: false,
      resolvedImageCount: 0,
      drawnImageCount: 0,
      runtimeSlot0EntryCount: model.runtimeSlot0.entryCount,
      runtimeSlot0MatchedLayerCount: countRuntimeMatchedLayers(model),
    };
  }

  if (runtime) {
    primeGraphAssets(runtime, model);
  }

  const viewport = stageViewport(canvas, model.stageWidth, model.stageHeight);
  let drawnImageCount = 0;
  context.save?.();
  clipViewport(context, viewport);
  context.fillStyle = "#000";
  context.fillRect(viewport.x, viewport.y, viewport.width, viewport.height);
  for (const layer of model.layers) {
    if (layer.type !== "source-layer") {
      continue;
    }
    const asset = resolveLayerAsset(runtime, model, layer);
    if (!asset?.source) {
      continue;
    }
    const rect = scaleRect(viewport, layerRect(layer, model.windowsByHandle));
    if (rect.width <= 0 || rect.height <= 0) {
      continue;
    }
    drawGraphAsset(context, rect, asset.source, layer.opacity ?? 1);
    drawnImageCount += 1;
  }
  for (const window of model.windows) {
    drawGraphWindow(context, viewport, window);
  }
  for (const polygon of model.polygons) {
    drawGraphPolygon(context, viewport, polygon);
  }
  context.restore?.();
  return {
    ...model,
    applied: true,
    resolvedImageCount: runtime ? countReadyAssets(runtime, model) : 0,
    drawnImageCount,
    runtimeSlot0EntryCount: model.runtimeSlot0.entryCount,
    runtimeSlot0MatchedLayerCount: countRuntimeMatchedLayers(model),
  };
}

function buildGraphRenderModel(events) {
  const orderedEvents = (Array.isArray(events) ? events : []).map(foldInlineStringsIntoSamples);
  const namedAssetContexts = buildNamedAssetContexts(orderedEvents);
  const auxValueEntryContexts = buildAuxValueEntryContexts(orderedEvents);
  const titleImageContexts = buildTitleImageContexts(orderedEvents, namedAssetContexts);
  const priorityEvents = orderedEvents.filter((event) => PRIORITY_GRAPH_SERVICE_IDS.has(event.serviceId));
  const outputEvents = orderedEvents.filter((event) => OUTPUT_EVENT_SERVICE_IDS.has(event.serviceId));
  const windows = [];
  const windowsByHandle = new Map();
  const layers = [];
  const imageLoads = [];
  const imageLoadsByHandle = new Map();
  const pendingFormatRects = [];
  const polygons = [];
  let stageWidth = BGI_STAGE_WIDTH;
  let stageHeight = BGI_STAGE_HEIGHT;
  let surfaceWidth = 0;
  let surfaceHeight = 0;
  let activeHandle = 0;
  let activeLayerHandle = 0;
  let vectorState = {
    originX: 0,
    originY: 0,
    strokeWidth: 1,
    strokeStyle: "rgba(255,255,255,0.92)",
    fillStyle: "rgba(255,255,255,0.18)",
    pendingPolyline: null,
  };

  for (const event of orderedEvents) {
    const values = integerArgs(event);
    switch (event.serviceId) {
      case 0x10: {
        const asset = decodeImageLoad(event);
        if (asset) {
          imageLoads.push(asset);
          imageLoadsByHandle.set(asset.handle, asset);
        }
        break;
      }
      case 0x60: {
        layers.push({ type: "stage-clear", targetHandle: null, opacity: 1 });
        break;
      }
      case 0x61: {
        const handle = values[0] ?? activeHandle;
        if (isHandleId(handle)) {
          activeLayerHandle = handle;
        }
        break;
      }
      case 0x65: {
        const layer = createSourceLayer(
          event,
          values,
          activeHandle,
          activeLayerHandle,
          imageLoadsByHandle,
          namedAssetContexts,
          titleImageContexts,
          auxValueEntryContexts,
        );
        if (layer) {
          layers.push(layer);
          activeLayerHandle = layer.targetHandle ?? activeLayerHandle;
        }
        break;
      }
      case 0x80: {
        const width = pickPositive(values, [0, 2]);
        const height = pickPositive(values, [1, 3]);
        if (width > 0) {
          stageWidth = Math.max(stageWidth, width);
          surfaceWidth = width;
        }
        if (height > 0) {
          stageHeight = Math.max(stageHeight, height);
          surfaceHeight = height;
        }
        break;
      }
      case 0x85: {
        const handle = values[0] ?? activeHandle;
        const window = ensureWindow(windows, windowsByHandle, handle);
        window.visible = true;
        window.enabled = true;
        window.opacity = decodeOpacity(values[4]);
        window.memoryPointer = values[6] ?? 0;
        claimPendingFormat(window, pendingFormatRects);
        activeHandle = handle;
        break;
      }
      case 0x86: {
        const handle = values[0] ?? activeHandle;
        const window = ensureWindow(windows, windowsByHandle, handle);
        window.visible = true;
        window.enabled = true;
        if (isLikelySize(values[3], 16, BGI_STAGE_WIDTH * 2)) {
          window.width = Math.max(window.width, values[3]);
        }
        if (isLikelySize(values[4], 16, BGI_STAGE_HEIGHT * 2)) {
          window.height = Math.max(window.height, values[4]);
        }
        window.memoryPointer = values[6] ?? window.memoryPointer;
        claimPendingFormat(window, pendingFormatRects);
        activeHandle = handle;
        break;
      }
      case 0x87: {
        const handle = values[0] ?? activeHandle;
        ensureWindow(windows, windowsByHandle, handle).visible = (values[1] ?? 0) === 0;
        activeHandle = handle;
        break;
      }
      case 0x88: {
        const format = decodeFormatCall(values, activeHandle);
        if (format.type === "pending-rect") {
          pendingFormatRects.push(format.rect);
          surfaceWidth = Math.max(surfaceWidth, format.rect.width);
          surfaceHeight = Math.max(surfaceHeight, format.rect.height);
          break;
        }
        if (format.type === "handle-rect") {
          const window = ensureWindow(windows, windowsByHandle, format.handle);
          applyExplicitRect(window, format.rect);
          activeHandle = format.handle;
          surfaceWidth = Math.max(surfaceWidth, window.width);
          surfaceHeight = Math.max(surfaceHeight, window.height);
        }
        break;
      }
      case 0x89: {
        const handle = values[0] ?? activeHandle;
        ensureWindow(windows, windowsByHandle, handle).theme = values[1] ?? 0;
        activeHandle = handle;
        break;
      }
      case 0x94: {
        const polyline = decodeIndexedPolyline(values, vectorState);
        if (polyline) {
          vectorState = {
            ...vectorState,
            pendingPolyline: polyline,
          };
        }
        break;
      }
      case 0x95: {
        vectorState = {
          ...vectorState,
          strokeWidth: Math.max(1, (values[0] ?? vectorState.strokeWidth) >>> 0),
          strokeStyle: colorFromIndex(values[1] ?? 0, 0.95),
          fillStyle: colorFromIndex(values[1] ?? 0, 0.22),
        };
        break;
      }
      case 0x96: {
        if (values.length < 6) {
          break;
        }
        const polyline = decodeIndexedPolyline(values, vectorState);
        if (polyline) {
          polygons.push({
            ...polyline,
            type: "filled-polyline",
            fill: vectorState.fillStyle,
            stroke: vectorState.strokeStyle,
          });
        }
        break;
      }
      case 0x98: {
        vectorState = applyVectorState98(vectorState, values);
        if (vectorState.pendingPolyline) {
          polygons.push(translatePolyline(vectorState.pendingPolyline, vectorState.originX, vectorState.originY));
          vectorState = {
            ...vectorState,
            pendingPolyline: null,
          };
        }
        break;
      }
      case 0x99: {
        vectorState = {
          ...vectorState,
          originX: values[0] ?? vectorState.originX,
        };
        break;
      }
      case 0x9a: {
        vectorState = applyVectorState9a(vectorState, values);
        break;
      }
      case 0xe8: {
        const { handle, x, y, anchorX, anchorY } = decodeWindowPlacement(values, activeHandle);
        const window = ensureWindow(windows, windowsByHandle, handle);
        window.anchorX = anchorX;
        window.anchorY = anchorY;
        if (Number.isFinite(x)) {
          window.x = x;
        }
        if (Number.isFinite(y)) {
          window.y = y;
        }
        activeHandle = handle;
        break;
      }
      default:
        break;
    }
  }

  const finalized = windows
    .map((window, index) => finalizeWindow(window, index))
    .filter(Boolean)
    .sort((left, right) => left.order - right.order);
  const finalizedByHandle = new Map(finalized.map((window) => [window.handle, window]));
  const inferred = inferSurfaceSize(finalized);
  return {
    orderedEvents,
    priorityEvents,
    outputEvents,
    imageLoads,
    imageLoadsByHandle,
    titleImageContexts,
    windows: finalized,
    windowsByHandle: finalizedByHandle,
    polygons,
    layers,
    stageWidth,
    stageHeight,
    surfaceWidth: surfaceWidth || inferred.width,
    surfaceHeight: surfaceHeight || inferred.height,
    runtimeSlot0: emptyRuntimeSlot0State(),
  };
}

function translatePolyline(polyline, x, y) {
  const deltaX = x - (polyline.x ?? 0);
  const deltaY = y - (polyline.y ?? 0);
  return {
    ...polyline,
    x,
    y,
    points: polyline.points.map((point) => ({
      x: point.x + deltaX,
      y: point.y + deltaY,
    })),
  };
}

function decodeImageLoad(event) {
  const handle = integerArgs(event)[0] ?? 0;
  const archiveName = inlineStringText(event, 1);
  const entryName = inlineStringText(event, 2);
  if (!Number.isFinite(handle) || handle <= 0 || !archiveName || !entryName) {
    return null;
  }
  return {
    handle: handle >>> 0,
    archiveName,
    entryName,
    instructionOffset: event?.instructionOffset ?? 0,
  };
}

function inlineStringText(event, argIndex) {
  return (event?.inlineStrings ?? []).find((item) => item.argIndex === argIndex)?.text ?? "";
}

function createSourceLayer(
  event,
  values,
  activeHandle,
  activeLayerHandle,
  imageLoadsByHandle,
  namedAssetContexts,
  titleImageContexts = [],
  auxValueEntryContexts = new Map(),
) {
  if (values.length < 4) {
    return null;
  }
  const targetHandle = resolveLayerHandle(values[0], activeHandle, activeLayerHandle);
  const sourceHandle = isHandleId(values[3]) ? normalizeHandle(values[3]) : null;
  const sourceMemory = decodeSourceLayerMemory(
    event,
    namedAssetContexts,
    titleImageContexts,
    auxValueEntryContexts,
  );
  return {
    type: "source-layer",
    targetHandle,
    sourceHandle,
    sourceAsset: sourceHandle === null ? null : imageLoadsByHandle.get(sourceHandle) ?? null,
    sourceMemory,
    runtimeMemory: null,
    x: 0,
    y: 0,
    width: BGI_STAGE_WIDTH,
    height: BGI_STAGE_HEIGHT,
    opacity: 1,
  };
}

function ensureWindow(windows, windowsByHandle, handle) {
  const key = handle >>> 0;
  let window = windowsByHandle.get(key);
  if (!window) {
    window = {
      handle: key,
      order: windows.length,
      enabled: false,
      visible: true,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      anchorX: 0,
      anchorY: 0,
      theme: 0,
      opacity: 1,
      memoryPointer: 0,
      formatRect: null,
    };
    windows.push(window);
    windowsByHandle.set(key, window);
  }
  return window;
}

function decodeFormatCall(values, activeHandle) {
  if (isRepeatedRect(values)) {
    return {
      type: "pending-rect",
      rect: {
        x: values[0] ?? 0,
        y: values[1] ?? 0,
        width: values[2] ?? 0,
        height: values[3] ?? 0,
        visible: (values[4] ?? 1) !== 0,
      },
    };
  }
  if (
    values.length >= 5
    && isHandleId(values[0])
    && isLikelySize(values[3], 16, BGI_STAGE_WIDTH * 2)
    && isLikelySize(values[4], 16, BGI_STAGE_HEIGHT * 2)
  ) {
    return {
      type: "handle-rect",
      handle: values[0] ?? activeHandle,
      rect: {
        x: values[1] ?? 0,
        y: values[2] ?? 0,
        width: values[3] ?? 0,
        height: values[4] ?? 0,
      },
    };
  }
  return { type: "unknown" };
}

function decodeWindowPlacement(values, activeHandle) {
  if (values.length >= 6 && (values[3] ?? 0) > 0) {
    return {
      anchorX: values[0] ?? 0,
      anchorY: values[1] ?? 0,
      handle: values[3],
      x: values[4],
      y: values[5],
    };
  }
  if (values.length >= 4) {
    return {
      anchorX: values[0] ?? 0,
      anchorY: values[1] ?? 0,
      handle: isHandleId(values[1]) ? values[1] : activeHandle,
      x: values[2],
      y: values[3],
    };
  }
  return { anchorX: 0, anchorY: 0, handle: activeHandle, x: 0, y: 0 };
}

function finalizeWindow(window, index) {
  if (!isRenderableWindow(window)) {
    return null;
  }
  const explicitWidth = isLikelySize(window.width, 16, BGI_STAGE_WIDTH * 2) ? window.width : 0;
  const explicitHeight = isLikelySize(window.height, 16, BGI_STAGE_HEIGHT * 2) ? window.height : 0;
  const formatRect = normalizeFormatRect(window.formatRect);
  let width = explicitWidth;
  let height = explicitHeight;
  if (formatRect) {
    width = Math.max(width, formatRect.width + formatRect.x * 2);
    height = Math.max(height, formatRect.height + formatRect.y * 2);
  }
  if (!isLikelySize(width, 16, BGI_STAGE_WIDTH * 2) || !isLikelySize(height, 16, BGI_STAGE_HEIGHT * 2)) {
    return null;
  }
  const x = clampRange(window.x || window.anchorX || 0, 0, Math.max(0, BGI_STAGE_WIDTH - width));
  const y = clampRange(window.y || window.anchorY || 0, 0, Math.max(0, BGI_STAGE_HEIGHT - height));
  const innerRect = formatRect
    ? {
        x: x + formatRect.x,
        y: y + formatRect.y,
        width: formatRect.width,
        height: Math.min(formatRect.height, BGI_STAGE_HEIGHT - (y + formatRect.y)),
        visible: formatRect.visible !== false,
      }
    : null;
  return {
    ...window,
    order: window.order ?? index,
    x,
    y,
    width: Math.min(width, BGI_STAGE_WIDTH - x),
    height: Math.min(height, BGI_STAGE_HEIGHT - y),
    innerRect,
    visible: window.visible !== false,
  };
}

function inferSurfaceSize(windows) {
  let maxWidth = 0;
  let maxHeight = 0;
  for (const window of windows) {
    maxWidth = Math.max(maxWidth, window.width);
    maxHeight = Math.max(maxHeight, window.height);
  }
  return { width: maxWidth, height: maxHeight };
}

function primeGraphAssets(runtime, model) {
  for (const asset of model.imageLoads) {
    void ensureGraphAsset(runtime, asset);
  }
}

function countRuntimeMatchedLayers(model) {
  return model.layers.filter((layer) => layer.runtimeMemory?.slotMatched === true).length;
}

function resolveLayerAsset(runtime, model, layer) {
  if (!runtime) {
    return null;
  }
  const memoryAsset = resolveMemoryLayerAsset(runtime, layer);
  if (memoryAsset?.source) {
    return memoryAsset;
  }
  const runtimeAsset = resolveRuntimeLayerAsset(runtime, layer);
  if (runtimeAsset) {
    return runtimeAsset;
  }
  if (memoryAsset) {
    return memoryAsset;
  }
  if (!Number.isFinite(layer.sourceHandle)) {
    return null;
  }
  const imageLoad = model.imageLoadsByHandle.get(layer.sourceHandle) ?? layer.sourceAsset ?? null;
  if (!imageLoad) {
    return null;
  }
  return ensureGraphAsset(runtime, imageLoad);
}

function countReadyAssets(runtime, model) {
  let count = 0;
  for (const asset of model.imageLoads) {
    if (ensureGraphAsset(runtime, asset)?.source) {
      count += 1;
    }
  }
  return count;
}

function ensureGraphAsset(runtime, asset) {
  const state = ensureRuntimeAssetState(runtime);
  const key = graphAssetKey(asset.archiveName, asset.entryName);
  const cached = state.assets.get(key);
  if (cached) {
    return cached;
  }
  if (!state.inflight.has(key)) {
    state.inflight.set(key, loadGraphAsset(runtime, asset, key, state));
  }
  return { ready: false, source: null };
}

function resolveMemoryLayerAsset(runtime, layer) {
  const memory = layer?.sourceMemory ?? null;
  if (!memory) {
    return null;
  }
  if (memory.prefersNamedAsset === true && memory.entryName) {
    return ensureGraphNamedAsset(runtime, memory.archiveName ?? "", memory.entryName);
  }
  if (Number.isFinite(memory.archiveOffset) && memory.archiveOffset >= 0) {
    return ensureGraphArchiveOffsetAsset(runtime, memory.archiveOffset >>> 0);
  }
  if (memory.entryName) {
    return ensureGraphNamedAsset(runtime, memory.archiveName ?? "", memory.entryName);
  }
  return null;
}

function resolveRuntimeLayerAsset(runtime, layer) {
  const runtimeMemory = layer?.runtimeMemory ?? null;
  if (runtimeMemory?.slotMatched !== true || !runtimeMemory.slotEntryName) {
    return null;
  }
  if (!runtimeMemory.sourceKind?.includes("slot0")) {
    return null;
  }
  return ensureGraphNamedAsset(
    runtime,
    layer?.sourceMemory?.archiveName ?? "",
    runtimeMemory.slotEntryName,
  );
}

function ensureGraphArchiveOffsetAsset(runtime, archiveOffset) {
  const state = ensureRuntimeAssetState(runtime);
  const key = `arc-offset:${archiveOffset >>> 0}`;
  const cached = state.assets.get(key);
  if (cached) {
    return cached;
  }
  if (!state.inflight.has(key)) {
    state.inflight.set(key, loadGraphArchiveOffsetAsset(runtime, archiveOffset >>> 0, key, state));
  }
  return { ready: false, source: null };
}

function ensureGraphNamedAsset(runtime, archiveName, entryName) {
  if (!entryName) {
    return null;
  }
  const state = ensureRuntimeAssetState(runtime);
  const key = graphAssetKey(archiveName || "*", entryName);
  const cached = state.assets.get(key);
  if (cached) {
    return cached;
  }
  if (!state.inflight.has(key)) {
    state.inflight.set(key, loadGraphNamedAsset(runtime, archiveName, entryName, key, state));
  }
  return { ready: false, source: null };
}

async function loadGraphArchiveOffsetAsset(runtime, archiveOffset, key, state) {
  try {
    const payload = await readArchiveOffsetPayload(runtime, archiveOffset >>> 0);
    if (!(payload instanceof Uint8Array) || payload.length < 0x30) {
      state.assets.set(key, { ready: false, source: null });
      return;
    }
    const rgba = decodeRuntimeImage(runtime, payload);
    if (rgba === null) {
      state.assets.set(key, { ready: false, source: null });
      return;
    }
    state.assets.set(key, {
      ready: true,
      source: rgbaToCanvasSource(rgba),
      width: rgba.width,
      height: rgba.height,
    });
  } catch {
    state.assets.set(key, { ready: false, source: null });
  } finally {
    state.inflight.delete(key);
    runtime.requestPaint?.();
  }
}

async function loadGraphNamedAsset(runtime, archiveName, entryName, key, state) {
  try {
    const fallback = await resolveNamedGraphPayload(runtime, archiveName, entryName);
    if (!(fallback instanceof Uint8Array)) {
      state.assets.set(key, { ready: false, source: null });
      return;
    }
    const rgba = decodeRuntimeImage(runtime, fallback);
    if (rgba === null) {
      state.assets.set(key, { ready: false, source: null });
      return;
    }
    state.assets.set(key, {
      ready: true,
      source: rgbaToCanvasSource(rgba),
      width: rgba.width,
      height: rgba.height,
    });
  } catch {
    state.assets.set(key, { ready: false, source: null });
  } finally {
    state.inflight.delete(key);
    runtime.requestPaint?.();
  }
}

async function resolveNamedGraphPayload(runtime, archiveName, entryName) {
  const entryBytes = TEXT_ENCODER.encode(entryName);
  if (!archiveName) {
    return runtime.catalog.readPayloadByNameBytes(entryBytes);
  }
  const archiveBytes = TEXT_ENCODER.encode(archiveName);
  if (isLikelyArchiveName(archiveName)) {
    return (
      await runtime.catalog.readPayloadByArchiveAndNameBytes(archiveBytes, entryBytes)
    ) ?? await runtime.catalog.readPayloadByNameBytes(entryBytes);
  }
  const direct = (
    await runtime.catalog.readPayloadByArchiveAndNameBytes(archiveBytes, entryBytes)
  ) ?? await runtime.catalog.readPayloadByNameBytes(entryBytes);
  if (direct instanceof Uint8Array) {
    return direct;
  }
  const parentPayload = await runtime.catalog.readPayloadByNameBytes(archiveBytes);
  return parentPayload ? readArc20EntryPayload(parentPayload, entryName) : null;
}

async function readArchiveOffsetPayload(runtime, archiveOffset) {
  const archiveName = TEXT_ENCODER.encode("data01xxx.arc");
  const payload = await runtime.catalog.readArchivePayloadByNameBytes(archiveName);
  if (!(payload instanceof Uint8Array)) {
    return null;
  }
  const dataStart = runtime.catalog.archiveDataStartByNameBytes?.(archiveName) ?? 0;
  const start = (dataStart + (archiveOffset >>> 0)) >>> 0;
  if (!Number.isSafeInteger(start) || start < 0 || start + 0x30 > payload.length) {
    return null;
  }
  if (!matchesCompressedBgMagic(payload, start)) {
    return null;
  }
  const encodedLength = readU32LE(payload, start + 0x28);
  const end = start + 0x30 + encodedLength;
  if (!Number.isSafeInteger(end) || end <= start || end > payload.length) {
    return null;
  }
  return payload.slice(start, end);
}

async function loadGraphAsset(runtime, asset, key, state) {
  try {
    const payload = await runtime.catalog.readPayloadByArchiveAndNameBytes(
      TEXT_ENCODER.encode(asset.archiveName),
      TEXT_ENCODER.encode(asset.entryName),
    ) ?? await runtime.catalog.readPayloadByNameBytes(TEXT_ENCODER.encode(asset.entryName));
    if (!(payload instanceof Uint8Array)) {
      state.assets.set(key, { ready: false, source: null });
      return;
    }
    const rgba = decodeRuntimeImage(runtime, payload);
    if (rgba === null) {
      state.assets.set(key, { ready: false, source: null });
      return;
    }
    state.assets.set(key, {
      ready: true,
      source: rgbaToCanvasSource(rgba),
      width: rgba.width,
      height: rgba.height,
    });
  } catch {
    state.assets.set(key, { ready: false, source: null });
  } finally {
    state.inflight.delete(key);
    runtime.requestPaint?.();
  }
}

function ensureRuntimeAssetState(runtime) {
  let state = GRAPH_ASSET_CACHE.get(runtime);
  if (!state) {
    state = { assets: new Map(), inflight: new Map() };
    GRAPH_ASSET_CACHE.set(runtime, state);
  }
  return state;
}

function graphAssetKey(archiveName, entryName) {
  return `${archiveName.toLowerCase()}\u0000${entryName.toLowerCase()}`;
}

function decodeRuntimeImage(runtime, payload) {
  if (!(payload instanceof Uint8Array)) {
    return null;
  }
  const decode = runtime?.core?.imageRgba ?? runtime?.core?.cbgRgba ?? null;
  return typeof decode === "function" ? decode(payload) : null;
}

function decodeSourceLayerMemory(
  event,
  namedAssetContexts = new Map(),
  titleImageContexts = [],
  auxValueEntryContexts = new Map(),
) {
  const rawOffset = event?.args?.[3]?.value;
  if (!Number.isFinite(rawOffset) || rawOffset <= 0) {
    const entryName = findSampleEntryName(event?.memorySamples ?? []);
    const archiveName = resolveNamedArchiveContext(
      findSampleNamedArchiveName(event?.memorySamples ?? []),
      entryName,
      namedAssetContexts,
    );
    return entryName
      ? {
          archiveOffset: null,
          archiveName,
          entryName,
          prefersNamedAsset: true,
          runtimeArchiveSlot0Offset: null,
          auxAddress: null,
          auxKind: "",
          previewHex: "",
          previewU32: [],
        }
      : null;
  }
  const samples = Array.isArray(event?.memorySamples) ? event.memorySamples : [];
  const auxSample = samples.find((sample) => (
    sample?.argIndex === 3
    && typeof sample.kind === "string"
    && (
      sample.kind === "source-layer-archive-slot0-offset"
      || sample.kind === "source-layer-aux-offset"
      || sample.kind === "aux-offset"
    )
    && Number.isFinite(sample.address)
    && sample.address >= AUX_SLOT0_BASE
  )) ?? null;
  const entryName = findSampleEntryName(samples);
  const archiveName = resolveNamedArchiveContext(
    findSampleNamedArchiveName(samples),
    entryName,
    namedAssetContexts,
  );
  const titleContext = resolveTitleSourceLayerContext(
    event,
    titleImageContexts,
    namedAssetContexts,
    auxValueEntryContexts,
  );
  const previewText = typeof auxSample?.previewHex === "string" ? auxSample.previewHex : "";
  const resolvedEntryName = entryName || titleContext?.entryName || "";
  const resolvedArchiveName = archiveName || titleContext?.archiveName || "";
  return {
    archiveOffset: rawOffset >>> 0,
    archiveName: resolvedArchiveName,
    entryName: resolvedEntryName,
    prefersNamedAsset: resolvedEntryName.length > 0 && !previewText.startsWith("436f6d7072657373656442475f5f5f00"),
    runtimeArchiveSlot0Offset: (
      auxSample?.kind === "source-layer-archive-slot0-offset"
      ? (rawOffset >>> 0)
      : null
    ),
    auxAddress: auxSample?.address ?? null,
    auxKind: typeof auxSample?.kind === "string" ? auxSample.kind : "",
    previewHex: previewText,
    previewU32: Array.isArray(auxSample?.previewU32) ? auxSample.previewU32.slice(0, 8) : [],
  };
}

function resolveTitleSourceLayerContext(
  event,
  titleImageContexts = [],
  namedAssetContexts = new Map(),
  auxValueEntryContexts = new Map(),
) {
  if (!Array.isArray(titleImageContexts) || titleImageContexts.length === 0) {
    return null;
  }
  const sourceLayerKey = normalizePositiveValue(event?.args?.[2]?.value);
  if (sourceLayerKey <= 0) {
    return null;
  }
  for (let index = titleImageContexts.length - 1; index >= 0; index -= 1) {
    const context = titleImageContexts[index];
    if (!context || normalizePositiveValue(context.sourceLayerKey) !== sourceLayerKey) {
      continue;
    }
    const entryName = (
      resolveTitleContextEntryName(context)
      || auxValueEntryContexts.get(sourceLayerKey)
      || context.archiveBindingEntryName
      || ""
    );
    if (!entryName) {
      continue;
    }
    const archiveName = (
      context.archiveBindingEntryName
      && context.archiveBindingEntryName !== entryName
    )
      ? context.archiveBindingEntryName
      : resolveNamedArchiveContext("", entryName, namedAssetContexts);
    return {
      archiveName,
      entryName,
      layerToken: normalizePositiveValue(context.layerToken),
      localObjectOffset: normalizePositiveValue(context.localObjectOffset),
    };
  }
  return null;
}

function resolveTitleContextEntryName(context) {
  return context?.sourceLayerEntryName ?? "";
}

function buildTitleImageContexts(events, namedAssetContexts = new Map()) {
  const contexts = [];
  const byLocalOffset = new Map();
  const byLayerToken = new Map();
  let lastContext = null;
  let lastBinding = null;

  for (const event of events) {
    if (!TITLE_IMAGE_SERVICE_IDS.has(event?.serviceId)) {
      continue;
    }
    if (event.serviceId === 0x4c) {
      const binding = extractTitleImageBinding(event, namedAssetContexts);
      if (!binding) {
        continue;
      }
      lastBinding = binding;
      const context = resolveTitleImageContext(binding, byLocalOffset, byLayerToken, lastContext);
      if (context) {
        applyTitleImageBinding(context, binding, event);
        lastContext = context;
      }
      continue;
    }
    const patch = extractTitleImageContextPatch(event, lastBinding);
    if (!patch) {
      continue;
    }
    let context = null;
    if (Number.isFinite(patch.localObjectOffset) && patch.localObjectOffset > 0) {
      context = byLocalOffset.get(patch.localObjectOffset) ?? null;
    }
    if (!context && Number.isFinite(patch.layerToken) && patch.layerToken > 0) {
      context = byLayerToken.get(patch.layerToken) ?? null;
    }
    if (!context) {
      context = lastContext;
    }
    if (!context) {
      context = createTitleImageContext();
      contexts.push(context);
    }
    applyTitleImagePatch(context, patch, event);
    if (lastBinding) {
      applyTitleImageBinding(context, lastBinding);
    }
    if (Number.isFinite(context.localObjectOffset) && context.localObjectOffset > 0) {
      byLocalOffset.set(context.localObjectOffset, context);
    }
    if (Number.isFinite(context.layerToken) && context.layerToken > 0) {
      byLayerToken.set(context.layerToken, context);
    }
    lastContext = context;
  }

  return contexts;
}

function createTitleImageContext() {
  return {
    localObjectOffset: 0,
    localObjectAddress: 0,
    layerToken: 0,
    archiveKey: 0,
    archiveBindingEntryName: "",
    sourceLayerEntryName: "",
    sourceLayerKey: 0,
    sourceLayerOffset: 0,
    serviceIds: [],
    instructionOffsets: [],
  };
}

function extractTitleImageContextPatch(event, lastBinding = null) {
  const values = integerArgs(event);
  switch (event?.serviceId) {
    case 0x56:
      return {
        localObjectOffset: extractLocalOffsetSampleValue(event, 3) ?? normalizePositiveValue(values[3]),
        archiveKey: extractLocalOffsetSampleValue(event, 4) ?? normalizePositiveValue(values[4]),
        sourceLayerOffset: normalizePositiveValue(values[6]),
      };
    case 0x16:
      return {
        localObjectOffset: extractLocalOffsetSampleValue(event, 1) ?? normalizePositiveValue(values[1]),
      };
    case 0x18:
      return {
        layerToken: normalizePositiveValue(values[0]),
        localObjectOffset: extractLocalOffsetSampleValue(event, 3) ?? normalizePositiveValue(values[3]),
        archiveKey: extractLocalOffsetSampleValue(event, 4) ?? normalizePositiveValue(values[4]),
        sourceLayerEntryName: findSampleEntryNameAtArg(event?.memorySamples ?? [], 5),
        sourceLayerKey: normalizePositiveValue(values[5]),
      };
    case 0x11:
    case 0x13:
      return {
        layerToken: normalizePositiveValue(values[0]),
        archiveKey: lastBinding?.archiveKey ?? 0,
      };
    case 0x57:
      return {
        layerToken: normalizePositiveValue(values[1]),
        archiveKey: lastBinding?.archiveKey ?? 0,
      };
    default:
      return null;
  }
}

function applyTitleImagePatch(context, patch, event) {
  if (Number.isFinite(patch.localObjectOffset) && patch.localObjectOffset > 0) {
    context.localObjectOffset = patch.localObjectOffset >>> 0;
    context.localObjectAddress = (0x12000000 + context.localObjectOffset) >>> 0;
  }
  if (Number.isFinite(patch.layerToken) && patch.layerToken > 0) {
    context.layerToken = patch.layerToken >>> 0;
  }
  if (Number.isFinite(patch.archiveKey) && patch.archiveKey > 0) {
    context.archiveKey = patch.archiveKey >>> 0;
  }
  if (Number.isFinite(patch.sourceLayerOffset) && patch.sourceLayerOffset > 0) {
    context.sourceLayerOffset = patch.sourceLayerOffset >>> 0;
  }
  if (patch.sourceLayerEntryName) {
    context.sourceLayerEntryName = patch.sourceLayerEntryName;
  }
  if (Number.isFinite(patch.sourceLayerKey) && patch.sourceLayerKey > 0) {
    context.sourceLayerKey = patch.sourceLayerKey >>> 0;
  }
  pushUniqueNumber(context.serviceIds, event?.serviceId ?? 0);
  pushUniqueNumber(context.instructionOffsets, event?.instructionOffset ?? 0);
}

function extractTitleImageBinding(event, namedAssetContexts = new Map()) {
  const archiveKey = extractLocalOffsetSampleValue(event, 0) ?? normalizePositiveValue(integerArgs(event)[0]);
  const entryName = findSampleEntryName(event?.memorySamples ?? []);
  const archiveName = resolveNamedArchiveContext(
    findSampleNamedArchiveName(event?.memorySamples ?? []),
    entryName,
    namedAssetContexts,
  );
  if ((!Number.isFinite(archiveKey) || archiveKey <= 0) && !entryName && !archiveName) {
    return null;
  }
  return {
    archiveKey: Number.isFinite(archiveKey) && archiveKey > 0 ? (archiveKey >>> 0) : 0,
    archiveBindingEntryName: entryName,
    archiveName,
  };
}

function resolveTitleImageContext(binding, byLocalOffset, byLayerToken, lastContext) {
  if (!binding) {
    return lastContext;
  }
  if (binding.archiveKey > 0) {
    for (const context of byLocalOffset.values()) {
      if (context.archiveKey === binding.archiveKey) {
        return context;
      }
    }
    for (const context of byLayerToken.values()) {
      if (context.archiveKey === binding.archiveKey) {
        return context;
      }
    }
  }
  return lastContext;
}

function applyTitleImageBinding(context, binding, event = null) {
  if (!context || !binding) {
    return;
  }
  if (binding.archiveKey > 0) {
    context.archiveKey = binding.archiveKey >>> 0;
  }
  if (binding.archiveBindingEntryName) {
    context.archiveBindingEntryName = binding.archiveBindingEntryName;
  }
  if (event) {
    pushUniqueNumber(context.serviceIds, event?.serviceId ?? 0);
    pushUniqueNumber(context.instructionOffsets, event?.instructionOffset ?? 0);
  }
}

function extractLocalOffsetSampleValue(event, argIndex) {
  const samples = Array.isArray(event?.memorySamples) ? event.memorySamples : [];
  const sample = samples.find((item) => (
    item?.argIndex === argIndex
    && item?.kind === "local-offset"
    && Number.isFinite(item?.rawValue)
    && item.rawValue > 0
  )) ?? null;
  return Number.isFinite(sample?.rawValue) ? (sample.rawValue >>> 0) : null;
}

function normalizePositiveValue(value) {
  return Number.isFinite(value) && value > 0 ? (value >>> 0) : 0;
}

function pushUniqueNumber(list, value) {
  if (!Array.isArray(list) || !Number.isFinite(value) || list.includes(value)) {
    return;
  }
  list.push(value);
}

function inspectRuntimeSlot0(runtime) {
  if (typeof runtime?.readRuntimeMemory !== "function") {
    return emptyRuntimeSlot0State();
  }
  try {
    const bytes = runtime.readRuntimeMemory(RUNTIME_SLOT0_BASE, RUNTIME_SLOT0_DIRECTORY_READ_BYTES);
    return parseRuntimeSlot0Directory(bytes);
  } catch {
    return emptyRuntimeSlot0State();
  }
}

function attachRuntimeLayerContexts(model, runtime) {
  const entries = model.runtimeSlot0?.entries ?? [];
  if (entries.length === 0) {
    return;
  }
  for (const layer of model.layers) {
    if (layer.type !== "source-layer") {
      continue;
    }
    layer.runtimeMemory = resolveLayerRuntimeContext(layer.sourceMemory, entries, runtime);
  }
}

function resolveLayerRuntimeContext(sourceMemory, entries, runtime) {
  if (!sourceMemory) {
    return null;
  }
  const slotOffset = resolveRuntimeSlot0ObjectOffset(sourceMemory, entries, runtime);
  if (!Number.isFinite(slotOffset) || slotOffset < 0) {
    return {
      sourceKind: sourceMemory.auxKind ?? "",
      slotMatched: false,
      slotEntryName: "",
      slotEntryOffset: 0,
      slotEntrySize: 0,
      slotObjectOffset: 0,
      slotObjectAddress: 0,
    };
  }
  const entry = findRuntimeSlot0Entry(entries, slotOffset >>> 0);
  return {
    sourceKind: sourceMemory.auxKind ?? "",
    slotMatched: entry !== null,
    slotEntryName: entry?.name ?? "",
    slotEntryOffset: entry?.offset ?? 0,
    slotEntrySize: entry?.size ?? 0,
    slotObjectOffset: slotOffset >>> 0,
    slotObjectAddress: (RUNTIME_SLOT0_BASE + (slotOffset >>> 0)) >>> 0,
  };
}

function resolveRuntimeSlot0ObjectOffset(sourceMemory, entries, runtime) {
  const explicitOffset = sourceMemory.runtimeArchiveSlot0Offset;
  if (Number.isFinite(explicitOffset) && explicitOffset >= 0) {
    return explicitOffset >>> 0;
  }
  const fallbackOffset = sourceMemory.archiveOffset;
  if (!Number.isFinite(fallbackOffset) || fallbackOffset < 0) {
    return null;
  }
  const normalized = fallbackOffset >>> 0;
  if (findRuntimeSlot0Entry(entries, normalized) === null) {
    return null;
  }
  if (!runtimeSlot0OffsetLooksLive(runtime, normalized)) {
    return null;
  }
  return normalized;
}

function emptyRuntimeSlot0State() {
  return {
    ready: false,
    entryCount: 0,
    entries: [],
  };
}

function parseRuntimeSlot0Directory(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < RUNTIME_SLOT0_HEADER_SIZE) {
    return emptyRuntimeSlot0State();
  }
  if (asciiText(bytes, 0, 4) !== "BURI") {
    return emptyRuntimeSlot0State();
  }
  const declaredCount = readU32LE(bytes, 12);
  if (!Number.isFinite(declaredCount) || declaredCount <= 0 || declaredCount > 4096) {
    return emptyRuntimeSlot0State();
  }
  const availableEntries = Math.floor((bytes.length - RUNTIME_SLOT0_HEADER_SIZE) / RUNTIME_SLOT0_ENTRY_SIZE);
  const count = Math.max(0, Math.min(declaredCount, availableEntries));
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const entryOffset = RUNTIME_SLOT0_HEADER_SIZE + index * RUNTIME_SLOT0_ENTRY_SIZE;
    const name = asciiCString(bytes, entryOffset, RUNTIME_SLOT0_ENTRY_NAME_BYTES);
    const offset = readU32LE(bytes, entryOffset + RUNTIME_SLOT0_ENTRY_NAME_BYTES);
    const size = readU32LE(bytes, entryOffset + RUNTIME_SLOT0_ENTRY_NAME_BYTES + 4);
    if (!name || size <= 0) {
      continue;
    }
    entries.push({
      index,
      name,
      offset: offset >>> 0,
      size: size >>> 0,
    });
  }
  return {
    ready: entries.length > 0,
    entryCount: entries.length,
    entries,
  };
}

function findRuntimeSlot0Entry(entries, offset) {
  for (const entry of entries) {
    const start = entry.offset >>> 0;
    const end = start + (entry.size >>> 0);
    if (offset >= start && offset < end) {
      return entry;
    }
  }
  return null;
}

function runtimeSlot0OffsetLooksLive(runtime, offset) {
  if (typeof runtime?.readRuntimeMemory !== "function") {
    return true;
  }
  const localProbe = runtime.readRuntimeMemory?.(0x12000000 + (offset >>> 0), 32) ?? null;
  const slotProbe = runtime.readRuntimeMemory?.(RUNTIME_SLOT0_BASE + (offset >>> 0), 32) ?? null;
  const localNonZero = countNonZeroBytes(localProbe);
  const slotNonZero = countNonZeroBytes(slotProbe);
  return slotNonZero > 0 && (localNonZero === 0 || slotNonZero >= localNonZero);
}

function asciiCString(bytes, start, length) {
  if (!(bytes instanceof Uint8Array) || start < 0 || length <= 0 || start >= bytes.length) {
    return "";
  }
  const end = Math.min(bytes.length, start + length);
  let cursor = start;
  while (cursor < end && bytes[cursor] !== 0) {
    cursor += 1;
  }
  return asciiText(bytes, start, cursor - start).trim();
}

function asciiText(bytes, start, length) {
  if (!(bytes instanceof Uint8Array) || length <= 0 || start < 0 || start >= bytes.length) {
    return "";
  }
  const end = Math.min(bytes.length, start + length);
  let text = "";
  for (let index = start; index < end; index += 1) {
    const value = bytes[index];
    if (value === 0) {
      break;
    }
    text += String.fromCharCode(value);
  }
  return text;
}

function countNonZeroBytes(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    return 0;
  }
  let count = 0;
  for (const value of bytes) {
    if (value !== 0) {
      count += 1;
    }
  }
  return count;
}

function buildNamedAssetContexts(events) {
  const contexts = new Map();
  for (const event of events) {
    const context = extractNamedAssetContext(event);
    if (!context) {
      continue;
    }
    contexts.set(context.entryName.toLowerCase(), context.archiveName);
  }
  return contexts;
}

function extractNamedAssetContext(event) {
  const samples = Array.isArray(event?.memorySamples) ? event.memorySamples : [];
  let archiveName = "";
  let archiveArgIndex = -1;
  for (const sample of samples) {
    const hints = Array.isArray(sample?.asciiHints) ? sample.asciiHints : [];
    for (let index = 0; index < hints.length; index += 1) {
      const text = sanitizeSampleHint(hints[index]);
      if (text !== "URIKO ARC20") {
        continue;
      }
      const next = sanitizeSampleHint(hints[index + 1] ?? "");
      if (!isLikelyEntryName(next)) {
        continue;
      }
      archiveName = next;
      archiveArgIndex = Number.isInteger(sample?.argIndex) ? sample.argIndex : -1;
      break;
    }
    if (archiveName) {
      break;
    }
  }
  if (!archiveName) {
    return null;
  }
  let entryName = "";
  for (const sample of samples) {
    const argIndex = Number.isInteger(sample?.argIndex) ? sample.argIndex : -1;
    if (archiveArgIndex >= 0 && argIndex <= archiveArgIndex) {
      continue;
    }
    for (const hint of sample?.asciiHints ?? []) {
      const text = sanitizeSampleHint(hint);
      if (isPreferredEntryName(text) && text !== archiveName) {
        entryName = text;
        break;
      }
    }
    if (entryName) {
      break;
    }
  }
  return entryName ? { archiveName, entryName } : null;
}

function resolveNamedArchiveContext(archiveName, entryName, namedAssetContexts) {
  if (archiveName) {
    return archiveName;
  }
  if (!entryName) {
    return "";
  }
  return namedAssetContexts.get(entryName.toLowerCase()) ?? "";
}

function findSampleArchiveName(samples) {
  for (const sample of samples) {
    for (const hint of sample?.asciiHints ?? []) {
      const text = sanitizeSampleHint(hint);
      if (isLikelyArchiveName(text)) {
        return text;
      }
    }
  }
  return "";
}

function findSampleNamedArchiveName(samples) {
  const archiveName = findSampleArchiveName(samples);
  if (archiveName) {
    return archiveName;
  }
  for (const sample of samples) {
    const hints = Array.isArray(sample?.asciiHints) ? sample.asciiHints : [];
    for (let index = 0; index < hints.length; index += 1) {
      const text = sanitizeSampleHint(hints[index]);
      if (text !== "URIKO ARC20") {
        continue;
      }
      const next = sanitizeSampleHint(hints[index + 1] ?? "");
      if (isLikelyEntryName(next)) {
        return next;
      }
    }
  }
  return "";
}

function findSampleEntryName(samples) {
  let fallback = "";
  for (const sample of samples) {
    for (const hint of sample?.asciiHints ?? []) {
      const text = sanitizeSampleHint(hint);
      if (isPreferredEntryName(text)) {
        return text;
      }
      if (!fallback && isLikelyEntryName(text)) {
        fallback = text;
      }
    }
  }
  return fallback;
}

function findSampleEntryNameAtArg(samples, argIndex) {
  for (const sample of samples) {
    if ((sample?.argIndex ?? -1) !== argIndex) {
      continue;
    }
    for (const hint of sample?.asciiHints ?? []) {
      const text = sanitizeSampleHint(hint);
      if (isStructuredEntryName(text)) {
        return text;
      }
    }
  }
  return "";
}

function buildAuxValueEntryContexts(events) {
  const contexts = new Map();
  for (const event of events) {
    for (const sample of event?.memorySamples ?? []) {
      if (!Number.isFinite(sample?.rawValue) || sample.rawValue <= 0) {
        continue;
      }
      for (const hint of sample?.asciiHints ?? []) {
        const text = sanitizeSampleHint(hint);
        if (!isStructuredEntryName(text)) {
          continue;
        }
        contexts.set(sample.rawValue >>> 0, text);
      }
    }
  }
  return contexts;
}

function sanitizeSampleHint(value) {
  return typeof value === "string" ? value.replace(/\0/g, "").trim() : "";
}

// Emit-time inline strings (resolved by the core from aux memory at the exact
// instant a graph command runs) are a reliable alternative to asynchronous
// memory sampling. Fold them into memorySamples as aux-offset asciiHints so the
// existing asset/title resolution can consume them uniformly.
function foldInlineStringsIntoSamples(event) {
  const inline = Array.isArray(event?.inlineStrings) ? event.inlineStrings : [];
  if (inline.length === 0) {
    return event;
  }
  const args = Array.isArray(event?.args) ? event.args : [];
  const existing = Array.isArray(event?.memorySamples) ? event.memorySamples : [];
  const synthetic = [];
  for (const item of inline) {
    const text = sanitizeSampleHint(typeof item?.text === "string" ? item.text : "");
    if (!text || !isLikelyEntryName(text)) {
      continue;
    }
    const argIndex = Number.isInteger(item?.argIndex) ? item.argIndex : -1;
    const rawValue = argIndex >= 0 && args[argIndex] ? (args[argIndex].value ?? 0) >>> 0 : 0;
    const duplicate = existing.some(
      (sample) =>
        sample.argIndex === argIndex
        && Array.isArray(sample.asciiHints)
        && sample.asciiHints.includes(text),
    );
    if (duplicate) {
      continue;
    }
    synthetic.push({
      kind: "aux-offset",
      argIndex,
      rawValue,
      address: 0,
      byteLength: text.length,
      nonZeroCount: text.length,
      previewHex: "",
      previewU32: [],
      asciiHints: [text],
    });
  }
  if (synthetic.length === 0) {
    return event;
  }
  return { ...event, memorySamples: [...existing, ...synthetic] };
}

function isLikelyArchiveName(value) {
  return value.length >= 5 && value.toLowerCase().endsWith(".arc");
}

function isLikelyEntryName(value) {
  if (!value || isLikelyArchiveName(value) || value === "CompressedBG___" || value === "URIKO ARC20") {
    return false;
  }
  return /^[A-Za-z0-9_]+$/.test(value);
}

function isPreferredEntryName(value) {
  return isLikelyEntryName(value)
    && value.length >= 8
    && /[_\d]/.test(value);
}

function isStructuredEntryName(value) {
  return typeof value === "string"
    && /^\d{2}_[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+$/.test(value);
}

function matchesCompressedBgMagic(bytes, start) {
  if (!(bytes instanceof Uint8Array) || start < 0 || start + COMPRESSED_BG_MAGIC_TEXT.length > bytes.length) {
    return false;
  }
  for (let index = 0; index < COMPRESSED_BG_MAGIC_TEXT.length; index += 1) {
    if (bytes[start + index] !== COMPRESSED_BG_MAGIC_TEXT.charCodeAt(index)) {
      return false;
    }
  }
  return true;
}

function readU32LE(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function rgbaToCanvasSource(rgba) {
  const source = createCanvasSurface(rgba.width, rgba.height);
  if (!source) {
    return { width: rgba.width, height: rgba.height, pixels: rgba.pixels };
  }
  const ctx = source.getContext?.("2d", { alpha: true }) ?? null;
  if (ctx?.putImageData) {
    ctx.putImageData(
      new ImageData(new Uint8ClampedArray(rgba.pixels), rgba.width, rgba.height),
      0,
      0,
    );
  }
  return source;
}

function createCanvasSurface(width, height) {
  if (typeof globalThis.OffscreenCanvas === "function") {
    return new globalThis.OffscreenCanvas(width, height);
  }
  if (globalThis.document?.createElement) {
    const canvas = globalThis.document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  return null;
}

function drawGraphAsset(context, rect, source, opacity) {
  const previousAlpha = typeof context.globalAlpha === "number" ? context.globalAlpha : 1;
  if (typeof context.globalAlpha === "number") {
    context.globalAlpha = clampUnit(opacity);
  }
  context.drawImage?.(source, rect.x, rect.y, rect.width, rect.height);
  if (typeof context.globalAlpha === "number") {
    context.globalAlpha = previousAlpha;
  }
}

function drawGraphWindow(context, viewport, window) {
  if (!shouldDrawGraphWindow(window)) {
    return;
  }
  const outerRect = scaleRect(viewport, window);
  if (outerRect.width <= 0 || outerRect.height <= 0) {
    return;
  }
  const theme = windowTheme(window);
  context.save?.();
  context.fillStyle = theme.frameFill;
  context.fillRect?.(outerRect.x, outerRect.y, outerRect.width, outerRect.height);
  if (window.innerRect && window.innerRect.visible !== false) {
    const innerRect = scaleRect(viewport, window.innerRect);
    if (innerRect.width > 0 && innerRect.height > 0) {
      context.fillStyle = theme.innerFill;
      context.fillRect?.(innerRect.x, innerRect.y, innerRect.width, innerRect.height);
    }
  }
  if (context.strokeRect) {
    context.lineWidth = Math.max(1, Math.round(viewport.scale * 2));
    context.strokeStyle = theme.outerStroke;
    context.strokeRect(outerRect.x, outerRect.y, outerRect.width, outerRect.height);
    if (window.innerRect && window.innerRect.visible !== false) {
      const innerRect = scaleRect(viewport, window.innerRect);
      if (innerRect.width > 0 && innerRect.height > 0) {
        context.lineWidth = Math.max(1, Math.round(viewport.scale));
        context.strokeStyle = theme.innerStroke;
        context.strokeRect(innerRect.x, innerRect.y, innerRect.width, innerRect.height);
      }
    }
  }
  context.restore?.();
}

function drawGraphPolygon(context, viewport, polygon) {
  if (!Array.isArray(polygon?.points) || polygon.points.length < 2) {
    return;
  }
  context.save?.();
  context.beginPath?.();
  const first = polygon.points[0];
  context.moveTo?.(scaleX(viewport, first.x), scaleY(viewport, first.y));
  for (const point of polygon.points.slice(1)) {
    context.lineTo?.(scaleX(viewport, point.x), scaleY(viewport, point.y));
  }
  if (polygon.type === "filled-polyline") {
    context.closePath?.();
    context.fillStyle = polygon.fill ?? "rgba(255,255,255,0.18)";
    context.fill?.();
  }
  context.lineWidth = Math.max(1, Math.round((polygon.width ?? 1) * viewport.scale));
  context.strokeStyle = polygon.stroke ?? "rgba(255,255,255,0.92)";
  context.stroke?.();
  context.restore?.();
}

function layerRect(layer, windowsByHandle) {
  const window = windowsByHandle.get((layer.targetHandle ?? 0) >>> 0);
  if (window?.innerRect && window.innerRect.visible !== false) {
    return window.innerRect;
  }
  if (window) {
    return window;
  }
  const fallback = {
    x: layer.x ?? 0,
    y: layer.y ?? 0,
    width: layer.width ?? BGI_STAGE_WIDTH,
    height: layer.height ?? BGI_STAGE_HEIGHT,
  };
  return fallback.width > 0 && fallback.height > 0 ? fallback : {
    x: 0,
    y: 0,
    width: BGI_STAGE_WIDTH,
    height: BGI_STAGE_HEIGHT,
  };
}

function claimPendingFormat(window, pendingFormatRects) {
  if (window.formatRect || pendingFormatRects.length === 0) {
    return;
  }
  window.formatRect = pendingFormatRects.shift() ?? null;
}

function applyExplicitRect(window, rect) {
  window.width = Math.max(window.width, rect.width);
  window.height = Math.max(window.height, rect.height);
  if (rect.x > 0) {
    window.anchorX = rect.x;
  }
  if (rect.y > 0) {
    window.anchorY = rect.y;
  }
}

function normalizeFormatRect(rect) {
  if (!rect) {
    return null;
  }
  if (
    !isLikelySize(rect.width, 16, BGI_STAGE_WIDTH * 2)
    || !isLikelySize(rect.height, 16, BGI_STAGE_HEIGHT * 2)
  ) {
    return null;
  }
  return {
    x: Math.max(0, rect.x ?? 0),
    y: Math.max(0, rect.y ?? 0),
    width: rect.width,
    height: rect.height,
    visible: rect.visible !== false,
  };
}

function stageViewport(canvas, stageWidth, stageHeight) {
  const width = canvas.width || BGI_STAGE_WIDTH;
  const height = canvas.height || BGI_STAGE_HEIGHT;
  const scale = Math.min(width / stageWidth, height / stageHeight);
  const viewportWidth = Math.max(1, Math.round(stageWidth * scale));
  const viewportHeight = Math.max(1, Math.round(stageHeight * scale));
  return {
    x: Math.floor((width - viewportWidth) / 2),
    y: Math.floor((height - viewportHeight) / 2),
    width: viewportWidth,
    height: viewportHeight,
    scale,
  };
}

function clipViewport(context, viewport) {
  context.beginPath?.();
  context.rect?.(viewport.x, viewport.y, viewport.width, viewport.height);
  context.clip?.();
  context.closePath?.();
}

function scaleRect(viewport, rect) {
  return {
    x: scaleX(viewport, rect.x),
    y: scaleY(viewport, rect.y),
    width: Math.max(0, Math.round(rect.width * viewport.scale)),
    height: Math.max(0, Math.round(rect.height * viewport.scale)),
  };
}

function scaleX(viewport, value) {
  return viewport.x + Math.round(value * viewport.scale);
}

function scaleY(viewport, value) {
  return viewport.y + Math.round(value * viewport.scale);
}

function integerArgs(event) {
  return (event?.args ?? [])
    .filter((arg) => arg.kind === 1)
    .map((arg) => arg.value >>> 0);
}

function resolveLayerHandle(value, activeHandle, activeLayerHandle) {
  if (isHandleId(value)) {
    return value;
  }
  if (isHandleId(activeLayerHandle)) {
    return activeLayerHandle;
  }
  if (isHandleId(activeHandle)) {
    return activeHandle;
  }
  return null;
}

function normalizeHandle(value) {
  return Number.isFinite(value) && value > 0 ? (value >>> 0) : null;
}

function isRenderableWindow(window) {
  return (
    window.enabled === true
    || window.memoryPointer > 0
    || window.formatRect !== null
    || (isLikelySize(window.width, 16, BGI_STAGE_WIDTH * 2)
      && isLikelySize(window.height, 16, BGI_STAGE_HEIGHT * 2))
  );
}

function isHandleId(value) {
  return Number.isFinite(value) && value >= 0 && value < 32;
}

function isLikelySize(value, min, max) {
  return Number.isFinite(value) && value >= min && value <= max;
}

function isRepeatedRect(values) {
  return (
    values.length >= 8
    && values[0] === values[5]
    && values[1] === values[6]
    && values[2] === values[7]
  );
}

function pickPositive(values, indexes) {
  for (const index of indexes) {
    const value = values[index];
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return 0;
}

function decodeOpacity(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }
  if (value >= 255) {
    return 1;
  }
  return clampUnit(value / 255);
}

function clampUnit(value) {
  return Math.max(0, Math.min(1, value));
}

function shouldDrawGraphWindow(window) {
  if (!window || window.visible === false) {
    return false;
  }
  if (window.innerRect && window.innerRect.visible !== false) {
    return true;
  }
  if ((window.memoryPointer ?? 0) > 0 || (window.theme ?? 0) > 0) {
    return true;
  }
  const area = Math.max(0, (window.width ?? 0) * (window.height ?? 0));
  const stageArea = BGI_STAGE_WIDTH * BGI_STAGE_HEIGHT;
  return area > 0 && area < stageArea * 0.85;
}

function windowTheme(window) {
  const opacity = clampUnit(window.opacity ?? 1);
  const paletteIndex = Math.abs((window.theme ?? window.handle ?? 0) >>> 0) % 3;
  const palettes = [
    {
      frameRgb: [16, 20, 32],
      innerRgb: [10, 14, 24],
      outerRgb: [221, 231, 255],
      innerStrokeRgb: [138, 157, 214],
    },
    {
      frameRgb: [28, 18, 28],
      innerRgb: [17, 10, 18],
      outerRgb: [255, 224, 238],
      innerStrokeRgb: [218, 150, 182],
    },
    {
      frameRgb: [20, 24, 18],
      innerRgb: [12, 15, 10],
      outerRgb: [228, 236, 210],
      innerStrokeRgb: [166, 182, 131],
    },
  ];
  const palette = palettes[paletteIndex];
  return {
    frameFill: rgbaString(palette.frameRgb, 0.82 * opacity),
    innerFill: rgbaString(palette.innerRgb, 0.6 * opacity),
    outerStroke: rgbaString(palette.outerRgb, 0.88 * opacity),
    innerStroke: rgbaString(palette.innerStrokeRgb, 0.66 * opacity),
  };
}

function clampRange(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rgbaString(rgb, alpha) {
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${clampUnit(alpha)})`;
}

function decodeIndexedPolyline(values, vectorState) {
  const tuples = [];
  for (let index = 0; index + 2 < values.length; index += 3) {
    tuples.push({
      id: values[index] ?? 0,
      x: values[index + 1] ?? 0,
      y: values[index + 2] ?? 0,
    });
  }
  if (tuples.length < 2) {
    return null;
  }
  const points = tuples
    .filter((tuple, index) => !(index === tuples.length - 1 && tuple.x === 0 && tuple.y === 0))
    .map((tuple) => ({
      x: vectorState.originX + tuple.x,
      y: vectorState.originY + tuple.y,
    }));
  if (points.length < 2) {
    return null;
  }
  return {
    type: "polyline",
    x: vectorState.originX,
    y: vectorState.originY,
    points,
    stroke: vectorState.strokeStyle,
    fill: null,
    width: vectorState.strokeWidth,
  };
}

function applyVectorState98(state, values) {
  if (values.length >= 2) {
    return {
      ...state,
      originX: values[0] ?? state.originX,
      originY: values[1] ?? state.originY,
      strokeWidth: values.length >= 6
        ? Math.max(1, (values[5] ?? state.strokeWidth) >>> 0)
        : state.strokeWidth,
    };
  }
  return state;
}

function applyVectorState9a(state, values) {
  return values.length >= 3
    ? {
        ...state,
        targetHandle: values[0] ?? state.targetHandle ?? 0,
        targetX: values[1] ?? state.targetX ?? 0,
        targetY: values[2] ?? state.targetY ?? 0,
      }
    : state;
}

function colorFromIndex(value, alpha = 1) {
  const palette = [
    [255, 255, 255],
    [185, 215, 255],
    [110, 173, 255],
    [255, 214, 130],
    [248, 161, 96],
    [244, 120, 120],
    [139, 227, 180],
    [94, 188, 255],
  ];
  const color = palette[Math.abs((value ?? 0) >>> 0) % palette.length];
  return `rgba(${color[0]},${color[1]},${color[2]},${clampUnit(alpha)})`;
}

function formatEventField(events, field) {
  return events.slice(0, 8).map((event) => String(event?.[field] ?? 0)).join(",");
}

function formatEventListField(events, field) {
  return events.slice(0, 8).map((event) => String(event?.[field] ?? 0)).join(",");
}

function formatFirstArgField(events, field) {
  return events
    .slice(0, 8)
    .map((event) => String(event?.args?.[0]?.[field] ?? 0))
    .join(",");
}
