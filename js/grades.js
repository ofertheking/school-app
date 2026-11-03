// Grades (ציונים), Webtop-style: overall and per-subject averages, half-years,
// a report card, a trend chart, a "what do I need on the next exam" calculator,
// attendance (חיסורים / איחורים), and reading grades copied from Webtop.
import { LOCALE, RTL } from './i18n.js';
import {
  S, save, subject, subjectName, subjectColor, pastExams, gradedRecords, hasGrade, semesterOf,
  weightedAverage, upcomingExams, EXAM_TYPES, schoolYearName,
} from './core.js';
import { esc, fmtDate, isoDate, relDay, uid, parseISO, startOfDay } from './util.js';
import { ICON } from './icons.js';
import { head, iconBtn, empty, section, seg, dot } from './components.js';
import { formSheet, askConfirm, toast, closeAllSheets } from './ui.js';
import { rerender } from './router.js';
import { matchSubject, typeOf } from './examBoard.js';
import { normalizeDates } from './integrations.js';

const SEMS = [['all', 'שנתי'], ['a', 'מחצית א׳'], ['b', 'מחצית ב׳']];
const semLabel = (k) => SEMS.find((x) => x[0] === k)?.[1] || '';
const curSem = () => (['all', 'a', 'b'].includes(S.ui.gradeSem) ? S.ui.gradeSem : 'all');
const inSem = (r, sem) => sem === 'all' || semesterOf(r.date) === sem;
const fmtAvg = (v) => (v == null ? '—' : String(v));

/** Records grouped by subject → [{ sid, list, avg }], best average first. */
function bySubject(records) {
  const m = new Map();
  for (const r of records) {
    const k = r.subjectId || '';
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return [...m.entries()].map(([sid, list]) => ({ sid, list, avg: weightedAverage(list) })).sort((a, b) => b.avg - a.avg);
}

/** Overall average = mean of the subject averages (each subject counts once, like a report card). */
function overall(rows) {
  if (!rows.length) return null;
  return Math.round((rows.reduce((a, r) => a + r.avg, 0) / rows.length) * 10) / 10;
}

/** Weighted by study units (יח״ל) — only over subjects that have units set. */
function unitsAverage(rows) {
  const withU = rows.filter((r) => +subject(r.sid)?.units > 0);
  if (!withU.length) return null;
  const u = withU.reduce((a, r) => a + +subject(r.sid).units, 0);
  return Math.round((withU.reduce((a, r) => a + r.avg * +subject(r.sid).units, 0) / u) * 10) / 10;
}

// ---------------------------------------------------------------- charts

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
  // Newest grade at the end of the reading direction (left in Hebrew, right in English).
  const x0 = (i) => W - P - (i / (values.length - 1)) * (W - 2 * P);
  const x = (i) => (RTL ? x0(i) : W - x0(i));
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values.length - 1;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(last)}" cy="${y(values[last])}" r="4" fill="${color}" stroke="var(--card)" stroke-width="2"/>
  </svg>`;
}

const MONTH = new Intl.DateTimeFormat(LOCALE, { month: 'short' });

/**
 * Grades over time: each grade a dot (de-emphasised), the running average a 2px
 * accent line with its end value labelled. One y-axis (grade), time runs right→left
 * like the rest of the app. Tap a dot → readout above; table view below.
 */
function trendChart(records) {
  if (records.length < 2) return '';
  const W = 340, H = 176, padT = 18, padB = 22, padR = 30, padL = 34;
  const plotW = W - padR - padL;
  const plotH = H - padT - padB;
  const minG = Math.min(...records.map((r) => r.grade));
  const lo = Math.max(0, Math.min(60, Math.floor((minG - 5) / 10) * 10));
  const step = 100 - lo > 50 ? 20 : 10;
  const yOf = (v) => padT + plotH - ((v - lo) / (100 - lo)) * plotH;
  const n = records.length;
  const xr = (i) => padL + plotW - (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const xOf = (i) => (RTL ? xr(i) : W - xr(i)); // English: time runs left → right, axis on the left

  let grid = '';
  for (let v = lo; v <= 100; v += step) {
    const gx1 = RTL ? padL : W - padL - plotW;
    grid += `<line x1="${gx1}" x2="${gx1 + plotW}" y1="${yOf(v)}" y2="${yOf(v)}" class="${v === lo ? 'c-axis' : 'c-grid'}"/>`;
    grid += `<text x="${RTL ? W - 4 : 4}" y="${yOf(v) + 4}" class="c-tick" text-anchor="${RTL ? 'end' : 'start'}">${v}</text>`;
  }
  // month labels at the first grade of each month
  let months = '';
  let lastM = '';
  records.forEach((r, i) => {
    const m = r.date.slice(0, 7);
    if (m !== lastM) {
      months += `<text x="${xOf(i)}" y="${H - 6}" text-anchor="middle" class="c-day">${esc(MONTH.format(parseISO(r.date)))}</text>`;
      lastM = m;
    }
  });
  // running average, computed like the headline: each subject's average counts once
  const running = records.map((_, i) => overall(bySubject(records.slice(0, i + 1))));
  const line = running.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ');
  const dots = records
    .map((r, i) => `<circle cx="${xOf(i).toFixed(1)}" cy="${yOf(r.grade).toFixed(1)}" r="4" class="g-dot"/>`)
    .join('');
  const endX = xOf(n - 1);
  const endY = yOf(running[n - 1]);
  const hits = records
    .map((r, i) => {
      const tip = `${r.grade} · ${subjectName(r.subjectId)} · ${r.title} · ${fmtDate(r.date)} · ממוצע עד כאן ${running[i]}`;
      return `<circle cx="${xOf(i).toFixed(1)}" cy="${yOf(r.grade).toFixed(1)}" r="12" class="c-hit" data-act="chart-tip" data-tip="${esc(tip)}" tabindex="0" role="img" aria-label="${esc(tip)}"><title>${esc(tip)}</title></circle>`;
    })
    .join('');
  const table = records
    .map((r, i) => `<tr><td>${fmtDate(r.date)}</td><td>${esc(subjectName(r.subjectId))}</td><td>${esc(r.title)}</td><td>${r.grade}</td><td>${running[i]}</td></tr>`)
    .join('');
  return `<figure class="chart card trend">
    <div class="trend-legend small muted"><span class="lk"><i class="lk-dot"></i>ציון</span><span class="lk"><i class="lk-line"></i>ממוצע מצטבר</span></div>
    <div class="chart-tip muted small" aria-live="polite">לחיצה על נקודה מציגה את הציון</div>
    <svg viewBox="0 0 ${W} ${H}" class="week-svg" role="group" aria-label="הציונים לאורך הזמן">
      ${grid}${months}
      <polyline points="${line}" class="g-line"/>
      ${dots}
      <circle cx="${endX}" cy="${endY}" r="4.5" class="g-end"/>
      <text x="${RTL ? endX - 7 : endX + 7}" y="${endY - 9}" class="c-val" text-anchor="${RTL ? 'end' : 'start'}">${running[n - 1]}</text>
      ${hits}
    </svg>
    <details class="chart-table"><summary>הצגה כטבלה</summary>
      <table><thead><tr><th>תאריך</th><th>מקצוע</th><th>מה</th><th>ציון</th><th>ממוצע</th></tr></thead><tbody>${table}</tbody></table>
    </details>
  </figure>`;
}

// ---------------------------------------------------------------- attendance

/** First day of the current school year (1 September). */
function yearStart() {
  const y = parseInt(schoolYearName(), 10);
  return new Date(y, 8, 1);
}

/** Roughly how many lessons of this subject took place so far (weekly lessons × weeks). */
function lessonsSoFar(sid) {
  const perWeek = S.data.lessons.filter((l) => l.subjectId === sid).length;
  const weeks = Math.max(1, Math.floor((startOfDay() - yearStart()) / (7 * 86400000)));
  return perWeek * weeks;
}

function attendanceSection() {
  const list = S.data.attendance || [];
  const absent = list.filter((a) => a.kind === 'absent');
  const late = list.filter((a) => a.kind === 'late');
  const subjects = [...new Set(list.map((a) => a.subjectId || ''))];
  const rows = subjects
    .map((sid) => {
      const a = absent.filter((x) => (x.subjectId || '') === sid).length;
      const l = late.filter((x) => (x.subjectId || '') === sid).length;
      const total = sid ? lessonsSoFar(sid) : 0;
      const pct = total ? Math.round((a / total) * 100) : null;
      return { sid, a, l, pct };
    })
    .sort((x, y) => y.a - x.a || y.l - x.l);
  const recent = [...list].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  return section(
    'נוכחות',
    `<div class="card att-card">
      <div class="att-stats">
        <span class="stat"><span class="stat-label">חיסורים</span><span class="stat-value">${absent.length}</span></span>
        <span class="stat"><span class="stat-label">איחורים</span><span class="stat-value">${late.length}</span></span>
        <button class="btn tinted sm" data-act="att-add">${ICON.plus} סימון</button>
      </div>
      ${
        rows.length
          ? `<div class="att-rows">${rows
              .map(
                (r) => `<div class="att-row">${dot(r.sid)}<span class="grow">${esc(subjectName(r.sid))}</span>
                  <span class="muted small">${r.a ? `${r.a} ${r.a === 1 ? 'חיסור' : 'חיסורים'}` : ''}${r.a && r.l ? ' · ' : ''}${r.l ? `${r.l} ${r.l === 1 ? 'איחור' : 'איחורים'}` : ''}</span>
                  ${r.pct != null && r.a ? `<span class="att-pct${r.pct >= 15 ? ' warn' : ''}">${r.pct}%</span>` : ''}</div>`
              )
              .join('')}</div>
             <details class="att-recent"><summary>אחרונים</summary>${recent
               .map(
                 (a) => `<div class="att-row">${dot(a.subjectId)}<span class="grow">${esc(subjectName(a.subjectId))} · ${a.kind === 'late' ? 'איחור' : 'חיסור'}${a.excused ? ' (מוצדק)' : ''}</span>
                   <span class="muted small">${fmtDate(a.date)}</span>
                   <button class="icon-btn sm" data-act="att-del" data-id="${a.id}" aria-label="מחיקה">${ICON.x}</button></div>`
               )
               .join('')}</details>`
          : `<p class="muted small">מסמנים חיסור או איחור מהשיעור במערכת השעות (לחיצה על השיעור), או כאן. האחוז הוא בערך, לפי מספר השיעורים בשבוע.</p>`
      }
    </div>`
  );
}

// ---------------------------------------------------------------- main grades view

function addButtons() {
  return `<div class="row gap grade-actions">
    <button class="btn tinted grow" data-act="add-grade">${ICON.plus} הוספת ציון</button>
    <button class="btn ghost grow" data-act="webtop-paste" data-as="grade">${ICON.clip} ייבוא מוובטופ</button>
  </div>`;
}

/** Body of the grades screen (used by the ציונים tab in מבחנים and by #grades). */
export function gradesView(examCard) {
  const sem = curSem();
  const all = gradedRecords().filter((r) => inSem(r, sem));
  const past = pastExams();
  const ungraded = past.filter((e) => !hasGrade(e));
  const semCtl = seg('gradeSem', SEMS);
  if (!all.length) {
    return `${semCtl}
      ${empty('chart', sem === 'all' ? 'עוד אין ציונים. רושמים ציון במבחן או במשימה, מוסיפים ציון ידנית, או מייבאים מוובטופ — והממוצעים יופיעו כאן.' : `אין ציונים ב${semLabel(sem)}.`)}
      <div class="pad">${addButtons()}</div>
      ${ungraded.length ? section('מבחנים בלי ציון', `<div class="stack">${ungraded.map(examCard).join('')}</div>`) : ''}
      ${attendanceSection()}`;
  }
  const rows = bySubject(all);
  const avg = overall(rows);
  const uAvg = unitsAverage(rows);
  const recent = all.slice(-3);
  const before = all.slice(0, -3);
  const delta = before.length ? Math.round((weightedAverage(recent) - weightedAverage(before)) * 10) / 10 : null;
  const best = rows[0];

  // report card: every subject × half-year
  const recAll = gradedRecords();
  const card = bySubject(recAll).map(({ sid, list }) => ({
    sid,
    a: weightedAverage(list.filter((r) => semesterOf(r.date) === 'a')),
    b: weightedAverage(list.filter((r) => semesterOf(r.date) === 'b')),
    y: weightedAverage(list),
  }));

  return `
    ${semCtl}
    <div class="card grade-hero">
      <span class="stat-label">ממוצע ${sem === 'all' ? 'כללי' : semLabel(sem)}</span>
      <span class="hero-grade">${fmtAvg(avg)}</span>
      <span class="muted small">${all.length} ציונים ב-${rows.length} ${rows.length === 1 ? 'מקצוע' : 'מקצועות'}${
        delta != null && delta !== 0
          ? ` · <span class="${delta > 0 ? 'delta-up' : 'delta-down'}">${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)}</span> בשלושה האחרונים`
          : ''
      }</span>
      <div class="hero-stats">
        <span class="stat"><span class="stat-label">הכי גבוה</span><span class="stat-value">${esc(subjectName(best.sid))} ${fmtAvg(best.avg)}</span></span>
        ${uAvg != null ? `<span class="stat"><span class="stat-label">משוקלל לפי יח״ל</span><span class="stat-value">${uAvg}</span></span>` : ''}
      </div>
    </div>
    ${trendChart(all)}
    ${section(
      'ממוצע לפי מקצוע',
      `<div class="card list">${rows
        .map(
          ({ sid, list, avg: a }) => `<button class="row-btn grade-row" data-go="#grades-${sid || 'none'}">
            <span class="dot lg" style="background:${subjectColor(sid)}"></span>
            <span class="grow"><b>${esc(subjectName(sid))}</b><span class="sr-sub">${list.length} ${list.length === 1 ? 'ציון' : 'ציונים'} · אחרון ${list[list.length - 1].grade}${subject(sid)?.target ? ` · יעד ${esc(subject(sid).target)}` : ''}</span></span>
            ${spark(list.map((r) => r.grade), subjectColor(sid))}
            <span class="grade-avg">${fmtAvg(a)}</span>
          </button>`
        )
        .join('')}</div>`
    )}
    ${section(
      'תעודה',
      `<div class="card report"><table>
        <thead><tr><th>מקצוע</th><th>מחצית א׳</th><th>מחצית ב׳</th><th>שנתי</th></tr></thead>
        <tbody>${card
          .map((r) => `<tr><td>${dot(r.sid)} ${esc(subjectName(r.sid))}</td><td>${fmtAvg(r.a)}</td><td>${fmtAvg(r.b)}</td><td><b>${fmtAvg(r.y)}</b></td></tr>`)
          .join('')}</tbody>
        <tfoot><tr><td>ממוצע</td><td>${fmtAvg(overall(card.filter((r) => r.a != null).map((r) => ({ avg: r.a }))))}</td><td>${fmtAvg(overall(card.filter((r) => r.b != null).map((r) => ({ avg: r.b }))))}</td><td><b>${fmtAvg(overall(card.map((r) => ({ avg: r.y }))))}</b></td></tr></tfoot>
      </table></div>`
    )}
    ${section(
      'כל הציונים',
      `<div class="card list">${[...all]
        .reverse()
        .map(
          (e) => `<button class="row-btn" data-go="${e.href}">
            <span class="dot" style="background:${subjectColor(e.subjectId)}"></span>
            <span class="grow">${esc(e.title)}<span class="sr-sub">${esc(e.type)} · ${esc(subjectName(e.subjectId))} · ${fmtDate(e.date)}${e.weight != null ? ` · משקל ${e.weight}%` : ''}</span></span>
            <span class="grade-pill">${e.grade}</span><span class="chev">${ICON.fwd}</span>
          </button>`
        )
        .join('')}</div>`
    )}
    ${ungraded.length ? section('מבחנים בלי ציון', `<div class="stack">${ungraded.map(examCard).join('')}</div>`) : ''}
    ${attendanceSection()}
    <div class="pad">${addButtons()}</div>
  `;
}

/** #grades — the full screen. */
export function gradesPage(examCard) {
  return `${head('ציונים', { actions: iconBtn('add-grade', ICON.plus, 'הוספת ציון') })}${gradesView(examCard)}`;
}

/** What grade on the next (equal-weight) exam brings the average to `target`. */
function needed(list, target) {
  if (!list.length) return null;
  const given = list.map((r) => r.weight).filter((x) => x != null);
  const w = given.length ? given.reduce((a, b) => a + b, 0) / given.length : 1;
  const sw = list.reduce((a, r) => a + (r.weight ?? w), 0);
  const sg = list.reduce((a, r) => a + r.grade * (r.weight ?? w), 0);
  return Math.ceil((target * (sw + w) - sg) / w);
}

/** #grades-<subjectId> — one subject: average, target calculator, every grade. */
export function subjectGradesPage(sid) {
  const real = sid === 'none' ? '' : sid;
  const s = subject(real);
  if (real && !s) return `${head('לא נמצא', { back: '#grades' })}${empty('🤷', 'המקצוע הזה נמחק')}`;
  const sem = curSem();
  const all = gradedRecords(real).filter((r) => inSem(r, sem));
  const avg = weightedAverage(all);
  const target = s?.target ? +s.target : null;
  const next = upcomingExams().find((e) => e.subjectId === real);
  let calc = '';
  if (target && all.length) {
    const need = needed(all, target);
    calc =
      avg >= target
        ? `<p class="calc ok">אתה/את מעל היעד 🎉 ${need > 0 ? `גם ציון ${need} במבחן הבא ישאיר אותך ביעד.` : 'כל ציון במבחן הבא ישאיר אותך ביעד.'}</p>`
        : need > 100
        ? `<p class="calc hard">כדי להגיע ל-${target} צריך יותר מ-100 במבחן אחד — זה ייקח כמה מבחנים טובים. ציון 100 יביא אותך ל-${weightedAverage([...all, { grade: 100, weight: null }])}.</p>`
        : `<p class="calc">כדי להגיע לממוצע <b>${target}</b> צריך <b>${need}</b> במבחן הבא${next ? ` (${esc(next.title || next.type)}, ${relDay(next.date)})` : ''}.</p>`;
  }
  return `
    ${head(s ? s.name : 'כללי', {
      back: '#grades',
      actions: iconBtn('add-grade', ICON.plus, 'הוספת ציון', `data-subject="${real}"`),
      sub: s ? `${dot(real)} ${s.units ? `${esc(s.units)} יח״ל · ` : ''}${all.length} ציונים` : '',
    })}
    ${seg('gradeSem', SEMS)}
    <div class="card grade-hero">
      <span class="stat-label">ממוצע ${sem === 'all' ? '' : semLabel(sem)}</span>
      <span class="hero-grade">${fmtAvg(avg)}</span>
      ${all.length ? `<span class="muted small">הכי גבוה ${Math.max(...all.map((r) => r.grade))} · הכי נמוך ${Math.min(...all.map((r) => r.grade))}</span>` : ''}
    </div>
    ${
      s
        ? section(
            'יעד',
            `<div class="card">
              <div class="row between">
                <label for="target-${real}" class="muted">איזה ממוצע אני רוצה?</label>
                <input id="target-${real}" class="grade-input" type="number" inputmode="decimal" min="0" max="100" data-subj-field="target" data-id="${real}" value="${esc(s.target ?? '')}" placeholder="—">
              </div>
              ${calc || `<p class="muted small">רושמים יעד, ונחשב כמה צריך במבחן הבא כדי להגיע אליו.</p>`}
              <div class="row between units-row">
                <label for="units-${real}" class="muted">יחידות לימוד (יח״ל)</label>
                <select id="units-${real}" class="row-select" data-subj-field="units" data-id="${real}"><option value="">—</option>${[1, 2, 3, 4, 5, 10]
                  .map((u) => `<option value="${u}"${String(s.units) === String(u) ? ' selected' : ''}>${u}</option>`)
                  .join('')}</select>
              </div>
            </div>`
          )
        : ''
    }
    ${next ? section('המבחן הבא', `<div class="card list"><button class="row-btn" data-go="#exam-${next.id}">${dot(real)}<span class="grow">${esc(next.title || next.type)}<span class="sr-sub">${esc(next.type || 'מבחן')} · ${fmtDate(next.date)}</span></span><span class="chip">${relDay(next.date)}</span></button></div>`) : ''}
    ${trendChart(all)}
    ${section(
      'הציונים',
      all.length
        ? `<div class="card list">${[...all]
            .reverse()
            .map(
              (e) => `<button class="row-btn" data-go="${e.href}">
                <span class="grow">${esc(e.title)}<span class="sr-sub">${esc(e.type)} · ${fmtDate(e.date)}${e.weight != null ? ` · משקל ${e.weight}%` : ''}</span></span>
                <span class="grade-pill">${e.grade}</span><span class="chev">${ICON.fwd}</span>
              </button>`
            )
            .join('')}</div>`
        : `<div class="card">${empty('chart', 'עוד אין ציונים במקצוע הזה')}</div>`
    )}
    <div class="pad"><button class="btn tinted block" data-act="add-grade" data-subject="${real}">${ICON.plus} הוספת ציון</button></div>
  `;
}

/** Home card: overall average + recent trend. */
export function gradesHomeCard() {
  const all = gradedRecords();
  if (!all.length) return '';
  const rows = bySubject(all);
  const avg = overall(rows);
  const last = all[all.length - 1];
  return `<button class="card sum-card" data-go="#grades">
    <span class="sum-head" style="--sum: var(--indigo, var(--accent-text))">${ICON.chart} ציונים <span class="chev">${ICON.fwd}</span></span>
    <span class="sum-body">
      <span>
        <span class="sum-big">${fmtAvg(avg)}</span><span class="sum-unit">ממוצע</span>
        <span class="sum-sub">אחרון: ${last.grade} ב${esc(subjectName(last.subjectId))}</span>
      </span>
      ${spark(all.slice(-10).map((r) => r.grade), 'var(--accent)')}
    </span>
  </button>`;
}

// ---------------------------------------------------------------- Webtop grades paste

const DATE = /(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/;
function toISO(d, m, y) {
  d = +d;
  m = +m;
  if (!d || !m || d > 31 || m > 12) return '';
  const now = new Date();
  const start = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  let yy = y ? +y : m >= 8 ? start : start + 1;
  if (yy < 100) yy += 2000;
  return `${yy}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** The grade in a row: the last 0–100 number that isn't a weight (%), page, question… */
function pickGrade(text) {
  const re = /(^|[^\d./])(\d{1,3}(?:\.\d{1,2})?)(?![\d./])/g;
  let best = null;
  let m;
  while ((m = re.exec(text))) {
    const v = +m[2];
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 3);
    const before = text.slice(Math.max(0, m.index - 8), m.index + m[1].length);
    if (v > 100 || /^\s*%/.test(after) || /(פרק|עמ['׳]?|עמוד|שאלה|תרגיל|יחידה|יח|כיתה|משקל)\s*$/.test(before)) continue;
    best = v;
  }
  return best;
}

const SKIP = /ממוצע|ציון שנתי|ציון מחצית|ציון סופי|תעודה|סה"כ|סה״כ/;
const TYPE_ONLY = /^(מבחן|בוחן|מבדק|בגרות|מתכונת|עבודה|הגשה|מטלה|פרויקט|בעל פה|הערכה חלופית|תרגיל|ש"ב|שיעורי בית)$/;

/** Text copied from Webtop's grades page → [{ date, subjectId, title, type, grade, weight }]. */
export function parseGradesText(text) {
  text = normalizeDates(text);
  // Average / report-card lines are never grades — drop them before grouping.
  const lines = String(text || '').split(/\r?\n/).map((l) => l.replace(/[ \u00a0]+/g, ' ').trim()).filter((l) => l && !SKIP.test(l));
  const recs = [];
  let cur = null;
  for (const line of lines) {
    const dm = line.match(DATE);
    const iso = dm ? toISO(dm[1], dm[2], dm[3]) : '';
    const tabbed = line.includes('\t');
    if (iso) {
      if (cur) recs.push(cur);
      cur = { date: iso, tabbed, parts: [line.replace(dm[0], ' ').trim()].filter(Boolean) };
    } else if (cur && !cur.tabbed && !tabbed && cur.parts.length < 6) {
      cur.parts.push(line); // a table copied one cell per line
    } else recs.push({ date: '', tabbed, parts: [line] });
  }
  if (cur) recs.push(cur);
  const out = [];
  for (const r of recs) {
    const cells = r.parts.flatMap((p) => p.split('\t')).map((c) => c.trim()).filter(Boolean);
    const t = cells.join(' · ');
    const grade = pickGrade(t);
    if (grade == null) continue;
    const subjectId = matchSubject(t);
    if (!subjectId && !r.date) continue; // an undated line naming no subject is too vague
    const wm = t.match(/(\d{1,3})\s*%/);
    const type = typeOf(t) || 'מבחן';
    // Title = the description: drop the cells that are the subject, the type, the grade or the weight.
    const sName = subjectId ? subjectName(subjectId) : '';
    const desc = cells.filter((c) => {
      if (/^\d{1,3}(\.\d{1,2})?\s*%?$/.test(c)) return false;
      if (TYPE_ONLY.test(c)) return false;
      if (subjectId && c.length <= sName.length + 3 && matchSubject(c) === subjectId) return false;
      return true;
    });
    const title = desc.join(' · ').replace(/\s+/g, ' ').trim();
    out.push({
      date: r.date || isoDate(), subjectId, type, grade, weight: wm ? +wm[1] : '',
      title: title ? (title.startsWith(type) ? title : `${type}: ${title}`) : sName ? `${type} ב${sName}` : type,
    });
  }
  return out;
}

/** Does pasted text look like a grades page? */
export const looksLikeGrades = (text) => /ציון|ציונים/.test(text) && parseGradesText(text).length >= 1;

// ---------------------------------------------------------------- forms & actions

export function gradeForm(presetSubject = '') {
  formSheet({
    title: 'הוספת ציון',
    values: { subjectId: presetSubject || '', type: 'מבחן', date: isoDate() },
    fields: [
      { name: 'subjectId', label: 'מקצוע', type: 'subject' },
      { name: 'grade', label: 'ציון', type: 'number', inputmode: 'decimal', min: 0, max: 100, required: true, half: true, placeholder: '0–100' },
      { name: 'weight', label: 'משקל % (לא חובה)', type: 'number', inputmode: 'decimal', min: 0, max: 100, half: true, placeholder: 'רגיל' },
      { name: 'title', label: 'על מה?', placeholder: 'למשל: מבחן בפונקציות' },
      { name: 'type', label: 'סוג', type: 'select', options: EXAM_TYPES.map((t) => ({ value: t, label: t })), half: true },
      { name: 'date', label: 'תאריך', type: 'date', required: true, half: true },
    ],
    submitLabel: 'הוספה',
    onSubmit(v) {
      if (v.grade === '' || v.grade < 0 || v.grade > 100) {
        toast('ציון בין 0 ל-100');
        return false;
      }
      S.data.exams.push({
        id: uid(), subjectId: v.subjectId, title: v.title || `${v.type} ב${subjectName(v.subjectId)}`, type: v.type,
        date: v.date, time: '', topics: [], notes: '', grade: String(v.grade), weight: v.weight === '' ? '' : String(v.weight),
        done: true, source: 'manual', createdAt: Date.now(),
      });
      save();
      rerender();
      toast('הציון נוסף ✔︎');
    },
  });
}

function attendanceForm() {
  formSheet({
    title: 'חיסור או איחור',
    values: { kind: 'absent', date: isoDate(), subjectId: '' },
    fields: [
      { name: 'kind', label: 'מה', type: 'select', options: [{ value: 'absent', label: 'חיסור' }, { value: 'late', label: 'איחור' }, { value: 'excused', label: 'חיסור מוצדק' }], half: true },
      { name: 'date', label: 'תאריך', type: 'date', required: true, half: true },
      { name: 'subjectId', label: 'מקצוע', type: 'subject' },
    ],
    submitLabel: 'שמירה',
    onSubmit(v) {
      S.data.attendance.push({ id: uid(), date: v.date, subjectId: v.subjectId, kind: v.kind === 'late' ? 'late' : 'absent', excused: v.kind === 'excused', createdAt: Date.now() });
      save();
      rerender();
    },
  });
}

/** Lesson sheet buttons: mark this lesson missed / late on its latest date. */
export function attendanceButtons(lesson, date) {
  const rec = (S.data.attendance || []).find((a) => a.lessonId === lesson.id && a.date === date);
  if (rec) {
    return `<div class="att-mark on">${rec.kind === 'late' ? 'סומן איחור' : 'סומן חיסור'} · ${fmtDate(date)}
      <button class="link-btn" data-act="att-del" data-id="${rec.id}" data-close>ביטול</button></div>`;
  }
  return `<div class="att-mark">
    <span class="muted small">${fmtDate(date)}:</span>
    <button class="btn ghost sm" data-act="att-mark" data-lesson="${lesson.id}" data-date="${date}" data-kind="absent" data-close>חיסור</button>
    <button class="btn ghost sm" data-act="att-mark" data-lesson="${lesson.id}" data-date="${date}" data-kind="late" data-close>איחור</button>
  </div>`;
}

export const actions = {
  'add-grade': ({ subject: sid }) => gradeForm(sid || ''),
  'att-add': () => attendanceForm(),
  'att-mark'({ lesson, date, kind }) {
    const l = S.data.lessons.find((x) => x.id === lesson);
    S.data.attendance.push({ id: uid(), date, lessonId: lesson, subjectId: l?.subjectId || '', kind, excused: false, createdAt: Date.now() });
    save();
    rerender();
    toast(kind === 'late' ? 'סומן איחור' : 'סומן חיסור');
  },
  async 'att-del'({ id }) {
    S.data.attendance = S.data.attendance.filter((a) => a.id !== id);
    save();
    closeAllSheets();
    rerender();
  },
};

/** Change hook for <input/select data-subj-field> (target, units). */
export function onSubjectField(el) {
  const s = subject(el.dataset.id);
  if (!s) return;
  const v = el.value.trim();
  s[el.dataset.subjField] = v === '' ? '' : String(Math.max(0, Math.min(100, +v)));
  save();
  rerender();
}
