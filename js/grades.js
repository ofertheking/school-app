// Grades (ציונים): overall average, per-subject averages with a trend line, past exams.
import { S, subject, subjectName, subjectColor, pastExams } from './core.js';
import { esc, fmtDate } from './util.js';
import { ICON } from './icons.js';
import { empty, section } from './components.js';

const graded = () =>
  S.data.exams
    .filter((e) => e.grade !== '' && e.grade != null && !isNaN(+e.grade))
    .sort((a, b) => a.date.localeCompare(b.date));
const avg = (list) => Math.round((list.reduce((a, e) => a + +e.grade, 0) / list.length) * 10) / 10;

/** Tiny trend line scaled to its own range (each row stands alone); 2px line, ringed end dot. */
function spark(values, color) {
  if (values.length < 2) return '<span class="spark-empty"></span>';
  const W = 76, H = 28, P = 5;
  let lo = Math.max(0, Math.min(...values) - 3);
  let hi = Math.min(100, Math.max(...values) + 3);
  if (hi - lo < 12) {
    const mid = (hi + lo) / 2;
    lo = mid - 6;
    hi = mid + 6;
  }
  const y = (v) => P + (1 - (v - lo) / (hi - lo)) * (H - 2 * P);
  // RTL: newest grade on the left (end of the reading direction).
  const x = (i) => W - P - (i / (values.length - 1)) * (W - 2 * P);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values.length - 1;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(last)}" cy="${y(values[last])}" r="4" fill="${color}" stroke="var(--card)" stroke-width="2"/>
  </svg>`;
}

export function gradesView(examCard) {
  const all = graded();
  const past = pastExams();
  if (!all.length) {
    return `${empty('chart', 'עוד אין ציונים. אחרי מבחן רושמים את הציון בעמוד המבחן, והממוצעים יופיעו כאן.')}
      ${past.length ? section('מבחנים שעברו', `<div class="stack">${past.map(examCard).join('')}</div>`) : ''}`;
  }
  const overall = avg(all);
  const recent = all.slice(-3);
  const before = all.slice(0, -3);
  const delta = before.length ? Math.round((avg(recent) - avg(before)) * 10) / 10 : null;

  const bySubject = new Map();
  for (const e of all) {
    const k = e.subjectId || '';
    if (!bySubject.has(k)) bySubject.set(k, []);
    bySubject.get(k).push(e);
  }
  const rows = [...bySubject.entries()]
    .map(([sid, list]) => ({ sid, list, a: avg(list) }))
    .sort((a, b) => b.a - a.a);

  return `
    <div class="card grade-hero">
      <span class="stat-label">ממוצע כללי</span>
      <span class="hero-grade">${overall}</span>
      <span class="muted small">${all.length} מבחנים עם ציון${
        delta != null && delta !== 0
          ? ` · <span class="${delta > 0 ? 'delta-up' : 'delta-down'}">${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)}</span> בשלושת האחרונים`
          : ''
      }</span>
    </div>
    ${section(
      'לפי מקצוע',
      `<div class="card list">${rows
        .map(
          ({ sid, list, a }) => `<button class="row-btn grade-row" ${subject(sid) ? `data-go="#subject-${sid}"` : ''}>
            <span class="dot lg" style="background:${subjectColor(sid)}"></span>
            <span class="grow"><b>${esc(subjectName(sid))}</b><span class="sr-sub">${list.length} ציונים · אחרון ${esc(list[list.length - 1].grade)}</span></span>
            ${spark(list.map((e) => +e.grade), subjectColor(sid))}
            <span class="grade-avg">${a}</span>
          </button>`
        )
        .join('')}</div>`
    )}
    ${section(
      'כל הציונים',
      `<div class="card list">${[...all]
        .reverse()
        .map(
          (e) => `<button class="row-btn" data-go="#exam-${e.id}">
            <span class="dot" style="background:${subjectColor(e.subjectId)}"></span>
            <span class="grow">${esc(e.title || e.type)}<span class="sr-sub">${esc(subjectName(e.subjectId))} · ${fmtDate(e.date)}</span></span>
            <span class="grade-pill">${esc(e.grade)}</span><span class="chev">${ICON.fwd}</span>
          </button>`
        )
        .join('')}</div>`
    )}
    ${past.some((e) => !all.includes(e)) ? section('עדיין בלי ציון', `<div class="stack">${past.filter((e) => !all.includes(e)).map(examCard).join('')}</div>`) : ''}
  `;
}
