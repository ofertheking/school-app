// Month calendar of exams and tasks (Apple Calendar style), RTL: Sunday on the right.
import { S, subjectColor } from './core.js';
import { esc, isoDate, parseISO, fmtDateLong, DAY_LETTERS, pad } from './util.js';
import { ICON } from './icons.js';
import { empty } from './components.js';
import { rerender } from './router.js';

const monthFmt = new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric' });

function monthOf() {
  if (!S.ui.calMonth) S.ui.calMonth = isoDate().slice(0, 7);
  if (!S.ui.calDay) S.ui.calDay = isoDate();
  const [y, m] = S.ui.calMonth.split('-').map(Number);
  return { y, m };
}

export function calendarView(examCard, taskRow) {
  const { y, m } = monthOf();
  const first = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const today = isoDate();
  const sel = S.ui.calDay;

  const examsOn = (iso) => S.data.exams.filter((e) => e.date === iso);
  const tasksOn = (iso) => S.data.tasks.filter((t) => t.due === iso && !t.done);

  let cells = '';
  for (let i = 0; i < first.getDay(); i++) cells += '<span class="cal-cell blank"></span>';
  for (let d = 1; d <= days; d++) {
    const iso = `${y}-${pad(m)}-${pad(d)}`;
    const ex = examsOn(iso);
    const tk = tasksOn(iso);
    const dots = [
      ...ex.slice(0, 3).map((e) => `<i style="background:${subjectColor(e.subjectId)}"></i>`),
      ...(tk.length && ex.length < 3 ? ['<i class="task-dot"></i>'] : []),
    ].join('');
    const label = `${d}${ex.length ? `, ${ex.length} מבחנים` : ''}${tk.length ? `, ${tk.length} משימות` : ''}`;
    cells += `<button class="cal-cell${iso === today ? ' today' : ''}${iso === sel ? ' sel' : ''}${iso < today ? ' past' : ''}" data-act="cal-day" data-date="${iso}" aria-label="${label}" aria-pressed="${iso === sel}">
      <span class="cal-num">${d}</span><span class="cal-dots">${dots}</span></button>`;
  }

  const ex = examsOn(sel);
  const tk = S.data.tasks.filter((t) => t.due === sel);
  const list =
    ex.length || tk.length
      ? `${ex.length ? `<div class="stack">${ex.map(examCard).join('')}</div>` : ''}${tk.length ? `<div class="card list cal-tasks">${tk.map(taskRow).join('')}</div>` : ''}`
      : empty('calendar', 'אין מבחנים או משימות ביום הזה');

  return `
    <div class="card cal">
      <div class="cal-head">
        <button class="icon-btn" data-act="cal-month" data-d="-1" aria-label="החודש הקודם">${ICON.back}</button>
        <b>${esc(monthFmt.format(first))}</b>
        <button class="icon-btn" data-act="cal-month" data-d="1" aria-label="החודש הבא">${ICON.fwd}</button>
      </div>
      <div class="cal-grid cal-wd">${DAY_LETTERS.map((l) => `<span>${l.replace('׳', '')}</span>`).join('')}</div>
      <div class="cal-grid">${cells}</div>
      ${S.ui.calMonth !== today.slice(0, 7) ? `<button class="link-btn cal-today" data-act="cal-today">היום</button>` : ''}
    </div>
    <div class="cal-day-head">
      <h2>${fmtDateLong(parseISO(sel))}</h2>
      <button class="btn tinted sm" data-act="add-exam" data-date="${sel}">${ICON.plus} מבחן</button>
    </div>
    ${list}
  `;
}

export const actions = {
  'cal-day'({ date }) {
    S.ui.calDay = date;
    rerender();
  },
  'cal-month'({ d }) {
    const { y, m } = monthOf();
    const next = new Date(y, m - 1 + +d, 1);
    S.ui.calMonth = `${next.getFullYear()}-${pad(next.getMonth() + 1)}`;
    S.ui.calDay = isoDate(next);
    rerender();
  },
  'cal-today'() {
    S.ui.calMonth = isoDate().slice(0, 7);
    S.ui.calDay = isoDate();
    rerender();
  },
};
