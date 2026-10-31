// Small HTML building blocks shared by all screens.
import { S, subjectColor } from './core.js';
import { esc } from './util.js';
import { ICON } from './icons.js';

export function head(title, { back, actions = '', sub = '', navTitle } = {}) {
  return `<header class="page-head">
    <div class="head-bar">
      ${back ? `<button class="icon-btn back" data-go="${back}" aria-label="חזרה">${ICON.back}</button>` : '<span></span>'}
      <div class="nav-title" aria-hidden="true">${esc(navTitle ?? title)}</div>
      <div class="head-actions">${actions}</div>
    </div>
    <h1 class="large-title">${esc(title)}</h1>
    ${sub ? `<p class="subtitle">${sub}</p>` : ''}
  </header>`;
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

export const empty = (emoji, text, cta = '') => {
  const ico = ICON[EMPTY_ICON[emoji] || emoji];
  return `<div class="empty">${ico ? `<div class="empty-ico" aria-hidden="true">${ico}</div>` : `<div class="empty-emoji" aria-hidden="true">${emoji}</div>`}<p>${text}</p>${cta}</div>`;
};

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
