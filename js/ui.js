// Generic UI pieces: bottom sheets, forms, confirm dialogs, toasts, file URLs.
import { S, save, nextColor } from './core.js';
import { esc, uid, isoDate, addDays, startOfDay, daysUntil, relDay, fmtDate } from './util.js';
import { L } from './i18n.js';
import { ICON } from './icons.js';
import { getFile } from './store.js';

const sheetRoot = () => document.getElementById('sheet-root');
const openClosers = new Set();

export function openSheet(html, { onMount, onClose, tall = false } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
    <div class="sheet-backdrop" data-close></div>
    <div class="sheet${tall ? ' tall' : ''}" role="dialog" aria-modal="true">
      <div class="sheet-grabber" aria-hidden="true"></div>
      ${html}
    </div>`;
  sheetRoot().appendChild(wrap);
  document.body.classList.add('has-sheet');
  requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('open')));
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    openClosers.delete(close);
    wrap.classList.remove('open');
    setTimeout(() => {
      wrap.remove();
      if (!sheetRoot().children.length) document.body.classList.remove('has-sheet');
    }, 260);
    onClose?.();
  };
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) {
      e.preventDefault();
      close();
    }
  });
  openClosers.add(close);
  onMount?.(wrap.querySelector('.sheet'), close);
  return close;
}

export function closeAllSheets() {
  [...openClosers].forEach((close) => close());
}

/** action: { label, go } adds a tappable button to the toast. */
export function toast(msg, ms = 2600, action = null) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.toggle('has-act', !!action);
  if (action) {
    const b = document.createElement('button');
    b.className = 'toast-act';
    b.textContent = action.label;
    b.dataset.go = action.go;
    el.append(' ', b);
  }
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), ms);
}

export function askConfirm(text, { ok = 'מחיקה', danger = true, detail = '' } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    openSheet(
      `<div class="confirm">
        <span class="confirm-ico${danger ? ' danger' : ''}" aria-hidden="true">${danger ? ICON.trash : ICON.check}</span>
        <p class="confirm-text">${esc(text)}</p>
        ${detail ? `<p class="muted small">${esc(detail)}</p>` : ''}
        <button class="btn ${danger ? 'danger' : 'primary'} block" data-yes>${esc(ok)}</button>
        <button class="btn ghost block" data-close>ביטול</button>
      </div>`,
      {
        onMount(sheet, close) {
          sheet.querySelector('[data-yes]').addEventListener('click', () => {
            answered = true;
            resolve(true);
            close();
          });
        },
        onClose: () => !answered && resolve(false),
      }
    );
  });
}

/** options: [{value, label, icon, desc}] -> resolves to chosen value or null */
export function choiceSheet(title, options) {
  return new Promise((resolve) => {
    let answered = false;
    openSheet(
      `<h3 class="sheet-title">${esc(title)}</h3>
       <div class="choice-list">
        ${options
          .map(
            (o, i) => `<button class="choice" data-i="${i}">
              <span class="choice-icon" aria-hidden="true">${o.icon || ''}</span>
              <span class="choice-body"><b>${esc(o.label)}</b>${o.desc ? `<small>${esc(o.desc)}</small>` : ''}</span>
            </button>`
          )
          .join('')}
       </div>
       <button class="btn ghost block" data-close>ביטול</button>`,
      {
        onMount(sheet, close) {
          sheet.querySelectorAll('[data-i]').forEach((b) =>
            b.addEventListener('click', () => {
              answered = true;
              resolve(options[+b.dataset.i].value);
              close();
            })
          );
        },
        onClose: () => !answered && resolve(null),
      }
    );
  });
}

export function subjectOptions(selected, { allowNone = true, allowNew = true } = {}) {
  const opts = [];
  if (allowNone) opts.push(`<option value="">כללי / בלי מקצוע</option>`);
  for (const s of S.data.subjects) {
    opts.push(`<option value="${s.id}"${s.id === selected ? ' selected' : ''}>${esc(s.name)}</option>`);
  }
  if (allowNew) opts.push(`<option value="__new">＋ מקצוע חדש…</option>`);
  return opts.join('');
}

// ---------- rich form controls ----------
// The real <select>/<input> stays in the form (so values, listeners and
// validation work as before); chips and pretty buttons just drive it.

const QUICK_DATES = {
  task: [[0, 'היום'], [1, 'מחר'], [7, 'בעוד שבוע']],
  exam: [[1, 'מחר'], [7, 'בעוד שבוע'], [14, 'בעוד שבועיים']],
  past: [[0, 'היום'], [-1, 'אתמול'], [-7, 'לפני שבוע']],
};

function dateLabel(v) {
  if (!v) return { main: L('בחירת תאריך', 'Pick a date'), sub: '' };
  const n = daysUntil(v);
  return { main: fmtDate(v), sub: Math.abs(n) <= 60 ? relDay(v) : '' };
}

function subjectPicker(f, v, id) {
  const chip = (val, label, color, extra = '') =>
    `<button type="button" class="pick${extra}" data-pick="${esc(val)}"${color ? ` style="--pc:${color}"` : ''} aria-pressed="false">
      ${color ? '<span class="pick-dot" aria-hidden="true"></span>' : ''}<span>${label}</span></button>`;
  return `<select id="${id}" name="${f.name}" data-subject-select class="driven" tabindex="-1" aria-hidden="true">${subjectOptions(v)}</select>
    <div class="picks" role="group">
      ${chip('', esc(L('כללי', 'General')), '')}
      ${S.data.subjects.map((s) => chip(s.id, esc(s.name), `var(--c${s.color % 8})`)).join('')}
      ${chip('__new', `＋ ${esc(L('חדש', 'New'))}`, '', ' pick-new')}
    </div>
    <input class="new-subject" name="${f.name}__new" placeholder="שם המקצוע החדש" hidden>`;
}

function selectPicker(f, v, id) {
  return `<select id="${id}" name="${f.name}" class="driven" tabindex="-1" aria-hidden="true">${f.options
    .map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(v) ? ' selected' : ''}>${esc(o.label)}</option>`)
    .join('')}</select>
    <div class="picks seg-picks" role="group">${f.options
      .map((o) => `<button type="button" class="pick" data-pick="${esc(o.value)}" aria-pressed="false"><span>${esc(o.label)}</span></button>`)
      .join('')}</div>`;
}

function dateButton(f, v, id) {
  const { main, sub } = dateLabel(v);
  const time = f.type === 'time';
  return `<span class="date-btn${v ? ' has' : ''}">
      <span class="db-ico" aria-hidden="true">${time ? ICON.timer : ICON.calendar}</span>
      <span class="db-text"><b class="db-main">${esc(time ? v || L('בחירת שעה', 'Pick a time') : main)}</b>${!time && sub ? `<small class="db-sub">${esc(sub)}</small>` : ''}</span>
      <input id="${id}" name="${f.name}" type="${f.type}" value="${esc(v ?? '')}" class="db-input"${f.required ? ' required' : ''}>
      ${time ? `<button type="button" class="db-clear" data-clear aria-label="ניקוי"${v ? '' : ' hidden'}>${ICON.x}</button>` : ''}
    </span>`;
}

function quickRow(f) {
  const set = QUICK_DATES[f.quick] || [];
  if (!set.length) return '';
  return `<div class="quick-dates" data-for="f-${f.name}">${set
    .map(([n, label]) => `<button type="button" class="qd" data-days="${n}">${esc(label)}</button>`)
    .join('')}</div>`;
}

function filesDrop(f, id) {
  return `<span class="drop">
      <span class="drop-ico" aria-hidden="true">${ICON.clip}</span>
      <span class="drop-text"><b>${esc(f.dropLabel || L('הוספת קבצים', 'Add files'))}</b><small>${esc(f.dropHint || L('תמונות, PDF, סרטונים ועוד', 'Photos, PDFs, videos and more'))}</small></span>
      <span class="drop-plus" aria-hidden="true">${ICON.plus}</span>
      <input id="${id}" name="${f.name}" type="file" multiple accept="${esc(f.accept || '*/*')}" class="drop-input">
    </span>
    <div class="drop-list" aria-live="polite"></div>`;
}

function fieldHTML(f, v) {
  const id = `f-${f.name}`;
  const req = f.required ? ' required' : '';
  const ph = f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : '';
  const val = v ?? '';
  let input;
  let tag = 'label';
  let cls = '';
  switch (f.type) {
    case 'textarea':
      input = `<textarea id="${id}" name="${f.name}" rows="${f.rows || 4}"${ph}${req}>${esc(val)}</textarea>`;
      break;
    case 'select':
      if (f.options.length <= 8 && !f.plain) {
        input = selectPicker(f, val, id);
        tag = 'div';
        cls = ' wide';
      } else {
        input = `<select id="${id}" name="${f.name}"${req}>${f.options
          .map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(val) ? ' selected' : ''}>${esc(o.label)}</option>`)
          .join('')}</select>`;
      }
      break;
    case 'files':
      input = filesDrop(f, id);
      tag = 'div';
      break;
    case 'subject':
      input = subjectPicker(f, val, id);
      tag = 'div';
      cls = ' wide';
      break;
    case 'date':
    case 'time':
      input = dateButton(f, val, id);
      break;
    default:
      input = `<input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${esc(val)}"${ph}${req}
        ${f.min != null ? ` min="${f.min}"` : ''}${f.max != null ? ` max="${f.max}"` : ''}${f.step != null ? ` step="${f.step}"` : ''}
        ${f.inputmode ? ` inputmode="${f.inputmode}"` : ''}${f.autocomplete ? ` autocomplete="${f.autocomplete}"` : ' autocomplete="off"'}>`;
  }
  const half = f.half && !cls ? ' half' : '';
  const labelAttr = tag === 'label' ? ` for="${id}"` : ` role="group" aria-labelledby="${id}-l"`;
  return `<${tag} class="field${half}${cls} ft-${f.type || 'text'}"${labelAttr}>
    <span class="field-label" id="${id}-l">${esc(f.label)}</span>${input}
    ${f.hint ? `<span class="field-hint">${esc(f.hint)}</span>` : ''}
  </${tag}>${f.quick ? quickRow(f) : ''}`;
}

const fmtSize = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Wire the chips / date buttons / file drops inside a form. */
export function enhanceFields(form) {
  // chip pickers drive their hidden <select>
  form.querySelectorAll('.picks').forEach((row) => {
    const sel = row.previousElementSibling;
    if (!sel || sel.tagName !== 'SELECT') return;
    const sync = () =>
      row.querySelectorAll('.pick').forEach((b) => {
        const on = b.dataset.pick === sel.value;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    row.addEventListener('click', (e) => {
      const b = e.target.closest('.pick');
      if (!b) return;
      sel.value = b.dataset.pick;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
        b.classList.remove('pop');
        void b.offsetWidth;
        b.classList.add('pop');
      }
    });
    sel.addEventListener('change', sync);
    sync();
  });
  // date / time buttons show a friendly label
  form.querySelectorAll('.db-input').forEach((inp) => {
    const btn = inp.closest('.date-btn');
    const time = inp.type === 'time';
    const show = () => {
      const v = inp.value;
      btn.classList.toggle('has', !!v);
      if (time) {
        btn.querySelector('.db-main').textContent = v || L('בחירת שעה', 'Pick a time');
        const c = btn.querySelector('.db-clear');
        if (c) c.hidden = !v;
      } else {
        const { main, sub } = dateLabel(v);
        btn.querySelector('.db-main').textContent = main;
        let s = btn.querySelector('.db-sub');
        if (sub && !s) {
          s = document.createElement('small');
          s.className = 'db-sub';
          btn.querySelector('.db-text').appendChild(s);
        }
        if (s) s.textContent = sub;
      }
      const q = form.querySelector(`.quick-dates[data-for="${inp.id}"]`);
      q?.querySelectorAll('.qd').forEach((b) => b.classList.toggle('on', v === isoDate(addDays(startOfDay(), +b.dataset.days))));
    };
    inp.addEventListener('input', show);
    inp.addEventListener('change', show);
    btn.querySelector('[data-clear]')?.addEventListener('click', (e) => {
      e.preventDefault();
      inp.value = '';
      show();
    });
    // Desktop browsers: open the picker on a tap anywhere on the button.
    btn.addEventListener('click', (e) => {
      if (e.target.closest('[data-clear]') || !matchMedia('(pointer: fine)').matches) return;
      try {
        inp.showPicker?.();
      } catch { /* not allowed here — the input itself still gets the tap */ }
    });
    show();
  });
  form.querySelectorAll('.quick-dates').forEach((row) => {
    const inp = form.querySelector(`#${row.dataset.for}`);
    row.addEventListener('click', (e) => {
      const b = e.target.closest('.qd');
      if (!b || !inp) return;
      inp.value = isoDate(addDays(startOfDay(), +b.dataset.days));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
  // file drops: keep adding, show what was picked, remove with ×
  form.querySelectorAll('.drop-input').forEach((inp) => {
    const list = inp.closest('.field').querySelector('.drop-list');
    let kept = [];
    const urls = [];
    const draw = () => {
      urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
      inp.closest('.drop').classList.toggle('has', kept.length > 0);
      list.innerHTML = kept
        .map((f, i) => {
          let thumb = ICON.doc;
          if (/^image\//.test(f.type)) {
            const u = URL.createObjectURL(f);
            urls.push(u);
            thumb = `<img src="${u}" alt="">`;
          } else if (/^video\//.test(f.type)) thumb = ICON.video;
          else if (/^audio\//.test(f.type)) thumb = ICON.music;
          return `<span class="drop-file"><span class="df-thumb">${thumb}</span>
            <span class="df-name" data-raw><b>${esc(f.name)}</b><small>${fmtSize(f.size)}</small></span>
            <button type="button" class="df-x" data-i="${i}" aria-label="להסיר">${ICON.x}</button></span>`;
        })
        .join('');
    };
    const apply = () => {
      try {
        const dt = new DataTransfer();
        kept.forEach((f) => dt.items.add(f));
        inp.files = dt.files;
      } catch {
        /* old browser: the input keeps only its latest pick */
      }
    };
    inp.addEventListener('change', () => {
      const add = [...inp.files].filter((f) => !kept.some((k) => k.name === f.name && k.size === f.size));
      kept = canMerge() ? [...kept, ...add] : [...inp.files];
      apply();
      draw();
    });
    list.addEventListener('click', (e) => {
      const x = e.target.closest('.df-x');
      if (!x) return;
      kept.splice(+x.dataset.i, 1);
      apply();
      if (!canMerge() && kept.length === 0) inp.value = '';
      draw();
    });
  });
}

const canMerge = () => typeof DataTransfer === 'function' && (() => {
  try {
    return !!new DataTransfer().items;
  } catch {
    return false;
  }
})();

/**
 * Opens a sheet with a form. onSubmit(values) may return false to keep it open.
 * Subject fields that chose "new subject" are resolved to a freshly created subject id.
 */
export function formSheet({ title, fields, values = {}, submitLabel = 'שמירה', onSubmit, footer = '', onMount }) {
  return openSheet(
    `<form class="sheet-form" novalidate>
      <div class="sheet-head">
        <button type="button" class="link-btn sh-cancel" data-close aria-label="ביטול">${ICON.x}</button>
        <h3>${esc(title)}</h3>
        <button type="submit" class="link-btn strong sh-save">${ICON.check}<span>${esc(submitLabel)}</span></button>
      </div>
      <div class="fields">${fields.map((f) => fieldHTML(f, values[f.name])).join('')}</div>
      ${footer}
    </form>`,
    {
      tall: fields.length > 4,
      onMount(sheet, close) {
        const form = sheet.querySelector('form');
        form.querySelectorAll('[data-subject-select]').forEach((sel) => {
          const extra = sel.parentElement.querySelector('.new-subject');
          sel.addEventListener('change', () => {
            extra.hidden = sel.value !== '__new';
            if (!extra.hidden) extra.focus();
          });
        });
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const vals = {};
          for (const f of fields) {
            const el = form.elements[f.name];
            if (!el) continue;
            let v = el.value;
            if (f.type === 'files') {
              vals[f.name] = [...el.files];
              continue;
            }
            if (f.type === 'subject') v = resolveSubject(v, form.elements[`${f.name}__new`]?.value);
            if (f.type === 'number') v = v === '' ? '' : Number(v);
            if (typeof v === 'string') v = v.trim();
            vals[f.name] = v;
          }
          for (const f of fields) {
            if (f.required && (vals[f.name] === '' || vals[f.name] == null)) {
              toast(`חסר: ${f.label}`);
              form.elements[f.name]?.focus();
              return;
            }
          }
          const r = await onSubmit(vals);
          if (r !== false) close();
        });
        enhanceFields(form);
        onMount?.(sheet, close);
        const first = form.querySelector('input:not([type=date]):not([type=time]):not([type=file]):not([hidden]), textarea');
        if (first && !values[first.name] && !matchMedia('(pointer: coarse)').matches) first.focus();
      },
    }
  );
}

export function resolveSubject(value, newName) {
  if (value !== '__new') return value;
  const name = (newName || '').trim();
  if (!name) return '';
  const existing = S.data.subjects.find((s) => s.name === name);
  if (existing) return existing.id;
  const s = { id: uid(), name, color: nextColor() };
  S.data.subjects.push(s);
  save();
  return s.id;
}

// ---------- files ----------
const urlCache = new Map();

export async function fileURL(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  const blob = await getFile(id);
  if (!blob) return null;
  const u = URL.createObjectURL(blob);
  urlCache.set(id, u);
  return u;
}

export function forgetFileURL(id) {
  const u = urlCache.get(id);
  if (u) URL.revokeObjectURL(u);
  urlCache.delete(id);
}

/** Fill <img data-file-src> / <a data-file-href> with blob URLs from storage. */
export async function hydrateFiles(root) {
  const els = root.querySelectorAll('[data-file-src],[data-file-href]');
  for (const el of els) {
    const id = el.dataset.fileSrc || el.dataset.fileHref;
    const u = await fileURL(id);
    if (!u) continue;
    if (el.dataset.fileSrc) el.src = u;
    else el.href = u;
  }
}

/** Share a file through the iOS share sheet, or fall back to a download link. */
export async function shareOrDownload(file) {
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: file.name });
      return true;
    }
  } catch (e) {
    if (e?.name === 'AbortError') return false;
  }
  try {
    const u = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = u;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 30000);
    return true;
  } catch {
    toast('הדפדפן לא מאפשר הורדה כאן');
    return false;
  }
}
