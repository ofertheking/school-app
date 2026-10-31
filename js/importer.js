// "Import from another app": paste or pick a file → summary or flashcards.
import { S, createItem, deck } from './core.js';
import { esc } from './util.js';
import { openSheet, toast, subjectOptions, resolveSubject } from './ui.js';
import { ICON } from './icons.js';
import { parseCards, createDeck, addCards } from './flashcards.js';
import { go } from './router.js';

const TIPS = {
  note: `<ul class="tips">
    <li><b>Apple Notes / Google Docs / Word:</b> פותחים את המסמך ← לחיצה ארוכה ← "בחר הכל" ← העתקה ← "הדבקה" כאן.</li>
    <li><b>צילום של דף או לוח:</b> פותחים את התמונה ← כפתור הטקסט (Live Text) ← "בחר הכל" ← העתקה.</li>
    <li><b>קובץ טקסט:</b> "בחירת קובץ" (txt, md, csv, html).</li>
  </ul>`,
  cards: `<ul class="tips">
    <li><b>שורה לכל כרטיסייה:</b> <code>מושג - הגדרה</code> (או מושג: הגדרה).</li>
    <li><b>Quizlet:</b> בסט ← ⋯ ← ייצוא (Export) ← העתקה ← "הדבקה" כאן.</li>
    <li><b>Anki:</b> Export ← Notes in Plain Text ← "בחירת קובץ".</li>
  </ul>`,
};

/** opts: { mode: 'note'|'cards', deckId?, subjectId? } */
export function openImportSheet(opts = {}) {
  let mode = opts.mode === 'cards' ? 'cards' : 'note';
  const targetDeck = opts.deckId ? deck(opts.deckId) : null;
  openSheet(
    `<div class="sheet-head"><button type="button" class="link-btn" data-close>ביטול</button><h3>${targetDeck ? `הוספה ל"${esc(targetDeck.title)}"` : 'ייבוא מאפליקציה אחרת'}</h3><span></span></div>
     ${targetDeck ? '' : `<div class="seg"><button class="seg-btn${mode === 'note' ? ' on' : ''}" data-m="note">סיכום</button><button class="seg-btn${mode === 'cards' ? ' on' : ''}" data-m="cards">כרטיסיות</button></div>`}
     <div class="imp-tips">${TIPS[mode]}</div>
     <textarea class="paste-box" rows="7" placeholder="מדביקים כאן…"></textarea>
     <div class="row gap">
       <button class="btn ghost grow" data-paste>הדבקה</button>
       <label class="btn ghost grow">${ICON.clip} בחירת קובץ<input type="file" accept=".txt,.md,.csv,.tsv,.html,.htm,text/*" hidden data-file></label>
     </div>
     <p class="imp-status small muted"></p>
     ${
       targetDeck
         ? ''
         : `<div class="fields imp-fields">
             <label class="field"><span class="field-label">שם</span><input class="imp-title" placeholder="נלקח מהשורה הראשונה אם ריק"></label>
             <label class="field"><span class="field-label">מקצוע</span><select class="imp-subject" data-subject-select>${subjectOptions(opts.subjectId || S.ui.libSubject || '')}</select>
               <input class="new-subject" placeholder="שם המקצוע החדש" hidden></label>
           </div>`
     }
     <button class="btn primary block" data-save>שמירה</button>`,
    {
      tall: true,
      onMount(sheet, close) {
        const box = sheet.querySelector('.paste-box');
        const status = sheet.querySelector('.imp-status');
        const update = () => {
          const t = box.value.trim();
          if (!t) return (status.textContent = '');
          if (mode === 'cards') {
            const n = parseCards(t).length;
            status.textContent = n ? `זוהו ${n} כרטיסיות ✔︎` : 'לא זוהו כרטיסיות. צריך שורות בפורמט "מושג - הגדרה".';
          } else {
            status.textContent = `${t.split(/\s+/).length} מילים`;
          }
        };
        sheet.querySelectorAll('[data-m]').forEach((b) =>
          b.addEventListener('click', () => {
            mode = b.dataset.m;
            sheet.querySelectorAll('[data-m]').forEach((x) => x.classList.toggle('on', x === b));
            sheet.querySelector('.imp-tips').innerHTML = TIPS[mode];
            update();
          })
        );
        const sel = sheet.querySelector('.imp-subject');
        sel?.addEventListener('change', () => {
          const extra = sel.parentElement.querySelector('.new-subject');
          extra.hidden = sel.value !== '__new';
        });
        box.addEventListener('input', update);
        sheet.querySelector('[data-paste]').addEventListener('click', async () => {
          try {
            const t = await navigator.clipboard.readText();
            box.value = box.value ? `${box.value}\n${t}` : t;
            update();
          } catch {
            box.focus();
            toast('לחיצה ארוכה בתיבה ← "הדבקה"');
          }
        });
        sheet.querySelector('[data-file]').addEventListener('change', async (ev) => {
          const f = ev.target.files[0];
          if (!f) return;
          if (/\.(docx?|pages|pdf)$/i.test(f.name)) {
            toast('את הקובץ הזה צריך לפתוח, לבחור הכל ולהעתיק. אפשר גם לצרף אותו כקובץ לסיכום.', 6000);
            return;
          }
          let t = await f.text();
          if (/\.html?$/i.test(f.name)) {
            t = new DOMParser().parseFromString(t, 'text/html').body.innerText;
          }
          box.value = t;
          const title = sheet.querySelector('.imp-title');
          if (title && !title.value) title.value = f.name.replace(/\.[^.]+$/, '');
          update();
        });
        sheet.querySelector('[data-save]').addEventListener('click', () => {
          const text = box.value.trim();
          if (!text) return toast('אין מה לשמור — מדביקים טקסט קודם');
          const titleIn = sheet.querySelector('.imp-title')?.value.trim();
          const subjectId = targetDeck
            ? targetDeck.subjectId
            : resolveSubject(sel.value, sel.parentElement.querySelector('.new-subject').value);
          const firstLine = text.split('\n').find((l) => l.trim())?.trim().slice(0, 60) || '';
          if (mode === 'cards') {
            const list = parseCards(text);
            if (!list.length) return toast('לא זוהו כרטיסיות. כל שורה: מושג - הגדרה');
            const d = targetDeck || createDeck(titleIn || 'כרטיסיות מיובאות', subjectId);
            addCards(d.id, list);
            close();
            toast(`נוספו ${list.length} כרטיסיות 🃏`);
            go(`#deck-${d.id}`);
          } else {
            const it = createItem({ subjectId, title: titleIn || firstLine, body: text, source: 'import' });
            close();
            toast('הסיכום נשמר ✔︎');
            go(`#item-${it.id}`);
          }
        });
      },
    }
  );
}

export const actions = {
  'import-open': ({ mode, deck: deckId, subject }) => openImportSheet({ mode, deckId, subjectId: subject }),
};
