// Google-Classroom-style class cards and banners (with an iOS finish): a
// coloured banner with geometric art per subject, the teacher, and what's next.
import { S, upcomingExams, openTasks, gradeAverage } from './core.js';
import { esc, relDay, daysUntil, pad } from './util.js';
import { ICON } from './icons.js';
import { DAY_NAMES, lessonsOn } from './schedule.js';
import { L, tr } from './i18n.js';

const colorOf = (s) => (s ? `var(--c${s.color % 8})` : 'var(--c-none)');
const hash = (str) => [...String(str)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** Banner art: one of a few geometric motifs (white, translucent), picked per subject. */
export function bannerArt(seed) {
  const W = (a) => `rgba(255,255,255,${a})`;
  const v = seed % 4;
  let art;
  if (v === 0) {
    art = `<circle cx="252" cy="18" r="72" fill="${W(0.14)}"/><circle cx="196" cy="98" r="34" fill="${W(0.12)}"/><circle cx="288" cy="84" r="15" fill="${W(0.2)}"/>`;
  } else if (v === 1) {
    art = `<path d="M110 74 Q150 44 190 74 T270 74 T350 74 V120 H110Z" fill="${W(0.13)}"/><path d="M135 92 Q175 64 215 92 T295 92 T375 92 V120 H135Z" fill="${W(0.13)}"/><circle cx="258" cy="28" r="11" fill="${W(0.26)}"/>`;
  } else if (v === 2) {
    art = `<path d="M206 -10 L306 -10 L306 84Z" fill="${W(0.14)}"/><path d="M166 116 L226 42 L286 116Z" fill="${W(0.12)}"/><rect x="238" y="22" width="22" height="22" rx="5" transform="rotate(22 249 33)" fill="${W(0.22)}"/>`;
  } else {
    let dots = '';
    for (let x = 182; x <= 292; x += 15) for (let y = 14; y <= 96; y += 15) dots += `<circle cx="${x}" cy="${y}" r="2.1" fill="${W(0.3)}"/>`;
    art = `${dots}<circle cx="236" cy="58" r="36" fill="none" stroke="${W(0.2)}" stroke-width="11"/>`;
  }
  return `<svg class="cc-art" viewBox="0 0 300 110" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">${art}</svg>`;
}

/** Teacher and room for a subject, from the timetable. */
export function teacherOf(sid) {
  const ls = S.data.lessons.filter((l) => l.subjectId === sid);
  return { teacher: ls.find((l) => l.teacher)?.teacher || '', room: ls.find((l) => l.room)?.room || '' };
}

/** The next time this subject is on the timetable: { label, start } or null. */
export function nextLessonOf(sid) {
  const now = new Date();
  const hm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  for (let i = 0; i < 8; i++) {
    const day = (now.getDay() + i) % 7;
    const l = lessonsOn(day).find((x) => x.subjectId === sid && (i > 0 || !x.start || x.start > hm));
    if (l) {
      const label = i === 0 ? L('היום', 'Today') : i === 1 ? L('מחר', 'Tomorrow') : L(`יום ${DAY_NAMES[day]}`, DAY_NAMES[day]);
      return { label, start: l.start || '' };
    }
  }
  return null;
}

/** Upcoming exams + open tasks of a subject, soonest first. */
function upNext(sid, n = 2) {
  const ex = upcomingExams().filter((e) => e.subjectId === sid).map((e) => ({ date: e.date, title: e.title || e.type, kind: 'exam' }));
  const ts = openTasks().filter((t) => t.subjectId === sid && t.due).map((t) => ({ date: t.due, title: t.title, kind: 'task' }));
  return [...ex, ...ts].sort((a, b) => a.date.localeCompare(b.date)).slice(0, n);
}

export function classCard(s) {
  const { teacher } = teacherOf(s.id);
  const items = upNext(s.id);
  const avg = gradeAverage(s.id);
  // A name's first letter, in the interface language for subject names (Math → M).
  const initial = (teacher || tr(s.name)).trim().slice(0, 1);
  return `<button class="class-card" data-go="#subject-${s.id}" style="--nb:${colorOf(s)}">
    <span class="cc-banner">${bannerArt(hash(s.id))}
      <span class="cc-title"><b>${esc(s.name)}</b>${teacher ? `<small>${esc(teacher)}</small>` : ''}</span>
    </span>
    <span class="cc-avatar" aria-hidden="true" data-raw>${esc(initial)}</span>
    <span class="cc-body">${
      items.length
        ? items
            .map((it) => {
              const n = daysUntil(it.date);
              return `<span class="cc-item"><span class="cc-ico ${it.kind}">${it.kind === 'exam' ? ICON.exam : ICON.tasks}</span><span class="cc-it">${esc(it.title)}</span><span class="cc-due${n <= 1 ? ' hot' : ''}">${relDay(it.date)}</span></span>`;
            })
            .join('')
        : `<span class="cc-none">אין משהו קרוב 🎉</span>`
    }</span>
    <span class="cc-foot">${avg != null ? `<span class="cc-avg">${ICON.chart}${avg}</span>` : '<span></span>'}<span class="cc-nb">${ICON.book}</span></span>
  </button>`;
}

/** Home: horizontally scrolling class cards. */
export function classCardsRow() {
  const subs = S.data.subjects;
  if (!subs.length) return '';
  return `<div class="class-scroll">${subs.map(classCard).join('')}
    <button class="class-card add" data-act="add-subject">${ICON.plus}<span>מקצוע חדש</span></button></div>`;
}

/** Subject page header: a big Classroom banner. */
export function subjectBanner(s) {
  const { teacher, room } = teacherOf(s.id);
  const next = nextLessonOf(s.id);
  return `<div class="class-hero" style="--nb:${colorOf(s)}">${bannerArt(hash(s.id))}
    <div class="ch-text">
      <h1 class="large-title">${esc(s.name)}</h1>
      ${teacher || room ? `<p class="ch-sub">${[teacher, room && `${L('חדר', 'Room')} ${room}`].filter(Boolean).map(esc).join(' · ')}</p>` : ''}
      ${next ? `<span class="ch-chip">${ICON.calendar}<span>השיעור הבא: ${esc(next.label)}${next.start ? ` <bdi>${esc(next.start)}</bdi>` : ''}</span></span>` : ''}
    </div>
  </div>`;
}

/** Home: welcome banner with today's summary. */
export function homeHero({ title, date, chips }) {
  return `<div class="home-hero">${bannerArt(hash(new Date().toDateString()))}
    <div class="hh-text">
      <p class="hh-date">${date}</p>
      <h1 class="large-title">${esc(title)}</h1>
      ${chips.length ? `<div class="hh-chips">${chips.map((c) => `<span class="hh-chip">${c}</span>`).join('')}</div>` : ''}
    </div>
  </div>`;
}
