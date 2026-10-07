// OBS overlay. One browser source renders every scene; the server decides which is
// visible, so the operator never has to touch OBS mid-match.
import { api, subscribe, esc, fmtScore, fmtTime, flagUrl, avatarUrl, modBracket } from '../shared/bus.js';

const stage = document.getElementById('stage');
const panes = Object.fromEntries(
  [...document.querySelectorAll('.scene')].map((n) => [n.dataset.scene, n])
);
const transitionVideo = document.getElementById('scene-transition');
let transitionSource = '';
let lastTransitionId = null;

function playTransition(state) {
  if (PINNED || !transitionVideo) return;
  const file = state.transition?.file;
  if (!file) return;
  const src = `/data/transitions/${encodeURIComponent(file)}?v=${state.transition.size || 0}`;
  if (transitionSource !== src) {
    transitionSource = src;
    transitionVideo.src = src;
  }
  transitionVideo.currentTime = 0;
  transitionVideo.classList.add('playing');
  transitionVideo.play().catch(() => transitionVideo.classList.remove('playing'));
}

transitionVideo?.addEventListener('ended', () => transitionVideo.classList.remove('playing'));
transitionVideo?.addEventListener('error', () => transitionVideo.classList.remove('playing'));

// Scale the fixed 1920x1080 stage to whatever the browser source is sized at.
function fitStage() {
  const s = Math.min(innerWidth / 1920, innerHeight / 1080);
  stage.style.transform = `translate(-50%, -50%) scale(${s})`;
}
addEventListener('resize', fitStage);
fitStage();

const sceneSignatures = {};
let S = null;   // latest snapshot

// --- small builders --------------------------------------------------------
const teamName = (t, fallback) => esc(t?.FullName || t?.Acronym || fallback || 'TBD');

/** Team badge: the country flag, or the first player's avatar for 1v1 formats. */
function flag(t, cls = 'team-flag') {
  if (S?.bracket?.TeamIcon === 'avatar') {
    const p = (t?.Players || [])[0];
    if (p?.id) return `<img class="${cls} as-avatar" src="${esc(avatarUrl(p.id))}" onerror="this.style.display='none'">`;
  }
  const url = flagUrl(t?.FlagName);
  return url ? `<img class="${cls}" src="${esc(url)}" onerror="this.style.display='none'">` : '';
}

function stars(count, need, colour, side = '') {
  let out = `<div class="stars ${side}">`;
  for (let i = 0; i < need; i++) out += `<div class="star ${i < count ? `on ${colour}` : ''}"></div>`;
  return `${out}</div>`;
}

function hasBg(scene) {
  const bg = S?.backgrounds?.[scene];
  return !!bg && (!!bg.file || !!bg.html || !!bg.css);
}

/** Per-scene background media, with the dim the operator set on it.  Custom
 * HTML/CSS is deliberately not handled here: it is a separate foreground layer
 * that can sit above an uploaded image, GIF, or video. */
function bgMedia(scene) {
  const bg = S?.backgrounds?.[scene];
  if (!bg?.file) return '';
  const dim = Math.max(0, Math.min(100, bg.dim || 0)) / 100;
  const src = `/data/backgrounds/${encodeURIComponent(bg.file)}`;
  const fit = bg.fit === 'contain' ? 'contain' : 'cover';
  const media = bg.type === 'video'
    ? `<video class="bg-media" autoplay loop muted playsinline src="${src}" style="object-fit: ${fit}"></video>`
    : `<img class="bg-media" src="${src}" style="object-fit: ${fit}">`;
  return media + (dim ? `<div class="bg-dim" style="opacity: ${dim}"></div>` : '');
}

/** A saved custom scene replaces the built-in scene markup.  The original
 * scene can be imported from the Backgrounds editor as a starting point. */
function customOverlay(scene, force = false) {
  const bg = S?.backgrounds?.[scene] || {};
  if (!force && !bg?.overlay) return '';
  return `${bgMedia(scene)}${bg.css ? `<style>${bg.css}</style>` : ''}<div class="custom-overlay">${bg.html || ''}</div>`;
}

/** Readability scrim. It lightens when there is a background worth seeing. */
function veil(scene) {
  return `<div class="veil${hasBg(scene) ? ' over-bg' : ''}"></div>`;
}

function header(state, showRound = true) {
  const t = state.theme;
  const round = state.match?.round?.Name || '';
  return `<div class="header">
    ${t.logo ? `<img class="logo" src="/data/logos/${esc(t.logo)}" onerror="this.remove()">` : ''}
    <div class="tournament-name">${esc(t.name)}</div>
    ${showRound && round ? `<div class="round-name">${esc(round)}</div>` : ''}
  </div>`;
}

function songBar(bm, mods = []) {
  if (!bm) return '';
  return `<div class="song-bar">
    <img class="cover" src="${esc(bm.cover)}" onerror="this.style.visibility='hidden'">
    <div>
      <div class="title">${esc(bm.title)}</div>
      <div class="artist">${esc(bm.artist)}</div>
      <div class="diffline">[${esc(bm.version)}] &nbsp;mapped by ${esc(bm.creator)}${mods.length ? ` &nbsp;·&nbsp; ${mods.join(' ')}` : ''}</div>
    </div>
    <div class="stats">
      ${bm.keys ? `<div class="stat"><b>${bm.keys}K</b><span>keys</span></div>` : ''}
      <div class="stat"><b>${bm.stars.toFixed(2)}</b><span>stars</span></div>
      <div class="stat"><b>${Math.round(bm.bpm)}</b><span>bpm</span></div>
      <div class="stat"><b>${fmtTime(bm.length)}</b><span>length</span></div>
      <div class="stat"><b>${bm.od}</b><span>od</span></div>
    </div>
  </div>`;
}

// --- scenes ----------------------------------------------------------------
const scenes = {
  gameplay(state) {
    const m = state.match;
    const need = m?.pointsToWin || 0;
    const perTeam = state.bracket.PlayersPerTeam || 1;
    // Free region between the header and the song bar. Left transparent by default,
    // so the spectator windows behind the browser source simply show through.
    const chromaW = state.bracket.ChromaKeyWidth || 1920;
    const chromaH = state.bracket.ChromaKeyHeight || 790;

    return `${bgMedia('gameplay')}
    <div class="gp-top">
      <div class="gp-team">
        ${flag(m?.team1)}
        <div class="meta">
          <div class="team-name">${teamName(m?.team1, m?.Team1Acronym)}</div>
          ${state.bracket.DisplayTeamSeeds && m?.team1?.Seed ? `<div class="team-seed">Seed ${esc(m.team1.Seed)}</div>` : ''}
          ${stars(m?.Team1Score || 0, need, 'red')}
        </div>
      </div>
      <div class="gp-centre">
        <div class="round">${esc(m?.round?.Name || '')}</div>
        <div class="best-of">BEST OF ${m?.round?.BestOf ?? '-'}</div>
      </div>
      <div class="gp-team right">
        ${flag(m?.team2)}
        <div class="meta">
          <div class="team-name">${teamName(m?.team2, m?.Team2Acronym)}</div>
          ${state.bracket.DisplayTeamSeeds && m?.team2?.Seed ? `<div class="team-seed">Seed ${esc(m.team2.Seed)}</div>` : ''}
          ${stars(m?.Team2Score || 0, need, 'blue', 'right')}
        </div>
      </div>
    </div>

    ${state.live.warmup ? '<div class="badge">warmup</div>' : ''}

    <div class="diff-bar">
      <div class="diff-label" data-diff>0</div>
      <div class="diff-track">
        <div class="diff-fill red" data-fill-red></div>
        <div class="diff-fill blue" data-fill-blue></div>
      </div>
      <div class="diff-scores"><span data-s1>0</span><span data-s2>0</span></div>
    </div>

    <div id="chroma-area" style="width:${chromaW}px;height:${chromaH}px;${state.theme.showChroma ? '' : 'display:none'}"></div>

    <div class="players" data-players></div>
    <div class="chat" data-chat></div>
    ${songBar(state.live.beatmap, state.live.modAcronyms || [])}`;
  },

  mappool(state) {
    const m = state.match;
    const round = m?.round;
    const maps = round?.Beatmaps || [];
    const picks = Object.fromEntries((m?.PicksBans || []).map((p) => [p.BeatmapID, p]));
    const groups = new Map();
    for (const rb of maps) {
      const key = state.bracket.SplitMapPoolByMods ? modBracket(rb.Mods) : 'POOL';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(rb);
    }

    const cards = [...groups].map(([mod, list]) => `
      <div class="mod-group">
        <div class="mod-tag ${esc(mod)}">${esc(mod)}</div>
        <div class="mod-maps">${list.map((rb) => {
          const bm = state.beatmapCache?.[rb.ID] || rb.BeatmapInfo || {};
          const choice = picks[rb.ID];
          const colour = choice?.Team === 'Blue' ? 'blue' : 'red';
          const cls = choice
            ? (choice.Type === 'Ban' ? `banned ban-${colour}` : choice.Type === 'Protect' ? '' : `picked-${colour}`)
            : '';
          const title = bm.title || bm.Title || `Beatmap ${rb.ID}`;
          const artist = bm.artist || bm.Artist || '';
          const version = bm.version || bm.DifficultyName || '';
          return `<div class="map-card ${cls}">
            ${bm.cover ? `<img class="cover" src="${esc(bm.cover)}">` : ''}
            <div class="info">
              <div class="m-title">${esc(title)}</div>
              <div class="m-artist">${esc(artist)}</div>
              <div class="m-diff">[${esc(version)}]${bm.stars ? ` · ${bm.stars.toFixed(2)}★` : ''}${bm.keys ? ` · ${bm.keys}K` : ''}</div>
            </div>
            <div class="m-slot">${esc(rb.Mods || '')}</div>
            ${choice?.Type === 'Ban' ? '<div class="ban-x">✕</div>' : ''}
            ${choice?.Type === 'Protect' ? '<div class="protect-ring"></div>' : ''}
          </div>`;
        }).join('')}</div>
      </div>`).join('');

    return `${bgMedia('mappool')}${veil('mappool')}${header(state)}
    <div class="pool">
      <div class="pool-head">
        <div class="gp-team">${flag(m?.team1)}<div class="meta">
          <div class="team-name">${teamName(m?.team1, m?.Team1Acronym)}</div>
          ${stars(m?.Team1Score || 0, m?.pointsToWin || 0, 'red')}</div>
        </div>
        <div class="pool-legend">
          <span><i style="background:var(--c-red)"></i>${teamName(m?.team1, 'RED')}</span>
          <span>BEST OF ${round?.BestOf ?? '-'} · ${round?.BanCount ?? 0} BAN</span>
          <span><i style="background:var(--c-blue)"></i>${teamName(m?.team2, 'BLUE')}</span>
        </div>
        <div class="gp-team right">${flag(m?.team2)}<div class="meta">
          <div class="team-name">${teamName(m?.team2, m?.Team2Acronym)}</div>
          ${stars(m?.Team2Score || 0, m?.pointsToWin || 0, 'blue', 'right')}</div>
        </div>
      </div>
      <div style="overflow:hidden">${cards || '<div style="color:var(--c-dim);font-size:24px">No map pool set for this round.</div>'}</div>
    </div>`;
  },

  teamintro(state) {
    const m = state.match;
    const roster = (team, captainFirst = true) => `<div class="roster">${(team?.Players || []).map((p, i) => `
      <div class="p ${captainFirst && i === 0 ? 'captain' : ''}">
        <img src="${esc(avatarUrl(p.id))}" onerror="this.style.visibility='hidden'">
        <div class="n">${esc(p.username || p.Username || '')}</div>
        <div class="r">${p.rank ? `#${Number(p.rank).toLocaleString('en-US')}` : ''}</div>
      </div>`).join('')}</div>`;

    return `${bgMedia('teamintro')}${veil('teamintro')}${header(state)}
    <div class="vs">
      <div class="vs-team">
        ${flag(m?.team1)}
        <div class="team-name">${teamName(m?.team1, m?.Team1Acronym)}</div>
        ${m?.team1?.Seed ? `<div class="team-seed">Seed ${esc(m.team1.Seed)}</div>` : ''}
        ${roster(m?.team1)}
      </div>
      <div class="vs-mid">VS</div>
      <div class="vs-team">
        ${flag(m?.team2)}
        <div class="team-name">${teamName(m?.team2, m?.Team2Acronym)}</div>
        ${m?.team2?.Seed ? `<div class="team-seed">Seed ${esc(m.team2.Seed)}</div>` : ''}
        ${roster(m?.team2)}
      </div>
    </div>`;
  },

  seeding(state) {
    const m = state.match;
    const block = (team) => `<div class="seed-block">
      <h3>${teamName(team)} ${team?.Seed ? `· Seed ${esc(team.Seed)}` : ''}</h3>
      ${(team?.SeedingResults || []).map((r) => `
        <div class="seed-line"><span>${esc(r.Mod || '')} · seed ${esc(r.Seed ?? '')}</span></div>
        ${(r.Beatmaps || []).map((sb) => `<div class="seed-line">
          <span>${esc(sb.Beatmap?.title || sb.Beatmap?.Title || `Beatmap ${sb.ID}`)}</span>
          <span>${fmtScore(sb.Score)}</span>
          <span>#${sb.Seed ?? '-'}</span>
          <span>${esc(sb.Mods || '')}</span>
        </div>`).join('')}`).join('') || '<div class="seed-line"><span>No seeding data</span></div>'}
    </div>`;
    return `${bgMedia('seeding')}${veil('seeding')}${header(state)}
      <div class="seeding">${block(m?.team1)}${block(m?.team2)}</div>`;
  },

  bracket(state) {
    const teams = Object.fromEntries(state.bracket.Teams.map((t) => [t.Acronym, t]));
    const cards = state.bracket.Matches.map((m) => {
      const x = m.Position?.X ?? 0;
      const y = m.Position?.Y ?? 0;
      const t1 = teams[m.Team1Acronym];
      const t2 = teams[m.Team2Acronym];
      const done = m.Completed;
      const w1 = done && (m.Team1Score || 0) > (m.Team2Score || 0);
      const w2 = done && (m.Team2Score || 0) > (m.Team1Score || 0);
      return `<div class="lm ${m.ID === state.match?.ID ? 'current' : ''}" style="left:${x}px;top:${y}px">
        <div class="row ${w1 ? 'win' : ''}"><span>${teamName(t1, m.Team1Acronym)}</span><span class="sc">${m.Team1Score ?? ''}</span></div>
        <div class="row ${w2 ? 'win' : ''}"><span>${teamName(t2, m.Team2Acronym)}</span><span class="sc">${m.Team2Score ?? ''}</span></div>
      </div>`;
    }).join('');
    return `${bgMedia('bracket')}${veil('bracket')}${header(state, false)}
      <div class="ladder"><div class="ladder-inner">${cards}</div></div>`;
  },

  schedule(state) {
    const teams = Object.fromEntries(state.bracket.Teams.map((t) => [t.Acronym, t]));
    const rows = [...state.bracket.Matches]
      .filter((m) => m.Team1Acronym || m.Team2Acronym)
      .sort((a, b) => new Date(a.Date || 0) - new Date(b.Date || 0))
      .slice(0, 9)
      .map((m) => {
        const round = state.bracket.Rounds.find((r) => (r.Matches || []).includes(m.ID));
        const when = m.Date ? new Date(m.Date).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'TBD';
        return `<div class="list-row ${m.ID === state.match?.ID ? 'current' : ''}">
          <div class="when">${esc(when)}</div>
          <div class="t1">${teamName(teams[m.Team1Acronym], m.Team1Acronym)}</div>
          <div class="vs-sm">${m.Completed ? `${m.Team1Score ?? 0} : ${m.Team2Score ?? 0}` : 'vs'}</div>
          <div class="t2">${teamName(teams[m.Team2Acronym], m.Team2Acronym)}</div>
          <div class="round-of">${esc(round?.Name || '')}</div>
        </div>`;
      }).join('');
    return `${bgMedia('schedule')}${veil('schedule')}${header(state, false)}
      <div class="list">${rows || '<div class="list-row"><div class="when">—</div><div class="t1">No matches scheduled</div><div></div><div></div><div></div></div>'}</div>`;
  },

  showcase(state) {
    const bm = state.beatmapCache?.[state.live.showcaseBeatmapId] || state.live.beatmap;
    if (!bm) return `${bgMedia('showcase')}${veil('showcase')}${header(state, false)}`;
    return `${bgMedia('showcase')}${veil('showcase')}${header(state, false)}
      <div class="showcase"><div class="card">
        <div class="banner"><img src="${esc(bm.cover)}"><div class="grad"></div></div>
        <div class="body">
          <div class="t">${esc(bm.title)}</div>
          <div class="a">${esc(bm.artist)}</div>
          <div class="d">[${esc(bm.version)}] · mapped by ${esc(bm.creator)}</div>
          <div class="stats">
            ${bm.keys ? `<div class="stat"><b>${bm.keys}K</b><span>keys</span></div>` : ''}
            <div class="stat"><b>${bm.stars.toFixed(2)}</b><span>stars</span></div>
            <div class="stat"><b>${Math.round(bm.bpm)}</b><span>bpm</span></div>
            <div class="stat"><b>${fmtTime(bm.length)}</b><span>length</span></div>
            <div class="stat"><b>${bm.od}</b><span>od</span></div>
          </div>
        </div>
      </div></div>`;
  },

  win(state) {
    const m = state.match;
    if (!m) return bgMedia('win');
    const red = (m.Team1Score || 0) > (m.Team2Score || 0);
    const winner = red ? m.team1 : m.team2;
    return `${bgMedia('win')}${veil('win')}${header(state)}
      <div class="winner">
        <div class="label">winner</div>
        ${flag(winner)}
        <div class="team-name" style="color:${red ? 'var(--c-red)' : 'var(--c-blue)'}">${teamName(winner)}</div>
        <div class="final">${m.Team1Score ?? 0} — ${m.Team2Score ?? 0}</div>
      </div>`;
  },

  drawings(state) {
    const d = state.bracket.Drawings || { groups: [], current: null };
    return `${bgMedia('drawings')}${veil('drawings')}${header(state, false)}
      <div class="drawings">
        <div class="draw-current">${d.current ? `${flag(d.current, '')}<span>${teamName(d.current)}</span>` : '<span style="color:var(--c-dim)">…</span>'}</div>
        <div class="draw-groups">${(d.groups || []).map((g) => `
          <div class="draw-group"><h4>GROUP ${esc(g.name)}</h4>
            ${(g.teams || []).map((t) => `<div class="t">${flag(t, '')}<span>${teamName(t)}</span></div>`).join('')}
          </div>`).join('')}</div>
      </div>`;
  },

  standby(state) {
    const t = state.theme;
    return `${bgMedia('standby')}${veil('standby')}
      <div class="standby">
        ${t.logo ? `<img class="logo" src="/data/logos/${esc(t.logo)}" onerror="this.remove()">` : ''}
        <div class="name">${esc(t.name)}</div>
        <div class="rule"></div>
        <div class="msg">${esc(state.live.standbyText || t.subtitle || '')}</div>
        <div class="countdown" data-countdown></div>
      </div>`;
  },
};

// --- hot-path patching (avoids rebuilding the DOM 5x a second) --------------
function patchGameplay(pane, state) {
  // Built-in gameplay markup is optional: custom overlays own their whole DOM.
  if (!pane.querySelector('[data-diff]')) return;
  const live = state.live;
  const s1 = live.ipc.score1 || 0;
  const s2 = live.ipc.score2 || 0;
  const diff = Math.abs(s1 - s2);
  const max = Math.max(s1, s2, 1);
  const pct = Math.min(1, diff / (max * 0.25 || 1)) * 50;

  pane.querySelector('[data-diff]').textContent = diff ? fmtScore(diff) : '';
  pane.querySelector('[data-s1]').textContent = fmtScore(s1);
  pane.querySelector('[data-s2]').textContent = fmtScore(s2);
  pane.querySelector('[data-fill-red]').style.width = `${s1 > s2 ? pct : 0}%`;
  pane.querySelector('[data-fill-blue]').style.width = `${s2 > s1 ? pct : 0}%`;

  // Per-player rows only exist when tosu is feeding us.
  const holder = pane.querySelector('[data-players]');
  const left = live.players.filter((p) => p.team === 'red');
  const right = live.players.filter((p) => p.team === 'blue');
  const row = (p, side) => `<div class="player-row ${p.failed ? 'failed' : ''}">
      <img class="avatar" src="${esc(avatarUrl(p.userId))}" onerror="this.style.visibility='hidden'">
      <div class="pname">${esc(p.name)}</div>
      <div class="pstat">${p.accuracy.toFixed(2)}%</div>
      <div class="pstat">${p.combo}x</div>
      <div class="pscore">${fmtScore(p.score)}</div>
      <div class="hp"><i style="width:${Math.round((p.hp / 200) * 100)}%"></i></div>
    </div>`;
  holder.innerHTML = live.players.length
    ? `<div class="player-col">${left.map((p) => row(p, 'l')).join('')}</div>
       <div class="player-col right">${right.map((p) => row(p, 'r')).join('')}</div>`
    : '';

  const chat = pane.querySelector('[data-chat]');
  const idle = live.ipc.state === 'Idle' || live.ipc.state === 'Ranking';
  chat.classList.toggle('hidden', !live.chatEnabled || !idle);
  if (live.chatEnabled && idle && live.chat) {
    chat.innerHTML = live.chat.slice(-10).map((c) => {
      const side = c.team === 'left' ? 'red' : c.team === 'right' ? 'blue' : '';
      return `<div class="msg ${side}"><b>${esc(c.name)}</b> ${esc(c.message)}</div>`;
    }).join('');
  }
}

let countdownTimer = null;
function patchStandby(pane, state) {
  clearInterval(countdownTimer);
  const node = pane.querySelector('[data-countdown]');
  const target = state.live.countdownTarget ? new Date(state.live.countdownTarget) : null;
  if (!node) return;
  if (!target) { node.textContent = ''; return; }
  const tick = () => {
    const left = Math.max(0, Math.floor((target - Date.now()) / 1000));
    node.textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}

// --- render loop -----------------------------------------------------------
const beatmapCache = {};

async function warmBeatmapCache(state) {
  const ids = new Set();
  for (const round of state.bracket.Rounds || []) {
    for (const rb of round.Beatmaps || []) ids.add(rb.ID);
  }
  if (state.live.showcaseBeatmapId) ids.add(state.live.showcaseBeatmapId);
  const missing = [...ids].filter((id) => id && !beatmapCache[id]);
  if (!missing.length) return false;
  const res = await fetch('/api/beatmaps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: missing }),
  }).then((r) => r.json()).catch(() => null);
  for (const bm of res?.beatmaps || []) beatmapCache[bm.id] = bm;
  return true;
}

/** Anything in here changing means the scene's DOM must be rebuilt. */
function signature(scene, state) {
  const m = state.match;
  const base = [
    scene, m?.ID, m?.Team1Score, m?.Team2Score, m?.Completed,
    m?.round?.Name, m?.round?.BestOf, state.theme.name, state.theme.logo,
    state.bracket.PlayersPerTeam, state.bracket.TeamIcon, state.bracket.ChromaKeyWidth, state.bracket.ChromaKeyHeight, state.theme.showChroma,
    state.live.warmup, state.live.beatmap?.id,
  ];
  if (scene === 'mappool') base.push(JSON.stringify(m?.PicksBans), (m?.round?.Beatmaps || []).length, Object.keys(beatmapCache).length);
  if (scene === 'bracket' || scene === 'schedule') base.push(state.bracket.Matches.length, JSON.stringify(state.bracket.Matches.map((x) => [x.Team1Score, x.Team2Score, x.Completed])));
  if (scene === 'teamintro' || scene === 'seeding') base.push(JSON.stringify([m?.team1, m?.team2]));
  if (scene === 'showcase') base.push(state.live.showcaseBeatmapId, Object.keys(beatmapCache).length);
  if (scene === 'standby') base.push(state.live.standbyText, state.live.countdownTarget);
  if (scene === 'drawings') base.push(JSON.stringify(state.bracket.Drawings));
  base.push(JSON.stringify(state.backgrounds || {}));
  return base.join('|');
}

// #scene=mappool pins this overlay to one scene instead of following the live one -
// that is how the panel's preview pane shows a scene that is not on air.
// The pin lives in the HASH, not the query: a query string gets normalised away by
// some proxies (that is what broke the first version), and changing a hash re-renders
// without reloading the page, so the preview switches instantly and never fades.
let lastActive = null;
let leaveTimer = null;

const readHash = () => new URLSearchParams(location.hash.slice(1));
const readPin = () => readHash().get('scene');
const readCustomPreview = () => readHash().get('custom') === '1';
let PINNED = readPin();
let CUSTOM_PREVIEW = readCustomPreview();
document.body.classList.toggle('pinned', !!PINNED);
document.body.classList.toggle('custom-preview', CUSTOM_PREVIEW);

addEventListener('hashchange', () => {
  PINNED = readPin();
  CUSTOM_PREVIEW = readCustomPreview();
  document.body.classList.toggle('pinned', !!PINNED);
  document.body.classList.toggle('custom-preview', CUSTOM_PREVIEW);
  for (const key of Object.keys(sceneSignatures)) delete sceneSignatures[key];
  if (S) render(S);
});

function render(state) {
  S = state;
  state.beatmapCache = beatmapCache;
  state.live.modAcronyms = state.live.modAcronyms || [];

  const active = PINNED && panes[PINNED] ? PINNED : state.scene;
  if (active !== lastActive) {
    const outgoing = panes[lastActive];
    // Pinned previews switch instantly, so they get no dissolve.
    if (outgoing && !PINNED) {
      outgoing.classList.add('leaving');
      clearTimeout(leaveTimer);
      leaveTimer = setTimeout(() => outgoing.classList.remove('leaving'), 600);
    }
    lastActive = active;
  }
  if (lastTransitionId === null) {
    lastTransitionId = state.live.transitionId || 0;
  } else if (!PINNED && state.live.transitionId !== lastTransitionId) {
    lastTransitionId = state.live.transitionId;
    playTransition(state);
  }
  for (const [name, pane] of Object.entries(panes)) {
    pane.classList.toggle('active', name === active);
  }

  const pane = panes[active];
  if (!pane) return;

  // The editor preview is deliberately blank until the operator writes custom
  // markup. It must never fall back to the built-in scene template.
  if (CUSTOM_PREVIEW) {
    pane.innerHTML = customOverlay(active, true);
    return;
  }

  const sig = signature(active, state);
  if (sceneSignatures[active] !== sig) {
    sceneSignatures[active] = sig;
    // A scene is entirely user-authored. No stock scene is rendered as a
    // fallback, so an untouched scene stays empty in OBS and every preview.
    pane.innerHTML = customOverlay(active);
    if (active === 'standby') patchStandby(pane, state);
  }
  if (active === 'gameplay') patchGameplay(pane, state);
}

async function receiveState(state) {
  const grew = await warmBeatmapCache(state);
  if (grew) sceneSignatures.mappool = sceneSignatures.showcase = null;
  render(state);
}

// Render once immediately. SSE remains the live update channel, but an overlay
// must not stay transparent/white while its EventSource is connecting.
api.get('state').then(receiveState).catch(() => {});
subscribe(receiveState);
