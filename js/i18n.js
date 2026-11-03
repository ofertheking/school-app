// Interface language. Hebrew is the source language of every template; English
// comes from a dictionary that translates each screen, sheet and toast as it is
// put on the page (text nodes + placeholder / aria-label / title). What the user
// types — titles, notes, summaries — is never changed.
import { EN, EN_PATTERNS } from './i18n-en.js';

export const LANGS = [['he', 'עברית'], ['en', 'English']];

export const lang = (() => {
  try {
    return localStorage.getItem('ui-lang') === 'en' ? 'en' : 'he';
  } catch {
    return 'he';
  }
})();
export const isEn = lang === 'en';
export const LOCALE = isEn ? 'en-US' : 'he-IL';
/** Reading direction: charts run right→left in Hebrew, left→right in English. */
export const RTL = !isEn;
/** Pick the string for the current language (for text built in code). */
export const L = (he, en) => (isEn ? en : he);

export function setLang(l) {
  try {
    localStorage.setItem('ui-lang', l === 'en' ? 'en' : 'he');
  } catch { /* private mode */ }
  location.reload();
}

const HEB = /[֐-׿]/;
const PATTERNS = EN_PATTERNS.map(([re, to]) => [new RegExp(`^${re}$`, 'u'), to]);
// Punctuation, arrows and emoji around a phrase are kept and re-attached.
const EDGES = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u;

/** Hebrew word runs that are themselves known phrases (e.g. a subject name inside a sentence). */
const RUN = /[\u0590-\u05FF][\u0590-\u05FF"'״׳\- ]*[\u0590-\u05FF׳]|[\u0590-\u05FF]/g;
const runs = (s) => s.replace(RUN, (r) => EN.get(r.trim()) ?? r);

function one(p) {
  const hit = EN.get(p);
  if (hit != null) return hit;
  for (const [re, to] of PATTERNS) {
    const m = p.match(re);
    if (m) return runs(typeof to === 'function' ? to(...m.slice(1)) : p.replace(re, to));
  }
  const e = p.match(EDGES);
  if (e && e[2] && (e[1] || e[3]) && e[2] !== p) {
    const core = one(e[2]);
    if (core !== e[2]) return `${e[1]}${core}${e[3]}`;
  }
  return p;
}

/** Translate one string, or return it unchanged. */
export function tr(raw) {
  if (!isEn || !raw || !HEB.test(raw)) return raw;
  const lead = /^\s/.test(raw) ? ' ' : '';
  const trail = /\s$/.test(raw) ? ' ' : '';
  const exact = EN.get(raw.trim()); // multi-line strings (placeholders) keep their line breaks
  if (exact != null) return `${lead}${exact}${trail}`;
  const s = raw.replace(/\s+/g, ' ').trim();
  // "a · b · c" lines are translated part by part; a last pass catches known names inside.
  let out = EN.get(s) ?? s.split(' · ').map((x) => one(x.trim())).join(' · ');
  if (/[\u0590-\u05FF]/.test(out)) out = runs(out);
  if (out === s) return raw;
  return `${lead}${out}${trail}`;
}

// What the user wrote (note text, exam / task titles, topics) is never translated.
const SKIP = 'textarea, script, style, [data-raw], .nc-title, .nc-body, .task-title, .exam-card .title, .topic-text, .board-title, .linked-row .grow, .item-title';
const ATTRS = ['placeholder', 'aria-label', 'title'];

function attrs(el) {
  for (const a of ATTRS) {
    const v = el.getAttribute?.(a);
    if (v && HEB.test(v)) {
      const t = tr(v);
      if (t !== v) el.setAttribute(a, t);
    }
  }
}

/** Translate a node and everything inside it. */
export function translate(root) {
  if (!isEn || !root) return;
  if (root.nodeType === 3) {
    if (!root.parentElement?.closest(SKIP)) {
      const t = tr(root.data);
      if (t !== root.data) root.data = t;
    }
    return;
  }
  if (root.nodeType !== 1) return;
  if (root.closest(SKIP)) {
    if (!root.closest('[data-raw]')) attrs(root); // placeholders on text boxes still get translated
    return;
  }
  attrs(root);
  root.querySelectorAll('[placeholder],[aria-label],[title]').forEach((el) => !el.closest('[data-raw]') && attrs(el));
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => (n.nodeType === 1 ? (n.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP) : NodeFilter.FILTER_ACCEPT),
  });
  let n;
  while ((n = walker.nextNode())) {
    const t = tr(n.data);
    if (t !== n.data) n.data = t;
  }
}

/** Translate the page now and everything added to it later (before it's painted). */
export function startTranslating() {
  if (!isEn) return;
  document.title = tr(document.title);
  translate(document.body);
  new MutationObserver((muts) => {
    for (const m of muts) for (const node of m.addedNodes) translate(node);
  }).observe(document.body, { childList: true, subtree: true });
}
