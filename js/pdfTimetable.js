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
// Common Israeli school subjects, used to tell the subject apart from the teacher's name.
const SUBJECTS = [
  'מתמטיקה', 'מתמט', 'אנגלית', 'היסטוריה', 'ספרות', 'לשון', 'הבעה', 'אזרחות', 'ביולוגיה', 'כימיה', 'פיזיקה',
  'חינוך', 'גופני', 'ספורט', 'ערבית', 'מדעים', 'מדע', 'גאוגרפיה', 'גיאוגרפיה', 'תנך', 'תנ', 'מולדת', 'מחשבים',
  'מחשב', 'תקשורת', 'פיזי', 'כימי', 'ביו', 'אמנות', 'אומנות', 'מוזיקה', 'מוסיקה', 'תיאטרון', 'קולנוע', 'צרפתית',
  'ספרדית', 'רוסית', 'יהדות', 'תלמוד', 'משנה', 'גמרא', 'מקרא', 'הלכה', 'פילוסופיה', 'פסיכולוגיה', 'סוציולוגיה',
  'כלכלה', 'חשבונאות', 'ניהול', 'משפט', 'רובוטיקה', 'אלקטרוניקה', 'הנדסה', 'ביולוגית', 'גיאולוגיה', 'סטטיסטיקה',
  'חנך', 'חברה', 'של', 'מגמה', 'מעבדה', 'כישורי', 'מצוינות', 'העשרה', 'חטיבה', 'פרויקט', 'עבודת',
];
const DICT = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'מערכת', 'שעות', 'שיעור', 'כיתה', ...SUBJECTS];
const HEB = /[֐-׿]/;
const TEACHER_TITLE = /^(מר|גב|גברת|ד"?ר|הרב|המורה|מורה|מר'|פרופ)\b/;

/** How strongly a line reads as a subject (not a teacher's name / room). */
function subjectScore(line) {
  const t = line.replace(/["'׳״]/g, '');
  let score = 0;
  for (const w of SUBJECTS) if (t.includes(w)) score += w.length >= 4 ? 3 : 1;
  const words = line.split(/\s+/).filter(Boolean);
  if (words.length === 1) score += 1; // subjects are usually one word; names are usually two
  return score;
}

/** Does the line look like a person's name rather than a subject? */
function looksLikeName(line) {
  if (TEACHER_TITLE.test(line)) return true;
  const words = line.split(/\s+/).filter((w) => HEB.test(w));
  return words.length >= 2 && subjectScore(line) === 0;
}
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

/**
 * Chain items into groups while the gap to the PREVIOUS item is within `tol`.
 * Chaining (vs comparing to the running mean) lets a tall multi-line cell —
 * subject / teacher / room stacked ~15px apart — stay one group, while the
 * larger gap to the next period still starts a new one. `v` is the group mean.
 */
function cluster(items, key, tol) {
  const sorted = [...items].sort((a, b) => key(b) - key(a));
  const groups = [];
  let last = null;
  for (const it of sorted) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(last - key(it)) <= tol) {
      g.members.push(it);
      g.v = g.members.reduce((s, m) => s + key(m), 0) / g.members.length;
    } else groups.push({ v: key(it), members: [it] });
    last = key(it);
  }
  return groups;
}

function dayOf(text) {
  const t = text.replace(/\s+/g, ' ').trim();
  for (const [d, re] of DAY_WORDS) if (re.test(t)) return d;
  return null;
}

const cleanStr = (v) => String(v || '').replace(/\s+/g, ' ').trim();

/** Clean a subject name from a timetable cell: drop (parentheses), "5 יח״ל",
 *  level/group markers and stray standalone numbers that aren't the subject. */
/** Strip brackets, gershayim/backticks and long codes from teacher / room text. */
function scrub(v) {
  return String(v || '')
    .replace(/`+/g, '״') // gershayim rendered as backticks → ״
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
    .replace(/[)\]}][^([{]*[([{]/g, ' ')
    .replace(/[()[\]{}`]/g, ' ')
    .replace(/\b\d{4,}\b/g, ' ') // long group/class codes (e.g. 3997)
    .replace(/\s*[:·]\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Track / group / level words to drop (JS \b doesn't work on Hebrew, so match tokens).
const DROP_TOKEN = /^(יחידות|יח|הקבצה|קבוצה|מגמה|רמה|\d{1,4}[א-ת]?)$/;
function cleanSubject(v) {
  const s = String(v || '')
    .replace(/`+/g, '״') // gershayim rendered as backticks → ״ (תנ``ך → תנ״ך)
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ') // (…) normal order
    .replace(/[)\]}][^([{]*[([{]/g, ' ') // )…( reversed RTL glyph order
    .replace(/[()[\]{}]/g, ' ') // any leftover bracket char
    .replace(/\d*\s*יח\s*["'׳״`]*\s*ל?(?=\s|$)/g, ' ') // 5 יח"ל / יח``ל / יחל
    .replace(/[-–—/|:]+/g, ' ');
  return s
    .split(/\s+/)
    .filter((t) => t && !DROP_TOKEN.test(t.replace(/["'׳״`.:]/g, '')))
    .join(' ')
    .trim();
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

  // 3. Rows come from the lesson CONTENT itself (every band of text in the day
  //    columns is a row), so no period is ever missed — not from the hour
  //    numbers, which may stop early or be formatted differently further down.
  const anchorItems = body.filter((i) => !colOf(i) && (/^\d{1,2}$/.test(i.str) || /\d{1,2}[:.]\d{2}/.test(i.str)));
  const anchorRows = cluster(anchorItems, (i) => i.y, fontH * 1.4).map((g) => {
    const text = g.members.map((m) => m.str).join(' ');
    const num = g.members.map((m) => m.str).find((s) => /^\d{1,2}$/.test(s));
    const times = [...text.matchAll(TIME)].map((m) => `${pad(+m[1])}:${m[2]}`);
    return { y: g.v, period: num != null ? +num : null, start: times[0] || '', end: times[1] || '' };
  });

  const content = body.filter((i) => colOf(i) && !anchorItems.includes(i));
  let rows = cluster(content, (i) => i.y, fontH * 1.8).map((g) => ({ y: g.v, members: g.members }));
  rows.sort((a, b) => b.y - a.y); // top of page → bottom
  // Match each content row to the nearest hour anchor for its period / start / end.
  rows.forEach((r, i) => {
    let best = null;
    let bestD = fontH * 3.2;
    for (const a of anchorRows) {
      const d = Math.abs(a.y - r.y);
      if (d < bestD) { bestD = d; best = a; }
    }
    r.period = best && best.period != null ? best.period : i + 1;
    r.start = best ? best.start : '';
    r.end = best ? best.end : '';
    r.top = i === 0 ? Infinity : (rows[i - 1].y + r.y) / 2;
    r.bottom = i === rows.length - 1 ? -Infinity : (r.y + rows[i + 1].y) / 2;
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
    // Classify: pull out the room line and the teacher's name; everything else
    // is the subject (it may span two lines, e.g. "מתמטיקה (רמה: 5" / "יח״ל)").
    let room = '';
    const rest = [];
    for (const line of lineList) {
      if (!room && (/(חדר|כיתה|מעבדה|אולם|מקלט|קומה)/.test(line) || /^\d{1,4}[א-ת]?$/.test(line))) room = line;
      else rest.push(line);
    }
    // The best subject line (dictionary match, else the topmost line) is never the
    // teacher; the teacher is a name line other than that one.
    const scored = rest.map((l) => ({ l, sc: subjectScore(l) }));
    const best = scored.reduce((a, b) => (b.sc > a.sc ? b : a), scored[0] || { l: '', sc: -1 });
    const teacher = rest.find((l) => looksLikeName(l) && l !== best.l) || '';
    const subjectParts = rest.filter((l) => l !== teacher);
    const cleanName = cleanSubject(subjectParts.join(' ').replace(TIME, ''));
    if (!cleanName || cleanName.replace(/[^\p{L}]/gu, '').length < 2) continue;
    const times = [...lineList.join(' ').matchAll(TIME)].map((m) => `${pad(+m[1])}:${m[2]}`);
    lessons.push({
      day: cell.day,
      period: cell.row.period,
      start: cell.row.start || times[0] || '',
      end: cell.row.end || times[1] || '',
      subject: cleanName,
      teacher: scrub(teacher),
      room: scrub(room),
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
