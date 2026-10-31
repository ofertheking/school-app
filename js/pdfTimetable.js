// Read a weekly timetable (מערכת שעות) out of a PDF, e.g. the one Webtop exports.
// Strategy: find the row of day headers (ראשון…שישי) → columns; find the hour
// numbers / times beside the grid → rows; drop every other text item into its cell.

const DAY_WORDS = [
  [0, /^(יום\s*)?(ראשון|א['׳]?)$/],
  [1, /^(יום\s*)?(שני|ב['׳]?)$/],
  [2, /^(יום\s*)?(שלישי|ג['׳]?)$/],
  [3, /^(יום\s*)?(רביעי|ד['׳]?)$/],
  [4, /^(יום\s*)?(חמישי|ה['׳]?)$/],
  [5, /^(יום\s*)?(שישי|ו['׳]?)$/],
];
const DICT = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'מתמטיקה', 'אנגלית', 'היסטוריה', 'ספרות', 'לשון', 'אזרחות',
  'ביולוגיה', 'כימיה', 'פיזיקה', 'חינוך', 'ספורט', 'מערכת', 'שעות', 'שיעור', 'כיתה', 'ערבית', 'מדעים', 'גאוגרפיה', 'תנך', 'תנ"ך'];
const HEB = /[֐-׿]/;
const TIME = /(\d{1,2})[:.](\d{2})/g;

const MIRROR = { '(': ')', ')': '(', '[': ']', ']': '[', '<': '>', '>': '<' };

/** Turn visually-ordered (reversed) Hebrew into logical order, keeping numbers/latin intact. */
export function visualToLogical(s) {
  const runs = String(s).match(/[A-Za-z0-9][A-Za-z0-9:./\-]*|[^A-Za-z0-9]+/g) || [];
  return runs
    .reverse()
    .map((r) => (/^[A-Za-z0-9]/.test(r) ? r : [...r].reverse().map((c) => MIRROR[c] || c).join('')))
    .join('');
}

const dictScore = (texts) => texts.reduce((n, t) => n + (DICT.some((w) => t.includes(w)) ? 1 : 0), 0);
const pad = (n) => String(n).padStart(2, '0');
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** Group values that are within `tol` of each other. Returns [{ v (mean), members }]. */
function cluster(items, key, tol) {
  const sorted = [...items].sort((a, b) => key(b) - key(a));
  const groups = [];
  for (const it of sorted) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(g.v - key(it)) <= tol) {
      g.members.push(it);
      g.v = g.members.reduce((s, m) => s + key(m), 0) / g.members.length;
    } else groups.push({ v: key(it), members: [it] });
  }
  return groups;
}

function dayOf(text) {
  const t = text.replace(/\s+/g, ' ').trim();
  for (const [d, re] of DAY_WORDS) if (re.test(t)) return d;
  return null;
}

/**
 * items: [{ str, x, y, w, h }] in PDF coordinates (y grows upwards).
 * Returns { lessons: [{day, period, start, end, subject, teacher, room}], reversed, days, rows }.
 */
export function parseTimetableItems(rawItems) {
  let items = rawItems
    .map((i) => ({ ...i, str: String(i.str || '').replace(/\s+/g, ' ').trim() }))
    .filter((i) => i.str);
  if (!items.length) return { lessons: [], reversed: false, days: 0, rows: 0, reason: 'no-text' };

  // 1. Is the Hebrew stored backwards?
  const heb = items.filter((i) => HEB.test(i.str)).map((i) => i.str);
  const reversed = dictScore(heb.map(visualToLogical)) > dictScore(heb);
  if (reversed) items = items.map((i) => (HEB.test(i.str) ? { ...i, str: visualToLogical(i.str) } : i));

  const fontH = median(items.map((i) => i.h || 8)) || 8;

  // 2. Day header row: the horizontal line holding the most distinct day names.
  const dayCands = items.filter((i) => dayOf(i.str) != null);
  const headerRows = cluster(dayCands, (i) => i.y, fontH * 0.8)
    .map((g) => ({ ...g, days: new Set(g.members.map((m) => dayOf(m.str))) }))
    .sort((a, b) => b.days.size - a.days.size);
  const header = headerRows[0];
  if (!header || header.days.size < 3) return { lessons: [], reversed, days: 0, rows: 0, reason: 'no-days' };

  const cols = [];
  for (const m of header.members) {
    const d = dayOf(m.str);
    if (!cols.some((c) => c.day === d)) cols.push({ day: d, cx: m.x + (m.w || 0) / 2 });
  }
  cols.sort((a, b) => a.cx - b.cx);
  const spacing = cols.length > 1 ? (cols[cols.length - 1].cx - cols[0].cx) / (cols.length - 1) : 80;
  cols.forEach((c, i) => {
    c.lo = i === 0 ? c.cx - spacing / 2 : (cols[i - 1].cx + c.cx) / 2;
    c.hi = i === cols.length - 1 ? c.cx + spacing / 2 : (c.cx + cols[i + 1].cx) / 2;
  });
  const colOf = (it) => {
    const cx = it.x + (it.w || 0) / 2;
    return cols.find((c) => cx >= c.lo && cx < c.hi) || null;
  };
  const headerY = header.v;
  const body = items.filter((i) => i.y < headerY - fontH * 0.4 && !header.members.includes(i));

  // 3. Row anchors: hour numbers or times outside the day columns.
  const anchorItems = body.filter((i) => !colOf(i) && (/^\d{1,2}$/.test(i.str) || /\d{1,2}[:.]\d{2}/.test(i.str)));
  let rows = cluster(anchorItems, (i) => i.y, fontH * 1.2).map((g) => {
    const text = g.members.map((m) => m.str).join(' ');
    const num = g.members.map((m) => m.str).find((s) => /^\d{1,2}$/.test(s));
    const times = [...text.matchAll(TIME)].map((m) => `${pad(+m[1])}:${m[2]}`);
    return { y: g.v, period: num != null ? +num : null, start: times[0] || '', end: times[1] || '' };
  });
  // Times stacked under the hour number land in their own cluster — merge them into the row above.
  rows = rows.reduce((acc, r) => {
    const prev = acc[acc.length - 1];
    if (prev && r.period == null && prev.y - r.y < fontH * 2.6 && (!prev.start || !prev.end)) {
      prev.start = prev.start || r.start;
      prev.end = prev.end || r.end || (r.start && prev.start ? r.start : '');
      return acc;
    }
    acc.push(r);
    return acc;
  }, []);

  const content = body.filter((i) => colOf(i) && !anchorItems.includes(i));
  if (rows.length < 2) {
    // No explicit hour column: every vertical block of text is a row.
    rows = cluster(content, (i) => i.y, fontH * 2.2).map((g, idx) => ({ y: g.v, period: idx + 1, start: '', end: '' }));
  }
  rows.sort((a, b) => b.y - a.y);
  rows.forEach((r, i) => {
    r.top = i === 0 ? r.y + fontH * 3 : (rows[i - 1].y + r.y) / 2;
    r.bottom = i === rows.length - 1 ? r.y - fontH * 3 : (r.y + rows[i + 1].y) / 2;
  });

  // 4. Fill the cells.
  const cells = new Map();
  for (const it of content) {
    const c = colOf(it);
    const r = rows.find((row) => it.y <= row.top && it.y > row.bottom);
    if (!c || !r) continue;
    const k = `${c.day}|${rows.indexOf(r)}`;
    if (!cells.has(k)) cells.set(k, { day: c.day, row: r, items: [] });
    cells.get(k).items.push(it);
  }

  const lessons = [];
  for (const cell of cells.values()) {
    const lines = cluster(cell.items, (i) => i.y, fontH * 0.6).map((g) =>
      g.members
        .sort((a, b) => b.x - a.x) // right-to-left reading order
        .map((m) => m.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
    );
    const lineList = lines.filter(Boolean);
    if (!lineList.length) continue;
    let subject = '';
    let teacher = '';
    let room = '';
    for (const line of lineList) {
      if (!room && (/חדר|כיתה|מעבדה|אולם|מקלט/.test(line) || /^\d{1,4}[א-ת]?$/.test(line))) room = line;
      else if (!subject) subject = line;
      else if (!teacher) teacher = line;
    }
    if (!subject) continue;
    const times = [...lineList.join(' ').matchAll(TIME)].map((m) => `${pad(+m[1])}:${m[2]}`);
    lessons.push({
      day: cell.day,
      period: cell.row.period,
      start: cell.row.start || times[0] || '',
      end: cell.row.end || times[1] || '',
      subject: subject.replace(TIME, '').replace(/\s*[-–]\s*$/, '').trim(),
      teacher,
      room,
    });
  }
  lessons.sort((a, b) => a.day - b.day || (a.period ?? 99) - (b.period ?? 99));
  return { lessons, reversed, days: cols.length, rows: rows.length, reason: lessons.length ? '' : 'empty' };
}

/** Extract positioned text from every page and parse the page that looks most like a timetable. */
export async function parseTimetablePdf(blob) {
  const { openPdf } = await import('./pdf.js');
  const doc = await openPdf(blob);
  let best = { lessons: [], reversed: false, days: 0, rows: 0, reason: 'no-days' };
  for (let p = 1; p <= Math.min(doc.numPages, 5); p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items
      .filter((i) => i.str && i.str.trim())
      .map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width, h: i.height || Math.abs(i.transform[3]) }));
    const res = parseTimetableItems(items);
    if (res.lessons.length > best.lessons.length) best = res;
  }
  return best;
}
