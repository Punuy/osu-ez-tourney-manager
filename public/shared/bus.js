// Shared client helpers: live state over SSE, plus small DOM/format utilities.

export const api = {
  async post(route, body = {}) {
    const res = await fetch(`/api/${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  },
  async get(route) {
    return (await fetch(`/api/${route}`)).json();
  },
};

/** Subscribe to server state. Reconnects on its own so OBS can sit open for hours. */
export function subscribe(onState) {
  let source;
  const connect = () => {
    source = new EventSource('/api/events');
    source.addEventListener('state', (ev) => {
      try { onState(JSON.parse(ev.data)); } catch { /* malformed frame */ }
    });
    source.onerror = () => {
      source.close();
      setTimeout(connect, 2000);
    };
  };
  connect();
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export const el = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

export const fmtTime = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

export const fmtScore = (n) => (n || 0).toLocaleString('en-US');

/** Team flag image: a local file in data/flags wins, otherwise the flag CDN. */
export function flagUrl(flagName) {
  if (!flagName) return '';
  if (/\.(png|jpg|jpeg|svg|webp)$/i.test(flagName)) return `/data/flags/${flagName}`;
  if (/^[A-Za-z]{2}$/.test(flagName)) return `https://flagcdn.com/w160/${flagName.toLowerCase()}.png`;
  return `/data/flags/${flagName}.png`;
}

export const avatarUrl = (userId) => (userId ? `https://a.ppy.sh/${userId}` : '');

/** Applies theme.json to CSS custom properties so the whole look is data-driven. */
export function applyTheme(theme) {
  if (!theme) return;
  const root = document.documentElement.style;
  for (const [key, value] of Object.entries(theme.colours || {})) {
    root.setProperty(`--c-${key}`, value);
  }
  root.setProperty('--font', theme.font || "'Segoe UI', sans-serif");
  root.setProperty('--chroma', theme.chromaKey || '#00ff00');
}

/** Mod bracket a pool map belongs to, e.g. "HD2" -> "HD". */
export const modBracket = (mods) => String(mods || 'NM').replace(/\d+$/, '').toUpperCase() || 'NM';
