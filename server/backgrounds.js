// Per-scene background media: the uploaded file plus how the overlay should show it.
// Files live in data/backgrounds/, the settings alongside them in backgrounds.json.
import fs from 'node:fs';
import path from 'node:path';
import { DATA, SCENES } from './config.js';

export const BG_DIR = path.join(DATA, 'backgrounds');
const BG_FILE = path.join(DATA, 'backgrounds.json');
const TRANSITION_DIR = path.join(DATA, 'transitions');
const LEGACY_DIR = path.join(DATA, 'videos');

export const VIDEO_EXT = ['.mp4', '.webm'];
export const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
export const ALLOWED_EXT = [...VIDEO_EXT, ...IMAGE_EXT];

export const typeOf = (file) => (VIDEO_EXT.includes(path.extname(file).toLowerCase()) ? 'video' : 'image');

let store = {};

function read() {
  try { return JSON.parse(fs.readFileSync(BG_FILE, 'utf8')); } catch { return {}; }
}

function write() {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(BG_FILE, JSON.stringify(store, null, 2));
}

function sizeOf(file) {
  try { return fs.statSync(path.join(BG_DIR, file)).size; } catch { return 0; }
}

/** Adopt anything already sitting in the old data/videos/ folder. */
function migrateLegacy() {
  let names = [];
  try { names = fs.readdirSync(LEGACY_DIR); } catch { return; }
  fs.mkdirSync(BG_DIR, { recursive: true });
  for (const name of names) {
    const ext = path.extname(name).toLowerCase();
    if (name === '_trash') continue;
    const scene = path.basename(name, ext);
    if (!ALLOWED_EXT.includes(ext) || !SCENES.includes(scene) || store[scene]) continue;
    try {
      fs.copyFileSync(path.join(LEGACY_DIR, name), path.join(BG_DIR, name));
      store[scene] = { file: name, type: typeOf(name), dim: 0, fit: 'cover' };
    } catch { /* unreadable source */ }
  }
}

export function init() {
  fs.mkdirSync(BG_DIR, { recursive: true });
  store = read();
  // Drop entries whose file was deleted by hand, or malformed records created by
  // a partial save while the custom HTML/CSS editor was being added.
  for (const [scene, bg] of Object.entries(store)) {
    if (!bg || typeof bg !== 'object') { delete store[scene]; continue; }
    if (!bg.file) {
      if (bg.html || bg.css) continue; // custom HTML/CSS-only backgrounds are valid
      delete store[scene];
      continue;
    }
    if (!fs.existsSync(path.join(BG_DIR, bg.file))) delete store[scene];
  }
  migrateLegacy();
  write();
}

/** What the overlay and panel both read: settings plus the live file size. */
export function list() {
  const out = {};
  for (const [scene, bg] of Object.entries(store)) {
    if (!bg || typeof bg !== 'object') continue;
    out[scene] = { ...bg, file: bg.file || '', size: bg.file ? sizeOf(bg.file) : 0 };
  }
  return out;
}

export function fileNameFor(scene, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) return null;
  return scene + ext;
}

export const TRASH_DIR = path.join(BG_DIR, '_trash');

/** One optional video played over the overlay while a scene changes. */
export function transition() {
  for (const ext of VIDEO_EXT) {
    const file = `transition${ext}`;
    const full = path.join(TRANSITION_DIR, file);
    try { return { file, type: 'video', size: fs.statSync(full).size }; } catch { /* try next */ }
  }
  return null;
}

export function transitionFileName(originalName) {
  const ext = path.extname(originalName).toLowerCase();
  return VIDEO_EXT.includes(ext) ? `transition${ext}` : null;
}

export function clearTransitionFiles(keep = '') {
  for (const ext of VIDEO_EXT) {
    const file = `transition${ext}`;
    if (file === keep) continue;
    try { fs.unlinkSync(path.join(TRANSITION_DIR, file)); } catch { /* absent */ }
  }
}

export function setTransition(file) {
  fs.mkdirSync(TRANSITION_DIR, { recursive: true });
  clearTransitionFiles(file);
}

export function removeTransition() { clearTransitionFiles(); }

export { TRANSITION_DIR };

/** Remove any other extension for this scene so only one file per scene remains.
 *  `trash` moves the file aside instead of deleting it, so an accidental
 *  "clear all" during setup is recoverable. */
export function clearFiles(scene, keep = '', trash = false) {
  for (const ext of ALLOWED_EXT) {
    const name = scene + ext;
    if (name === keep) continue;
    const src = path.join(BG_DIR, name);
    if (!fs.existsSync(src)) continue;
    try {
      if (trash) {
        fs.mkdirSync(TRASH_DIR, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        fs.renameSync(src, path.join(TRASH_DIR, `${stamp}-${name}`));
      } else {
        fs.unlinkSync(src);
      }
    } catch { /* leave it */ }
  }
}

export function set(scene, file) {
  const prev = store[scene] || {};
  // Uploading/replacing media changes only the bottom layer. Keep the custom
  // HTML/CSS foreground layer intact so it never disappears after a file pick.
  store[scene] = {
    ...prev,
    file,
    type: typeOf(file),
    dim: prev.dim ?? 0,
    fit: prev.fit ?? 'cover',
  };
  clearFiles(scene, file);
  write();
}

export function update(scene, patch) {
  if (!store[scene]) store[scene] = { dim: 0, fit: 'cover', html: '', css: '', overlay: false };
  if (patch.dim !== undefined) store[scene].dim = Math.max(0, Math.min(100, Number(patch.dim) || 0));
  if (patch.fit === 'cover' || patch.fit === 'contain') store[scene].fit = patch.fit;
  if (patch.html !== undefined) store[scene].html = String(patch.html ?? '');
  if (patch.css !== undefined) store[scene].css = String(patch.css ?? '');
  if (patch.overlay !== undefined) store[scene].overlay = patch.overlay === true;
  write();
  return true;
}

export function remove(scene) {
  clearFiles(scene, '', true);
  delete store[scene];
  write();
}

export function removeAll() {
  for (const scene of SCENES) clearFiles(scene, '', true);
  store = {};
  write();
}

/** Copy one scene's file to every other scene, settings included. */
export function applyToAll(scene) {
  const src = store[scene];
  if (!src) return false;
  if (!src.file) {
    for (const target of SCENES) {
      if (target === scene) continue;
      clearFiles(target);
      store[target] = {
        dim: src.dim ?? 0,
        fit: src.fit ?? 'cover',
        html: src.html || '',
        css: src.css || '',
        overlay: src.overlay === true,
      };
    }
    write();
    return true;
  }
  const ext = path.extname(src.file);
  for (const target of SCENES) {
    if (target === scene) continue;
    const name = target + ext;
    try {
      fs.copyFileSync(path.join(BG_DIR, src.file), path.join(BG_DIR, name));
      clearFiles(target, name);
      store[target] = { file: name, type: src.type, dim: src.dim, fit: src.fit };
    } catch { /* copy failed, leave that scene alone */ }
  }
  write();
  return true;
}
