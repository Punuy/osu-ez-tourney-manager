// Optional obs-websocket v5 client, so one click in the panel can switch the OBS
// scene and the overlay scene together.
import crypto from 'node:crypto';
import { config } from './config.js';

let socket = null;
let ready = false;
let retryTimer = null;
let stopped = false;
const RETRY_MS = 5000;
let nextId = 1;
const pending = new Map();

function authHash(password, salt, challenge) {
  const secret = crypto.createHash('sha256').update(password + salt).digest('base64');
  return crypto.createHash('sha256').update(secret + challenge).digest('base64');
}

export function obsStatus() {
  return { enabled: !!config.obs.enabled, connected: ready, url: config.obs.url };
}

export function connectOBS() {
  disconnectOBS();
  stopped = false;
  if (!config.obs.enabled) return;
  try { socket = new WebSocket(config.obs.url, ['obswebsocket.json']); }
  catch { return retry(); }

  socket.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.op === 0) {                                     // Hello
      const auth = msg.d.authentication;
      socket.send(JSON.stringify({
        op: 1,
        d: {
          rpcVersion: 1,
          ...(auth ? { authentication: authHash(config.obs.password, auth.salt, auth.challenge) } : {}),
          eventSubscriptions: 0,
        },
      }));
    } else if (msg.op === 2) {                              // Identified
      ready = true;
    } else if (msg.op === 7) {                              // RequestResponse
      const resolve = pending.get(msg.d.requestId);
      if (resolve) { pending.delete(msg.d.requestId); resolve(msg.d); }
    }
  });
  socket.addEventListener('close', () => { ready = false; retry(); });
  socket.addEventListener('error', () => { ready = false; });
}

// OBS restarting mid-broadcast used to kill scene sync until the server restarted.
function retry() {
  if (stopped || !config.obs.enabled) return;
  clearTimeout(retryTimer);
  retryTimer = setTimeout(connectOBS, RETRY_MS);
}

export function disconnectOBS() {
  stopped = true;
  clearTimeout(retryTimer);
  ready = false;
  try { socket?.close(); } catch { /* not open */ }
  socket = null;
}

function request(requestType, requestData = {}) {
  if (!ready || !socket) return Promise.resolve(null);
  const requestId = String(nextId++);
  return new Promise((resolve) => {
    pending.set(requestId, resolve);
    socket.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
    setTimeout(() => { if (pending.delete(requestId)) resolve(null); }, 3000);
  });
}

export async function listScenes() {
  const res = await request('GetSceneList');
  return res?.responseData?.scenes?.map((s) => s.sceneName) ?? [];
}

// Called whenever the overlay scene changes; only acts if the user mapped it.
export async function syncScene(overlayScene) {
  const target = config.obs.sceneMap?.[overlayScene];
  if (target) await request('SetCurrentProgramScene', { sceneName: target });
}
