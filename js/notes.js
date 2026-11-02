// Notes (פתקים): quick colourful notes with pinning and checklists — think Apple Notes / Keep.
// A line that starts with ☐ / ☑ is a checklist item: tap it on the card to tick it.
import { S, save, note, subjectName, subjectColor } from './core.js';
import { esc, uid, fmtDate, isoDate, fmtDateTime, norm } from './util.js';
import { ICON } from './icons.js';
import { head, iconBtn, empty, section } from './components.js';
import { askConfirm, toast, shareOrDownload } from './ui.js';
import { rerender, go } from './router.js';

export const NOTE_COLORS = [
  ['yellow', 'צהוב'], ['green', 'ירוק'], ['blue', 'כחול'], ['pink', 'ורוד'], ['purple', 'סגול'], ['orange', 'כתום'], ['plain', 'לבן'],
];
const CHECK = /^\s*(☐|☑)\s?/;

export function newNote(extra = {}) {
  const n = { id: uid(), title: '', body: '', color: 'yellow', pinned: false, subjectId: '', createdAt: Date.now(), updatedAt: Date.now(), ...extra };
  S.data.notes.unshift(n);
  save();
  return n;
}

export const isEmptyNote = (n) => !n.title?.trim() && !String(n.body || '').replace(/[☐☑\s]/g, '');

const sorted = () => [...S.data.notes].sort((a, b) => (b.pinned - a.pinned) || (b.updatedAt || 0) - (a.updatedAt || 0));

/** First lines of a note; checklist lines get a tappable box (index = line in the body). */
function preview(n, max) {
  const out = [];
  const lines = String(n.body || '').split('\n');
  for (let i = 0; i < lines.length && out.length < max; i++) {
    const l = lines[i];
    if (!l.trim() && (!out.length || i === lines.length - 1)) continue;
    const m = l.match(CHECK);
    if (m) {
      const on = m[1] === '☑';
      out.push(`<span class="nl chk${on ? ' on' : ''}"><button class="nchk" data-act="note-check" data-id="${n.id}" data-line="${i}" aria-label="${on ? 'סימון כלא בוצע' : 'סימון כבוצע'}" aria-pressed="${on}">${ICON.check}</button><span>${esc(l.replace(CHECK, ''))}</span></span>`);
    } else out.push(`<span class="nl">${esc(l) || '&nbsp;'}</span>`);
  }
  return out.join('');
}

function checklistCount(n) {
  const lines = String(n.body || '').split('\n').filter((l) => CHECK.test(l));
  if (!lines.length) return '';
  const done = lines.filter((l) => l.match(CHECK)[1] === '☑').length;
  return `<span class="nc-count">${done}/${lines.length}</span>`;
}

export function noteCard(n, { max = 8 } = {}) {
  return `<article class="note-card c-${n.color || 'yellow'}" data-go="#note-${n.id}" tabindex="0" role="link" aria-label="${esc(n.title || 'פתק')}">
    ${n.pinned ? `<span class="nc-pin" aria-label="מוצמד">${ICON.pin}</span>` : ''}
    ${n.title ? `<b class="nc-title">${esc(n.title)}</b>` : ''}
    <div class="nc-body">${preview(n, max) || (n.title ? '' : '<span class="nl muted">פתק ריק</span>')}</div>
    <span class="nc-foot">${n.subjectId ? `<span class="dot" style="background:${subjectColor(n.subjectId)}"></span>${esc(subjectName(n.subjectId))} · ` : ''}${fmtDate(isoDate(new Date(n.updatedAt || n.createdAt)))}${checklistCount(n)}</span>
  </article>`;
}

/** The grid (pinned first), filtered by S.ui.noteQ. */
export function notesResults() {
  const q = norm(S.ui.noteQ || '');
  const list = sorted().filter((n) => !q || norm(`${n.title} ${n.body} ${subjectName(n.subjectId)}`).includes(q));
  if (!S.data.notes.length) {
    return `<div class="card">${empty('✍️', 'פתקים מהירים: רעיונות, דברים לזכור, רשימות. לחיצה על ＋ פותחת פתק חדש.', `<button class="btn tinted" data-act="note-new">${ICON.plus} פתק חדש</button>`)}</div>`;
  }
  if (!list.length) return `<p class="muted center">לא נמצאו פתקים</p>`;
  const pinned = list.filter((n) => n.pinned);
  const rest = list.filter((n) => !n.pinned);
  const grid = (arr) => `<div class="notes-grid">${arr.map((n) => noteCard(n)).join('')}</div>`;
  return `${pinned.length ? `<h3 class="group-title">מוצמדים</h3>${grid(pinned)}` : ''}${rest.length ? `${pinned.length ? '<h3 class="group-title">שאר הפתקים</h3>' : ''}${grid(rest)}` : ''}`;
}

/** Body of the פתקים tab in חומר. */
export function notesBody() {
  return `<label class="search"><span aria-hidden="true">${ICON.search}</span>
      <input type="search" placeholder="חיפוש בפתקים" value="${esc(S.ui.noteQ || '')}" data-input="note-search" aria-label="חיפוש בפתקים">
    </label>
    <div id="notes-results">${notesResults()}</div>`;
}

/** Home: a strip of the latest notes. */
export function notesHomeSection() {
  const list = sorted().slice(0, 6);
  return section(
    'פתקים',
    `<div class="note-strip">${list.map((n) => noteCard(n, { max: 5 })).join('')}
      <button class="note-card add" data-act="note-new" aria-label="פתק חדש">${ICON.plus}<span>פתק חדש</span></button></div>`,
    list.length ? `<button class="link-btn" data-act="go-notes">הכל</button>` : ''
  );
}

/** #note-<id> — the editor. */
export function noteEditor(id) {
  const n = note(id);
  if (!n) return `${head('לא נמצא', { back: '#library' })}${empty('🤷', 'הפתק הזה נמחק')}`;
  return `
    ${head('', {
      back: '#library',
      navTitle: n.title || 'פתק',
      actions: `${iconBtn('note-pin', ICON.pin, n.pinned ? 'ביטול הצמדה' : 'הצמדה', `data-id="${n.id}" aria-pressed="${!!n.pinned}"`)}
        ${iconBtn('note-share', ICON.share, 'שיתוף', `data-id="${n.id}"`)}
        ${iconBtn('note-del', ICON.trash, 'מחיקה', `data-id="${n.id}"`)}`,
    })}
    <div class="note-editor c-${n.color || 'yellow'}">
      <input class="note-title" data-bind="note:${n.id}:title" value="${esc(n.title)}" placeholder="כותרת" aria-label="כותרת">
      <textarea class="note-body autosize" data-bind="note:${n.id}:body" rows="8" placeholder="כותבים כאן…" aria-label="הפתק">${esc(n.body)}</textarea>
    </div>
    <div class="note-tools">
      <div class="note-colors" role="radiogroup" aria-label="צבע">${NOTE_COLORS.map(
        ([c, label]) => `<button class="ncolor c-${c}${c === (n.color || 'yellow') ? ' on' : ''}" data-act="note-color" data-id="${n.id}" data-color="${c}" role="radio" aria-checked="${c === n.color}" aria-label="${label}"></button>`
      ).join('')}</div>
      <div class="row gap">
        <button class="btn tinted sm" data-act="note-checklist" data-id="${n.id}">☑ רשימת סימון</button>
        <label class="mini-field"><span class="dot" style="background:${subjectColor(n.subjectId)}"></span>
          <select data-bind="note:${n.id}:subjectId" aria-label="מקצוע"><option value="">בלי מקצוע</option>${S.data.subjects
            .map((s) => `<option value="${s.id}"${s.id === n.subjectId ? ' selected' : ''}>${esc(s.name)}</option>`)
            .join('')}</select>
        </label>
      </div>
      <p class="muted small">עודכן ${fmtDateTime(n.updatedAt || n.createdAt)} · שורה שמתחילה ב-☐ היא סעיף לסימון</p>
    </div>`;
}

/** Toggle "☐ " at the start of the line the caret is on (or add one at the end). */
function toggleChecklist(ta) {
  const v = ta.value;
  const pos = ta.selectionStart ?? v.length;
  const start = v.lastIndexOf('\n', pos - 1) + 1;
  const line = v.slice(start).split('\n')[0];
  let next;
  let caret;
  if (CHECK.test(line)) {
    const m = line.match(CHECK)[0];
    next = v.slice(0, start) + line.slice(m.length) + v.slice(start + line.length);
    caret = Math.max(start, pos - m.length);
  } else if (!line.trim() && start === v.length && v && !v.endsWith('\n')) {
    next = `${v}\n☐ `;
    caret = next.length;
  } else {
    next = `${v.slice(0, start)}☐ ${v.slice(start)}`;
    caret = pos + 2;
  }
  ta.value = next;
  ta.focus();
  ta.setSelectionRange(caret, caret);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Enter on a checklist line continues the list; Enter on an empty item ends it. */
export function onBodyKey(e) {
  if (e.key !== 'Enter' || e.shiftKey) return;
  const ta = e.target;
  const v = ta.value;
  const pos = ta.selectionStart;
  const start = v.lastIndexOf('\n', pos - 1) + 1;
  const line = v.slice(start, pos);
  if (!CHECK.test(line)) return;
  e.preventDefault();
  if (!line.replace(CHECK, '').trim()) {
    ta.value = v.slice(0, start) + v.slice(pos);
    ta.setSelectionRange(start, start);
  } else {
    ta.value = `${v.slice(0, pos)}\n☐ ${v.slice(pos)}`;
    ta.setSelectionRange(pos + 3, pos + 3);
  }
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

export const actions = {
  'note-new'() {
    const n = newNote();
    go(`#note-${n.id}`);
    setTimeout(() => document.querySelector('.note-body')?.focus(), 120);
  },
  'go-notes'() {
    S.ui.libView = 'notes';
    go('#library');
  },
  'note-check'({ id, line }) {
    const n = note(id);
    if (!n) return;
    const lines = n.body.split('\n');
    const l = lines[+line];
    if (l == null || !CHECK.test(l)) return;
    lines[+line] = l.replace(CHECK, (m) => (m.includes('☐') ? m.replace('☐', '☑') : m.replace('☑', '☐')));
    n.body = lines.join('\n');
    n.updatedAt = Date.now();
    save();
    rerender();
  },
  'note-checklist'() {
    const ta = document.querySelector('.note-body');
    if (ta) toggleChecklist(ta);
  },
  'note-color'({ id, color }) {
    const n = note(id);
    if (!n) return;
    n.color = color;
    n.updatedAt = Date.now();
    save();
    rerender();
  },
  'note-pin'({ id }) {
    const n = note(id);
    if (!n) return;
    n.pinned = !n.pinned;
    save();
    rerender();
    toast(n.pinned ? 'הפתק הוצמד למעלה 📌' : 'ההצמדה בוטלה');
  },
  async 'note-share'({ id }) {
    const n = note(id);
    if (!n) return;
    const text = [n.title, n.body].filter(Boolean).join('\n\n');
    try {
      if (navigator.share) return await navigator.share({ title: n.title || 'פתק', text });
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
    shareOrDownload(new File([text], `${(n.title || 'פתק').slice(0, 40)}.txt`, { type: 'text/plain' }));
  },
  async 'note-del'({ id }) {
    if (!(await askConfirm('למחוק את הפתק?'))) return;
    S.data.notes = S.data.notes.filter((x) => x.id !== id);
    save();
    S.ui.libView = 'notes';
    go('#library');
  },
};
