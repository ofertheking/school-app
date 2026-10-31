// Screen renderers. Each returns an HTML string; app.js wires the actions.
import {
  S, subject, subjectName, subjectColor, readiness, upcomingExams, pastExams, openTasks,
  gradeAverage, todayMinutes, weekDays, weekBySubject, streak, timerElapsed, examUrgency,
  dueLabelGroup, itemKind, exam, item, minutesBetween, COMMON_SUBJECTS,
} from './core.js';
import {
  esc, fmtDate, fmtDateLong, fmtHebrewDate, fmtMin, fmtClock, relDay, daysUntil, greeting,
  weekStart, addDays, fmtDayMonth, isIOS, isStandalone, fmtDateTime, norm, isoDate, fmtMinShort,
} from './util.js';
import { weekChart, subjectBars, meter, ring } from './charts.js';
import { ICON } from './icons.js';
import { getToken, redirectURI } from './integrations.js';
import { storageMode } from './store.js';

// ---------- shared bits ----------

function head(title, { back, actions = '', sub = '' } = {}) {
  return `<header class="page-head">
    <div class="head-bar">
      ${back ? `<button class="icon-btn back" data-go="${back}" aria-label="חזרה">${ICON.back}<span>חזרה</span></button>` : '<span></span>'}
      <div class="head-actions">${actions}</div>
    </div>
    <h1 class="large-title">${esc(title)}</h1>
    ${sub ? `<p class="subtitle">${sub}</p>` : ''}
  </header>`;
}

const iconBtn = (act, icon, label, data = '') =>
  `<button class="icon-btn" data-act="${act}" aria-label="${esc(label)}" ${data}>${icon}</button>`;

const section = (title, body, more = '') =>
  `<section class="section"><div class="section-head"><h2>${esc(title)}</h2>${more}</div>${body}</section>`;

const empty = (emoji, text, cta = '') =>
  `<div class="empty"><div class="empty-emoji" aria-hidden="true">${emoji}</div><p>${text}</p>${cta}</div>`;

function seg(key, options) {
  return `<div class="seg" role="tablist">${options
    .map(
      ([val, label]) =>
        `<button role="tab" class="seg-btn${S.ui[key] === val ? ' on' : ''}" aria-selected="${S.ui[key] === val}" data-act="seg" data-key="${key}" data-val="${val}">${esc(label)}</button>`
    )
    .join('')}</div>`;
}

function statVal(min) {
  const { value, unit } = fmtMinShort(min);
  return `<span class="stat-value"><bdi>${value}</bdi> <small>${unit}</small></span>`;
}

const dot = (subjectId) => `<span class="dot" style="background:${subjectColor(subjectId)}"></span>`;

function subjectChip(s, { act = '', on = false, data = '' } = {}) {
  return `<button class="chip-btn${on ? ' on' : ''}" ${act ? `data-act="${act}"` : `data-go="#subject-${s.id}"`} data-id="${s.id}" ${data}>
    <span class="dot" style="background:var(--c${s.color % 8})"></span>${esc(s.name)}</button>`;
}

export function examCard(e) {
  const r = readiness(e);
  const n = daysUntil(e.date);
  const past = n < 0;
  const right = past
    ? e.grade !== '' && e.grade != null
      ? `<span class="grade">${esc(e.grade)}</span>`
      : `<span class="chip">אין ציון</span>`
    : `<span class="chip ${examUrgency(e)}">${relDay(e.date)}</span>`;
  return `<button class="card exam-card" data-go="#exam-${e.id}">
    <span class="stripe" style="background:${subjectColor(e.subjectId)}"></span>
    <span class="exam-main">
      <span class="row between"><span class="eyebrow">${esc(subjectName(e.subjectId))} · ${esc(e.type || 'מבחן')}</span>${right}</span>
      <span class="title">${esc(e.title || e.type || 'מבחן')}</span>
      <span class="muted small">${fmtDate(e.date)}${e.time ? ` · <bdi>${esc(e.time)}</bdi>` : ''}</span>
      ${
        past
          ? ''
          : r != null
          ? `<span class="readiness">${meter(r, { label: 'מוכנות למבחן' })}<span class="small muted">${r}% מוכנות</span></span>`
          : `<span class="small accent">＋ להוסיף חומר למבחן</span>`
      }
    </span>
  </button>`;
}

export function taskRow(t) {
  const late = t.due && !t.done && daysUntil(t.due) < 0;
  return `<div class="task-row${t.done ? ' done' : ''}">
    <button class="check${t.done ? ' on' : ''}" data-act="task-toggle" data-id="${t.id}" aria-label="${t.done ? 'סימון כלא בוצע' : 'סימון כבוצע'}">${ICON.check}</button>
    <button class="task-body" data-act="edit-task" data-id="${t.id}">
      <span class="task-title">${esc(t.title)}</span>
      <span class="task-meta">${dot(t.subjectId)}${esc(subjectName(t.subjectId))}${
        t.due ? ` · <span class="${late ? 'late' : ''}">${late ? '⚠︎ ' : ''}${relDay(t.due)}</span>` : ''
      }${t.source === 'classroom' ? ' · <span class="badge">Classroom</span>' : ''}</span>
    </button>
  </div>`;
}

function timerBanner() {
  const t = S.data.timer;
  if (!t) return '';
  const ex = t.examId ? exam(t.examId) : null;
  return `<button class="timer-banner${t.startedAt ? '' : ' paused'}" data-go="#study">
    <span class="pulse" aria-hidden="true"></span>
    <span>${t.startedAt ? 'לומדים עכשיו' : 'מושהה'}: ${esc(subjectName(t.subjectId))}${ex ? ` · ${esc(ex.title)}` : ''}</span>
    <b class="ltr" data-timer>${fmtClock(timerShown(t))}</b>
  </button>`;
}

export function timerShown(t = S.data.timer) {
  if (!t) return 0;
  const el = timerElapsed(t);
  return t.mode === 'pomodoro' ? t.targetMin * 60000 - el : el;
}

// ---------- HOME ----------

function installCard() {
  const framed = (() => { try { return window.self !== window.top; } catch { return true; } })();
  if (framed || isStandalone() || S.data.settings.installDismissed || !isIOS()) return '';
  return `<div class="card install">
    <button class="icon-btn close" data-act="install-dismiss" aria-label="סגירה">${ICON.x}</button>
    <b>להתקין כאפליקציה באייפון 📲</b>
    <ol>
      <li>לוחצים על כפתור השיתוף <span class="inline-ico">${ICON.share}</span> בספארי</li>
      <li>בוחרים <b>"הוספה למסך הבית"</b></li>
      <li>פותחים את האפליקציה מהאייקון — היא עובדת גם בלי אינטרנט</li>
    </ol>
  </div>`;
}

function onboardingCard() {
  if (S.data.subjects.length) return '';
  return `<div class="card onboard">
    <b>מתחילים! אילו מקצועות יש לך?</b>
    <p class="muted small">אפשר לבחור כמה ולשנות אחר כך. ואם יש לך Google Classroom, אפשר לייבא משם בהגדרות.</p>
    <div class="chip-wrap" id="onboard-chips">
      ${COMMON_SUBJECTS.map((n) => `<button class="chip-btn" data-act="onboard-toggle" data-name="${esc(n)}">${esc(n)}</button>`).join('')}
    </div>
    <button class="btn primary block" data-act="onboard-save">הוספת המקצועות שנבחרו</button>
  </div>`;
}

export function home() {
  const d = S.data;
  const now = new Date();
  const name = d.profile.name ? `, ${d.profile.name}` : '';
  const heb = fmtHebrewDate(now);
  const goalMin = Math.max(1, (d.settings.weeklyGoalH || 0) * 60);
  const weekMin = weekDays(0).reduce((a, x) => a + x.minutes, 0);
  const pct = (weekMin / goalMin) * 100;
  const st = streak();
  const exams = upcomingExams().slice(0, 3);
  const tasks = openTasks().slice(0, 5);

  const stats = `<div class="card stats">
    ${ring(pct, `${Math.round(pct)}%`, 'מהמטרה')}
    <div class="stat-tiles">
      <div class="stat"><span class="stat-label">היום</span>${statVal(todayMinutes())}</div>
      <div class="stat"><span class="stat-label">השבוע</span>${statVal(weekMin)}<span class="stat-sub">מתוך ${d.settings.weeklyGoalH} ש׳</span></div>
      <div class="stat"><span class="stat-label">רצף</span><span class="stat-value">${st} <small>${st === 1 ? 'יום' : 'ימים'}</small></span></div>
    </div>
  </div>`;

  const quick = `<div class="quick">
    <button class="quick-btn" data-act="add-exam"><span>${ICON.exam}</span>מבחן</button>
    <button class="quick-btn" data-act="add-task"><span>${ICON.tasks}</span>משימה</button>
    <button class="quick-btn" data-act="new-note"><span>${ICON.note}</span>סיכום</button>
    <button class="quick-btn" data-go="#study"><span>${ICON.timer}</span>ללמוד</button>
  </div>`;

  return `
    ${head(`${greeting(now)}${name}`, {
      actions: iconBtn('go-more', ICON.gear, 'הגדרות'),
      sub: `${fmtDateLong(now)}${heb ? ` · ${heb}` : ''}`,
    })}
    ${installCard()}
    ${onboardingCard()}
    ${timerBanner()}
    ${stats}
    ${quick}
    ${section(
      'מבחנים קרובים',
      exams.length ? `<div class="stack">${exams.map(examCard).join('')}</div>` : empty('🎉', 'אין מבחנים קרובים', `<button class="btn tinted" data-act="add-exam">＋ הוספת מבחן</button>`),
      `<button class="link-btn" data-go="#exams">הכל</button>`
    )}
    ${section(
      'משימות',
      tasks.length ? `<div class="card list">${tasks.map(taskRow).join('')}</div>` : empty('✅', 'אין משימות פתוחות'),
      `<button class="link-btn" data-go="#tasks">הכל</button>`
    )}
    ${
      d.subjects.length
        ? section('המקצועות שלי', `<div class="chip-scroll">${d.subjects.map((s) => subjectChip(s)).join('')}<button class="chip-btn add" data-act="add-subject">＋</button></div>`)
        : ''
    }
  `;
}

// ---------- EXAMS ----------

export function exams() {
  const isUp = S.ui.examsSeg === 'upcoming';
  const list = isUp ? upcomingExams() : pastExams();
  const avg = gradeAverage();
  let body;
  if (!list.length) {
    body = isUp
      ? empty('📅', 'אין מבחנים קרובים. כדאי להוסיף את לוח המבחנים — אפשר גם לייבא מוובטופ בהגדרות.', `<button class="btn tinted" data-act="add-exam">＋ הוספת מבחן</button>`)
      : empty('🗂️', 'עוד אין מבחנים שעברו');
  } else {
    body = `<div class="stack">${list.map(examCard).join('')}</div>`;
  }
  return `
    ${head('מבחנים', { actions: iconBtn('add-exam', ICON.plus, 'הוספת מבחן') })}
    ${seg('examsSeg', [['upcoming', 'קרובים'], ['past', 'עברו']])}
    ${!isUp && avg != null ? `<div class="card avg"><span class="muted">ממוצע ציונים</span><span class="hero-sm">${avg}</span></div>` : ''}
    ${body}
  `;
}

const TOPIC_STATES = [
  { label: 'עוד לא', cls: 's0' },
  { label: 'בתהליך', cls: 's1' },
  { label: 'שולט/ת', cls: 's2' },
];

export function examDetail(id) {
  const e = exam(id);
  if (!e) return notFound('#exams');
  const n = daysUntil(e.date);
  const r = readiness(e);
  const topics = e.topics || [];
  const mastered = topics.filter((t) => t.s === 2).length;
  const studied = minutesBetween(0, Date.now() + 1, { examId: e.id });
  const big = n > 1 ? `<b class="hero-num">${n}</b><span>ימים למבחן</span>` : n === 1 ? `<b class="hero-num">מחר</b><span>בהצלחה!</span>` : n === 0 ? `<b class="hero-num">היום</b><span>בהצלחה! 🍀</span>` : `<b class="hero-num">${e.grade !== '' && e.grade != null ? esc(e.grade) : '—'}</b><span>ציון</span>`;

  return `
    ${head(e.title || e.type || 'מבחן', {
      back: '#exams',
      actions: iconBtn('edit-exam', ICON.edit, 'עריכה', `data-id="${e.id}"`),
      sub: `${dot(e.subjectId)} ${esc(subjectName(e.subjectId))} · ${esc(e.type || 'מבחן')} · ${fmtDate(e.date)}${e.time ? ` · <bdi>${esc(e.time)}</bdi>` : ''}`,
    })}
    <div class="card countdown ${n >= 0 ? examUrgency(e) : 'past'}">${big}</div>

    ${section(
      'החומר למבחן',
      `<div class="card">
        ${r != null ? `<div class="readiness big">${meter(r, { label: 'מוכנות' })}<span class="small"><b>${r}%</b> מוכנות · ${mastered}/${topics.length} נושאים בשליטה</span></div>` : ''}
        <div class="topics">
          ${topics
            .map(
              (t) => `<div class="topic">
              <button class="topic-state ${TOPIC_STATES[t.s || 0].cls}" data-act="topic-cycle" data-id="${e.id}" data-tid="${t.id}" aria-label="מצב: ${TOPIC_STATES[t.s || 0].label}. לחיצה משנה">
                <span class="ts-ico" aria-hidden="true"></span><span class="ts-label">${TOPIC_STATES[t.s || 0].label}</span>
              </button>
              <span class="topic-text">${esc(t.text)}</span>
              <button class="icon-btn sm" data-act="topic-del" data-id="${e.id}" data-tid="${t.id}" aria-label="מחיקת נושא">${ICON.x}</button>
            </div>`
            )
            .join('')}
        </div>
        <form class="add-topic" data-form="topic" data-id="${e.id}">
          <textarea name="t" rows="1" placeholder="הוספת נושא…"></textarea>
          <button class="btn tinted" type="submit">הוספה</button>
        </form>
        <p class="muted small">לחיצה על המצב מעבירה: עוד לא ← בתהליך ← שולט/ת. אפשר גם להדביק רשימה (שורה לכל נושא).</p>
      </div>`
    )}

    ${section(
      'למידה למבחן',
      `<div class="card row between">
        <span><span class="muted small">זמן שלמדת למבחן הזה</span><br><b>${fmtMin(studied)}</b></span>
        <button class="btn primary" data-act="exam-study" data-id="${e.id}">${ICON.play} ללמוד עכשיו</button>
      </div>`
    )}

    ${section(
      'הערות',
      `<div class="card"><textarea class="autosize plain" data-bind="exam:${e.id}:notes" rows="3" placeholder="פרקים בספר, דפי עבודה, מה המורה אמר/ה…">${esc(e.notes || '')}</textarea></div>`
    )}

    ${section(
      'ציון',
      `<div class="card row between">
        <label for="grade-${e.id}" class="muted">${n > 0 ? 'אחרי המבחן אפשר לרשום כאן ציון' : 'מה קיבלת?'}</label>
        <input id="grade-${e.id}" class="grade-input" type="number" inputmode="decimal" min="0" max="100" data-bind="exam:${e.id}:grade" value="${esc(e.grade ?? '')}" placeholder="—">
      </div>`
    )}

    <div class="actions-col">
      <button class="btn tinted block" data-act="exam-cal" data-id="${e.id}">${ICON.calendar} הוספה ליומן עם תזכורת</button>
      ${e.link ? `<a class="btn ghost block" href="${esc(e.link)}" target="_blank" rel="noopener">${ICON.ext} פתיחה ב-Classroom</a>` : ''}
      <button class="btn danger-ghost block" data-act="del-exam" data-id="${e.id}">${ICON.trash} מחיקת המבחן</button>
    </div>
  `;
}

// ---------- TASKS ----------

export function tasks() {
  const open = S.ui.tasksSeg === 'open';
  let body;
  if (open) {
    const list = openTasks();
    if (!list.length) {
      body = empty('✅', 'אין משימות פתוחות. כל הכבוד!', `<button class="btn tinted" data-act="add-task">＋ משימה חדשה</button>`);
    } else {
      const order = ['באיחור', 'היום', 'מחר', 'השבוע הקרוב', 'בהמשך', 'ללא תאריך'];
      const groups = new Map(order.map((k) => [k, []]));
      list.forEach((t) => groups.get(dueLabelGroup(t.due)).push(t));
      body = order
        .filter((k) => groups.get(k).length)
        .map((k) => `<h3 class="group-title${k === 'באיחור' ? ' late' : ''}">${k}</h3><div class="card list">${groups.get(k).map(taskRow).join('')}</div>`)
        .join('');
    }
  } else {
    const list = S.data.tasks.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).slice(0, 60);
    body = list.length ? `<div class="card list">${list.map(taskRow).join('')}</div>` : empty('📭', 'עוד לא סימנת משימות כבוצעו');
  }
  return `
    ${head('משימות', { actions: iconBtn('add-task', ICON.plus, 'משימה חדשה') })}
    ${seg('tasksSeg', [['open', 'פתוחות'], ['done', 'בוצעו']])}
    ${body}
  `;
}

// ---------- STUDY ----------

export function study() {
  const t = S.data.timer;
  const subs = S.data.subjects;
  let timerCard;
  if (t) {
    const ex = t.examId ? exam(t.examId) : null;
    timerCard = `<div class="card timer-card running${t.startedAt ? '' : ' paused'}">
      <div class="timer-sub">${dot(t.subjectId)} ${esc(subjectName(t.subjectId))}${ex ? ` · ${esc(ex.title)}` : ''}</div>
      <div class="timer-clock ltr" data-timer>${fmtClock(timerShown(t))}</div>
      <div class="muted small">${t.mode === 'pomodoro' ? `פומודורו ${t.targetMin} דקות` : 'סטופר'}${t.startedAt ? '' : ' · מושהה'}</div>
      <div class="timer-btns">
        ${t.startedAt
          ? `<button class="btn round" data-act="timer-pause" aria-label="השהיה">${ICON.pause}</button>`
          : `<button class="btn round primary" data-act="timer-resume" aria-label="המשך">${ICON.play}</button>`}
        <button class="btn primary grow" data-act="timer-stop">${ICON.stop} סיום ושמירה</button>
        <button class="btn round ghost" data-act="timer-cancel" aria-label="ביטול בלי לשמור">${ICON.x}</button>
      </div>
    </div>`;
  } else {
    const sel = S.ui.timerSubject;
    timerCard = `<div class="card timer-card">
      <div class="field-label">מה לומדים?</div>
      <div class="chip-wrap">
        ${subs.map((s) => subjectChip(s, { act: 'timer-subject', on: sel === s.id })).join('')}
        <button class="chip-btn${!sel ? ' on' : ''}" data-act="timer-subject" data-id="">כללי</button>
      </div>
      ${seg('timerMode', [['stopwatch', 'סטופר'], ['pomodoro', `פומודורו ${S.data.settings.pomodoroMin}′`]])}
      <div class="timer-clock ltr idle">${S.ui.timerMode === 'pomodoro' ? `${S.data.settings.pomodoroMin}:00` : '00:00'}</div>
      <button class="btn primary block lg" data-act="timer-start">${ICON.play} התחלת למידה</button>
    </div>`;
  }

  const off = S.ui.weekOffset;
  const days = weekDays(off);
  const total = days.reduce((a, x) => a + x.minutes, 0);
  const ws = addDays(weekStart(), off * 7);
  const rangeLabel = off === 0 ? 'השבוע' : off === -1 ? 'שבוע שעבר' : `${fmtDayMonth(ws)}–${fmtDayMonth(addDays(ws, 6))}`;
  const bySub = weekBySubject(off).map((r) => ({ label: subjectName(r.subjectId), color: subjectColor(r.subjectId), minutes: r.minutes }));
  const recent = [...S.data.sessions].sort((a, b) => b.start - a.start).slice(0, 12);

  return `
    ${head('שעות למידה', { actions: iconBtn('add-session', ICON.plus, 'הוספת זמן ידנית') })}
    ${timerCard}
    ${section(
      `שעות למידה · ${rangeLabel}`,
      `<div class="card">
        <div class="row between week-nav">
          <button class="icon-btn" data-act="week-prev" aria-label="שבוע קודם">${ICON.back}</button>
          <span class="week-total"><b>${fmtMin(total)}</b> <span class="muted small">· מטרה ${S.data.settings.weeklyGoalH} ש׳</span></span>
          <button class="icon-btn" data-act="week-next" aria-label="שבוע הבא" ${off >= 0 ? 'disabled' : ''}>${ICON.fwd}</button>
        </div>
        ${weekChart(days)}
        <p class="muted small axis-note">ציר: שעות ביום</p>
      </div>`
    )}
    ${bySub.length ? section('לפי מקצוע', `<div class="card">${subjectBars(bySub)}</div>`) : ''}
    ${section(
      'פעילות אחרונה',
      recent.length
        ? `<div class="card list">${recent
            .map(
              (s) => `<button class="row-btn" data-act="edit-session" data-id="${s.id}">
                ${dot(s.subjectId)}<span class="grow">${esc(subjectName(s.subjectId))}${s.examId && exam(s.examId) ? ` <span class="muted small">· ${esc(exam(s.examId).title)}</span>` : ''}${s.note ? `<br><span class="muted small">${esc(s.note)}</span>` : ''}</span>
                <span class="muted small">${fmtDateTime(s.start)}</span><b>${fmtMin(s.minutes)}</b>
              </button>`
            )
            .join('')}</div>`
        : empty('⏱️', 'עוד לא נרשם זמן למידה. לוחצים על "התחלת למידה" או מוסיפים ידנית.')
    )}
  `;
}

// ---------- LIBRARY ----------

export function libraryItems() {
  const q = norm(S.ui.libQuery);
  return S.data.items
    .filter((it) => S.ui.libKind === 'all' || itemKind(it) === S.ui.libKind)
    .filter((it) => !S.ui.libSubject || it.subjectId === S.ui.libSubject)
    .filter((it) => !q || norm(`${it.title} ${it.body} ${subjectName(it.subjectId)}`).includes(q))
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.updatedAt || 0) - (a.updatedAt || 0));
}

const KIND_ICON = { note: ICON.note, file: ICON.clip, link: ICON.link };

export function libraryList() {
  const list = libraryItems();
  if (!list.length) {
    return S.data.items.length
      ? empty('🔍', 'לא נמצא חומר שמתאים לחיפוש')
      : empty('📚', 'כאן נשמרים הסיכומים, צילומי מחברת, דפי עבודה וקישורים.', `<button class="btn tinted" data-act="add-item">＋ הוספת חומר</button>`);
  }
  return `<div class="card list">${list
    .map((it) => {
      const kind = itemKind(it);
      const img = (it.files || []).find((f) => f.type?.startsWith('image/'));
      const preview = (it.body || it.url || '').replace(/\s+/g, ' ').slice(0, 90);
      return `<button class="item-row" data-go="#item-${it.id}">
        <span class="item-thumb k-${kind}">${img ? `<img alt="" data-file-src="${img.id}">` : KIND_ICON[kind]}</span>
        <span class="item-body">
          <span class="item-title">${it.pinned ? `<span class="pin">${ICON.pin}</span>` : ''}${esc(it.title || 'ללא כותרת')}</span>
          <span class="item-meta">${dot(it.subjectId)}${esc(subjectName(it.subjectId))} · ${fmtDate(isoDate(new Date(it.updatedAt || it.createdAt)))}${(it.files || []).length ? ` · ${it.files.length} קבצים` : ''}${it.source === 'classroom' ? ' · <span class="badge">Classroom</span>' : ''}</span>
          ${preview ? `<span class="item-preview">${esc(preview)}</span>` : ''}
        </span>
      </button>`;
    })
    .join('')}</div>`;
}

export function library() {
  const kinds = [['all', 'הכל'], ['note', 'סיכומים'], ['file', 'קבצים ותמונות'], ['link', 'קישורים']];
  return `
    ${head('חומר וסיכומים', { actions: iconBtn('add-item', ICON.plus, 'הוספת חומר') })}
    <label class="search"><span aria-hidden="true">${ICON.search}</span>
      <input type="search" placeholder="חיפוש בסיכומים ובחומר" value="${esc(S.ui.libQuery)}" data-input="lib-query" aria-label="חיפוש">
    </label>
    <div class="chip-scroll">${kinds
      .map(([k, l]) => `<button class="chip-btn${S.ui.libKind === k ? ' on' : ''}" data-act="lib-kind" data-val="${k}">${l}</button>`)
      .join('')}</div>
    ${
      S.data.subjects.length
        ? `<div class="chip-scroll">
            <button class="chip-btn${!S.ui.libSubject ? ' on' : ''}" data-act="lib-subject" data-id="">כל המקצועות</button>
            ${S.data.subjects.map((s) => subjectChip(s, { act: 'lib-subject', on: S.ui.libSubject === s.id })).join('')}
          </div>`
        : ''
    }
    <div id="lib-list">${libraryList()}</div>
  `;
}

export function itemDetail(id) {
  const it = item(id);
  if (!it) return notFound('#library');
  const files = it.files || [];
  return `
    ${head('', {
      back: '#library',
      actions: `${iconBtn('item-share', ICON.share, 'שיתוף', `data-id="${it.id}"`)}
                ${iconBtn('item-pin', ICON.pin, it.pinned ? 'ביטול נעיצה' : 'נעיצה', `data-id="${it.id}" aria-pressed="${!!it.pinned}"`)}
                ${iconBtn('del-item', ICON.trash, 'מחיקה', `data-id="${it.id}"`)}`,
    })}
    <div class="editor">
      <input class="editor-title" data-bind="item:${it.id}:title" value="${esc(it.title)}" placeholder="כותרת (למשל: סיכום פרק 3 — מלחמת העצמאות)" aria-label="כותרת">
      <div class="row gap">
        <label class="mini-field">${dot(it.subjectId)}
          <select data-bind="item:${it.id}:subjectId" aria-label="מקצוע">${S.data.subjects
            .map((s) => `<option value="${s.id}"${s.id === it.subjectId ? ' selected' : ''}>${esc(s.name)}</option>`)
            .join('')}<option value=""${!it.subjectId ? ' selected' : ''}>כללי</option></select>
        </label>
        <span class="muted small">עודכן ${fmtDateTime(it.updatedAt || it.createdAt)}</span>
      </div>
      <label class="url-field"><span aria-hidden="true">${ICON.link}</span>
        <input type="url" inputmode="url" data-bind="item:${it.id}:url" value="${esc(it.url || '')}" placeholder="קישור (Drive, YouTube, אתר…)" aria-label="קישור">
        ${it.url ? `<a class="btn tinted sm" href="${esc(it.url)}" target="_blank" rel="noopener">פתיחה</a>` : ''}
      </label>
      ${(it.extraLinks || []).length > 1 ? `<div class="extra-links">${it.extraLinks.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${ICON.ext} ${esc(l.title || l.url)}</a>`).join('')}</div>` : ''}
      <textarea class="editor-body autosize" data-bind="item:${it.id}:body" placeholder="כותבים כאן את הסיכום…">${esc(it.body || '')}</textarea>

      <div class="section-head"><h2>קבצים ותמונות</h2></div>
      <div class="files-grid">
        ${files
          .map((f) =>
            f.type?.startsWith('image/')
              ? `<div class="file-tile"><button class="file-img" data-act="att-view" data-id="${it.id}" data-fid="${f.id}" aria-label="הגדלת תמונה"><img alt="${esc(f.name)}" data-file-src="${f.id}"></button>
                 <button class="file-del" data-act="att-del" data-id="${it.id}" data-fid="${f.id}" aria-label="מחיקת קובץ">${ICON.x}</button></div>`
              : `<div class="file-tile doc"><a data-file-href="${f.id}" target="_blank" rel="noopener" class="file-doc">${ICON.clip}<span>${esc(f.name)}</span></a>
                 <button class="file-del" data-act="att-del" data-id="${it.id}" data-fid="${f.id}" aria-label="מחיקת קובץ">${ICON.x}</button></div>`
          )
          .join('')}
        <label class="file-tile add">
          <input type="file" accept="image/*,application/pdf,.doc,.docx,.ppt,.pptx,.txt" multiple data-attach="${it.id}" hidden>
          ${ICON.camera}<span>צילום / קובץ</span>
        </label>
      </div>
    </div>
  `;
}

// ---------- SUBJECT ----------

export function subjectDetail(id) {
  const s = subject(id);
  if (!s) return notFound('#home');
  const ws = weekStart();
  const weekMin = minutesBetween(ws, addDays(ws, 7), { subjectId: id });
  const totalMin = minutesBetween(0, Date.now() + 1, { subjectId: id });
  const avg = gradeAverage(id);
  const ex = upcomingExams().filter((e) => e.subjectId === id);
  const ts = openTasks().filter((t) => t.subjectId === id);
  const its = S.data.items.filter((i) => i.subjectId === id).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 6);
  return `
    ${head(s.name, {
      back: '#home',
      actions: iconBtn('edit-subject', ICON.edit, 'עריכת מקצוע', `data-id="${id}"`),
      sub: `<span class="dot lg" style="background:var(--c${s.color % 8})"></span>${s.classroomId ? ' מחובר ל-Classroom' : ''}`,
    })}
    <div class="card stat-tiles three">
      <div class="stat"><span class="stat-label">השבוע</span>${statVal(weekMin)}</div>
      <div class="stat"><span class="stat-label">סה״כ</span>${statVal(totalMin)}</div>
      <div class="stat"><span class="stat-label">ממוצע</span><span class="stat-value">${avg ?? '—'}</span></div>
    </div>
    <div class="quick">
      <button class="quick-btn" data-act="add-exam" data-subject="${id}"><span>${ICON.exam}</span>מבחן</button>
      <button class="quick-btn" data-act="add-task" data-subject="${id}"><span>${ICON.tasks}</span>משימה</button>
      <button class="quick-btn" data-act="new-note" data-subject="${id}"><span>${ICON.note}</span>סיכום</button>
      <button class="quick-btn" data-act="subject-study" data-id="${id}"><span>${ICON.timer}</span>ללמוד</button>
    </div>
    ${section('מבחנים קרובים', ex.length ? `<div class="stack">${ex.map(examCard).join('')}</div>` : empty('🎉', 'אין מבחנים קרובים במקצוע הזה'))}
    ${section('משימות פתוחות', ts.length ? `<div class="card list">${ts.map(taskRow).join('')}</div>` : empty('✅', 'אין משימות פתוחות'))}
    ${section(
      'חומר וסיכומים',
      its.length
        ? `<div class="card list">${its.map((it) => `<button class="row-btn" data-go="#item-${it.id}"><span class="item-thumb sm k-${itemKind(it)}">${KIND_ICON[itemKind(it)]}</span><span class="grow">${esc(it.title || 'ללא כותרת')}</span></button>`).join('')}</div>`
        : empty('📚', 'עוד אין חומר במקצוע הזה')
    )}
  `;
}

// ---------- SETTINGS ----------

export function more() {
  const d = S.data;
  const token = getToken();
  const clientId = d.settings.clientId;
  const lastSync = d.settings.lastSync ? fmtDateTime(d.settings.lastSync) : 'עוד לא';
  const mode = storageMode();
  return `
    ${head('הגדרות', { back: '#home' })}

    ${section(
      'פרופיל ומטרות',
      `<div class="card form-list">
        <label class="form-row"><span>שם</span><input data-setting="profile.name" value="${esc(d.profile.name)}" placeholder="איך לקרוא לך?" autocomplete="given-name"></label>
        <label class="form-row"><span>מטרה שבועית (שעות)</span><input type="number" inputmode="numeric" min="1" max="80" data-setting="settings.weeklyGoalH" value="${esc(d.settings.weeklyGoalH)}"></label>
        <label class="form-row"><span>אורך פומודורו (דקות)</span><input type="number" inputmode="numeric" min="5" max="120" data-setting="settings.pomodoroMin" value="${esc(d.settings.pomodoroMin)}"></label>
      </div>`
    )}

    ${section(
      'מקצועות',
      `<div class="card list">
        ${d.subjects
          .map(
            (s) => `<button class="row-btn" data-act="edit-subject" data-id="${s.id}">
              <span class="dot" style="background:var(--c${s.color % 8})"></span><span class="grow">${esc(s.name)}</span>
              ${s.classroomId ? '<span class="badge">Classroom</span>' : ''}<span class="chev">${ICON.fwd}</span></button>`
          )
          .join('')}
        <button class="row-btn accent" data-act="add-subject">${ICON.plus}<span class="grow">הוספת מקצוע</span></button>
      </div>`
    )}

    ${section(
      'חיבורים',
      `<div class="card connect">
        <div class="connect-head"><span class="logo gc" aria-hidden="true">GC</span><div><b>Google Classroom</b><br><span class="muted small">משימות, מבחנים וחומרים מהכיתות שלך · סנכרון אחרון: ${lastSync}</span></div></div>
        <label class="field"><span class="field-label">Client ID</span>
          <input data-setting="settings.clientId" value="${esc(clientId)}" placeholder="xxxx.apps.googleusercontent.com" dir="ltr" autocapitalize="off" spellcheck="false"></label>
        <button class="btn primary block" data-act="gc-sync" ${clientId ? '' : 'disabled'}>${ICON.sync} ${token ? 'סנכרון עכשיו' : 'התחברות לגוגל וסנכרון'}</button>
        ${token ? `<button class="btn ghost block sm" data-act="gc-logout">התנתקות</button>` : ''}
        <details class="help">
          <summary>איך מחברים? (פעם אחת, 5 דקות)</summary>
          <ol>
            <li>נכנסים ל-<a href="https://console.cloud.google.com/" target="_blank" rel="noopener">Google Cloud Console</a> עם החשבון שלך ויוצרים פרויקט חדש.</li>
            <li>בחיפוש למעלה: <b>Google Classroom API</b> ← <b>Enable</b>.</li>
            <li><b>OAuth consent screen</b> (או Google Auth Platform): סוג <b>External</b>, שם לאפליקציה, המייל שלך — ומוסיפים את עצמך תחת <b>Test users</b>.</li>
            <li><b>Credentials ← Create credentials ← OAuth client ID</b>, סוג <b>Web application</b>.</li>
            <li>תחת <b>Authorized JavaScript origins</b>: <code class="copy" data-act="copy" data-text="${esc(location.origin)}">${esc(location.origin)}</code></li>
            <li>תחת <b>Authorized redirect URIs</b>: <code class="copy" data-act="copy" data-text="${esc(redirectURI())}">${esc(redirectURI())}</code></li>
            <li>מעתיקים את ה-Client ID לשדה למעלה ולוחצים "התחברות".</li>
          </ol>
          <p class="muted small">לחיצה על כתובת מעתיקה אותה. בחשבון של בית ספר (Google Workspace for Education) מנהל המערכת יכול לחסום אפליקציות חיצוניות — ואז זה לא יעבוד עד שיאשרו. הנתונים נשארים רק בטלפון שלך.</p>
        </details>
      </div>

      <div class="card connect">
        <div class="connect-head"><span class="logo wt" aria-hidden="true">W</span><div><b>וובטופ (Webtop)</b><br><span class="muted small">לוובטופ אין חיבור פתוח לאפליקציות, אז מייבאים בהעתק-הדבק</span></div></div>
        <a class="btn ghost block" href="https://webtop.smartschool.co.il/" target="_blank" rel="noopener">${ICON.ext} פתיחת וובטופ</a>
        <button class="btn primary block" data-act="webtop-paste">ייבוא מבחנים / משימות מהדבקה</button>
        <details class="help">
          <summary>איך זה עובד?</summary>
          <ol>
            <li>בוובטופ נכנסים ל<b>לוח מבחנים</b> (או שיעורי בית).</li>
            <li>מסמנים את הטבלה (לחיצה ארוכה ← גרירה) ובוחרים <b>העתקה</b>.</li>
            <li>חוזרים לכאן, לוחצים "ייבוא" ומדביקים. האפליקציה מזהה תאריכים ומקצועות, ואפשר לתקן לפני השמירה.</li>
          </ol>
        </details>
      </div>`
    )}

    ${section(
      'גיבוי',
      `<div class="card list">
        <button class="row-btn" data-act="export">${ICON.share}<span class="grow">ייצוא גיבוי (קובץ)</span></button>
        <label class="row-btn">${ICON.clip}<span class="grow">שחזור מגיבוי</span><input type="file" accept="application/json,.json" data-import hidden></label>
        <button class="row-btn danger" data-act="reset">${ICON.trash}<span class="grow">מחיקת כל הנתונים</span></button>
      </div>
      <p class="muted small pad">הכל נשמר רק במכשיר הזה${mode === 'idb' ? '' : mode === 'ls' ? ' (אחסון מוגבל)' : ' — <b>אחסון זמני בלבד בדפדפן הזה, הנתונים יימחקו בסגירה</b>'}. כדאי לייצא גיבוי מדי פעם (אפשר לשמור ב-iCloud Drive).</p>`
    )}

    ${
      isStandalone()
        ? ''
        : section(
            'התקנה באייפון',
            `<div class="card"><ol class="steps">
              <li>פותחים את האתר הזה ב<b>ספארי</b></li>
              <li>לוחצים על כפתור השיתוף <span class="inline-ico">${ICON.share}</span></li>
              <li>"<b>הוספה למסך הבית</b>" ← "הוספה"</li>
            </ol></div>`
          )
    }
    <p class="muted small center">הלימודים שלי · גרסה 1.0</p>
  `;
}

export function notFound(back) {
  return `${head('לא נמצא', { back })}${empty('🤷', 'הפריט הזה נמחק או לא קיים')}`;
}
