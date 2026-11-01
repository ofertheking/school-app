// Recovery: finds tasks / exams / notes that still exist in an older copy on this
// device (automatic daily snapshot, another school year, a leftover localStorage
// copy) but are missing from the current data — and brings them back.
import { S, save, subject, ensureSubject } from './core.js';
import { loadState, listStateKeys, localCopies } from './store.js';
import { esc, fmtDate } from './util.js';
import { ICON } from './icons.js';
import { tile } from './components.js';
import { openSheet, toast, closeAllSheets } from './ui.js';
import { rerender } from './router.js';

// What gets restored. Lessons are left out on purpose: an older timetable would
// duplicate the one imported since. Subjects come back only when a record needs one.
const KINDS = [
  ['tasks', 'משימות', 'משימה אחת'],
  ['exams', 'מבחנים', 'מבחן אחד'],
  ['items', 'סיכומים ודפים', 'סיכום אחד'],
  ['sessions', 'שעות למידה', 'שעת למידה אחת'],
  ['decks', 'חפיסות', 'חפיסה אחת'],
  ['cards', 'כרטיסיות', 'כרטיסייה אחת'],
];

let cache = null; // { sources, at }

function missingIn(data) {
  const res = {};
  let total = 0;
  for (const [k] of KINDS) {
    const have = new Set((S.data[k] || []).map((x) => x.id));
    const list = (Array.isArray(data?.[k]) ? data[k] : []).filter((x) => x && x.id && !have.has(x.id));
    res[k] = list;
    total += list.length;
  }
  return { res, total, te: res.tasks.length + res.exams.length };
}

const yearName = (id) => S.data.years.find((y) => y.id === id)?.name || '';

/** Every older copy on the device, with what it has that the current data lacks. */
export async function scan() {
  const sources = [];
  const add = (src, data) => {
    const m = missingIn(data);
    const size = (data?.tasks?.length || 0) + (data?.exams?.length || 0);
    if (m.total) sources.push({ ...src, data, ...m, size });
  };
  for (const key of await listStateKeys()) {
    if (key === 'state') continue;
    let data;
    try {
      data = await loadState(key);
    } catch {
      continue;
    }
    if (!data) continue;
    if (key.startsWith('snap:')) {
      const otherYear = data.currentYear && data.currentYear !== S.data.currentYear;
      // A snapshot of another year that still exists: that year's own archive is newer — use it.
      if (otherYear && yearName(data.currentYear)) continue;
      add({ key, type: 'snap', label: `גיבוי אוטומטי מ${fmtDate(key.slice(5))}`, prio: 0, sort: key }, data);
    } else if (key.startsWith('year:')) {
      const id = key.slice(5);
      const known = S.data.years.some((y) => y.id === id);
      if (id === S.data.currentYear) add({ key, type: 'year-self', label: 'עותק קודם של השנה הנוכחית', prio: 1, sort: key }, data);
      else add({ key, type: known ? 'year' : 'year-gone', yearId: id, label: !known ? 'שנה שנמחקה מהרשימה' : yearName(id) === yearName(S.data.currentYear) ? `שנת ${yearName(id)} המקורית` : `שנת ${yearName(id)}`, prio: known ? 3 : 2, sort: key }, data);
    }
  }
  for (const c of localCopies()) {
    add({ key: `local:${c.key}`, type: 'local', label: 'עותק שנשמר בזיכרון של הדפדפן', prio: 4, sort: c.key }, c.data);
  }
  sources.sort((a, b) => b.prio - a.prio || b.sort.localeCompare(a.sort));
  cache = { sources, at: Date.now() };
  return sources;
}

const dismissed = () => (S.data.settings.recoverDismissed ||= []);
const dismissKey = (s) => `${s.key}:${s.total}`;

/** The one source worth suggesting on the home screen, if any (a real loss, not a single deleted task). */
function hintSource() {
  if (!cache || !S.loaded) return null;
  const curTE = S.data.tasks.length + S.data.exams.length;
  const curYear = S.data.years.find((y) => y.id === S.data.currentYear);
  const newYear = !curYear?.createdAt || Date.now() - curYear.createdAt < 30 * 86400000;
  return (
    cache.sources.find((s) => {
      if (dismissed().includes(dismissKey(s))) return false;
      if (s.type === 'local') return s.te > 0;
      if (s.type === 'year') return curTE <= 2 && s.size >= 3 && newYear;
      return s.te >= 3 && s.te >= s.size * 0.5;
    }) || null
  );
}

function countsText(s) {
  return KINDS.filter(([k]) => s.res[k].length)
    .map(([k, many, one]) => (s.res[k].length === 1 ? one : `${s.res[k].length} ${many}`))
    .join(' · ');
}

/** Home-screen card: offers to bring back what disappeared. */
export function recoverCard() {
  const s = hintSource();
  if (!s) return '';
  const isYear = s.type === 'year';
  return `<div class="card recover-card">
    <div class="recover-head">${tile('sync', 'orange')}<b>${isYear ? `המשימות והמבחנים נמצאים ב${esc(s.label)}` : 'מצאתי דברים שנעלמו'}</b></div>
    <p class="muted small">${
      isYear
        ? `השנה שפתוחה עכשיו כמעט ריקה, וב${esc(s.label)} יש ${countsText(s)}. שום דבר לא נמחק.`
        : `ב${esc(s.label)} יש ${countsText(s)} שלא מופיעים עכשיו.`
    }</p>
    <div class="row gap">
      ${
        isYear
          ? `<button class="btn primary grow" data-act="year-switch" data-id="${s.yearId}">חזרה ל${esc(s.label)}</button>`
          : `<button class="btn primary grow" data-act="recover-apply" data-key="${esc(s.key)}">להחזיר הכל</button>`
      }
      <button class="btn ghost" data-act="recover-dismiss" data-key="${esc(s.key)}">לא צריך</button>
    </div>
  </div>`;
}

function sheetHTML(sources) {
  const rows = sources
    .map(
      (s) => `<div class="recover-row">
        <div class="grow"><b>${esc(s.label)}</b><span class="sr-sub">${countsText(s)}</span>
          ${s.res.tasks.length ? `<span class="sr-sub recover-peek">${s.res.tasks.slice(0, 4).map((t) => esc(t.title || '')).join(' · ')}${s.res.tasks.length > 4 ? ' …' : ''}</span>` : ''}
        </div>
        <div class="recover-btns">
          ${s.type === 'year' ? `<button class="btn tinted sm" data-act="year-switch" data-id="${s.yearId}">מעבר לשנה</button>` : ''}
          <button class="btn ${s.type === 'year' ? 'ghost' : 'primary'} sm" data-act="recover-apply" data-key="${esc(s.key)}">${s.type === 'year' ? 'העתקה לכאן' : 'להחזיר'}</button>
        </div>
      </div>`
    )
    .join('');
  return `<div class="sheet-head"><button type="button" class="link-btn" data-close>סגירה</button><h3>שחזור דברים שנעלמו</h3><span></span></div>
    ${
      sources.length
        ? `<p class="muted small">אלה עותקים קודמים שנמצאו במכשיר. "להחזיר" מוסיף רק את מה שחסר עכשיו — שום דבר קיים לא נמחק ולא משתכפל.</p>
           <div class="card list">${rows}</div>`
        : `<div class="card"><p><b>לא מצאתי במכשיר עותק אחר עם דברים שחסרים.</b></p>
           <p class="muted small">בדוק/י שני דברים:</p>
           <ol class="steps small">
             <li>באייפון, האפליקציה מהמסך הבית וספארי שומרות נתונים <b>בנפרד</b>. אם השתמשת קודם בספארי (או להפך), פתח/י שם, הגדרות ← ייצוא גיבוי, ואז כאן: שחזור מגיבוי.</li>
             <li>אם ייצאת פעם גיבוי (למשל ל-iCloud Drive), אפשר לשחזר ממנו בהגדרות ← שחזור מגיבוי.</li>
           </ol></div>`
    }
    <p class="muted small center">מעכשיו האפליקציה שומרת לבד עותק כל יום (10 הימים האחרונים), כך שתמיד יהיה ממה לשחזר.</p>`;
}

export async function openRecover() {
  const close = openSheet(`<div class="progress-sheet"><div class="spinner" aria-hidden="true"></div><p>מחפש עותקים קודמים במכשיר…</p></div>`);
  const sources = await scan();
  close();
  setTimeout(() => openSheet(sheetHTML(sources), { tall: true }), 260);
}

/** Add back everything the source has that's missing now. Returns how many records. */
async function restore(key) {
  const src = (cache?.sources || []).find((s) => s.key === key) || (await scan()).find((s) => s.key === key);
  if (!src) return 0;
  const { res } = missingIn(src.data); // recompute against the data as it is right now
  const subjMap = new Map();
  const mapSubject = (sid) => {
    if (!sid || subject(sid)) return sid || '';
    if (!subjMap.has(sid)) {
      const s = (src.data.subjects || []).find((x) => x.id === sid);
      subjMap.set(sid, s ? ensureSubject(s.name) : '');
    }
    return subjMap.get(sid);
  };
  let n = 0;
  for (const [k] of KINDS) {
    for (const rec of res[k]) {
      const copy = JSON.parse(JSON.stringify(rec));
      if ('subjectId' in copy) copy.subjectId = mapSubject(copy.subjectId);
      S.data[k].push(copy);
      n++;
    }
  }
  save();
  return n;
}

export const actions = {
  'recover-open': () => openRecover(),
  async 'recover-apply'({ key }) {
    const n = await restore(key);
    closeAllSheets();
    await scan();
    rerender();
    toast(n === 1 ? 'הוחזר פריט אחד ✔︎' : n ? `הוחזרו ${n} פריטים ✔︎` : 'אין מה להחזיר — הכל כבר כאן', 4000);
  },
  'recover-dismiss'({ key }) {
    const s = cache?.sources.find((x) => x.key === key);
    if (s) dismissed().push(dismissKey(s));
    save();
    rerender();
  },
};
