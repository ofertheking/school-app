// Screen renderers. Each returns an HTML string; app.js wires the actions.
import {
  S, subject, subjectName, subjectColor, readiness, upcomingExams, pastExams, openTasks,
  gradeAverage, todayMinutes, weekDays, weekBySubject, streak, timerElapsed, examUrgency,
  dueLabelGroup, itemKind, exam, item, task, minutesBetween, COMMON_SUBJECTS, currentYear, hasGrade,
} from './core.js';
import {
  esc, fmtDate, fmtDateLong, fmtHebrewDate, fmtMin, fmtClock, relDay, daysUntil, greeting,
  weekStart, addDays, fmtDayMonth, isIOS, isStandalone, fmtDateTime, norm, isoDate, fmtMinShort,
} from './util.js';
import { weekChart, subjectBars, meter, ring } from './charts.js';
import { ICON } from './icons.js';
import { getToken, redirectURI, connectedEmail } from './integrations.js';
import { storageMode } from './store.js';
import { head, iconBtn, section, empty, seg, dot, subjectChip, tile } from './components.js';
import { gradesView } from './grades.js';
import { calendarView } from './calendar.js';
import { ACCENTS, appearance } from './appearance.js';
import { todaySection } from './schedule.js';
import { webtopRows } from './webtop.js';
import { decksList } from './flashcards.js';
import { filesGrid, attachBar, filesSummary } from './files.js';
import { notebooksGrid } from './notebooks.js';
import { recoverCard } from './recover.js';

// ---------- shared bits ----------

function statVal(min) {
  const { value, unit } = fmtMinShort(min);
  return `<span class="stat-value"><bdi>${value}</bdi> <small>${unit}</small></span>`;
}

export function examCard(e) {
  const r = readiness(e);
  const n = daysUntil(e.date);
  const past = n < 0 || e.done;
  const right =
    e.grade !== '' && e.grade != null
      ? `<span class="grade">${esc(e.grade)}</span>`
      : past
      ? `<span class="chip done">✓ נגמר</span>`
      : `<span class="chip ${examUrgency(e)}">${relDay(e.date)}</span>`;
  return `<button class="card exam-card" data-go="#exam-${e.id}">
    <span class="stripe" style="background:${subjectColor(e.subjectId)}"></span>
    <span class="exam-main">
      <span class="row between"><span class="eyebrow">${esc(subjectName(e.subjectId))} · ${esc(e.type || 'מבחן')}</span>${right}</span>
      <span class="title">${esc(e.title || e.type || 'מבחן')}</span>
      <span class="muted small">${fmtDate(e.date)}${e.time ? ` · <bdi>${esc(e.time)}</bdi>` : ''}${(e.materialFiles || []).length + (e.itemIds || []).length ? ` · 📎 ${(e.materialFiles || []).length + (e.itemIds || []).length}` : ''}${(e.paperFiles || []).length ? ' · 📷' : ''}</span>
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
  const files = (t.materialFiles || []).length + (t.workFiles || []).length;
  const quickAttach = t.done && !(t.workFiles || []).length
    ? `<label class="row-attach" aria-label="הוספת העבודה שהגשתי">${ICON.clip}<input type="file" multiple data-attach-ref="task:${t.id}:work" hidden></label>`
    : '';
  return `<div class="task-row${t.done ? ' done' : ''}">
    <button class="check${t.done ? ' on' : ''}" data-act="task-toggle" data-id="${t.id}" aria-label="${t.done ? 'סימון כלא בוצע' : 'סימון כבוצע'}">${ICON.check}</button>
    <button class="task-body" data-go="#task-${t.id}">
      <span class="task-title">${esc(t.title)}</span>
      <span class="task-meta">${dot(t.subjectId)}${esc(subjectName(t.subjectId))}${
        t.due ? ` · <span class="${late ? 'late' : ''}">${late ? '⚠︎ ' : ''}${relDay(t.due)}</span>` : ''
      }${files ? ` · 📎 ${files}` : ''}${t.source === 'classroom' ? ' · <span class="badge">Classroom</span>' : ''}</span>
    </button>
    ${quickAttach}${hasGrade(t) ? `<span class="task-grade">${esc(t.grade)}</span>` : ''}
  </div>`;
}

/** Shown when the saved data couldn't be read — nothing is written until it can. */
function loadFailedCard() {
  if (!S.loadFailed) return '';
  return `<div class="card recover-card">
    <div class="recover-head">${tile('sync', 'red')}<b>לא הצלחתי לפתוח את הנתונים השמורים</b></div>
    <p class="muted small">שום דבר לא נמחק, והאפליקציה לא תשמור כלום עד שהנתונים ייפתחו. סגור/י את האפליקציה לגמרי (החלקה למעלה) ופתח/י שוב.</p>
    <button class="btn primary block" data-act="reload-app">לנסות שוב עכשיו</button>
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
  const today = fmtMinShort(todayMinutes());
  const week = fmtMinShort(weekMin);
  const exams = upcomingExams().slice(0, 3);
  const tasks = openTasks().slice(0, 5);

  const studyCard = `<button class="card sum-card" data-go="#study">
    <span class="sum-head">${ICON.timer} שעות למידה <span class="chev">${ICON.fwd}</span></span>
    <span class="sum-body">
      <span>
        <span class="sum-big"><bdi>${today.value}</bdi></span><span class="sum-unit">${today.unit} היום</span>
        <span class="sum-stats">
          <span class="stat"><span class="stat-label">השבוע</span><span class="stat-value"><bdi>${week.value}</bdi> <small>${week.unit}</small></span></span>
          <span class="stat"><span class="stat-label">מטרה</span><span class="stat-value">${d.settings.weeklyGoalH} <small>ש׳</small></span></span>
          <span class="stat"><span class="stat-label">רצף</span><span class="stat-value">${st} <small>${st === 1 ? 'יום' : 'ימים'}</small></span></span>
        </span>
      </span>
      ${ring(pct, `${Math.round(pct)}%`, 'מהמטרה')}
    </span>
  </button>`;

  const quick = `<div class="quick">
    <button class="quick-btn" data-act="add-exam">${tile('exam', 'red')}מבחן</button>
    <button class="quick-btn" data-act="add-task">${tile('tasks', 'orange')}משימה</button>
    <button class="quick-btn" data-act="new-note">${tile('note', 'green')}סיכום</button>
    <button class="quick-btn" data-go="#study">${tile('timer', 'purple')}ללמוד</button>
  </div>`;

  return `
    ${head(`${greeting(now)}${name}`, {
      actions: `${iconBtn('go-search', ICON.search, 'חיפוש')}${iconBtn('go-more', ICON.gear, 'הגדרות')}`,
      sub: `${fmtDateLong(now)}${heb ? ` · ${heb}` : ''}`,
    })}
    ${loadFailedCard()}
    ${recoverCard()}
    ${installCard()}
    ${S.loadFailed ? '' : onboardingCard()}
    ${timerBanner()}
    ${studyCard}
    ${quick}
    ${todaySection()}
    ${section(
      'מבחנים קרובים',
      exams.length ? `<div class="stack">${exams.map(examCard).join('')}</div>` : `<div class="card">${empty('🎉', 'אין מבחנים קרובים', `<button class="btn tinted" data-act="add-exam">${ICON.plus} הוספת מבחן</button>`)}</div>`,
      `<button class="link-btn" data-go="#exams">הכל</button>`
    )}
    ${section(
      'משימות',
      tasks.length ? `<div class="card list">${tasks.map(taskRow).join('')}</div>` : `<div class="card">${empty('✅', 'אין משימות פתוחות')}</div>`,
      `<button class="link-btn" data-go="#tasks">הכל</button>`
    )}
    ${d.lessons.length ? '' : `<div class="card list"><button class="row-btn" data-go="#schedule">${tile('calendar', 'teal')}<span class="grow">מערכת שעות<span class="sr-sub">להוסיף ידנית או לייבא מ-PDF</span></span><span class="chev">${ICON.fwd}</span></button></div>`}
    ${
      d.subjects.length
        ? section('המקצועות שלי', `<div class="chip-scroll">${d.subjects.map((s) => subjectChip(s)).join('')}<button class="chip-btn add" data-act="add-subject" aria-label="הוספת מקצוע">${ICON.plus}</button></div>`)
        : ''
    }
  `;
}

// ---------- EXAMS ----------

export function exams() {
  if (!['upcoming', 'calendar', 'grades'].includes(S.ui.examsSeg)) S.ui.examsSeg = S.ui.examsSeg === 'past' ? 'grades' : 'upcoming';
  const segCtl = seg('examsSeg', [['upcoming', 'קרובים'], ['calendar', 'לוח שנה'], ['grades', 'ציונים']]);
  let body;
  if (S.ui.examsSeg === 'calendar') body = calendarView(examCard, taskRow);
  else if (S.ui.examsSeg === 'grades') body = gradesView(examCard);
  else {
    const list = upcomingExams();
    body = list.length
      ? `<div class="stack">${list.map(examCard).join('')}</div>`
      : `<div class="card">${empty('📅', 'אין מבחנים קרובים. אפשר להוסיף מבחנים, או לייבא את לוח המבחנים מוובטופ בהגדרות.', `<button class="btn tinted" data-act="add-exam">${ICON.plus} הוספת מבחן</button>`)}</div>`;
  }
  return `
    ${head('מבחנים', { actions: iconBtn('add-exam', ICON.plus, 'הוספת מבחן') })}
    ${segCtl}
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
  const past = n < 0 || e.done;
  const r = readiness(e);
  const topics = e.topics || [];
  const mastered = topics.filter((t) => t.s === 2).length;
  const studied = minutesBetween(0, Date.now() + 1, { examId: e.id });
  const linked = (e.itemIds || []).map((x) => item(x)).filter(Boolean);
  const hasGrade = e.grade !== '' && e.grade != null;
  const big = past
    ? `<b class="hero-num">${hasGrade ? esc(e.grade) : '✓'}</b><span>${hasGrade ? 'ציון' : 'המבחן נגמר'}</span>`
    : n > 1 ? `<b class="hero-num">${n}</b><span>ימים למבחן</span>` : n === 1 ? `<b class="hero-num">מחר</b><span>בהצלחה!</span>` : `<b class="hero-num">היום</b><span>בהצלחה! 🍀</span>`;

  const material = section(
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
    </div>
    <div class="card">
      <h3 class="card-title">${ICON.clip} קבצים וצילומים</h3>
      <p class="muted small">דף החומר מהמורה, מצגות, PDF, צילומים מהספר או מהלוח</p>
      ${filesGrid(`exam:${e.id}:material`, e.materialFiles || [], { addLabel: 'PDF / צילום' })}
    </div>
    <div class="card">
      <h3 class="card-title">${ICON.note} סיכומים למבחן</h3>
      ${
        linked.length
          ? `<div class="linked-list">${linked
              .map((it) => `<div class="linked-row"><button class="row-btn" data-go="#item-${it.id}"><span class="item-thumb sm k-${itemKind(it)}">${ICON.note}</span><span class="grow">${esc(it.title || 'ללא כותרת')}</span></button>
                <button class="icon-btn sm" data-act="exam-unlink" data-id="${e.id}" data-item="${it.id}" aria-label="הסרה מהמבחן">${ICON.x}</button></div>`)
              .join('')}</div>`
          : `<p class="muted small">אפשר לחבר לכאן סיכומים וסיכומי שיעור מהמחברת</p>`
      }
      <div class="row gap">
        <button class="btn tinted grow sm" data-act="exam-link-items" data-id="${e.id}">${ICON.link} חיבור סיכומים</button>
        <button class="btn ghost grow sm" data-act="exam-new-note" data-id="${e.id}">${ICON.plus} סיכום חדש</button>
      </div>
    </div>`
  );

  const paper = section(
    past ? 'הציון והמבחן שחזר' : 'אחרי המבחן',
    `<div class="card">
      <div class="row between">
        <label for="grade-${e.id}" class="muted">${n > 0 ? 'הציון (אחרי שהמבחן חוזר)' : 'מה קיבלת?'}</label>
        <input id="grade-${e.id}" class="grade-input" type="number" inputmode="decimal" min="0" max="100" data-bind="exam:${e.id}:grade" value="${esc(e.grade ?? '')}" placeholder="—">
      </div>
      <h3 class="card-title">${ICON.camera} צילומי המבחן</h3>
      <p class="muted small">${past ? 'מצלמים את המבחן שחזר, כדי לשמור תיעוד וללמוד מהטעויות לבגרות' : 'כשהמבחן יחזור אפשר לצלם אותו כאן, כדי לשמור תיעוד'}</p>
      ${filesGrid(`exam:${e.id}:paper`, e.paperFiles || [], { addLabel: 'צילום המבחן', accept: 'image/*,application/pdf' })}
    </div>`
  );

  return `
    ${head(e.title || e.type || 'מבחן', {
      back: '#exams',
      actions: iconBtn('edit-exam', ICON.edit, 'עריכה', `data-id="${e.id}"`),
      sub: `${dot(e.subjectId)} ${esc(subjectName(e.subjectId))} · ${esc(e.type || 'מבחן')} · ${fmtDate(e.date)}${e.time ? ` · <bdi>${esc(e.time)}</bdi>` : ''}`,
    })}
    <div class="card countdown ${n >= 0 ? examUrgency(e) : 'past'}">${big}</div>

    ${past ? paper : ''}
    ${material}

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

    ${past ? '' : paper}

    <div class="actions-col">
      <button class="btn ${e.done ? 'ghost' : 'tinted'} block" data-act="exam-done" data-id="${e.id}">${e.done ? '↩︎ המבחן עוד לא נגמר' : '✓ סימון שהמבחן נגמר'}</button>
      ${n >= 0 && !e.done ? `<button class="btn tinted block" data-act="exam-cal" data-id="${e.id}">${ICON.calendar} הוספה ליומן עם תזכורת</button>` : ''}
      ${e.link ? `<a class="btn ghost block" href="${esc(e.link)}" target="_blank" rel="noopener">${ICON.ext} פתיחה ב-Classroom</a>` : ''}
      <button class="btn danger-ghost block" data-act="del-exam" data-id="${e.id}">${ICON.trash} מחיקת המבחן</button>
    </div>
  `;
}

// ---------- TASKS ----------

export function taskDetail(id) {
  const t = task(id);
  if (!t) return notFound('#tasks');
  const n = t.due ? daysUntil(t.due) : null;
  const graded = hasGrade(t);
  let hero = '';
  if (t.done) {
    if (graded) hero = `<div class="card countdown done-hero"><b class="hero-num">${esc(t.grade)}</b><span>ציון</span></div>`;
  } else if (n != null) {
    const cls = n <= 1 ? 'hot' : n <= 3 ? 'warm' : 'cool';
    const big = n < 0 ? `<b class="hero-num">${-n}</b><span>${n === -1 ? 'יום באיחור' : 'ימים באיחור'}</span>`
      : n === 0 ? `<b class="hero-num">היום</b><span>להגשה</span>`
      : n === 1 ? `<b class="hero-num">מחר</b><span>להגשה</span>`
      : `<b class="hero-num">${n}</b><span>ימים להגשה</span>`;
    hero = `<div class="card countdown ${cls}">${big}</div>`;
  }

  const material = section(
    'החומר למשימה',
    `<div class="card">
      <p class="muted small">דף עבודה, הוראות מהמורה, צילום מהלוח או מהספר</p>
      ${filesGrid(`task:${t.id}:material`, t.materialFiles || [], { addLabel: 'PDF / צילום' })}
    </div>`
  );
  const workFiles = t.workFiles || [];
  const work = section(
    'ההגשה שלי',
    `<div class="card">
      <h3 class="card-title">${ICON.clip} העבודה שהגשתי</h3>
      <p class="muted small">${
        workFiles.length
          ? filesSummary(workFiles)
          : 'כמה שרוצים: תמונות, סרטונים, PDF, מצגות, Word ועוד — נשמר כתיעוד וללמידה למבחנים'
      }</p>
      ${attachBar(`task:${t.id}:work`)}
      ${filesGrid(`task:${t.id}:work`, workFiles, { add: false })}
      <div class="row between grade-line">
        <label for="tgrade-${t.id}" class="muted">ציון (אם יש)</label>
        <input id="tgrade-${t.id}" class="grade-input" type="number" inputmode="decimal" min="0" max="100" data-bind="task:${t.id}:grade" value="${esc(t.grade ?? '')}" placeholder="—">
      </div>
    </div>`
  );

  return `
    ${head(t.title || 'משימה', {
      back: '#tasks',
      actions: iconBtn('edit-task', ICON.edit, 'עריכה', `data-id="${t.id}"`),
      sub: `${dot(t.subjectId)} ${esc(subjectName(t.subjectId))}${t.due ? ` · עד ${fmtDate(t.due)}` : ''}`,
    })}
    ${hero}
    <button class="card task-status${t.done ? ' on' : ''}" data-act="task-toggle" data-id="${t.id}">
      <span class="check${t.done ? ' on' : ''}" aria-hidden="true">${ICON.check}</span>
      <span class="grow"><b>${t.done ? `בוצע${t.doneAt ? ` · ${fmtDate(isoDate(new Date(t.doneAt)))}` : ''}` : 'סימון כבוצע'}</b><span class="sr-sub">${t.done ? 'לחיצה מחזירה את המשימה לפתוחות' : 'אחרי זה אפשר להוסיף ציון וצילום של העבודה'}</span></span>
    </button>
    ${t.done ? work + material : material + work}
    ${section(
      'הערות',
      `<div class="card"><textarea class="autosize plain" data-bind="task:${t.id}:notes" rows="3" placeholder="עמודים, תרגילים, מה בדיוק צריך להגיש…">${esc(t.notes || '')}</textarea></div>`
    )}
    <div class="actions-col">
      ${t.link ? `<a class="btn ghost block" href="${esc(t.link)}" target="_blank" rel="noopener">${ICON.ext} פתיחה ב-Classroom</a>` : ''}
      <button class="btn danger-ghost block" data-act="del-task" data-id="${t.id}">${ICON.trash} מחיקת המשימה</button>
    </div>
  `;
}

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
  const segCtl = seg('studySeg', [['timer', 'טיימר ושעות'], ['cards', 'כרטיסיות']]);
  if (S.ui.studySeg === 'cards') {
    return `${head('למידה')}${segCtl}${decksList()}`;
  }
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
    ${head('למידה', { actions: iconBtn('add-session', ICON.plus, 'הוספת זמן ידנית') })}
    ${segCtl}
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

const KIND_ICON = { note: ICON.note, lesson: ICON.calendar, file: ICON.clip, link: ICON.link, notebook: ICON.camera };

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
  const kinds = [['all', 'הכל'], ['note', 'סיכומים'], ['lesson', 'סיכומי שיעור'], ['notebook', 'דפי מחברת'], ['file', 'קבצים ותמונות'], ['link', 'קישורים']];
  const viewSeg = seg('libView', [['notebooks', 'מחברות'], ['all', 'כל החומר']]);
  if (S.ui.libView !== 'all') {
    return `
      ${head('חומר וסיכומים', { actions: iconBtn('add-item', ICON.plus, 'הוספת חומר') })}
      ${viewSeg}
      ${notebooksGrid()}`;
  }
  return `
    ${head('חומר וסיכומים', { actions: iconBtn('add-item', ICON.plus, 'הוספת חומר') })}
    ${viewSeg}
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
      back: it.notebook || S.ui.libView !== 'all' ? `#notebook-${it.subjectId || 'general'}` : '#library',
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
      ${it.lessonDate ? `<span class="chip cool lesson-chip">${ICON.calendar} סיכום שיעור · ${fmtDate(it.lessonDate)}</span>` : ''}
      <textarea class="editor-body autosize" data-bind="item:${it.id}:body" placeholder="${it.lessonDate ? 'מה למדנו? מושגים, הסברים, מה המורה הדגיש/ה…\nטיפ: שורות בצורה "מושג - הגדרה" אפשר להפוך לכרטיסיות' : 'כותבים כאן את הסיכום…'}">${esc(it.body || '')}</textarea>
      <button class="btn tinted block sm" data-act="note-to-cards" data-id="${it.id}">🃏 יצירת כרטיסיות מהסיכום</button>

      <div class="section-head"><h2>${it.notebook ? 'דפי המחברת' : 'קבצים ותמונות'}</h2></div>
      ${filesGrid(`item:${it.id}`, files, it.notebook ? { addLabel: 'עוד דפים', accept: 'image/*' } : {})}
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
    <button class="card row-btn nb-link" data-go="#notebook-${id}">📓<span class="grow"><b>המחברת של ${esc(s.name)}</b><br><span class="muted small">דפי מחברת, סיכומים, קבצים וכרטיסיות</span></span><span class="chev">${ICON.fwd}</span></button>
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
  const mode = storageMode();
  const ap = appearance();
  const chev = `<span class="chev">${ICON.fwd}</span>`;
  const initial = (d.profile.name || '').trim().slice(0, 1) || '🙂';
  return `
    ${head('הגדרות', { back: '#home' })}

    <div class="card profile-card">
      <span class="avatar" aria-hidden="true">${esc(initial)}</span>
      <span class="grow">
        <input class="profile-name" data-setting="profile.name" value="${esc(d.profile.name)}" placeholder="השם שלך" autocomplete="given-name" aria-label="שם">
        <span class="sr-sub">${d.subjects.length} מקצועות · ${d.exams.length} מבחנים · ${d.items.length} פריטי חומר</span>
      </span>
    </div>

    <h3 class="group-title">למידה</h3>
    <div class="card list">
      <label class="row-btn">${tile('target', 'red')}<span class="grow">מטרה שבועית</span>
        <input class="row-input" type="number" inputmode="numeric" min="1" max="80" data-setting="settings.weeklyGoalH" value="${esc(d.settings.weeklyGoalH)}" aria-label="מטרה שבועית בשעות"><span class="row-val">שעות</span></label>
      <label class="row-btn">${tile('timer', 'orange')}<span class="grow">אורך פומודורו</span>
        <input class="row-input" type="number" inputmode="numeric" min="5" max="120" data-setting="settings.pomodoroMin" value="${esc(d.settings.pomodoroMin)}" aria-label="אורך פומודורו בדקות"><span class="row-val">דקות</span></label>
    </div>

    <h3 class="group-title">מראה</h3>
    <div class="card appearance">
      <div class="seg theme-seg" role="radiogroup" aria-label="ערכת נושא">
        ${[['system', 'אוטומטי'], ['light', 'בהיר'], ['dark', 'כהה']]
          .map(([v, l]) => `<button class="seg-btn${ap.theme === v ? ' on' : ''}" role="radio" aria-checked="${ap.theme === v}" data-act="set-theme" data-val="${v}">${l}</button>`)
          .join('')}
      </div>
      <div class="accent-row" role="radiogroup" aria-label="צבע ראשי">
        ${Object.entries(ACCENTS)
          .map(([k, c]) => `<button class="accent-dot${ap.accent === k ? ' on' : ''}" role="radio" aria-checked="${ap.accent === k}" aria-label="${c.name}" data-act="set-accent" data-val="${k}" style="--dotc:${c.light}"></button>`)
          .join('')}
      </div>
    </div>

    <h3 class="group-title">שנת לימודים</h3>
    <div class="card list">
      <button class="row-btn" data-act="year-open">${tile('grad', 'indigo')}<span class="grow">שנה נוכחית<span class="sr-sub">מעבר בין שנים, או פתיחת שנה חדשה</span></span>
        <span class="row-val">${esc(currentYear()?.name || '')}</span><span class="chev">${ICON.fwd}</span></button>
    </div>

    <h3 class="group-title">מקצועות</h3>
    <div class="card list">
      ${d.subjects
        .map(
          (s) => `<button class="row-btn" data-act="edit-subject" data-id="${s.id}">
            <span class="tile-ico" style="--tile:var(--c${s.color % 8})" aria-hidden="true">${ICON.book}</span><span class="grow">${esc(s.name)}</span>
            ${s.classroomId ? '<span class="badge">Classroom</span>' : ''}${chev}</button>`
        )
        .join('')}
      <button class="row-btn accent" data-act="add-subject"><span class="tile-ico t-gray" aria-hidden="true">${ICON.plus}</span><span class="grow">הוספת מקצוע</span></button>
    </div>

    <h3 class="group-title">חיבורים</h3>
    ${webtopRows()}
    <div class="card list">
      <button class="row-btn" data-act="gc-open"><span class="tile-ico t-green" aria-hidden="true"><b class="tile-letter">G</b></span>
        <span class="grow">Google Classroom<span class="sr-sub">${connectedEmail() ? `${token ? 'מחובר/ת' : 'חשבון אחרון'}: <bdi>${esc(connectedEmail())}</bdi>` : 'לחשבונות שמאפשרים חיבור'}</span></span>${chev}</button>
    </div>

    <h3 class="group-title">נתונים</h3>
    <div class="card list">
      <button class="row-btn" data-act="export">${tile('share', 'blue')}<span class="grow">ייצוא גיבוי</span>${chev}</button>
      <label class="row-btn">${tile('cloud', 'indigo')}<span class="grow">שחזור מגיבוי</span>${chev}<input type="file" accept="application/json,.json" data-import hidden></label>
      <button class="row-btn" data-act="recover-open">${tile('sync', 'orange')}<span class="grow">שחזור דברים שנעלמו<span class="sr-sub">מחפש עותקים קודמים במכשיר</span></span>${chev}</button>
      <button class="row-btn danger" data-act="reset">${tile('trash', 'red')}<span class="grow">מחיקת כל הנתונים</span></button>
    </div>
    <p class="card-foot">הכל נשמר רק במכשיר הזה, ועותק אוטומטי נשמר כל יום${mode === 'idb' ? '' : mode === 'ls' ? ' (אחסון מוגבל)' : '. <b>זה אחסון זמני בלבד בדפדפן הזה, והנתונים יימחקו כשסוגרים אותו</b>'}. כדאי לייצא גיבוי מדי פעם, למשל ל-iCloud Drive.</p>

    ${
      isStandalone()
        ? ''
        : `<h3 class="group-title">התקנה באייפון</h3>
           <div class="card"><ol class="steps">
             <li>פותחים את האתר הזה ב<b>ספארי</b></li>
             <li>לוחצים על כפתור השיתוף <span class="inline-ico">${ICON.share}</span></li>
             <li>"<b>הוספה למסך הבית</b>" ← "הוספה"</li>
           </ol></div>`
    }
    <p class="muted small center version">הלימודים שלי · גרסה 2.0</p>
  `;
}

/** Google Classroom settings, shown in a sheet. */
export function classroomSheetHTML() {
  const d = S.data;
  const token = getToken();
  const clientId = d.settings.clientId;
  const lastSync = d.settings.lastSync ? fmtDateTime(d.settings.lastSync) : 'עוד לא';
  return `<div class="sheet-head"><button type="button" class="link-btn" data-close>סגירה</button><h3>Google Classroom</h3><span></span></div>
    <p class="muted small">משימות, מבחנים וחומרים מהכיתות שלך · סנכרון אחרון: ${lastSync}</p>
    <label class="field"><span class="field-label">Client ID</span>
      <input data-setting="settings.clientId" value="${esc(clientId)}" placeholder="xxxx.apps.googleusercontent.com" dir="ltr" autocapitalize="off" spellcheck="false"></label>
    ${connectedEmail() ? `<p class="small connected-as">${token ? 'מחובר/ת כ-' : 'חשבון אחרון: '}<bdi dir="ltr">${esc(connectedEmail())}</bdi></p>` : ''}
    <div class="actions-col tight">
      <button class="btn primary block" data-act="gc-sync" ${clientId ? '' : 'disabled'}>${ICON.sync} ${token ? 'סנכרון עכשיו' : 'התחברות לגוגל וסנכרון'}</button>
      ${connectedEmail() || token ? `<button class="btn ghost block" data-act="gc-switch" ${clientId ? '' : 'disabled'}>החלפת חשבון גוגל</button>` : ''}
    </div>
    <details class="help">
      <summary>איך מחברים? (פעם אחת, 5 דקות)</summary>
      <ol>
        <li>נכנסים ל-<a href="https://console.cloud.google.com/" target="_blank" rel="noopener">Google Cloud Console</a> ויוצרים פרויקט.</li>
        <li>מפעילים את <b>Google Classroom API</b>.</li>
        <li><b>Google Auth Platform</b>: סוג <b>External</b>, ומוסיפים את המייל שלך תחת <b>Test users</b>.</li>
        <li><b>Clients ← Create client ← Web application</b>.</li>
        <li><b>Authorized JavaScript origins</b>: <code class="copy" data-act="copy" data-text="${esc(location.origin)}">${esc(location.origin)}</code></li>
        <li><b>Authorized redirect URIs</b>: <code class="copy" data-act="copy" data-text="${esc(redirectURI())}">${esc(redirectURI())}</code></li>
        <li>מעתיקים את ה-Client ID לשדה למעלה.</li>
      </ol>
      <p class="muted small">לחיצה על כתובת מעתיקה אותה. בחשבון של בית ספר, מנהל המערכת יכול לחסום אפליקציות חיצוניות.</p>
    </details>`;
}

/** School-year picker shown in a sheet. */
export function yearSheetHTML() {
  const d = S.data;
  const cur = d.currentYear;
  return `<div class="sheet-head"><button type="button" class="link-btn" data-close>סגירה</button><h3>שנת לימודים</h3><span></span></div>
    <p class="muted small">כל שנה שומרת מערכת, מבחנים, ציונים וחומר נפרדים. אפשר לעבור בין שנים בכל רגע.</p>
    <div class="card list">
      ${d.years
        .map(
          (y) => `<div class="row-btn year-row">${tile('grad', y.id === cur ? 'indigo' : 'gray')}
            <button class="grow year-pick" data-act="year-switch" data-id="${y.id}">${esc(y.name)}${y.id === cur ? ' <span class="chip cool">נוכחית</span>' : ''}</button>
            <button class="icon-btn sm" data-act="year-rename" data-id="${y.id}" aria-label="שינוי שם">${ICON.edit}</button>
            ${y.id === cur ? `<span class="check-mark">${ICON.check}</span>` : ''}</div>`
        )
        .join('')}
      <button class="row-btn accent" data-act="year-add"><span class="tile-ico t-gray" aria-hidden="true">${ICON.plus}</span><span class="grow">הוספת שנה חדשה</span></button>
    </div>`;
}

export function notFound(back) {
  return `${head('לא נמצא', { back })}${empty('🤷', 'הפריט הזה נמחק או לא קיים')}`;
}
