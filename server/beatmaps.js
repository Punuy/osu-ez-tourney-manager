// Beatmap metadata by ID. Uses unauthenticated mirrors so no osu! API key is needed;
// results are cached to disk because a map pool is looked up over and over.
import fs from 'node:fs';
import path from 'node:path';
import { DATA } from './config.js';

const CACHE_FILE = path.join(DATA, 'cache', 'beatmaps.json');
const MIRRORS = [
  { url: (id) => `https://catboy.best/api/v2/b/${id}`, set: (j) => j.set },
  { url: (id) => `https://osu.direct/api/v2/b/${id}`, set: (j) => j.beatmapset || j.set },
];

let cache = {};
try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { /* cold cache */ }

function persist() {
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
}

export function cover(setId, size = 'cover') {
  return setId ? `https://assets.ppy.sh/beatmaps/${setId}/covers/${size}.jpg` : '';
}

const inflight = new Map();

export async function getBeatmap(id) {
  id = Number(id) || 0;
  if (!id) return null;
  if (cache[id]) return cache[id];
  if (inflight.has(id)) return inflight.get(id);

  const p = (async () => {
    for (const mirror of MIRRORS) {
      try {
        const res = await fetch(mirror.url(id), { headers: { 'User-Agent': 'mania-tourney/1.0' } });
        if (!res.ok) continue;
        const j = await res.json();
        if (!j || !j.id) continue;
        const s = mirror.set(j) || {};
        const info = {
          id: j.id,
          setId: j.beatmapset_id || s.id || 0,
          title: s.title_unicode || s.title || '(unknown)',
          titleRomanised: s.title || '',
          artist: s.artist_unicode || s.artist || '',
          artistRomanised: s.artist || '',
          creator: s.creator || (j.owners?.[0]?.username ?? ''),
          version: j.version || '',
          stars: Math.round((j.difficulty_rating || 0) * 100) / 100,
          bpm: j.bpm || 0,
          length: j.total_length || 0,
          keys: j.mode === 'mania' || j.mode_int === 3 ? Math.round(j.cs || 0) : 0,
          od: j.accuracy ?? 0,
          hp: j.drain ?? 0,
          mode: j.mode || 'osu',
          maxCombo: j.max_combo || 0,
          cover: cover(j.beatmapset_id || s.id),
          card: cover(j.beatmapset_id || s.id, 'card'),
          list: cover(j.beatmapset_id || s.id, 'list'),
        };
        cache[id] = info;
        persist();
        return info;
      } catch { /* try next mirror */ }
    }
    // Offline or unknown map: return a placeholder so the overlay still renders.
    return { id, setId: 0, title: `Beatmap ${id}`, artist: '', creator: '', version: '', stars: 0, bpm: 0, length: 0, keys: 0, mode: 'mania', cover: '', card: '', list: '' };
  })().finally(() => inflight.delete(id));

  inflight.set(id, p);
  return p;
}

export function formatLength(sec) {
  const m = Math.floor(sec / 60);
  return `${m}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
}

// Legacy mod bitmask -> acronyms, as written into ipc.txt by osu!stable.
const MOD_BITS = [
  [1, 'NF'], [2, 'EZ'], [4, 'TD'], [8, 'HD'], [16, 'HR'], [32, 'SD'], [64, 'DT'],
  [128, 'RX'], [256, 'HT'], [512, 'NC'], [1024, 'FL'], [2048, 'AT'], [4096, 'SO'],
  [8192, 'AP'], [16384, 'PF'], [1 << 15, '4K'], [1 << 16, '5K'], [1 << 17, '6K'],
  [1 << 18, '7K'], [1 << 19, '8K'], [1 << 20, 'FI'], [1 << 21, 'RD'], [1 << 22, 'CN'],
  [1 << 23, 'TP'], [1 << 24, '9K'], [1 << 25, 'CO'], [1 << 26, '1K'], [1 << 27, '3K'],
  [1 << 28, '2K'], [1 << 29, 'V2'], [1 << 30, 'MR'],
];

export function modsToAcronyms(bitmask) {
  const out = [];
  for (const [bit, name] of MOD_BITS) if (bitmask & bit) out.push(name);
  if (out.includes('NC')) out.splice(out.indexOf('DT'), 1);
  if (out.includes('PF')) out.splice(out.indexOf('SD'), 1);
  return out;
}
