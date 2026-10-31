// Webtop bridge for "הלימודים שלי" — paste this whole file into a Cloudflare Worker.
//
// Why it exists: browsers aren't allowed to call Webtop's server from another
// website, so this tiny server does it for the app. It does NOT store anything:
// the app sends your Webtop username + password with each sync, this worker logs
// in to Webtop, reads your homework and timetable, and returns them.
//
// Uses Webtop's private (unofficial) API, the same one the pywebtop project uses.
// It may stop working if Webtop changes it.

const WEBTOP = 'https://webtopserver.smartschool.co.il';

// Only the app's own website may use this worker.
const ALLOWED_ORIGINS = ['__APP_ORIGIN__'];

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    const allowed = ALLOWED_ORIGINS.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    const reply = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method === 'GET') return reply({ ok: true, hello: 'webtop bridge is running' });
    if (request.method !== 'POST') return reply({ ok: false, error: 'method' }, 405);
    if (!allowed) return reply({ ok: false, error: 'origin', message: `origin ${origin} not allowed` }, 403);

    let body;
    try {
      body = await request.json();
    } catch {
      return reply({ ok: false, error: 'bad_request' }, 400);
    }
    const { username, password, data = '+Aabe7FAdVluG6Lu+0ibrA==' } = body || {};
    if (!username || !password) return reply({ ok: false, error: 'missing_credentials' }, 400);

    try {
      return reply(await sync(username, password, data));
    } catch (e) {
      return reply({ ok: false, error: 'exception', message: String(e && e.message ? e.message : e) }, 502);
    }
  },
};

async function call(path, payload, token) {
  const res = await fetch(WEBTOP + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Accept: 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
      ...(token ? { Cookie: `webToken=${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { status: false, nonJson: text.slice(0, 300) };
  }
  return { http: res.status, json };
}

/** Depth-first search for the first scalar value whose key matches. */
function findValue(obj, re, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return undefined;
  for (const [k, v] of Object.entries(obj)) {
    if (re.test(k) && v !== null && v !== '' && typeof v !== 'object') return v;
  }
  for (const v of Object.values(obj)) {
    const hit = findValue(v, re, depth + 1);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

async function sync(username, password, data) {
  const login = await call('/server/api/user/LoginByUserNameAndPassword', {
    UserName: username,
    Password: password,
    Data: data,
    RememberMe: false,
    BiometricLogin: '',
  });
  const ld = login.json && login.json.data;
  if (login.http >= 400 || login.json.status !== true || !ld || !ld.token) {
    return {
      ok: false,
      error: 'login',
      http: login.http,
      message: (login.json && (login.json.errorDescription || login.json.nonJson)) || 'login failed',
    };
  }
  const token = ld.token;
  const studentId = ld.id;

  const dashboard = await call('/server/api/dashboard/InitDashboard', {}, token);
  const classCode = findValue(ld, /^classCode$/i) ?? findValue(dashboard.json, /^classCode$/i) ?? findValue(ld, /classcode/i);
  const classNumber = findValue(ld, /^classNumber$/i) ?? findValue(dashboard.json, /^classNumber$/i) ?? findValue(ld, /classnum/i);

  const result = {
    ok: true,
    profile: { firstName: ld.firstName || '', lastName: ld.lastName || '', schoolName: ld.schoolName || '' },
    classCode: classCode ?? null,
    classNumber: classNumber ?? null,
    loginKeys: Object.keys(ld).filter((k) => k !== 'token'),
    dashboard: dashboard.json,
    homework: null,
    schedule: null,
    notes: [],
  };

  if (classCode != null) {
    const hw = await call('/server/api/dashboard/GetHomeWork', { id: studentId, ClassCode: +classCode, ClassNumber: +(classNumber ?? 0) }, token);
    result.homework = hw.json;

    // Israeli school year: Sept–Aug. Try the year it ends in, then the year it started in.
    const now = new Date();
    const endYear = now.getMonth() >= 7 ? now.getFullYear() + 1 : now.getFullYear();
    for (const studyYear of [findValue(ld, /^studyYear$/i), endYear, endYear - 1].filter(Boolean)) {
      for (const weekIndex of [0, 1]) {
        const sch = await call('/server/api/PupilCard/GetPupilScheduale', {
          weekIndex, viewType: 0, studyYear: +studyYear, studentID: studentId, classCode: +classCode, moduleID: 10,
        }, token);
        if (sch.json && sch.json.status !== false && sch.json.data) {
          (result.schedule = result.schedule || []).push({ weekIndex, studyYear: +studyYear, data: sch.json.data });
        }
      }
      if (result.schedule) break;
    }
  } else {
    result.notes.push('classCode not found in login data');
  }
  return result;
}
