// Reads the four IPC files osu!stable's tourney client writes into its install root.
// Same contract osu!lazer's FileBasedIPC consumes:
//   ipc.txt          line1 beatmapId, line2 legacy mods bitmask
//   ipc-state.txt    Initialising | Idle | WaitingForClients | Playing | Ranking
//   ipc-scores.txt   line1 team1 score, line2 team2 score
//   ipc-channel.txt  match chat channel name
import fs from 'node:fs';
import path from 'node:path';
import { live, store } from './state.js';

const POLL_MS = 200;
const FILES = { main: 'ipc.txt', state: 'ipc-state.txt', scores: 'ipc-scores.txt', channel: 'ipc-channel.txt' };
export const STATES = ['Initialising', 'Idle', 'WaitingForClients', 'Playing', 'Ranking'];

function lines(dir, name) {
  try { return fs.readFileSync(path.join(dir, name), 'utf8').split(/\r?\n/); }
  catch { return null; }
}

// A point is only ever awarded for a map we actually saw being played. Without
// this, an Idle->Ranking flap (a client rejoining the results screen) scores twice.
let sawPlaying = false;

export function startIPC({ stablePath, onBeatmap, onStateChange }) {
  let lastState = live.ipc.state;
  let timer = null;

  function tick() {
    if (!stablePath) { live.ipcConnected = false; return; }
    const main = lines(stablePath, FILES.main);
    live.ipcConnected = main !== null;
    if (!main) return;

    const beatmapId = parseInt(main[0], 10) || 0;
    const mods = parseInt(main[1], 10) || 0;
    if (beatmapId !== live.ipc.beatmapId) {
      live.ipc.beatmapId = beatmapId;
      onBeatmap?.(beatmapId);
    }
    live.ipc.mods = mods;

    const scores = lines(stablePath, FILES.scores);
    if (scores) {
      live.ipc.score1 = parseInt(scores[0], 10) || 0;
      live.ipc.score2 = parseInt(scores[1], 10) || 0;
    }

    const channel = lines(stablePath, FILES.channel);
    if (channel) live.ipc.channel = (channel[0] || '').trim();

    const st = lines(stablePath, FILES.state);
    const state = st && STATES.includes((st[0] || '').trim()) ? st[0].trim() : live.ipc.state;
    if (state !== live.ipc.state) {
      if (state === 'Playing') sawPlaying = true;
      live.ipc.state = state;
      onStateChange?.(state, lastState);
      lastState = state;
    }
  }

  timer = setInterval(tick, POLL_MS);
  tick();
  return () => clearInterval(timer);
}

// Mirrors GameplayScreen.updateState() in osu!lazer: a map that reaches Ranking
// awards a point to whichever team scored higher, unless this was a warmup.
export function awardPointForRanking() {
  const match = store.currentMatch;
  if (!match || live.warmup) return false;
  if (!sawPlaying) return false;      // already scored, or nobody played yet
  sawPlaying = false;
  if (live.ipc.score1 > live.ipc.score2) match.Team1Score = (match.Team1Score || 0) + 1;
  else if (live.ipc.score2 > live.ipc.score1) match.Team2Score = (match.Team2Score || 0) + 1;
  else return false;
  const need = store.pointsToWin(match);
  if (need && ((match.Team1Score || 0) >= need || (match.Team2Score || 0) >= need)) match.Completed = true;
  store.saveBracket();
  return true;
}
