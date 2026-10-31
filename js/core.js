// App state, persistence glue and read-only selectors.
import { loadState, saveState } from './store.js';
import { debounce, isoDate, parseISO, startOfDay, weekStart, addDays, daysUntil, uid } from './util.js';

export const COLOR_COUNT = 8;

export const COMMON_SUBJECTS = [
  'מתמטיקה', 'אנגלית', 'לשון', 'ספרות', 'היסטוריה', 'תנ״ך', 'אזרחות',
  'ביולוגיה', 'פיזיקה', 'כימיה', 'מדעי המחשב', 'ערבית', 'גאוגרפיה', 'מדעים',
];

export const EXAM_TYPES = ['מבחן', 'בוחן', 'בגרות', 'מתכונת', 'עבודה', 'הגשה', 'בעל פה'];

function defaults() {
  return {
    v: 1,
    profile: { name: '' },
    subjects: [],
    exams: [],
    tasks: [],
    sessions: [],
    items: [],
    lessons: [],
    decks: [],
    cards: [],
    settings: {
      weeklyGoalH: 10,
      pomodoroMin: 25,
      clientId: '',
      lastSync: null,
      installDismissed: false,
      webtop: { url: '', user: '', pass: '', lastSync: null, name: '' },
      appearance: { theme: 'system', accent: 'blue' },
    },
    timer: null,
  };
}

export const S = {
  data: defaults(),
  ui: {
    examsSeg: 'upcoming',
    tasksSeg: 'open',
    libKind: 'all',
    libSubject: '',
    libQuery: '',
    libView: 'notebooks',
    weekOffset: 0,
    timerSubject: '',
    timerMode: 'stopwatch',
    studySeg: 'timer',
    schedDay: null,
    review: null,
    reviewReverse: false,
    webtopShape: '',
    q: '',
    calMonth: '',
    calDay: '',
  },
};

export async function load() {
  const saved = await loadState();
  S.data = migrate(saved);
}

export function migrate(saved) {
  const d = defaults();
  if (!saved || typeof saved !== 'object') return d;
  const out = { ...d, ...saved };
  out.profile = { ...d.profile, ...(saved.profile || {}) };
  out.settings = { ...d.settings, ...(saved.settings || {}) };
  out.settings.webtop = { ...d.settings.webtop, ...(saved.settings?.webtop || {}) };
  out.settings.appearance = { ...d.settings.appearance, ...(saved.settings?.appearance || {}) };
  for (const k of ['subjects', 'exams', 'tasks', 'sessions', 'items', 'lessons', 'decks', 'cards']) {
    if (!Array.isArray(out[k])) out[k] = [];
  }
  return out;
}

const persist = debounce(() => saveState(S.data).catch(() => {}), 250);
export const save = () => persist();
export const saveNow = () => persist.flush();

// ---------- selectors ----------

export const subject = (id) => S.data.subjects.find((s) => s.id === id);

export function subjectName(id) {
  return subject(id)?.name || 'כללי';
}

export function subjectColor(id) {
  const s = subject(id);
  return s ? `var(--c${s.color % COLOR_COUNT})` : 'var(--c-none)';
}

export function nextColor() {
  const used = S.data.subjects.map((s) => s.color);
  for (let i = 0; i < COLOR_COUNT; i++) if (!used.includes(i)) return i;
  return S.data.subjects.length % COLOR_COUNT;
}

export const exam = (id) => S.data.exams.find((e) => e.id === id);
export const task = (id) => S.data.tasks.find((t) => t.id === id);
export const item = (id) => S.data.items.find((i) => i.id === id);

/** 0..100 or null when the exam has no topics yet. */
export function readiness(e) {
  const t = e.topics || [];
  if (!t.length) return null;
  const score = t.reduce((a, x) => a + (x.s || 0), 0);
  return Math.round((score / (t.length * 2)) * 100);
}

export function upcomingExams() {
  const today = isoDate();
  return S.data.exams
    .filter((e) => e.date >= today)
    .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
}

export function pastExams() {
  const today = isoDate();
  return S.data.exams.filter((e) => e.date < today).sort((a, b) => b.date.localeCompare(a.date));
}

export function openTasks() {
  return S.data.tasks
    .filter((t) => !t.done)
    .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
}

export function gradeAverage(subjectId) {
  const g = S.data.exams
    .filter((e) => (!subjectId || e.subjectId === subjectId) && e.grade !== '' && e.grade != null && !isNaN(+e.grade))
    .map((e) => +e.grade);
  if (!g.length) return null;
  return Math.round((g.reduce((a, b) => a + b, 0) / g.length) * 10) / 10;
}

export function minutesBetween(from, to, filter = {}) {
  return S.data.sessions
    .filter((s) => s.start >= +from && s.start < +to)
    .filter((s) => !filter.subjectId || s.subjectId === filter.subjectId)
    .filter((s) => !filter.examId || s.examId === filter.examId)
    .reduce((a, s) => a + (s.minutes || 0), 0);
}

export function todayMinutes() {
  const t = startOfDay();
  return minutesBetween(t, addDays(t, 1)) + liveTimerMinutes();
}

export function weekDays(offset = 0) {
  const start = addDays(weekStart(), offset * 7);
  const todayIso = isoDate();
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(start, i);
    const iso = isoDate(d);
    let minutes = minutesBetween(d, addDays(d, 1));
    if (iso === todayIso) minutes += liveTimerMinutes();
    return { date: d, iso, minutes, isToday: iso === todayIso, isFuture: iso > todayIso };
  });
}

export function weekBySubject(offset = 0) {
  const start = addDays(weekStart(), offset * 7);
  const end = addDays(start, 7);
  const map = new Map();
  for (const s of S.data.sessions) {
    if (s.start < +start || s.start >= +end) continue;
    map.set(s.subjectId || '', (map.get(s.subjectId || '') || 0) + (s.minutes || 0));
  }
  return [...map.entries()]
    .map(([subjectId, minutes]) => ({ subjectId, minutes }))
    .sort((a, b) => b.minutes - a.minutes);
}

export function streak() {
  const days = new Set(
    S.data.sessions.filter((s) => s.minutes > 0).map((s) => isoDate(new Date(s.start)))
  );
  if (S.data.timer && timerElapsed() > 60000) days.add(isoDate());
  let d = startOfDay();
  if (!days.has(isoDate(d))) d = addDays(d, -1);
  let n = 0;
  while (days.has(isoDate(d))) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

export function timerElapsed(t = S.data.timer) {
  if (!t) return 0;
  return (t.accMs || 0) + (t.startedAt ? Date.now() - t.startedAt : 0);
}

function liveTimerMinutes() {
  return S.data.timer ? Math.floor(timerElapsed() / 60000) : 0;
}

export function examUrgency(e) {
  const n = daysUntil(e.date);
  if (n <= 2) return 'hot';
  if (n <= 7) return 'warm';
  return 'cool';
}

export function dueLabelGroup(due) {
  if (!due) return 'ללא תאריך';
  const n = daysUntil(due);
  if (n < 0) return 'באיחור';
  if (n === 0) return 'היום';
  if (n === 1) return 'מחר';
  if (n <= 7) return 'השבוע הקרוב';
  return 'בהמשך';
}

export function itemKind(it) {
  if (it.notebook) return 'notebook';
  if (it.lessonDate) return 'lesson';
  if (it.body && it.body.trim()) return 'note';
  if (it.files && it.files.length) return 'file';
  if (it.url) return 'link';
  return 'note';
}

export const examDateObj = (e) => parseISO(e.date);

/** Create a library item (summary / lesson note / file / link) and return it. */
export function createItem(extra = {}) {
  const it = {
    id: uid(), subjectId: '', title: '', body: '', url: '', files: [], pinned: false,
    source: 'manual', createdAt: Date.now(), updatedAt: Date.now(), ...extra,
  };
  S.data.items.push(it);
  save();
  return it;
}

/** Find a subject by name, or create it. "מתמטיקה 5 יח״ל" matches "מתמטיקה", but "חינוך גופני" ≠ "חינוך". */
const LEVEL_WORDS = /^(יחל|יחידות|מוגבר|מוגברת|מורחב|מורחבת|הקבצה|מגמה|רגיל|רגילה|כיתה)$/;
const nameKey = (x) => String(x || '').toLowerCase().replace(/["'׳״`.,()\-–]/g, '').replace(/\s+/g, ' ').trim();
function sameSubject(a, b) {
  const x = nameKey(a);
  const y = nameKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (!long.startsWith(`${short} `)) return false;
  // Only a level / class suffix may differ (digits, יח״ל, א׳…), not another word.
  return long
    .slice(short.length + 1)
    .split(' ')
    .every((w) => /\d/.test(w) || w.length <= 2 || LEVEL_WORDS.test(w));
}

export function ensureSubject(name) {
  const clean = String(name || '').trim();
  if (!clean) return '';
  const hit = S.data.subjects.find((s) => sameSubject(s.name, clean));
  if (hit) return hit.id;
  const s = { id: uid(), name: clean, color: nextColor() };
  S.data.subjects.push(s);
  return s.id;
}

// ---------- flashcards ----------
export const deck = (id) => S.data.decks.find((d) => d.id === id);
export const deckCards = (id) => S.data.cards.filter((c) => c.deckId === id);
export const isDue = (c) => !c.due || c.due <= isoDate();
export const dueCount = (id) => deckCards(id).filter(isDue).length;
