// Runtime configuration: paths, ports, integrations. Persisted to data/config.json.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = path.join(ROOT, 'data');
export const PUBLIC = path.join(ROOT, 'public');
const CONFIG_FILE = path.join(DATA, 'config.json');

// Overlay scene ids, in panel order (1-9 then 0).
export const SCENES = ['gameplay', 'mappool', 'teamintro', 'seeding', 'bracket',
  'schedule', 'showcase', 'win', 'drawings', 'standby'];

// osu!stable writes ipc.txt / ipc-state.txt / ipc-scores.txt / ipc-channel.txt into its
// install root while the tourney client is running. Same detection lazer uses.
function findStablePath() {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'osu!'),
    path.join(process.env.APPDATA || '', 'osu!'),
    'C:/Program Files/osu!',
    'C:/Program Files (x86)/osu!',
    path.join(os.homedir(), 'AppData', 'Local', 'osu!'),
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(path.join(c, 'osu!.exe'))) return c; } catch { /* unreadable */ }
  }
  return '';
}

const DEFAULTS = {
  port: 7272,
  stablePath: findStablePath(),
  // tosu (https://github.com/tosuapp/tosu) is optional: it adds per-player live
  // accuracy / combo / hits that the IPC files do not carry.
  tosu: { enabled: true, url: 'ws://127.0.0.1:24050/websocket/v2' },
  obs: { enabled: false, url: 'ws://127.0.0.1:4455', password: '', sceneMap: {} },
  // Bancho IRC, so the panel can run the lobby (!mp map / start / timer / invite).
  // Password comes from osu! account settings -> Legacy API, NOT the account password.
  irc: {
    enabled: false, server: 'irc.ppy.sh', port: 6667,
    username: '', password: '', channel: '', autoSetMap: true,
  },
  // Auto-advance overlay scenes the way the lazer tournament client does.
  autoProgressScreens: true,
  openPanelOnStart: false,   // START.bat opens it instead
};

function deepMerge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(base[k] || {}, v) : v;
  }
  return out;
}

export function loadConfig() {
  let stored = {};
  try { stored = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { /* first run */ }
  const cfg = deepMerge(DEFAULTS, stored);
  // PORT wins over the saved value, so a second instance can run alongside.
  if (process.env.PORT) cfg.port = Number(process.env.PORT);
  return cfg;
}

export function saveConfig(cfg) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  return cfg;
}

export const config = loadConfig();
