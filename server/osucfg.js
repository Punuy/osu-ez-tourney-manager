// Read and write osu!'s own config files from the panel.
//
// Two separate files live in the osu! install root and they are not the same thing:
//   tournament.cfg        osu!tourney only, read ONCE at startup. ClientNameSize is
//                         the player name drawn on each client window - 0 hides it.
//   osu!.<user>.cfg       the normal game config, including the in-game HUD.
//                         osu! REWRITES this whole file when it exits, so anything
//                         written while it is running is lost - hence the guard.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { config } from './config.js';

// key -> { file, default, min, max, values } — nothing outside this list is written.
export const KEYS = {
  // tournament.cfg (osu! wiki: osu!tourney setup)
  ClientNameSize:   { file: 'tourney', def: '', min: 0, max: 200 },
  TeamSize:         { file: 'tourney', def: '4', min: 1, max: 8 },
  Height:           { file: 'tourney', def: '720', min: 568, max: 2160 },
  Aspect:           { file: 'tourney', def: '2', min: 1, max: 2 },
  acronym:          { file: 'tourney', def: 'OWC' },
  RankingChatDelay: { file: 'tourney', def: '', min: 0, max: 60000 },
  BufferTimeoutTime:{ file: 'tourney', def: '', min: 0, max: 60000 },
  BufferTotalTime:  { file: 'tourney', def: '', min: 0, max: 60000 },
  BufferDangerTime: { file: 'tourney', def: '', min: 0, max: 60000 },
  // osu!.<user>.cfg — the in-game HUD
  ShowInterface:    { file: 'user', def: '1', values: ['0', '1'] },
  ScoreboardVisible:{ file: 'user', def: '1', values: ['0', '1'] },
  ShowSpectators:   { file: 'user', def: '1', values: ['0', '1'] },
  KeyOverlay:       { file: 'user', def: '0', values: ['0', '1'] },
  FpsCounter:       { file: 'user', def: '0', values: ['0', '1'] },
  ShowStoryboard:   { file: 'user', def: '1', values: ['0', '1'] },
  Video:            { file: 'user', def: '1', values: ['0', '1'] },
  ScoreMeter:       { file: 'user', def: 'Error', values: ['None', 'Error', 'Colour'] },
  DimLevel:         { file: 'user', def: '80', min: 0, max: 100 },
};

function tourneyPath() {
  return config.stablePath ? path.join(config.stablePath, 'tournament.cfg') : '';
}

// osu! names this after the Windows user, so find it rather than guessing.
function userPath() {
  if (!config.stablePath) return '';
  try {
    const hit = fs.readdirSync(config.stablePath)
      .filter((f) => /^osu!\..+\.cfg$/i.test(f))
      .sort();
    return hit.length ? path.join(config.stablePath, hit[0]) : '';
  } catch { return ''; }
}

function parse(file) {
  const out = {};
  if (!file) return out;
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return out; }
  for (const line of text.split(/\r?\n/)) {
    // [ \t]* not \s*: \s would span the newline and swallow the next key
    const m = line.match(/^[ \t]*([A-Za-z_][A-Za-z0-9_!]*)[ \t]*=[ \t]*(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

// Rewrite only the given keys, leaving every other line byte-for-byte alone.
function patch(file, values) {
  const src = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const lines = src ? src.split(/\r?\n/) : [];
  const seen = new Set();

  const out = lines.map((line) => {
    for (const [k, v] of Object.entries(values)) {
      if (new RegExp(`^[ \\t]*${k}[ \\t]*=`).test(line)) { seen.add(k); return `${k} = ${v}`; }
    }
    return line;
  });
  // drop a trailing blank so appended keys do not leave a gap growing each save
  while (out.length && out[out.length - 1].trim() === '') out.pop();
  for (const [k, v] of Object.entries(values)) if (!seen.has(k)) out.push(`${k} = ${v}`);

  if (src) fs.copyFileSync(file, `${file}.bak`);
  fs.writeFileSync(file, out.join(eol) + eol);
  return out.length;
}

export function osuRunning() {
  try {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq osu!.exe', '/NH'], {
      encoding: 'utf8', windowsHide: true, timeout: 4000,
    });
    return /osu!\.exe/i.test(out);
  } catch {
    return null;   // no tasklist (not Windows, or blocked): unknown, not "no"
  }
}

export function readOsuConfig() {
  const tourney = tourneyPath();
  const user = userPath();
  const tv = parse(tourney);
  const uv = parse(user);
  const values = {};
  for (const [k, spec] of Object.entries(KEYS)) {
    const src = spec.file === 'tourney' ? tv : uv;
    // a key absent from the file means osu! is using its built-in default
    values[k] = { value: src[k] ?? '', isDefault: !(k in src), def: spec.def };
  }
  return {
    stablePath: config.stablePath || '',
    tourneyFile: tourney,
    userFile: user,
    tourneyExists: !!tourney && fs.existsSync(tourney),
    userExists: !!user && fs.existsSync(user),
    // an empty tournament.cfg is the normal starting state and means "all defaults"
    tourneyEmpty: !!tourney && fs.existsSync(tourney) && fs.statSync(tourney).size === 0,
    running: osuRunning(),
    values,
  };
}

// patch: { Key: 'value' }. '' means "remove my override" — the key is left as is,
// since deleting a line osu! wrote itself is not something the panel should do.
export function writeOsuConfig(patchIn) {
  if (!config.stablePath) throw new Error('ยังไม่ได้ตั้งโฟลเดอร์ osu! ในหน้า Settings');

  const byFile = { tourney: {}, user: {} };
  for (const [k, raw] of Object.entries(patchIn || {})) {
    const spec = KEYS[k];
    if (!spec) continue;                       // allowlist: ignore anything unknown
    const v = String(raw).trim();
    if (v === '') continue;
    if (spec.values && !spec.values.includes(v)) throw new Error(`${k}: ค่า "${v}" ใช้ไม่ได้`);
    if (spec.min !== undefined) {
      const n = Number(v);
      if (!Number.isFinite(n)) throw new Error(`${k}: ต้องเป็นตัวเลข`);
      if (n < spec.min || n > spec.max) throw new Error(`${k}: ต้องอยู่ระหว่าง ${spec.min}-${spec.max}`);
    }
    byFile[spec.file][k] = v;
  }

  const wrote = {};
  // osu! rewrites its own config on exit, so a HUD change made now would be lost
  if (Object.keys(byFile.user).length) {
    if (osuRunning()) throw new Error('osu! เปิดอยู่ — ปิดให้หมดก่อน ไม่งั้นมันเขียนทับตอนปิด');
    const f = userPath();
    if (!f) throw new Error('หาไฟล์ osu!.<user>.cfg ไม่เจอ');
    wrote.user = patch(f, byFile.user);
  }
  if (Object.keys(byFile.tourney).length) {
    wrote.tourney = patch(tourneyPath(), byFile.tourney);
  }
  return { ok: true, wrote, ...readOsuConfig() };
}
