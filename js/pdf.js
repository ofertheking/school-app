// Lazy loader for the bundled pdf.js (Mozilla, Apache-2.0) + a simple page renderer.
let libPromise = null;

export function loadPdfJs() {
  if (libPromise) return libPromise;
  libPromise = new Promise((resolve, reject) => {
    if (window.pdfjsLib) return resolve(window.pdfjsLib);
    const s = document.createElement('script');
    s.src = 'vendor/pdfjs/pdf.min.js';
    s.onload = () => {
      const lib = window.pdfjsLib;
      if (!lib) return reject(new Error('pdf.js failed to load'));
      lib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
      resolve(lib);
    };
    s.onerror = () => {
      libPromise = null;
      reject(new Error('pdf.js failed to load'));
    };
    document.head.appendChild(s);
  });
  return libPromise;
}

/** Open a PDF from a Blob / ArrayBuffer. Font eval is disabled (security hardening). */
export async function openPdf(src) {
  const pdfjs = await loadPdfJs();
  const data = src instanceof Blob ? new Uint8Array(await src.arrayBuffer()) : new Uint8Array(src);
  return pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: false }).promise;
}

/** Render pages of a PDF as canvases inside `container` (fits its width). */
export async function renderPdf(container, blob, { maxPages = 40 } = {}) {
  const doc = await openPdf(blob);
  const width = Math.max(280, container.clientWidth || 340);
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const n = Math.min(doc.numPages, maxPages);
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: (width / base.width) * dpr });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.className = 'pdf-page';
    canvas.setAttribute('aria-label', `עמוד ${i}`);
    container.appendChild(canvas);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  }
  if (doc.numPages > n) {
    const p = document.createElement('p');
    p.className = 'muted small center';
    p.textContent = `מוצגים ${n} מתוך ${doc.numPages} עמודים`;
    container.appendChild(p);
  }
  return doc.numPages;
}
