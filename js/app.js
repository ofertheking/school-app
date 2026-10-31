// Boot, routing, event wiring and all user actions.
import {
  S, load, save, saveNow, migrate, subject, exam, task, item, nextColor, timerElapsed,
  subjectName, EXAM_TYPES,
} from './core.js';
import { initStore, putFile, getFile, deleteFile, clearAll } from './store.js';
import {
  uid, esc, isoDate, parseISO, fmtMin, fmtClock, compressImage, blobToDataURL, dataURLToBlob,
  fmtDate,
} from './util.js';
import {
  openSheet, closeAllSheets, toast, askConfirm, formSheet, hydrateFiles, fileURL, forgetFileURL,
  shareOrDownload, subjectOptions,
} from './ui.js';
import * as V from './views.js';
import { ICON } from './icons.js';
import {
  consumeOAuthRedirect, getToken, forgetToken, startClassroomLogin, syncClassroom,
  explainClassroomError, parseScheduleText, examICS, googleCalendarURL, b64url,
} from './integrations.js';

const view = document.getElementById('view');
let currentRoute = '';
let lastItemId = null;

// ---------------------------------------------------------------- routing

const routeName = () => (location.hash || '#home').slice(1) || 'home';

function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function cleanupEmptyItem(r) {
  if (lastItemId && r !== `item-${lastItemId}`) {
    const it = item(lastItemId);
    if (it && !it.title?.trim() && !it.body?.trim() && !it.url?.trim() && !(it.files || []).length) {
      S.data.items = S.data.items.filter((x) => x !== it);
      save();
    }
  }
  lastItemId = r.startsWith('item-') ? r.slice(5) : null;
}

const TAB_OF = { home: 'home', exams: 'exams', exam: 'exams', tasks: 'tasks', study: 'study', library: 'library', item: 'library', subject: 'home', more: 'more' };

function render() {
  const r = routeName();
  cleanupEmptyItem(r);
  const dash = r.indexOf('-');
  const name = dash === -1 ? r : r.slice(0, dash);
  const id = dash === -1 ? '' : r.slice(dash + 1);
  const html =
    {
      home: V.home,
      exams: V.exams,
      tasks: V.tasks,
      study: V.study,
      library: V.library,
      more: V.more,
      exam: () => V.examDetail(id),
      item: () => V.itemDetail(id),
      subject: () => V.subjectDetail(id),
    }[name] || V.home;
  view.innerHTML = html();
  const tab = TAB_OF[name] || 'home';
  document.querySelectorAll('.tab').forEach((b) => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('on', on);
    on ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current');
  });
  view.querySelectorAll('textarea.autosize').forEach(autosize);
  hydrateFiles(view);
  if (r !== currentRoute) {
    window.scrollTo(0, 0);
    currentRoute = r;
  }
}

function autosize(el) {
  el.style.height = 'auto';
  el.style.height = `${Math.max(el.scrollHeight, 44)}px`;
}

// ---------------------------------------------------------------- timer

let audioCtx = null;

function beep() {
  try {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    [0, 0.25, 0.5].forEach((t) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, now + t);
      g.gain.exponentialRampToValueAtTime(0.3, now + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.2);
      o.connect(g).connect(audioCtx.destination);
      o.start(now + t);
      o.stop(now + t + 0.22);
    });
  } catch { /* ignore */ }
}

function startTimer(subjectId, examId) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume?.();
  } catch { /* no audio */ }
  const now = Date.now();
  S.data.timer = {
    subjectId: subjectId || '',
    examId: examId || '',
    mode: S.ui.timerMode,
    targetMin: S.data.settings.pomodoroMin || 25,
    firstStart: now,
    startedAt: now,
    accMs: 0,
    alerted: false,
  };
  save();
  render();
}

setInterval(() => {
  const t = S.data.timer;
  if (!t) return;
  const txt = fmtClock(V.timerShown(t));
  document.querySelectorAll('[data-timer]').forEach((el) => (el.textContent = txt));
  if (t.mode === 'pomodoro' && t.startedAt && !t.alerted && timerElapsed(t) >= t.targetMin * 60000) {
    t.alerted = true;
    save();
    beep();
    toast('⏰ סיימת פומודורו! זמן להפסקה של 5 דקות', 6000);
  }
}, 1000);

// ---------------------------------------------------------------- forms

function examForm(e, presetSubject) {
  const isNew = !e;
  formSheet({
    title: isNew ? 'מבחן חדש' : 'עריכת מבחן',
    values: e || { subjectId: presetSubject || '', type: 'מבחן', date: '' },
    fields: [
      { name: 'subjectId', label: 'מקצוע', type: 'subject' },
      { name: 'title', label: 'נושא / שם', placeholder: 'למשל: טריגונומטריה, פרקים 1–4' },
      { name: 'type', label: 'סוג', type: 'select', options: EXAM_TYPES.map((t) => ({ value: t, label: t })), half: true },
      { name: 'date', label: 'תאריך', type: 'date', required: true, half: true },
      { name: 'time', label: 'שעה (לא חובה)', type: 'time', half: true },
      ...(isNew ? [{ name: 'topics', label: 'החומר למבחן — שורה לכל נושא', type: 'textarea', rows: 4, placeholder: 'פונקציות\nנגזרות\nתרגילים מהחוברת עמ׳ 20–35' }] : []),
    ],
    onSubmit(v) {
      if (isNew) {
        const ex = {
          id: uid(), subjectId: v.subjectId, title: v.title || `${v.type} ב${subjectName(v.subjectId)}`,
          type: v.type, date: v.date, time: v.time, notes: '', grade: '', source: 'manual', createdAt: Date.now(),
          topics: splitLines(v.topics).map((text) => ({ id: uid(), text, s: 0 })),
        };
        S.data.exams.push(ex);
        save();
        navigate(`#exam-${ex.id}`);
        toast('המבחן נוסף. בהצלחה! 🍀');
      } else {
        Object.assign(e, { subjectId: v.subjectId, title: v.title || e.title, type: v.type, date: v.date, time: v.time });
        save();
        render();
      }
    },
  });
}

const splitLines = (s) => String(s || '').split(/\r?\n/).map((x) => x.replace(/^[\s•\-*\d.)]+/, '').trim()).filter(Boolean);

function taskForm(t, presetSubject) {
  const isNew = !t;
  const footer = isNew
    ? ''
    : `<div class="sheet-foot">
        ${t.link ? `<a class="btn ghost block" href="${esc(t.link)}" target="_blank" rel="noopener">${ICON.ext} פתיחה ב-Classroom</a>` : ''}
        <button type="button" class="btn danger-ghost block" data-act="del-task" data-id="${t.id}">${ICON.trash} מחיקת המשימה</button>
      </div>`;
  formSheet({
    title: isNew ? 'משימה חדשה' : 'עריכת משימה',
    values: t || { subjectId: presetSubject || '', due: '' },
    fields: [
      { name: 'title', label: 'מה צריך לעשות?', required: true, placeholder: 'למשל: תרגילים 1–10 עמ׳ 45' },
      { name: 'subjectId', label: 'מקצוע', type: 'subject' },
      { name: 'due', label: 'עד מתי?', type: 'date' },
      { name: 'notes', label: 'הערות', type: 'textarea', rows: 3 },
    ],
    footer,
    onSubmit(v) {
      if (isNew) {
        S.data.tasks.push({ id: uid(), ...v, done: false, doneAt: null, source: 'manual', createdAt: Date.now() });
        toast('המשימה נוספה');
      } else Object.assign(t, v);
      save();
      render();
    },
  });
}

function sessionForm(s) {
  const isNew = !s;
  const vals = s
    ? { subjectId: s.subjectId, date: isoDate(new Date(s.start)), minutes: s.minutes, note: s.note || '' }
    : { subjectId: S.ui.timerSubject || '', date: isoDate(), minutes: '' };
  formSheet({
    title: isNew ? 'הוספת זמן למידה' : 'עריכת זמן למידה',
    values: vals,
    fields: [
      { name: 'subjectId', label: 'מקצוע', type: 'subject' },
      { name: 'date', label: 'תאריך', type: 'date', required: true, half: true },
      { name: 'minutes', label: 'כמה דקות?', type: 'number', inputmode: 'numeric', min: 1, max: 1440, required: true, half: true, placeholder: '45' },
      { name: 'note', label: 'מה למדת? (לא חובה)', placeholder: 'למשל: חזרה על פרק 2' },
    ],
    footer: isNew ? '' : `<div class="sheet-foot"><button type="button" class="btn danger-ghost block" data-act="del-session" data-id="${s.id}">${ICON.trash} מחיקה</button></div>`,
    onSubmit(v) {
      const minutes = Math.round(+v.minutes);
      if (!(minutes > 0)) {
        toast('צריך מספר דקות');
        return false;
      }
      const d = parseISO(v.date);
      const now = new Date();
      if (v.date === isoDate(now)) d.setHours(now.getHours(), now.getMinutes());
      else d.setHours(12);
      if (isNew) S.data.sessions.push({ id: uid(), subjectId: v.subjectId, examId: '', start: +d, minutes, note: v.note });
      else Object.assign(s, { subjectId: v.subjectId, start: isoDate(new Date(s.start)) === v.date ? s.start : +d, minutes, note: v.note });
      save();
      render();
      toast(`נשמרו ${fmtMin(minutes)}`);
    },
  });
}

function subjectForm(s) {
  const isNew = !s;
  const cur = s ? s.color : nextColor();
  const swatches = Array.from({ length: 8 }, (_, i) =>
    `<label class="swatch"><input type="radio" name="color" value="${i}" ${i === cur ? 'checked' : ''}><span style="background:var(--c${i})"></span></label>`
  ).join('');
  formSheet({
    title: isNew ? 'מקצוע חדש' : 'עריכת מקצוע',
    values: s || {},
    fields: [{ name: 'name', label: 'שם המקצוע', required: true, placeholder: 'למשל: מתמטיקה 5 יח״ל' }],
    footer: `<div class="field"><span class="field-label">צבע</span><div class="swatches">${swatches}</div></div>
      ${isNew ? '' : `<div class="sheet-foot"><button type="button" class="btn danger-ghost block" data-act="del-subject" data-id="${s.id}">${ICON.trash} מחיקת המקצוע</button></div>`}`,
    onSubmit(v) {
      const color = +(document.querySelector('.sheet input[name=color]:checked')?.value ?? cur);
      if (isNew) S.data.subjects.push({ id: uid(), name: v.name, color });
      else Object.assign(s, { name: v.name, color });
      save();
      render();
    },
  });
}

function calendarSheet(e) {
  const ics = examICS(e);
  openSheet(
    `<h3 class="sheet-title">הוספה ליומן</h3>
     <p class="muted small center">עם תזכורות לפני המבחן</p>
     <div class="choice-list">
       <button class="choice" data-cal="ios"><span class="choice-icon">${ICON.calendar}</span><span class="choice-body"><b>יומן האייפון</b><small>נפתח ב"לוח שנה" ← "הוספה"</small></span></button>
       <a class="choice" href="${esc(googleCalendarURL(e))}" target="_blank" rel="noopener"><span class="choice-icon">${ICON.ext}</span><span class="choice-body"><b>Google Calendar</b><small>נפתח בדפדפן</small></span></a>
     </div>
     <button class="btn ghost block" data-close>סגירה</button>`,
    {
      onMount(sheet, close) {
        sheet.querySelector('[data-cal=ios]').addEventListener('click', async () => {
          if (navigator.serviceWorker?.controller) {
            // The service worker answers this URL with a text/calendar file,
            // which iOS opens straight in the Calendar "Add event" sheet.
            location.href = `cal.ics?d=${b64url(ics)}`;
          } else {
            await shareOrDownload(new File([ics], 'exam.ics', { type: 'text/calendar' }));
          }
          close();
        });
      },
    }
  );
}

// ---------------------------------------------------------------- library

function newItem(subjectId, extra = {}) {
  const it = {
    id: uid(), subjectId: subjectId ?? S.ui.libSubject ?? '', title: '', body: '', url: '', files: [],
    pinned: false, source: 'manual', createdAt: Date.now(), updatedAt: Date.now(), ...extra,
  };
  S.data.items.push(it);
  save();
  return it;
}

async function attachFiles(itemId, fileList) {
  const it = item(itemId);
  if (!it || !fileList?.length) return;
  toast('שומר…', 1200);
  for (const f of fileList) {
    const blob = await compressImage(f);
    const fid = uid();
    await putFile(fid, blob);
    it.files.push({ id: fid, name: f.name || 'קובץ', type: blob.type || f.type, size: blob.size });
  }
  if (!it.title) {
    const f = fileList[0];
    const generic = !f.name || /^(image|img_|photo|תמונה)/i.test(f.name);
    it.title = generic ? `צילום ${fmtDate(isoDate())}` : f.name.replace(/\.[^.]+$/, '');
  }
  it.updatedAt = Date.now();
  save();
  render();
}

function addItemSheet(subjectId) {
  openSheet(
    `<h3 class="sheet-title">מה מוסיפים?</h3>
     <div class="choice-list">
       <button class="choice" data-k="note"><span class="choice-icon">${ICON.note}</span><span class="choice-body"><b>סיכום</b><small>כתיבת סיכום או הערות</small></span></button>
       <label class="choice"><input type="file" accept="image/*,application/pdf,.doc,.docx,.ppt,.pptx,.txt" multiple hidden data-k-file>
         <span class="choice-icon">${ICON.camera}</span><span class="choice-body"><b>צילום או קובץ</b><small>צילום מחברת, דף עבודה, PDF</small></span></label>
       <button class="choice" data-k="link"><span class="choice-icon">${ICON.link}</span><span class="choice-body"><b>קישור</b><small>Drive, YouTube, אתר</small></span></button>
     </div>
     <button class="btn ghost block" data-close>ביטול</button>`,
    {
      onMount(sheet, close) {
        sheet.querySelectorAll('[data-k]').forEach((b) =>
          b.addEventListener('click', () => {
            const it = newItem(subjectId);
            close();
            navigate(`#item-${it.id}`);
            setTimeout(() => view.querySelector(b.dataset.k === 'link' ? '.url-field input' : '.editor-title')?.focus(), 80);
          })
        );
        sheet.querySelector('[data-k-file]').addEventListener('change', async (ev) => {
          const files = [...ev.target.files];
          if (!files.length) return;
          const it = newItem(subjectId);
          close();
          navigate(`#item-${it.id}`);
          await attachFiles(it.id, files);
        });
      },
    }
  );
}

// ---------------------------------------------------------------- webtop import

function webtopSheet() {
  let rows = [];
  let as = 'exam';
  const rowsHTML = () =>
    rows.length
      ? `<p class="small"><b>נמצאו ${rows.length}</b> — אפשר לתקן לפני שמירה:</p>
         <div class="import-rows">${rows
           .map(
             (r, i) => `<div class="import-row">
               <input type="checkbox" data-i="${i}" data-f="on" ${r.on ? 'checked' : ''} aria-label="לייבא">
               <div class="grow">
                 <input class="ir-title" data-i="${i}" data-f="title" value="${esc(r.title)}" aria-label="נושא">
                 <div class="row gap">
                   <input type="date" data-i="${i}" data-f="date" value="${r.date}" aria-label="תאריך">
                   <select data-i="${i}" data-f="subjectId" aria-label="מקצוע">${subjectOptions(r.subjectId, { allowNew: false })}</select>
                 </div>
               </div>
             </div>`
           )
           .join('')}</div>
         <button class="btn primary block" data-import-go>שמירת ${rows.filter((r) => r.on).length} פריטים</button>`
      : '';
  openSheet(
    `<div class="sheet-head"><button type="button" class="link-btn" data-close>סגירה</button><h3>ייבוא מוובטופ</h3><span></span></div>
     <p class="muted small">מעתיקים את הטבלה מ"לוח מבחנים" (או שיעורי בית) בוובטופ ומדביקים כאן. כל שורה עם תאריך תהפוך לפריט.</p>
     <div class="seg"><button class="seg-btn on" data-as="exam">מבחנים</button><button class="seg-btn" data-as="task">משימות</button></div>
     <textarea class="paste-box" rows="6" placeholder="לדוגמה:\n12/11/2026  מתמטיקה  מבחן בפונקציות\n19/11/2026  היסטוריה  בוחן פרק 3"></textarea>
     <div class="row gap">
       <button class="btn ghost grow" data-paste>הדבקה</button>
       <button class="btn tinted grow" data-parse>זיהוי</button>
     </div>
     <div class="import-out"></div>`,
    {
      tall: true,
      onMount(sheet, close) {
        const box = sheet.querySelector('.paste-box');
        const out = sheet.querySelector('.import-out');
        const parse = () => {
          rows = parseScheduleText(box.value).map((r) => ({ ...r, on: true }));
          out.innerHTML = rows.length ? rowsHTML() : `<p class="muted small center">לא נמצאו תאריכים בטקסט. צריך תאריכים כמו 12/11 או 12.11.2026</p>`;
        };
        sheet.querySelectorAll('[data-as]').forEach((b) =>
          b.addEventListener('click', () => {
            as = b.dataset.as;
            sheet.querySelectorAll('[data-as]').forEach((x) => x.classList.toggle('on', x === b));
          })
        );
        sheet.querySelector('[data-paste]').addEventListener('click', async () => {
          try {
            box.value = await navigator.clipboard.readText();
            parse();
          } catch {
            box.focus();
            toast('לוחצים לחיצה ארוכה בתיבה ← "הדבקה"');
          }
        });
        sheet.querySelector('[data-parse]').addEventListener('click', parse);
        const onEdit = (ev) => {
          const el = ev.target;
          if (el.dataset.i == null) return;
          rows[+el.dataset.i][el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value;
          if (el.type === 'checkbox') {
            const b = out.querySelector('[data-import-go]');
            if (b) b.textContent = `שמירת ${rows.filter((r) => r.on).length} פריטים`;
          }
        };
        out.addEventListener('input', onEdit);
        out.addEventListener('change', onEdit);
        out.addEventListener('click', (ev) => {
          if (!ev.target.closest('[data-import-go]')) return;
          let added = 0;
          for (const r of rows.filter((x) => x.on && x.date)) {
            if (as === 'exam') {
              if (S.data.exams.some((e) => e.date === r.date && e.title === r.title)) continue;
              S.data.exams.push({ id: uid(), subjectId: r.subjectId, title: r.title, type: r.type, date: r.date, time: r.time, topics: [], notes: '', grade: '', source: 'webtop', createdAt: Date.now() });
            } else {
              if (S.data.tasks.some((t) => t.due === r.date && t.title === r.title)) continue;
              S.data.tasks.push({ id: uid(), subjectId: r.subjectId, title: r.title, due: r.date, notes: '', done: false, source: 'webtop', createdAt: Date.now() });
            }
            added++;
          }
          save();
          close();
          navigate(as === 'exam' ? '#exams' : '#tasks');
          toast(added ? `נוספו ${added} ${as === 'exam' ? 'מבחנים' : 'משימות'} 🎉` : 'הכל כבר קיים');
        });
      },
    }
  );
}

// ---------------------------------------------------------------- classroom

async function runClassroomSync(token) {
  const close = openSheet(`<div class="progress-sheet"><div class="spinner" aria-hidden="true"></div><p id="sync-msg">מתחבר ל-Classroom…</p></div>`);
  try {
    const c = await syncClassroom(token, (msg) => {
      const el = document.getElementById('sync-msg');
      if (el) el.textContent = msg;
    });
    close();
    render();
    toast(`סונכרן ✔︎ ${c.courses} כיתות · ${c.tasks} משימות · ${c.exams} מבחנים · ${c.items} חומרים חדשים`, 6000);
  } catch (e) {
    close();
    if (e?.status === 401) forgetToken();
    render();
    toast(explainClassroomError(e), 8000);
  }
}

// ---------------------------------------------------------------- backup

async function exportBackup() {
  toast('מכין גיבוי…', 1500);
  const files = {};
  for (const it of S.data.items) {
    for (const f of it.files || []) {
      const b = await getFile(f.id);
      if (b) files[f.id] = await blobToDataURL(b);
    }
  }
  const payload = { app: 'school-app', version: 1, exportedAt: new Date().toISOString(), data: S.data, files };
  const file = new File([JSON.stringify(payload)], `school-backup-${isoDate()}.json`, { type: 'application/json' });
  await shareOrDownload(file);
}

async function importBackup(file) {
  let p;
  try {
    p = JSON.parse(await file.text());
  } catch {
    toast('הקובץ לא תקין');
    return;
  }
  if (p?.app !== 'school-app' || !p.data) {
    toast('זה לא קובץ גיבוי של האפליקציה');
    return;
  }
  if (!(await askConfirm('לשחזר מהגיבוי?', { ok: 'שחזור', danger: false, detail: 'כל מה שיש עכשיו באפליקציה יוחלף בתוכן הגיבוי.' }))) return;
  await clearAll();
  for (const [id, url] of Object.entries(p.files || {})) await putFile(id, dataURLToBlob(url));
  S.data = migrate(p.data);
  saveNow();
  render();
  toast('השחזור הושלם ✔︎');
}

// ---------------------------------------------------------------- actions

const ACTIONS = {
  'go-more': () => navigate('#more'),
  seg({ key, val }) {
    S.ui[key] = val;
    render();
  },
  'install-dismiss'() {
    S.data.settings.installDismissed = true;
    save();
    render();
  },
  'onboard-toggle': (d, el) => el.classList.toggle('on'),
  'onboard-save'() {
    const names = [...document.querySelectorAll('#onboard-chips .on')].map((b) => b.dataset.name);
    if (!names.length) return toast('בוחרים לפחות מקצוע אחד');
    names.forEach((name) => S.data.subjects.push({ id: uid(), name, color: nextColor() }));
    save();
    render();
    toast(`נוספו ${names.length} מקצועות`);
  },

  // subjects
  'add-subject': () => subjectForm(),
  'edit-subject': ({ id }) => subjectForm(subject(id)),
  async 'del-subject'({ id }) {
    const s = subject(id);
    if (!(await askConfirm(`למחוק את "${s.name}"?`, { detail: 'המבחנים, המשימות והחומר יישארו, רק בלי שיוך למקצוע.' }))) return;
    S.data.subjects = S.data.subjects.filter((x) => x.id !== id);
    for (const k of ['exams', 'tasks', 'sessions', 'items']) S.data[k].forEach((x) => x.subjectId === id && (x.subjectId = ''));
    save();
    closeAllSheets();
    navigate(routeName().startsWith('subject-') ? '#home' : `#${routeName()}`);
  },
  'subject-study'({ id }) {
    S.ui.timerSubject = id;
    if (!S.data.timer) startTimer(id, '');
    navigate('#study');
  },

  // exams
  'add-exam': ({ subject: sid }) => examForm(null, sid),
  'edit-exam': ({ id }) => examForm(exam(id)),
  async 'del-exam'({ id }) {
    if (!(await askConfirm('למחוק את המבחן?'))) return;
    S.data.exams = S.data.exams.filter((e) => e.id !== id);
    S.data.sessions.forEach((s) => s.examId === id && (s.examId = ''));
    save();
    navigate('#exams');
  },
  'topic-cycle'({ id, tid }) {
    const t = exam(id)?.topics.find((x) => x.id === tid);
    if (!t) return;
    t.s = ((t.s || 0) + 1) % 3;
    save();
    render();
  },
  'topic-del'({ id, tid }) {
    const e = exam(id);
    e.topics = e.topics.filter((x) => x.id !== tid);
    save();
    render();
  },
  'exam-cal': ({ id }) => calendarSheet(exam(id)),
  'exam-study'({ id }) {
    const e = exam(id);
    if (S.data.timer) {
      toast('כבר יש טיימר פעיל');
    } else {
      S.ui.timerSubject = e.subjectId;
      startTimer(e.subjectId, e.id);
    }
    navigate('#study');
  },

  // tasks
  'add-task': ({ subject: sid }) => taskForm(null, sid),
  'edit-task': ({ id }) => taskForm(task(id)),
  'task-toggle'({ id }) {
    const t = task(id);
    t.done = !t.done;
    t.doneAt = t.done ? Date.now() : null;
    save();
    render();
    if (t.done) toast('כל הכבוד! ✔︎');
  },
  async 'del-task'({ id }) {
    if (!(await askConfirm('למחוק את המשימה?'))) return;
    S.data.tasks = S.data.tasks.filter((t) => t.id !== id);
    save();
    closeAllSheets();
    render();
  },

  // study timer
  'timer-subject'({ id }) {
    S.ui.timerSubject = id;
    render();
  },
  'timer-start': () => startTimer(S.ui.timerSubject, ''),
  'timer-pause'() {
    const t = S.data.timer;
    if (!t?.startedAt) return;
    t.accMs += Date.now() - t.startedAt;
    t.startedAt = null;
    save();
    render();
  },
  'timer-resume'() {
    if (!S.data.timer || S.data.timer.startedAt) return;
    S.data.timer.startedAt = Date.now();
    save();
    render();
  },
  'timer-stop'() {
    const t = S.data.timer;
    if (!t) return;
    const minutes = Math.round(timerElapsed(t) / 60000);
    S.data.timer = null;
    if (minutes < 1) {
      toast('פחות מדקה — לא נשמר');
    } else {
      S.data.sessions.push({ id: uid(), subjectId: t.subjectId, examId: t.examId, start: t.firstStart, minutes, note: '' });
      toast(`נשמרו ${fmtMin(minutes)} של למידה 💪`);
    }
    save();
    render();
  },
  async 'timer-cancel'() {
    if (!(await askConfirm('לבטל בלי לשמור את הזמן?', { ok: 'ביטול הזמן' }))) return;
    S.data.timer = null;
    save();
    render();
  },
  'add-session': () => sessionForm(),
  'edit-session': ({ id }) => sessionForm(S.data.sessions.find((s) => s.id === id)),
  async 'del-session'({ id }) {
    if (!(await askConfirm('למחוק את הזמן הזה?'))) return;
    S.data.sessions = S.data.sessions.filter((s) => s.id !== id);
    save();
    closeAllSheets();
    render();
  },
  'week-prev'() {
    S.ui.weekOffset--;
    render();
  },
  'week-next'() {
    S.ui.weekOffset = Math.min(0, S.ui.weekOffset + 1);
    render();
  },
  'chart-tip'(d, el) {
    const fig = el.closest('figure');
    fig.querySelector('.chart-tip').textContent = d.tip;
    fig.querySelectorAll('.c-hit').forEach((h) => h.classList.toggle('sel', h === el));
  },

  // library
  'add-item': ({ subject: sid }) => addItemSheet(sid),
  'new-note'({ subject: sid }) {
    const it = newItem(sid ?? '');
    navigate(`#item-${it.id}`);
    setTimeout(() => view.querySelector('.editor-title')?.focus(), 80);
  },
  'lib-kind'({ val }) {
    S.ui.libKind = val;
    render();
  },
  'lib-subject'({ id }) {
    S.ui.libSubject = id;
    render();
  },
  'item-pin'({ id }) {
    const it = item(id);
    it.pinned = !it.pinned;
    save();
    render();
    toast(it.pinned ? 'ננעץ למעלה 📌' : 'בוטלה הנעיצה');
  },
  async 'del-item'({ id }) {
    if (!(await askConfirm('למחוק את החומר הזה?', { detail: 'כולל כל הקבצים והתמונות שבו.' }))) return;
    const it = item(id);
    for (const f of it.files || []) {
      forgetFileURL(f.id);
      await deleteFile(f.id);
    }
    S.data.items = S.data.items.filter((x) => x.id !== id);
    save();
    navigate('#library');
  },
  async 'item-share'({ id }) {
    const it = item(id);
    const text = [it.title, it.body, it.url].filter(Boolean).join('\n\n');
    try {
      if (navigator.share) {
        await navigator.share({ title: it.title, text });
        return;
      }
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast('הועתק ✔︎');
    } catch {
      toast('לא הצלחתי לשתף מכאן');
    }
  },
  async 'att-del'({ id, fid }) {
    if (!(await askConfirm('למחוק את הקובץ?'))) return;
    const it = item(id);
    it.files = it.files.filter((f) => f.id !== fid);
    forgetFileURL(fid);
    await deleteFile(fid);
    it.updatedAt = Date.now();
    save();
    render();
  },
  async 'att-view'({ fid }) {
    const u = await fileURL(fid);
    if (!u) return toast('הקובץ לא נמצא');
    openSheet(`<div class="viewer"><img src="${u}" alt=""></div><button class="btn ghost block" data-close>סגירה</button>`, { tall: true });
  },

  // connections
  'gc-sync'() {
    const cid = (S.data.settings.clientId || '').trim();
    if (!cid) return toast('צריך להדביק Client ID קודם');
    const token = getToken();
    if (!token) {
      saveNow();
      startClassroomLogin(cid);
      return;
    }
    runClassroomSync(token);
  },
  'gc-logout'() {
    forgetToken();
    render();
    toast('התנתקת מגוגל');
  },
  'webtop-paste': () => webtopSheet(),
  async copy({ text }) {
    try {
      await navigator.clipboard.writeText(text);
      toast('הועתק ✔︎');
    } catch {
      toast('סמנו והעתיקו ידנית');
    }
  },

  // backup
  export: () => exportBackup(),
  async reset() {
    if (!(await askConfirm('למחוק את כל הנתונים?', { ok: 'מחיקת הכל', detail: 'אי אפשר לבטל. כדאי לייצא גיבוי קודם.' }))) return;
    await clearAll();
    S.data = migrate(null);
    saveNow();
    navigate('#home');
    toast('הכל נמחק');
  },
};

// ---------------------------------------------------------------- events

document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-go]');
  if (go) {
    e.preventDefault();
    navigate(go.dataset.go);
    return;
  }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  const fn = ACTIONS[a.dataset.act];
  if (!fn) return;
  e.preventDefault();
  Promise.resolve(fn({ ...a.dataset }, a, e)).catch((err) => {
    console.error(err);
    toast('משהו השתבש 😕');
  });
});

function setPath(path, value) {
  const [root, key] = path.split('.');
  S.data[root][key] = value;
}

function applyBind(el) {
  const [kind, id, field] = el.dataset.bind.split(':');
  const obj = kind === 'exam' ? exam(id) : item(id);
  if (!obj) return;
  obj[field] = field === 'grade' ? el.value.trim() : el.value;
  if (kind === 'item') obj.updatedAt = Date.now();
  save();
}

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.matches('textarea.autosize')) autosize(el);
  if (el.dataset.bind && el.tagName !== 'SELECT') applyBind(el);
  if (el.dataset.input === 'lib-query') {
    S.ui.libQuery = el.value;
    const list = document.getElementById('lib-list');
    list.innerHTML = V.libraryList();
    hydrateFiles(list);
  }
  if (el.dataset.setting === 'settings.clientId') {
    setPath('settings.clientId', el.value.trim());
    save();
    const b = view.querySelector('[data-act="gc-sync"]');
    if (b) b.disabled = !el.value.trim();
  }
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset.bind && el.tagName === 'SELECT') {
    applyBind(el);
    render();
  }
  if (el.dataset.setting) {
    let v = el.value.trim();
    if (el.type === 'number') {
      const n = Math.round(+v);
      v = Math.min(+el.max || 1e9, Math.max(+el.min || 0, isNaN(n) ? +el.min || 0 : n));
      el.value = v;
    }
    setPath(el.dataset.setting, v);
    save();
  }
  if (el.dataset.attach) {
    await attachFiles(el.dataset.attach, [...el.files]);
    el.value = '';
  }
  if (el.hasAttribute('data-import') && el.files[0]) {
    await importBackup(el.files[0]);
    el.value = '';
  }
});

document.addEventListener('submit', (e) => {
  const f = e.target;
  if (f.dataset.form !== 'topic') return;
  e.preventDefault();
  const ex = exam(f.dataset.id);
  const lines = splitLines(f.elements.t.value);
  if (!lines.length) return;
  ex.topics.push(...lines.map((text) => ({ id: uid(), text, s: 0 })));
  save();
  render();
  view.querySelector('.add-topic textarea')?.focus();
});

// Enter (without shift) in the topic box adds the topic.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && e.target.closest?.('.add-topic textarea')) {
    e.preventDefault();
    e.target.form.requestSubmit();
  }
});

function handleOAuthReturn() {
  const oauth = consumeOAuthRedirect();
  if (oauth?.ok) runClassroomSync(getToken());
  else if (oauth?.error) {
    const msg = { access_denied: 'ההתחברות לגוגל בוטלה', state_mismatch: 'ההתחברות נכשלה (בדיקת אבטחה). נסו שוב.' }[oauth.error];
    toast(msg || `שגיאת התחברות: ${oauth.error}`, 6000);
  }
  return oauth;
}

window.addEventListener('hashchange', () => {
  if (handleOAuthReturn()) return; // hash was rewritten to #more → another hashchange renders
  closeAllSheets();
  render();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveNow();
  else if (!document.querySelector('.sheet-wrap') && !document.activeElement?.matches('input,textarea,select')) render();
});
window.addEventListener('pagehide', () => saveNow());

// ---------------------------------------------------------------- boot

async function boot() {
  await initStore();
  await load();
  const hadOAuth = /(^#|&)(access_token|error)=/.test(location.hash);
  if (hadOAuth) {
    render(); // paint first, then consume (replaceState doesn't fire hashchange)
    handleOAuthReturn();
  }
  render();
  document.documentElement.classList.add('ready');

  if ('serviceWorker' in navigator) {
    try {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    } catch { /* sandboxed */ }
  }
}

boot();
