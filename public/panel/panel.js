// Control panel: scenes, pick/ban, scores, per-scene backgrounds, and the editors.
import { api, subscribe, esc, fmtScore, modBracket, avatarUrl } from '../shared/bus.js';

let S = null;          // live snapshot from the server
let status = {};       // integration status
let page = 'live';
let liveSig = '';
let previewScene = null;   // staged scene, only goes live on FADE
const beatmaps = {};   // id -> metadata, filled lazily for pool cards

const $ = (sel, root = document) => root.querySelector(sel);
const pageEl = (name) => document.querySelector(`.page[data-page="${name}"]`);

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 1900);
}

const fmtBytes = (n) => (!n ? '—' : n > 1e6 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

// ===========================================================================
// SCENES — order is the hotkey order (1-9 then 0). Each carries a miniature of
// its own layout so the operator recognises it without reading the label.
// ===========================================================================
const SCENES = [
  ['gameplay', 'Gameplay', 'ในเกม', `<rect x="3" y="3" width="58" height="6" rx="1.5" fill="INK"/><rect x="14" y="12" width="36" height="14" rx="1.5" fill="#4bc07a" opacity=".5"/><rect x="3" y="28" width="58" height="4" rx="1.5" fill="INK" opacity=".65"/>`],
  ['mappool', 'Map Pool', 'เลือก/แบนแมพ', `<rect x="3" y="3" width="58" height="5" rx="1.5" fill="INK" opacity=".65"/><rect x="4" y="11" width="27" height="8" rx="1.5" fill="INK"/><rect x="33" y="11" width="27" height="8" rx="1.5" fill="INK"/><rect x="4" y="21" width="27" height="8" rx="1.5" fill="#e05261" opacity=".55"/><rect x="33" y="21" width="27" height="8" rx="1.5" fill="#4a9de0" opacity=".55"/>`],
  ['teamintro', 'Team Intro', 'แนะนำทีม', `<circle cx="17" cy="13" r="6" fill="#e05261" opacity=".6"/><circle cx="47" cy="13" r="6" fill="#4a9de0" opacity=".6"/><rect x="8" y="23" width="18" height="4" rx="1.5" fill="INK"/><rect x="38" y="23" width="18" height="4" rx="1.5" fill="INK"/><path d="M30 11l4 6-4 6" stroke="#ffcc22" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`],
  ['seeding', 'Seeding', 'ผลซีด', `<rect x="6" y="5" width="52" height="4" rx="1.5" fill="INK"/><rect x="6" y="13" width="40" height="4" rx="1.5" fill="INK" opacity=".7"/><rect x="6" y="21" width="46" height="4" rx="1.5" fill="INK" opacity=".5"/><rect x="50" y="12" width="8" height="14" rx="1.5" fill="#ffcc22" opacity=".5"/>`],
  ['bracket', 'Bracket', 'สายแข่ง', `<rect x="5" y="5" width="16" height="7" rx="1.5" fill="INK"/><rect x="5" y="22" width="16" height="7" rx="1.5" fill="INK"/><rect x="43" y="13" width="16" height="8" rx="1.5" fill="#ffcc22" opacity=".55"/><path d="M21 8.5h8v8.5h6M21 25.5h8V17h6" stroke="#5c5c6e" stroke-width="1.4" fill="none"/>`],
  ['schedule', 'Schedule', 'ตารางแข่ง', `<rect x="5" y="4" width="54" height="7" rx="1.5" fill="INK"/><rect x="5" y="14" width="54" height="7" rx="1.5" fill="INK" opacity=".7"/><rect x="5" y="24" width="54" height="7" rx="1.5" fill="INK" opacity=".45"/><rect x="7" y="6" width="9" height="3" rx="1.5" fill="#ffcc22" opacity=".7"/>`],
  ['showcase', 'Showcase', 'โชว์แมพ', `<rect x="12" y="4" width="40" height="18" rx="2" fill="INK"/><rect x="12" y="25" width="26" height="4" rx="1.5" fill="INK" opacity=".6"/><circle cx="32" cy="13" r="4.5" fill="#ffcc22" opacity=".55"/>`],
  ['win', 'Winner', 'ผู้ชนะ', `<path d="M26 6h12v7a6 6 0 0 1-12 0z" fill="#ffcc22" opacity=".6"/><rect x="29" y="20" width="6" height="5" rx="1" fill="#ffcc22" opacity=".45"/><rect x="24" y="26" width="16" height="3.5" rx="1.5" fill="INK"/>`],
  ['drawings', 'Drawings', 'จับสลาก', `<rect x="5" y="6" width="12" height="22" rx="2" fill="INK"/><rect x="20" y="6" width="12" height="22" rx="2" fill="INK" opacity=".7"/><rect x="35" y="6" width="12" height="22" rx="2" fill="INK" opacity=".45"/><rect x="50" y="6" width="9" height="22" rx="2" fill="#ffcc22" opacity=".4"/>`],
  ['standby', 'Standby', 'รอ / พัก', `<circle cx="32" cy="17" r="9" stroke="INK" stroke-width="2" fill="none"/><path d="M32 12v5.5l3.5 2" stroke="#ffcc22" stroke-width="2" fill="none" stroke-linecap="round"/>`],
];
const sceneMeta = (key) => SCENES.find((s) => s[0] === key) || SCENES[0];
const sceneArt = (key, live) => sceneMeta(key)[3].replaceAll('INK', live ? '#4a4636' : '#32323f');

const NAV = [
  ['live', 'Live', '<circle cx="12" cy="12" r="3.2" fill="currentColor"/><path d="M5.5 5.5a9 9 0 0 0 0 13M18.5 5.5a9 9 0 0 1 0 13" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'],
  ['backgrounds', 'Backgrounds', '<rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" stroke-width="1.7"/><path d="M3 15.5l4.5-4 3.5 3 3.5-4 6.5 6" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="8.5" cy="9.5" r="1.4" fill="currentColor"/>'],
  ['teams', 'Teams', '<circle cx="9" cy="9" r="3.2" stroke="currentColor" stroke-width="1.7"/><path d="M3 19.5c0-3 2.7-4.8 6-4.8s6 1.8 6 4.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M16.5 7.5a3 3 0 0 1 0 6M18 19.5c0-2-.7-3.4-2-4.3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'],
  ['rounds', 'Rounds & Pool', '<rect x="3" y="4" width="18" height="16" rx="2.5" stroke="currentColor" stroke-width="1.7"/><path d="M3 9h18M9 9v11" stroke="currentColor" stroke-width="1.7"/>'],
  ['matches', 'Matches', '<path d="M4 6h6v5H4zM4 13h6v5H4zM14 9h6v6h-6z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M10 8.5h2v7h2" stroke="currentColor" stroke-width="1.7"/>'],
  ['osucfg', 'osu!tourney', '<rect x="2.5" y="5" width="9" height="7" rx="1.5" stroke="currentColor" stroke-width="1.7"/><rect x="12.5" y="5" width="9" height="7" rx="1.5" stroke="currentColor" stroke-width="1.7"/><path d="M4.5 16h15" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M7 19h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" opacity=".45"/>'],
  ['settings', 'Settings', '<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.7"/><path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'],
];

$('#nav').innerHTML = NAV.map(([key, label, icon]) => `
  <button data-page="${key}" class="${key === 'live' ? 'active' : ''}">
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none">${icon}</svg>
    <span>${esc(label)}</span>
  </button>`).join('');

$('#nav').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-page]');
  if (!btn) return;
  page = btn.dataset.page;
  for (const b of $('#nav').children) b.classList.toggle('active', b === btn);
  for (const p of document.querySelectorAll('.page')) p.classList.toggle('active', p.dataset.page === page);
  liveSig = '';
  renderPage();
});

addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) return;
  if (e.key === 'Enter') { takeScene(); return; }
  const n = e.key === '0' ? 10 : Number(e.key);
  if (n >= 1 && n <= 10) stageScene(SCENES[n - 1][0]);
});

function stageScene(scene) {
  previewScene = scene;
  liveSig = '';
  if (page === 'live') renderLive();
}

/** Fade or transition the staged scene to air, then swap the previous scene back. */
async function takeScene(withTransition = false) {
  if (!previewScene || previewScene === S?.scene) return;
  const previous = S.scene;
  await api.post('scene', { scene: previewScene, transition: withTransition });
  toast(`${withTransition ? 'Transition' : 'Fade'} → ${sceneMeta(previewScene)[1]}`);
  previewScene = previous;
  liveSig = '';
}

async function setScene(scene) {
  await api.post('scene', { scene });
  toast(`ฉาก → ${sceneMeta(scene)[1]}`);
}

/** Bracket writes carry the revision they were built from; the server rejects a
 *  stale one instead of letting two open tabs silently overwrite each other. */
async function saveBracketPart(route, payload) {
  const res = await api.post(route, { ...payload, rev: S.bracket.Rev || 0 });
  if (res.stale) {
    toast('มีคนแก้ไปแล้วจากอีกหน้าต่าง — กำลังโหลดใหม่');
    setTimeout(() => location.reload(), 1200);
    return false;
  }
  return true;
}

async function warmBeatmaps() {
  const ids = new Set();
  for (const r of S?.bracket?.Rounds || []) for (const b of r.Beatmaps || []) ids.add(b.ID);
  const missing = [...ids].filter((id) => id && !beatmaps[id]);
  if (!missing.length) return false;
  const res = await api.post('beatmaps', { ids: missing });
  for (const bm of res.beatmaps || []) beatmaps[bm.id] = bm;
  return true;
}

// ===========================================================================
// LIVE
// ===========================================================================
function liveSignature() {
  const m = S.match;
  return [
    S.scene, previewScene, m?.ID, m?.round?.Name, JSON.stringify(m?.PicksBans),
    (m?.round?.Beatmaps || []).length, Object.keys(beatmaps).length,
    S.live.warmup, S.live.chatEnabled, S.bracket.Matches.length,
    S.live.players.length, m?.Team1Score, m?.Team2Score,
  ].join('|');
}

function renderLive() {
  const el = pageEl('live');
  // The two overlay iframes are built once and never re-created, otherwise every
  // score tick would reload them.
  if (!$('#vmix', el)) {
    el.innerHTML = `${vmixHtml()}<div id="live-body"></div>`;
    el.onclick = liveClick;
    el.ondblclick = (e) => {
      const card = e.target.closest('[data-scene]');
      if (card) setScene(card.dataset.scene);   // double click skips the queue
    };
  }
  updateVmix(el);

  const body = $('#live-body', el);
  const sig = liveSignature();
  if (sig !== liveSig) {
    liveSig = sig;
    body.innerHTML = liveHtml();
    $('#match-select', body)?.addEventListener('change', (e) => {
      api.post('match/current', { id: e.target.value ? Number(e.target.value) : null });
    });
  }
  patchLive(body);
}

/** Point the preview iframe at the staged scene without reloading it. */
function pinPreview(frame) {
  const hash = `#scene=${previewScene}`;
  try {
    if (frame.contentWindow && frame.contentWindow.location.hash !== hash) {
      frame.contentWindow.location.hash = hash;
    }
  } catch { /* not loaded yet; onload will retry */ }
}

function vmixHtml() {
  return `<div class="vmix" id="vmix">
    <div class="pane preview">
      <div class="pane-head"><span>Preview</span><span class="who" data-prev-name></span></div>
      <div class="pane-body"><iframe data-prev-frame title="preview"></iframe></div>
    </div>
    <div class="take-col">
      <button class="take" id="btn-take">FADE</button>
      <button class="transition-take" id="btn-transition">TRANSITION</button>
      <div class="k">Enter</div>
      <div class="k">1–9 / 0 select</div>
      <div class="k">double-click = fade instantly</div>
    </div>
    <div class="pane program">
      <div class="pane-head"><i></i><span>Program</span><span class="who" data-prog-name></span></div>
      <div class="pane-body"><iframe src="/overlay" title="program"></iframe></div>
    </div>
  </div>`;
}

function updateVmix(el) {
  if (!previewScene) previewScene = S.scene;
  const frame = $('[data-prev-frame]', el);
  if (frame) {
    // Load the overlay once, then drive it by hash so switching never reloads it.
    if (!frame.getAttribute('src')) {
      frame.setAttribute('src', '/overlay');
      frame.onload = () => pinPreview(frame);
    }
    pinPreview(frame);
  }
  $('[data-prev-name]', el).textContent = sceneMeta(previewScene)[1];
  $('[data-prog-name]', el).textContent = sceneMeta(S.scene)[1];
  $('#btn-take', el).disabled = previewScene === S.scene;
  $('#btn-transition', el).disabled = previewScene === S.scene || !S.transition?.file;
}

function pips(score, need, colour) {
  let out = `<div class="pips ${colour}">`;
  for (let i = 0; i < Math.max(need, 1); i++) out += `<i class="${i < score ? 'on' : ''}"></i>`;
  return `${out}</div>`;
}

function mapCard(rb, choice) {
  const bm = beatmaps[rb.ID] || {};
  const colour = choice?.Team === 'Blue' ? 'blue' : 'red';
  const cls = choice
    ? (choice.Type === 'Ban' ? `banned ban-${colour}` : `picked-${colour}`)
    : '';
  const mod = modBracket(rb.Mods);
  const facts = [bm.stars ? `${bm.stars.toFixed(2)}★` : '', bm.bpm ? `${Math.round(bm.bpm)} BPM` : '', bm.keys ? `${bm.keys}K` : '']
    .filter(Boolean).join(' · ');
  return `<div class="map ${cls}" data-map="${rb.ID}">
    <div class="art">
      ${bm.cover ? `<img src="${esc(bm.cover)}" alt="">` : ''}
      <div class="scrim"></div>
      <span class="slot" style="color: ${MOD_FG[mod] || '#c8c8d4'}; background: ${MOD_BG[mod] || '#32323f'}">${esc(rb.Mods || mod)}</span>
      ${facts ? `<span class="facts">${esc(facts)}</span>` : ''}
      <div class="txt">
        <b>${esc(bm.title || `Beatmap ${rb.ID}`)}</b>
        <span>${esc(bm.version ? `[${bm.version}]` : '')} ${esc(bm.artist || '')}</span>
      </div>
      <div class="mark"></div>
    </div>
    <div class="acts">
      <div class="team-acts red">
        <button class="pick-red" data-act="Pick" data-team="Red">Pick</button>
        <button class="ban-red" data-act="Ban" data-team="Red">Ban</button>
      </div>
      <button class="clear" data-act="clear">ล้าง</button>
      <div class="team-acts blue">
        <button class="ban-blue" data-act="Ban" data-team="Blue">Ban</button>
        <button class="pick-blue" data-act="Pick" data-team="Blue">Pick</button>
      </div>
    </div>
  </div>`;
}

const MOD_BG = { NM: '#2f3d5c', HD: '#54492a', HR: '#5c3030', DT: '#3d2f5c', FM: '#2a5240', TB: '#4f2f52', EZ: '#2a5250', FL: '#33364d' };
const MOD_FG = { NM: '#a9bde8', HD: '#e8d5a0', HR: '#e8adad', DT: '#c9b3e8', FM: '#a0dcc0', TB: '#e0b3e8', EZ: '#a0dcd8', FL: '#b4b8dc' };

/** Problems that would quietly break the broadcast if nobody noticed them. */
function liveWarnings(m) {
  const w = [];
  if (m) {
    const missingTeam = [
      m.Team1Acronym && !m.team1 ? m.Team1Acronym : null,
      m.Team2Acronym && !m.team2 ? m.Team2Acronym : null,
    ].filter(Boolean);
    if (missingTeam.length) {
      w.push(`แมตช์นี้อ้างทีม <b>${esc(missingTeam.join(', '))}</b> ที่ไม่มีอยู่แล้ว — overlay จะโชว์ชื่อว่าง ไปแก้ที่แท็บ Matches`);
    }
    if (!m.round) w.push('แมตช์นี้ยังไม่ได้ผูกกับรอบไหน — map pool กับ Best of จะว่าง');
    else if (!m.round.BestOf) w.push(`รอบ <b>${esc(m.round.Name)}</b> ยังไม่ได้ตั้ง Best of — ระบบจะไม่รู้ว่าเมื่อไหร่จบแมตช์ จอ Winner จะไม่ขึ้นเอง`);
  }
  if (!w.length) return '';
  return `<div class="warn">${w.map((t) => `<div>⚠ ${t}</div>`).join('')}</div>`;
}

function liveHtml() {
  const m = S.match;
  const need = m?.pointsToWin || 0;
  const pool = m?.round?.Beatmaps || [];
  const picks = Object.fromEntries((m?.PicksBans || []).map((p) => [p.BeatmapID, p]));
  const meta = sceneMeta(S.scene);

  return `
  ${liveWarnings(m)}
  <div class="row" style="margin-bottom: 10px">
    <h2 class="sec-title" style="margin: 0">Scene</h2>
    <span class="small" style="color: var(--faint)">คลิกเพื่อจ่อไว้ที่ Preview แล้วกด TAKE</span>
    <span class="spacer"></span>
    <span class="small" style="color: var(--faint)">${m ? `${esc(m.Team1Acronym || 'TBD')} vs ${esc(m.Team2Acronym || 'TBD')}${m.round ? ` · ${esc(m.round.Name)}` : ''} · Best of ${m?.round?.BestOf ?? '—'}` : 'ยังไม่ได้เลือกแมตช์'}</span>
  </div>
  <div class="scene-grid" style="margin-bottom: 20px">
    ${SCENES.map(([key, name, th], i) => `
      <button class="scene-card ${S.scene === key ? 'active' : ''} ${previewScene === key ? 'staged' : ''}" data-scene="${key}">
        <svg viewBox="0 0 64 34">${sceneArt(key, S.scene === key)}</svg>
        <div><div class="t">${esc(name)}</div><div class="s">${esc(th)} · ${i === 9 ? 0 : i + 1}</div></div>
      </button>`).join('')}
  </div>

  <div class="grid2">
    <section class="card">
      <div class="row" style="margin-bottom: 14px">
        <h2 class="sec-title" style="margin: 0">คะแนนแมตช์</h2>
        <span class="spacer"></span>
        <span class="small muted">ต้องได้ ${need || '—'} แต้ม</span>
      </div>

      <div class="row" style="margin-bottom: 16px; flex-wrap: nowrap">
        <select id="match-select" style="flex: 1">
          <option value="">— เลือกแมตช์ —</option>
          ${S.bracket.Matches.map((x) => {
            const r = S.bracket.Rounds.find((rr) => (rr.Matches || []).includes(x.ID));
            return `<option value="${x.ID}" ${x.ID === m?.ID ? 'selected' : ''}>#${x.ID} ${esc(x.Team1Acronym || 'TBD')} vs ${esc(x.Team2Acronym || 'TBD')}${r ? ` — ${esc(r.Name)}` : ''}</option>`;
          }).join('')}
        </select>
        <button id="btn-swap" title="สลับทีมซ้าย-ขวา พร้อมคะแนนและ pick/ban">⇄ สลับข้าง</button>
        <button class="danger" id="btn-reset">รีเซ็ต</button>
      </div>

      <div class="score">
        <div class="side red">
          <div class="name">${esc(m?.team1?.FullName || m?.Team1Acronym || 'TBD')}</div>
          <div class="pts num" data-pts1>${m?.Team1Score ?? 0}</div>
          ${pips(m?.Team1Score ?? 0, need, 'red')}
          <div class="row" style="gap: 6px"><button class="step" data-score="-1,0">−</button><button class="step" data-score="1,0">+</button></div>
        </div>
        <div class="vs">VS</div>
        <div class="side blue">
          <div class="name">${esc(m?.team2?.FullName || m?.Team2Acronym || 'TBD')}</div>
          <div class="pts num" data-pts2>${m?.Team2Score ?? 0}</div>
          ${pips(m?.Team2Score ?? 0, need, 'blue')}
          <div class="row" style="gap: 6px"><button class="step" data-score="0,-1">−</button><button class="step" data-score="0,1">+</button></div>
        </div>
      </div>

      <div class="delta">
        <div class="nums">
          <span class="num" style="color: var(--red); font-weight: 600" data-live1>0</span>
          <span>คะแนนสด · ห่าง <b class="num" data-diff>0</b></span>
          <span class="num" style="color: var(--blue); font-weight: 600" data-live2>0</span>
        </div>
        <div class="track"><div class="fill red" data-fill-red></div><div class="fill blue" data-fill-blue></div></div>
      </div>

      <div class="row" style="margin-top: 16px; flex-wrap: nowrap">
        <button id="btn-warmup" class="${S.live.warmup ? 'on' : ''}" style="flex: 1">Warmup · ${S.live.warmup ? 'ON' : 'OFF'}</button>
        <button id="btn-chat" class="${S.live.chatEnabled ? 'on' : ''}" style="flex: 1">Chat · ${S.live.chatEnabled ? 'ON' : 'OFF'}</button>
      </div>
      <p class="hint">warmup เปิดไว้ = จบแมพแล้วไม่บวกแต้มอัตโนมัติ</p>
    </section>

    <section class="card">
      <div class="row" style="margin-bottom: 14px">
        <h2 class="sec-title" style="margin: 0">ผู้เล่นสด</h2>
        <span class="spacer"></span>
        <span class="small" style="color: var(--faint)">จาก tosu</span>
      </div>
      <div style="display: flex; flex-direction: column; gap: 8px" data-players></div>

      <h2 class="sec-title" style="margin: 18px 0 11px; padding-top: 16px; border-top: 1px solid var(--line)">ห้องแข่ง (IRC)</h2>
      <div class="row" style="gap: 6px">
        <button class="sm" data-mp="!mp start 10">เริ่มใน 10 วิ</button>
        <button class="sm" data-mp="!mp timer 90">จับเวลา 90</button>
        <button class="sm" data-mp="!mp aborttimer">หยุดเวลา</button>
        <button class="sm danger" data-mp="!mp abort">ยกเลิกแมพ</button>
        <button class="sm" id="btn-invite">เชิญผู้เล่นทั้งหมด</button>
      </div>
      <div class="row" style="margin-top: 8px; flex-wrap: nowrap">
        <input id="mp-cmd" placeholder="พิมพ์คำสั่งเอง เช่น !mp settings" style="flex: 1">
        <button id="btn-mp-send">ส่ง</button>
      </div>
      <p class="hint" id="irc-hint"></p>

      <h2 class="sec-title" style="margin: 18px 0 11px; padding-top: 16px; border-top: 1px solid var(--line)">จอรอ / นับถอยหลัง</h2>
      <div class="row" style="flex-wrap: nowrap">
        <input id="standby-text" placeholder="ข้อความหน้ารอ" value="${esc(S.live.standbyText || '')}" style="flex: 2">
        <input id="countdown-min" type="number" min="0" placeholder="นาที" style="flex: 1">
        <button id="btn-standby">ตั้ง</button>
      </div>
      <div class="row" style="margin-top: 8px; flex-wrap: nowrap">
        <input id="showcase-id" type="number" placeholder="Beatmap ID สำหรับ showcase" value="${S.live.showcaseBeatmapId || ''}" style="flex: 2">
        <button id="btn-showcase">โชว์แมพ</button>
      </div>
    </section>
  </div>

  <section class="card">
    <div class="row" style="margin-bottom: 14px">
      <h2 class="sec-title" style="margin: 0">Map pool</h2>
      <span class="small" style="color: var(--faint)">${esc(m?.round?.Name || 'ยังไม่ได้เลือกรอบ')}${pool.length ? ` · ${pool.length} แมพ · แบนได้ ${m?.round?.BanCount ?? 0}` : ''}</span>
      <span class="spacer"></span>
      <div class="legend">
        <span><i style="background: var(--red)"></i>${esc(m?.team1?.FullName || m?.Team1Acronym || 'ทีม 1')}</span>
        <span><i style="background: var(--blue)"></i>${esc(m?.team2?.FullName || m?.Team2Acronym || 'ทีม 2')}</span>
      </div>
    </div>
    ${pool.length
      ? `<div class="pool">${pool.map((rb) => mapCard(rb, picks[rb.ID])).join('')}</div>`
      : `<p class="muted">รอบนี้ยังไม่มี map pool — ไปเพิ่มที่แท็บ <b>Rounds &amp; Pool</b></p>`}
  </section>`;
}

async function liveClick(e) {
  if (e.target.closest('#btn-take')) return takeScene();
  if (e.target.closest('#btn-transition')) return takeScene(true);

  const sceneBtn = e.target.closest('[data-scene]');
  if (sceneBtn) return stageScene(sceneBtn.dataset.scene);

  const scoreBtn = e.target.closest('[data-score]');
  if (scoreBtn) {
    const [d1, d2] = scoreBtn.dataset.score.split(',').map(Number);
    return api.post('match/score', { delta1: d1, delta2: d2 });
  }

  const act = e.target.closest('.acts button');
  if (act) {
    const beatmapId = Number(act.closest('.map').dataset.map);
    if (act.dataset.act === 'clear') return api.post('pickban', { beatmapId, clear: true });
    return api.post('pickban', { beatmapId, type: act.dataset.act, team: act.dataset.team });
  }

  if (e.target.id === 'btn-warmup') return api.post('warmup', { value: !S.live.warmup });
  if (e.target.id === 'btn-chat') return api.post('chat', { value: !S.live.chatEnabled });
  if (e.target.id === 'btn-swap') {
    await api.post('match/swap');
    return toast('สลับข้างแล้ว');
  }
  if (e.target.id === 'btn-reset') {
    if (confirm('รีเซ็ตคะแนนและ pick/ban ของแมตช์นี้?')) await api.post('match/reset');
    return;
  }
  const mp = e.target.closest('[data-mp]');
  if (mp) {
    const res = await api.post('irc/say', { text: mp.dataset.mp });
    return toast(res.ok ? `ส่งแล้ว: ${mp.dataset.mp}` : 'ยังไม่ได้ต่อ IRC หรือยังไม่รู้ห้อง');
  }
  if (e.target.id === 'btn-mp-send') {
    const box = $('#mp-cmd');
    if (!box.value.trim()) return;
    const res = await api.post('irc/say', { text: box.value.trim() });
    if (res.ok) box.value = '';
    return toast(res.ok ? 'ส่งแล้ว' : 'ยังไม่ได้ต่อ IRC หรือยังไม่รู้ห้อง');
  }
  if (e.target.id === 'btn-invite') {
    const names = [...(S.match?.team1?.Players || []), ...(S.match?.team2?.Players || [])]
      .map((p) => (p.username || '').trim()).filter(Boolean);
    if (!names.length) return toast('แมตช์นี้ยังไม่มีรายชื่อผู้เล่น');
    for (const n of names) await api.post('irc/say', { text: `!mp invite ${n.replace(/\s+/g, '_')}` });
    return toast(`เชิญ ${names.length} คนแล้ว`);
  }
  if (e.target.id === 'btn-standby') {
    const min = Number($('#countdown-min').value);
    return api.post('standby', {
      text: $('#standby-text').value,
      countdownTarget: min > 0 ? new Date(Date.now() + min * 60000).toISOString() : null,
    });
  }
  if (e.target.id === 'btn-showcase') {
    return api.post('showcase', { beatmapId: Number($('#showcase-id').value) });
  }
}

function patchLive(el) {
  const s1 = S.live.ipc.score1 || 0;
  const s2 = S.live.ipc.score2 || 0;
  const set = (sel, v) => { const n = $(sel, el); if (n) n.textContent = v; };
  set('[data-live1]', fmtScore(s1));
  set('[data-live2]', fmtScore(s2));
  set('[data-diff]', fmtScore(Math.abs(s1 - s2)));

  // Scale the gap against the leader so the bar stays readable at any score.
  const pct = Math.min(50, (Math.abs(s1 - s2) / Math.max(s1, s2, 1)) * 200);
  const red = $('[data-fill-red]', el);
  const blue = $('[data-fill-blue]', el);
  if (red) red.style.width = `${s1 > s2 ? pct : 0}%`;
  if (blue) blue.style.width = `${s2 > s1 ? pct : 0}%`;

  const hint = $('#irc-hint', el);
  if (hint) {
    hint.textContent = status.irc?.enabled
      ? (status.irc.connected
          ? `ห้อง ${status.irc.channel || '— ยังไม่รู้ (เปิด osu!tourney หรือใส่ชื่อห้องใน Settings)'}`
          : 'กำลังต่อ IRC…')
      : 'ยังไม่ได้เปิด IRC — ไปเปิดที่ Settings';
  }

  const holder = $('[data-players]', el);
  if (!holder) return;
  holder.innerHTML = S.live.players.length
    ? S.live.players.map((p) => `<div class="pl ${p.team}">
        <img src="${esc(avatarUrl(p.userId))}" alt="" onerror="this.style.visibility='hidden'">
        <span class="n">${esc(p.name || '—')}</span>
        <span class="v num" style="width: 54px">${p.accuracy.toFixed(2)}%</span>
        <span class="v num" style="width: 44px">${p.combo}x</span>
        <span class="sc num">${fmtScore(p.score)}</span>
      </div>`).join('')
    : `<span class="small" style="color: var(--faint)">${S.live.tosuConnected ? 'รอข้อมูลจาก tosu…' : 'ยังไม่ได้ต่อ tosu — คะแนนรวมทีมยังมาจาก IPC ตามปกติ'}</span>`;
}

// ===========================================================================
// BACKGROUNDS
// ===========================================================================
let bgSelected = 'gameplay';
let bgSig = '';
let dimTimer = null;
const uploading = {};   // scene -> percent

function renderBackgrounds() {
  const el = pageEl('backgrounds');
  const sig = JSON.stringify(S.backgrounds || {}) + '|' + JSON.stringify(S.transition || null) + '|' + bgSelected + '|' + JSON.stringify(uploading);
  if (sig === bgSig) return;
  bgSig = sig;

  const bgs = S.backgrounds || {};
  const filled = Object.keys(bgs).length;
  const total = Object.values(bgs).reduce((sum, b) => sum + (b.size || 0), 0);
  const sel = bgs[bgSelected] || { dim: 0, fit: 'cover', html: '', css: '', overlay: false };
  const selMeta = sceneMeta(bgSelected);
  const transition = S.transition;

  el.innerHTML = `
  <header style="margin-bottom: 16px">
    <h1 style="font-size: 21px; font-weight: 700; margin: 0 0 3px">พื้นหลังของแต่ละ scene</h1>
    <p class="small muted" style="margin: 0">
      ใส่ภาพหรือวิดีโอให้แต่ละ scene แยกกันได้ — ไฟล์เก็บที่ <code>data/backgrounds/</code> แล้ว overlay ดึงไปใช้ทันที ไม่ต้องรีสตาร์ท
    </p>
  </header>

  <section class="card transition-card">
    <div class="transition-copy">
      <div class="field-label">Scene transition</div>
      <strong>${transition ? esc(transition.file) : 'No transition video'}</strong>
      <span>${transition ? `${fmtBytes(transition.size)} · plays whenever FADE changes scene` : 'Upload an MP4 or WEBM to play over every FADE.'}</span>
    </div>
    ${transition ? `<video class="transition-thumb" src="/data/transitions/${encodeURIComponent(transition.file)}?v=${transition.size}" muted preload="metadata"></video>` : ''}
    <button class="sm" id="transition-add">${transition ? 'Replace video' : 'Choose video'}</button>
    <button class="sm danger" id="transition-remove" ${transition ? '' : 'disabled'}>×</button>
  </section>

  <div class="bg-layout">
    <section class="card">
      <div class="drop" id="drop">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" style="flex: none">
          <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M3.5 15v3.5A1.5 1.5 0 0 0 5 20h14a1.5 1.5 0 0 0 1.5-1.5V15" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
        <div style="flex: 1">
          <div class="t">ลากไฟล์มาวางที่นี่ หรือคลิกเพื่อเลือก — จะใส่ให้ <b style="color: var(--accent)">${esc(selMeta[1])}</b></div>
          <div class="s">MP4 · WEBM · PNG · JPG · WEBP — แนะนำ 1920×1080, วิดีโอควรตัดให้ลูปเนียนและไม่มีเสียง</div>
        </div>
        <span class="cta">เลือกไฟล์…</span>
      </div>

      <div class="row" style="margin-bottom: 10px">
        <h2 class="sec-title" style="margin: 0">10 scene</h2>
        <span class="small" style="color: var(--faint)">${filled} / 10 มีพื้นหลังแล้ว</span>
        <span class="spacer"></span>
        <span class="small num" style="color: var(--faint)">${fmtBytes(total)}</span>
        <button class="sm" id="bg-clear-all" ${filled ? '' : 'disabled'}>ล้างทั้งหมด</button>
      </div>

      <div class="bg-rows">
        ${SCENES.map(([key, name, th]) => {
          const bg = bgs[key];
          const pct = uploading[key];
          const src = bg?.file ? `/data/backgrounds/${encodeURIComponent(bg.file)}?v=${bg.size}` : '';
          const label = bg?.overlay ? 'Custom overlay' : bg ? `${bg.file} · ${fmtBytes(bg.size)} · dim ${bg.dim}%` : 'No background';
          return `<div class="bg-row ${key === bgSelected ? 'sel' : ''}" data-scene="${key}" style="position: relative">
            <div class="thumb">
              ${!bg ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 5.5v13M5.5 12h13" stroke="#4a4a5c" stroke-width="2" stroke-linecap="round"/></svg>` : ''}
              ${bg?.overlay ? `<span style="font: 700 10px ui-monospace, monospace; color: var(--accent)">&lt;/&gt;</span>` : ''}
              ${bg && bg.type === 'image' ? `<img src="${esc(src)}" alt="">` : ''}
              ${bg && bg.type === 'video' ? `<video src="${esc(src)}" muted preload="metadata"></video><span class="play"><svg width="16" height="16" viewBox="0 0 24 24"><path d="M9 7.5l8 4.5-8 4.5z" fill="#fff" opacity=".85"/></svg></span>` : ''}
            </div>
            <div class="meta">
              <div class="t">${esc(name)} <em>· ${esc(th)}</em></div>
              <div class="f ${bg ? '' : 'empty'}">${pct !== undefined ? `กำลังอัปโหลด ${pct}%` : esc(label)}</div>
            </div>
            <button class="sm" data-add="${key}">${bg ? 'เปลี่ยน' : 'เลือกไฟล์'}</button>
            <button class="sm ${bg ? 'danger' : ''}" data-remove="${key}" ${bg ? '' : 'disabled'} style="padding: 5px 9px">✕</button>
            ${pct !== undefined ? `<span class="bar" style="width: ${pct}%"></span>` : ''}
          </div>`;
        }).join('')}
      </div>
    </section>

    <aside class="card">
      <div class="row" style="margin-bottom: 12px">
        <h2 class="sec-title" style="margin: 0">พรีวิว</h2>
        <span class="small" style="color: var(--accent)">${esc(selMeta[1])}</span>
      </div>

      <div class="bg-preview" id="bg-preview">
        <iframe src="/overlay#scene=${encodeURIComponent(bgSelected)}&custom=1" title="${esc(selMeta[1])} custom overlay preview"></iframe>
      </div>

      <div class="row small muted" style="justify-content: space-between; margin: 10px 0 14px">
        <span>${sel ? esc(sel.file) : '—'}</span>
        <span class="num">${sel ? fmtBytes(sel.size) : ''}</span>
      </div>

      <div style="margin-bottom: 14px">
        <div class="row" style="margin-bottom: 9px">
          <span class="field-label">หรี่แสงพื้นหลัง</span>
          <span class="spacer"></span>
          <span class="num" id="dim-out" style="font-size: 13px; font-weight: 600; color: var(--accent)">${sel?.dim ?? 0}%</span>
        </div>
        <input class="slider" id="dim-slider" type="range" min="0" max="100" step="1" value="${sel?.dim ?? 0}" ${sel ? '' : 'disabled'}>
        <div class="row small" style="justify-content: space-between; color: var(--faint); margin-top: 5px">
          <span>สว่างเต็มที่</span><span>มืดสนิท</span>
        </div>
      </div>

      <div style="margin-bottom: 14px">
        <div class="field-label" style="margin-bottom: 7px">การจัดวาง</div>
        <div class="seg">
          <button data-fit="cover" class="${sel?.fit !== 'contain' ? 'on' : ''}" ${sel ? '' : 'disabled'}>เต็มจอ (crop)</button>
          <button data-fit="contain" class="${sel?.fit === 'contain' ? 'on' : ''}" ${sel ? '' : 'disabled'}>พอดีจอ (fit)</button>
        </div>
      </div>

      <button id="bg-pick-file" style="width: 100%">เลือกรูป / วิดีโอ / GIF</button>
      <button id="bg-apply-all" style="width: 100%; margin-top: 10px" ${bgs[bgSelected]?.file ? '' : 'disabled'}>ใช้ไฟล์นี้กับทุก scene</button>
      <button id="bg-edit-code" style="width: 100%; margin-top: 10px">แก้ไข Overlay HTML / CSS</button>
      <p class="hint">รูป/วิดีโอ/GIF เป็นชั้นล่าง และ Custom overlay HTML/CSS อยู่ชั้นหน้า — วิดีโอเล่นวนและปิดเสียงเสมอ</p>
    </aside>
  </div>`;

  el.insertAdjacentHTML('beforeend', `
    <div id="bg-code-modal" class="code-modal hidden" role="dialog" aria-modal="true" aria-labelledby="bg-code-title">
      <section class="code-modal-card">
        <header class="code-modal-head">
          <div>
            <h2 id="bg-code-title">Custom overlay · ${esc(selMeta[1])}</h2>
            <p>พรีวิวเริ่มว่าง และจะแสดงเฉพาะ HTML/CSS ที่คุณเขียนเอง</p>
          </div>
          <button id="bg-close-code" class="code-modal-close" type="button" aria-label="ปิด">×</button>
        </header>
        <div class="code-modal-workspace">
          <div class="code-editor-grid">
            <div class="code-tabs" role="tablist" aria-label="Overlay code">
              <button class="code-tab active" type="button" data-code-tab="html" role="tab" aria-selected="true">HTML</button>
              <button class="code-tab" type="button" data-code-tab="css" role="tab" aria-selected="false">CSS</button>
            </div>
            <section class="code-tab-panel active" data-code-panel="html" role="tabpanel">
              <textarea id="bg-html-edit" spellcheck="false" aria-label="HTML">${esc(sel.html || '')}</textarea>
            </section>
            <section class="code-tab-panel" data-code-panel="css" role="tabpanel" hidden>
              <textarea id="bg-css-edit" spellcheck="false" aria-label="CSS">${esc(sel.css || '')}</textarea>
            </section>
          </div>
          <section class="code-live-preview">
            <div class="code-live-preview-head"><span>LIVE PREVIEW</span><span>UNSAVED CHANGES SHOWN</span></div>
            <div class="code-live-preview-frame">
              <iframe id="bg-code-preview" src="/overlay#scene=${encodeURIComponent(bgSelected)}&custom=1" title="Custom overlay live preview"></iframe>
            </div>
          </div>
        </div>
        <footer class="code-modal-actions">
          <button id="bg-clear-code" class="danger" type="button">ล้างและกลับค่าเริ่มต้น</button>
          <span></span>
          <button id="bg-close-code-secondary" type="button">ยกเลิก</button>
          <button id="bg-save-code" class="primary" type="button">บันทึก overlay</button>
        </footer>
      </section>
    </div>`);

  bindBackgrounds(el);
}

function bindBackgrounds(el) {
  const drop = $('#drop', el);

  // The popup preview is an isolated copy of the overlay.  Updating its active
  // scene directly keeps drafts live without sending an API request per keypress.
  const syncCodePreview = () => {
    const frame = $('#bg-code-preview', el);
    const pane = frame?.contentDocument?.querySelector('.scene.active');
    if (!pane) return false;
    const html = $('#bg-html-edit', el)?.value || '';
    const css = $('#bg-css-edit', el)?.value || '';
    pane.innerHTML = `${css ? `<style data-draft-css>${css}</style>` : ''}<div class="custom-overlay">${html}</div>`;
    return true;
  };

  $('#bg-code-preview', el)?.addEventListener('load', () => syncCodePreview());
  for (const id of ['#bg-html-edit', '#bg-css-edit']) {
    $(id, el)?.addEventListener('input', syncCodePreview);
  }

  el.onclick = async (e) => {
    const add = e.target.closest('[data-add]');
    if (add) { bgSelected = add.dataset.add; return pickFile(bgSelected); }

    const rm = e.target.closest('[data-remove]');
    if (rm) {
      await api.post('background/remove', { scene: rm.dataset.remove });
      return toast('ลบพื้นหลังแล้ว');
    }

    const row = e.target.closest('.bg-row');
    if (row) { bgSelected = row.dataset.scene; bgSig = ''; return renderBackgrounds(); }

    if (e.target.closest('#drop')) return pickFile(bgSelected);

    const fit = e.target.closest('[data-fit]');
    if (fit) {
      await api.post('background/settings', { scene: bgSelected, fit: fit.dataset.fit });
      return;
    }

    if (e.target.id === 'bg-clear-all') {
      if (confirm('ลบพื้นหลังของทุก scene?\n\nไฟล์จะถูกย้ายไป data/backgrounds/_trash/ กู้คืนได้')) {
        await api.post('background/remove', { all: true });
        toast('ย้ายไป _trash แล้ว กู้คืนได้');
      }
      return;
    }
    if (e.target.id === 'transition-add') return pickTransition();
    if (e.target.id === 'transition-remove') {
      await api.post('transition/remove');
      return toast('Removed transition video');
    }
    if (e.target.id === 'bg-apply-all') {
      await api.post('background/apply-all', { scene: bgSelected });
      return toast('ใช้กับทุก scene แล้ว');
    }
    if (e.target.id === 'bg-pick-file') return pickFile(bgSelected);
    if (e.target.id === 'bg-edit-code') {
      $('#bg-code-modal', el)?.classList.remove('hidden');
      $('#bg-html-edit', el)?.focus();
      syncCodePreview();
      return;
    }
    const tab = e.target.closest('[data-code-tab]');
    if (tab) {
      const selected = tab.dataset.codeTab;
      for (const button of el.querySelectorAll('[data-code-tab]')) {
        const active = button.dataset.codeTab === selected;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
      }
      for (const panel of el.querySelectorAll('[data-code-panel]')) {
        const active = panel.dataset.codePanel === selected;
        panel.classList.toggle('active', active);
        panel.hidden = !active;
      }
      $(`#bg-${selected}-edit`, el)?.focus();
      return;
    }
    if (e.target.id === 'bg-close-code' || e.target.id === 'bg-close-code-secondary' || e.target.id === 'bg-code-modal') {
      $('#bg-code-modal', el)?.classList.add('hidden');
      return;
    }
    if (e.target.id === 'bg-clear-code') {
      $('#bg-html-edit', el).value = '';
      $('#bg-css-edit', el).value = '';
      await api.post('background/settings', { scene: bgSelected, html: '', css: '', overlay: false });
      $('#bg-code-modal', el)?.classList.add('hidden');
      return toast('ล้าง HTML / CSS แล้ว');
    }
    if (e.target.id === 'bg-save-code') {
      const html = $('#bg-html-edit', el).value;
      const css = $('#bg-css-edit', el).value;
      await api.post('background/settings', { scene: bgSelected, html, css, overlay: true });
      $('#bg-code-modal', el)?.classList.add('hidden');
      return toast('บันทึก custom overlay แล้ว');
    }
  };

  el.onkeydown = (e) => {
    if (e.key === 'Escape') $('#bg-code-modal', el)?.classList.add('hidden');
  };

  // The preview is the real overlay in an iframe. It receives saved updates over
  // SSE, so custom HTML/CSS runs in the same document and 1920x1080 stage as OBS.
  const slider = $('#dim-slider', el);
  slider?.addEventListener('input', () => {
    const v = Number(slider.value);
    $('#dim-out', el).textContent = `${v}%`;
    clearTimeout(dimTimer);
    dimTimer = setTimeout(() => api.post('background/settings', { scene: bgSelected, dim: v }), 180);
  });

  for (const type of ['dragenter', 'dragover']) {
    drop?.addEventListener(type, (e) => { e.preventDefault(); drop.classList.add('over'); });
  }
  for (const type of ['dragleave', 'drop']) {
    drop?.addEventListener(type, (e) => { e.preventDefault(); drop.classList.remove('over'); });
  }
  drop?.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) upload(bgSelected, file);
  });
}

function pickFile(scene) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'video/mp4,video/webm,image/png,image/jpeg,image/webp,image/gif';
  input.onchange = () => { if (input.files[0]) upload(scene, input.files[0]); };
  input.click();
}

function pickTransition() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'video/mp4,video/webm';
  input.onchange = () => { if (input.files[0]) uploadTransition(input.files[0]); };
  input.click();
}

function uploadTransition(file) {
  const ext = (file.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
  if (!['.mp4', '.webm'].includes(ext)) return toast('Transition must be MP4 or WEBM');
  const xhr = new XMLHttpRequest();
  xhr.open('POST', `/api/transition/upload?name=${encodeURIComponent(file.name)}`);
  xhr.onload = () => toast(xhr.status >= 200 && xhr.status < 300 ? 'Transition video ready' : 'Could not upload transition video');
  xhr.onerror = () => toast('Could not upload transition video');
  xhr.send(file);
}

/** XHR rather than fetch: only XHR reports upload progress, and these are big files. */
function upload(scene, file) {
  const ext = (file.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
  if (!['.mp4', '.webm', '.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) {
    return toast('ไฟล์ชนิดนี้ใช้ไม่ได้');
  }
  uploading[scene] = 0;
  bgSig = '';
  renderBackgrounds();

  const xhr = new XMLHttpRequest();
  xhr.open('POST', `/api/background/upload?scene=${encodeURIComponent(scene)}&name=${encodeURIComponent(file.name)}`);
  xhr.upload.onprogress = (e) => {
    if (!e.lengthComputable) return;
    uploading[scene] = Math.round((e.loaded / e.total) * 100);
    bgSig = '';
    renderBackgrounds();
  };
  xhr.onload = () => {
    delete uploading[scene];
    bgSig = '';
    if (xhr.status >= 200 && xhr.status < 300) toast(`ใส่พื้นหลังให้ ${sceneMeta(scene)[1]} แล้ว`);
    else toast('อัปโหลดไม่สำเร็จ');
    renderBackgrounds();
  };
  xhr.onerror = () => { delete uploading[scene]; bgSig = ''; toast('อัปโหลดไม่สำเร็จ'); renderBackgrounds(); };
  xhr.send(file);
}

// ===========================================================================
// EDITORS — each keeps a local draft so typing is never clobbered by a push
// ===========================================================================
function editorCard(title, inner, actions = '') {
  return `<div class="card"><h2 class="sec-title">${title}</h2>${inner}<div class="row" style="margin-top: 12px">${actions}</div></div>`;
}

const PLAYER_RE = /^\s*\d+\s*:\s*\S/;

/** Rows in the Teams editor whose player list is not "id:name, id:name". */
function badPlayerRows(teams) {
  const bad = [];
  teams.forEach((t, i) => {
    for (const p of t.Players || []) {
      if (!p.id) { bad.push(i); break; }
    }
  });
  return bad;
}

function renderTeams() {
  const el = pageEl('teams');
  const teams = structuredClone(S.bracket.Teams || []);

  const draw = () => {
    el.innerHTML = editorCard('ทีม', `
      <table>
        <thead><tr><th style="width:22%">ชื่อเต็ม</th><th style="width:10%">ตัวย่อ</th><th style="width:12%">ธง</th>
          <th style="width:8%">Seed</th><th>ผู้เล่น (id:ชื่อ คั่นด้วย ,)</th><th style="width:60px"></th></tr></thead>
        <tbody>${teams.map((t, i) => `<tr>
          <td><input data-f="FullName" data-i="${i}" value="${esc(t.FullName || '')}"></td>
          <td><input data-f="Acronym" data-i="${i}" value="${esc(t.Acronym || '')}"></td>
          <td><input data-f="FlagName" data-i="${i}" value="${esc(t.FlagName || '')}" placeholder="TH หรือ ไฟล์.png"></td>
          <td><input data-f="Seed" data-i="${i}" value="${esc(t.Seed || '')}"></td>
          <td><input data-f="Players" data-i="${i}" class="${(t.Players || []).some((p) => !p.id) ? 'bad' : ''}"
            placeholder="เช่น 2:peppy, 124493:Cookiezi"
            value="${esc((t.Players || []).map((p) => `${p.id}:${p.username}`).join(', '))}"></td>
          <td><button class="sm danger" data-del="${i}">ลบ</button></td>
        </tr>`).join('')}</tbody>
      </table>`,
      `<button id="add-team">+ เพิ่มทีม</button><span class="spacer"></span><button class="primary" id="save-teams">บันทึก</button>`)
      + '<p class="hint" style="margin: -8px 0 16px">ช่องผู้เล่นต้องเป็น <code>id:ชื่อ</code> คั่นด้วย , — ใส่ผิดช่องจะขึ้นขอบแดงและรูปโปรไฟล์จะไม่มา</p>';

    el.querySelector('table').addEventListener('input', (e) => {
      const i = Number(e.target.dataset.i);
      const f = e.target.dataset.f;
      if (Number.isNaN(i) || !f) return;
      if (f === 'Players') {
        const parts = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
        teams[i].Players = parts.map((s) => {
          const [id, ...rest] = s.split(':');
          return { id: Number(id) || 0, username: rest.join(':').trim() || id, country_code: '', rank: null };
        });
        e.target.classList.toggle('bad', parts.some((s) => !PLAYER_RE.test(s)));
      } else {
        teams[i][f] = e.target.value;
      }
    });
    el.onclick = async (e) => {
      if (e.target.id === 'add-team') { teams.push({ FullName: '', Acronym: '', FlagName: 'TH', Seed: '', Players: [], SeedingResults: [] }); draw(); }
      if (e.target.dataset.del !== undefined) { teams.splice(Number(e.target.dataset.del), 1); draw(); }
      if (e.target.id === 'save-teams') {
        const bad = badPlayerRows(teams);
        if (bad.length && !confirm(`ผู้เล่น ${bad.length} ช่องรูปแบบไม่ถูก (ต้องเป็น id:ชื่อ)\nบันทึกต่อไหม?`)) return;
        if (await saveBracketPart('teams', { teams })) toast('บันทึกทีมแล้ว');
      }
    };
  };
  draw();
}

function renderRounds() {
  const el = pageEl('rounds');
  const rounds = structuredClone(S.bracket.Rounds || []);

  const draw = () => {
    el.innerHTML = rounds.map((r, i) => `
      <div class="card">
        <div class="row" style="margin-bottom: 12px; flex-wrap: nowrap">
          <div style="flex: 2"><label>ชื่อรอบ</label><input data-r="${i}" data-f="Name" value="${esc(r.Name || '')}"></div>
          <div style="flex: 1"><label>Best of</label><input data-r="${i}" data-f="BestOf" type="number" min="1" value="${r.BestOf ?? 9}"></div>
          <div style="flex: 1"><label>จำนวนแบน</label><input data-r="${i}" data-f="BanCount" type="number" min="0" value="${r.BanCount ?? 1}"></div>
          <div style="flex: 2"><label>วันเริ่ม</label><input data-r="${i}" data-f="StartDate" type="datetime-local" value="${(r.StartDate || '').slice(0, 16)}"></div>
          <div><label>&nbsp;</label><button class="danger" data-delround="${i}">ลบรอบ</button></div>
        </div>
        <label>Map pool — บรรทัดละ 1 แมพ: <code>MOD BeatmapID</code> เช่น <code>NM1 1234567</code></label>
        <textarea data-r="${i}" data-f="pool" rows="${Math.max(4, (r.Beatmaps || []).length + 1)}">${esc((r.Beatmaps || []).map((b) => `${b.Mods || 'NM'} ${b.ID}`).join('\n'))}</textarea>
      </div>`).join('') + `<div class="card"><div class="row">
        <button id="add-round">+ เพิ่มรอบ</button><span class="spacer"></span>
        <button class="primary" id="save-rounds">บันทึกรอบทั้งหมด</button></div>
        <p class="hint">ใส่ Beatmap ID (ไม่ใช่ set id) — ดูจาก URL <code>osu.ppy.sh/beatmapsets/123#mania/<b>456</b></code> เลข 456 คืออันที่ต้องใส่</p>
      </div>`;

    el.oninput = (e) => {
      const i = Number(e.target.dataset.r);
      const f = e.target.dataset.f;
      if (Number.isNaN(i) || !f) return;
      if (f === 'pool') {
        rounds[i].Beatmaps = e.target.value.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
          const parts = line.split(/\s+/);
          const id = Number(parts[parts.length - 1]);
          return { ID: id, Mods: parts.length > 1 ? parts[0].toUpperCase() : 'NM' };
        }).filter((b) => b.ID);
      } else if (f === 'BestOf' || f === 'BanCount') {
        rounds[i][f] = Number(e.target.value);
      } else {
        rounds[i][f] = e.target.value;
      }
    };
    el.onclick = async (e) => {
      if (e.target.id === 'add-round') { rounds.push({ Name: 'New Round', BestOf: 9, BanCount: 1, Beatmaps: [], Matches: [], StartDate: new Date().toISOString() }); draw(); }
      if (e.target.dataset.delround !== undefined) { rounds.splice(Number(e.target.dataset.delround), 1); draw(); }
      if (e.target.id === 'save-rounds') {
        if (await saveBracketPart('rounds', { rounds })) toast('บันทึกรอบแล้ว');
      }
    };
  };
  draw();
}

function renderMatches() {
  const el = pageEl('matches');
  const matches = structuredClone(S.bracket.Matches || []);
  const rounds = structuredClone(S.bracket.Rounds || []);
  const acronyms = (S.bracket.Teams || []).map((t) => t.Acronym).filter(Boolean);
  const roundOf = (id) => rounds.findIndex((r) => (r.Matches || []).includes(id));

  const draw = () => {
    el.innerHTML = editorCard('แมตช์ / สายแข่ง', `
      <table>
        <thead><tr><th style="width:52px">ID</th><th>ทีม 1</th><th>ทีม 2</th><th>รอบ</th>
          <th style="width:170px">เวลา</th><th style="width:110px">ตำแหน่งในสาย</th><th style="width:70px">แพ้คัดออก</th><th style="width:60px"></th></tr></thead>
        <tbody>${matches.map((m, i) => `<tr>
          <td class="muted">#${m.ID}</td>
          <td><select data-i="${i}" data-f="Team1Acronym"><option value="">TBD</option>${acronyms.map((a) => `<option ${a === m.Team1Acronym ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></td>
          <td><select data-i="${i}" data-f="Team2Acronym"><option value="">TBD</option>${acronyms.map((a) => `<option ${a === m.Team2Acronym ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></td>
          <td><select data-i="${i}" data-f="round"><option value="-1">—</option>${rounds.map((r, ri) => `<option value="${ri}" ${ri === roundOf(m.ID) ? 'selected' : ''}>${esc(r.Name)}</option>`).join('')}</select></td>
          <td><input data-i="${i}" data-f="Date" type="datetime-local" value="${(m.Date || '').slice(0, 16)}"></td>
          <td><div class="row" style="flex-wrap: nowrap">
            <input data-i="${i}" data-f="X" type="number" value="${m.Position?.X ?? 0}" style="width: 64px">
            <input data-i="${i}" data-f="Y" type="number" value="${m.Position?.Y ?? 0}" style="width: 64px"></div></td>
          <td style="text-align: center"><input data-i="${i}" data-f="Losers" type="checkbox" ${m.Losers ? 'checked' : ''}></td>
          <td><button class="sm danger" data-del="${i}">ลบ</button></td>
        </tr>`).join('')}</tbody>
      </table>`,
      `<button id="add-match">+ เพิ่มแมตช์</button><span class="spacer"></span><button class="primary" id="save-matches">บันทึก</button>`);

    el.onchange = (e) => {
      const i = Number(e.target.dataset.i);
      const f = e.target.dataset.f;
      if (Number.isNaN(i) || !f) return;
      const m = matches[i];
      if (f === 'round') {
        for (const r of rounds) r.Matches = (r.Matches || []).filter((id) => id !== m.ID);
        const ri = Number(e.target.value);
        if (ri >= 0) (rounds[ri].Matches ||= []).push(m.ID);
      } else if (f === 'X' || f === 'Y') {
        m.Position = { X: 0, Y: 0, ...m.Position, [f]: Number(e.target.value) };
      } else if (f === 'Losers') {
        m.Losers = e.target.checked;
      } else if (f === 'Date') {
        m.Date = e.target.value ? new Date(e.target.value).toISOString() : null;
      } else {
        m[f] = e.target.value;
      }
    };
    el.onclick = async (e) => {
      if (e.target.id === 'add-match') {
        const id = matches.reduce((mx, m) => Math.max(mx, m.ID || 0), 0) + 1;
        matches.push({ ID: id, Team1Acronym: '', Team2Acronym: '', Team1Score: 0, Team2Score: 0, Completed: false, Losers: false, PicksBans: [], Position: { X: 60 + matches.length * 20, Y: 60 + matches.length * 90 }, Date: new Date().toISOString(), ConditionalMatches: [] });
        draw();
      }
      if (e.target.dataset.del !== undefined) { matches.splice(Number(e.target.dataset.del), 1); draw(); }
      if (e.target.id === 'save-matches') {
        if (!await saveBracketPart('matches', { matches })) return;
        if (await saveBracketPart('rounds', { rounds })) toast('บันทึกแมตช์แล้ว');
      }
    };
  };
  draw();
}

function renderTheme() {
  const el = pageEl('theme');
  const t = structuredClone(S.theme);
  const colour = (key, label) => `<div class="field"><label>${label}</label>
    <input type="color" data-c="${key}" value="${esc(t.colours[key] || '#ffffff')}"></div>`;

  el.innerHTML = `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px">
      <div class="card"><h2 class="sec-title">ข้อมูลทัวร์นาเมนต์</h2>
        <div class="field"><label>ชื่อทัวร์</label><input data-t="name" value="${esc(t.name)}"></div>
        <div class="field"><label>คำโปรย</label><input data-t="subtitle" value="${esc(t.subtitle || '')}"></div>
        <div class="field"><label>โลโก้ (ไฟล์ใน data/logos/)</label><input data-t="logo" value="${esc(t.logo || '')}" placeholder="logo.png"></div>
        <div class="field"><label>ฟอนต์ (CSS font-family)</label><input data-t="font" value="${esc(t.font)}"></div>
      </div>
      <div class="card"><h2 class="sec-title">สี</h2>
        <div class="grid3">
          ${colour('red', 'ทีม 1 (แดง)')}${colour('blue', 'ทีม 2 (น้ำเงิน)')}${colour('accent', 'สีเน้น')}
          ${colour('bg', 'พื้นหลัง')}${colour('text', 'ตัวอักษร')}${colour('dim', 'ตัวอักษรจาง')}
        </div>
        <div class="field"><label>Chroma key</label><input type="color" data-t="chromaKey" value="${esc(t.chromaKey)}"></div>
        <div class="row"><label style="margin: 0; text-transform: none; letter-spacing: 0; font-size: 13px"><input type="checkbox" data-t="showChroma" ${t.showChroma ? 'checked' : ''}> ถมสีเขียวในกรอบวิดีโอ</label>
        <p class="hint">ปกติ<b>ไม่ต้องเปิด</b> — browser source โปร่งใสอยู่แล้ว หน้าต่าง osu! ที่วางไว้ข้างหลังทะลุขึ้นมาเอง ไม่ต้องใส่ฟิลเตอร์ Chroma Key<br>เปิดเฉพาะตอนอยากเห็นขอบเขตไว้จัดตำแหน่งหน้าต่าง</p></div>
      </div>
    </div>
    <div class="card"><div class="row">
      <span class="spacer"></span><button class="primary" id="save-theme">บันทึกธีม</button></div>
      <p class="hint">พื้นหลังต่อ scene ย้ายไปอยู่ที่แท็บ <b>Backgrounds</b> แล้ว</p>
    </div>`;

  el.oninput = (e) => {
    if (e.target.dataset.c) t.colours[e.target.dataset.c] = e.target.value;
    if (e.target.dataset.t) t[e.target.dataset.t] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  };
  el.onclick = async (e) => {
    if (e.target.id === 'save-theme') { await api.post('theme', { theme: t }); toast('บันทึกธีมแล้ว'); }
  };
}

function renderSettings() {
  const el = pageEl('settings');
  const c = structuredClone(status.config || {});
  const b = S.bracket;
  const base = location.origin;

  el.innerHTML = `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px">
      <div class="card"><h2 class="sec-title">การเชื่อมต่อ</h2>
        <div class="field"><label>โฟลเดอร์ osu! (stable) — ที่มีไฟล์ ipc.txt</label>
          <input data-c="stablePath" value="${esc(c.stablePath || '')}"></div>
        <div class="field"><label>tosu websocket</label><input data-c="tosu.url" value="${esc(c.tosu?.url || '')}"></div>
        <label style="margin-bottom: 10px; text-transform: none; letter-spacing: 0; font-size: 13px"><input type="checkbox" data-c="tosu.enabled" ${c.tosu?.enabled ? 'checked' : ''}> เปิดใช้ tosu</label>
        <div class="field"><label>obs-websocket</label><input data-c="obs.url" value="${esc(c.obs?.url || '')}"></div>
        <div class="field"><label>รหัส obs-websocket</label><input data-c="obs.password" type="password" value="${esc(c.obs?.password || '')}"></div>
        <label style="margin-bottom: 10px; text-transform: none; letter-spacing: 0; font-size: 13px"><input type="checkbox" data-c="obs.enabled" ${c.obs?.enabled ? 'checked' : ''}> สลับ scene ใน OBS ตามพาเนล</label>
        <label style="margin-bottom: 10px; text-transform: none; letter-spacing: 0; font-size: 13px"><input type="checkbox" data-c="autoProgressScreens" ${c.autoProgressScreens ? 'checked' : ''}> เปลี่ยน scene อัตโนมัติตามสถานะเกม</label>

        <h2 class="sec-title" style="margin: 16px 0 10px; padding-top: 14px; border-top: 1px solid var(--line)">ห้องแข่ง (Bancho IRC)</h2>
        <label style="margin-bottom: 10px; text-transform: none; letter-spacing: 0; font-size: 13px"><input type="checkbox" data-c="irc.enabled" ${c.irc?.enabled ? 'checked' : ''}> เปิดใช้ IRC</label>
        <div class="field"><label>ชื่อผู้ใช้ osu!</label><input data-c="irc.username" value="${esc(c.irc?.username || '')}"></div>
        <div class="field"><label>รหัส IRC (ไม่ใช่รหัสบัญชี)</label><input data-c="irc.password" type="password" value="${esc(c.irc?.password || '')}"></div>
        <div class="field"><label>ห้อง (เว้นว่าง = ใช้ห้องจาก osu!tourney)</label><input data-c="irc.channel" value="${esc(c.irc?.channel || '')}" placeholder="#mp_123456"></div>
        <label style="margin-bottom: 10px; text-transform: none; letter-spacing: 0; font-size: 13px"><input type="checkbox" data-c="irc.autoSetMap" ${c.irc?.autoSetMap ? 'checked' : ''}> กด Pick แล้วสั่ง !mp map ให้อัตโนมัติ</label>
        <p class="hint">ขอรหัส IRC ที่ <b>osu! → Settings → Legacy API → IRC</b> · รหัสเก็บใน <code>data/config.json</code> แบบไม่เข้ารหัส</p>
        <button class="primary" id="save-config">บันทึกการตั้งค่า</button>
        <p class="hint">แก้พอร์ตแล้วต้องรีสตาร์ทเซิร์ฟเวอร์</p>
      </div>

      <div class="card"><h2 class="sec-title">รูปแบบการแข่ง</h2>
        <div class="field"><label>ผู้เล่นต่อทีม (1 = 1v1)</label><input data-b="PlayersPerTeam" type="number" min="1" max="8" value="${b.PlayersPerTeam ?? 1}"></div>
        <div class="field"><label>รูปประจำทีม</label>
          <select data-b="TeamIcon">
            <option value="flag" ${b.TeamIcon !== 'avatar' ? 'selected' : ''}>ธงชาติ (จากช่อง Flag ในหน้า Teams)</option>
            <option value="avatar" ${b.TeamIcon === 'avatar' ? 'selected' : ''}>รูปโปรไฟล์ผู้เล่นคนแรก (เหมาะกับ 1v1)</option>
          </select>
        </div>
        <div class="row" style="flex-wrap: nowrap; margin-bottom: 12px">
          <div style="flex: 1"><label>กรอบวิดีโอ กว้าง (px)</label><input data-b="ChromaKeyWidth" type="number" value="${b.ChromaKeyWidth ?? 1920}"></div>
          <div style="flex: 1"><label>สูง (px)</label><input data-b="ChromaKeyHeight" type="number" value="${b.ChromaKeyHeight ?? 790}"></div>
        </div>
        <label style="margin-bottom: 8px; text-transform: none; letter-spacing: 0; font-size: 13px"><input type="checkbox" data-b="SplitMapPoolByMods" ${b.SplitMapPoolByMods ? 'checked' : ''}> แยก map pool ตาม mod</label>
        <label style="margin-bottom: 8px; text-transform: none; letter-spacing: 0; font-size: 13px"><input type="checkbox" data-b="DisplayTeamSeeds" ${b.DisplayTeamSeeds ? 'checked' : ''}> แสดง seed ของทีม</label>
        <button class="primary" id="save-bracket" style="margin-top: 8px">บันทึก</button>
      </div>
    </div>

    <div class="card"><h2 class="sec-title">ลิงก์สำหรับ OBS</h2>
      <p>Browser Source เดียวจบ ขนาด <b>1920 × 1080</b>:</p>
      <p style="margin: 8px 0"><code>${base}/overlay</code> <button class="sm" id="copy-overlay">คัดลอก</button></p>
    </div>

    <div class="card"><h2 class="sec-title">นำเข้า / ส่งออก</h2>
      <div class="row" style="flex-wrap: nowrap">
        <input type="file" id="import-file" accept="application/json" style="flex: 1">
        <button id="btn-import">นำเข้า bracket.json</button>
        <a class="btn" href="/api/export" download>ส่งออก bracket.json</a>
      </div>
      <p class="hint">โครงสร้างไฟล์ตรงกับ osu!lazer tournament client — ของเดิมย้ายมาได้เลย</p>
    </div>

    <div class="card"><h2 class="sec-title">สถานะ</h2>
      <div class="chips">
        <span class="chip">IPC: ${status.ipcConnected ? 'ต่อแล้ว' : 'ยังไม่เจอไฟล์ ipc.txt'}</span>
        <span class="chip">สถานะเกม: ${esc(status.ipcState || '—')}</span>
        <span class="chip">tosu: ${status.tosuConnected ? 'ต่อแล้ว' : 'ไม่ได้ต่อ'}</span>
        <span class="chip">OBS: ${status.obs?.connected ? 'ต่อแล้ว' : status.obs?.enabled ? 'กำลังต่อ…' : 'ปิดอยู่'}</span>
        <span class="chip">IRC: ${status.irc?.connected ? `ต่อแล้ว ${esc(status.irc.channel || '')}` : status.irc?.enabled ? 'กำลังต่อ…' : 'ปิดอยู่'}</span>
      </div>
      <p class="hint">IPC จะขึ้นเมื่อ osu!tourney (stable) กำลังเปิดอยู่เท่านั้น</p>
    </div>`;

  el.onclick = async (e) => {
    if (e.target.id === 'save-config') {
      for (const node of el.querySelectorAll('[data-c]')) {
        const v = node.type === 'checkbox' ? node.checked : node.value;
        const path = node.dataset.c.split('.');
        let obj = c;
        while (path.length > 1) obj = (obj[path.shift()] ||= {});
        obj[path[0]] = v;
      }
      await api.post('config', { config: c });
      toast('บันทึกแล้ว');
      refreshStatus();
    }
    if (e.target.id === 'save-bracket') {
      const patch = {};
      for (const node of el.querySelectorAll('[data-b]')) {
        const raw = node.type === 'checkbox' ? node.checked : node.value;
        patch[node.dataset.b] = node.tagName === 'SELECT' || node.type === 'checkbox' ? raw : Number(raw);
      }
      if (await saveBracketPart('bracket', { bracket: patch })) toast('บันทึกแล้ว');
    }
    if (e.target.id === 'copy-overlay') {
      navigator.clipboard.writeText(`${base}/overlay`);
      toast('คัดลอกลิงก์แล้ว');
    }
    if (e.target.id === 'btn-import') {
      const file = $('#import-file', el).files[0];
      if (!file) return toast('เลือกไฟล์ก่อน');
      const res = await api.post('import', { bracket: JSON.parse(await file.text()) });
      toast(`นำเข้าแล้ว: ${res.teams} ทีม / ${res.matches} แมตช์`);
    }
  };
}

// ===========================================================================
// osu!tourney — edits osu!'s OWN config files, not ours.
//   tournament.cfg   read once at startup, so a change needs a client relaunch
//   osu!.<user>.cfg  rewritten by osu! on exit, so it must be closed to save
let osuCfg = null;

const OSU_HUD = [
  ['ShowInterface', 'แถบ HUD ในเกม (คะแนน / คอมโบ / acc / หลอดเลือด)', 'ปุ่มเดียวกับ Shift+Tab'],
  ['ScoreboardVisible', 'รายชื่อผู้เล่นฝั่งซ้าย', ''],
  ['ShowSpectators', 'บรรทัด "N spectators"', ''],
  ['KeyOverlay', 'ตัวนับการกดปุ่ม', ''],
  ['FpsCounter', 'ตัวเลข fps', ''],
  ['ShowStoryboard', 'storyboard', ''],
  ['Video', 'วิดีโอพื้นหลัง', ''],
];

function renderOsuCfg() {
  const el = pageEl('osucfg');
  if (!osuCfg) {
    el.innerHTML = '<div class="card"><p class="hint">กำลังอ่านคอนฟิก osu!…</p></div>';
    api.get('osucfg').then((r) => { osuCfg = r; if (page === 'osucfg') renderOsuCfg(); });
    return;
  }
  const c = osuCfg;
  const v = (k) => c.values[k]?.value ?? '';
  const def = (k) => c.values[k]?.def ?? '';
  // a key absent from the file means osu! falls back to its own default
  const tag = (k) => (c.values[k]?.isDefault
    ? `<span class="hint" style="margin:0 0 0 6px">ค่าเริ่มต้น ${esc(def(k)) || '—'}</span>` : '');
  const num = (k, label) => `
    <div class="field"><label>${esc(label)}${tag(k)}</label>
      <input data-o="${k}" type="number" value="${esc(v(k))}" placeholder="${esc(def(k))}"></div>`;
  const onoff = (k, label, hint) => `
    <label style="margin-bottom:10px; text-transform:none; letter-spacing:0; font-size:13px">
      <input type="checkbox" data-o="${k}" data-onoff ${v(k) === '0' ? '' : 'checked'}> ${esc(label)}
      ${hint ? `<span class="hint" style="margin:0 0 0 6px">${esc(hint)}</span>` : ''}
    </label>`;

  const warn = !c.stablePath
    ? 'ยังไม่ได้ตั้งโฟลเดอร์ osu! — ไปตั้งในหน้า Settings ก่อน'
    : c.running
      ? 'osu! เปิดอยู่ — แก้ HUD ไม่ได้ ปิดให้หมดก่อน (osu! เขียนทับคอนฟิกตอนปิด)'
      : '';

  el.innerHTML = `
    ${warn ? `<div class="card" style="border-color:#7a5a1e;color:#e8bd6a;margin-bottom:16px">${esc(warn)}</div>` : ''}
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px">

      <div class="card"><h2 class="sec-title">osu!tourney (tournament.cfg)</h2>
        ${c.tourneyEmpty ? '<p class="hint">ไฟล์ยังว่าง = ใช้ค่าเริ่มต้นของ osu! ทั้งหมด</p>' : ''}
        ${num('ClientNameSize', 'ขนาดชื่อผู้เล่นบนไคลเอนต์ — 0 = ซ่อน')}
        ${num('TeamSize', 'ผู้เล่นต่อทีม (1 = 1v1 เปิด 2 หน้าต่าง)')}
        ${num('Height', 'ความสูงพื้นที่ถ่ายทอด (568-2160)')}
        ${num('Aspect', 'สัดส่วนจอเกม (1-2)')}
        <div class="field"><label>ตัวย่อทัวร์นาเมนต์ (ใช้ตั้งชื่อห้อง)${tag('acronym')}</label>
          <input data-o="acronym" value="${esc(v('acronym'))}" placeholder="${esc(def('acronym'))}"></div>
        ${num('RankingChatDelay', 'หน่วงก่อนซ่อนคะแนนแล้วโชว์แชท (ms)')}
        <p class="hint">osu!tourney อ่านไฟล์นี้ตอนเปิดโปรแกรมอย่างเดียว — แก้แล้วต้องเปิดไคลเอนต์ใหม่</p>
      </div>

      <div class="card"><h2 class="sec-title">HUD ในเกม (osu!.&lt;user&gt;.cfg)</h2>
        ${OSU_HUD.map(([k, label, hint]) => onoff(k, label, hint)).join('')}
        <div class="field"><label>แถบ hit error${tag('ScoreMeter')}</label>
          <select data-o="ScoreMeter">
            ${['None', 'Error', 'Colour'].map((o) => `<option ${v('ScoreMeter') === o ? 'selected' : ''}>${o}</option>`).join('')}
          </select>
        </div>
        ${num('DimLevel', 'หรี่พื้นหลัง 0-100')}
        <div class="row" style="margin-top: 4px">
          <button id="osu-clean">ล้าง HUD ให้เหลือแต่เลน</button>
          <button id="osu-hidename">ซ่อนชื่อผู้เล่น</button>
        </div>
        <p class="hint">สองปุ่มนี้แค่กรอกช่องให้ ยังไม่บันทึกจนกว่าจะกดปุ่มล่าง</p>
      </div>
    </div>

    <div class="card" style="margin-top: 16px">
      <button class="primary" id="osu-save">บันทึกลงคอนฟิก osu!</button>
      <button id="osu-reload" style="margin-left: 8px">อ่านใหม่</button>
      <p class="hint">สำรองไฟล์เดิมเป็น <code>.bak</code> ทุกครั้ง แก้เฉพาะบรรทัดที่ระบุ บรรทัดอื่นไม่แตะ<br>
        ${esc(c.userFile || '(ยังไม่พบ osu!.<user>.cfg)')}</p>
    </div>`;

  el.onclick = async (e) => {
    const set = (k, val) => {
      const node = el.querySelector(`[data-o="${k}"]`);
      if (!node) return;
      if (node.dataset.onoff !== undefined) node.checked = val !== '0';
      else node.value = val;
    };
    if (e.target.id === 'osu-hidename') { set('ClientNameSize', '0'); return toast('กรอกให้แล้ว กดบันทึก'); }
    if (e.target.id === 'osu-clean') {
      for (const [k] of OSU_HUD) set(k, '0');
      set('ScoreMeter', 'None');
      return toast('กรอกให้แล้ว กดบันทึก');
    }
    if (e.target.id === 'osu-reload') { osuCfg = null; return renderOsuCfg(); }
    if (e.target.id === 'osu-save') {
      const patch = {};
      for (const node of el.querySelectorAll('[data-o]')) {
        const val = node.dataset.onoff !== undefined ? (node.checked ? '1' : '0') : node.value.trim();
        if (val !== '') patch[node.dataset.o] = val;
      }
      const res = await api.post('osucfg', { patch });
      if (!res.ok) return toast(res.error || 'บันทึกไม่สำเร็จ');
      osuCfg = res;
      renderOsuCfg();
      toast('บันทึกแล้ว — เปิดไคลเอนต์ใหม่ถึงจะเห็นผล');
    }
  };
}

// ===========================================================================
const RENDERERS = {
  live: renderLive, backgrounds: renderBackgrounds, teams: renderTeams,
  rounds: renderRounds, matches: renderMatches,
  osucfg: renderOsuCfg, settings: renderSettings,
};

function renderPage() {
  if (!S) return;
  RENDERERS[page]?.();
}

function renderStatus() {
  $('#dot-ipc').className = `dot ${status.ipcConnected ? 'on' : ''}`;
  $('#dot-tosu').className = `dot ${status.tosuConnected ? 'on' : ''}`;
  $('#dot-obs').className = `dot ${status.obs?.connected ? 'on' : status.obs?.enabled ? 'warn' : ''}`;
  $('#dot-irc').className = `dot ${status.irc?.connected ? 'on' : status.irc?.enabled ? 'warn' : ''}`;
  $('#irc-info').textContent = status.irc?.connected
    ? (status.irc.channel || 'ยังไม่มีห้อง')
    : status.irc?.enabled ? 'กำลังต่อ…' : 'ปิดอยู่';
  $('#ipc-state').textContent = status.ipcConnected ? (status.ipcState || '—') : 'ไม่ได้ต่อ';
  $('#tosu-info').textContent = S?.live.tosuConnected ? `${S.live.players.length} clients` : 'ไม่ได้ต่อ';
  $('#obs-info').textContent = status.obs?.connected ? 'ต่อแล้ว' : status.obs?.enabled ? 'กำลังต่อ…' : 'ปิดอยู่';
}

async function refreshStatus() {
  status = await api.get('status');
  renderStatus();
}

subscribe(async (state) => {
  const first = !S;
  S = state;
  if (await warmBeatmaps()) liveSig = '';
  if (first) { await refreshStatus(); renderPage(); }
  else if (page === 'live') renderLive();
  else if (page === 'backgrounds') renderBackgrounds();
  renderStatus();
});

setInterval(refreshStatus, 3000);
