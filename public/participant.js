const clientKey = "mobile-audience-led-client-id";
const joinedKey = "mobile-audience-led-joined";
const clientId = getClientId();

const text = {
  connecting: "\uc5f0\uacb0 \uc911",
  online: "\uc628\ub77c\uc778",
  keepAwakeOn: "\ud654\uba74 \uc720\uc9c0 \uc911",
  keepAwakeFail: "\ud654\uba74 \uc720\uc9c0 \uc2e4\ud328",
  eventLeft: "\ud589\uc0ac \uc2dc\uc791\uae4c\uc9c0 \ub0a8\uc740 \uc2dc\uac04",
  countdownLeft: "\uc810\ub4f1\uae4c\uc9c0 \ub0a8\uc740 \uc2dc\uac04",
  soon: "\uace7 \ud589\uc0ac\uac00 \uc2dc\uc791\ub429\ub2c8\ub2e4",
  full: "\uc785\uc7a5 \uc778\uc6d0\uc774 \ub9c8\uac10\ub418\uc5c8\uc2b5\ub2c8\ub2e4.",
};

const elements = {
  statusDot: document.querySelector("#statusDot"),
  statusText: document.querySelector("#statusText"),
  lobbySubtitle: document.querySelector("#lobbySubtitle"),
  waitingSubtitle: document.querySelector("#waitingSubtitle"),
  lobbyTitle: document.querySelector("#lobbyTitle"),
  waitingTitle: document.querySelector("#waitingTitle"),
  joinButton: document.querySelector("#joinButton"),
  keepAwake: document.querySelector("#keepAwake"),
  lobbyMessage: document.querySelector("#lobbyMessage"),
  lobby: document.querySelector("#lobby"),
  waiting: document.querySelector("#waiting"),
  countdown: document.querySelector("#countdown"),
  light: document.querySelector("#light"),
  lightText: document.querySelector("#lightText"),
  timer: document.querySelector("#timer"),
  timerCaption: document.querySelector("#timerCaption"),
  countNumber: document.querySelector("#countNumber"),
  seatLabel: document.querySelector("#seatLabel"),
  syncLabel: document.querySelector("#syncLabel"),
};

let currentSnapshot = null;
let wakeLock = null;
let timerHandle = null;
let syncLatencyMs = 0;
let serverSnapshotAt = Date.now();
let clientSnapshotAt = performance.now();

function getClientId() {
  const saved = localStorage.getItem(clientKey);
  if (saved) return saved;
  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  localStorage.setItem(clientKey, id);
  return id;
}

function setOnline(online) {
  elements.statusDot.style.background = online ? "#4ade80" : "#ffd85a";
  elements.statusText.textContent = online ? text.online : text.connecting;
}

function showOnly(name) {
  for (const key of ["lobby", "waiting", "countdown", "light"]) {
    elements[key].classList.toggle("is-hidden", key !== name);
  }
}

function formatMs(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function syncedNow() {
  return serverSnapshotAt + (performance.now() - clientSnapshotAt);
}

function setLight(color, brightness) {
  elements.light.style.background = color;
  elements.light.style.filter = `brightness(${brightness / 100})`;
}

function fitTitle(element, title) {
  const words = title.trim().split(/\s+/).filter(Boolean);
  const compactLength = words.join("").length;
  element.textContent = title;
  element.classList.remove("is-wrapped");
  element.style.fontSize = compactLength > 13 ? "clamp(24px, 7vw, 44px)" : "clamp(30px, 9vw, 56px)";

  requestAnimationFrame(() => {
    if (element.offsetParent === null || words.length < 2 || compactLength <= 8) return;
    if (element.scrollWidth <= element.clientWidth * 0.98) return;

    let bestIndex = 1;
    let bestBalance = Number.POSITIVE_INFINITY;
    for (let index = 1; index < words.length; index += 1) {
      const left = words.slice(0, index).join(" ");
      const right = words.slice(index).join(" ");
      const balance = Math.abs([...left].length - [...right].length);
      if (balance < bestBalance) {
        bestBalance = balance;
        bestIndex = index;
      }
    }

    element.innerHTML = `${words.slice(0, bestIndex).join(" ")}<br>${words.slice(bestIndex).join(" ")}`;
    element.classList.add("is-wrapped");
  });
}

function fitVisibleTitles(title) {
  fitTitle(elements.lobbyTitle, title);
  fitTitle(elements.waitingTitle, title);
}

function me(snapshot) {
  return snapshot.participants.find((item) => item.id === clientId);
}

function myColor(snapshot) {
  return me(snapshot)?.color || snapshot.state.color;
}

function myBrightness(snapshot) {
  return me(snapshot)?.brightness || snapshot.state.brightness;
}

function render(snapshot) {
  currentSnapshot = snapshot;
  if (typeof snapshot.serverNow === "number") {
    serverSnapshotAt = snapshot.serverNow;
    clientSnapshotAt = performance.now();
  }
  const participant = me(snapshot);
  const title = snapshot.state.title;
  const subtitle = snapshot.state.subtitle;

  if (participant) {
    elements.seatLabel.textContent = participant.seat;
  }

  elements.lobbySubtitle.textContent = subtitle;
  elements.waitingSubtitle.textContent = subtitle;
  elements.lobbyTitle.textContent = title;
  elements.waitingTitle.textContent = title;
  elements.syncLabel.textContent = `-${syncLatencyMs}ms`;
  elements.light.dataset.mode = snapshot.state.mode;
  setLight(myColor(snapshot), myBrightness(snapshot));

  if (!localStorage.getItem(joinedKey)) {
    showOnly("lobby");
    fitVisibleTitles(title);
    return;
  }

  if (snapshot.state.phase === "countdown") {
    showOnly("countdown");
  } else if (snapshot.state.phase === "light") {
    showOnly("light");
  } else if (snapshot.state.phase === "off") {
    setLight("#020617", snapshot.state.brightness);
    showOnly("light");
  } else {
    showOnly("waiting");
  }

  fitVisibleTitles(title);
  startTimer();
}

function targetTime(snapshot) {
  if (snapshot.state.phase === "countdown") {
    elements.timerCaption.textContent = text.countdownLeft;
    return snapshot.state.countdownTo;
  }
  elements.timerCaption.textContent = text.eventLeft;
  return snapshot.state.startAt;
}

function startTimer() {
  clearInterval(timerHandle);
  timerHandle = setInterval(() => {
    if (!currentSnapshot) return;
    const target = targetTime(currentSnapshot);
    const now = syncedNow();
    const left = target ? target - now : 0;
    elements.timer.textContent = left > 0 ? formatMs(left) : "00:00:00";
    const countdownLeft = currentSnapshot.state.countdownTo ? currentSnapshot.state.countdownTo - now : 0;
    elements.countNumber.textContent = String(Math.max(0, Math.ceil(countdownLeft / 1000)));
    if (currentSnapshot.state.phase === "lobby" && left <= 0) {
      elements.timerCaption.textContent = text.soon;
    }
  }, 200);
}

async function join() {
  const startedAt = performance.now();
  const response = await fetch("/api/join", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientId }),
  });
  const data = await response.json();
  if (!response.ok) {
    elements.lobbyMessage.textContent = text.full;
    if (data.snapshot) {
      syncLatencyMs = Math.round((performance.now() - startedAt) / 2);
      render(data.snapshot);
    }
    return;
  }
  localStorage.setItem(joinedKey, "1");
  syncLatencyMs = Math.round((performance.now() - startedAt) / 2);
  render(data.snapshot);
}

async function heartbeat() {
  if (!localStorage.getItem(joinedKey)) return;
  const startedAt = performance.now();
  const response = await fetch("/api/heartbeat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientId }),
  }).catch(() => {});
  if (!response?.ok) return;
  const data = await response.json().catch(() => null);
  if (data?.snapshot) {
    syncLatencyMs = Math.round((performance.now() - startedAt) / 2);
    render(data.snapshot);
  }
}

function leave() {
  if (!localStorage.getItem(joinedKey)) return;
  const payload = JSON.stringify({ clientId });
  if (navigator.sendBeacon) {
    navigator.sendBeacon("/api/leave", new Blob([payload], { type: "application/json" }));
    return;
  }
  fetch("/api/leave", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: payload,
    keepalive: true,
  }).catch(() => {});
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    elements.keepAwake.textContent = text.keepAwakeOn;
  } catch {
    elements.keepAwake.textContent = text.keepAwakeFail;
  }
}

function connectEvents() {
  const events = new EventSource("/events");
  events.addEventListener("open", () => setOnline(true));
  events.addEventListener("error", () => setOnline(false));
  for (const eventName of ["snapshot", "command"]) {
    events.addEventListener(eventName, (event) => {
      syncLatencyMs = 0;
      render(JSON.parse(event.data));
    });
  }
}

elements.joinButton.addEventListener("click", join);
elements.keepAwake.addEventListener("click", requestWakeLock);

if (localStorage.getItem(joinedKey)) {
  join();
}

connectEvents();
heartbeat();
setInterval(heartbeat, 5000);
document.addEventListener("visibilitychange", heartbeat);
window.addEventListener("pagehide", leave);
