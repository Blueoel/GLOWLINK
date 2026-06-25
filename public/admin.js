const palette = ["#ffffff", "#ff3b30", "#ffd84d", "#ff9f0a", "#a855f7", "#3478f6", "#22d3ee", "#34d399"];
const phaseNames = {
  lobby: "\ub300\uae30",
  countdown: "\uce74\uc6b4\ud2b8\ub2e4\uc6b4",
  light: "\uc810\ub4f1",
  off: "\uc885\ub8cc",
};

const modeNames = {
  solid: "\uc804\uccb4 \uc810\ub4f1",
  mix: "\ud63c\ud569 \ub8e8\ud504",
  random: "\ub79c\ub364 \ub8e8\ud504",
};

const text = {
  connected: "\uc11c\ubc84 \uc5f0\uacb0\ub428",
  reconnecting: "\uc11c\ubc84 \uc7ac\uc5f0\uacb0\uc911",
  sent: "\uba85\ub839\uc774 \ucc38\uac00\uc790 \ud654\uba74\uc5d0 \uc804\uc1a1\ub418\uc5c8\uc2b5\ub2c8\ub2e4.",
  saved: "\ud589\uc0ac \uc124\uc815\uc774 \uc800\uc7a5\ub418\uc5c8\uc2b5\ub2c8\ub2e4.",
  reset: "\ucc38\uac00\uc790 \ubaa9\ub85d\uc744 \ucd08\uae30\ud654\ud588\uc2b5\ub2c8\ub2e4.",
  authFailed: "\uad00\ub9ac\uc790 PIN\uc774 \ud544\uc694\ud569\ub2c8\ub2e4.",
};

const adminPinKey = "glowlink-admin-pin";

const state = {
  selectedColor: "#ffffff",
  brightness: 85,
  snapshot: null,
  saveDraftTimer: null,
  draft: {
    title: "",
    subtitle: "",
    startAt: null,
    capacity: 300,
  },
  dirty: new Set(),
};

const elements = {
  badge: document.querySelector("#serverBadge"),
  currentStep: document.querySelector("#currentStepValue"),
  currentMode: document.querySelector("#currentModeValue"),
  currentCount: document.querySelector("#currentCountValue"),
  adminTitle: document.querySelector("#adminTitle"),
  adminSubtitle: document.querySelector("#adminSubtitle"),
  grid: document.querySelector("#seatGrid"),
  phase: document.querySelector("#phaseLabel"),
  swatches: document.querySelector("#swatches"),
  brightness: document.querySelector("#brightness"),
  brightnessValue: document.querySelector("#brightnessValue"),
  titleInput: document.querySelector("#titleInput"),
  subtitleInput: document.querySelector("#subtitleInput"),
  startTimeInput: document.querySelector("#startTimeInput"),
  countdownSeconds: document.querySelector("#countdownSeconds"),
  capacityInput: document.querySelector("#capacityInput"),
  saveTitle: document.querySelector("#saveTitle"),
  resetAll: document.querySelector("#resetAll"),
  footerStatus: document.querySelector("#footerStatus"),
  previewSubtitle: document.querySelector("#previewSubtitle"),
  previewText: document.querySelector("#previewText"),
  previewSeat: document.querySelector("#previewSeat"),
  previewScreen: document.querySelector(".preview-screen"),
};

function localDateTimeValue(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 16);
}

function timestampFromInput(value) {
  return value ? new Date(value).getTime() : null;
}

function settingsPayload() {
  return {
    title: state.draft.title || elements.titleInput.value,
    subtitle: state.draft.subtitle || elements.subtitleInput.value,
    startAt: state.draft.startAt ?? timestampFromInput(elements.startTimeInput.value),
    capacity: Number(state.draft.capacity || elements.capacityInput.value || 300),
  };
}

function syncDraftFromSnapshot(snapshot) {
  if (!state.dirty.has("title")) state.draft.title = snapshot.state.title;
  if (!state.dirty.has("subtitle")) state.draft.subtitle = snapshot.state.subtitle;
  if (!state.dirty.has("startAt")) state.draft.startAt = snapshot.state.startAt;
  if (!state.dirty.has("capacity")) state.draft.capacity = snapshot.maxParticipants;
}

function syncInput(name, input, value) {
  if (!state.dirty.has(name) && document.activeElement !== input) {
    input.value = value ?? "";
  }
}

function scheduleSettingsSave(delay = 700) {
  clearTimeout(state.saveDraftTimer);
  state.saveDraftTimer = setTimeout(() => {
    sendCommand(
      { phase: state.snapshot?.state.phase || "lobby", mode: state.snapshot?.state.mode || "solid" },
      text.saved,
    );
  }, delay);
}

function bindDraft(input, name, readValue = () => input.value) {
  input.addEventListener("input", () => {
    state.dirty.add(name);
    state.draft[name] = readValue();
    if (name === "title") elements.previewText.textContent = state.draft.title;
    if (name === "subtitle") elements.previewSubtitle.textContent = state.draft.subtitle;
    scheduleSettingsSave();
  });
  input.addEventListener("change", () => {
    state.dirty.add(name);
    state.draft[name] = readValue();
    scheduleSettingsSave(0);
  });
}

async function adminFetch(path, options = {}, retried = false) {
  const headers = {
    "content-type": "application/json",
    ...(options.headers || {}),
  };
  const pin = localStorage.getItem(adminPinKey);
  if (pin) headers["x-admin-pin"] = pin;

  const response = await fetch(path, { ...options, headers });
  if (response.status !== 401 || retried) {
    return response;
  }

  const nextPin = window.prompt("관리자 PIN을 입력해주세요.");
  if (!nextPin) {
    return response;
  }
  localStorage.setItem(adminPinKey, nextPin);
  return adminFetch(path, options, true);
}

function createGrid(capacity = 300) {
  elements.grid.replaceChildren();
  for (let index = 0; index < capacity; index += 1) {
    const dot = document.createElement("div");
    dot.className = "seat-dot";
    dot.title = `A${String(index + 1).padStart(2, "0")}`;
    elements.grid.append(dot);
  }
}

function createSwatches() {
  elements.swatches.replaceChildren();
  for (const color of palette) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "swatch";
    button.style.setProperty("--swatch", color);
    button.title = color;
    button.addEventListener("click", () => {
      state.selectedColor = color;
      updateSwatches();
      sendCommand({ phase: "light", mode: "solid", color });
    });
    elements.swatches.append(button);
  }
  updateSwatches();
}

function updateSwatches() {
  for (const button of elements.swatches.children) {
    button.classList.toggle("is-selected", button.title === state.selectedColor);
  }
}

function render(snapshot) {
  const previousCapacity = state.snapshot?.maxParticipants;
  state.snapshot = snapshot;
  syncDraftFromSnapshot(snapshot);

  if (previousCapacity !== snapshot.maxParticipants || elements.grid.children.length !== snapshot.maxParticipants) {
    createGrid(snapshot.maxParticipants);
  }

  elements.adminTitle.textContent = snapshot.state.title;
  elements.adminSubtitle.textContent = snapshot.state.subtitle;
  elements.phase.textContent = `${phaseNames[snapshot.state.phase] || snapshot.state.phase} · ${snapshot.state.mode}`;
  elements.currentStep.textContent = phaseNames[snapshot.state.phase] || snapshot.state.phase;
  elements.currentMode.textContent = modeNames[snapshot.state.mode] || snapshot.state.mode;
  elements.currentCount.textContent = `${snapshot.count} / ${snapshot.maxParticipants}`;
  elements.grid.dataset.mode = snapshot.state.mode;
  syncInput("title", elements.titleInput, state.draft.title);
  syncInput("subtitle", elements.subtitleInput, state.draft.subtitle);
  syncInput("startAt", elements.startTimeInput, localDateTimeValue(state.draft.startAt));
  syncInput("capacity", elements.capacityInput, state.draft.capacity);
  if (document.activeElement !== elements.brightness) {
    elements.brightness.value = snapshot.state.brightness;
  }
  elements.brightnessValue.textContent = `${elements.brightness.value}%`;
  elements.previewText.textContent = state.draft.title || snapshot.state.title;
  elements.previewSubtitle.textContent = state.draft.subtitle || snapshot.state.subtitle;

  const dots = [...elements.grid.children];
  for (const dot of dots) {
    dot.style.background = "rgba(166, 184, 220, 0.56)";
    dot.style.opacity = "1";
    dot.style.boxShadow = "inset 0 0 0 1px rgba(255, 255, 255, 0.08)";
  }

  for (const participant of snapshot.participants) {
    const dot = dots[participant.slot - 1];
    if (!dot) continue;
    const isWaiting = snapshot.state.phase === "lobby" || participant.color === "#111827";
    dot.style.background = isWaiting ? "rgba(133, 145, 172, 0.42)" : participant.color;
    dot.style.opacity = isWaiting ? "1" : String(Math.max(0.18, participant.brightness / 100));
    dot.style.boxShadow = isWaiting ? "inset 0 0 0 1px rgba(255, 255, 255, 0.08)" : `0 0 ${Math.max(6, participant.brightness / 5)}px ${participant.color}`;
    dot.title = `${participant.seat} · ${participant.color} · ${participant.brightness}%`;
  }

  const first = snapshot.participants[0];
  elements.previewSeat.textContent = first?.seat || "A01";
  elements.previewScreen.style.background = first
    ? `radial-gradient(circle at center, ${first.color} 0%, #081126 72%)`
    : "radial-gradient(circle at center, rgba(67, 117, 255, 0.2), transparent 44%), #081126";
}

async function sendCommand(command, statusText = text.sent) {
  const body = {
    brightness: state.brightness,
    ...settingsPayload(),
    color: command.color ?? state.snapshot?.state.color ?? state.selectedColor,
    ...command,
  };
  const response = await adminFetch("/api/command", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    elements.footerStatus.textContent = text.authFailed;
    return;
  }
  const snapshot = await response.json();
  if (snapshot.state.title === state.draft.title) state.dirty.delete("title");
  if (snapshot.state.subtitle === state.draft.subtitle) state.dirty.delete("subtitle");
  if (snapshot.state.startAt === state.draft.startAt) state.dirty.delete("startAt");
  if (snapshot.maxParticipants === Number(state.draft.capacity)) state.dirty.delete("capacity");
  render(snapshot);
  elements.footerStatus.textContent = statusText;
}

function bindControls() {
  bindDraft(elements.titleInput, "title");
  bindDraft(elements.subtitleInput, "subtitle");
  bindDraft(elements.startTimeInput, "startAt", () => timestampFromInput(elements.startTimeInput.value));
  bindDraft(elements.capacityInput, "capacity", () => Number(elements.capacityInput.value || 300));

  document.querySelectorAll("[data-command]").forEach((button) => {
    button.addEventListener("click", () => {
      const command = button.dataset.command;
      if (command === "wait") {
        sendCommand({ phase: "lobby", mode: "solid", color: "#111827", countdownTo: null });
      }
      if (command === "countdown") {
        const seconds = Number(elements.countdownSeconds.value || 30);
        sendCommand({ phase: "countdown", mode: "solid", color: state.selectedColor, countdownSeconds: seconds });
      }
      if (command === "light") {
        sendCommand({ phase: "light", mode: "solid", color: state.selectedColor, countdownTo: null });
      }
      if (command === "mix") {
        sendCommand({ phase: "light", mode: "mix", palette, countdownTo: null });
      }
      if (command === "random") {
        sendCommand({ phase: "light", mode: "random", palette, countdownTo: null });
      }
      if (command === "off") {
        sendCommand({ phase: "off", mode: "solid", color: "#020617", countdownTo: null });
      }
    });
  });

  elements.brightness.addEventListener("input", () => {
    state.brightness = Number(elements.brightness.value);
    elements.brightnessValue.textContent = `${state.brightness}%`;
  });

  elements.brightness.addEventListener("change", () => {
    sendCommand({ phase: state.snapshot?.state.phase || "lobby", mode: state.snapshot?.state.mode || "solid" });
  });

  elements.saveTitle.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });

  elements.saveTitle.addEventListener("click", () => {
    clearTimeout(state.saveDraftTimer);
    sendCommand({ phase: state.snapshot?.state.phase || "lobby", mode: state.snapshot?.state.mode || "solid" }, text.saved);
  });

  elements.resetAll.addEventListener("click", async () => {
    const response = await adminFetch("/api/reset", { method: "POST" });
    if (!response.ok) {
      elements.footerStatus.textContent = text.authFailed;
      return;
    }
    state.dirty.clear();
    render(await response.json());
    elements.footerStatus.textContent = text.reset;
  });
}

function connectEvents() {
  const events = new EventSource("/events");
  events.addEventListener("open", () => {
    elements.badge.textContent = text.connected;
  });
  events.addEventListener("error", () => {
    elements.badge.textContent = text.reconnecting;
  });
  for (const eventName of ["snapshot", "command"]) {
    events.addEventListener(eventName, (event) => render(JSON.parse(event.data)));
  }
}

createGrid();
createSwatches();
bindControls();
connectEvents();
