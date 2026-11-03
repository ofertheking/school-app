// Achievements (הישגים): badges that unlock from what the student actually does.
// New ones pop with a toast and confetti; nothing to maintain — all computed.
import { S, save, streak, gradedRecords, minutesBetween } from './core.js';
import { esc } from './util.js';
import { ICON } from './icons.js';
import { section } from './components.js';
import { toast } from './ui.js';
import { burst } from './motion.js';

const done = (d) => d.tasks.filter((t) => t.done).length;
const hours = () => minutesBetween(0, Date.now() + 1) / 60;
const avg = () => {
  const r = gradedRecords();
  return r.length >= 3 ? r.reduce((a, x) => a + x.grade, 0) / r.length : 0;
};
const pages = (d) => d.items.filter((i) => i.notebook).reduce((a, i) => a + (i.files || []).length, 0);

export const BADGES = [
  { id: 'first-exam', icon: 'exam', color: 'red', title: 'יוצאים לדרך', desc: 'הוספת מבחן ראשון', test: (d) => d.exams.length >= 1 },
  { id: 'tasks-5', icon: 'tasks', color: 'orange', title: 'מסיים/ת דברים', desc: '5 משימות בוצעו', test: (d) => done(d) >= 5 },
  { id: 'tasks-25', icon: 'tasks', color: 'orange', title: 'מכונת משימות', desc: '25 משימות בוצעו', test: (d) => done(d) >= 25 },
  { id: 'streak-3', icon: 'flame', color: 'orange', title: 'על הגל', desc: '3 ימי למידה ברצף', test: () => streak() >= 3 },
  { id: 'streak-7', icon: 'flame', color: 'red', title: 'שבוע שלם', desc: '7 ימי למידה ברצף', test: () => streak() >= 7 },
  { id: 'hours-10', icon: 'timer', color: 'purple', title: '10 שעות', desc: '10 שעות למידה', test: () => hours() >= 10 },
  { id: 'hours-50', icon: 'timer', color: 'purple', title: 'מרתון', desc: '50 שעות למידה', test: () => hours() >= 50 },
  { id: 'grade-90', icon: 'chart', color: 'indigo', title: 'מצטיין/ת', desc: 'ציון 90 ומעלה', test: () => gradedRecords().some((r) => r.grade >= 90) },
  { id: 'grade-100', icon: 'chart', color: 'indigo', title: 'מאה!', desc: 'ציון 100', test: () => gradedRecords().some((r) => r.grade >= 100) },
  { id: 'avg-85', icon: 'grad', color: 'blue', title: 'ממוצע 85+', desc: 'ממוצע 85 ומעלה (3 ציונים לפחות)', test: () => avg() >= 85 },
  { id: 'mastery', icon: 'check', color: 'green', title: 'שולט/ת בחומר', desc: 'כל הנושאים במבחן בשליטה', test: (d) => d.exams.some((e) => (e.topics || []).length >= 3 && e.topics.every((t) => t.s === 2)) },
  { id: 'cards-20', icon: 'cards', color: 'teal', title: 'זיכרון של פיל', desc: '20 כרטיסיות בשליטה', test: (d) => d.cards.filter((c) => (c.box || 0) >= 4).length >= 20 },
  { id: 'pages-10', icon: 'camera', color: 'green', title: 'צלם/ת המחברת', desc: '10 דפי מחברת', test: (d) => pages(d) >= 10 },
  { id: 'notes-5', icon: 'edit', color: 'pink', title: 'כותב/ת', desc: '5 פתקים', test: (d) => (d.notes || []).length >= 5 },
];

const unlocked = () => BADGES.filter((b) => {
  try {
    return b.test(S.data);
  } catch {
    return false;
  }
});

/** After a change: celebrate badges that just unlocked (silent the first time it runs). */
export function checkAchievements() {
  if (!S.loaded) return;
  const seen = S.data.settings.badges;
  const now = unlocked().map((b) => b.id);
  if (!Array.isArray(seen)) {
    S.data.settings.badges = now; // existing users: no flood of old badges
    save();
    return;
  }
  const fresh = now.filter((id) => !seen.includes(id));
  if (!fresh.length) return;
  S.data.settings.badges = [...seen, ...fresh];
  save();
  const b = BADGES.find((x) => x.id === fresh[0]);
  setTimeout(() => {
    toast(`🏅 הישג חדש: ${b.title}`, 4000, { label: 'לראות', go: '#study' });
    burst(innerWidth / 2, innerHeight * 0.75, 34);
  }, 450);
}

/** Study tab: the badge wall. */
export function achievementsSection() {
  const have = new Set(unlocked().map((b) => b.id));
  return section(
    'הישגים',
    `<div class="badges">${BADGES.map(
      (b) => `<div class="badge-tile${have.has(b.id) ? ' on' : ''}" title="${esc(b.desc)}">
        <span class="badge-medal b-${b.color}" aria-hidden="true">${ICON[b.icon] || ''}</span>
        <b>${esc(b.title)}</b><small>${esc(b.desc)}</small>
      </div>`
    ).join('')}</div>`,
    `<span class="muted small">${have.size}/${BADGES.length}</span>`
  );
}
