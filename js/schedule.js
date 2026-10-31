// Weekly timetable (מערכת שעות): views + actions.
import { S, save, subjectName, subjectColor, ensureSubject } from './core.js';
import { esc, uid, isoDate, addDays, startOfDay, pad, fmtDate, DAY_LETTERS } from './util.js';
import { formSheet, openSheet, askConfirm, closeAllSheets, toast } from './ui.js';
import { parseTimetablePdf } from './pdfTimetable.js';
import { ICON } from './icons.js';
import { head, iconBtn, empty, section } from './components.js';
import { rerender } from './router.js';

export const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const SCHOOL_DAYS = [0, 1, 2, 3, 4, 5];

const byTime = (a, b) =>
  (a.start || '99').localeCompare(b.start || '99') || (a.period || 99) - (b.period || 99);

export const lessonsOn = (day) => S.data.lessons.filter((l) => l.day === day).sort(byTime);

const lessonName = (l) => (l.subjectId ? subjectName(l.subjectId) : l.title || 'שיעור');
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** 'now' | 'next' | 'done' | '' for a lesson on today's timetable. */
function lessonState(l, list, now = new Date()) {
  if (l.day !== now.getDay() || !l.start) return '';
  const t = hhmm(now);
  if (l.end && t >= l.start && t < l.end) return 'now';
  if (l.end && t >= l.end) return 'done';
  const next = list.find((x) => x.start && x.start > t);
  return next === l ? 'next' : '';
}

/** Date of the most recent occurrence of a weekday (today counts). */
function lastDateOf(day) {
  const d = startOfDay();
  return addDays(d, -((d.getDay() - day + 7) % 7));
}

/** Next date (after today) on which this subject has a lesson; falls back to a week from today. */
export function nextLessonDate(subjectId) {
  const d = startOfDay();
  for (let i = 1; i <= 7; i++) {
    const x = addDays(d, i);
    if (S.data.lessons.some((l) => l.day === x.getDay() && l.subjectId === subjectId)) return isoDate(x);
  }
  return isoDate(addDays(d, 7));
}

function lessonRow(l, list) {
  const st = lessonState(l, list);
  const time = l.start ? `<bdi>${esc(l.start)}${l.end ? `–${esc(l.end)}` : ''}</bdi>` : '';
  return `<button class="lesson-row${st ? ` ${st}` : ''}" data-act="lesson-open" data-id="${l.id}">
    <span class="lesson-num">${l.period ?? ''}</span>
    <span class="stripe" style="background:${subjectColor(l.subjectId)}"></span>
    <span class="lesson-body">
      <span class="lesson-title">${esc(lessonName(l))}${st === 'now' ? ' <span class="chip cool">עכשיו</span>' : st === 'next' ? ' <span class="chip">הבא</span>' : ''}</span>
      <span class="lesson-meta">${[time, esc(l.teacher || ''), esc(l.room || '')].filter(Boolean).join(' · ')}</span>
    </span>
  </button>`;
}

/** Home-screen card: today's lessons. */
export function todaySection() {
  if (!S.data.lessons.length) return '';
  const day = new Date().getDay();
  const list = lessonsOn(day);
  const headRow = `<button class="sum-head today-head" data-go="#schedule">${ICON.calendar} היום במערכת <span class="chev">${ICON.fwd}</span></button>`;
  if (!list.length) return `<div class="card today-card">${headRow}<p class="muted today-empty">אין שיעורים היום 🙌</p></div>`;
  return `<div class="card list today-card">${headRow}${list.map((l) => lessonRow(l, list)).join('')}</div>`;
}

export function schedulePage() {
  if (S.ui.schedDay == null) {
    const t = new Date().getDay();
    S.ui.schedDay = t === 6 ? 0 : t;
  }
  const day = S.ui.schedDay;
  const list = lessonsOn(day);
  const today = new Date().getDay();
  const chips = SCHOOL_DAYS.map(
    (d) => `<button class="day-chip${d === day ? ' on' : ''}${d === today ? ' today' : ''}" data-act="sched-day" data-day="${d}" aria-pressed="${d === day}">
      <b>${DAY_LETTERS[d]}</b><small>${S.data.lessons.filter((l) => l.day === d).length || ''}</small></button>`
  ).join('');
  const w = S.data.settings.webtop;
  return `
    ${head('מערכת שעות', { back: '#home', actions: `${pdfButton('icon-btn pdf-btn', '<b>PDF</b>')}${iconBtn('add-lesson', ICON.plus, 'הוספת שיעור')}` })}
    <div class="day-chips" role="group" aria-label="יום">${chips}</div>
    <h2 class="day-title">יום ${DAY_NAMES[day]}</h2>
    ${
      list.length
        ? `<div class="card list">${list.map((l) => lessonRow(l, list)).join('')}</div>`
        : empty(
            '🗓️',
            S.data.lessons.length ? 'אין שיעורים ביום הזה' : 'עוד אין מערכת שעות. אפשר להוסיף שיעורים ידנית, או לייבא אותם מוובטופ.',
            `<div class="row gap center-row">
              ${pdfButton('btn primary', `${ICON.clip} ייבוא מ-PDF`)}
              <button class="btn tinted" data-act="add-lesson">＋ הוספת שיעור</button>
              ${w.url ? `<button class="btn ghost" data-act="webtop-sync">${ICON.sync} סנכרון מוובטופ</button>` : `<button class="btn ghost" data-go="#more">חיבור לוובטופ</button>`}
            </div>`
          )
    }
    <p class="muted small center">לחיצה על שיעור: סיכום שיעור, שיעורי בית, עריכה</p>
    ${list.length ? `<p class="muted small center">יש לך את המערכת כ-PDF (למשל מוובטופ)? ${pdfButton('link-btn inline', 'ייבוא מ-PDF')}</p>` : ''}
  `;
}

const pdfButton = (cls, label) =>
  `<label class="${cls}" aria-label="ייבוא מערכת מ-PDF">${label}<input type="file" accept="application/pdf,.pdf" data-sched-pdf hidden></label>`;

/** Read a timetable PDF, show an editable preview, then save. */
export async function importTimetablePdf(file) {
  if (!file) return;
  const close = openSheet(`<div class="progress-sheet"><div class="spinner" aria-hidden="true"></div><p>קורא את המערכת מה-PDF…</p></div>`);
  let res;
  try {
    res = await parseTimetablePdf(file);
  } catch (e) {
    close();
    toast('לא הצלחתי לפתוח את הקובץ. בטוח שזה PDF?', 6000);
    return;
  }
  close();
  if (!res.lessons.length) {
    const why =
      res.reason === 'no-text'
        ? 'ב-PDF הזה אין טקסט, רק תמונה (למשל צילום מסך שנשמר כ-PDF), ולכן אי אפשר לקרוא ממנו.'
        : res.reason === 'no-days'
        ? 'לא מצאתי בקובץ את שמות הימים (ראשון, שני…), ולכן לא הצלחתי להבין איפה כל יום.'
        : 'מצאתי את הימים, אבל לא הצלחתי לשייך שיעורים לשעות.';
    setTimeout(
      () =>
        openSheet(`<h3 class="sheet-title">לא הצלחתי לקרוא את המערכת</h3><p class="center">${why}</p>
          <p class="muted small center">אפשר להוסיף שיעורים ידנית, או לשלוח לי צילום מסך של ה-PDF (אפשר להסתיר שמות), ואני אתאים את הקריאה.</p>
          <button class="btn ghost block" data-close>סגירה</button>`),
      280
    );
    return;
  }
  setTimeout(() => previewSheet(res.lessons), 280);
}

function previewSheet(found) {
  const rows = found.map((l) => ({ ...l, on: true }));
  const hasExisting = S.data.lessons.length > 0;
  const html = () =>
    SCHOOL_DAYS.filter((d) => rows.some((r) => r.day === d))
      .map(
        (d) => `<h4 class="imp-day">יום ${DAY_NAMES[d]}</h4>${rows
          .map((r, i) => (r.day !== d ? '' : `<div class="imp-lesson">
            <input type="checkbox" data-i="${i}" data-f="on" ${r.on ? 'checked' : ''} aria-label="לשמור">
            <span class="lesson-num">${r.period ?? ''}</span>
            <div class="grow"><input class="imp-subj" data-i="${i}" data-f="subject" value="${esc(r.subject)}" aria-label="מקצוע">
              <span class="muted small">${[r.start && `<bdi>${r.start}${r.end ? `–${r.end}` : ''}</bdi>`, esc(r.teacher), esc(r.room)].filter(Boolean).join(' · ')}</span></div>
          </div>`))
          .join('')}`
      )
      .join('');
  openSheet(
    `<div class="sheet-head"><button type="button" class="link-btn" data-close>ביטול</button><h3>המערכת מה-PDF</h3><span></span></div>
     <p class="small"><b>מצאתי ${rows.length} שיעורים</b>. אפשר לתקן שמות או לבטל שיעורים לפני השמירה.</p>
     <div class="imp-lessons">${html()}</div>
     ${hasExisting ? `<label class="toggle-row"><input type="checkbox" data-replace checked> להחליף את המערכת הקיימת</label>` : ''}
     <button class="btn primary block" data-save>שמירת המערכת</button>`,
    {
      tall: true,
      onMount(sheet, close) {
        const onEdit = (ev) => {
          const el = ev.target;
          if (el.dataset.i == null) return;
          rows[+el.dataset.i][el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value;
        };
        sheet.addEventListener('input', onEdit);
        sheet.addEventListener('change', onEdit);
        sheet.querySelector('[data-save]').addEventListener('click', () => {
          const keep = rows.filter((r) => r.on && r.subject.trim());
          if (!keep.length) return toast('לא נבחרו שיעורים');
          if (!hasExisting || sheet.querySelector('[data-replace]')?.checked) S.data.lessons = [];
          for (const r of keep) {
            S.data.lessons.push({
              id: uid(), source: 'pdf', day: r.day, period: r.period, start: r.start, end: r.end,
              subjectId: ensureSubject(r.subject.trim()), title: r.subject.trim(), teacher: r.teacher, room: r.room,
            });
          }
          save();
          close();
          const t = new Date().getDay();
          S.ui.schedDay = t === 6 ? 0 : t;
          rerender();
          toast(`המערכת נשמרה ✔︎ ${keep.length} שיעורים`);
        });
      },
    }
  );
}

function lessonForm(l) {
  const isNew = !l;
  const vals = l || { day: S.ui.schedDay ?? new Date().getDay(), start: '', end: '' };
  formSheet({
    title: isNew ? 'שיעור חדש' : 'עריכת שיעור',
    values: { ...vals, day: String(vals.day) },
    fields: [
      { name: 'subjectId', label: 'מקצוע', type: 'subject' },
      { name: 'day', label: 'יום', type: 'select', options: SCHOOL_DAYS.map((d) => ({ value: String(d), label: DAY_NAMES[d] })), half: true },
      { name: 'period', label: 'שעה מס׳', type: 'number', inputmode: 'numeric', min: 0, max: 15, half: true, placeholder: '1' },
      { name: 'start', label: 'מתחיל', type: 'time', half: true },
      { name: 'end', label: 'נגמר', type: 'time', half: true },
      { name: 'teacher', label: 'מורה', half: true },
      { name: 'room', label: 'כיתה / חדר', half: true },
    ],
    footer: isNew ? '' : `<div class="sheet-foot"><button type="button" class="btn danger-ghost block" data-act="del-lesson" data-id="${l.id}">${ICON.trash} מחיקת השיעור</button></div>`,
    onSubmit(v) {
      const data = { ...v, day: +v.day, period: v.period === '' ? null : +v.period };
      if (isNew) S.data.lessons.push({ id: uid(), source: 'manual', ...data });
      else Object.assign(l, data);
      S.ui.schedDay = data.day;
      save();
      rerender();
    },
  });
}

function lessonSheet(l) {
  const noteDate = isoDate(lastDateOf(l.day));
  const due = l.subjectId ? nextLessonDate(l.subjectId) : '';
  openSheet(
    `<div class="lesson-sheet">
      <span class="dot lg" style="background:${subjectColor(l.subjectId)}"></span>
      <h3>${esc(lessonName(l))}</h3>
      <p class="muted small">יום ${DAY_NAMES[l.day]}${l.start ? ` · <bdi>${esc(l.start)}${l.end ? `–${esc(l.end)}` : ''}</bdi>` : ''}${l.teacher ? ` · ${esc(l.teacher)}` : ''}${l.room ? ` · ${esc(l.room)}` : ''}</p>
    </div>
    <div class="choice-list">
      <button class="choice" data-act="new-lesson-note" data-subject="${l.subjectId || ''}" data-date="${noteDate}" data-close>
        <span class="choice-icon">${ICON.note}</span><span class="choice-body"><b>סיכום שיעור</b><small>${fmtDate(noteDate)}</small></span></button>
      <button class="choice" data-act="add-task" data-subject="${l.subjectId || ''}" data-due="${due}" data-close>
        <span class="choice-icon">${ICON.tasks}</span><span class="choice-body"><b>שיעורי בית</b><small>${due ? `עד השיעור הבא (${fmtDate(due)})` : ''}</small></span></button>
      <button class="choice" data-act="edit-lesson" data-id="${l.id}" data-close>
        <span class="choice-icon">${ICON.edit}</span><span class="choice-body"><b>עריכת השיעור</b></span></button>
    </div>
    <button class="btn ghost block" data-close>סגירה</button>`
  );
}

export const actions = {
  'sched-day'({ day }) {
    S.ui.schedDay = +day;
    rerender();
  },
  'add-lesson': () => lessonForm(),
  'edit-lesson': ({ id }) => lessonForm(S.data.lessons.find((l) => l.id === id)),
  'lesson-open'({ id }) {
    const l = S.data.lessons.find((x) => x.id === id);
    if (l) lessonSheet(l);
  },
  async 'del-lesson'({ id }) {
    if (!(await askConfirm('למחוק את השיעור מהמערכת?'))) return;
    S.data.lessons = S.data.lessons.filter((l) => l.id !== id);
    save();
    closeAllSheets();
    rerender();
  },
};

