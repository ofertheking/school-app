// External connections: Google Classroom, Webtop (paste import), calendar export.
import { S, save, nextColor, subjectName } from './core.js';
import { uid, isoDate, pad, norm, parseISO, addDays } from './util.js';

// =====================================================================
// Google Classroom (OAuth 2.0 implicit flow via full-page redirect —
// popups are unreliable inside iPhone home-screen apps).
// =====================================================================

const SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
  'https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly',
  'https://www.googleapis.com/auth/classroom.profile.emails',
].join(' ');

const TOKEN_KEY = 'gc-token';
const EMAIL_KEY = 'gc-email';
const STATE_KEY = 'gc-oauth-state';

export const redirectURI = () => location.origin + location.pathname;

function lsGet(k) {
  try { return localStorage.getItem(k); } catch { return null; }
}
function lsSet(k, v) {
  try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ }
}

export function getToken() {
  try {
    const t = JSON.parse(lsGet(TOKEN_KEY) || 'null');
    if (t && t.exp > Date.now() + 60000) return t.token;
  } catch { /* ignore */ }
  return null;
}

export function forgetToken() {
  lsSet(TOKEN_KEY, null);
}

/** Email of the Google account last synced (shown in settings). */
export const connectedEmail = () => lsGet(EMAIL_KEY) || '';

export function startClassroomLogin(clientId) {
  const state = uid();
  lsSet(STATE_KEY, state);
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectURI(),
    response_type: 'token',
    scope: SCOPES,
    include_granted_scopes: 'true',
    prompt: 'select_account',
    state,
  });
  location.href = `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

/**
 * Call on startup. If Google redirected back with a token in the URL hash,
 * store it and return {ok:true}; on an error return {error}; otherwise null.
 */
export function consumeOAuthRedirect() {
  const h = location.hash.replace(/^#/, '');
  if (!/(^|&)(access_token|error)=/.test(h)) return null;
  const p = new URLSearchParams(h);
  history.replaceState(null, '', location.pathname + '#more');
  const expected = lsGet(STATE_KEY);
  lsSet(STATE_KEY, null);
  if (p.get('error')) return { error: p.get('error') };
  if (!expected || p.get('state') !== expected) return { error: 'state_mismatch' };
  const token = p.get('access_token');
  const exp = Date.now() + (Number(p.get('expires_in')) || 3600) * 1000;
  lsSet(TOKEN_KEY, JSON.stringify({ token, exp }));
  return { ok: true };
}

class ApiError extends Error {
  constructor(status, msg) {
    super(msg);
    this.status = status;
  }
}

async function api(path, token, params = {}) {
  const url = new URL(`https://classroom.googleapis.com/v1/${path}`);
  Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error?.message || msg; } catch { /* ignore */ }
    throw new ApiError(res.status, msg);
  }
  return res.json();
}

async function apiAll(path, token, key, params = {}, maxPages = 5) {
  const out = [];
  let pageToken;
  for (let i = 0; i < maxPages; i++) {
    const r = await api(path, token, { ...params, pageSize: 100, pageToken });
    out.push(...(r[key] || []));
    pageToken = r.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

const EXAM_RE = /מבחן|בוחן|בחינה|מתכונת|בגרות|quiz|test|exam/i;

/** Classroom stores due dates in UTC; convert to a local YYYY-MM-DD (+HH:MM). */
function dueToLocal(dueDate, dueTime) {
  if (!dueDate?.year) return { date: '', time: '' };
  if (!dueTime || dueTime.hours == null) {
    return { date: `${dueDate.year}-${pad(dueDate.month)}-${pad(dueDate.day)}`, time: '' };
  }
  const d = new Date(Date.UTC(dueDate.year, dueDate.month - 1, dueDate.day, dueTime.hours || 0, dueTime.minutes || 0));
  return { date: isoDate(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

function materialLink(m) {
  if (m.driveFile?.driveFile) return { url: m.driveFile.driveFile.alternateLink, title: m.driveFile.driveFile.title };
  if (m.link) return { url: m.link.url, title: m.link.title || m.link.url };
  if (m.youtubeVideo) return { url: m.youtubeVideo.alternateLink, title: m.youtubeVideo.title };
  if (m.form) return { url: m.form.formUrl, title: m.form.title };
  return null;
}

function matchSubjectForCourse(course) {
  const byId = S.data.subjects.find((s) => s.classroomId === course.id);
  if (byId) return byId;
  const cn = norm(course.name);
  const byName = S.data.subjects
    .filter((s) => !s.classroomId && norm(s.name) && cn.includes(norm(s.name)))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (byName) {
    byName.classroomId = course.id;
    return byName;
  }
  const s = { id: uid(), name: course.name, color: nextColor(), classroomId: course.id };
  S.data.subjects.push(s);
  return s;
}

/** Pull courses, assignments, exams and materials. Returns counters. */
export async function syncClassroom(token, onProgress = () => {}) {
  const counts = { courses: 0, tasks: 0, exams: 0, items: 0 };
  onProgress('מתחבר…');
  try {
    const me = await api('userProfiles/me', token);
    lsSet(EMAIL_KEY, me.emailAddress || me.name?.fullName || '');
  } catch (e) {
    if (e.status === 401) throw e;
  }
  onProgress('טוען כיתות…');
  const courses = await apiAll('courses', token, 'courses', { studentId: 'me', courseStates: 'ACTIVE' });
  counts.courses = courses.length;
  const cutoff = isoDate(addDays(new Date(), -45));

  for (const [i, course] of courses.entries()) {
    onProgress(`מסנכרן ${i + 1}/${courses.length}: ${course.name}`);
    const subj = matchSubjectForCourse(course);

    let work = [];
    let subs = [];
    try {
      work = await apiAll(`courses/${course.id}/courseWork`, token, 'courseWork');
      subs = await apiAll(`courses/${course.id}/courseWork/-/studentSubmissions`, token, 'studentSubmissions', { userId: 'me' });
    } catch (e) {
      if (e.status === 401) throw e;
    }
    const submitted = new Set(
      subs.filter((s) => s.state === 'TURNED_IN' || s.state === 'RETURNED').map((s) => s.courseWorkId)
    );

    for (const cw of work) {
      const { date, time } = dueToLocal(cw.dueDate, cw.dueTime);
      const isDone = submitted.has(cw.id);
      if (date && date < cutoff && isDone) continue;
      const extId = `gc-${cw.id}`;

      if (date && EXAM_RE.test(cw.title || '')) {
        const ex = S.data.exams.find((e) => e.extId === extId);
        if (ex) {
          Object.assign(ex, { title: cw.title, date, time: time || ex.time, link: cw.alternateLink });
        } else {
          S.data.exams.push({
            id: uid(), extId, source: 'classroom', subjectId: subj.id, title: cw.title,
            type: /בוחן|quiz/i.test(cw.title) ? 'בוחן' : /בגרות/.test(cw.title) ? 'בגרות' : 'מבחן',
            date, time, topics: [], notes: cw.description || '', grade: '', link: cw.alternateLink,
            createdAt: Date.now(),
          });
          counts.exams++;
        }
        continue;
      }

      const t = S.data.tasks.find((x) => x.extId === extId);
      if (t) {
        Object.assign(t, { title: cw.title, due: date, dueTime: time, link: cw.alternateLink });
        if (isDone && !t.done) { t.done = true; t.doneAt = Date.now(); }
      } else {
        S.data.tasks.push({
          id: uid(), extId, source: 'classroom', subjectId: subj.id, title: cw.title || 'מטלה',
          due: date, dueTime: time, notes: cw.description || '', link: cw.alternateLink,
          done: isDone, doneAt: isDone ? Date.now() : null, createdAt: Date.now(),
        });
        counts.tasks++;
      }
    }

    let mats = [];
    try {
      mats = await apiAll(`courses/${course.id}/courseWorkMaterials`, token, 'courseWorkMaterial');
    } catch (e) {
      if (e.status === 401) throw e;
    }
    for (const m of mats) {
      const extId = `gcm-${m.id}`;
      const link = (m.materials || []).map(materialLink).find(Boolean);
      const url = link?.url || m.alternateLink;
      const existing = S.data.items.find((x) => x.extId === extId);
      if (existing) {
        Object.assign(existing, { title: m.title || existing.title, url });
        continue;
      }
      S.data.items.push({
        id: uid(), extId, source: 'classroom', subjectId: subj.id, title: m.title || link?.title || 'חומר',
        body: '', url, files: [], pinned: false,
        createdAt: Date.parse(m.creationTime) || Date.now(), updatedAt: Date.now(),
        extraLinks: (m.materials || []).map(materialLink).filter(Boolean),
      });
      counts.items++;
    }
  }

  S.data.settings.lastSync = Date.now();
  save();
  return counts;
}

export function explainClassroomError(e) {
  if (e?.status === 401) return 'ההתחברות פגה. צריך להתחבר מחדש.';
  if (e?.status === 403) {
    return `גוגל חסם את הגישה (${e.message}). בדקו ש-Google Classroom API מופעל בפרויקט. בחשבון של בית הספר ייתכן שמנהל המערכת חוסם אפליקציות חיצוניות.`;
  }
  if (e instanceof TypeError) return 'אין חיבור לאינטרנט או שהבקשה נחסמה.';
  return `שגיאה: ${e?.message || e}`;
}

// =====================================================================
// Webtop — no public API, so we parse text copied from the exam board
// (לוח מבחנים / שיעורי בית). Works with tab-separated table rows or
// one cell per line.
// =====================================================================

const DATE_RE = /(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})[./\-](\d{1,2})(?:[./\-](\d{2,4}))?/;
const DAY_WORDS = new Set([
  'יום', 'ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת',
  'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש', 'תאריך', 'שעה', 'מקצוע', 'נושא', 'מורה', 'שיעור',
]);

function resolveDate(m) {
  let y, mo, d;
  if (m[1]) {
    [y, mo, d] = [+m[1], +m[2], +m[3]];
  } else {
    d = +m[4];
    mo = +m[5];
    y = m[6] ? +m[6] : null;
    if (y && y < 100) y += 2000;
  }
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
  if (!y) {
    const now = new Date();
    y = now.getFullYear();
    const candidate = new Date(y, mo - 1, d);
    if (candidate < addDays(now, -60)) y += 1;
  }
  return `${y}-${pad(mo)}-${pad(d)}`;
}

function cleanText(s) {
  return s
    .split(/[\t|]+|\s{2,}/)
    .map((cell) =>
      cell
        .split(/\s+/)
        .filter((w) => {
          const bare = w.replace(/["'׳״.,:;()\-–]/g, '');
          if (!bare) return false;
          if (/^\d{1,2}:\d{2}$/.test(w)) return false;
          if (DATE_RE.test(w) && bare.replace(/\d/g, '') === '') return false;
          return !DAY_WORDS.has(bare);
        })
        .join(' ')
        .trim()
    )
    .filter(Boolean)
    .join(' · ');
}

function guessSubject(text) {
  const t = norm(text);
  return S.data.subjects
    .filter((s) => norm(s.name) && t.includes(norm(s.name)))
    .sort((a, b) => b.name.length - a.name.length)[0];
}

function guessType(text) {
  if (/בוחן/.test(text)) return 'בוחן';
  if (/מתכונת/.test(text)) return 'מתכונת';
  if (/בגרות/.test(text)) return 'בגרות';
  if (/עבודה|הגשה|פרויקט/.test(text)) return 'עבודה';
  return 'מבחן';
}

/** Returns [{date, time, title, subjectId, type}] */
export function parseScheduleText(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim());
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m = null;
    let date = null;
    for (const cand of line.matchAll(new RegExp(DATE_RE.source, 'g'))) {
      date = resolveDate(cand);
      if (date) { m = cand; break; }
    }
    if (!date) continue;
    const time = (line.match(/\b(\d{1,2}:\d{2})\b/) || [])[1] || '';
    let rest = cleanText(line.replace(m[0], ' '));
    // Table copied cell-per-line: borrow following lines until the next date.
    if (rest.replace(/[^\p{L}]/gu, '').length < 2) {
      const extra = [];
      for (let j = i + 1; j < lines.length && extra.length < 3; j++) {
        if (DATE_RE.test(lines[j])) break;
        const c = cleanText(lines[j]);
        if (c) extra.push(c);
      }
      rest = extra.join(' · ');
    }
    if (!rest) continue;
    const subj = guessSubject(rest);
    let title = rest;
    if (subj) {
      const stripped = rest.replace(new RegExp(subj.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '').replace(/^[\s·\-–]+|[\s·\-–]+$/g, '');
      title = stripped || subj.name;
    }
    rows.push({ date, time, title, subjectId: subj?.id || '', type: guessType(rest) });
  }
  return rows;
}

// =====================================================================
// Calendar export (.ics for the iPhone Calendar app, or Google Calendar).
// =====================================================================

const icsEsc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

function fold(line) {
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = new TextEncoder().encode(ch).length;
    if (bytes + b > 73) {
      out.push(cur);
      cur = ' ';
      bytes = 1;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n');
}

const compact = (iso) => iso.replace(/-/g, '');

export function examTitle(e) {
  const sn = e.subjectId ? subjectName(e.subjectId) : '';
  const base = e.title || e.type || 'מבחן';
  return sn && !base.includes(sn) ? `${e.type || 'מבחן'} ב${sn}: ${base}` : base;
}

function examDescription(e) {
  const topics = (e.topics || []).map((t) => `• ${t.text}`).join('\n');
  return [topics && `חומר למבחן:\n${topics}`, e.notes].filter(Boolean).join('\n\n');
}

export function examICS(e) {
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}00Z`;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//school-app//HE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:${e.id}@school-app`, `DTSTAMP:${stamp}`];
  if (e.time) {
    const [h, m] = e.time.split(':').map(Number);
    const end = new Date(parseISO(e.date));
    end.setHours(h + 1, m);
    lines.push(`DTSTART:${compact(e.date)}T${pad(h)}${pad(m)}00`);
    lines.push(`DTEND:${isoDate(end).replace(/-/g, '')}T${pad(end.getHours())}${pad(end.getMinutes())}00`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${compact(e.date)}`);
    lines.push(`DTEND;VALUE=DATE:${compact(isoDate(addDays(parseISO(e.date), 1)))}`);
  }
  lines.push(`SUMMARY:${icsEsc(examTitle(e))}`);
  const desc = examDescription(e);
  if (desc) lines.push(`DESCRIPTION:${icsEsc(desc)}`);
  // Reminders: 3 days before and the evening before (at 18:00 / 6h before a timed exam).
  const alarms = e.time ? ['-P3D', '-PT14H'] : ['-P2DT6H', '-PT6H'];
  for (const trig of alarms) {
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `TRIGGER:${trig}`, `DESCRIPTION:${icsEsc(`תזכורת: ${examTitle(e)}`)}`, 'END:VALARM');
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function googleCalendarURL(e) {
  let dates;
  if (e.time) {
    const [h, m] = e.time.split(':').map(Number);
    const s = `${compact(e.date)}T${pad(h)}${pad(m)}00`;
    const end = new Date(parseISO(e.date));
    end.setHours(h + 1, m);
    dates = `${s}/${isoDate(end).replace(/-/g, '')}T${pad(end.getHours())}${pad(end.getMinutes())}00`;
  } else {
    dates = `${compact(e.date)}/${compact(isoDate(addDays(parseISO(e.date), 1)))}`;
  }
  const p = new URLSearchParams({ action: 'TEMPLATE', text: examTitle(e), dates, details: examDescription(e) });
  return `https://calendar.google.com/calendar/render?${p}`;
}

/** base64url of UTF-8 text (used to hand the .ics to the service worker). */
export function b64url(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
