// Attachments shared by summaries, notebooks and exams: storage, grid UI,
// photo gallery and an in-app PDF viewer.
import { S, save, item, exam, task } from './core.js';
import { esc, uid, compressImage, fmtDate, isoDate } from './util.js';
import { putFile, getFile, deleteFile } from './store.js';
import { openSheet, toast, askConfirm, fileURL, forgetFileURL, hydrateFiles, shareOrDownload } from './ui.js';
import { ICON } from './icons.js';
import { rerender } from './router.js';
import { renderPdf } from './pdf.js';

export const ACCEPT_ALL = 'image/*,video/*,audio/*,application/pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.pages,.key,.numbers';
const ext = (f) => (String(f?.name || '').match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
export const isImg = (f) => !!f?.type?.startsWith('image/');
export const isPdf = (f) => f?.type === 'application/pdf' || ext(f) === 'pdf';
export const isVideo = (f) => !!f?.type?.startsWith('video/') || /^(mp4|mov|m4v|webm|3gp)$/.test(ext(f));
export const isAudio = (f) => !!f?.type?.startsWith('audio/') || /^(m4a|mp3|wav|aac|caf|ogg|opus)$/.test(ext(f));
const isMedia = (f) => isImg(f) || isVideo(f);
const fmtDur = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

/** "3 תמונות · סרטון אחד · 2 קבצים" */
export function filesSummary(list = []) {
  const img = list.filter(isImg).length;
  const vid = list.filter(isVideo).length;
  const other = list.length - img - vid;
  const part = (n, one, many) => (n === 1 ? one : n ? `${n} ${many}` : '');
  return [part(img, 'תמונה אחת', 'תמונות'), part(vid, 'סרטון אחד', 'סרטונים'), part(other, 'קובץ אחד', 'קבצים')].filter(Boolean).join(' · ');
}

/**
 * Where a list of attachments lives:
 *   "item:<id>"            summary / notebook page files
 *   "exam:<id>:material"   material for an exam
 *   "exam:<id>:paper"      photos of the exam itself
 *   "task:<id>:material"   worksheet / instructions for a task
 *   "task:<id>:work"       photos / files of the finished work
 */
export function resolveRef(ref) {
  const [kind, id, slot] = String(ref).split(':');
  if (kind === 'item') {
    const it = item(id);
    if (!it) return null;
    it.files = it.files || [];
    return { owner: it, list: it.files, kind };
  }
  if (kind === 'exam') {
    const e = exam(id);
    if (!e) return null;
    const key = slot === 'paper' ? 'paperFiles' : 'materialFiles';
    e[key] = e[key] || [];
    return { owner: e, list: e[key], kind };
  }
  if (kind === 'task') {
    const t = task(id);
    if (!t) return null;
    const key = slot === 'work' ? 'workFiles' : 'materialFiles';
    t[key] = t[key] || [];
    return { owner: t, list: t[key], kind };
  }
  return null;
}

/** A small JPEG of a frame from the video (+ its length), for the grid. Never throws. */
function videoThumb(blob) {
  return new Promise((resolve) => {
    let done = false;
    const url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    const finish = (res) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(res);
    };
    const timer = setTimeout(() => finish(null), 8000);
    v.muted = true;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.preload = 'auto';
    v.onloadedmetadata = () => {
      try {
        v.currentTime = Math.min(0.5, (v.duration || 1) / 3);
      } catch {
        finish({ duration: v.duration });
      }
    };
    v.onseeked = () => {
      try {
        const sc = Math.min(1, 480 / Math.max(v.videoWidth, v.videoHeight, 1));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(v.videoWidth * sc));
        c.height = Math.max(1, Math.round(v.videoHeight * sc));
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        c.toBlob((b) => finish({ blob: v.videoWidth ? b : null, duration: v.duration }), 'image/jpeg', 0.75);
      } catch {
        finish({ duration: v.duration });
      }
    };
    v.onerror = () => finish(null);
    v.src = url;
  });
}

const mb = (n) => `${Math.max(1, Math.round(n / 1048576))}MB`;

/** Save files to IndexedDB (photos are shrunk first) and return their metadata. */
export async function storeFiles(fileList) {
  const metas = [];
  let free = Infinity;
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.quota) free = est.quota - (est.usage || 0);
  } catch { /* unknown */ }
  for (const f of fileList) {
    const video = isVideo(f);
    if (f.size > free) {
      toast(`אין מספיק מקום במכשיר בשביל ${f.name || 'הקובץ'} (${mb(f.size)})`, 5000);
      continue;
    }
    if (video || f.size > 15 * 1048576) toast(`שומר ${video ? 'סרטון' : 'קובץ'} (${mb(f.size)})…`, 4000);
    const blob = video ? f : await compressImage(f);
    const id = uid();
    try {
      await putFile(id, blob, { strict: true });
    } catch {
      toast(`לא הצלחתי לשמור את ${f.name || 'הקובץ'} — אולי אין מספיק מקום`, 5000);
      continue;
    }
    free -= blob.size;
    const meta = { id, name: f.name || (video ? 'סרטון' : 'קובץ'), type: blob.type || f.type || '', size: blob.size, addedAt: Date.now() };
    if (video) {
      const t = await videoThumb(f);
      if (t?.duration && isFinite(t.duration)) meta.duration = Math.round(t.duration);
      if (t?.blob) {
        const tid = uid();
        try {
          await putFile(tid, t.blob, { strict: true });
          meta.thumb = tid;
        } catch { /* no thumbnail, still fine */ }
      }
    }
    metas.push(meta);
  }
  return metas;
}

export async function attachTo(ref, fileList) {
  const r = resolveRef(ref);
  if (!r || !fileList?.length) return [];
  toast('שומר…', 1200);
  const metas = await storeFiles(fileList);
  r.list.push(...metas);
  if (r.kind === 'item') r.owner.updatedAt = Date.now();
  save();
  return metas;
}

export async function removeFile(ref, fid) {
  const r = resolveRef(ref);
  if (!r) return;
  const i = r.list.findIndex((f) => f.id === fid);
  const meta = i !== -1 ? r.list[i] : null;
  if (i !== -1) r.list.splice(i, 1);
  forgetFileURL(fid);
  await deleteFile(fid);
  if (meta?.thumb) {
    forgetFileURL(meta.thumb);
    await deleteFile(meta.thumb);
  }
  // A notebook page batch with no photos and no text left is removed entirely.
  if (r.kind === 'item' && r.owner.notebook && !r.list.length && !r.owner.body?.trim()) {
    S.data.items = S.data.items.filter((x) => x !== r.owner);
  } else if (r.kind === 'item') r.owner.updatedAt = Date.now();
  save();
}

function badge(f) {
  const e = ext(f);
  if (isPdf(f)) return '<b class="pdf-badge">PDF</b>';
  if (isAudio(f)) return `<span class="ext-ico">${ICON.music}</span>`;
  if (/^(doc|docx|pages|rtf|odt)$/.test(e)) return '<b class="ext-badge b-doc">DOC</b>';
  if (/^(ppt|pptx|key|odp)$/.test(e)) return '<b class="ext-badge b-ppt">PPT</b>';
  if (/^(xls|xlsx|numbers|csv|ods)$/.test(e)) return '<b class="ext-badge b-xls">XLS</b>';
  if (/^(zip|rar|7z)$/.test(e)) return '<b class="ext-badge b-zip">ZIP</b>';
  return `<span class="ext-ico">${ICON.doc}</span>`;
}

function tileHTML(ref, f) {
  const del = `<button class="file-del" data-act="file-del" data-ref="${ref}" data-fid="${f.id}" aria-label="מחיקה">${ICON.x}</button>`;
  if (isImg(f)) {
    return `<div class="file-tile"><button class="file-img" data-act="file-open" data-ref="${ref}" data-fid="${f.id}" aria-label="הגדלה"><img alt="${esc(f.name)}" data-file-src="${f.id}"></button>${del}</div>`;
  }
  if (isVideo(f)) {
    return `<div class="file-tile"><button class="file-img file-video" data-act="file-open" data-ref="${ref}" data-fid="${f.id}" aria-label="ניגון ${esc(f.name)}">
        ${f.thumb ? `<img alt="" data-file-src="${f.thumb}">` : ''}<span class="play-badge">${ICON.play}</span>
        ${f.duration ? `<span class="dur-badge ltr">${fmtDur(f.duration)}</span>` : ''}</button>${del}</div>`;
  }
  return `<div class="file-tile doc"><button class="file-doc" data-act="file-open" data-ref="${ref}" data-fid="${f.id}">${badge(f)}<span>${esc(f.name)}</span></button>${del}</div>`;
}

export function filesGrid(ref, files = [], { addLabel = 'צילום / קובץ', accept = ACCEPT_ALL, add = true } = {}) {
  if (!add && !files.length) return '';
  return `<div class="files-grid">
    ${files.map((f) => tileHTML(ref, f)).join('')}
    ${
      add
        ? `<label class="file-tile add">
      <input type="file"${accept ? ` accept="${accept}"` : ''} multiple data-attach-ref="${ref}" hidden>
      ${ICON.camera}<span>${esc(addLabel)}</span>
    </label>`
        : ''
    }
  </div>`;
}

/** Four big add buttons: camera photo, camera video, photo library, any file. */
export function attachBar(ref) {
  const btn = (icon, label, attrs) =>
    `<label class="attach-btn">${icon}<span>${label}</span><input type="file" ${attrs} data-attach-ref="${ref}" hidden></label>`;
  return `<div class="attach-bar">
    ${btn(ICON.camera, 'צילום', 'accept="image/*" capture="environment"')}
    ${btn(ICON.video, 'סרטון', 'accept="video/*" capture="environment"')}
    ${btn(ICON.photos, 'גלריה', 'accept="image/*,video/*" multiple')}
    ${btn(ICON.doc, 'קבצים', 'multiple')}
  </div>`;
}

// ---------------------------------------------------------------- viewers

/**
 * Full-screen gallery for photos and videos. entries: [{ ref, fid, caption, video, name, type }].
 * Swipe or use the arrows.
 */
let sheetVid = null;
export function openGallery(entries, start = 0) {
  if (!entries.length) return;
  let i = Math.max(0, Math.min(start, entries.length - 1));
  openSheet(
    `<div class="gallery">
      <div class="gallery-top"><span class="g-count small muted ltr"></span><span class="g-caption small"></span></div>
      <div class="gallery-stage"><img class="g-img" alt=""><video class="g-video" controls playsinline preload="metadata" hidden></video><p class="g-missing" hidden>הקובץ לא נמצא במכשיר</p></div>
      <div class="gallery-nav">
        <button class="icon-btn" data-g="prev" aria-label="הקודם">${ICON.back}</button>
        <button class="btn ghost sm" data-g="share">${ICON.share} שיתוף</button>
        <button class="btn danger-ghost sm" data-g="del">${ICON.trash} מחיקה</button>
        <button class="icon-btn" data-g="next" aria-label="הבא">${ICON.fwd}</button>
      </div>
    </div>
    <button class="btn ghost block" data-close>סגירה</button>`,
    {
      tall: true,
      onClose: () => sheetVid?.pause(),
      onMount(sheet, close) {
        sheetVid = sheet.querySelector('.g-video');
        const img = sheet.querySelector('.g-img');
        const vid = sheet.querySelector('.g-video');
        const missing = sheet.querySelector('.g-missing');
        const show = async () => {
          const e = entries[i];
          sheet.querySelector('.g-count').textContent = `${i + 1} / ${entries.length}`;
          sheet.querySelector('.g-caption').textContent = e.caption || '';
          vid.pause();
          const u = (await fileURL(e.fid)) || '';
          missing.hidden = !!u;
          img.hidden = !!e.video || !u;
          vid.hidden = !e.video || !u;
          if (e.video) {
            img.removeAttribute('src');
            if (u && vid.getAttribute('src') !== u) vid.src = u;
          } else {
            vid.removeAttribute('src');
            vid.load();
            img.src = u;
          }
          sheet.querySelector('[data-g=prev]').disabled = i === 0;
          sheet.querySelector('[data-g=next]').disabled = i === entries.length - 1;
        };
        const go = (d) => {
          const n = i + d;
          if (n < 0 || n >= entries.length) return;
          i = n;
          show();
        };
        sheet.querySelector('[data-g=prev]').addEventListener('click', () => go(-1));
        sheet.querySelector('[data-g=next]').addEventListener('click', () => go(1));
        sheet.querySelector('[data-g=share]').addEventListener('click', async () => {
          const e = entries[i];
          const blob = await getFile(e.fid);
          if (blob) shareOrDownload(new File([blob], e.name || `page-${i + 1}.jpg`, { type: blob.type || e.type || 'image/jpeg' }));
        });
        sheet.querySelector('[data-g=del]').addEventListener('click', async () => {
          if (!(await askConfirm(entries[i].video ? 'למחוק את הסרטון?' : 'למחוק את התמונה?'))) return;
          vid.pause();
          await removeFile(entries[i].ref, entries[i].fid);
          entries.splice(i, 1);
          rerender();
          if (!entries.length) return close();
          i = Math.min(i, entries.length - 1);
          show();
        });
        let x0 = null;
        const stage = sheet.querySelector('.gallery-stage');
        stage.addEventListener('touchstart', (ev) => (x0 = ev.touches[0].clientX), { passive: true });
        stage.addEventListener('touchend', (ev) => {
          if (x0 == null) return;
          const dx = ev.changedTouches[0].clientX - x0;
          x0 = null;
          // RTL: pages turn to the right, like a Hebrew notebook.
          if (Math.abs(dx) > 45) go(dx > 0 ? 1 : -1);
        });
        show();
      },
    }
  );
}

export async function openPdfViewer(fid, name = 'PDF') {
  const blob = await getFile(fid);
  if (!blob) return toast('הקובץ לא נמצא');
  openSheet(
    `<div class="sheet-head"><button type="button" class="link-btn" data-close>סגירה</button><h3 class="ellipsis">${esc(name)}</h3>
       <button type="button" class="link-btn" data-share>שיתוף</button></div>
     <div class="pdf-pages"><div class="spinner" aria-hidden="true"></div></div>`,
    {
      tall: true,
      async onMount(sheet) {
        sheet.querySelector('[data-share]').addEventListener('click', () =>
          shareOrDownload(new File([blob], /\.pdf$/i.test(name) ? name : `${name}.pdf`, { type: 'application/pdf' }))
        );
        const box = sheet.querySelector('.pdf-pages');
        try {
          box.innerHTML = '';
          await renderPdf(box, blob);
        } catch (e) {
          box.innerHTML = `<p class="muted center">לא הצלחתי להציג את הקובץ כאן. אפשר לפתוח אותו דרך "שיתוף".</p>`;
        }
      },
    }
  );
}

let audioEl = null;
async function openAudio(fid, name) {
  const u = await fileURL(fid);
  if (!u) return toast('הקובץ לא נמצא');
  openSheet(
    `<div class="sheet-head"><button type="button" class="link-btn" data-close>סגירה</button><h3 class="ellipsis">${esc(name)}</h3>
       <button type="button" class="link-btn" data-share>שיתוף</button></div>
     <div class="audio-box"><span class="audio-ico">${ICON.music}</span><audio controls src="${u}"></audio></div>`,
    {
      onMount(sheet) {
        audioEl = sheet.querySelector('audio');
        sheet.querySelector('[data-share]').addEventListener('click', async () => {
          const blob = await getFile(fid);
          if (blob) shareOrDownload(new File([blob], name, { type: blob.type }));
        });
      },
      onClose: () => audioEl?.pause(),
    }
  );
}

export async function openFile(ref, fid) {
  const r = resolveRef(ref);
  const f = r?.list.find((x) => x.id === fid);
  if (!f) return toast('הקובץ לא נמצא');
  if (isMedia(f)) {
    const media = r.list.filter(isMedia);
    return openGallery(
      media.map((x) => ({
        ref, fid: x.id, video: isVideo(x), name: x.name, type: x.type,
        caption: x.addedAt ? fmtDate(isoDate(new Date(x.addedAt))) : '',
      })),
      media.indexOf(f)
    );
  }
  if (isPdf(f)) return openPdfViewer(fid, f.name);
  if (isAudio(f)) return openAudio(fid, f.name);
  const blob = await getFile(fid);
  if (blob) shareOrDownload(new File([blob], f.name, { type: f.type || blob.type }));
}

export const actions = {
  'file-open': ({ ref, fid }) => openFile(ref, fid),
  async 'file-del'({ ref, fid }) {
    if (!(await askConfirm('למחוק את הקובץ?'))) return;
    await removeFile(ref, fid);
    rerender();
  },
};

/** Change-event hook: <input type=file data-attach-ref="..."> */
export async function onAttachInput(el) {
  const ref = el.dataset.attachRef;
  const files = [...el.files];
  el.value = '';
  if (!files.length) return false;
  const added = await attachTo(ref, files);
  if (added.length) toast(added.length === 1 ? 'נוסף ✔︎' : `נוספו ${added.length} קבצים ✔︎`);
  const r = resolveRef(ref);
  if (r?.kind === 'item' && !r.owner.title) {
    const f = files[0];
    const generic = !f.name || /^(image|img_|photo|תמונה)/i.test(f.name);
    r.owner.title = generic ? `צילום ${fmtDate(isoDate())}` : f.name.replace(/\.[^.]+$/, '');
    save();
  }
  rerender();
  return true;
}

export { hydrateFiles };
