// Tasks, extended: a checklist of steps (for projects and long assignments)
// and tasks that come back every week (weekly homework).
import { S, save, task } from './core.js';
import { esc, uid, isoDate, parseISO, addDays } from './util.js';
import { ICON } from './icons.js';
import { section } from './components.js';
import { toast } from './ui.js';
import { rerender } from './router.js';
import { burstFrom } from './motion.js';

export const REPEATS = [
  { value: '', label: 'לא חוזרת' },
  { value: 'weekly', label: 'כל שבוע' },
  { value: 'biweekly', label: 'כל שבועיים' },
];
const REPEAT_DAYS = { weekly: 7, biweekly: 14 };
export const repeatLabel = (t) => REPEATS.find((r) => r.value === t?.repeat && r.value)?.label || '';

/** "2/5" and a 0..1 fraction, or null when the task has no steps. */
export function stepsProgress(t) {
  const st = t.steps || [];
  if (!st.length) return null;
  const done = st.filter((x) => x.done).length;
  return { done, total: st.length, frac: done / st.length };
}

/** Task page: the checklist with a progress bar and an add box. */
export function stepsSection(t) {
  const st = t.steps || [];
  const p = stepsProgress(t);
  return section(
    'שלבים',
    `<div class="card steps-card">
      ${
        p
          ? `<div class="steps-head"><span class="steps-count"><b>${p.done}</b>/${p.total}</span>
              <span class="meter steps-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p.frac * 100)}" aria-label="שלבים שבוצעו"><span class="meter-fill" style="width:${p.frac * 100}%"></span></span></div>`
          : '<p class="muted small">מחלקים עבודה גדולה לשלבים קטנים — ומסמנים כל שלב שסיימת.</p>'
      }
      <div class="steps">${st
        .map(
          (x) => `<div class="step${x.done ? ' on' : ''}">
            <button class="step-check" data-act="step-toggle" data-id="${t.id}" data-sid="${x.id}" aria-pressed="${!!x.done}" aria-label="${x.done ? 'סימון כלא בוצע' : 'סימון כבוצע'}">${ICON.check}</button>
            <span class="step-text">${esc(x.text)}</span>
            <button class="icon-btn sm" data-act="step-del" data-id="${t.id}" data-sid="${x.id}" aria-label="מחיקת שלב">${ICON.x}</button>
          </div>`
        )
        .join('')}</div>
      <form class="add-topic add-step" data-form="step" data-id="${t.id}">
        <textarea name="t" rows="1" placeholder="${st.length ? 'עוד שלב…' : 'למשל: לקרוא את הפרק'}"></textarea>
        <button class="btn tinted" type="submit">הוספה</button>
      </form>
    </div>`,
    p && p.done === p.total ? '<span class="chip good">✓ הכל בוצע</span>' : ''
  );
}

/** Lines → steps (one per line; bullets and numbers are dropped). */
export function addSteps(t, text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((x) => x.replace(/^[\s•\-*\d.)]+/, '').trim())
    .filter(Boolean);
  if (!lines.length) return 0;
  t.steps = [...(t.steps || []), ...lines.map((x) => ({ id: uid(), text: x, done: false }))];
  save();
  return lines.length;
}

/**
 * A repeating task was finished → the next one appears (same title, subject,
 * steps unticked), due a week (or two) later. Returns the new task or null.
 */
export function spawnNext(t) {
  const days = REPEAT_DAYS[t.repeat];
  if (!days || t.nextId) return null;
  const base = t.due ? parseISO(t.due) : new Date();
  let due = addDays(base, days);
  while (isoDate(due) < isoDate()) due = addDays(due, days); // finished late: skip to the next one ahead
  const nt = {
    id: uid(), title: t.title, subjectId: t.subjectId, extraSubjects: t.extraSubjects || [], due: isoDate(due),
    notes: t.notes || '', repeat: t.repeat, steps: (t.steps || []).map((x) => ({ id: uid(), text: x.text, done: false })),
    done: false, doneAt: null, grade: '', source: 'manual', createdAt: Date.now(),
  };
  t.nextId = nt.id;
  S.data.tasks.push(nt);
  save();
  return nt;
}

export const actions = {
  'step-toggle'({ id, sid }, el) {
    const t = task(id);
    const x = t?.steps?.find((s) => s.id === sid);
    if (!x) return;
    x.done = !x.done;
    save();
    const p = stepsProgress(t);
    if (x.done) burstFrom(el);
    rerender();
    if (x.done && p.done === p.total && !t.done) toast('כל השלבים בוצעו! 🎉 אפשר לסמן את המשימה כבוצעה', 4000);
  },
  'step-del'({ id, sid }) {
    const t = task(id);
    if (!t) return;
    t.steps = (t.steps || []).filter((s) => s.id !== sid);
    save();
    rerender();
  },
};
