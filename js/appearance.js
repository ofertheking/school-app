// Theme (system / light / dark) and accent colour, Apple system colours.
import { S } from './core.js';

export const ACCENTS = {
  blue: { light: '#007aff', dark: '#0a84ff', name: 'כחול' },
  indigo: { light: '#5856d6', dark: '#5e5ce6', name: 'אינדיגו' },
  purple: { light: '#af52de', dark: '#bf5af2', name: 'סגול' },
  pink: { light: '#ff2d55', dark: '#ff375f', name: 'ורוד' },
  red: { light: '#ff3b30', dark: '#ff453a', name: 'אדום' },
  orange: { light: '#ff9500', dark: '#ff9f0a', name: 'כתום' },
  green: { light: '#34c759', dark: '#30d158', name: 'ירוק' },
  teal: { light: '#30b0c7', dark: '#40c8e0', name: 'טורקיז' },
  graphite: { light: '#8e8e93', dark: '#98989d', name: 'גרפיט' },
};

const mq = typeof window !== 'undefined' && window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : { matches: false, addEventListener() {} };

export function appearance() {
  const a = S.data.settings.appearance || {};
  return { theme: a.theme || 'system', accent: ACCENTS[a.accent] ? a.accent : 'blue' };
}

export function applyAppearance() {
  const { theme, accent } = appearance();
  const dark = theme === 'dark' || (theme === 'system' && mq.matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  const c = ACCENTS[accent];
  root.style.setProperty('--accent', dark ? c.dark : c.light);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#000000' : '#f2f2f7');
  // Cached for the inline boot script in index.html, so the first paint is already themed.
  try {
    localStorage.setItem('ui-appearance', JSON.stringify({ theme, light: c.light, dark: c.dark }));
  } catch { /* ignore */ }
}

mq.addEventListener?.('change', () => appearance().theme === 'system' && applyAppearance());
