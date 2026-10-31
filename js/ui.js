// Generic UI pieces: bottom sheets, forms, confirm dialogs, toasts, file URLs.
import { S, save, nextColor } from './core.js';
import { esc, uid } from './util.js';
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

export function toast(msg, ms = 2600) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), ms);
}

export function askConfirm(text, { ok = 'מחיקה', danger = true, detail = '' } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    openSheet(
      `<div class="confirm">
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

function fieldHTML(f, v) {
  const id = `f-${f.name}`;
  const req = f.required ? ' required' : '';
  const ph = f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : '';
  const val = v ?? '';
  let input;
  switch (f.type) {
    case 'textarea':
      input = `<textarea id="${id}" name="${f.name}" rows="${f.rows || 4}"${ph}${req}>${esc(val)}</textarea>`;
      break;
    case 'select':
      input = `<select id="${id}" name="${f.name}"${req}>${f.options
        .map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(val) ? ' selected' : ''}>${esc(o.label)}</option>`)
        .join('')}</select>`;
      break;
    case 'files':
      input = `<input id="${id}" name="${f.name}" type="file" multiple accept="${esc(f.accept || '*/*')}" class="file-field">`;
      break;
    case 'subject':
      input = `<select id="${id}" name="${f.name}" data-subject-select>${subjectOptions(val)}</select>
        <input class="new-subject" name="${f.name}__new" placeholder="שם המקצוע החדש" hidden>`;
      break;
    default:
      input = `<input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${esc(val)}"${ph}${req}
        ${f.min != null ? ` min="${f.min}"` : ''}${f.max != null ? ` max="${f.max}"` : ''}${f.step != null ? ` step="${f.step}"` : ''}
        ${f.inputmode ? ` inputmode="${f.inputmode}"` : ''}${f.autocomplete ? ` autocomplete="${f.autocomplete}"` : ' autocomplete="off"'}>`;
  }
  return `<label class="field${f.half ? ' half' : ''}" for="${id}">
    <span class="field-label">${esc(f.label)}</span>${input}
    ${f.hint ? `<span class="field-hint">${esc(f.hint)}</span>` : ''}
  </label>`;
}

/**
 * Opens a sheet with a form. onSubmit(values) may return false to keep it open.
 * Subject fields that chose "new subject" are resolved to a freshly created subject id.
 */
export function formSheet({ title, fields, values = {}, submitLabel = 'שמירה', onSubmit, footer = '', onMount }) {
  return openSheet(
    `<form class="sheet-form" novalidate>
      <div class="sheet-head">
        <button type="button" class="link-btn" data-close>ביטול</button>
        <h3>${esc(title)}</h3>
        <button type="submit" class="link-btn strong">${esc(submitLabel)}</button>
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
        onMount?.(sheet, close);
        const first = form.querySelector('input:not([type=date]):not([type=time]):not([hidden]), textarea');
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
