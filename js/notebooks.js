// Notebooks (מחברות): one per subject, holding photographed notebook pages,
// summaries, lesson notes, files, links and flashcard decks for that subject.
import { S, save, subject, subjectName, itemKind, createItem } from './core.js';
import { esc, fmtDate, isoDate } from './util.js';
import { ICON } from './icons.js';
import { head, section, empty } from './components.js';
import { storeFiles, openGallery } from './files.js';
import { rerender } from './router.js';
import { toast } from './ui.js';

const keyOf = (sid) => sid || 'general';
const sidOf = (key) => (key === 'general' ? '' : key);
const colorOf = (sid) => (subject(sid) ? `var(--c${subject(sid).color % 8})` : 'var(--c-none)');
const isImg = (f) => f.type?.startsWith('image/');

const itemsOf = (sid) => S.data.items.filter((i) => (i.subjectId || '') === sid);
const pageBatches = (sid) =>
  itemsOf(sid)
    .filter((i) => i.notebook)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

/** Every notebook photo of a subject, newest batch first. */
function pageEntries(sid) {
  const out = [];
  for (const it of pageBatches(sid)) {
    for (const f of (it.files || []).filter(isImg)) {
      out.push({ ref: `item:${it.id}`, fid: f.id, caption: `${fmtDate(isoDate(new Date(it.createdAt)))}${it.title ? ` · ${it.title}` : ''}` });
    }
  }
  return out;
}

function counts(sid) {
  const items = itemsOf(sid);
  const pages = pageEntries(sid).length;
  const notes = items.filter((i) => ['note', 'lesson'].includes(itemKind(i))).length;
  const other = items.filter((i) => ['file', 'link'].includes(itemKind(i))).length;
  return { pages, notes, other, total: items.length };
}

export function notebooksGrid() {
  const list = S.data.subjects.map((s) => s.id);
  if (itemsOf('').length || !list.length) list.push('');
  if (!S.data.subjects.length) {
    return empty('📓', 'לכל מקצוע יש מחברת: צילומי דפים, סיכומים, קבצים וכרטיסיות, הכל במקום אחד. מתחילים בהוספת מקצועות.', `<button class="btn tinted" data-act="add-subject">＋ הוספת מקצוע</button>`);
  }
  return `<div class="nb-grid">${list
    .map((sid) => {
      const c = counts(sid);
      const cover = pageEntries(sid)[0];
      return `<button class="nb-card" data-go="#notebook-${keyOf(sid)}" style="--nb:${colorOf(sid)}">
        <span class="nb-cover">${cover ? `<img alt="" data-file-src="${cover.fid}">` : `<span class="nb-lines" aria-hidden="true"></span>`}<span class="nb-spine"></span></span>
        <span class="nb-name">${esc(sid ? subjectName(sid) : 'כללי')}</span>
        <span class="nb-meta">${c.total ? [c.pages && `${c.pages} דפים`, c.notes && `${c.notes} סיכומים`, c.other && `${c.other} קבצים`].filter(Boolean).join(' · ') : 'ריקה'}</span>
      </button>`;
    })
    .join('')}</div>`;
}

const KIND_ICON = { note: ICON.note, lesson: ICON.calendar, file: ICON.clip, link: ICON.link, notebook: ICON.camera };

function itemRows(list) {
  return `<div class="card list">${list
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .map(
      (it) => `<button class="row-btn" data-go="#item-${it.id}">
        <span class="item-thumb sm k-${itemKind(it)}">${KIND_ICON[itemKind(it)]}</span>
        <span class="grow">${esc(it.title || 'ללא כותרת')}<br><span class="muted small">${fmtDate(isoDate(new Date(it.lessonDate ? it.lessonDate : it.updatedAt || it.createdAt)))}</span></span>
        <span class="chev">${ICON.fwd}</span></button>`
    )
    .join('')}</div>`;
}

export function notebookPage(key) {
  const sid = sidOf(key);
  if (sid && !subject(sid)) return `${head('לא נמצא', { back: '#library' })}${empty('🤷', 'המקצוע נמחק')}`;
  const name = sid ? subjectName(sid) : 'כללי';
  const c = counts(sid);
  const items = itemsOf(sid);
  const notes = items.filter((i) => ['note', 'lesson'].includes(itemKind(i)) && !i.notebook);
  const others = items.filter((i) => ['file', 'link'].includes(itemKind(i)) && !i.notebook);
  const decks = S.data.decks.filter((d) => (d.subjectId || '') === sid);
  const entries = pageEntries(sid);
  let idx = 0;
  const batches = pageBatches(sid)
    .map((it) => {
      const imgs = (it.files || []).filter(isImg);
      const docs = (it.files || []).filter((f) => !isImg(f));
      if (!imgs.length && !docs.length && !it.body) return '';
      const thumbs = imgs
        .map((f) => `<button class="nb-page" data-act="nb-page" data-key="${key}" data-idx="${idx++}" aria-label="פתיחת דף"><img alt="" data-file-src="${f.id}"></button>`)
        .join('');
      return `<div class="nb-batch">
        <button class="nb-batch-title" data-go="#item-${it.id}"><b>${fmtDate(isoDate(new Date(it.createdAt)))}</b>${it.title && !/^דפי מחברת/.test(it.title) ? ` · ${esc(it.title)}` : ''}
          ${it.body?.trim() ? `<span class="muted small"> · יש הערות</span>` : ''}${docs.length ? `<span class="muted small"> · ${docs.length} קבצים</span>` : ''}<span class="chev">${ICON.fwd}</span></button>
        <div class="nb-pages">${thumbs}</div>
      </div>`;
    })
    .join('');

  return `
    ${head(`מחברת ${name}`, {
      back: '#library',
      sub: `<span class="dot lg" style="background:${colorOf(sid)}"></span> ${c.pages} דפים · ${c.notes} סיכומים · ${decks.length} חפיסות כרטיסיות`,
    })}
    <div class="nb-actions">
      <label class="btn primary nb-shoot">${ICON.camera} צילום דפים מהמחברת
        <input type="file" accept="image/*" multiple data-nb-pages="${sid}" hidden></label>
      <div class="nb-actions-row">
        <button class="btn tinted" data-act="new-note" data-subject="${sid}">${ICON.note} סיכום</button>
        <button class="btn tinted" data-act="lesson-note-form" data-subject="${sid}">${ICON.calendar} סיכום שיעור</button>
        <button class="btn ghost" data-act="add-item" data-subject="${sid}">${ICON.plus} עוד</button>
      </div>
    </div>
    ${section(
      'דפי המחברת',
      batches || empty('📸', 'אחרי שיעור מצלמים את הדפים מהמחברת. הם נשמרים כאן לפי תאריך, ואפשר לדפדף ביניהם.')
    )}
    ${notes.length ? section(`סיכומים (${notes.length})`, itemRows(notes)) : ''}
    ${others.length ? section(`קבצים וקישורים (${others.length})`, itemRows(others)) : ''}
    ${
      decks.length
        ? section(
            'כרטיסיות',
            `<div class="card list">${decks
              .map((d) => `<button class="row-btn" data-go="#deck-${d.id}">🃏 <span class="grow">${esc(d.title)}</span><span class="chev">${ICON.fwd}</span></button>`)
              .join('')}</div>`
          )
        : ''
    }
  `;
}

/** Photos added from the notebook screen: grouped into one batch per subject per day. */
export async function addNotebookPages(sid, files) {
  if (!files.length) return;
  const today = isoDate();
  let batch = pageBatches(sid).find((it) => isoDate(new Date(it.createdAt)) === today);
  if (!batch) batch = createItem({ subjectId: sid, notebook: true, title: `דפי מחברת · ${fmtDate(today)}` });
  toast('שומר…', 1200);
  const metas = await storeFiles(files);
  batch.files.push(...metas);
  batch.updatedAt = Date.now();
  save();
  rerender();
  toast(`נוספו ${metas.length} דפים למחברת 📓`);
}

export const actions = {
  'nb-page'({ key, idx }) {
    openGallery(pageEntries(sidOf(key)), +idx);
  },
};
