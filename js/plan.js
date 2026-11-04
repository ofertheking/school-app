// Study plan: an exam's topics that aren't mastered yet, spread over the days
// left before it, with the last day kept for a full review. It's computed live,
// so ticking a topic or changing the date reshapes the plan by itself.
import { S, upcomingExams, subjectName, subjectColor, subjectNames, subjectPaint } from './core.js';
import { esc, isoDate, addDays, startOfDay, daysUntil, relDay } from './util.js';
import { ICON } from './icons.js';
import { section } from './components.js';

const STATES = [
  { cls: 's0', label: 'עוד לא' },
  { cls: 's1', label: 'בתהליך' },
  { cls: 's2', label: 'שולט/ת' },
];

/** [{ date, topics: [topic], review }] or null when there's nothing to plan. */
export function studyPlan(e) {
  const topics = e.topics || [];
  const n = daysUntil(e.date);
  if (!topics.length || n < 0 || e.done) return null;
  const left = topics.filter((t) => (t.s || 0) < 2);
  const today = startOfDay();
  const days = [];
  // Study days: from today until the day before the exam (today only if it's tomorrow / today).
  const review = n >= 2;
  const slots = Math.max(1, review ? n - 1 : n || 1);
  const per = Math.max(1, Math.ceil(left.length / slots));
  for (let d = 0; d < slots && d * per < left.length; d++) {
    days.push({ date: isoDate(addDays(today, d)), topics: left.slice(d * per, (d + 1) * per), review: false });
  }
  if (review) days.push({ date: isoDate(addDays(today, n - 1)), topics, review: true });
  return days;
}

function topicBtn(e, t) {
  const st = STATES[t.s || 0];
  return `<button class="topic-state ${st.cls}" data-act="topic-cycle" data-id="${e.id}" data-tid="${t.id}" aria-label="מצב: ${st.label}. לחיצה משנה">
    <span class="ts-ico" aria-hidden="true"></span><span class="ts-label">${st.label}</span></button>`;
}

/** Exam page: the plan as a timeline. */
export function planSection(e) {
  const topics = e.topics || [];
  if (e.done || daysUntil(e.date) < 0) return '';
  if (!topics.length) {
    return section('תוכנית למידה', `<div class="card plan-empty"><span class="plan-ico">${ICON.calendar}</span>
      <p class="muted small">מוסיפים למעלה את הנושאים למבחן — ונבנה לך תוכנית: מה ללמוד בכל יום עד המבחן, ויום חזרה בסוף.</p></div>`);
  }
  const plan = studyPlan(e) || [];
  const left = topics.filter((t) => (t.s || 0) < 2).length;
  return section(
    'תוכנית למידה',
    `<div class="card plan">
      ${left ? '' : `<p class="plan-done">כל הנושאים בשליטה 🎉 נשאר רק לחזור על הכל לפני המבחן.</p>`}
      <ol class="plan-days">${plan
        .map(
          (d) => `<li class="plan-day${d.date === isoDate() ? ' today' : ''}${d.review ? ' review' : ''}">
            <span class="pd-dot" aria-hidden="true"></span>
            <div class="pd-body">
              <b class="pd-when">${relDay(d.date)}${d.review ? ' · חזרה על הכל' : ''}</b>
              ${
                d.review
                  ? `<span class="muted small">${topics.length} נושאים · פותרים מבחן לדוגמה</span>`
                  : `<div class="pd-topics">${d.topics.map((t) => `<span class="pd-topic">${esc(t.text)}</span>`).join('')}</div>`
              }
            </div>
          </li>`
        )
        .join('')}
        <li class="plan-day exam"><span class="pd-dot" aria-hidden="true"></span><div class="pd-body"><b class="pd-when">${relDay(e.date)} · המבחן 🍀</b></div></li>
      </ol>
    </div>`
  );
}

/** Home: today's topics from every upcoming exam's plan. */
export function todayPlanCard() {
  const today = isoDate();
  const rows = [];
  for (const e of upcomingExams()) {
    const day = (studyPlan(e) || []).find((d) => d.date === today);
    if (!day) continue;
    if (day.review) rows.push({ e, review: true });
    else for (const t of day.topics) rows.push({ e, t });
  }
  if (!rows.length) return '';
  return section(
    'ללמוד היום',
    `<div class="card list today-plan">${rows
      .slice(0, 6)
      .map(({ e, t, review }) => `<div class="tp-row">
        <span class="dot" style="background:${subjectPaint(e)}"></span>
        <button class="tp-text" data-go="#exam-${e.id}"><b>${review ? 'חזרה על כל החומר' : esc(t.text)}</b>
          <span class="sr-sub">${esc(subjectNames(e))} · ${esc(e.title || e.type)} · ${relDay(e.date)}</span></button>
        ${review ? `<button class="icon-btn sm tp-play" data-act="exam-study" data-id="${e.id}" aria-label="ללמוד עכשיו">${ICON.play}</button>` : topicBtn(e, t)}
      </div>`)
      .join('')}</div>`,
    `<span class="muted small">${rows.length > 6 ? `ועוד ${rows.length - 6}` : ''}</span>`
  );
}

