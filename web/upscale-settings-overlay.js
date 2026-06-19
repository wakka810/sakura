import {
  normalizeUpscaleSettings,
  readUpscaleCapabilities,
  UPSCALE_SETTING_OPTIONS,
} from "./upscale-client.js";

const MODEL_LABELS = Object.freeze({
  waifu2x: "waifu2x",
  hat: "HAT",
  realesrgan: "Real-ESRGAN",
});
const MODE_LABELS = Object.freeze({
  fast: "Fast",
  quality: "Quality",
});

export function createUpscaleSettingsControls(options = {}) {
  const state = {
    settings: normalizeUpscaleSettings(options.settings),
    availableModels: new Set(),
  };
  const root = document.createElement("div");
  root.className = "engine-manager__upscale";

  const enabled = createCheckbox("Enable", state.settings.upscaleEnabled, (value) => {
    updateSettings({ upscaleEnabled: value });
  });
  const scale = createSelect(
    "Scale",
    UPSCALE_SETTING_OPTIONS.scales.map((value) => ({ value, label: `${value}x` })),
    state.settings.upscaleScale,
    (value) => updateSettings({ upscaleScale: Number.parseInt(value, 10) }),
  );
  const model = createSelect(
    "Model",
    UPSCALE_SETTING_OPTIONS.models.map((value) => ({ value, label: MODEL_LABELS[value] ?? value })),
    state.settings.upscaleModel,
    (value) => updateSettings({ upscaleModel: value }),
  );
  const mode = createSelect(
    "Mode",
    UPSCALE_SETTING_OPTIONS.modes.map((value) => ({ value, label: MODE_LABELS[value] ?? value })),
    state.settings.upscaleQualityMode,
    (value) => updateSettings({ upscaleQualityMode: value }),
  );
  const status = document.createElement("div");
  status.className = "engine-manager__status";

  root.append(enabled.row, scale.row, model.row, mode.row, status);

  function render() {
    enabled.input.checked = state.settings.upscaleEnabled === true;
    scale.input.value = String(state.settings.upscaleScale);
    model.input.value = state.settings.upscaleModel;
    mode.input.value = state.settings.upscaleQualityMode;
    for (const option of model.input.options) {
      option.disabled = state.availableModels.size > 0 && !state.availableModels.has(option.value);
    }
    const modelReady = state.availableModels.size === 0 || state.availableModels.has(state.settings.upscaleModel);
    status.textContent = modelReady ? "Server ready" : "Model unavailable";
  }

  function updateSettings(next) {
    state.settings = normalizeUpscaleSettings({ ...state.settings, ...next });
    options.onChange?.(state.settings);
    render();
  }

  const api = {
    element: root,
    get settings() {
      return state.settings;
    },
    setSettings(settings) {
      state.settings = normalizeUpscaleSettings(settings);
      render();
    },
    refreshCapabilities,
  };

  async function refreshCapabilities() {
    const capabilities = await readUpscaleCapabilities();
    state.availableModels = new Set(
      Array.isArray(capabilities?.models)
        ? capabilities.models.filter((entry) => entry.available === true).map((entry) => entry.id)
        : [],
    );
    render();
  }

  void refreshCapabilities();
  render();
  return api;
}

function createCheckbox(label, checked, onChange) {
  const row = document.createElement("label");
  row.className = "engine-manager__row engine-manager__row--toggle";
  const text = document.createElement("span");
  text.textContent = label;
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked === true;
  input.addEventListener("change", () => onChange(input.checked));
  row.append(text, input);
  return { row, input };
}

function createSelect(label, values, selected, onChange) {
  const row = document.createElement("label");
  row.className = "engine-manager__row";
  const text = document.createElement("span");
  text.textContent = label;
  const input = document.createElement("select");
  for (const item of values) {
    const option = document.createElement("option");
    option.value = String(item.value);
    option.textContent = item.label;
    input.append(option);
  }
  input.value = String(selected);
  input.addEventListener("change", () => onChange(input.value));
  row.append(text, input);
  return { row, input };
}
