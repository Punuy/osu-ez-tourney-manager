// mania-tourney server: serves the OBS overlay + control panel, watches osu!stable IPC,
// bridges tosu and obs-websocket, and owns the tournament state.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { config, saveConfig, PUBLIC, DATA, SCENES } from './config.js';
import { readOsuConfig, writeOsuConfig } from './osucfg.js';
import { store, live, EMPTY_BRACKET, DEFAULT_THEME } from './state.js';
import * as backgrounds from './backgrounds.js';
import { startIPC, awardPointForRanking } from './ipc.js';
import { startTosu } from './tosu.js';
import { getBeatmap } from './beatmaps.js';
import { connectOBS, disconnectOBS, listScenes, syncScene, obsStatus } from './obs.js';
import { connectIRC, disconnectIRC, ircStatus, say, setMap } from './irc.js';

backgrounds.init();

export { SCENES };

// --- push channel (SSE: one-way server->client is all the overlay needs) ----
const clients = new Set();
let pushTimer = null;

function push() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const payload = `event: state\ndata: ${JSON.stringify(store.snapshot())}\n\n`;
    for (const res of clients) {
      try { res.write(payload); } catch { clients.delete(res); }
    }
  }, 30); // coalesce bursts from the 200ms IPC poll
}
store.onChange(push);

export function setScene(scene, withTransition = false) {
  if (!SCENES.includes(scene)) return false;
  if (withTransition) live.transitionId += 1;
  live.scene = scene;
  syncScene(scene);
  push();
  return true;
}

// --- osu! integrations -----------------------------------------------------
startIPC({
  stablePath: config.stablePath,
  onBeatmap: async (id) => {
    live.beatmap = id ? await getBeatmap(id) : null;
    push();
  },
  onStateChange: (state) => {
    if (state === 'Ranking') awardPointForRanking();

    if (config.autoProgressScreens) {
      if (state === 'Playing' || state === 'WaitingForClients') {
        // A map actually starting is a strong signal, so this wins from any scene
        // including standby — that is how "park on the break screen" starts working.
        setScene('gameplay');
      } else if (state === 'Idle' && live.scene !== 'standby') {
        // Same progression osu!lazer performs: once a map settles back to Idle, move to
        // the winner screen if the match is over, otherwise back to the pool.
        const match = store.currentMatch;
        if (match && !live.warmup) {
          setTimeout(() => {
            if (live.ipc.state !== 'Idle') return;
            setScene(match.Completed ? 'win' : 'mappool');
          }, 4000);
        }
      }
    }
    push();
  },
});

startTosu({ ...config.tosu, onUpdate: push });
if (config.obs.enabled) connectOBS();
if (config.irc?.enabled) connectIRC();

// --- static files ----------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
  res.end(body);
}

const json = (res, data, code = 200) => send(res, code, 'application/json; charset=utf-8', JSON.stringify(data));

function serveStatic(res, root, rel) {
  const file = path.join(root, rel);
  if (!file.startsWith(root)) return send(res, 403, 'text/plain', 'forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'text/plain', 'not found');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });
    fs.createReadStream(file).pipe(res);
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 8e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
  });
}

// --- API -------------------------------------------------------------------
async function api(req, res, url) {
  const route = url.pathname.replace(/^\/api\/?/, '');
  const body = req.method === 'POST' ? await readBody(req) : {};
  const b = store.bracket;

  switch (`${req.method} ${route}`) {
    case 'GET state':
      return json(res, store.snapshot());

    case 'GET status':
      return json(res, {
        ipcConnected: live.ipcConnected,
        stablePath: config.stablePath,
        tosuConnected: live.tosuConnected,
        obs: obsStatus(),
        irc: ircStatus(),
        ipcState: live.ipc.state,
        scenes: SCENES,
        config,
      });

    case 'POST scene':
      return json(res, { ok: setScene(body.scene, body.transition === true) });

    case 'POST match/current': {
      live.currentMatchId = body.id ?? null;
      for (const m of b.Matches) m.Current = m.ID === live.currentMatchId;
      store.saveBracket();
      return json(res, { ok: true });
    }

    case 'POST match/score': {
      const m = store.currentMatch;
      if (!m) return json(res, { ok: false, error: 'no current match' }, 400);
      if (body.team1 !== undefined) m.Team1Score = Math.max(0, body.team1);
      if (body.team2 !== undefined) m.Team2Score = Math.max(0, body.team2);
      if (body.delta1) m.Team1Score = Math.max(0, (m.Team1Score || 0) + body.delta1);
      if (body.delta2) m.Team2Score = Math.max(0, (m.Team2Score || 0) + body.delta2);
      const need = store.pointsToWin(m);
      m.Completed = !!need && ((m.Team1Score || 0) >= need || (m.Team2Score || 0) >= need);
      store.saveBracket();
      return json(res, { ok: true });
    }

    case 'POST match/swap': {
      const m = store.currentMatch;
      if (!m) return json(res, { ok: false, error: 'no current match' }, 400);
      [m.Team1Acronym, m.Team2Acronym] = [m.Team2Acronym, m.Team1Acronym];
      [m.Team1Score, m.Team2Score] = [m.Team2Score ?? 0, m.Team1Score ?? 0];
      for (const p of m.PicksBans || []) p.Team = p.Team === 'Red' ? 'Blue' : 'Red';
      store.saveBracket();
      return json(res, { ok: true });
    }

    case 'POST match/reset': {
      const m = store.currentMatch;
      if (!m) return json(res, { ok: false }, 400);
      m.Team1Score = 0;
      m.Team2Score = 0;
      m.Completed = false;
      m.PicksBans = [];
      store.saveBracket();
      return json(res, { ok: true });
    }

    case 'POST warmup':
      live.warmup = !!body.value;
      push();
      return json(res, { ok: true, warmup: live.warmup });

    case 'POST chat':
      live.chatEnabled = !!body.value;
      push();
      return json(res, { ok: true });

    case 'POST standby':
      if (body.text !== undefined) live.standbyText = String(body.text);
      if (body.countdownTarget !== undefined) live.countdownTarget = body.countdownTarget;
      push();
      return json(res, { ok: true });

    case 'POST showcase':
      live.showcaseBeatmapId = Number(body.beatmapId) || 0;
      if (live.showcaseBeatmapId) await getBeatmap(live.showcaseBeatmapId);
      push();
      return json(res, { ok: true });

    case 'POST pickban': {
      const m = store.currentMatch;
      if (!m) return json(res, { ok: false, error: 'no current match' }, 400);
      m.PicksBans ||= [];
      const id = Number(body.beatmapId);
      const at = m.PicksBans.findIndex((p) => p.BeatmapID === id);
      const same = at >= 0 && m.PicksBans[at].Type === body.type && m.PicksBans[at].Team === body.team;
      if (at >= 0) m.PicksBans.splice(at, 1);
      // Clicking the same choice again clears it; anything else replaces it.
      if (!body.clear && !same) {
        m.PicksBans.push({
          Team: body.team === 'Blue' ? 'Blue' : 'Red',
          Type: body.type || 'Pick',
          BeatmapID: id,
        });
      }
      store.saveBracket();

      // A pick is the moment the room's map should change.
      if (config.irc?.enabled && config.irc?.autoSetMap && !body.clear && body.type === 'Pick') {
        const round = store.roundForMatch(m.ID);
        const rb = (round?.Beatmaps || []).find((x) => x.ID === id);
        setMap(id, rb?.Mods);
      }
      return json(res, { ok: true });
    }

    // Two panel tabs editing at once used to overwrite each other without a word.
    case 'POST teams':
    case 'POST rounds':
    case 'POST matches':
    case 'POST bracket':
      if (body.rev !== undefined && body.rev !== (b.Rev || 0)) {
        return json(res, { ok: false, stale: true, rev: b.Rev || 0 }, 409);
      }
      if (route === 'teams') b.Teams = body.teams ?? b.Teams;
      if (route === 'rounds') b.Rounds = body.rounds ?? b.Rounds;
      if (route === 'matches') b.Matches = body.matches ?? b.Matches;
      if (route === 'bracket') Object.assign(b, body.bracket ?? {});
      store.saveBracket();
      return json(res, { ok: true, rev: b.Rev });

    case 'POST theme':
      store.theme = { ...DEFAULT_THEME, ...store.theme, ...(body.theme ?? {}) };
      store.saveTheme();
      return json(res, { ok: true, theme: store.theme });

    case 'POST config':
      Object.assign(config, body.config ?? {});
      saveConfig(config);
      if (config.obs.enabled) connectOBS(); else disconnectOBS();
      if (config.irc?.enabled) connectIRC(); else disconnectIRC();
      push();
      return json(res, { ok: true, config });

    case 'POST import':
      Object.assign(b, EMPTY_BRACKET, body.bracket ?? {});
      live.currentMatchId = b.Matches.find((m) => m.Current)?.ID ?? null;
      store.saveBracket();
      return json(res, { ok: true, teams: b.Teams.length, matches: b.Matches.length });

    case 'GET export':
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="bracket.json"',
      });
      return res.end(JSON.stringify(b, null, 2));

    case 'POST background/settings':
      const changed = backgrounds.update(body.scene, body);
      push();
      return json(res, { ok: changed, backgrounds: backgrounds.list() });

    case 'POST background/remove':
      if (body.all) backgrounds.removeAll(); else backgrounds.remove(body.scene);
      push();
      return json(res, { ok: true, backgrounds: backgrounds.list() });

    case 'POST background/apply-all':
      backgrounds.applyToAll(body.scene);
      push();
      return json(res, { ok: true, backgrounds: backgrounds.list() });

    case 'POST transition/remove':
      backgrounds.removeTransition();
      push();
      return json(res, { ok: true, transition: backgrounds.transition() });

    case 'POST irc/say':
      return json(res, { ok: say(String(body.text || '')), status: ircStatus() });

    case 'POST irc/map':
      return json(res, { ok: setMap(Number(body.beatmapId), body.mods), status: ircStatus() });

    case 'GET osucfg':
      return json(res, readOsuConfig());

    case 'POST osucfg':
      try { return json(res, writeOsuConfig(body.patch)); }
      catch (err) { return json(res, { ok: false, error: String(err.message || err) }, 409); }

    case 'GET irc/status':
      return json(res, ircStatus());

    case 'GET obs/scenes':
      return json(res, { scenes: await listScenes() });
  }

  if (req.method === 'GET' && route.startsWith('beatmap/')) {
    return json(res, await getBeatmap(route.split('/')[1]));
  }
  if (req.method === 'POST' && route === 'beatmaps') {
    return json(res, { beatmaps: await Promise.all((body.ids || []).map(getBeatmap)) });
  }
  return json(res, { error: 'unknown route', route }, 404);
}

// --- server ----------------------------------------------------------------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') return send(res, 204, 'text/plain', '');

  if (url.pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',
    });
    res.write(`event: state\ndata: ${JSON.stringify(store.snapshot())}\n\n`);
    clients.add(res);
    const keepAlive = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { /* closed */ }
    }, 15000);
    req.on('close', () => { clearInterval(keepAlive); clients.delete(res); });
    return;
  }

  // Background upload is raw binary, streamed straight to disk: no multipart parsing,
  // no body size cap, and the browser can report progress via XHR.
  if (req.method === 'POST' && url.pathname === '/api/background/upload') {
    const scene = url.searchParams.get('scene') || '';
    const name = url.searchParams.get('name') || '';
    if (!SCENES.includes(scene)) return json(res, { error: 'unknown scene' }, 400);
    const target = backgrounds.fileNameFor(scene, name);
    if (!target) return json(res, { error: 'unsupported file type' }, 400);

    const dest = path.join(backgrounds.BG_DIR, target);
    const out = fs.createWriteStream(dest);
    req.pipe(out);
    out.on('finish', () => {
      backgrounds.set(scene, target);
      push();
      json(res, { ok: true, scene, backgrounds: backgrounds.list() });
    });
    out.on('error', (e) => json(res, { error: String(e) }, 500));
    req.on('aborted', () => { out.destroy(); try { fs.unlinkSync(dest); } catch { /* nothing written */ } });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/transition/upload') {
    const name = url.searchParams.get('name') || '';
    const target = backgrounds.transitionFileName(name);
    if (!target) return json(res, { error: 'transition must be an MP4 or WEBM video' }, 400);
    fs.mkdirSync(backgrounds.TRANSITION_DIR, { recursive: true });
    const dest = path.join(backgrounds.TRANSITION_DIR, target);
    const out = fs.createWriteStream(dest);
    req.pipe(out);
    out.on('finish', () => {
      backgrounds.setTransition(target);
      push();
      json(res, { ok: true, transition: backgrounds.transition() });
    });
    out.on('error', (e) => json(res, { error: String(e) }, 500));
    req.on('aborted', () => { out.destroy(); try { fs.unlinkSync(dest); } catch { /* nothing written */ } });
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    return api(req, res, url).catch((e) => json(res, { error: String(e) }, 500));
  }
  if (url.pathname.startsWith('/data/')) {
    return serveStatic(res, DATA, decodeURIComponent(url.pathname.slice(6)));
  }

  let rel = decodeURIComponent(url.pathname);
  // Redirect the bare names so the pages' relative asset paths still resolve.
  if (rel === '/' || rel === '/panel' || rel === '/overlay') {
    res.writeHead(302, { Location: rel === '/overlay' ? '/overlay/' : '/panel/' });
    return res.end();
  }
  if (rel === '/panel/') rel = '/panel/index.html';
  if (rel === '/overlay/') rel = '/overlay/index.html';
  return serveStatic(res, PUBLIC, rel);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('');
    console.error(`  พอร์ต ${config.port} ถูกใช้อยู่แล้ว`);
    console.error('  - เปิด mania-tourney ค้างอยู่หรือเปล่า? ลองเปิด http://localhost:' + config.port + '/panel ดูก่อน');
    console.error('  - ถ้าอยากปิดตัวเก่า:  npx kill-port ' + config.port);
    console.error(`  - หรือเปลี่ยนพอร์ตที่ data/config.json ("port": ${config.port})`);
    console.error('');
    process.exit(1);
  }
  throw err;
});

server.listen(config.port, () => {
  const base = `http://localhost:${config.port}`;
  console.log('');
  console.log('  mania-tourney  ready');
  console.log('  ---------------------------------------------');
  console.log(`  Control panel  ${base}/panel`);
  console.log(`  OBS overlay    ${base}/overlay   (1920x1080 Browser Source)`);
  console.log(`  osu! stable    ${config.stablePath || 'NOT FOUND - set it in the panel'}`);
  console.log('  ---------------------------------------------');
  console.log('');
  if (config.openPanelOnStart && process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', `${base}/panel`], { detached: true, stdio: 'ignore' }).unref();
  }
});

process.on('SIGINT', () => { disconnectOBS(); process.exit(0); });
