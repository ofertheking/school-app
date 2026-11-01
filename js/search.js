// Spotlight-style search across everything in the app.
import { S, subjectName, itemKind } from './core.js';
import { esc, fmtDate, norm } from './util.js';
import { ICON } from './icons.js';
import { head, empty, tile } from './components.js';
import { DAY_NAMES } from './schedule.js';

/** Escape, then wrap matches of q in <mark>. */
function hl(text, q) {
  const safe = esc(text);
  if (!q) return safe;
  const needle = esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return safe.replace(new RegExp(needle, 'gi'), (m) => `<mark>${m}</mark>`);
}

/** A short excerpt of `text` around the first match. */
function snippet(text, q, len = 70) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const i = t.toLowerCase().indexOf(q.toLowerCase());
  if (i === -1) return t.length > len ? `${t.slice(0, len)}…` : t;
  const start = Math.max(0, i - 25);
  return `${start ? '…' : ''}${t.slice(start, start + len)}${start + len < t.length ? '…' : ''}`;
}

const has = (q, ...fields) => fields.some((f) => norm(f).includes(q));

function group(title, rows, total) {
  if (!rows.length) return '';
  return `<h3 class="group-title">${esc(title)}${total > rows.length ? ` · ${total}` : ''}</h3><div class="card list">${rows.join('')}</div>`;
}

const row = (attrs, icon, color, title, sub) => `<button class="row-btn search-row" ${attrs}>
  ${typeof icon === 'string' && icon.startsWith('<span') ? icon : tile(icon, color)}
  <span class="grow"><span class="sr-title">${title}</span>${sub ? `<span class="sr-sub">${sub}</span>` : ''}</span>
  <span class="chev">${ICON.fwd}</span></button>`;

export function searchResults(raw) {
  const qRaw = String(raw || '').trim();
  const q = norm(qRaw);
  if (!q) {
    return empty('search', 'מחפשים בכל מקום: מבחנים, משימות, סיכומים, דפי מחברת, כרטיסיות, מקצועות ושיעורים.');
  }
  const d = S.data;
  const LIMIT = 8;
  const out = [];

  const subs = d.subjects.filter((s) => has(q, s.name));
  out.push(group('מקצועות', subs.slice(0, LIMIT).map((s) =>
    row(`data-go="#subject-${s.id}"`, `<span class="tile-ico" style="--tile:var(--c${s.color % 8})" aria-hidden="true">${ICON.book}</span>`, '', hl(s.name, qRaw), '')
  ), subs.length));

  const exams = d.exams.filter((e) => has(q, e.title, e.type, e.notes, subjectName(e.subjectId), ...(e.topics || []).map((t) => t.text)));
  out.push(group('מבחנים', exams.slice(0, LIMIT).map((e) => {
    const topic = (e.topics || []).find((t) => norm(t.text).includes(q));
    return row(`data-go="#exam-${e.id}"`, 'exam', 'red', hl(e.title || e.type, qRaw),
      `${esc(subjectName(e.subjectId))} · ${fmtDate(e.date)}${topic ? ` · ${hl(topic.text, qRaw)}` : ''}`);
  }), exams.length));

  const tasks = d.tasks.filter((t) => has(q, t.title, t.notes, subjectName(t.subjectId)));
  out.push(group('משימות', tasks.slice(0, LIMIT).map((t) =>
    row(`data-go="#task-${t.id}"`, 'tasks', 'orange', hl(t.title, qRaw),
      `${esc(subjectName(t.subjectId))}${t.due ? ` · ${fmtDate(t.due)}` : ''}${t.done ? ' · בוצע' : ''}`)
  ), tasks.length));

  const items = d.items.filter((it) => has(q, it.title, it.body, it.url, subjectName(it.subjectId)));
  out.push(group('סיכומים וחומר', items.slice(0, LIMIT).map((it) => {
    const kind = itemKind(it);
    const icon = { note: 'note', lesson: 'calendar', notebook: 'camera', file: 'clip', link: 'link' }[kind] || 'note';
    return row(`data-go="#item-${it.id}"`, icon, 'green', hl(it.title || 'ללא כותרת', qRaw),
      `${esc(subjectName(it.subjectId))}${norm(it.body).includes(q) ? ` · ${hl(snippet(it.body, qRaw), qRaw)}` : ''}`);
  }), items.length));

  const decks = d.decks
    .map((dk) => ({ dk, card: d.cards.find((c) => c.deckId === dk.id && has(q, c.front, c.back)) }))
    .filter(({ dk, card }) => card || has(q, dk.title));
  out.push(group('כרטיסיות', decks.slice(0, LIMIT).map(({ dk, card }) =>
    row(`data-go="#deck-${dk.id}"`, 'cards', 'purple', hl(dk.title, qRaw),
      card ? `${hl(card.front, qRaw)} — ${hl(snippet(card.back, qRaw, 40), qRaw)}` : esc(subjectName(dk.subjectId)))
  ), decks.length));

  const lessons = d.lessons.filter((l) => has(q, l.title, subjectName(l.subjectId), l.teacher, l.room));
  out.push(group('שיעורים במערכת', lessons.slice(0, LIMIT).map((l) =>
    row(`data-act="sched-goto" data-day="${l.day}"`, 'timer', 'teal', hl(l.subjectId ? subjectName(l.subjectId) : l.title, qRaw),
      `יום ${DAY_NAMES[l.day]}${l.start ? ` · <bdi>${esc(l.start)}</bdi>` : ''}${l.teacher ? ` · ${hl(l.teacher, qRaw)}` : ''}${l.room ? ` · ${hl(l.room, qRaw)}` : ''}`)
  ), lessons.length));

  const html = out.join('');
  return html || empty('search', `לא נמצא שום דבר עבור "${esc(qRaw)}"`);
}

export function searchPage() {
  return `
    ${head('חיפוש', { back: '#home' })}
    <label class="search big"><span aria-hidden="true">${ICON.search}</span>
      <input type="search" enterkeyhint="search" placeholder="מבחנים, סיכומים, כרטיסיות…" value="${esc(S.ui.q)}" data-input="global-search" aria-label="חיפוש">
    </label>
    <div id="search-results">${searchResults(S.ui.q)}</div>
  `;
}

export const actions = {
  'sched-goto'({ day }) {
    S.ui.schedDay = +day;
    location.hash = '#schedule';
  },
};

