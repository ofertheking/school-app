// "Through the browser": a Safari bookmark (bookmarklet) that the student taps on
// a Webtop / Classroom page they are already logged into. It reads the tables on
// that page — exactly what's on the screen — and copies them; the app's paste
// import then recognises what it is (grades, exams, homework, timetable).
// Nothing logs in, nothing is sent anywhere, nothing is bypassed: it's the
// student's own browser and account.
import { ICON } from './icons.js';
import { openSheet, toast } from './ui.js';
import { parseTimetableTable } from './pdfTimetable.js';

/**
 * Runs ON the Webtop/Classroom page (serialised into the bookmark), so it must
 * be self-contained, ES5-ish, use semicolons, and have no line comments.
 */
function bridgeMain() {
  var clean = function (s) { return String(s || '').replace(/[ \t ]+/g, ' ').trim(); };
  var cellText = function (c) { return String(c.innerText || c.textContent || '').split('\n').map(clean).filter(Boolean).join(' | '); };
  var shown = function (el) { return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); };
  var out = [];
  var docs = [document];
  Array.prototype.forEach.call(document.querySelectorAll('iframe'), function (f) { try { if (f.contentDocument) docs.push(f.contentDocument); } catch (e) {} });
  docs.forEach(function (d) {
    Array.prototype.forEach.call(d.querySelectorAll('table'), function (t) {
      if (!shown(t) || t.querySelector('table')) return;
      Array.prototype.forEach.call(t.rows, function (tr) {
        var cells = Array.prototype.map.call(tr.cells, cellText);
        if (cells.join('').trim()) out.push(cells.join('\t'));
      });
      out.push('');
    });
    Array.prototype.forEach.call(d.querySelectorAll('[role=row]'), function (r) {
      if (r.closest('table') || !shown(r)) return;
      var cells = Array.prototype.map.call(r.querySelectorAll('[role=cell],[role=gridcell],[role=columnheader],[role=rowheader]'), cellText);
      if (cells.join('').trim()) out.push(cells.join('\t'));
    });
  });
  var text = out.join('\n').trim();
  if (text.replace(/\s/g, '').length < 30) text = String(document.body.innerText || '');
  var data = '##BRIDGE## ' + clean(document.title) + ' ¦ ' + location.host + location.pathname + location.hash + '\n' + text;
  var rows = text.split('\n').filter(function (l) { return l.trim(); }).length;

  var old = document.getElementById('sa-bridge');
  if (old) old.remove();
  var mk = function (tag, css, txt) { var e = document.createElement(tag); e.style.cssText = css; if (txt) e.textContent = txt; return e; };
  var wrap = mk('div', 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center;font:16px -apple-system,system-ui,sans-serif;direction:rtl;text-align:right');
  wrap.id = 'sa-bridge';
  var card = mk('div', 'background:#fff;color:#000;width:100%;max-width:520px;box-sizing:border-box;border-radius:22px 22px 0 0;padding:22px 18px 28px;box-shadow:0 -6px 30px rgba(0,0,0,.25)');
  var btn = 'display:block;width:100%;box-sizing:border-box;border:0;border-radius:14px;padding:15px;margin-top:10px;font:600 17px -apple-system,system-ui,sans-serif;cursor:pointer';
  card.appendChild(mk('b', 'display:block;font-size:20px', 'ייבוא לאפליקציה'));
  var msg = mk('p', 'margin:6px 0 4px;color:#555;font-size:15px', rows ? 'נאספו ' + rows + ' שורות מהדף הזה' : 'לא מצאתי טבלה בדף הזה. פותחים את הציונים, לוח המבחנים, שיעורי הבית או המערכת, ומנסים שוב.');
  card.appendChild(msg);
  var copyBtn = mk('button', btn + ';background:#007aff;color:#fff', 'העתקה');
  var closeBtn = mk('button', btn + ';background:#eee;color:#007aff', 'סגירה');
  card.appendChild(copyBtn);
  card.appendChild(closeBtn);
  wrap.appendChild(card);
  document.body.appendChild(wrap);
  closeBtn.onclick = function () { wrap.remove(); };
  copyBtn.onclick = function () {
    var done = function (ok) {
      if (ok) {
        msg.textContent = 'הועתק ✔︎ עכשיו עוברים לאפליקציה ← "ייבוא מוובטופ" ← "הדבקה"';
        copyBtn.style.background = '#34c759';
        copyBtn.textContent = 'הועתק ✔︎';
        return;
      }
      msg.textContent = 'לא הצלחתי להעתיק לבד: לוחצים לחיצה ארוכה בתיבה ← "בחר הכל" ← "העתק"';
      var ta = mk('textarea', 'width:100%;height:120px;margin-top:10px;box-sizing:border-box;font-size:13px;direction:rtl');
      ta.value = data;
      card.insertBefore(ta, closeBtn);
    };
    var fallback = function () {
      var ta = mk('textarea', 'position:fixed;top:0;left:0;opacity:0');
      ta.value = data;
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, data.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      ta.remove();
      done(ok);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(data).then(function () { done(true); }, fallback);
    else fallback();
  };
}

/** The bookmark's address: javascript:(…)() on one line. */
export function bookmarkletURL() {
  const code = `(${bridgeMain.toString()})();`.replace(/\n\s*/g, ' ');
  return `javascript:${encodeURIComponent(code)}`;
}

/**
 * Pasted text that came from the bookmark → { title, where, body, kind, timetable }.
 * kind: 'timetable' | 'grade' | 'exam' | 'task' | '' (unknown: let the sheet decide).
 */
export function parseBridge(text) {
  const m = String(text || '').match(/^\s*##BRIDGE## (.*?) ¦ (.*)\r?\n/);
  if (!m) return null;
  const body = String(text).slice(m[0].length).replace(/ \| /g, ' · ');
  const title = m[1];
  const where = m[2];
  const hint = `${title} ${where}`;
  // A table with the days of the week as columns is a timetable.
  const timetable = parseTimetableTable(String(text).slice(m[0].length));
  let kind = '';
  if (timetable.lessons.length >= 4) kind = 'timetable';
  else if (/ציונ|grade|mark|תעודה/i.test(hint) || (/ציון/.test(body) && !/מבחנים|לוח/.test(hint))) kind = 'grade';
  else if (/מבחנ|exam|test|בחינ/i.test(hint)) kind = 'exam';
  else if (/שיעורי.?בית|homework|משימ|classroom|assignment|todo|to-do/i.test(hint)) kind = 'task';
  return { title, where, body, kind, timetable, source: /classroom\.google/i.test(where) ? 'classroom' : /smartschool|webtop/i.test(where) ? 'webtop' : 'other' };
}

export function bridgeSheetHTML() {
  return `<div class="sheet-head"><button type="button" class="link-btn" data-close>סגירה</button><h3>חיבור דרך הדפדפן</h3><span></span></div>
    <div class="bridge">
      <p>נכנסים לוובטופ (או ל-Classroom) רגיל בספארי, עם השם והסיסמה שלך. <b>סימנייה אחת בספארי</b> מעתיקה את מה שמופיע על המסך — והאפליקציה מכניסה הכל לבד.</p>
      <p class="muted small">לא עוקפים שום דבר: זה הדפדפן שלך והחשבון שלך. הסימנייה רק קוראת את הדף שפתוח אצלך, ולא שולחת כלום לשום מקום.</p>

      <h4 class="bridge-h">התקנה (פעם אחת, דקה)</h4>
      <ol class="bridge-steps">
        <li><button class="btn primary block" data-act="bridge-copy">${ICON.clip} העתקת קוד הסימנייה</button></li>
        <li>בספארי, בכל דף: כפתור השיתוף ${ICON.share} ← <b>"הוספת סימנייה"</b> ← קוראים לה <b>ייבוא</b> ← שמירה</li>
        <li>פותחים את הסימניות ← <b>"עריכה"</b> ← לוחצים על <b>ייבוא</b> ← מוחקים את הכתובת ו<b>מדביקים</b> את הקוד ← <b>"סיום"</b></li>
      </ol>

      <h4 class="bridge-h">שימוש</h4>
      <ol class="bridge-steps">
        <li>בוובטופ פותחים את מה שרוצים: <b>ציונים</b>, <b>לוח מבחנים</b>, <b>שיעורי בית</b> או <b>מערכת שעות</b>. ב-Classroom: <b>"לביצוע"</b></li>
        <li>לוחצים על שורת הכתובת, כותבים <b>ייבוא</b> ובוחרים את הסימנייה (⭐)</li>
        <li><b>"העתקה"</b> ← חוזרים לאפליקציה ← <b>"הדבקה"</b> — המערכת, הציונים והמבחנים מזוהים לבד</li>
      </ol>
      <div class="row gap">
        <button class="btn tinted grow" data-act="webtop-paste">${ICON.clip} כבר העתקתי — הדבקה</button>
        <a class="btn ghost grow" href="https://webtop.smartschool.co.il/" target="_blank" rel="noopener">${ICON.ext} פתיחת וובטופ</a>
      </div>
      <p class="muted small">במחשב: גוררים את הכפתור הזה לסרגל הסימניות — <a class="bridge-drag" href="${bookmarkletURL()}" data-act="bridge-drag">ייבוא</a></p>
    </div>`;
}

export const actions = {
  'bridge-open': () => openSheet(bridgeSheetHTML(), { tall: true }),
  async 'bridge-copy'() {
    const url = bookmarkletURL();
    try {
      await navigator.clipboard.writeText(url);
      toast('הקוד הועתק ✔︎ עכשיו מוסיפים סימנייה בספארי ומדביקים אותו בכתובת', 5000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand?.('copy');
      ta.remove();
      toast(ok ? 'הקוד הועתק ✔︎' : 'לא הצלחתי להעתיק — נסו שוב', 4000);
    }
  },
  'bridge-drag': () => toast('במחשב גוררים את הכפתור לסרגל הסימניות. בטלפון משתמשים ב"העתקת קוד הסימנייה".', 4500),
};
