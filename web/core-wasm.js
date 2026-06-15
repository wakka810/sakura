import {
  parseScenarioFirstEventPacket,
  parseScenarioSessionProbePacket,
  parseScriptSummaryPacket,
  parseSystemTracePacket,
  parseSystemVmDefaultHostPacket,
  parseSystemVmFirstEventPacket,
} from "./script-probe.js";

const RUNTIME_QUEUE_ARG_SLOTS = 256;
const RUNTIME_QUEUE_ARG_SLOT_LEN = 16;
const RUNTIME_GRAPH_INLINE_STRING_LIMIT = 4;
const RUNTIME_GRAPH_INLINE_STRING_MAX_BYTES = 64;
const RUNTIME_GRAPH_INLINE_STRING_HEADER_LEN = 16;
const RUNTIME_GRAPH_INLINE_STRING_SLOT_LEN = 16 + RUNTIME_GRAPH_INLINE_STRING_MAX_BYTES;
const DEFAULT_RUNTIME_SESSION_MAX_EVENTS = 256;
const DEFAULT_RUNTIME_SESSION_MAX_INSTRUCTIONS = 100000;

export async function loadCore() {
  const response = await fetch("./pkg/sakura_core.wasm");
  if (!response.ok) {
    throw new Error(`failed to load WASM core: ${response.status}`);
  }
  return WebAssembly.instantiateStreaming(response, {});
}

function allocWasm(exports, len) {
  return exports.sakura_alloc(len) >>> 0;
}

function deallocWasm(exports, ptr, len) {
  exports.sakura_dealloc(ptr >>> 0, len);
}

export function createCore(exports) {
  const error = 0xffffffff;
  const movieFrameBuffers = new Map();
  return {
    version: () => exports.sakura_engine_abi_version(),
    arc20EntryCount: (prefix, archiveLength) => {
      const ptr = allocWasm(exports, prefix.byteLength);
      try {
        new Uint8Array(exports.memory.buffer, ptr, prefix.byteLength).set(prefix);
        const count = exports.sakura_arc20_index_entry_count(
          ptr,
          prefix.byteLength,
          archiveLength,
        );
        return count === error ? null : count;
      } finally {
        deallocWasm(exports, ptr, prefix.byteLength);
      }
    },
    arc20IndexManifest: (prefix, archiveLength) => {
      const ptr = allocWasm(exports, prefix.byteLength);
      try {
        new Uint8Array(exports.memory.buffer, ptr, prefix.byteLength).set(prefix);
        const manifestLength = exports.sakura_arc20_index_manifest_len(
          ptr,
          prefix.byteLength,
          archiveLength,
        );
        if (manifestLength === error) {
          return null;
        }

        const manifestPtr = allocWasm(exports, manifestLength);
        try {
          const written = exports.sakura_arc20_index_manifest_write(
            ptr,
            prefix.byteLength,
            archiveLength,
            manifestPtr,
            manifestLength,
          );
          if (written !== manifestLength) {
            return null;
          }
          return new Uint8Array(exports.memory.buffer, manifestPtr, manifestLength).slice();
        } finally {
          deallocWasm(exports, manifestPtr, manifestLength);
        }
      } finally {
        deallocWasm(exports, ptr, prefix.byteLength);
      }
    },
    payloadKind: (payloadPrefix) => {
      const ptr = allocWasm(exports, payloadPrefix.byteLength);
      try {
        new Uint8Array(exports.memory.buffer, ptr, payloadPrefix.byteLength).set(payloadPrefix);
        return exports.sakura_payload_kind(ptr, payloadPrefix.byteLength);
      } finally {
        deallocWasm(exports, ptr, payloadPrefix.byteLength);
      }
    },
    hvlManifest: (payload) => {
      const ptr = allocWasm(exports, payload.byteLength);
      try {
        new Uint8Array(exports.memory.buffer, ptr, payload.byteLength).set(payload);
        const manifestLength = exports.sakura_hvl_manifest_len(ptr, payload.byteLength);
        if (manifestLength === error) {
          return null;
        }

        const manifestPtr = allocWasm(exports, manifestLength);
        try {
          const written = exports.sakura_hvl_manifest_write(
            ptr,
            payload.byteLength,
            manifestPtr,
            manifestLength,
          );
          if (written !== manifestLength) {
            return null;
          }
          return new Uint8Array(exports.memory.buffer, manifestPtr, manifestLength).slice();
        } finally {
          deallocWasm(exports, manifestPtr, manifestLength);
        }
      } finally {
        deallocWasm(exports, ptr, payload.byteLength);
      }
    },
    cbgRgba: (payload) => {
      const ptr = allocWasm(exports, payload.byteLength);
      try {
        new Uint8Array(exports.memory.buffer, ptr, payload.byteLength).set(payload);
        const packetLength = exports.sakura_cbg_rgba_len(ptr, payload.byteLength);
        if (packetLength === error) {
          return null;
        }

        const packetPtr = allocWasm(exports, packetLength);
        try {
          const written = exports.sakura_cbg_rgba_write(
            ptr,
            payload.byteLength,
            packetPtr,
            packetLength,
          );
          if (written !== packetLength) {
            return null;
          }
          const packet = new Uint8Array(
            exports.memory.buffer,
            packetPtr,
            packetLength,
          ).slice();
          return parseRgbaPacket(packet);
        } finally {
          deallocWasm(exports, packetPtr, packetLength);
        }
      } finally {
        deallocWasm(exports, ptr, payload.byteLength);
      }
    },
    imageRgba: (payload) => {
      const ptr = allocWasm(exports, payload.byteLength);
      try {
        new Uint8Array(exports.memory.buffer, ptr, payload.byteLength).set(payload);
        const packetLength = exports.sakura_image_rgba_len(ptr, payload.byteLength);
        if (packetLength === error) {
          return null;
        }

        const packetPtr = allocWasm(exports, packetLength);
        try {
          const written = exports.sakura_image_rgba_write(
            ptr,
            payload.byteLength,
            packetPtr,
            packetLength,
          );
          if (written !== packetLength) {
            return null;
          }
          const packet = new Uint8Array(
            exports.memory.buffer,
            packetPtr,
            packetLength,
          ).slice();
          return parseRgbaPacket(packet);
        } finally {
          deallocWasm(exports, packetPtr, packetLength);
        }
      } finally {
        deallocWasm(exports, ptr, payload.byteLength);
      }
    },
    bgiAudioOgg: (payload) => {
      const ptr = allocWasm(exports, payload.byteLength);
      try {
        new Uint8Array(exports.memory.buffer, ptr, payload.byteLength).set(payload);
        const oggLength = exports.sakura_bgi_audio_ogg_len(ptr, payload.byteLength);
        if (oggLength === error) {
          return null;
        }

        const oggPtr = allocWasm(exports, oggLength);
        try {
          const written = exports.sakura_bgi_audio_ogg_write(
            ptr,
            payload.byteLength,
            oggPtr,
            oggLength,
          );
          if (written !== oggLength) {
            return null;
          }
          return new Uint8Array(exports.memory.buffer, oggPtr, oggLength).slice();
        } finally {
          deallocWasm(exports, oggPtr, oggLength);
        }
      } finally {
        deallocWasm(exports, ptr, payload.byteLength);
      }
    },
    gdbViewedImageNames: (payload) => {
      if (
        typeof exports.sakura_gdb_viewed_image_names_len !== "function"
        || typeof exports.sakura_gdb_viewed_image_names_write !== "function"
      ) {
        return null;
      }
      const ptr = allocWasm(exports, payload.byteLength);
      try {
        new Uint8Array(exports.memory.buffer, ptr, payload.byteLength).set(payload);
        const packetLength = exports.sakura_gdb_viewed_image_names_len(
          ptr,
          payload.byteLength,
        );
        if (packetLength === error) {
          return null;
        }
        if (packetLength === 0) {
          return [];
        }

        const packetPtr = allocWasm(exports, packetLength);
        try {
          const written = exports.sakura_gdb_viewed_image_names_write(
            ptr,
            payload.byteLength,
            packetPtr,
            packetLength,
          );
          if (written !== packetLength) {
            return null;
          }
          const packet = new Uint8Array(
            exports.memory.buffer,
            packetPtr,
            packetLength,
          ).slice();
          return parseNulSeparatedAscii(packet);
        } finally {
          deallocWasm(exports, packetPtr, packetLength);
        }
      } finally {
        deallocWasm(exports, ptr, payload.byteLength);
      }
    },
    movieDecoderCreate: (payload) => {
      const ptr = allocWasm(exports, payload.byteLength);
      try {
        new Uint8Array(exports.memory.buffer, ptr, payload.byteLength).set(payload);
        const handle = exports.sakura_movie_decoder_create(ptr, payload.byteLength);
        if (handle === 0) {
          return 0;
        }
        const rgbaLength = exports.sakura_movie_decoder_rgba_len(handle);
        if (rgbaLength === error || rgbaLength === 0) {
          exports.sakura_movie_decoder_destroy(handle);
          return 0;
        }
        const framePtr = allocWasm(exports, rgbaLength);
        if (framePtr === 0) {
          exports.sakura_movie_decoder_destroy(handle);
          return 0;
        }
        movieFrameBuffers.set(handle, { ptr: framePtr, length: rgbaLength });
        return handle;
      } finally {
        deallocWasm(exports, ptr, payload.byteLength);
      }
    },
    movieDecoderDestroy: (handle) => {
      const frame = movieFrameBuffers.get(handle);
      if (frame) {
        deallocWasm(exports, frame.ptr, frame.length);
        movieFrameBuffers.delete(handle);
      }
      return exports.sakura_movie_decoder_destroy(handle) === 1;
    },
    movieDecoderReset: (handle) => (
      exports.sakura_movie_decoder_reset(handle) === 1
    ),
    movieDecoderWidth: (handle) => exports.sakura_movie_decoder_width(handle),
    movieDecoderHeight: (handle) => exports.sakura_movie_decoder_height(handle),
    movieDecoderFrameRate: (handle) => (
      exports.sakura_movie_decoder_frame_rate_milli(handle) / 1000
    ),
    movieDecoderDecodeNext: (handle) => (
      exports.sakura_movie_decoder_decode_next(handle) === 1
    ),
    movieDecoderDecodedFrames: (handle) => (
      exports.sakura_movie_decoder_decoded_frames(handle)
    ),
    movieDecoderRgba: (handle) => {
      const frame = movieFrameBuffers.get(handle);
      if (!frame) {
        return null;
      }
      const written = exports.sakura_movie_decoder_rgba_write(
        handle,
        frame.ptr,
        frame.length,
      );
      if (written !== frame.length) {
        return null;
      }
      return new Uint8ClampedArray(
        exports.memory.buffer,
        frame.ptr,
        frame.length,
      );
    },
    dscScriptSummary: (payload) => writeFixedPacket(
      exports,
      payload,
      exports.sakura_dsc_script_summary_packet_len(),
      exports.sakura_dsc_script_summary_write,
      parseScriptSummaryPacket,
    ),
    dscScenarioFirstEvent: (payload) => writeFixedPacket(
      exports,
      payload,
      exports.sakura_dsc_scenario_first_event_packet_len(),
      exports.sakura_dsc_scenario_first_event_write,
      parseScenarioFirstEventPacket,
    ),
    dscScenarioSessionProbe: (payload) => writeFixedPacket(
      exports,
      payload,
      exports.sakura_dsc_scenario_session_probe_packet_len(),
      exports.sakura_dsc_scenario_session_probe_write,
      parseScenarioSessionProbePacket,
    ),
    dscSystemTrace: (payload) => writeFixedPacket(
      exports,
      payload,
      exports.sakura_dsc_system_trace_packet_len(),
      exports.sakura_dsc_system_trace_write,
      parseSystemTracePacket,
    ),
    dscSystemVmFirstEvent: (payload) => writeFixedPacket(
      exports,
      payload,
      exports.sakura_dsc_system_vm_first_event_packet_len(),
      exports.sakura_dsc_system_vm_first_event_write,
      parseSystemVmFirstEventPacket,
    ),
    dscSystemVmDefaultHost: (payload) => writeFixedPacket(
      exports,
      payload,
      exports.sakura_dsc_system_vm_default_host_packet_len(),
      exports.sakura_dsc_system_vm_default_host_write,
      parseSystemVmDefaultHostPacket,
    ),
    runtimeCreate: () => exports.sakura_runtime_create(),
    runtimeDestroy: (handle) => exports.sakura_runtime_destroy(handle),
    runtimeSetInput: (handle, input) => exports.sakura_runtime_set_input(
      handle,
      input.clickCount >>> 0,
      input.keyPressCount >>> 0,
      input.pointerX >>> 0,
      input.pointerY >>> 0,
      input.pointerButton >>> 0,
      input.pointerValid ? 1 : 0,
      input.keyEnterDown ? 1 : 0,
      input.keySpaceDown ? 1 : 0,
      input.keyUpDown ? 1 : 0,
      input.keyDownDown ? 1 : 0,
      input.keyLeftDown ? 1 : 0,
      input.keyRightDown ? 1 : 0,
    ),
    runtimeMountArchiveData: (handle, archiveName, payload) => {
      const nameBytes = archiveName instanceof Uint8Array ? archiveName : new Uint8Array();
      const namePtr = allocWasm(exports, nameBytes.byteLength);
      const ptr = allocWasm(exports, payload.byteLength);
      try {
        if (nameBytes.byteLength > 0) {
          new Uint8Array(exports.memory.buffer, namePtr, nameBytes.byteLength).set(nameBytes);
        }
        new Uint8Array(exports.memory.buffer, ptr, payload.byteLength).set(payload);
        return exports.sakura_runtime_mount_archive_data(
          handle,
          namePtr,
          nameBytes.byteLength,
          ptr,
          payload.byteLength,
        );
      } finally {
        deallocWasm(exports, ptr, payload.byteLength);
        deallocWasm(exports, namePtr, nameBytes.byteLength);
      }
    },
    runtimeMountArchiveManifest: (handle, archiveName, manifest, archiveLength) => {
      const nameBytes = archiveName instanceof Uint8Array ? archiveName : new Uint8Array();
      const namePtr = allocWasm(exports, nameBytes.byteLength);
      const ptr = allocWasm(exports, manifest.byteLength);
      try {
        if (nameBytes.byteLength > 0) {
          new Uint8Array(exports.memory.buffer, namePtr, nameBytes.byteLength).set(nameBytes);
        }
        new Uint8Array(exports.memory.buffer, ptr, manifest.byteLength).set(manifest);
        return exports.sakura_runtime_mount_archive_manifest(
          handle,
          namePtr,
          nameBytes.byteLength,
          ptr,
          manifest.byteLength,
          archiveLength,
        );
      } finally {
        deallocWasm(exports, ptr, manifest.byteLength);
        deallocWasm(exports, namePtr, nameBytes.byteLength);
      }
    },
    runtimeMountDscScript: (handle, name, payload) => {
      const namePtr = allocWasm(exports, name.byteLength);
      const payloadPtr = allocWasm(exports, payload.byteLength);
      try {
        new Uint8Array(exports.memory.buffer, namePtr, name.byteLength).set(name);
        new Uint8Array(exports.memory.buffer, payloadPtr, payload.byteLength).set(payload);
        return exports.sakura_runtime_mount_dsc_script(
          handle,
          namePtr,
          name.byteLength,
          payloadPtr,
          payload.byteLength,
        );
      } finally {
        deallocWasm(exports, payloadPtr, payload.byteLength);
        deallocWasm(exports, namePtr, name.byteLength);
      }
    },
    runtimeMountStringsDb: (handle, payload) => {
      if (typeof exports.sakura_runtime_mount_strings_db !== "function") {
        return 0;
      }
      const ptr = allocWasm(exports, payload.byteLength);
      try {
        new Uint8Array(exports.memory.buffer, ptr, payload.byteLength).set(payload);
        return exports.sakura_runtime_mount_strings_db(handle, ptr, payload.byteLength);
      } finally {
        deallocWasm(exports, ptr, payload.byteLength);
      }
    },
    runtimeScriptIndexByName: (handle, name) => {
      const namePtr = allocWasm(exports, name.byteLength);
      try {
        new Uint8Array(exports.memory.buffer, namePtr, name.byteLength).set(name);
        const result = exports.sakura_runtime_script_index_by_name(
          handle,
          namePtr,
          name.byteLength,
        );
        return result === 0 ? null : result - 1;
      } finally {
        deallocWasm(exports, namePtr, name.byteLength);
      }
    },
    runtimeBoot: (handle) => {
      const packetLength = exports.sakura_runtime_boot_packet_len();
      const packetPtr = allocWasm(exports, packetLength);
      try {
        const written = exports.sakura_runtime_boot_write(handle, packetPtr, packetLength);
        if (written !== packetLength) {
          return null;
        }
        const packet = new Uint8Array(
          exports.memory.buffer,
          packetPtr,
          packetLength,
        ).slice();
        return parseRuntimeBootPacket(packet);
      } finally {
        deallocWasm(exports, packetPtr, packetLength);
      }
    },
    runtimeSystemProbe: (handle, scriptIndex, offset) => {
      const packetLength = exports.sakura_runtime_system_probe_packet_len();
      const packetPtr = allocWasm(exports, packetLength);
      try {
        const written = exports.sakura_runtime_system_probe_write(
          handle,
          scriptIndex,
          offset,
          packetPtr,
          packetLength,
        );
        if (written !== packetLength) {
          return null;
        }
        const packet = new Uint8Array(
          exports.memory.buffer,
          packetPtr,
          packetLength,
        ).slice();
        return parseRuntimeSystemProbePacket(packet);
      } finally {
        deallocWasm(exports, packetPtr, packetLength);
      }
    },
    runtimeServiceTrace: (handle, scriptIndex, offset = null, maxServices = 32) => {
      const packetLength = exports.sakura_runtime_service_trace_packet_len();
      const packetPtr = allocWasm(exports, packetLength);
      try {
        const written = exports.sakura_runtime_service_trace_write(
          handle,
          scriptIndex,
          offset === null ? 0xffffffff : offset,
          maxServices,
          packetPtr,
          packetLength,
        );
        if (written !== packetLength) {
          return null;
        }
        const packet = new Uint8Array(
          exports.memory.buffer,
          packetPtr,
          packetLength,
        ).slice();
        return parseRuntimeServiceTracePacket(packet);
      } finally {
        deallocWasm(exports, packetPtr, packetLength);
      }
    },
    runtimeSoundQueue: (handle, scriptIndex, offset = null) => {
      const packetLength = exports.sakura_runtime_sound_queue_packet_len();
      const packetPtr = allocWasm(exports, packetLength);
      try {
        const written = exports.sakura_runtime_sound_queue_write(
          handle,
          scriptIndex,
          offset === null ? 0xffffffff : offset,
          packetPtr,
          packetLength,
        );
        if (written !== packetLength) {
          return null;
        }
        const packet = new Uint8Array(
          exports.memory.buffer,
          packetPtr,
          packetLength,
        ).slice();
        return parseRuntimeSoundQueuePacket(packet);
      } finally {
        deallocWasm(exports, packetPtr, packetLength);
      }
    },
    runtimeGraphQueue: (handle, scriptIndex, offset = null) => {
      const packetLength = exports.sakura_runtime_graph_queue_packet_len();
      const packetPtr = allocWasm(exports, packetLength);
      try {
        const written = exports.sakura_runtime_graph_queue_write(
          handle,
          scriptIndex,
          offset === null ? 0xffffffff : offset,
          packetPtr,
          packetLength,
        );
        if (written !== packetLength) {
          return null;
        }
        const packet = new Uint8Array(
          exports.memory.buffer,
          packetPtr,
          packetLength,
        ).slice();
        return parseRuntimeGraphQueuePacket(packet);
      } finally {
        deallocWasm(exports, packetPtr, packetLength);
      }
    },
    runtimeSessionCreate: (runtimeHandle, scriptIndex, offset = null) => (
      exports.sakura_runtime_session_create(
        runtimeHandle,
        scriptIndex,
        offset === null ? 0xffffffff : offset,
      ) || 0
    ),
    runtimeSessionDestroy: (sessionHandle) => (
      exports.sakura_runtime_session_destroy(sessionHandle)
    ),
    runtimeSessionSoundQueue: (sessionHandle) => {
      const packetLength = exports.sakura_runtime_sound_queue_packet_len();
      const packetPtr = allocWasm(exports, packetLength);
      try {
        const written = exports.sakura_runtime_session_sound_queue_write(
          sessionHandle,
          packetPtr,
          packetLength,
        );
        if (written !== packetLength) {
          return null;
        }
        const packet = new Uint8Array(
          exports.memory.buffer,
          packetPtr,
          packetLength,
        ).slice();
        return parseRuntimeSoundQueuePacket(packet);
      } finally {
        deallocWasm(exports, packetPtr, packetLength);
      }
    },
    runtimeSessionServiceTrace: (sessionHandle) => {
      const packetLength = exports.sakura_runtime_service_trace_packet_len();
      const packetPtr = allocWasm(exports, packetLength);
      try {
        const written = exports.sakura_runtime_session_service_trace_write(
          sessionHandle,
          packetPtr,
          packetLength,
        );
        if (written !== packetLength) {
          return null;
        }
        const packet = new Uint8Array(
          exports.memory.buffer,
          packetPtr,
          packetLength,
        ).slice();
        return parseRuntimeServiceTracePacket(packet);
      } finally {
        deallocWasm(exports, packetPtr, packetLength);
      }
    },
    runtimeSessionGraphQueue: (sessionHandle) => {
      const packetLength = exports.sakura_runtime_graph_queue_packet_len();
      const packetPtr = allocWasm(exports, packetLength);
      try {
        const written = exports.sakura_runtime_session_graph_queue_write(
          sessionHandle,
          packetPtr,
          packetLength,
        );
        if (written !== packetLength) {
          return null;
        }
        const packet = new Uint8Array(
          exports.memory.buffer,
          packetPtr,
          packetLength,
        ).slice();
        return parseRuntimeGraphQueuePacket(packet);
      } finally {
        deallocWasm(exports, packetPtr, packetLength);
      }
    },
    runtimeSessionMemory: (sessionHandle, address, length) => {
      const packetLength = exports.sakura_runtime_session_memory_len(
        sessionHandle,
        address >>> 0,
        length >>> 0,
      );
      if (packetLength === 0 || packetLength === error) {
        return null;
      }
      const packetPtr = allocWasm(exports, packetLength);
      try {
        const written = exports.sakura_runtime_session_memory_write(
          sessionHandle,
          address >>> 0,
          length >>> 0,
          packetPtr,
          packetLength,
        );
        if (written !== packetLength) {
          return null;
        }
        return new Uint8Array(exports.memory.buffer, packetPtr, packetLength).slice();
      } finally {
        deallocWasm(exports, packetPtr, packetLength);
      }
    },
    runtimeSessionStep: (
      sessionHandle,
      maxEvents = DEFAULT_RUNTIME_SESSION_MAX_EVENTS,
      maxInstructionsPerEvent = DEFAULT_RUNTIME_SESSION_MAX_INSTRUCTIONS,
    ) => {
      const packetLength = exports.sakura_runtime_session_step_packet_len();
      const packetPtr = allocWasm(exports, packetLength);
      try {
        const written = exports.sakura_runtime_session_step_write(
          sessionHandle,
          maxEvents,
          maxInstructionsPerEvent,
          packetPtr,
          packetLength,
        );
        if (written !== packetLength) {
          return null;
        }
        const packet = new Uint8Array(
          exports.memory.buffer,
          packetPtr,
          packetLength,
        ).slice();
        return parseRuntimeSessionStepPacket(packet);
      } finally {
        deallocWasm(exports, packetPtr, packetLength);
      }
    },
    runtimeSessionPendingAsset: (sessionHandle) => {
      const packetLength = exports.sakura_runtime_session_pending_asset_len(sessionHandle);
      if (packetLength === 0 || packetLength === error) {
        return null;
      }
      const packetPtr = allocWasm(exports, packetLength);
      try {
        const written = exports.sakura_runtime_session_pending_asset_write(
          sessionHandle,
          packetPtr,
          packetLength,
        );
        if (written !== packetLength) {
          return null;
        }
        const packet = new Uint8Array(
          exports.memory.buffer,
          packetPtr,
          packetLength,
        ).slice();
        return parseRuntimePendingAssetPacket(packet);
      } finally {
        deallocWasm(exports, packetPtr, packetLength);
      }
    },
    runtimeSessionSupplyAsset: (sessionHandle, name, payload) => {
      const namePtr = allocWasm(exports, name.byteLength);
      const payloadPtr = allocWasm(exports, payload.byteLength);
      try {
        new Uint8Array(exports.memory.buffer, namePtr, name.byteLength).set(name);
        new Uint8Array(exports.memory.buffer, payloadPtr, payload.byteLength).set(payload);
        return exports.sakura_runtime_session_supply_asset(
          sessionHandle,
          namePtr,
          name.byteLength,
          payloadPtr,
          payload.byteLength,
        );
      } finally {
        deallocWasm(exports, payloadPtr, payload.byteLength);
        deallocWasm(exports, namePtr, name.byteLength);
      }
    },
    scenarioSessionCreate: (payload) => {
      const ptr = allocWasm(exports, payload.byteLength);
      try {
        new Uint8Array(exports.memory.buffer, ptr, payload.byteLength).set(payload);
        return exports.sakura_scenario_session_create_from_dsc(ptr, payload.byteLength);
      } finally {
        deallocWasm(exports, ptr, payload.byteLength);
      }
    },
    scenarioSessionDestroy: (handle) => exports.sakura_scenario_session_destroy(handle),
    scenarioSessionClone: (handle) => exports.sakura_scenario_session_clone(handle),
    scenarioSessionMode: (handle) => exports.sakura_scenario_session_mode(handle),
    scenarioSessionAdvanceMessage: (handle) => (
      exports.sakura_scenario_session_advance_message(handle)
    ),
    scenarioSessionSelectChoice: (handle, index) => (
      exports.sakura_scenario_session_select_choice(handle, index)
    ),
    scenarioSessionSnapshot: (handle) => {
      const length = exports.sakura_scenario_session_snapshot_len(handle);
      if (length === error) {
        return null;
      }
      const ptr = allocWasm(exports, length);
      try {
        const written = exports.sakura_scenario_session_snapshot_write(handle, ptr, length);
        if (written !== length) {
          return null;
        }
        return new Uint8Array(exports.memory.buffer, ptr, length).slice();
      } finally {
        deallocWasm(exports, ptr, length);
      }
    },
    scenarioSessionRestoreSnapshot: (handle, snapshot) => {
      const ptr = allocWasm(exports, snapshot.byteLength);
      try {
        new Uint8Array(exports.memory.buffer, ptr, snapshot.byteLength).set(snapshot);
        return exports.sakura_scenario_session_restore_snapshot(handle, ptr, snapshot.byteLength);
      } finally {
        deallocWasm(exports, ptr, snapshot.byteLength);
      }
    },
    scenarioSessionStep: (handle) => {
      const packetLength = exports.sakura_scenario_session_step_packet_len();
      const packetPtr = allocWasm(exports, packetLength);
      try {
        const written = exports.sakura_scenario_session_step_write(
          handle,
          packetPtr,
          packetLength,
        );
        if (written !== packetLength) {
          return null;
        }
        const packet = new Uint8Array(
          exports.memory.buffer,
          packetPtr,
          packetLength,
        ).slice();
        return parseScenarioSessionStepPacket(packet);
      } finally {
        deallocWasm(exports, packetPtr, packetLength);
      }
    },
    scenarioSessionCurrentPayload: (handle) => {
      const length = exports.sakura_scenario_session_current_payload_len(handle);
      const ptr = allocWasm(exports, length);
      try {
        const written = exports.sakura_scenario_session_current_payload_write(handle, ptr, length);
        if (written !== length) {
          return new Uint8Array();
        }
        return new Uint8Array(exports.memory.buffer, ptr, length).slice();
      } finally {
        deallocWasm(exports, ptr, length);
      }
    },
    blitOver: ({ dest, destWidth, destHeight, source, sourceWidth, sourceHeight, x, y, opacity }) => {
      const destPtr = allocWasm(exports, dest.byteLength);
      const sourcePtr = allocWasm(exports, source.byteLength);
      try {
        new Uint8Array(exports.memory.buffer, destPtr, dest.byteLength).set(dest);
        new Uint8Array(exports.memory.buffer, sourcePtr, source.byteLength).set(source);
        const status = exports.sakura_rgba_blit_over(
          destPtr,
          dest.byteLength,
          destWidth,
          destHeight,
          sourcePtr,
          source.byteLength,
          sourceWidth,
          sourceHeight,
          x,
          y,
          opacity,
        );
        if (status !== 0) {
          return null;
        }
        return new Uint8Array(exports.memory.buffer, destPtr, dest.byteLength).slice();
      } finally {
        deallocWasm(exports, sourcePtr, source.byteLength);
        deallocWasm(exports, destPtr, dest.byteLength);
      }
    },
  };
}

function writeFixedPacket(exports, payload, packetLength, writer, parser) {
  const ptr = allocWasm(exports, payload.byteLength);
  try {
    new Uint8Array(exports.memory.buffer, ptr, payload.byteLength).set(payload);
    const packetPtr = allocWasm(exports, packetLength);
    try {
      const written = writer(ptr, payload.byteLength, packetPtr, packetLength);
      if (written !== packetLength) {
        return null;
      }
      const packet = new Uint8Array(exports.memory.buffer, packetPtr, packetLength).slice();
      return parser(packet);
    } finally {
      deallocWasm(exports, packetPtr, packetLength);
    }
  } finally {
    deallocWasm(exports, ptr, payload.byteLength);
  }
}

function parseRgbaPacket(packet) {
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  const width = view.getUint32(0, true);
  const height = view.getUint32(4, true);
  const stride = view.getUint32(8, true);
  const byteLength = view.getUint32(12, true);
  if (16 + byteLength !== packet.byteLength) {
    throw new Error("invalid RGBA packet length");
  }
  const pixels = packet.slice(16, 16 + byteLength);
  return { width, height, stride, pixels };
}

function parseScenarioSessionStepPacket(packet) {
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  if (view.getUint32(0, true) !== 1) {
    throw new Error("invalid scenario session step packet");
  }
  return {
    eventKind: view.getUint32(4, true),
    mode: view.getUint32(8, true),
    eventCount: view.getUint32(12, true),
    field16: view.getUint32(16, true),
    field20: view.getUint32(20, true),
    field24: view.getUint32(24, true),
    field28: view.getUint32(28, true),
    nameLength: view.getUint32(16, true),
    textLength: view.getUint32(20, true),
    optionCount: view.getUint32(24, true),
    stringArgCount: view.getUint32(28, true),
    payloadLength: view.getUint32(32, true),
    backlogLength: view.getUint32(36, true),
  };
}

function parseRuntimeBootPacket(packet) {
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  if (view.getUint32(0, true) !== 1) {
    throw new Error("invalid runtime boot packet");
  }
  return {
    entryIndex: view.getUint32(4, true),
    scriptCount: view.getUint32(8, true),
    systemScriptCount: view.getUint32(12, true),
    scenarioScriptCount: view.getUint32(16, true),
    assetCount: view.getUint32(20, true),
    canonicalAssetCount: view.getUint32(24, true),
    eventCount: view.getUint32(28, true),
    serviceEventCount: view.getUint32(32, true),
    userCallEventCount: view.getUint32(36, true),
    userLoadEventCount: view.getUint32(40, true),
    userReturnEventCount: view.getUint32(44, true),
    completed: view.getUint32(48, true),
    eventLimited: view.getUint32(52, true),
    maxCallDepth: view.getUint32(56, true),
    sys40Count: view.getUint32(60, true),
    graph88Count: view.getUint32(64, true),
    graph9cCount: view.getUint32(68, true),
    soundServiceCount: view.getUint32(72, true),
    hostState: parseRuntimeHostState(view, 76),
  };
}

function parseRuntimeSystemProbePacket(packet) {
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  if (view.getUint32(0, true) !== 1) {
    throw new Error("invalid runtime system probe packet");
  }
  return {
    scriptIndex: view.getUint32(4, true),
    offset: view.getUint32(8, true),
    scriptCount: view.getUint32(12, true),
    systemScriptCount: view.getUint32(16, true),
    scenarioScriptCount: view.getUint32(20, true),
    eventCount: view.getUint32(24, true),
    serviceEventCount: view.getUint32(28, true),
    userCallEventCount: view.getUint32(32, true),
    userReturnEventCount: view.getUint32(36, true),
    completed: view.getUint32(40, true),
    eventLimited: view.getUint32(44, true),
    graph88Count: view.getUint32(48, true),
    graph9cCount: view.getUint32(52, true),
    soundServiceCount: view.getUint32(56, true),
    maxCallDepth: view.getUint32(60, true),
    firstGraph88ArgCount: view.getUint32(64, true),
    firstGraph88TopKind: view.getUint32(68, true),
    firstGraph9cArgCount: view.getUint32(72, true),
    firstGraph9cTopKind: view.getUint32(76, true),
    hostState: parseRuntimeHostState(view, 80),
  };
}

function parseRuntimeHostState(view, offset) {
  return {
    serviceCount: view.getUint32(offset, true),
    lastFamily: view.getUint32(offset + 4, true),
    lastServiceId: view.getUint32(offset + 8, true),
    lastArgCount: view.getUint32(offset + 12, true),
    lastTopKind: view.getUint32(offset + 16, true),
    loadProgramCount: view.getUint32(offset + 20, true),
    fileQueryCount: view.getUint32(offset + 24, true),
    graphFormatCount: view.getUint32(offset + 28, true),
    graphRenderTextCount: view.getUint32(offset + 32, true),
    soundPlayCount: view.getUint32(offset + 36, true),
    soundServiceCount: view.getUint32(offset + 40, true),
    lastSoundServiceId: view.getUint32(offset + 44, true),
    lastSoundArgCount: view.getUint32(offset + 48, true),
    lastSoundTopKind: view.getUint32(offset + 52, true),
    lastSoundIntegerArgCount: view.getUint32(offset + 56, true),
    lastSoundMinIntegerArg: view.getUint32(offset + 60, true),
    lastSoundMaxIntegerArg: view.getUint32(offset + 64, true),
    lastAssetStringLen: view.getUint32(offset + 68, true),
    lastAssetStringHash: view.getUint32(offset + 72, true),
    lastAssetQueryServiceId: view.getUint32(offset + 76, true),
    lastAssetFound: view.getUint32(offset + 80, true),
    lastLoadedScriptStringLen: view.getUint32(offset + 84, true),
    lastLoadedScriptStringHash: view.getUint32(offset + 88, true),
    lastLoadedScriptFound: view.getUint32(offset + 92, true),
    soundAfterAssetQueryCount: view.getUint32(offset + 96, true),
  };
}

function parseRuntimeServiceTracePacket(packet) {
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  if (view.getUint32(0, true) !== 1) {
    throw new Error("invalid runtime service trace packet");
  }
  const recordedCount = view.getUint32(24, true);
  const events = [];
  let cursor = 40;
  for (let index = 0; index < recordedCount; index += 1) {
    events.push({
      eventIndex: view.getUint32(cursor, true),
      depth: view.getUint32(cursor + 4, true),
      family: view.getUint32(cursor + 8, true),
      serviceId: view.getUint32(cursor + 12, true),
      argCount: view.getUint32(cursor + 16, true),
      topKind: view.getUint32(cursor + 20, true),
      integerArgCount: view.getUint32(cursor + 24, true),
      minIntegerArg: view.getUint32(cursor + 28, true),
      maxIntegerArg: view.getUint32(cursor + 32, true),
      stringArgCount: view.getUint32(cursor + 36, true),
      firstStringLength: view.getUint32(cursor + 40, true),
      firstStringHash: view.getUint32(cursor + 44, true),
      instructionOffset: view.getUint32(cursor + 48, true),
    });
    cursor += 52;
  }
  return {
    scriptIndex: view.getUint32(4, true),
    offset: view.getUint32(8, true),
    eventCount: view.getUint32(12, true),
    serviceEventCount: view.getUint32(16, true),
    totalServiceCount: view.getUint32(20, true),
    recordedCount,
    recordLimit: view.getUint32(28, true),
    completed: view.getUint32(32, true),
    eventLimited: view.getUint32(36, true),
    hostState: parseRuntimeHostState(view, 1704),
    events,
  };
}

function parseRuntimeSoundQueuePacket(packet) {
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  if (view.getUint32(0, true) !== 1) {
    throw new Error("invalid runtime sound queue packet");
  }
  const recordedCount = view.getUint32(24, true);
  const events = [];
  let cursor = 32;
  const eventLength = 52 + RUNTIME_QUEUE_ARG_SLOTS * RUNTIME_QUEUE_ARG_SLOT_LEN;
  for (let index = 0; index < recordedCount; index += 1) {
    events.push({
      eventIndex: view.getUint32(cursor, true),
      depth: view.getUint32(cursor + 4, true),
      scriptIndex: view.getUint32(4, true),
      serviceId: view.getUint32(cursor + 8, true),
      argCount: view.getUint32(cursor + 12, true),
      family: view.getUint32(cursor + 16, true),
      topKind: view.getUint32(cursor + 20, true),
      integerArgCount: view.getUint32(cursor + 24, true),
      minIntegerArg: view.getUint32(cursor + 28, true),
      maxIntegerArg: view.getUint32(cursor + 32, true),
      stringArgCount: view.getUint32(cursor + 36, true),
      firstStringLength: view.getUint32(cursor + 40, true),
      firstStringHash: view.getUint32(cursor + 44, true),
      instructionOffset: view.getUint32(cursor + 48, true),
      args: parseRuntimeQueueArgs(view, cursor + 52, RUNTIME_QUEUE_ARG_SLOTS),
    });
    cursor += eventLength;
  }
  return {
    scriptIndex: view.getUint32(4, true),
    offset: view.getUint32(8, true),
    totalServiceCount: view.getUint32(12, true),
    recordedServiceCount: view.getUint32(16, true),
    recordLimit: view.getUint32(20, true),
    recordedCount,
    events,
  };
}

function parseRuntimeGraphQueuePacket(packet) {
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  if (view.getUint32(0, true) !== 1) {
    throw new Error("invalid runtime graph queue packet");
  }
  const recordedCount = view.getUint32(24, true);
  const events = [];
  let cursor = 32;
  const stringsOffsetBase = 52 + RUNTIME_QUEUE_ARG_SLOTS * RUNTIME_QUEUE_ARG_SLOT_LEN;
  const eventLength = 52
    + RUNTIME_QUEUE_ARG_SLOTS * RUNTIME_QUEUE_ARG_SLOT_LEN
    + RUNTIME_GRAPH_INLINE_STRING_HEADER_LEN
    + RUNTIME_GRAPH_INLINE_STRING_LIMIT * RUNTIME_GRAPH_INLINE_STRING_SLOT_LEN;
  for (let index = 0; index < recordedCount; index += 1) {
    events.push({
      eventIndex: view.getUint32(cursor, true),
      depth: view.getUint32(cursor + 4, true),
      scriptIndex: view.getUint32(4, true),
      serviceId: view.getUint32(cursor + 8, true),
      argCount: view.getUint32(cursor + 12, true),
      family: view.getUint32(cursor + 16, true),
      topKind: view.getUint32(cursor + 20, true),
      integerArgCount: view.getUint32(cursor + 24, true),
      minIntegerArg: view.getUint32(cursor + 28, true),
      maxIntegerArg: view.getUint32(cursor + 32, true),
      stringArgCount: view.getUint32(cursor + 36, true),
      firstStringLength: view.getUint32(cursor + 40, true),
      firstStringHash: view.getUint32(cursor + 44, true),
      instructionOffset: view.getUint32(cursor + 48, true),
      args: parseRuntimeQueueArgs(view, cursor + 52, RUNTIME_QUEUE_ARG_SLOTS),
      inlineStrings: parseRuntimeGraphInlineStrings(
        packet,
        view,
        cursor + stringsOffsetBase,
      ),
    });
    cursor += eventLength;
  }
  return {
    scriptIndex: view.getUint32(4, true),
    offset: view.getUint32(8, true),
    totalServiceCount: view.getUint32(12, true),
    recordedServiceCount: view.getUint32(16, true),
    recordLimit: view.getUint32(20, true),
    recordedCount,
    events,
  };
}

function parseRuntimeSessionStepPacket(packet) {
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  if (view.getUint32(0, true) !== 1) {
    throw new Error("invalid runtime session step packet");
  }
  return {
    sessionHandle: view.getUint32(4, true),
    eventCount: view.getUint32(8, true),
    serviceEventCount: view.getUint32(12, true),
    userCallEventCount: view.getUint32(16, true),
    userLoadEventCount: view.getUint32(20, true),
    userFreeEventCount: view.getUint32(24, true),
    userReturnEventCount: view.getUint32(28, true),
    haltedEventCount: view.getUint32(32, true),
    completed: view.getUint32(36, true) === 1,
    eventLimited: view.getUint32(40, true) === 1,
    maxCallDepth: view.getUint32(44, true),
    lastFamily: view.getUint32(48, true),
    lastServiceId: view.getUint32(52, true),
    lastArgCount: view.getUint32(56, true),
    lastTopKind: view.getUint32(60, true),
    hostServiceCount: view.getUint32(64, true),
    hostFileQueryCount: view.getUint32(68, true),
    hostGraphFormatCount: view.getUint32(72, true),
    hostGraphRenderTextCount: view.getUint32(76, true),
    hostSoundServiceCount: view.getUint32(80, true),
    hostLastAssetQueryServiceId: view.getUint32(84, true),
    hostLastAssetFound: view.getUint32(88, true) === 1,
    hostLastLoadedScriptStringLen: view.getUint32(92, true),
    hostLastLoadedScriptFound: view.getUint32(96, true) === 1,
    hostSoundAfterAssetQueryCount: view.getUint32(100, true),
    sys1cCount: view.getUint32(104, true),
    sys49Count: view.getUint32(108, true),
    sys5fCount: view.getUint32(112, true),
    graphBfCount: view.getUint32(116, true),
    frameScriptIndex: view.getUint32(120, true),
    frameCursor: view.getUint32(124, true),
    frameLastInstructionOffset: view.getUint32(128, true),
    local44: view.getUint32(132, true),
    local48: view.getUint32(136, true),
    local56: view.getUint32(140, true),
    local60: view.getUint32(144, true),
    local64: view.getUint32(148, true),
    local68: view.getUint32(152, true),
    local72: view.getUint32(156, true),
    local76: view.getUint32(160, true),
    local1076: view.getUint32(164, true),
    local1152: view.getUint32(168, true),
    local3952: view.getUint32(172, true),
    local3956: view.getUint32(176, true),
    local3980: view.getUint32(180, true),
    local3992: view.getUint32(184, true),
    local3996: view.getUint32(188, true),
    local4024: view.getUint32(192, true),
    local4028: view.getUint32(196, true),
    local4076: view.getUint32(200, true),
    local7100: view.getUint32(204, true),
    local7104: view.getUint32(208, true),
    local7108: view.getUint32(212, true),
    local7112: view.getUint32(216, true),
    pendingAsset: view.getUint32(220, true) === 1 ? {
      serviceId: view.getUint32(224, true),
      size: view.getUint32(228, true),
      nameLength: view.getUint32(232, true),
    } : null,
  };
}

function parseRuntimePendingAssetPacket(packet) {
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  if (view.getUint32(0, true) !== 1) {
    throw new Error("invalid runtime pending asset packet");
  }
  const nameLength = view.getUint32(12, true);
  if (16 + nameLength !== packet.byteLength) {
    throw new Error("invalid runtime pending asset packet length");
  }
  return {
    serviceId: view.getUint32(4, true),
    size: view.getUint32(8, true),
    nameLength,
    name: packet.slice(16, 16 + nameLength),
  };
}

function parseRuntimeQueueArgs(view, offset, count) {
  const args = [];
  for (let index = 0; index < count; index += 1) {
    const cursor = offset + index * 16;
    const kind = view.getUint32(cursor, true);
    if (kind === 0) {
      continue;
    }
    args.push({
      kind,
      value: view.getUint32(cursor + 4, true),
      len: view.getUint32(cursor + 8, true),
      hash: view.getUint32(cursor + 12, true),
    });
  }
  return args;
}

function parseRuntimeGraphInlineStrings(packet, view, offset) {
  const count = Math.min(
    view.getUint32(offset, true),
    RUNTIME_GRAPH_INLINE_STRING_LIMIT,
  );
  const strings = [];
  let cursor = offset + RUNTIME_GRAPH_INLINE_STRING_HEADER_LEN;
  for (let index = 0; index < count; index += 1) {
    const argIndex = view.getUint32(cursor, true);
    const byteLength = Math.min(
      view.getUint32(cursor + 4, true),
      RUNTIME_GRAPH_INLINE_STRING_MAX_BYTES,
    );
    const fullLength = view.getUint32(cursor + 8, true);
    const hash = view.getUint32(cursor + 12, true);
    const bytes = packet.slice(cursor + 16, cursor + 16 + byteLength);
    strings.push({
      argIndex,
      byteLength,
      fullLength,
      hash,
      bytes,
      text: decodeAsciiBytes(bytes),
    });
    cursor += RUNTIME_GRAPH_INLINE_STRING_SLOT_LEN;
  }
  return strings;
}

function decodeAsciiBytes(bytes) {
  let end = bytes.length;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 0) {
      end = index;
      break;
    }
  }
  return new TextDecoder("utf-8").decode(bytes.slice(0, end));
}

function parseNulSeparatedAscii(packet) {
  const decoder = new TextDecoder("ascii");
  const values = [];
  let cursor = 0;
  for (let index = 0; index < packet.byteLength; index += 1) {
    if (packet[index] !== 0) {
      continue;
    }
    if (index > cursor) {
      values.push(decoder.decode(packet.slice(cursor, index)).toLowerCase());
    }
    cursor = index + 1;
  }
  return values;
}
