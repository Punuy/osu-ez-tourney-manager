// Optional bridge to tosu (https://github.com/tosuapp/tosu). The IPC files give us the
// map, state and team totals; tosu adds what they cannot carry: per-player score,
// accuracy, combo, mania judgements, HP and the in-game #multiplayer chat.
import { live } from './state.js';

const RECONNECT_MS = 4000;

function maniaHits(hits = {}) {
  return {
    perfect: hits.geki || 0,   // 300g / rainbow
    great: hits['300'] || 0,
    good: hits.katu || 0,      // 200
    ok: hits['100'] || 0,
    meh: hits['50'] || 0,
    miss: hits['0'] || 0,
  };
}

function normalise(client) {
  const play = client.play || {};
  return {
    ipcId: client.ipcId ?? 0,
    team: client.team === 'right' ? 'blue' : 'red',
    userId: client.user?.id ?? 0,
    name: client.user?.name || play.playerName || '',
    country: client.user?.country || '',
    globalRank: client.user?.globalRank ?? 0,
    score: play.score ?? 0,
    accuracy: Math.round((play.accuracy ?? 0) * 100) / 100,
    combo: play.combo?.current ?? 0,
    maxCombo: play.combo?.max ?? 0,
    hp: play.healthBar?.smooth ?? play.healthBar?.normal ?? 0,
    failed: !!play.failed,
    rank: play.rank?.current || '',
    mods: play.mods?.name || '',
    hits: maniaHits(play.hits),
    scrollSpeed: client.settings?.mania?.scrollSpeed ?? 0,
  };
}

export function startTosu({ url, enabled, onUpdate }) {
  let socket = null;
  let timer = null;
  let stopped = false;

  function connect() {
    if (stopped || !enabled) return;
    try {
      socket = new WebSocket(url);
    } catch {
      timer = setTimeout(connect, RECONNECT_MS);
      return;
    }

    socket.addEventListener('open', () => { live.tosuConnected = true; onUpdate?.('connect'); });

    socket.addEventListener('message', (ev) => {
      let data;
      try { data = JSON.parse(ev.data); } catch { return; }
      const t = data.tourney;
      if (!t) { live.players = []; return; }
      live.players = (t.clients || []).map(normalise);
      live.chat = (t.chat || []).slice(-60);
      live.tosuTeamNames = t.team || null;
      live.tosuScoreVisible = t.scoreVisible ?? true;
      onUpdate?.('data');
    });

    const retry = () => {
      live.tosuConnected = false;
      live.players = [];
      onUpdate?.('disconnect');
      if (!stopped) timer = setTimeout(connect, RECONNECT_MS);
    };
    socket.addEventListener('close', retry);
    socket.addEventListener('error', () => { try { socket.close(); } catch { /* already closing */ } });
  }

  connect();
  return () => { stopped = true; clearTimeout(timer); try { socket?.close(); } catch { /* not open */ } };
}
