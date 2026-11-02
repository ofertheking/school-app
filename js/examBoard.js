// Read a school exam board (לוח מבחנים) PDF — the kind schools export from Excel:
// one row per date, a column per grade / class — and add the exams that belong
// to YOUR grade and YOUR subjects.
import { S, save, ensureSubject } from './core.js';
import { esc, uid, isoDate, fmtDate, daysUntil } from './util.js';
import { openSheet, toast } from './ui.js';
import { visualToLogical } from './pdfTimetable.js';
import { go } from './router.js';

// ---------------------------------------------------------------- parsing

const HEB = /[֐-׿]/;
const DATE = /(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?/;
const DATE_ONLY = /^(?:יום\s*)?(?:[א-ו]['׳]?\s*)?(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?(?:\s*(?:יום\s*)?[א-ו]['׳]?)?$/;
const DAY_ONLY = /^(?:יום\s*)?(?:[אבגדהוש]['׳]?|ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)$/;
const BOARD_WORDS = ['מבחן', 'בוחן', 'מבדק', 'בגרות', 'שבת', 'שכבה', 'הערכה', 'מתמטיקה', 'אנגלית', 'היסטוריה', 'ספרות', 'לשון'];
const LABEL_WORDS = /^(שכבה|כיתה|תאריך|יום|סוג האירוע|אירוע|מבחנים|הערות|שבוע)$/;
const GRADE_LIKE = /(שכבה|כיתה|^[זחטי]['׳"]?\s*\d?$|^י[אב]['׳"]?\s*\d?$)/;

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** Year for a dd/mm with no year: the one inside the current school year (Sep–Aug). */
function inferYear(m, now = new Date()) {
  const start = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return m >= 8 ? start : start + 1;
}

function toISO(d, m, y) {
  d = +d;
  m = +m;
  if (!d || !m || d > 31 || m > 12) return '';
  let yy = y ? +y : inferYear(m);
  if (yy < 100) yy += 2000;
  return `${yy}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Group items whose `key` values are within `tol` of the previous one. */
function chain(items, key, tol) {
  const sorted = [...items].sort((a, b) => key(b) - key(a));
  const out = [];
  let last = null;
  for (const it of sorted) {
    if (out.length && Math.abs(last - key(it)) <= tol) out[out.length - 1].push(it);
    else out.push([it]);
    last = key(it);
  }
  return out;
}

/** Join one visual line right-to-left; runs that touch get no space (תנ + " + ך → תנ"ך). */
function joinLine(members, fontH) {
  const runs = [...members].sort((a, b) => b.x - a.x);
  let s = '';
  let prev = null;
  for (const r of runs) {
    if (prev) {
      const gap = prev.x - (r.x + (r.w || 0));
      s += gap > Math.max(1.2, fontH * 0.16) ? ' ' : '';
    }
    s += r.str;
    prev = r;
  }
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * items: [{ str, x, y, w, h }] (PDF coordinates, y grows upwards).
 * → { columns: [{ label, events: [{ date, text }] }], reason }
 */
export function parseExamBoardItems(rawItems) {
  let items = rawItems
    .map((i) => ({ ...i, str: String(i.str || '').replace(/\s+/g, ' ').trim() }))
    .filter((i) => i.str);
  if (!items.length) return { columns: [], reason: 'no-text' };

  // Hebrew stored backwards? (some exporters write visual order)
  const heb = items.filter((i) => HEB.test(i.str)).map((i) => i.str);
  const score = (arr) => arr.reduce((n, t) => n + (BOARD_WORDS.some((w) => t.includes(w)) ? 1 : 0), 0);
  if (score(heb.map(visualToLogical)) > score(heb)) {
    items = items.map((i) => (HEB.test(i.str) ? { ...i, str: visualToLogical(i.str) } : i));
  }
  const fontH = median(items.map((i) => i.h || 9)) || 9;

  // 1. Date anchors → one row each.
  const anchors = [];
  for (const it of items) {
    const m = it.str.match(DATE_ONLY);
    if (!m) continue;
    const iso = toISO(m[1], m[2], m[3]);
    if (iso) anchors.push({ ...it, iso });
  }
  if (anchors.length < 2) return { columns: [], reason: 'no-dates' };
  // The date column: the x band holding most of the dates (ignore stray dates in the text).
  const dateCols = chain(anchors, (a) => a.x + (a.w || 0) / 2, fontH * 3).sort((a, b) => b.length - a.length);
  const rowsA = dateCols[0].sort((a, b) => b.y - a.y);
  const dateLeft = Math.min(...rowsA.map((a) => a.x));
  const dateRight = Math.max(...rowsA.map((a) => a.x + (a.w || 0)));
  const half = (i) => (i >= 0 && i < rowsA.length - 1 ? (rowsA[i].y - rowsA[i + 1].y) / 2 : null);
  const rows = rowsA.map((a, i) => {
    // Cells are vertically centred on their date, so the first/last row reach as far
    // out as they reach in — never up into the column headers.
    let up = half(i - 1);
    let down = half(i);
    if (up == null) up = Math.min(fontH * 1.6, down ?? fontH * 1.6);
    if (down == null) down = Math.min(fontH * 1.6, up);
    return { iso: a.iso, y: a.y, top: a.y + up, bottom: a.y - down, anchor: a };
  });
  const top = rows[0].top;
  const bottom = rows[rows.length - 1].bottom;

  // 2. Content: everything in the rows except the dates and the day letters.
  const isAnchor = new Set(rowsA);
  const inRows = items.filter((i) => i.y <= top && i.y > bottom && !isAnchor.has(i));
  const dayItems = inRows.filter((i) => DAY_ONLY.test(i.str));
  // The day-letter column sits beside the dates; events are on the far side of both.
  const near = (i) => {
    const cx = i.x + (i.w || 0) / 2;
    return cx >= dateLeft - fontH * 0.5 && cx <= dateRight + fontH * 0.5;
  };
  const dayXs = dayItems.map((i) => i.x + (i.w || 0) / 2);
  const dayLo = dayXs.length ? Math.min(...dayXs) - fontH : Infinity;
  const dayHi = dayXs.length ? Math.max(...dayXs) + fontH : -Infinity;
  const content = inRows.filter((i) => {
    if (LABEL_WORDS.test(i.str)) return false;
    if (near(i) || (DAY_ONLY.test(i.str) && i.x + (i.w || 0) / 2 >= dayLo && i.x + (i.w || 0) / 2 <= dayHi)) return false;
    return true;
  });
  if (!content.length) return { columns: [], reason: 'no-events' };

  // 3. Columns: grade / class headers above the first row (e.g. "שכבה י'" | "שכבה יא'").
  const headerItems = items.filter((i) => i.y > top && i.y < top + fontH * 8 && !near(i) && !DAY_ONLY.test(i.str));
  const contentLeft = Math.min(...content.map((i) => i.x));
  const contentRight = Math.max(...content.map((i) => i.x + (i.w || 0)));
  const headerLines = chain(headerItems.filter((i) => i.x + (i.w || 0) / 2 <= contentRight + fontH && i.x + (i.w || 0) / 2 >= contentLeft - fontH), (i) => i.y, fontH * 0.5)
    .map((members) => {
      // split the line into labels where there is a real gap
      const sorted = [...members].sort((a, b) => b.x - a.x);
      const labels = [];
      for (const m of sorted) {
        const last = labels[labels.length - 1];
        if (last && last.left - (m.x + (m.w || 0)) < fontH * 1.5) {
          last.members.push(m);
          last.left = m.x;
        } else labels.push({ members: [m], left: m.x, right: m.x + (m.w || 0) });
      }
      return labels.map((l) => ({ text: joinLine(l.members, fontH), cx: (l.left + l.right) / 2 }));
    })
    .filter((labels) => labels.some((l) => !LABEL_WORDS.test(l.text)));
  const gradeLine =
    headerLines.find((ls) => ls.some((l) => GRADE_LIKE.test(l.text))) ||
    headerLines.sort((a, b) => b.length - a.length)[0] ||
    [];
  let cols = gradeLine.filter((l) => !LABEL_WORDS.test(l.text)).map((l) => ({ label: l.text, cx: l.cx }));
  if (!cols.length) cols = [{ label: '', cx: (contentLeft + contentRight) / 2 }];
  cols.sort((a, b) => b.cx - a.cx); // right to left, like the sheet
  cols.forEach((c, i) => {
    c.hi = i === 0 ? Infinity : (cols[i - 1].cx + c.cx) / 2;
    c.lo = i === cols.length - 1 ? -Infinity : (c.cx + cols[i + 1].cx) / 2;
  });

  // 4. Cells → event text.
  const cells = new Map();
  for (const it of content) {
    const cx = it.x + (it.w || 0) / 2;
    const ci = cols.findIndex((c) => cx >= c.lo && cx < c.hi);
    const ri = rows.findIndex((r) => it.y <= r.top && it.y > r.bottom);
    if (ci === -1 || ri === -1) continue;
    const k = `${ci}|${ri}`;
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(it);
  }
  const columns = cols.map((c) => ({ label: tidy(c.label), events: [] }));
  for (const [k, list] of cells) {
    const [ci, ri] = k.split('|').map(Number);
    const lines = chain(list, (i) => i.y, fontH * 0.55).map((g) => joinLine(g, fontH));
    const text = lines.join(' ').replace(/\s+/g, ' ').trim();
    if (text) columns[ci].events.push({ date: rows[ri].iso, text });
  }
  columns.forEach((c) => c.events.sort((a, b) => a.date.localeCompare(b.date)));
  return { columns: columns.filter((c) => c.events.length), reason: '' };
}

/** All pages; columns with the same label are merged (one table per page is common). */
export async function parseExamBoardPdf(blob) {
  const { openPdf } = await import('./pdf.js');
  const doc = await openPdf(blob);
  const byLabel = new Map();
  let reason = 'no-dates';
  for (let p = 1; p <= Math.min(doc.numPages, 30); p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items
      .filter((i) => i.str && i.str.trim())
      .map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width, h: i.height || Math.abs(i.transform[3]) }));
    if (!items.length) continue;
    const res = parseExamBoardItems(items);
    if (!res.columns.length) {
      if (reason !== '') reason = res.reason;
      continue;
    }
    reason = '';
    for (const c of res.columns) {
      const key = c.label || `עמוד ${p}`;
      if (!byLabel.has(key)) byLabel.set(key, { label: c.label, events: [] });
      byLabel.get(key).events.push(...c.events);
    }
  }
  return { columns: [...byLabel.values()], reason };
}

// ---------------------------------------------------------------- understanding one event

/** Gershayim / geresh as Hebrew marks: תנ"ך → תנ״ך, י' → י׳. */
function tidy(s) {
  return String(s || '')
    .replace(/([א-ת])["״`]{1,2}([א-ת])/g, '$1״$2')
    .replace(/([א-ת])['`](?=\s|$|[^א-ת])/g, '$1׳')
    .replace(/\s+/g, ' ')
    .trim();
}
const nk = (s) => String(s || '').replace(/["'׳״`]/g, '').replace(/[-–—_/,.:()]/g, ' ').replace(/\s+/g, ' ').trim();
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Hebrew one-letter prefixes: ב, ל, ה, ו, מ, ש, כ and pairs (וב, של, מה…)
const PRE = '(?:[ושכ]?[בלהמ]?)';
const wordRe = (term) => new RegExp(`(?:^|\\s)${PRE}${nk(term).split(' ').map(reEsc).join('\\s+')}(?=\\s|$)`);

// Two-word names whose first word alone is a different subject (חינוך ≠ חינוך תעבורתי).
const COMPOUNDS = ['חינוך תעבורתי', 'חינוך גופני', 'חינוך פיננסי', 'מחשבת ישראל', 'מדעי המחשב', 'מדעי החברה', 'לשון והבעה', 'תורה שבעל פה', 'ניו מדיה'];
// Names a board might use for the same subject.
const ALIASES = [
  ['תנך', 'מקרא'],
  ['לשון', 'הבעה', 'לשון והבעה'],
  ['הנדסה', 'הנדסת', 'הנדסיות', 'הנדסי', 'הנדסית'],
  ['גאוגרפיה', 'גיאוגרפיה'],
  ['אמנות', 'אומנות'],
  ['מוזיקה', 'מוסיקה'],
  ['מדעי המחשב', 'מדמח', 'מחשבים'],
  ['ספורט', 'חינוך גופני', 'חנג'],
];
// Subjects a board may mention, for naming one you don't have yet.
const KNOWN = [
  'מתמטיקה', 'אנגלית', 'לשון', 'ספרות', 'היסטוריה', 'תנ״ך', 'אזרחות', 'ביולוגיה', 'פיזיקה', 'כימיה', 'מדעי המחשב',
  'ערבית', 'גאוגרפיה', 'מדעים', 'מחשבת ישראל', 'חינוך תעבורתי', 'חינוך גופני', 'צרפתית', 'ספרדית', 'רוסית', 'אמנות',
  'מוזיקה', 'תיאטרון', 'קולנוע', 'תקשורת', 'פסיכולוגיה', 'סוציולוגיה', 'כלכלה', 'משפטים', 'אלקטרוניקה', 'רובוטיקה',
  'ביוטכנולוגיה', 'סייבר', 'אדריכלות', 'ניו מדיה', 'תלמוד', 'יהדות', 'מדעי החברה', 'בריאות', 'מקרא', 'הנדסה',
];
const KNOWN_TERMS = { 'הנדסה': ['הנדסה', 'הנדסיות', 'הנדסית', 'הנדסת'], 'תנ״ך': ['תנך', 'מקרא'] };

/** Search terms for one of the student's subjects. */
function termsFor(name) {
  const n = nk(name);
  const terms = new Set([n]);
  const first = n.split(' ')[0];
  if (first.length >= 4 && first !== n && !['חינוך', 'מגמה', 'מגמת', 'הנדסת', 'מדעי'].includes(first)) terms.add(first);
  for (const group of ALIASES) if (group.some((g) => n === g || n.startsWith(`${g} `) || first === g)) group.forEach((g) => terms.add(g));
  return [...terms];
}

function matches(text, term, fullName) {
  const re = wordRe(term);
  const m = re.exec(text);
  if (!m) return false;
  // "חינוך" must not match "חינוך תעבורתי" unless that IS the subject.
  if (!term.includes(' ')) {
    const after = text.slice(m.index + m[0].length).trim().split(' ')[0] || '';
    const pair = `${term} ${after}`;
    if (COMPOUNDS.includes(pair) && nk(fullName) !== pair && !nk(fullName).startsWith(pair)) return false;
  }
  return true;
}

const TYPES = [
  [/בגרות/, 'בגרות'],
  [/מתכונת/, 'מתכונת'],
  [/מבחן|שיפור ציון|מועד ב/, 'מבחן'],
  [/בוחן|מבדק|בחינה/, 'בוחן'],
  [/הערכה חלופית|עבודה|פרויקט|עבודת חקר/, 'עבודה'],
  [/הגשה/, 'הגשה'],
  [/בעל פה|בע"פ/, 'בעל פה'],
];

/**
 * One event text (may hold several, joined by "+") → assessments.
 * [{ title, type, week, subjectId, detected }] — non-exam events are dropped.
 */
export function understand(text) {
  const out = [];
  for (const partRaw of String(text).split(/\s*[+;]\s*/)) {
    let part = partRaw.trim();
    if (!part) continue;
    let week = false;
    const wk = part.match(/^(בשבוע זה|השבוע|במהלך השבוע)\s*[:\-–]?\s*/);
    if (wk) {
      week = true;
      part = part.slice(wk[0].length);
    }
    const full = nk(part);
    const type = TYPES.find(([re]) => re.test(full))?.[1];
    if (!type) continue; // holidays, "שבת שלום", elections…
    // "ללא הנדסיות" = everyone EXCEPT engineering: don't match the excluded subject.
    const n = full.replace(/(?:^|\s)(?:ללא|בלי|חוץ מ|לא כולל)\s+\S+/g, ' ').replace(/\s+/g, ' ').trim();
    let subjectId = '';
    let best = 0;
    for (const s of S.data.subjects) {
      for (const t of termsFor(s.name)) {
        if (t.length > best && matches(n, t, s.name)) {
          best = t.length;
          subjectId = s.id;
        }
      }
    }
    let detected = '';
    if (!subjectId) {
      const sorted = [...KNOWN].sort((a, b) => b.length - a.length);
      for (const k of sorted) {
        const terms = KNOWN_TERMS[k] || [k];
        if (terms.some((t) => matches(n, t, k))) {
          detected = k;
          break;
        }
      }
    }
    const track = /מגמ/.test(full) && !subjectId; // "מבחן מגמות גוש א" — which track is yours?
    out.push({ title: tidy(part.replace(/^[-–\s]+|[-–\s]+$/g, '')), type, week, subjectId, detected: track && !detected ? '' : detected, track });
  }
  return out;
}

// ---------------------------------------------------------------- import UI

function buildRows(column) {
  const today = isoDate();
  const rows = [];
  for (const ev of column.events) {
    for (const a of understand(ev.text)) {
      const exists = S.data.exams.some(
        (e) => e.date === ev.date && ((a.subjectId && e.subjectId === a.subjectId) || nk(e.title) === nk(a.title))
      );
      const past = ev.date < today && daysUntil(ev.date) < (a.week ? -6 : 0);
      const group = exists || past ? 'done' : a.subjectId ? 'mine' : a.detected ? 'other' : 'unknown';
      rows.push({ ...a, date: ev.date, exists, past, group, on: group === 'mine', pick: a.subjectId || (a.detected ? `new:${a.detected}` : '') });
    }
  }
  return rows;
}

const GROUPS = [
  ['mine', 'במקצועות שלך', ''],
  ['unknown', 'לא ברור לאיזה מקצוע', 'למשל מבחני מגמות. בוחרים את המקצוע, והמבחן יסומן להוספה.'],
  ['other', 'מקצועות שאין לך', 'אם בכל זאת לומדים את זה, מסמנים ונוסף גם המקצוע.'],
  ['done', 'כבר עברו או כבר ברשימה', ''],
];

function subjectSelect(r, i) {
  const opts = [`<option value="">בלי מקצוע</option>`];
  for (const s of S.data.subjects) opts.push(`<option value="${s.id}"${r.pick === s.id ? ' selected' : ''}>${esc(s.name)}</option>`);
  if (r.detected && !S.data.subjects.some((s) => nk(s.name) === nk(r.detected))) {
    opts.push(`<option value="new:${esc(r.detected)}"${r.pick === `new:${r.detected}` ? ' selected' : ''}>＋ ${esc(r.detected)} (מקצוע חדש)</option>`);
  }
  return `<select class="board-subj" data-i="${i}" data-f="pick" aria-label="מקצוע">${opts.join('')}</select>`;
}

const MONTH = new Intl.DateTimeFormat('he-IL', { month: 'short' });
const addLabel = (n) => (n === 1 ? 'הוספת מבחן אחד' : n ? `הוספת ${n} מבחנים` : 'לא נבחרו מבחנים');

function rowHTML(r, i) {
  const d = new Date(`${r.date}T12:00:00`);
  return `<div class="board-row${r.on ? ' on' : ''}">
    <input type="checkbox" data-i="${i}" data-f="on" ${r.on ? 'checked' : ''} aria-label="להוסיף">
    <span class="board-date"><b>${d.getDate()}</b><small>${MONTH.format(d)}</small></span>
    <span class="grow">
      <span class="board-title">${esc(r.title)}</span>
      <span class="sr-sub">${esc(r.type)}${r.week ? ' · במהלך השבוע' : ''}${r.exists ? ' · כבר ברשימה' : r.past ? ' · עבר' : ''}</span>
      ${subjectSelect(r, i)}
    </span>
  </div>`;
}

function bodyHTML(state) {
  const col = state.columns[state.col];
  const rows = state.rows;
  const chips =
    state.columns.length > 1
      ? `<p class="small"><b>באיזו שכבה / כיתה את/ה?</b></p>
         <div class="chip-wrap">${state.columns
           .map((c, i) => `<button class="chip-btn${i === state.col ? ' on' : ''}" data-col="${i}">${esc(c.label || `טבלה ${i + 1}`)}</button>`)
           .join('')}</div>`
      : col.label
      ? `<p class="muted small">${esc(col.label)}</p>`
      : '';
  const groups = GROUPS.map(([g, title, hint]) => {
    const idx = rows.map((r, i) => (r.group === g ? i : -1)).filter((i) => i !== -1);
    if (!idx.length) return '';
    const inner = `${hint ? `<p class="muted small">${hint}</p>` : ''}<div class="card list board-list">${idx.map((i) => rowHTML(rows[i], i)).join('')}</div>`;
    return g === 'done'
      ? `<details class="board-group"><summary>${title} (${idx.length})</summary>${inner}</details>`
      : `<div class="board-group"><h4 class="group-title">${title} (${idx.length})</h4>${inner}</div>`;
  }).join('');
  const n = rows.filter((r) => r.on).length;
  return `${chips}
    ${rows.length ? groups : `<p class="muted center">לא מצאתי מבחנים בטבלה הזו.</p>`}
    <button class="btn primary block board-go" data-board-go ${n ? '' : 'disabled'}>${addLabel(n)}</button>`;
}

function saveRows(state) {
  let added = 0;
  for (const r of state.rows.filter((x) => x.on)) {
    let subjectId = r.pick || '';
    if (subjectId.startsWith('new:')) subjectId = ensureSubject(subjectId.slice(4));
    if (S.data.exams.some((e) => e.date === r.date && ((subjectId && e.subjectId === subjectId && e.type === r.type) || nk(e.title) === nk(r.title)))) continue;
    S.data.exams.push({
      id: uid(), subjectId, title: r.title, type: r.type, date: r.date, time: '', topics: [], grade: '',
      notes: r.week ? `מתישהו במהלך השבוע שמתחיל ב-${fmtDate(r.date)}` : '',
      ...(r.week ? { week: true } : {}),
      source: 'board', createdAt: Date.now(),
    });
    added++;
  }
  const label = state.columns[state.col]?.label;
  if (label) S.data.profile.grade = label;
  save();
  return added;
}

/** Read a לוח מבחנים PDF, preview, then add the chosen exams. */
export async function importExamBoard(file, preParsed = null) {
  if (!file && !preParsed) return;
  let res = preParsed;
  if (!res) {
    const close = openSheet(`<div class="progress-sheet"><div class="spinner" aria-hidden="true"></div><p>קורא את לוח המבחנים…</p></div>`);
    try {
      res = await parseExamBoardPdf(file);
    } catch {
      close();
      toast('לא הצלחתי לפתוח את הקובץ. בטוח שזה PDF?', 6000);
      return;
    }
    close();
  }
  if (!res.columns.length) {
    const why =
      res.reason === 'no-text'
        ? 'ב-PDF הזה אין טקסט, רק תמונה (למשל צילום שנשמר כ-PDF), ולכן אי אפשר לקרוא ממנו.'
        : 'לא מצאתי בקובץ טבלה של תאריכים ומבחנים.';
    setTimeout(
      () =>
        openSheet(`<h3 class="sheet-title">לא הצלחתי לקרוא את לוח המבחנים</h3><p class="center">${why}</p>
          <p class="muted small center">אפשר להוסיף מבחנים ידנית, או להדביק את הטבלה בייבוא מוובטופ (הגדרות ← חיבורים).</p>
          <button class="btn ghost block" data-close>סגירה</button>`),
      260
    );
    return;
  }
  // Pre-select the grade the student picked last time.
  const saved = S.data.profile.grade;
  const state = { columns: res.columns, col: Math.max(0, res.columns.findIndex((c) => c.label && c.label === saved)), rows: [] };
  state.rows = buildRows(state.columns[state.col]);
  setTimeout(
    () =>
      openSheet(
        `<div class="sheet-head"><button type="button" class="link-btn" data-close>ביטול</button><h3>לוח מבחנים</h3><span></span></div>
         <div class="board-body">${bodyHTML(state)}</div>`,
        {
          tall: true,
          onMount(sheet, close) {
            const body = sheet.querySelector('.board-body');
            const redraw = () => {
              const open = [...body.querySelectorAll('details[open]')].length > 0;
              body.innerHTML = bodyHTML(state);
              if (open) body.querySelector('details')?.setAttribute('open', '');
            };
            const updateBtn = () => {
              const n = state.rows.filter((r) => r.on).length;
              const b = body.querySelector('[data-board-go]');
              b.disabled = !n;
              b.textContent = addLabel(n);
            };
            body.addEventListener('change', (ev) => {
              const el = ev.target;
              if (el.dataset.i == null) return;
              const r = state.rows[+el.dataset.i];
              if (el.dataset.f === 'on') r.on = el.checked;
              else {
                r.pick = el.value;
                if (el.value && !r.on && r.group !== 'done') {
                  r.on = true;
                  const box = el.closest('.board-row').querySelector('input[type=checkbox]');
                  box.checked = true;
                }
              }
              el.closest('.board-row')?.classList.toggle('on', r.on);
              updateBtn();
            });
            body.addEventListener('click', (ev) => {
              const chip = ev.target.closest('[data-col]');
              if (chip) {
                state.col = +chip.dataset.col;
                state.rows = buildRows(state.columns[state.col]);
                redraw();
                return;
              }
              if (ev.target.closest('[data-board-go]')) {
                const added = saveRows(state);
                close();
                go('#exams');
                toast(added === 1 ? 'נוסף מבחן אחד מלוח המבחנים 🎉' : added ? `נוספו ${added} מבחנים מלוח המבחנים 🎉` : 'הכל כבר היה ברשימה', 4000);
              }
            });
          },
        }
      ),
    260
  );
}

export const boardButton = (cls, label) =>
  `<label class="${cls}" aria-label="ייבוא לוח מבחנים מ-PDF">${label}<input type="file" accept="application/pdf,.pdf" data-board-pdf hidden></label>`;
