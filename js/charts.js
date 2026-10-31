// Tiny SVG/HTML charts (RTL: Sunday on the right).
import { esc, fmtMin, DAY_LETTERS, fmtDayMonth } from './util.js';

function niceMaxHours(minutes) {
  const h = minutes / 60;
  for (const n of [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24]) if (h <= n) return n;
  return Math.ceil(h / 4) * 4;
}

function colPath(x0, x1, yTop, yBase, r) {
  const h = yBase - yTop;
  r = Math.min(r, h, (x1 - x0) / 2);
  return `M${x0},${yBase} V${yTop + r} Q${x0},${yTop} ${x0 + r},${yTop} H${x1 - r} Q${x1},${yTop} ${x1},${yTop + r} V${yBase} Z`;
}

const short = (min) => {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}` : `${m}′`;
};

/** days: [{date, minutes, isToday, isFuture}] */
export function weekChart(days) {
  const W = 340, H = 176, padT = 22, padB = 24, padR = 26, padL = 4;
  const plotW = W - padR - padL;
  const plotH = H - padT - padB;
  const maxH = niceMaxHours(Math.max(60, ...days.map((d) => d.minutes)));
  const step = maxH <= 5 ? 1 : maxH <= 10 ? 2 : 4;
  const yOf = (min) => padT + plotH - (min / (maxH * 60)) * plotH;
  const slot = plotW / 7;
  const barW = Math.min(24, slot * 0.55);
  const maxIdx = days.reduce((bi, d, i) => (d.minutes > days[bi].minutes ? i : bi), 0);

  let grid = '';
  for (let h = 0; h <= maxH; h += step) {
    const y = yOf(h * 60);
    grid += `<line x1="${padL}" x2="${padL + plotW}" y1="${y}" y2="${y}" class="${h === 0 ? 'c-axis' : 'c-grid'}"/>`;
    grid += `<text x="${W - 2}" y="${y + 4}" class="c-tick" text-anchor="end">${h}</text>`;
  }

  let bars = '';
  let hits = '';
  days.forEach((d, i) => {
    const cx = padL + plotW - (i + 0.5) * slot;
    const yBase = yOf(0);
    if (d.minutes > 0) {
      const yTop = Math.min(yBase - 2, yOf(d.minutes));
      bars += `<path d="${colPath(cx - barW / 2, cx + barW / 2, yTop, yBase, 4)}" class="c-bar${d.isToday ? ' today' : ''}"/>`;
      if (i === maxIdx || d.isToday) {
        bars += `<text x="${cx}" y="${yTop - 6}" text-anchor="middle" class="c-val">${short(d.minutes)}</text>`;
      }
    }
    bars += `<text x="${cx}" y="${H - 6}" text-anchor="middle" class="c-day${d.isToday ? ' today' : ''}${d.isFuture ? ' future' : ''}">${DAY_LETTERS[i]}</text>`;
    const label = `${DAY_LETTERS[i]} ${fmtDayMonth(d.date)} · ${fmtMin(d.minutes)}`;
    hits += `<rect x="${cx - slot / 2}" y="0" width="${slot}" height="${H}" class="c-hit" data-act="chart-tip" data-tip="${esc(label)}" tabindex="0" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title></rect>`;
  });

  const table = days
    .map((d, i) => `<tr><td>יום ${DAY_LETTERS[i]} (${fmtDayMonth(d.date)})</td><td>${fmtMin(d.minutes)}</td></tr>`)
    .join('');

  return `<figure class="chart">
    <div class="chart-tip muted small" aria-live="polite">לחיצה על עמודה מציגה פירוט</div>
    <svg viewBox="0 0 ${W} ${H}" class="week-svg" role="group" aria-label="שעות למידה לפי ימים">
      ${grid}${bars}${hits}
    </svg>
    <details class="chart-table"><summary>הצגה כטבלה</summary>
      <table><thead><tr><th>יום</th><th>זמן למידה</th></tr></thead><tbody>${table}</tbody></table>
    </details>
  </figure>`;
}

/** rows: [{label, color, minutes}] -> labelled horizontal bars */
export function subjectBars(rows) {
  if (!rows.length) return '';
  const max = Math.max(...rows.map((r) => r.minutes), 1);
  return `<div class="hbars">${rows
    .map(
      (r) => `<div class="hbar">
        <div class="hbar-top"><span class="dot" style="background:${r.color}"></span><span class="hbar-name">${esc(r.label)}</span><span class="hbar-val">${fmtMin(r.minutes)}</span></div>
        <div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(2, (r.minutes / max) * 100)}%;background:${r.color}"></div></div>
      </div>`
    )
    .join('')}</div>`;
}

export function meter(pct, { label = '' } = {}) {
  const p = Math.max(0, Math.min(100, pct || 0));
  return `<span class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p}" aria-label="${esc(label || 'התקדמות')}"><span class="meter-fill" style="width:${p}%"></span></span>`;
}

/** Circular progress ring for the weekly goal. */
export function ring(pct, centerText, sub) {
  const p = Math.max(0, Math.min(100, pct || 0));
  const r = 34, c = 2 * Math.PI * r;
  return `<svg class="ring" viewBox="0 0 80 80" role="img" aria-label="${esc(`${Math.round(p)}% מהמטרה השבועית`)}">
    <circle cx="40" cy="40" r="${r}" class="ring-track"/>
    <circle cx="40" cy="40" r="${r}" class="ring-fill" stroke-dasharray="${(p / 100) * c} ${c}" transform="rotate(-90 40 40)"/>
    <text x="40" y="${sub ? 40 : 45}" text-anchor="middle" class="ring-text">${esc(centerText)}</text>
    ${sub ? `<text x="40" y="55" text-anchor="middle" class="ring-sub">${esc(sub)}</text>` : ''}
  </svg>`;
}
