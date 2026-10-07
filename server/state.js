// Tournament state. bracket.json keeps the exact shape osu!lazer's tournament client
// writes, so an existing bracket.json can be dropped in and exported back out.
import fs from 'node:fs';
import path from 'node:path';
import { DATA, SCENES } from './config.js';
import * as backgrounds from './backgrounds.js';
import { modsToAcronyms } from './beatmaps.js';

export { SCENES };

const BRACKET_FILE = path.join(DATA, 'bracket.json');
const THEME_FILE = path.join(DATA, 'theme.json');

export const EMPTY_BRACKET = {
  Ruleset: { short_name: 'mania' },
  PlayersPerTeam: 1,
  TeamIcon: 'flag',        // 'flag' | 'avatar'
  ChromaKeyWidth: 1920,
  ChromaKeyHeight: 790,
  AutoProgressScreens: true,
  SplitMapPoolByMods: true,
  DisplayTeamSeeds: false,
  Matches: [],
  Rounds: [],
  Teams: [],
  Progressions: [],
};

export const DEFAULT_THEME = {
  name: 'osu!mania Thailand',
  subtitle: 'Tournament',
  logo: '',
  lang: 'th',
  colours: {
    red: '#e05261',      // team 1
    blue: '#4a9de0',     // team 2
    accent: '#ffcc22',
    bg: '#1a1a20',
    panel: 'rgba(20,20,26,0.86)',
    text: '#ffffff',
    dim: '#a0a0ac',
  },
  font: "'Torus', 'IBM Plex Sans Thai', 'Segoe UI', sans-serif",
  chromaKey: '#00ff00',
  showChroma: false,
};

function read(file, fallback) {
  try { return { ...fallback, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; }
  catch { return structuredClone(fallback); }
}

function write(file, value) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

const BACKUP_DIR = path.join(DATA, 'backups');
const BACKUP_EVERY_MS = 60_000;
const KEEP_BACKUPS = 12;
let lastBackup = 0;

/** Snapshot the previous bracket before overwriting it - a mis-click during a
 *  final would otherwise be unrecoverable. Throttled, newest few kept. */
function backupBracket() {
  if (Date.now() - lastBackup < BACKUP_EVERY_MS) return;
  if (!fs.existsSync(BRACKET_FILE)) return;
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(BRACKET_FILE, path.join(BACKUP_DIR, `bracket-${stamp}.json`));
    lastBackup = Date.now();
    const old = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('bracket-')).sort();
    for (const f of old.slice(0, -KEEP_BACKUPS)) {
      try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch { /* already gone */ }
    }
  } catch { /* backups are best-effort, never block a save */ }
}

/** Fall back to the newest backup if the live file is unreadable. */
function readBracket() {
  try {
    return { ...EMPTY_BRACKET, ...JSON.parse(fs.readFileSync(BRACKET_FILE, 'utf8')) };
  } catch {
    try {
      const newest = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('bracket-')).sort().pop();
      if (newest) {
        console.warn('bracket.json unreadable - restored from', newest);
        return { ...EMPTY_BRACKET, ...JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, newest), 'utf8')) };
      }
    } catch { /* no usable backup */ }
    return structuredClone(EMPTY_BRACKET);
  }
}

// --- live, non-persisted state -------------------------------------------
// Everything the overlay needs that is derived from osu! rather than authored.
export const live = {
  scene: 'standby',
  currentMatchId: null,
  warmup: false,
  chatEnabled: true,
  ipc: { beatmapId: 0, mods: 0, state: 'Initialising', channel: '', score1: 0, score2: 0 },
  beatmap: null,       // resolved metadata for ipc.beatmapId
  players: [],         // per-client live data from tosu, when available
  chat: [],            // in-game #multiplayer chat, relayed by tosu
  tosuConnected: false,
  ipcConnected: false,
  irc: { connected: false, channel: '', log: [] },
  standbyText: 'Starting soon',
  countdownTarget: null,
  showcaseBeatmapId: 0,
  transitionId: 0,
};

class Store {
  constructor() {
    this.bracket = readBracket();
    this.theme = read(THEME_FILE, DEFAULT_THEME);
    this.listeners = new Set();
    live.currentMatchId = this.bracket.Matches.find((m) => m.Current)?.ID ?? null;
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  emit(reason = 'update') { for (const fn of this.listeners) fn(reason); }

  saveBracket() {
    backupBracket();
    this.bracket.Rev = (this.bracket.Rev || 0) + 1;
    write(BRACKET_FILE, this.bracket);
    this.emit('bracket');
  }

  saveTheme() { write(THEME_FILE, this.theme); this.emit('theme'); }

  // --- lookups ------------------------------------------------------------
  get currentMatch() {
    return this.bracket.Matches.find((m) => m.ID === live.currentMatchId) || null;
  }

  teamByAcronym(acronym) {
    if (!acronym) return null;
    return this.bracket.Teams.find((t) => t.Acronym === acronym) || null;
  }

  // lazer stores the match->round link on the round side (Round.Matches = [id, ...]).
  roundForMatch(matchId) {
    return this.bracket.Rounds.find((r) => (r.Matches || []).includes(matchId)) || null;
  }

  nextMatchId() {
    return this.bracket.Matches.reduce((max, m) => Math.max(max, m.ID || 0), 0) + 1;
  }

  pointsToWin(match) {
    const round = match && this.roundForMatch(match.ID);
    return round ? Math.floor((round.BestOf ?? 9) / 2) + 1 : 0;
  }

  // Snapshot handed to every overlay/panel client.
  snapshot() {
    const match = this.currentMatch;
    const round = match ? this.roundForMatch(match.ID) : null;
    return {
      scene: live.scene,
      backgrounds: backgrounds.list(),
      transition: backgrounds.transition(),
      theme: this.theme,
      bracket: this.bracket,
      match: match && {
        ...match,
        team1: this.teamByAcronym(match.Team1Acronym),
        team2: this.teamByAcronym(match.Team2Acronym),
        round,
        pointsToWin: this.pointsToWin(match),
      },
      live: {
        warmup: live.warmup,
        chatEnabled: live.chatEnabled,
        ipc: live.ipc,
        beatmap: live.beatmap,
        modAcronyms: modsToAcronyms(live.ipc.mods),
        players: live.players,
        chat: live.chat,
        tosuConnected: live.tosuConnected,
        ipcConnected: live.ipcConnected,
        standbyText: live.standbyText,
        countdownTarget: live.countdownTarget,
        showcaseBeatmapId: live.showcaseBeatmapId,
        transitionId: live.transitionId,
      },
    };
  }
}

export const store = new Store();
