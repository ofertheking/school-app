// App state, persistence glue and read-only selectors.
import { loadState, saveState, listStateKeys, deleteState } from './store.js';
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
    years: [],
    currentYear: '',
    timer: null,
  };
}

// Content that belongs to one school year (everything but profile/settings/years).
export const YEAR_KEYS = ['subjects', 'exams', 'tasks', 'sessions', 'items', 'lessons', 'decks', 'cards'];

/** Israeli school year label for a date, e.g. "2026/27" (starts ~September). */
export function schoolYearName(d = new Date()) {
  const start = d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1;
  return `${start}/${String(start + 1).slice(2)}`;
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

/**
 * Read the saved data. Until this succeeds nothing is ever written, so a slow
 * or failed start can't overwrite the real data with an empty state.
 */
export async function load() {
  try {
    const saved = await loadState();
    S.data = migrate(saved);
    S.loaded = true;
    S.loadFailed = false;
  } catch (e) {
    console.error('load failed', e);
    S.data = migrate(null);
    S.loaded = false;
    S.loadFailed = true;
  }
}

const hasContent = (d) => YEAR_KEYS.some((k) => k !== 'subjects' && d[k]?.length);

/** Once a day, keep a copy of the data as it was when the app opened (last 10 days). */
export async function autoSnapshot() {
  if (!S.loaded || !hasContent(S.data)) return;
  try {
    const key = `snap:${isoDate()}`;
    const snaps = (await listStateKeys()).filter((k) => k.startsWith('snap:')).sort();
    if (!snaps.includes(key)) {
      const snap = { currentYear: S.data.currentYear, takenAt: Date.now() };
      for (const k of YEAR_KEYS) snap[k] = S.data[k];
      await saveState(snap, key);
      snaps.push(key);
    }
    for (const k of snaps.slice(0, Math.max(0, snaps.length - 10))) await deleteState(k);
  } catch { /* best effort */ }
}

export function migrate(saved) {
  const d = defaults();
  if (!saved || typeof saved !== 'object') saved = {};
  const out = { ...d, ...saved };
  out.profile = { ...d.profile, ...(saved.profile || {}) };
  out.settings = { ...d.settings, ...(saved.settings || {}) };
  out.settings.webtop = { ...d.settings.webtop, ...(saved.settings?.webtop || {}) };
  out.settings.appearance = { ...d.settings.appearance, ...(saved.settings?.appearance || {}) };
  for (const k of YEAR_KEYS) {
    if (!Array.isArray(out[k])) out[k] = [];
  }
  if (!Array.isArray(out.years) || !out.years.length) {
    const id = uid();
    out.years = [{ id, name: schoolYearName() }];
    out.currentYear = id;
  }
  if (!out.years.some((y) => y.id === out.currentYear)) out.currentYear = out.years[0].id;
  return out;
}

const persist = debounce(() => {
  if (!S.loaded) return; // never write before the saved data was read
  saveState(S.data).catch(() => {});
}, 250);
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
    .filter((e) => e.date >= today && !e.done)
    .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
}

export function pastExams() {
  const today = isoDate();
  return S.data.exams.filter((e) => e.date < today || e.done).sort((a, b) => b.date.localeCompare(a.date));
}
export const examFinished = (e) => !!e.done || daysUntil(e.date) < 0;

export function openTasks() {
  return S.data.tasks
    .filter((t) => !t.done)
    .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
}

export const hasGrade = (x) => x && x.grade != null && String(x.grade).trim() !== '' && !isNaN(+x.grade);

/** Every grade (exams + graded tasks), oldest first, in one shape. */
export function gradedRecords(subjectId) {
  const exams = S.data.exams.filter(hasGrade).map((e) => ({
    kind: 'exam', id: e.id, subjectId: e.subjectId, title: e.title || e.type || 'מבחן', date: e.date, grade: +e.grade, href: `#exam-${e.id}`,
  }));
  const tasks = S.data.tasks.filter(hasGrade).map((t) => ({
    kind: 'task', id: t.id, subjectId: t.subjectId, title: t.title || 'משימה',
    date: t.due || isoDate(new Date(t.doneAt || t.createdAt || Date.now())), grade: +t.grade, href: `#task-${t.id}`,
  }));
  return [...exams, ...tasks]
    .filter((r) => subjectId == null || r.subjectId === subjectId)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function gradeAverage(subjectId) {
  const g = gradedRecords(subjectId || null).map((r) => r.grade);
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

/**
 * Replace the whole subject list with a fresh set built from `names`.
 * Existing exams/tasks/items/sessions/decks are re-pointed to the new subject
 * with a matching name, or unlinked (kept, but with no subject) if none matches.
 */
export function replaceSubjects(names) {
  const seen = [];
  const fresh = [];
  for (const raw of names) {
    const name = String(raw || '').trim();
    if (!name || fresh.some((s) => sameSubject(s.name, name))) continue;
    fresh.push({ id: uid(), name, color: fresh.length % COLOR_COUNT });
    seen.push(name);
  }
  const remap = (oldId) => {
    const old = S.data.subjects.find((s) => s.id === oldId);
    if (!old) return '';
    const m = fresh.find((s) => sameSubject(s.name, old.name));
    return m ? m.id : '';
  };
  for (const k of ['exams', 'tasks', 'items', 'sessions', 'decks']) {
    for (const rec of S.data[k]) rec.subjectId = remap(rec.subjectId);
  }
  S.data.subjects = fresh;
  save();
}

// ---------- flashcards ----------
export const deck = (id) => S.data.decks.find((d) => d.id === id);
export const deckCards = (id) => S.data.cards.filter((c) => c.deckId === id);
export const isDue = (c) => !c.due || c.due <= isoDate();
export const dueCount = (id) => deckCards(id).filter(isDue).length;

// ---------- school years ----------

export const currentYear = () => S.data.years.find((y) => y.id === S.data.currentYear) || S.data.years[0];

function contentOf(data) {
  const o = {};
  for (const k of YEAR_KEYS) o[k] = data[k];
  return o;
}

/** Persist the active year's content into its own archive record. */
export async function archiveCurrentYear() {
  if (!S.loaded) return;
  await saveState(contentOf(S.data), `year:${S.data.currentYear}`);
}

/** Switch the active school year. Archives the current one, loads the target. */
export async function switchYear(yearId) {
  if (!S.loaded) return;
  if (yearId === S.data.currentYear || !S.data.years.some((y) => y.id === yearId)) return;
  saveNow();
  await archiveCurrentYear();
  const loaded = (await loadState(`year:${yearId}`)) || {};
  for (const k of YEAR_KEYS) S.data[k] = Array.isArray(loaded[k]) ? loaded[k] : [];
  S.data.currentYear = yearId;
  S.data.timer = null;
  saveNow();
}

/** Create a new school year and switch to it. Optionally copy the current subjects. */
export async function addYear(name, { copySubjects = false } = {}) {
  if (!S.loaded) throw new Error('data not loaded');
  saveNow();
  await archiveCurrentYear();
  const subjectsCopy = copySubjects ? JSON.parse(JSON.stringify(S.data.subjects)) : [];
  let auto = schoolYearName();
  // Default to the year after the newest existing one, so two years never share a name.
  while (!name && S.data.years.some((x) => x.name === auto)) {
    const n = parseInt(auto, 10) + 1;
    auto = `${n}/${String(n + 1).slice(2)}`;
  }
  const y = { id: uid(), name: (name || auto).trim(), createdAt: Date.now() };
  S.data.years.push(y);
  for (const k of YEAR_KEYS) S.data[k] = [];
  S.data.subjects = subjectsCopy;
  S.data.currentYear = y.id;
  S.data.timer = null;
  saveNow();
  return y;
}

export function renameYear(yearId, name) {
  const y = S.data.years.find((x) => x.id === yearId);
  if (y && name.trim()) {
    y.name = name.trim();
    save();
  }
}
