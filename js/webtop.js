// Webtop: automatic sync through the user's own Cloudflare Worker (webtop-worker.js),
// plus the copy-paste importer as a fallback.
import { S, save, saveNow, ensureSubject } from './core.js';
import { esc, uid, isoDate, parseISO, addDays, fmtDateTime, pad } from './util.js';
import { openSheet, toast } from './ui.js';
import { ICON } from './icons.js';
import { rerender } from './router.js';

const EXAM_RE = /מבחן|בוחן|בחינה|מתכונת|בגרות|quiz|test|exam/i;

// ---------------------------------------------------------------- parsing helpers

/** Webtop dates come as ISO, dd/mm/yyyy, /Date(ms)/ or epoch ms. */
export function toISODate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v > 1e11 ? isoDate(new Date(v)) : null;
  const s = String(v).trim();
  let m = s.match(/\/Date\((\d+)/);
  if (m) return isoDate(new Date(+m[1]));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
  if (m) {
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    return `${y}-${pad(+m[2])}-${pad(+m[1])}`;
  }
  return null;
}

const timeOf = (v) => {
  const m = String(v ?? '').match(/(\d{1,2}):(\d{2})/);
  return m ? `${pad(+m[1])}:${m[2]}` : '';
};

/** Visit every object, passing the scalars inherited from its ancestors. */
function walk(node, cb, ctx = {}, depth = 0) {
  if (node == null || depth > 12) return;
  if (Array.isArray(node)) {
    node.forEach((n) => walk(n, cb, ctx, depth + 1));
    return;
  }
  if (typeof node !== 'object') return;
  const own = {};
  for (const [k, v] of Object.entries(node)) if (v == null || typeof v !== 'object') own[k] = v;
  const here = { ...ctx, ...own };
  cb(own, here);
  for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, cb, here, depth + 1);
}

/** First non-empty value whose key matches one of the patterns (in priority order). */
function pick(obj, patterns) {
  for (const re of patterns) {
    for (const [k, v] of Object.entries(obj)) {
      if (re.test(k) && v != null && v !== '' && typeof v !== 'object') return v;
    }
  }
  return undefined;
}

const SUBJECT_KEYS = [/^subjectName$/i, /^subject$/i, /^lessonName$/i, /^professionName$/i, /^profession$/i, /^courseName$/i, /subject.*name/i, /^title$/i, /^name$/i];
const TEXT_KEYS = [/^home.?work(text|description)?$/i, /^description$/i, /^content$/i, /^text$/i, /^details$/i, /^remark$/i, /^note$/i, /^task$/i, /^assignment$/i];
const DATE_KEYS = [/^(due|submit|to)Date$/i, /^homeworkDate$/i, /^date$/i, /^lessonDate$/i, /date/i];
const DAY_KEYS = [/^(day|dayIndex|dayNum|dayNumber|dayOfWeek|weekDay|dayInWeek)$/i];
const PERIOD_KEYS = [/^(hour|hourNum|hourNumber|hourIndex|period|lessonNum|lessonNumber|lessonIndex|lessonHour)$/i];
const START_KEYS = [/^(start|startTime|fromTime|from|beginTime|hourStart|startHour)$/i, /start/i];
const END_KEYS = [/^(end|endTime|toTime|to|finishTime|hourEnd|endHour)$/i, /end/i];
const TEACHER_KEYS = [/^teacherName$/i, /teacher/i];
const ROOM_KEYS = [/^(room|roomName|classRoom|classroom|location|place)$/i, /room/i];

const cleanStr = (v) => String(v ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const isName = (v) => typeof v === 'string' && cleanStr(v).length >= 2 && cleanStr(v).length <= 60 && !/^\d+$/.test(v);

export function parseWebtop(resp) {
  const lessons = [];
  const homework = [];
  const exams = [];

  // --- timetable ---
  const rawLessons = [];
  for (const week of resp.schedule || []) {
    walk(week.data, (own, ctx) => {
      const subj = pick(own, SUBJECT_KEYS);
      if (!isName(subj)) return;
      const dateIso = toISODate(pick(ctx, DATE_KEYS));
      const dayRaw = pick(ctx, DAY_KEYS);
      const period = pick(ctx, PERIOD_KEYS);
      const start = timeOf(pick(ctx, START_KEYS));
      const end = timeOf(pick(ctx, END_KEYS));
      if (dateIso == null && dayRaw == null) return;
      if (period == null && !start) return;
      rawLessons.push({
        week: week.weekIndex || 0, dateIso, dayRaw: dayRaw == null ? null : +dayRaw,
        period: period == null || isNaN(+period) ? null : +period, start, end,
        subject: cleanStr(subj), teacher: cleanStr(pick(own, TEACHER_KEYS) ?? pick(ctx, TEACHER_KEYS) ?? ''),
        room: cleanStr(pick(own, ROOM_KEYS) ?? ''),
        flag: Object.values(own).find((v) => typeof v === 'string' && EXAM_RE.test(v)) || '',
      });
    });
  }
  // Day numbers: 0-based if any 0 appears, otherwise 1 = Sunday.
  const zeroBased = rawLessons.some((l) => l.dayRaw === 0);
  const firstWeek = Math.min(...rawLessons.map((l) => l.week), 0);
  const seen = new Set();
  for (const l of rawLessons) {
    const day = l.dateIso ? parseISO(l.dateIso).getDay() : zeroBased ? l.dayRaw : l.dayRaw - 1;
    if (!(day >= 0 && day <= 6)) continue;
    if (l.flag && l.dateIso) {
      const flag = cleanStr(l.flag);
      exams.push({ date: l.dateIso, subject: l.subject, title: flag === l.subject ? l.subject : `${flag} ב${l.subject}`.slice(0, 80) });
    }
    if (l.week !== firstWeek) continue; // the weekly template comes from one week
    const key = `${day}|${l.period ?? l.start}|${l.subject}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lessons.push({ day, period: l.period, start: l.start, end: l.end, subject: l.subject, teacher: l.teacher, room: l.room });
  }

  // --- homework (+ anything that looks like an exam) ---
  walk(resp.homework, (own, ctx) => {
    const text = cleanStr(pick(own, TEXT_KEYS));
    if (text.length < 2) return;
    const subject = cleanStr(pick(own, SUBJECT_KEYS) ?? pick(ctx, SUBJECT_KEYS) ?? '');
    const date = toISODate(pick(own, DATE_KEYS) ?? pick(ctx, DATE_KEYS));
    if (EXAM_RE.test(text) && date) exams.push({ date, subject, title: text.slice(0, 80) });
    else homework.push({ date, subject, text });
  });
  walk(resp.dashboard, (own, ctx) => {
    const strings = Object.values(own).filter((v) => typeof v === 'string');
    if (!strings.some((v) => EXAM_RE.test(v))) return;
    const date = toISODate(pick(own, DATE_KEYS) ?? pick(ctx, DATE_KEYS));
    if (!date) return;
    const subject = cleanStr(pick(own, SUBJECT_KEYS) ?? '');
    const title = cleanStr(pick(own, TEXT_KEYS) ?? strings.find((v) => EXAM_RE.test(v)) ?? subject);
    exams.push({ date, subject, title: title.slice(0, 80) });
  });
  return { lessons, homework, exams };
}

/** Structure of the response with personal values hidden — safe to share for debugging. */
export function shapeOf(v, depth = 0) {
  if (depth > 7) return '…';
  if (Array.isArray(v)) return v.length ? [shapeOf(v[0], depth + 1), ...(v.length > 1 ? [`…${v.length} items`] : [])] : [];
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = shapeOf(x, depth + 1);
    return o;
  }
  if (typeof v === 'string') return timeOf(v) && v.length <= 8 ? 'HH:MM' : toISODate(v) ? 'DATE' : `text(${v.length})`;
  if (typeof v === 'number') return Math.abs(v) < 100 ? v : 'num';
  return v;
}

function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Merge parsed Webtop data into the app. Returns counters. */
export function mergeWebtop(parsed) {
  const c = { lessons: 0, tasks: 0, exams: 0 };
  const today = isoDate();
  const oldest = isoDate(addDays(new Date(), -14));

  if (parsed.lessons.length) {
    // Webtop is the source of truth: drop old Webtop lessons and manual ones in the same slot.
    const sameSlot = (a, b) => a.day === b.day && ((a.period != null && a.period === b.period) || (a.start && a.start === b.start));
    S.data.lessons = S.data.lessons.filter(
      (l) => l.source !== 'webtop' && !parsed.lessons.some((p) => sameSlot(p, l))
    );
    for (const l of parsed.lessons) {
      S.data.lessons.push({
        id: uid(), source: 'webtop', day: l.day, period: l.period, start: l.start, end: l.end,
        subjectId: ensureSubject(l.subject), title: l.subject, teacher: l.teacher, room: l.room,
      });
      c.lessons++;
    }
  }

  for (const h of parsed.homework) {
    if (h.date && h.date < oldest) continue;
    const extId = `wt-${hash(`${h.date}|${h.subject}|${h.text}`)}`;
    if (S.data.tasks.some((t) => t.extId === extId)) continue;
    const future = h.date && h.date >= today;
    S.data.tasks.push({
      id: uid(), extId, source: 'webtop', subjectId: ensureSubject(h.subject), title: h.text.slice(0, 140),
      notes: h.text.length > 140 ? h.text : future || !h.date ? '' : `ניתן ב-${h.date.split('-').reverse().join('/')}`,
      due: future ? h.date : '', done: false, doneAt: null, createdAt: Date.now(),
    });
    c.tasks++;
  }

  for (const e of parsed.exams) {
    if (e.date < today) continue;
    const extId = `wtx-${hash(`${e.date}|${e.subject}|${e.title}`)}`;
    if (S.data.exams.some((x) => x.extId === extId)) continue;
    S.data.exams.push({
      id: uid(), extId, source: 'webtop', subjectId: ensureSubject(e.subject), title: e.title || 'מבחן',
      type: /בוחן|quiz/i.test(e.title) ? 'בוחן' : /בגרות/.test(e.title) ? 'בגרות' : 'מבחן',
      date: e.date, time: '', topics: [], notes: '', grade: '', createdAt: Date.now(),
    });
    c.exams++;
  }
  save();
  return c;
}

// ---------------------------------------------------------------- sync

function explain(j, e) {
  if (e instanceof TypeError) return 'השרת לא עונה. בודקים שהכתובת נכונה ושיש אינטרנט.';
  if (j?.error === 'login') return `וובטופ דחה את הכניסה: ${j.message || 'שם משתמש או סיסמה לא נכונים'}`;
  if (j?.error === 'origin') return 'השרת מוגדר לכתובת אחרת. מעתיקים את קוד השרת מחדש ומדביקים ב-Cloudflare.';
  if (j?.error === 'missing_credentials') return 'חסרים שם משתמש או סיסמה';
  return `שגיאה: ${j?.message || e?.message || 'לא ידוע'}`;
}

export async function runWebtopSync() {
  const w = S.data.settings.webtop;
  if (!w.url || !w.user || !w.pass) return openWebtopSetup();
  const close = openSheet(`<div class="progress-sheet"><div class="spinner" aria-hidden="true"></div><p>מתחבר לוובטופ…</p></div>`);
  let j = null;
  try {
    const res = await fetch(w.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: w.user, password: w.pass }),
    });
    j = await res.json();
    if (!j.ok) throw new Error(j.error);
    S.ui.webtopShape = JSON.stringify(
      { loginKeys: j.loginKeys, classCode: j.classCode != null, classNumber: j.classNumber != null, notes: j.notes,
        homework: shapeOf(j.homework), schedule: shapeOf(j.schedule), dashboard: shapeOf(j.dashboard) },
      null,
      1
    );
    const parsed = parseWebtop(j);
    const c = mergeWebtop(parsed);
    w.lastSync = Date.now();
    w.name = j.profile?.firstName || w.name;
    saveNow();
    close();
    rerender();
    const found = c.lessons + c.tasks + c.exams;
    toast(
      found || parsed.homework.length
        ? `וובטופ ✔︎ ${c.lessons} שיעורים במערכת · ${c.tasks} משימות חדשות · ${c.exams} מבחנים חדשים`
        : 'התחברתי לוובטופ, אבל לא זיהיתי נתונים. בהגדרות יש "העתקת מבנה הנתונים" — שלחו לי ואתקן.',
      7000
    );
  } catch (e) {
    close();
    rerender();
    toast(explain(j, e), 8000);
  }
}

// ---------------------------------------------------------------- UI

export function webtopCard() {
  const w = S.data.settings.webtop;
  const connected = !!(w.url && w.user && w.pass);
  return `<div class="card connect">
    <div class="connect-head"><span class="logo wt" aria-hidden="true">W</span><div><b>וובטופ (Webtop)</b><br>
      <span class="muted small">${connected ? `${w.name ? `מחובר/ת: ${esc(w.name)} · ` : ''}סנכרון אחרון: ${w.lastSync ? fmtDateTime(w.lastSync) : 'עוד לא'}` : 'מערכת שעות ושיעורי בית אוטומטית, או ייבוא בהעתק-הדבק'}</span></div></div>
    ${
      connected
        ? `<button class="btn primary block" data-act="webtop-sync">${ICON.sync} סנכרון מוובטופ</button>
           <button class="btn ghost block sm" data-act="webtop-setup">הגדרות החיבור</button>
           ${S.ui.webtopShape ? `<button class="btn ghost block sm" data-act="webtop-shape">העתקת מבנה הנתונים (בלי פרטים אישיים)</button>` : ''}`
        : `<button class="btn primary block" data-act="webtop-setup">חיבור אוטומטי לוובטופ</button>`
    }
    <button class="btn ghost block" data-act="webtop-paste">ייבוא מבחנים / משימות בהעתק-הדבק</button>
    <a class="btn ghost block sm" href="https://webtop.smartschool.co.il/" target="_blank" rel="noopener">${ICON.ext} פתיחת וובטופ</a>
  </div>`;
}

export function openWebtopSetup() {
  const w = S.data.settings.webtop;
  let code = '';
  fetch('webtop-worker.js')
    .then((r) => (r.ok ? r.text() : Promise.reject()))
    .then((t) => {
      code = t.replace('__APP_ORIGIN__', location.origin);
      const ta = document.querySelector('.worker-code');
      if (ta) ta.value = code;
    })
    .catch(() => {});

  openSheet(
    `<div class="sheet-head"><button type="button" class="link-btn" data-close>ביטול</button><h3>חיבור לוובטופ</h3><span></span></div>
     <p class="small muted">לטלפון אסור לדבר ישירות עם השרת של וובטופ, אז מקימים שרת קטן וחינמי <b>בחשבון שלך</b> ב-Cloudflare. זה חד-פעמי, בערך 5 דקות.</p>
     <ol class="setup-steps">
       <li><b>מעתיקים את קוד השרת</b>
         <button class="btn tinted block sm" data-copy-code>${ICON.clip} העתקת הקוד</button>
         <details><summary class="small">לא הועתק? הקוד כאן</summary><textarea class="worker-code" rows="5" readonly dir="ltr"></textarea></details></li>
       <li><b>פותחים חשבון חינמי ב-Cloudflare</b>
         <a class="btn ghost block sm" href="https://dash.cloudflare.com/sign-up" target="_blank" rel="noopener">${ICON.ext} dash.cloudflare.com</a></li>
       <li><b>יוצרים Worker:</b> Workers &amp; Pages ← Create ← Start with Hello World ← Deploy ← <b>Edit code</b> ← מוחקים את מה שיש ← <b>מדביקים</b> ← Deploy.
         <span class="muted small">(כדאי בספארי במצב "אתר למחשב")</span></li>
       <li><b>מעתיקים את כתובת ה-Worker</b> (נגמרת ב-<code>workers.dev</code>) ומדביקים כאן:</li>
     </ol>
     <div class="fields">
       <label class="field"><span class="field-label">כתובת השרת</span><input class="wt-url" type="url" inputmode="url" dir="ltr" placeholder="https://xxxx.workers.dev" value="${esc(w.url)}" autocapitalize="off" spellcheck="false"></label>
       <label class="field half"><span class="field-label">שם משתמש בוובטופ</span><input class="wt-user" dir="ltr" value="${esc(w.user)}" autocapitalize="off" autocomplete="username" spellcheck="false"></label>
       <label class="field half"><span class="field-label">סיסמה</span><input class="wt-pass" type="password" dir="ltr" value="${esc(w.pass)}" autocomplete="current-password"></label>
     </div>
     <p class="small muted">🔒 הסיסמה נשמרת רק בטלפון (ולא נכנסת לקובץ הגיבוי). השרת שלך רק מעביר אותה לוובטופ ולא שומר כלום. עובד עם <b>שם משתמש וסיסמה של וובטופ</b>, לא עם הזדהות אחידה.</p>
     <button class="btn primary block" data-save>שמירה וסנכרון</button>
     ${w.url || w.user ? `<button class="btn danger-ghost block sm" data-forget>ניתוק ומחיקת הסיסמה</button>` : ''}`,
    {
      tall: true,
      onMount(sheet, close) {
        sheet.querySelector('[data-copy-code]').addEventListener('click', (ev) => {
          const btn = ev.currentTarget;
          if (!code) return toast('הקוד עוד נטען… נסו שוב בעוד שנייה');
          navigator.clipboard.writeText(code).then(
            () => {
              btn.innerHTML = `${ICON.check} הועתק! עכשיו ל-Cloudflare`;
              toast('הקוד הועתק ✔︎');
            },
            () => {
              sheet.querySelector('details').open = true;
              toast('סמנו את הקוד בתיבה והעתיקו ידנית');
            }
          );
        });
        sheet.querySelector('[data-save]').addEventListener('click', () => {
          let url = sheet.querySelector('.wt-url').value.trim();
          if (url && !/^https?:\/\//.test(url)) url = `https://${url}`;
          const user = sheet.querySelector('.wt-user').value.trim();
          const pass = sheet.querySelector('.wt-pass').value;
          if (!url || !user || !pass) return toast('צריך כתובת שרת, שם משתמש וסיסמה');
          Object.assign(w, { url, user, pass });
          saveNow();
          close();
          setTimeout(runWebtopSync, 300);
        });
        sheet.querySelector('[data-forget]')?.addEventListener('click', () => {
          Object.assign(w, { url: '', user: '', pass: '', lastSync: null, name: '' });
          saveNow();
          close();
          rerender();
          toast('החיבור לוובטופ נמחק');
        });
      },
    }
  );
}

export const actions = {
  'webtop-sync': () => runWebtopSync(),
  'webtop-setup': () => openWebtopSetup(),
  async 'webtop-shape'() {
    try {
      await navigator.clipboard.writeText(S.ui.webtopShape);
      toast('הועתק ✔︎ אפשר להדביק לי בצ׳אט');
    } catch {
      openSheet(`<h3 class="sheet-title">מבנה הנתונים</h3><textarea class="paste-box" rows="12" readonly dir="ltr">${esc(S.ui.webtopShape)}</textarea><button class="btn ghost block" data-close>סגירה</button>`);
    }
  },
};

