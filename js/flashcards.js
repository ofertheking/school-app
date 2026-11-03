// Flashcards (כרטיסיות): decks, cards, and a Leitner-style review session.
import { S, save, subjectName, subjectColor, deck, deckCards, isDue, dueCount, item } from './core.js';
import { esc, uid, isoDate, addDays, startOfDay, fmtMin } from './util.js';
import { formSheet, askConfirm, toast, closeAllSheets } from './ui.js';
import { ICON } from './icons.js';
import { head, iconBtn, empty, section, dot } from './components.js';
import { meter, ring } from './charts.js';
import { rerender, go } from './router.js';

// Days until the next review for each Leitner box.
const INTERVALS = [0, 1, 2, 4, 7, 14, 30];
const MAX_BOX = INTERVALS.length - 1;

/**
 * Parse "term - definition" style text into cards. Understands Quizlet / Anki
 * exports (tab separated) and lines split by " - ", " – ", ":", "=", "|".
 */
export function parseCards(text) {
  const out = [];
  for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
    const line = raw.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+$/, '').trim();
    if (!line) continue;
    let parts = null;
    if (line.includes('\t')) parts = line.split('\t');
    else {
      const m = line.match(/^(.+?)\s+[-–—=]>?\s+(.+)$/) || line.match(/^(.+?)\s*[:=|]\s+(.+)$/) || line.match(/^(.+?)\s*[:|]\s*(.+)$/);
      if (m) parts = [m[1], m[2]];
    }
    if (!parts) continue;
    const front = parts[0].replace(/^[\s•\-*]+|^\d+[.)]\s*/g, '').trim();
    const back = parts.slice(1).join(' ').trim();
    if (front && back) out.push({ front, back });
  }
  return out;
}

export function addCards(deckId, list) {
  for (const c of list) {
    S.data.cards.push({ id: uid(), deckId, front: c.front, back: c.back, box: 0, due: '', seen: 0 });
  }
  const d = deck(deckId);
  if (d) d.updatedAt = Date.now();
  save();
}

export function createDeck(title, subjectId = '') {
  const d = { id: uid(), title: title || 'כרטיסיות', subjectId, createdAt: Date.now(), updatedAt: Date.now() };
  S.data.decks.push(d);
  save();
  return d;
}

const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// ---------------------------------------------------------------- views

export function decksList() {
  const decks = [...S.data.decks].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const actionsRow = `<div class="row gap">
      <button class="btn primary grow" data-act="deck-new">${ICON.plus} חפיסה חדשה</button>
      <button class="btn tinted grow" data-act="import-open" data-mode="cards">ייבוא כרטיסיות</button>
    </div>`;
  if (!decks.length) {
    return `${empty('🃏', 'כרטיסיות לשינון: מושגים, תאריכים, מילים באנגלית, נוסחאות. האפליקציה מחזירה בתדירות גבוהה את מה שעוד לא יודעים.')}${actionsRow}`;
  }
  return `${actionsRow}
    <div class="deck-grid">${decks
      .map((d) => {
        const cs = deckCards(d.id);
        const n = cs.length;
        const due = dueCount(d.id);
        const pct = n ? Math.round((cs.filter((c) => (c.box || 0) >= 4).length / n) * 100) : 0;
        return `<button class="deck-tile" data-go="#deck-${d.id}" style="--dk:${subjectColor(d.subjectId)}">
          <span class="dt-stack" aria-hidden="true"><i></i><i></i></span>
          <span class="dt-face">
            ${due && n ? `<span class="dt-due">${due} לחזרה</span>` : n ? `<span class="dt-due ok">✓ הכל חזר</span>` : ''}
            <b class="dt-title">${esc(d.title)}</b>
            <span class="dt-sub">${esc(subjectName(d.subjectId))} · ${n} כרטיסיות</span>
            <span class="dt-bar" role="img" aria-label="${pct}% בשליטה"><span style="width:${pct}%"></span></span>
          </span>
        </button>`;
      })
      .join('')}</div>`;
}

export function deckPage(id) {
  const d = deck(id);
  if (!d) return `${head('לא נמצא', { back: '#study' })}${empty('🤷', 'החפיסה נמחקה')}`;
  const cards = deckCards(id);
  const due = cards.filter(isDue).length;
  const mastered = cards.filter((c) => (c.box || 0) >= 4).length;
  const pct = cards.length ? Math.round((mastered / cards.length) * 100) : 0;
  const learning = cards.filter((c) => (c.box || 0) > 0 && (c.box || 0) < 4).length;
  return `
    ${head(d.title, {
      back: '#study',
      actions: `${iconBtn('deck-edit', ICON.edit, 'עריכת חפיסה', `data-id="${id}"`)}${iconBtn('deck-del', ICON.trash, 'מחיקת חפיסה', `data-id="${id}"`)}`,
      sub: esc(subjectName(d.subjectId)),
      hero: {
        color: 'teal',
        nb: d.subjectId ? subjectColor(d.subjectId) : '',
        chips: [`${ICON.cards} ${cards.length} כרטיסיות`, due ? `${ICON.timer} ${due} לחזור היום` : '', mastered ? `${ICON.check} ${mastered} בשליטה` : ''],
      },
    })}
    ${
      cards.length
        ? `<div class="card deck-study">
            <div class="ds-top">
              ${ring(pct, `${pct}%`, 'בשליטה', `${pct}% בשליטה`)}
              <div class="ds-legend">
                <span><i class="lg-dot l-new"></i>חדשות <b>${cards.length - mastered - learning}</b></span>
                <span><i class="lg-dot l-learn"></i>בלמידה <b>${learning}</b></span>
                <span><i class="lg-dot l-done"></i>בשליטה <b>${mastered}</b></span>
              </div>
            </div>
            <button class="btn primary block lg" data-act="review-start" data-id="${id}" data-mode="due">${ICON.play} ${due ? `ללמוד עכשיו (${due})` : 'הכל חזר להיום · תרגול נוסף'}</button>
            ${due && due < cards.length ? `<button class="btn ghost block" data-act="review-start" data-id="${id}" data-mode="all">תרגול כל ה-${cards.length}</button>` : ''}
            <label class="toggle-row"><input type="checkbox" data-ui-toggle="reviewReverse" ${S.ui.reviewReverse ? 'checked' : ''}> להציג קודם את התשובה (הפוך)</label>
          </div>`
        : ''
    }
    ${section(
      'הוספת כרטיסייה',
      `<form class="card add-card" data-form="card" data-id="${id}">
        <div class="ac-side"><span class="ac-tag">שאלה</span><textarea name="front" rows="1" class="autosize" placeholder="מושג / שאלה" aria-label="צד קדמי"></textarea></div>
        <div class="ac-side back"><span class="ac-tag">תשובה</span><textarea name="back" rows="1" class="autosize" placeholder="הגדרה / תשובה" aria-label="צד אחורי"></textarea></div>
        <div class="row gap">
          <button class="btn tinted grow" type="submit">${ICON.plus} הוספה</button>
          <button class="btn ghost grow" type="button" data-act="import-open" data-mode="cards" data-deck="${id}">הדבקת רשימה</button>
        </div>
      </form>`
    )}
    ${section(
      `כרטיסיות (${cards.length})`,
      cards.length
        ? `<div class="card-stack">${cards
            .map((c) => {
              const box = Math.min(c.box || 0, MAX_BOX);
              return `<button class="card-row mini-fc${box >= 4 ? ' known' : ''}" data-act="card-edit" data-id="${c.id}">
                <span class="cr-front">${esc(c.front)}</span><span class="cr-back">${esc(c.back)}</span>
                <span class="box-bars" role="img" aria-label="רמת שליטה ${box} מתוך ${MAX_BOX}">${Array.from({ length: MAX_BOX }, (_, i) => `<i${i < box ? ' class="on"' : ''}></i>`).join('')}</span>
              </button>`;
            })
            .join('')}</div>`
        : empty('✍️', 'מוסיפים כרטיסיות אחת-אחת, או מדביקים רשימה של "מושג - הגדרה" (גם מ-Quizlet).')
    )}
  `;
}

export function reviewPage() {
  const r = S.ui.review;
  if (!r) {
    return `${head('תרגול', { back: '#study', hero: { color: 'teal' } })}${empty('🃏', 'אין תרגול פעיל כרגע. בוחרים חפיסה ולוחצים "ללמוד עכשיו".', `<button class="btn primary" data-go="#study">${ICON.cards} לחפיסות שלי</button>`)}`;
  }
  const d = deck(r.deckId);
  const done = r.idx >= r.queue.length;
  if (done) {
    const total = r.firstTry.size;
    const right = [...r.firstTry.values()].filter(Boolean).length;
    const pct = total ? Math.round((right / total) * 100) : 0;
    return `
      ${head('', { back: `#deck-${r.deckId}` })}
      <div class="card review-done${pct >= 80 ? ' great' : ''}">
        <div class="rd-medal" aria-hidden="true">${pct >= 80 ? '🏆' : pct >= 50 ? '💪' : '🌱'}</div>
        <h2>סיימת סבב!</h2>
        ${ring(pct, `${pct}%`, 'בפעם הראשונה', `${pct}% בפעם הראשונה`)}
        <p>ידעת <b>${right}</b> מתוך <b>${total}</b> בפעם הראשונה</p>
        ${r.loggedMin ? `<p class="muted small">נרשמו ${fmtMin(r.loggedMin)} לשעות הלמידה</p>` : ''}
        ${right < total ? `<button class="btn primary block" data-act="review-wrong">עוד סבב על מה שלא ידעת (${total - right})</button>` : ''}
        <button class="btn ghost block" data-go="#deck-${r.deckId}">חזרה לחפיסה</button>
      </div>`;
  }
  const c = S.data.cards.find((x) => x.id === r.queue[r.idx]);
  if (!c) {
    r.idx++;
    return reviewPage();
  }
  const reverse = r.reverse;
  const q = reverse ? c.back : c.front;
  const a = reverse ? c.front : c.back;
  const shown = r.flipped ? a : q;
  const size = shown.length > 160 ? 'sm' : shown.length > 60 ? 'md' : 'lg';
  return `
    ${head('', { back: `#deck-${r.deckId}`, actions: `<span class="head-note">${esc(d?.title || '')}</span>` })}
    <div class="review-progress"><span class="rp-count"><bdi>${r.idx + 1} / ${r.queue.length}</bdi></span>${meter((r.idx / r.queue.length) * 100, { label: 'התקדמות' })}</div>
    <div class="fc-deck" aria-hidden="true"><i></i><i></i></div>
    <button class="flashcard${r.flipped ? ' flipped' : ''}" data-act="review-flip" aria-live="polite" style="--fc:${d?.subjectId ? subjectColor(d.subjectId) : 'var(--accent)'}">
      <span class="fc-side">${r.flipped ? 'תשובה' : 'שאלה'}</span>
      <span class="fc-text ${size}">${esc(shown)}</span>
      ${r.flipped ? `<span class="fc-q muted small">${esc(q)}</span>` : `<span class="fc-hint muted small">לחיצה כדי להפוך</span>`}
    </button>
    ${
      r.flipped
        ? `<div class="review-btns">
            <button class="btn review-no" data-act="review-answer" data-ok="0">${ICON.x} לא ידעתי</button>
            <button class="btn review-yes" data-act="review-answer" data-ok="1">${ICON.check} ידעתי</button>
          </div>`
        : `<button class="btn primary block lg" data-act="review-flip">הצגת התשובה</button>`
    }
  `;
}

// ---------------------------------------------------------------- study session

function startReview(deckId, ids) {
  S.ui.review = {
    deckId,
    queue: shuffle([...ids]),
    idx: 0,
    flipped: false,
    reverse: S.ui.reviewReverse,
    firstTry: new Map(),
    repeats: new Map(),
    startedAt: Date.now(),
    loggedMin: 0,
  };
  go('#review');
}

/** Record time spent on flashcards as a study session (once per review). */
function logReviewTime() {
  const r = S.ui.review;
  if (!r || r.logged) return;
  r.logged = true;
  const minutes = Math.round((Date.now() - r.startedAt) / 60000);
  if (minutes < 1) return;
  const d = deck(r.deckId);
  S.data.sessions.push({ id: uid(), subjectId: d?.subjectId || '', examId: '', start: r.startedAt, minutes, note: `כרטיסיות: ${d?.title || ''}` });
  r.loggedMin = minutes;
  save();
}

function cardForm(c) {
  formSheet({
    title: 'עריכת כרטיסייה',
    values: c,
    fields: [
      { name: 'front', label: 'מושג / שאלה', type: 'textarea', rows: 2, required: true },
      { name: 'back', label: 'הגדרה / תשובה', type: 'textarea', rows: 3, required: true },
    ],
    footer: `<div class="sheet-foot"><button type="button" class="btn danger-ghost block" data-act="card-del" data-id="${c.id}">${ICON.trash} מחיקת הכרטיסייה</button></div>`,
    onSubmit(v) {
      Object.assign(c, v);
      save();
      rerender();
    },
  });
}

function deckForm(d) {
  const isNew = !d;
  formSheet({
    title: isNew ? 'חפיסה חדשה' : 'עריכת חפיסה',
    values: d || { subjectId: '' },
    fields: [
      { name: 'title', label: 'שם החפיסה', required: true, placeholder: 'למשל: מושגים בהיסטוריה — פרק 3' },
      { name: 'subjectId', label: 'מקצוע', type: 'subject' },
    ],
    onSubmit(v) {
      if (isNew) {
        const nd = createDeck(v.title, v.subjectId);
        go(`#deck-${nd.id}`);
      } else {
        Object.assign(d, v, { updatedAt: Date.now() });
        save();
        rerender();
      }
    },
  });
}

export const actions = {
  'deck-new': () => deckForm(),
  'deck-edit': ({ id }) => deckForm(deck(id)),
  async 'deck-del'({ id }) {
    const d = deck(id);
    if (!(await askConfirm(`למחוק את "${d.title}"?`, { detail: `כולל ${deckCards(id).length} כרטיסיות.` }))) return;
    S.data.decks = S.data.decks.filter((x) => x.id !== id);
    S.data.cards = S.data.cards.filter((c) => c.deckId !== id);
    save();
    go('#study');
  },
  'card-edit': ({ id }) => cardForm(S.data.cards.find((c) => c.id === id)),
  async 'card-del'({ id }) {
    if (!(await askConfirm('למחוק את הכרטיסייה?'))) return;
    S.data.cards = S.data.cards.filter((c) => c.id !== id);
    save();
    closeAllSheets();
    rerender();
  },
  'review-start'({ id, mode }) {
    const cards = deckCards(id);
    let pick = mode === 'due' ? cards.filter(isDue) : cards;
    if (!pick.length) pick = cards;
    if (!pick.length) return toast('אין עדיין כרטיסיות בחפיסה');
    startReview(id, pick.map((c) => c.id));
  },
  'review-flip'() {
    const r = S.ui.review;
    if (!r) return;
    r.flipped = !r.flipped;
    rerender();
  },
  'review-answer'({ ok }) {
    const r = S.ui.review;
    if (!r) return;
    const id = r.queue[r.idx];
    const c = S.data.cards.find((x) => x.id === id);
    const knew = ok === '1';
    if (!r.firstTry.has(id)) r.firstTry.set(id, knew);
    if (c) {
      c.seen = (c.seen || 0) + 1;
      if (knew) {
        // Only promote on a first-try success; a card relearned in this session restarts at box 1.
        c.box = r.firstTry.get(id) ? Math.min((c.box || 0) + 1, MAX_BOX) : 1;
        c.due = isoDate(addDays(startOfDay(), INTERVALS[c.box]));
      } else {
        c.box = 0;
        c.due = isoDate();
        const n = r.repeats.get(id) || 0;
        if (n < 2) {
          r.queue.push(id); // see it again later in this session
          r.repeats.set(id, n + 1);
        }
      }
    }
    r.idx++;
    r.flipped = false;
    if (r.idx >= r.queue.length) logReviewTime();
    save();
    rerender();
  },
  'review-wrong'() {
    const r = S.ui.review;
    if (!r) return;
    const wrong = [...r.firstTry.entries()].filter(([, v]) => !v).map(([k]) => k);
    startReview(r.deckId, wrong);
  },
  /** Turn a summary's "term - definition" lines into a new deck. */
  'note-to-cards'({ id }) {
    const it = item(id);
    const list = parseCards(it?.body);
    if (!list.length) {
      return toast('לא נמצאו שורות בפורמט "מושג - הגדרה". כותבים כל מושג בשורה: מושג - הסבר', 6000);
    }
    const d = createDeck(it.title ? `כרטיסיות: ${it.title}` : 'כרטיסיות מהסיכום', it.subjectId);
    addCards(d.id, list);
    toast(`נוצרו ${list.length} כרטיסיות 🃏`);
    go(`#deck-${d.id}`);
  },
};

/** Called by the router when leaving the review screen. */
export function onLeaveReview() {
  logReviewTime();
}
