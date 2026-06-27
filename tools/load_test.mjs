import http from "node:http";
import https from "node:https";
import { setTimeout as delay } from "node:timers/promises";

const targetUrl = new URL(process.env.TARGET_URL || "https://glowlink-c0hi.onrender.com/");
const clients = Number(process.env.CLIENTS || 300);
const durationSeconds = Number(process.env.DURATION_SECONDS || 60);
const rampMs = Number(process.env.RAMP_MS || 15000);
const heartbeatMs = Number(process.env.HEARTBEAT_MS || 5000);
const agent = targetUrl.protocol === "https:"
  ? new https.Agent({ keepAlive: true, maxSockets: clients + 20 })
  : new http.Agent({ keepAlive: true, maxSockets: clients + 20 });

const ids = Array.from({ length: clients }, (_, index) => `load-${Date.now()}-${String(index + 1).padStart(4, "0")}`);
const stats = {
  join: [],
  heartbeat: [],
  eventsOpened: 0,
  eventsErrored: 0,
  joinOk: 0,
  joinFail: 0,
  heartbeatOk: 0,
  heartbeatFail: 0,
  leaveOk: 0,
  leaveFail: 0,
};
const eventRequests = [];
let stopping = false;

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

async function requestJson(pathname, body) {
  const startedAt = performance.now();
  const response = await fetch(new URL(pathname, targetUrl), {
    method: "POST",
    dispatcher: undefined,
    agent,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const elapsed = performance.now() - startedAt;
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { ok: response.ok, status: response.status, elapsed, payload };
}

function openEvents(id) {
  let opened = false;
  const transport = targetUrl.protocol === "https:" ? https : http;
  const request = transport.request(
    new URL(`/events?clientId=${encodeURIComponent(id)}`, targetUrl),
    {
      method: "GET",
      agent,
      headers: {
        accept: "text/event-stream",
        "cache-control": "no-cache",
      },
    },
    (response) => {
      if (response.statusCode === 200) {
        opened = true;
        stats.eventsOpened += 1;
      } else {
        stats.eventsErrored += 1;
      }
      response.on("data", () => {});
    },
  );
  request.on("error", () => {
    if (!stopping && !opened) stats.eventsErrored += 1;
  });
  request.end();
  eventRequests.push(request);
}

async function runClient(id, index) {
  await delay(Math.round((rampMs / clients) * index));
  openEvents(id);

  const join = await requestJson("/api/join", { clientId: id }).catch((error) => ({
    ok: false,
    status: 0,
    elapsed: 0,
    payload: { error: error.message },
  }));
  stats.join.push(join.elapsed);
  if (join.ok) {
    stats.joinOk += 1;
  } else {
    stats.joinFail += 1;
    return;
  }

  const endAt = Date.now() + durationSeconds * 1000;
  while (!stopping && Date.now() < endAt) {
    await delay(heartbeatMs);
    const heartbeat = await requestJson("/api/heartbeat", { clientId: id }).catch(() => ({
      ok: false,
      status: 0,
      elapsed: 0,
    }));
    stats.heartbeat.push(heartbeat.elapsed);
    if (heartbeat.ok) {
      stats.heartbeatOk += 1;
    } else {
      stats.heartbeatFail += 1;
    }
  }
}

async function leaveAll() {
  stopping = true;
  eventRequests.forEach((request) => request.destroy());
  const results = await Promise.allSettled(ids.map((id) => requestJson("/api/leave", { clientId: id })));
  for (const result of results) {
    if (result.status === "fulfilled" && result.value.ok) {
      stats.leaveOk += 1;
    } else {
      stats.leaveFail += 1;
    }
  }
}

function printSummary() {
  console.log(`Target: ${targetUrl.origin}`);
  console.log(`Clients: ${clients}, duration: ${durationSeconds}s, ramp: ${rampMs}ms`);
  console.log(`Join: ok ${stats.joinOk}, fail ${stats.joinFail}, p50 ${Math.round(percentile(stats.join, 0.5))}ms, p95 ${Math.round(percentile(stats.join, 0.95))}ms`);
  console.log(`SSE: opened ${stats.eventsOpened}, errors ${stats.eventsErrored}`);
  console.log(`Heartbeat: ok ${stats.heartbeatOk}, fail ${stats.heartbeatFail}, p50 ${Math.round(percentile(stats.heartbeat, 0.5))}ms, p95 ${Math.round(percentile(stats.heartbeat, 0.95))}ms`);
  console.log(`Leave cleanup: ok ${stats.leaveOk}, fail ${stats.leaveFail}`);
}

process.on("SIGINT", async () => {
  await leaveAll();
  printSummary();
  process.exit(1);
});

console.log("Starting GlowLink load test...");
try {
  await Promise.all(ids.map((id, index) => runClient(id, index)));
} finally {
  await leaveAll();
  printSummary();
}
