// Attachments shared by summaries, notebooks and exams: storage, grid UI,
// photo gallery and an in-app PDF viewer.
import { S, save, item, exam } from './core.js';
import { esc, uid, compressImage, fmtDate, isoDate } from './util.js';
import { putFile, getFile, deleteFile } from './store.js';
import { openSheet, toast, askConfirm, fileURL, forgetFileURL, hydrateFiles, shareOrDownload } from './ui.js';
import { ICON } from './icons.js';
import { rerender } from './router.js';
import { renderPdf } from './pdf.js';

export const ACCEPT_ALL = 'image/*,application/pdf,.doc,.docx,.ppt,.pptx,.txt';
const isImg = (f) => f.type?.startsWith('image/');
const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');

/**
 * Where a list of attachments lives:
 *   "item:<id>"            summary / notebook page files
 *   "exam:<id>:material"   material for an exam
 *   "exam:<id>:paper"      photos of the exam itself
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
  return null;
}

/** Save files to IndexedDB (photos are shrunk first) and return their metadata. */
export async function storeFiles(fileList) {
  const metas = [];
  for (const f of fileList) {
    const blob = await compressImage(f);
    const id = uid();
    await putFile(id, blob);
    metas.push({ id, name: f.name || 'קובץ', type: blob.type || f.type || '', size: blob.size, addedAt: Date.now() });
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
  if (i !== -1) r.list.splice(i, 1);
  forgetFileURL(fid);
  await deleteFile(fid);
  // A notebook page batch with no photos and no text left is removed entirely.
  if (r.kind === 'item' && r.owner.notebook && !r.list.length && !r.owner.body?.trim()) {
    S.data.items = S.data.items.filter((x) => x !== r.owner);
  } else if (r.kind === 'item') r.owner.updatedAt = Date.now();
  save();
}

export function filesGrid(ref, files = [], { addLabel = 'צילום / קובץ', accept = ACCEPT_ALL } = {}) {
  return `<div class="files-grid">
    ${files
      .map((f) =>
        isImg(f)
          ? `<div class="file-tile"><button class="file-img" data-act="file-open" data-ref="${ref}" data-fid="${f.id}" aria-label="הגדלה"><img alt="${esc(f.name)}" data-file-src="${f.id}"></button>
             <button class="file-del" data-act="file-del" data-ref="${ref}" data-fid="${f.id}" aria-label="מחיקה">${ICON.x}</button></div>`
          : `<div class="file-tile doc"><button class="file-doc" data-act="file-open" data-ref="${ref}" data-fid="${f.id}">${isPdf(f) ? '<b class="pdf-badge">PDF</b>' : ICON.clip}<span>${esc(f.name)}</span></button>
             <button class="file-del" data-act="file-del" data-ref="${ref}" data-fid="${f.id}" aria-label="מחיקה">${ICON.x}</button></div>`
      )
      .join('')}
    <label class="file-tile add">
      <input type="file" accept="${accept}" multiple data-attach-ref="${ref}" hidden>
      ${ICON.camera}<span>${esc(addLabel)}</span>
    </label>
  </div>`;
}

// ---------------------------------------------------------------- viewers

/**
 * Full-screen photo gallery. entries: [{ ref, fid, caption }]. Swipe or use the arrows.
 */
export function openGallery(entries, start = 0) {
  if (!entries.length) return;
  let i = Math.max(0, Math.min(start, entries.length - 1));
  openSheet(
    `<div class="gallery">
      <div class="gallery-top"><span class="g-count small muted ltr"></span><span class="g-caption small"></span></div>
      <div class="gallery-stage"><img class="g-img" alt=""></div>
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
      onMount(sheet, close) {
        const img = sheet.querySelector('.g-img');
        const show = async () => {
          const e = entries[i];
          sheet.querySelector('.g-count').textContent = `${i + 1} / ${entries.length}`;
          sheet.querySelector('.g-caption').textContent = e.caption || '';
          img.src = (await fileURL(e.fid)) || '';
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
          const blob = await getFile(entries[i].fid);
          if (blob) shareOrDownload(new File([blob], `page-${i + 1}.jpg`, { type: blob.type || 'image/jpeg' }));
        });
        sheet.querySelector('[data-g=del]').addEventListener('click', async () => {
          if (!(await askConfirm('למחוק את התמונה?'))) return;
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

export async function openFile(ref, fid) {
  const r = resolveRef(ref);
  const f = r?.list.find((x) => x.id === fid);
  if (!f) return toast('הקובץ לא נמצא');
  if (isImg(f)) {
    const imgs = r.list.filter(isImg);
    return openGallery(imgs.map((x) => ({ ref, fid: x.id, caption: x.addedAt ? fmtDate(isoDate(new Date(x.addedAt))) : '' })), imgs.indexOf(f));
  }
  if (isPdf(f)) return openPdfViewer(fid, f.name);
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
  await attachTo(ref, files);
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
