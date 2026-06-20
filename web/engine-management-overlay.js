import { createUpscaleSettingsControls } from "./upscale-settings-overlay.js";

const TABS = Object.freeze(["cloud", "progress", "system", "upscale"]);
const TAB_LABELS = Object.freeze({
  cloud: "Cloud",
  progress: "Progress",
  system: "System",
  upscale: "Upscale",
});

export function createEngineManagementOverlay(options = {}) {
  const state = {
    open: false,
    activeTab: "cloud",
    busy: false,
    status: "",
    cloudMetadata: null,
  };
  const root = document.createElement("div");
  root.className = "engine-manager";
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Engine manager");

  root.addEventListener("pointerdown", stopOverlayEvent);
  root.addEventListener("click", stopOverlayEvent);
  root.addEventListener("wheel", stopOverlayEvent, { passive: false });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      api.close();
      event.preventDefault();
    }
    event.stopPropagation();
  });

  const title = document.createElement("div");
  title.className = "engine-manager__title";
  title.textContent = "Engine";

  const closeButton = button("x", "engine-manager__close", () => api.close());
  closeButton.setAttribute("aria-label", "Close");

  const fullscreenButton = button("Fullscreen", "engine-manager__fullscreen", () => {
    void runFullscreenToggle();
  });
  fullscreenButton.setAttribute("aria-label", "Toggle fullscreen");

  const headerActions = document.createElement("div");
  headerActions.className = "engine-manager__header-actions";
  headerActions.append(fullscreenButton, closeButton);

  const header = document.createElement("div");
  header.className = "engine-manager__header";
  header.append(title, headerActions);

  const tabs = document.createElement("div");
  tabs.className = "engine-manager__tabs";
  const tabButtons = new Map();
  for (const tab of TABS) {
    const tabButton = button(TAB_LABELS[tab], "engine-manager__tab", () => {
      state.activeTab = tab;
      render();
      if (tab === "cloud") {
        void refreshCloudState({ quiet: true });
      }
      if (tab === "upscale") {
        void upscaleControls.refreshCapabilities();
      }
    });
    tabButton.dataset.tab = tab;
    tabs.append(tabButton);
    tabButtons.set(tab, tabButton);
  }

  const content = document.createElement("div");
  content.className = "engine-manager__content";

  const status = document.createElement("div");
  status.className = "engine-manager__status";

  const upscaleControls = createUpscaleSettingsControls({
    settings: options.upscaleSettings,
    onChange: (settings) => options.onUpscaleChange?.(settings),
  });

  root.append(header, tabs, content, status);

  function render() {
    root.hidden = !state.open;
    root.classList.toggle("engine-manager--open", state.open);
    root.dataset.activeTab = state.activeTab;
    const fullscreen = readFullscreenState();
    fullscreenButton.textContent = fullscreen.active ? "Window" : "Fullscreen";
    fullscreenButton.disabled = !fullscreen.canToggle;
    fullscreenButton.setAttribute("aria-pressed", String(fullscreen.active));
    for (const [tab, tabButton] of tabButtons) {
      const selected = tab === state.activeTab;
      tabButton.classList.toggle("is-active", selected);
      tabButton.setAttribute("aria-selected", String(selected));
    }
    status.textContent = state.status;
    content.replaceChildren();
    if (!state.open) {
      return;
    }
    if (state.activeTab === "cloud") {
      content.append(renderCloudTab());
    } else if (state.activeTab === "progress") {
      content.append(renderProgressTab());
    } else if (state.activeTab === "system") {
      content.append(renderSystemTab());
    } else {
      content.append(upscaleControls.element);
    }
  }

  function renderCloudTab() {
    const panel = section();
    const metadata = state.cloudMetadata;
    panel.append(keyValueList([
      ["Server save", metadata ? "Available" : "None"],
      ["Saved at", metadata?.savedAt ?? ""],
      ["Keys", metadata ? String(metadata.keyCount ?? 0) : "0"],
      ["Size", metadata ? formatBytes(metadata.byteLength ?? 0) : "0 B"],
    ]));
    const actions = document.createElement("div");
    actions.className = "engine-manager__actions";
    actions.append(
      button("Cloud Save", "engine-manager__action", () => {
        void runCloudSave();
      }, state.busy),
      button("Cloud Load", "engine-manager__action", () => {
        void runCloudLoad();
      }, state.busy || !metadata),
      button("Refresh", "engine-manager__action", () => {
        void refreshCloudState({ quiet: false });
      }, state.busy),
    );
    panel.append(actions);
    return panel;
  }

  function renderProgressTab() {
    const info = options.readSystemInfo?.() ?? {};
    const progress = info.progress ?? {};
    const viewed = progress.viewed ?? {};
    const quickSave = progress.quickSaveExists ? "Yes" : "No";
    return keyValueList([
      ["Save slots", `${progress.saveSlotCount ?? 0}/${progress.saveSlotTotal ?? 0}`],
      ["Quick save", quickSave],
      ["Title clears", String(progress.titleClearRouteCount ?? 0)],
      ["Read events", String(progress.readEventCount ?? 0)],
      ["Viewed CG", String(viewed.cg ?? 0)],
      ["Viewed BGM", String(viewed.bgm ?? 0)],
      ["Viewed scenes", String(viewed.scene ?? 0)],
      ["Viewed movies", String(viewed.movie ?? 0)],
      ["Storage keys", String(progress.localStorageKeyCount ?? 0)],
      ["Storage size", formatBytes(progress.localStorageBytes ?? 0)],
    ]);
  }

  function renderSystemTab() {
    const info = options.readSystemInfo?.() ?? {};
    const system = info.system ?? {};
    return keyValueList([
      ["Mounted", system.mounted ? "Yes" : "No"],
      ["Stage", system.stage ?? ""],
      ["Scenario", system.scenarioName ?? ""],
      ["Route", system.scenarioRoute ?? ""],
      ["Event", String(system.eventCount ?? 0)],
      ["Canvas", system.canvas ?? ""],
      ["Audio queued", String(system.audioQueued ?? 0)],
      ["Runtime ready", system.runtimeReady ? "Yes" : "No"],
      ["Upscale", system.upscale ?? ""],
    ]);
  }

  async function runCloudSave() {
    await runAction("Saving cloud state...", async () => {
      const result = await options.onCloudSave?.();
      if (result?.metadata) {
        state.cloudMetadata = result.metadata;
      }
      return `Saved ${result?.metadata?.keyCount ?? 0} keys`;
    });
  }

  async function runCloudLoad() {
    const confirmed = typeof globalThis.confirm === "function"
      ? globalThis.confirm("Cloud Load will replace this browser's Sakura data.")
      : true;
    if (!confirmed) {
      state.status = "Cloud load cancelled";
      render();
      return;
    }
    await runAction("Loading cloud state...", async () => {
      const result = await options.onCloudLoad?.();
      if (result?.metadata) {
        state.cloudMetadata = result.metadata;
      }
      return `Loaded ${result?.restoredKeyCount ?? 0} keys`;
    });
  }

  async function refreshCloudState({ quiet } = {}) {
    if (!quiet) {
      state.busy = true;
      state.status = "Refreshing cloud state...";
      render();
    }
    try {
      const result = await options.onCloudRefresh?.();
      state.cloudMetadata = result?.metadata ?? null;
      if (!quiet) {
        state.status = state.cloudMetadata ? "Cloud state ready" : "No cloud save";
      }
    } catch (error) {
      if (!quiet) {
        state.status = errorMessage(error);
      }
    } finally {
      if (!quiet) {
        state.busy = false;
      }
      render();
    }
  }

  async function runFullscreenToggle() {
    const before = readFullscreenState();
    if (!before.canToggle) {
      state.status = "Fullscreen unavailable";
      render();
      return;
    }
    state.status = before.active ? "Leaving fullscreen..." : "Entering fullscreen...";
    render();
    try {
      const result = await options.onFullscreenToggle?.();
      state.status = fullscreenStatus(result);
    } catch (error) {
      state.status = errorMessage(error);
    } finally {
      render();
    }
  }

  function readFullscreenState() {
    const fullscreen = options.readFullscreenState?.() ?? {};
    const active = fullscreen.active === true;
    const available = fullscreen.available === true;
    return {
      active,
      available,
      canToggle: available || active,
    };
  }

  async function runAction(pendingText, action) {
    state.busy = true;
    state.status = pendingText;
    render();
    try {
      state.status = await action();
    } catch (error) {
      state.status = errorMessage(error);
    } finally {
      state.busy = false;
      render();
    }
  }

  const api = {
    element: root,
    get settings() {
      return upscaleControls.settings;
    },
    get openState() {
      return state.open;
    },
    get activeTab() {
      return state.activeTab;
    },
    setUpscaleSettings(settings) {
      upscaleControls.setSettings(settings);
      render();
    },
    open(tab = state.activeTab) {
      state.open = true;
      if (TABS.includes(tab)) {
        state.activeTab = tab;
      }
      render();
      void refreshCloudState({ quiet: true });
      if (state.activeTab === "upscale") {
        void upscaleControls.refreshCapabilities();
      }
    },
    close() {
      state.open = false;
      render();
    },
    toggle(tab = state.activeTab) {
      if (state.open) {
        api.close();
      } else {
        api.open(tab);
      }
    },
    refresh() {
      render();
    },
  };

  render();
  return api;
}

function keyValueList(entries) {
  const list = document.createElement("dl");
  list.className = "engine-manager__kv";
  for (const [key, value] of entries) {
    const term = document.createElement("dt");
    term.textContent = key;
    const detail = document.createElement("dd");
    detail.textContent = String(value ?? "");
    list.append(term, detail);
  }
  return list;
}

function section() {
  const element = document.createElement("div");
  element.className = "engine-manager__section";
  return element;
}

function button(label, className, onClick, disabled = false) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  element.disabled = disabled === true;
  element.addEventListener("click", onClick);
  return element;
}

function formatBytes(value) {
  const bytes = Number.isFinite(value) && value > 0 ? value : 0;
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function fullscreenStatus(result) {
  if (!result?.ok) {
    return "Fullscreen unavailable";
  }
  if (result.reason === "fullscreen_requested" || result.reason === "already_fullscreen") {
    return "Fullscreen active";
  }
  if (result.reason === "exit_fullscreen_requested" || result.reason === "already_window") {
    return "Window mode active";
  }
  return result.reason ?? "";
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function stopOverlayEvent(event) {
  event.stopPropagation();
}
