// Small HTML building blocks shared by all screens.
import { S, subjectColor } from './core.js';
import { esc } from './util.js';
import { ICON } from './icons.js';

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

const seedOf = (str) => [...String(str)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/**
 * Screen header: the pinned nav bar (back / compact title / actions) and either
 * a plain large title or — with `hero` — a colourful banner like the home screen:
 * hero: { color: 'red' | 'orange' | …, chips: [html…] }.
 */
export function head(title, { back, actions = '', sub = '', navTitle, hero } = {}) {
  const banner = hero
    ? `<header class="page-hero h-${hero.color || 'blue'}"${hero.nb ? ` style="--nb:${hero.nb}"` : ''}>${bannerArt(seedOf(title))}
        <div class="ph-text">
          <h1 class="large-title">${esc(title)}</h1>
          ${sub ? `<p class="ph-sub">${sub}</p>` : ''}
          ${(hero.chips || []).filter(Boolean).length ? `<div class="hh-chips">${hero.chips.filter(Boolean).map((c) => `<span class="hh-chip">${c}</span>`).join('')}</div>` : ''}
        </div>
      </header>`
    : '';
  return `<div class="navbar">
    <div class="navbar-in">
      ${back ? `<button class="icon-btn back" data-go="${back}" aria-label="חזרה">${ICON.back}</button>` : '<span class="nav-sp"></span>'}
      <div class="nav-title" aria-hidden="true">${esc(navTitle ?? title)}</div>
      <div class="head-actions">${actions || '<span class="nav-sp"></span>'}</div>
    </div>
  </div>
  ${
    banner ||
    (title || sub
      ? `<header class="page-head">
    <h1 class="large-title">${esc(title)}</h1>
    ${sub ? `<p class="subtitle">${sub}</p>` : ''}
  </header>`
      : '') /* the screen shows its own title (banner / editor) */
  }`;
}

export const iconBtn = (act, icon, label, data = '') =>
  `<button class="icon-btn" data-act="${act}" aria-label="${esc(label)}" ${data}>${icon}</button>`;

export const section = (title, body, more = '') =>
  `<section class="section"><div class="section-head"><h2>${esc(title)}</h2>${more}</div>${body}</section>`;

// Emoji used by older screens → SF-style line icons.
const EMPTY_ICON = {
  '🎉': 'exam', '📅': 'calendar', '🗂️': 'exam', '✅': 'tasks', '📭': 'tasks', '⏱️': 'timer', '📚': 'book',
  '🔍': 'search', '🃏': 'cards', '✍️': 'edit', '🤷': 'search', '🗓️': 'calendar', '📸': 'camera', '📓': 'book',
  '🏆': 'cards', '💪': 'cards', '🌱': 'cards', '📈': 'chart',
};

// Each kind of empty screen gets its own colour, like the app's banners.
const EMPTY_COLOR = {
  exam: 'red', calendar: 'teal', tasks: 'orange', timer: 'purple', book: 'green', search: 'blue', cards: 'teal',
  edit: 'pink', camera: 'green', chart: 'indigo', note: 'yellow', clip: 'blue', grad: 'indigo',
};

export const empty = (emoji, text, cta = '') => {
  const name = EMPTY_ICON[emoji] || emoji;
  const ico = ICON[name];
  return `<div class="empty">${
    ico
      ? `<div class="empty-ico e-${EMPTY_COLOR[name] || 'blue'}" aria-hidden="true"><i class="eb eb1"></i><i class="eb eb2"></i><i class="eb eb3"></i><span class="ei-tile">${ico}</span></div>`
      : `<div class="empty-emoji" aria-hidden="true">${emoji}</div>`
  }<p>${text}</p>${cta}</div>`;
};

export { seedOf };

/** Settings-style coloured icon tile. */
export const tile = (icon, color = 'blue', cls = '') => `<span class="tile-ico t-${color}${cls ? ` ${cls}` : ''}" aria-hidden="true">${ICON[icon] || icon}</span>`;

export function seg(key, options) {
  return `<div class="seg" role="tablist">${options
    .map(
      ([val, label]) =>
        `<button role="tab" class="seg-btn${S.ui[key] === val ? ' on' : ''}" aria-selected="${S.ui[key] === val}" data-act="seg" data-key="${key}" data-val="${val}">${esc(label)}</button>`
    )
    .join('')}</div>`;
}

export const dot = (subjectId) => `<span class="dot" style="background:${subjectColor(subjectId)}"></span>`;

export function subjectChip(s, { act = '', on = false, data = '' } = {}) {
  return `<button class="chip-btn${on ? ' on' : ''}" ${act ? `data-act="${act}"` : `data-go="#subject-${s.id}"`} data-id="${s.id}" ${data}>
    <span class="dot" style="background:var(--c${s.color % 8})"></span>${esc(s.name)}</button>`;
}
