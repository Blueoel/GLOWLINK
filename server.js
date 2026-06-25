import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";
const adminPin = process.env.ADMIN_PIN || "";

const staleAfterMs = 15000;
const defaultPalette = ["#ffffff", "#ff3b30", "#ffd84d", "#ff9f0a", "#a855f7", "#3478f6", "#22d3ee", "#34d399"];

let effectTick = 0;
let lastEffectAt = 0;
let showState = {
  phase: "lobby",
  mode: "solid",
  color: "#111827",
  brightness: 85,
  countdownTo: null,
  title: "\uc0c8\ub85c\uc6b4 \ubbf8\ub798\ub97c \uc900\ube44\uc911\uc785\ub2c8\ub2e4",
  subtitle: "2026 \ucd9c\ubc94\uc2dd LIGHT SHOW",
  startAt: Date.now() + 3 * 60 * 1000,
  capacity: 300,
  commandId: 0,
};

const participants = new Map();
const streams = new Set();

function now() {
  return Date.now();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function seatLabel(slot) {
  return `A${String(slot).padStart(2, "0")}`;
}

function findAvailableSlot() {
  const occupied = new Set([...participants.values()].map((participant) => participant.slot));
  for (let slot = 1; slot <= showState.capacity; slot += 1) {
    if (!occupied.has(slot)) {
      return slot;
    }
  }
  return null;
}

function sweepParticipants() {
  const cutoff = now() - staleAfterMs;
  for (const [id, participant] of participants) {
    if (participant.lastSeen < cutoff) {
      participants.delete(id);
    }
  }
}

function getOrCreateParticipant(id) {
  sweepParticipants();
  let participant = participants.get(id);
  if (!participant) {
    const slot = findAvailableSlot();
    if (!slot) {
      return null;
    }
    participant = {
      id,
      slot,
      seat: seatLabel(slot),
      connectedAt: now(),
      lastSeen: now(),
      color: showState.color,
      brightness: showState.brightness,
    };
    participants.set(id, participant);
  }

  participant.lastSeen = now();
  return participant;
}

function visibleParticipants() {
  sweepParticipants();
  return [...participants.values()]
    .sort((a, b) => a.slot - b.slot)
    .map((participant) => ({
      id: participant.id,
      slot: participant.slot,
      seat: participant.seat,
      color: participant.color,
      brightness: participant.brightness,
      lastSeen: participant.lastSeen,
    }));
}

function snapshot() {
  const list = visibleParticipants();
  return {
    state: showState,
    serverNow: now(),
    count: list.length,
    maxParticipants: showState.capacity,
    participants: list,
  };
}

function sendEvent(response, event, payload) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcast(event = "snapshot") {
  const data = snapshot();
  for (const stream of streams) {
    sendEvent(stream, event, data);
  }
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        request.destroy();
        reject(new Error("Body too large"));
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function json(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function isAdminRequest(request) {
  if (!adminPin) return true;
  return request.headers["x-admin-pin"] === adminPin;
}

function normalizeSettings(body) {
  const capacity = Number(body.capacity ?? showState.capacity);
  const startAt = body.startAt === null || body.startAt === "" ? null : Number(body.startAt ?? showState.startAt);

  return {
    title: String(body.title || showState.title).slice(0, 80),
    subtitle: String(body.subtitle || showState.subtitle).slice(0, 80),
    startAt: Number.isFinite(startAt) ? startAt : showState.startAt,
    capacity: Number.isFinite(capacity) ? clamp(Math.round(capacity), 1, 1000) : showState.capacity,
  };
}

function updateParticipants(mode, color, palette = defaultPalette) {
  const people = visibleParticipants();
  const colors = palette.length ? palette : defaultPalette;
  const effectMinBrightness = 70;

  for (const participant of people) {
    const stored = participants.get(participant.id);
    if (!stored) continue;

    let nextColor = color;
    let nextBrightness = showState.brightness;

    if (mode === "mix") {
      nextColor = colors[(participant.slot + effectTick) % colors.length];
      nextBrightness = 100;
    }

    if (mode === "random") {
      const candidates = colors.length > 1 ? colors.filter((candidate) => candidate !== stored.color) : colors;
      nextColor = candidates[Math.floor(Math.random() * candidates.length)];
      nextBrightness = 100;
    }

    stored.color = nextColor;
    stored.brightness = nextBrightness;
  }
}

function advanceShowClock() {
  const time = now();

  if (showState.phase === "countdown" && showState.countdownTo && time >= showState.countdownTo) {
    showState = {
      ...showState,
      phase: "light",
      mode: showState.mode === "countdown" ? "solid" : showState.mode,
      countdownTo: null,
      commandId: showState.commandId + 1,
    };
    updateParticipants(showState.mode, showState.color);
    broadcast("command");
    return;
  }

  if (showState.phase === "light" && (showState.mode === "mix" || showState.mode === "random")) {
    if (time - lastEffectAt < 1800) {
      return;
    }
    lastEffectAt = time;
    effectTick += 1;
    updateParticipants(showState.mode, showState.color);
    broadcast("command");
  }
}

async function handleApi(request, response, pathname) {
  if (pathname === "/healthz" && request.method === "GET") {
    json(response, 200, { ok: true });
    return;
  }

  if (pathname === "/api/admin-required" && request.method === "GET") {
    json(response, 200, { required: Boolean(adminPin) });
    return;
  }

  if (pathname === "/api/join" && request.method === "POST") {
    const body = await parseBody(request);
    const id = String(body.clientId || "").slice(0, 80);
    if (!id) {
      json(response, 400, { error: "clientId required" });
      return;
    }
    const participant = getOrCreateParticipant(id);
    if (!participant) {
      json(response, 403, { error: "full", snapshot: snapshot() });
      return;
    }
    broadcast();
    json(response, 200, { participant, snapshot: snapshot() });
    return;
  }

  if (pathname === "/api/heartbeat" && request.method === "POST") {
    const body = await parseBody(request);
    const id = String(body.clientId || "");
    const participant = participants.get(id) || getOrCreateParticipant(id);
    if (participant) {
      participant.lastSeen = now();
    }
    broadcast();
    json(response, 200, { ok: Boolean(participant), snapshot: snapshot() });
    return;
  }

  if (pathname === "/api/leave" && request.method === "POST") {
    const body = await parseBody(request);
    const id = String(body.clientId || "");
    const left = participants.delete(id);
    if (left) {
      broadcast();
    }
    json(response, 200, { ok: left, snapshot: snapshot() });
    return;
  }

  if (pathname === "/api/state" && request.method === "GET") {
    json(response, 200, snapshot());
    return;
  }

  if (pathname === "/api/command" && request.method === "POST") {
    if (!isAdminRequest(request)) {
      json(response, 401, { error: "admin pin required" });
      return;
    }
    const body = await parseBody(request);
    const mode = body.mode || "solid";
    const color = body.color || showState.color;
    const brightness = Number(body.brightness ?? showState.brightness);
    const settings = normalizeSettings(body);
    const countdownSeconds = Number(body.countdownSeconds);
    const countdownTo = Number.isFinite(countdownSeconds)
      ? now() + clamp(countdownSeconds, 0, 3600) * 1000
      : body.countdownTo ?? showState.countdownTo;

    showState = {
      ...showState,
      ...settings,
      phase: body.phase || showState.phase,
      mode,
      color,
      brightness: Number.isFinite(brightness) ? clamp(Math.round(brightness), 0, 100) : showState.brightness,
      countdownTo,
      commandId: showState.commandId + 1,
    };

    effectTick = 0;
    lastEffectAt = 0;
    updateParticipants(mode, color, body.palette);
    broadcast("command");
    json(response, 200, snapshot());
    return;
  }

  if (pathname === "/api/reset" && request.method === "POST") {
    if (!isAdminRequest(request)) {
      json(response, 401, { error: "admin pin required" });
      return;
    }
    const capacity = showState.capacity;
    const title = showState.title;
    const subtitle = showState.subtitle;
    const startAt = showState.startAt;
    participants.clear();
    showState = {
      phase: "lobby",
      mode: "solid",
      color: "#111827",
      brightness: 85,
      countdownTo: null,
      title,
      subtitle,
      startAt,
      capacity,
      commandId: showState.commandId + 1,
    };
    broadcast("command");
    json(response, 200, snapshot());
    return;
  }

  if (pathname === "/events" && request.method === "GET") {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    streams.add(response);
    sendEvent(response, "snapshot", snapshot());
    request.on("close", () => streams.delete(response));
    return;
  }

  json(response, 404, { error: "Not found" });
}

async function serveStatic(response, pathname) {
  const filePath = pathname === "/" ? "/index.html" : pathname;
  const normalized = normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const absolutePath = join(publicDir, normalized);
  const type = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
  }[extname(absolutePath)] || "application/octet-stream";

  try {
    const file = await readFile(absolutePath);
    response.writeHead(200, {
      "content-type": type,
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      pragma: "no-cache",
      expires: "0",
    });
    response.end(file);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/") || url.pathname === "/events" || url.pathname === "/healthz") {
      await handleApi(request, response, url.pathname);
      return;
    }
    await serveStatic(response, url.pathname);
  } catch (error) {
    json(response, 500, { error: error.message });
  }
});

setInterval(advanceShowClock, 250);
setInterval(() => broadcast(), 5000);

server.listen(port, host, () => {
  console.log(`GlowLink running at http://${host}:${port}`);
});
