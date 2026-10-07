// Bancho IRC. Lets the panel drive the multiplayer room directly, so the referee
// never has to type !mp commands during a match.
//
// Credentials come from https://osu.ppy.sh/home/account/edit -> Legacy API -> IRC.
// They are NOT the account password, and they sit in data/config.json in the clear.
import net from 'node:net';
import { config } from './config.js';
import { live } from './state.js';

const RECONNECT_MS = 8000;
// Bancho throttles hard; one line every ~350ms stays comfortably under the limit.
const SEND_GAP_MS = 350;

let socket = null;
let ready = false;
let stopped = false;
let retryTimer = null;
let buffer = '';
const queue = [];
let draining = false;

live.irc = { connected: false, channel: '', log: [] };

function note(dir, text) {
  live.irc.log.push({ dir, text, at: Date.now() });
  if (live.irc.log.length > 60) live.irc.log.shift();
}

function raw(line) {
  if (!socket || socket.destroyed) return false;
  socket.write(line + '\r\n');
  return true;
}

/** Queue a line so a burst of commands cannot trip Bancho's flood limit. */
function enqueue(line) {
  queue.push(line);
  if (draining) return;
  draining = true;
  const tick = () => {
    const next = queue.shift();
    if (next === undefined) { draining = false; return; }
    raw(next);
    setTimeout(tick, SEND_GAP_MS);
  };
  tick();
}

/** The room to talk to: whatever osu!tourney reports, else a channel set by hand. */
export function currentChannel() {
  const fromIpc = (live.ipc.channel || '').trim();
  const manual = (config.irc?.channel || '').trim();
  const ch = fromIpc || manual;
  if (!ch) return '';
  return ch.startsWith('#') ? ch : `#${ch}`;
}

export function say(text) {
  const ch = currentChannel();
  if (!ready || !ch || !text) return false;
  enqueue(`PRIVMSG ${ch} :${text}`);
  note('out', `${ch} ${text}`);
  live.irc.channel = ch;
  return true;
}

function handle(line) {
  if (line.startsWith('PING')) return raw(`PONG ${line.slice(5)}`);

  const m = line.match(/^:(\S+?)!?\S* PRIVMSG (\S+) :(.*)$/);
  if (m) {
    note('in', `${m[1]}: ${m[3]}`);
    return;
  }
  // 001 = welcome, 464 = bad password
  if (/ 001 /.test(line)) {
    ready = true;
    live.irc.connected = true;
    note('sys', 'เข้าสู่ระบบ IRC สำเร็จ');
    const ch = currentChannel();
    if (ch) enqueue(`JOIN ${ch}`);
    return;
  }
  if (/ 464 /.test(line)) {
    note('sys', 'รหัส IRC ไม่ถูกต้อง — ขอใหม่ที่ osu! account settings');
    stopped = true;
    return;
  }
}

export function connectIRC() {
  disconnectIRC();
  stopped = false;
  const c = config.irc || {};
  if (!c.enabled || !c.username || !c.password) return;

  socket = net.createConnection({ host: c.server || 'irc.ppy.sh', port: c.port || 6667 });
  socket.setEncoding('utf8');

  socket.on('connect', () => {
    raw(`PASS ${c.password}`);
    raw(`NICK ${c.username.replace(/\s+/g, '_')}`);
    raw(`USER ${c.username.replace(/\s+/g, '_')} 0 * :mania-tourney`);
  });

  socket.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) if (line) handle(line);
  });

  const down = () => {
    ready = false;
    live.irc.connected = false;
    if (!stopped) {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(connectIRC, RECONNECT_MS);
    }
  };
  socket.on('close', down);
  socket.on('error', (e) => { note('sys', `IRC error: ${e.message}`); down(); });
}

export function disconnectIRC() {
  stopped = true;
  clearTimeout(retryTimer);
  ready = false;
  live.irc.connected = false;
  queue.length = 0;
  try { socket?.destroy(); } catch { /* already gone */ }
  socket = null;
}

export function ircStatus() {
  return {
    enabled: !!config.irc?.enabled,
    connected: ready,
    channel: currentChannel(),
    log: live.irc.log.slice(-20),
  };
}

// Bancho only accepts this set; anything else (EZ, and the pool's numbering) is
// dropped rather than sent as an invalid command.
const BANCHO_MODS = ['HR', 'DT', 'FL', 'HD', 'FI', 'NC', 'Freemod', 'None'];

/** "HD2" -> ["HD"], "FM1" -> ["Freemod"], "NM3"/"TB" -> ["None"]. */
export function modsForPool(mods) {
  const tag = String(mods || '').replace(/\d+$/, '').toUpperCase();
  if (!tag || tag === 'NM' || tag === 'TB') return ['None'];
  if (tag === 'FM') return ['Freemod'];
  return BANCHO_MODS.includes(tag) ? [tag] : null;
}

/** Put a pool map in the room: beatmap id, mania mode, then its mod bracket. */
export function setMap(beatmapId, mods) {
  if (!beatmapId) return false;
  const ok = say(`!mp map ${beatmapId} 3`);
  const list = modsForPool(mods);
  if (ok && list) say(`!mp mods ${list.join(' ')}`);
  return ok;
}
