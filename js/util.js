// Small pure helpers shared by the whole app.

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const pad = (n) => String(n).padStart(2, '0');

/** Local date -> 'YYYY-MM-DD' */
export function isoDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 'YYYY-MM-DD' -> local Date at 00:00 */
export function parseISO(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Whole days from today until the given ISO date (negative = past). */
export function daysUntil(iso) {
  return Math.round((parseISO(iso) - startOfDay()) / 86400000);
}

export function relDay(iso) {
  const n = daysUntil(iso);
  if (n === 0) return 'היום';
  if (n === 1) return 'מחר';
  if (n === 2) return 'מחרתיים';
  if (n === -1) return 'אתמול';
  if (n === 7) return 'בעוד שבוע';
  if (n > 0) return `בעוד ${n} ימים`;
  return `לפני ${-n} ימים`;
}

const fmtShort = new Intl.DateTimeFormat('he-IL', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtLong = new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtDM = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric' });
let fmtHeb = null;
try {
  fmtHeb = new Intl.DateTimeFormat('he-IL-u-ca-hebrew', { day: 'numeric', month: 'long' });
} catch { /* hebrew calendar not supported */ }

export const fmtDate = (iso) => fmtShort.format(parseISO(iso));
export const fmtDateLong = (d) => fmtLong.format(d);
export const fmtDayMonth = (d) => fmtDM.format(d);
export const fmtHebrewDate = (d) => (fmtHeb ? fmtHeb.format(d) : '');

export function fmtDateTime(ms) {
  const d = new Date(ms);
  return `${fmtShort.format(d)}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Minutes -> short Hebrew duration, e.g. "2 ש׳ 15 ד׳" */
export function fmtMin(min) {
  min = Math.round(min || 0);
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} ד׳`;
  if (!m) return `${h} ש׳`;
  return `${h} ש׳ ${m} ד׳`;
}

/** Compact duration for tight tiles: "2:45" hours or "40" minutes, with unit. */
export function fmtMinShort(min) {
  min = Math.round(min || 0);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? { value: `${h}:${pad(m)}`, unit: 'ש׳' } : { value: String(m), unit: 'דק׳' };
}

/** Milliseconds -> "HH:MM:SS" or "MM:SS" */
export function fmtClock(ms) {
  const neg = ms < 0;
  const t = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const body = h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  return neg ? `+${body}` : body;
}

/** Sunday 00:00 of the week containing d (Israeli week). */
export function weekStart(d = new Date()) {
  const x = startOfDay(d);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export const DAY_LETTERS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

export function greeting(d = new Date()) {
  const h = d.getHours();
  if (h >= 5 && h < 12) return 'בוקר טוב';
  if (h >= 12 && h < 17) return 'צהריים טובים';
  if (h >= 17 && h < 22) return 'ערב טוב';
  return 'לילה טוב';
}

export function debounce(fn, ms) {
  let t;
  const wrapped = (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
  wrapped.flush = (...a) => {
    clearTimeout(t);
    fn(...a);
  };
  return wrapped;
}

/** Normalise Hebrew text for loose matching (strip quotes, geresh, spaces). */
export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/["'׳״`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone() {
  return window.navigator.standalone === true ||
    window.matchMedia?.('(display-mode: standalone)').matches;
}

export function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

export function dataURLToBlob(url) {
  const [header, b64 = ''] = String(url).split(',');
  const type = (header.match(/^data:([^;,]+)/) || [])[1] || 'application/octet-stream';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
}

/** Shrink big photos (iPhone camera = 4000px+) so storage stays small. */
export async function compressImage(file, maxSide = 1800, quality = 0.82) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 900_000) return file;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
    return blob || file;
  } catch {
    return file;
  }
}
