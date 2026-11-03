// Motion: iOS-style push/pop page slides (View Transitions where the browser has
// them), a sliding tab indicator, confetti for finished work, numbers that count
// up, and an edge swipe to go back. Everything respects "reduce motion".
import { RTL } from './i18n.js';

export const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const TAB_ROOTS = new Set(['home', 'exams', 'grades', 'tasks', 'study', 'library']);
const stack = [];
let skipNext = false;
let hinted = null;
/** A back button / swipe says how the next screen change should move. */
export const hint = (dir) => (hinted = dir);
export const canSlide = (dir) => (dir === 'forward' || dir === 'back') && !reduced() && typeof document.startViewTransition === 'function';

/** forward (push) · back (pop) · tab (switching tabs) · none (first paint / same screen). */
export function directionFor(route, prev) {
  if (!prev || route === prev) return 'none';
  let dir;
  if (stack.length > 1 && stack[stack.length - 2] === route) {
    stack.pop();
    dir = 'back';
  } else if (TAB_ROOTS.has(route.split('-')[0]) && !route.includes('-')) {
    stack.length = 0;
    stack.push(route);
    dir = 'tab';
  } else {
    if (!stack.length) stack.push(prev);
    stack.push(route);
    dir = 'forward';
  }
  if (skipNext) {
    skipNext = false;
    hinted = null;
    return 'none';
  }
  if (hinted) {
    if (hinted === 'back') dir = 'back';
    hinted = null;
  }
  return dir;
}

/** Run a DOM update as a slide; returns true if a view transition is playing it. */
export function swap(update, dir) {
  if (!canSlide(dir)) {
    update();
    return false;
  }
  const root = document.documentElement;
  root.dataset.vt = dir;
  try {
    const t = document.startViewTransition(update);
    t.finished.finally(() => delete root.dataset.vt);
  } catch {
    delete root.dataset.vt;
    update();
    return false;
  }
  return true;
}

/** Slide the tab highlight under the active tab (and bounce its icon on change). */
let lastTab = null;
export function moveTabIndicator() {
  const ind = document.querySelector('.tab-ind');
  const on = document.querySelector('.tab.on');
  if (!ind || !on) return;
  const bar = on.parentElement.getBoundingClientRect();
  const r = on.getBoundingClientRect();
  ind.style.width = `${r.width}px`;
  ind.style.transform = `translateX(${r.left - bar.left}px)`;
  ind.classList.add('ready');
  if (lastTab && lastTab !== on.dataset.tab && !reduced()) {
    on.classList.remove('pop');
    void on.offsetWidth;
    on.classList.add('pop');
    setTimeout(() => on.classList.remove('pop'), 500);
  }
  lastTab = on.dataset.tab;
}

const COLORS = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#5ac8fa', '#007aff', '#af52de', '#ff2d55'];

/** A little confetti burst from a point on the screen. */
export function burst(x, y, count = 22) {
  if (reduced() || !Element.prototype.animate) return;
  const layer = document.createElement('div');
  layer.className = 'confetti';
  document.body.appendChild(layer);
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i');
    const a = Math.random() * Math.PI * 2;
    const d = 46 + Math.random() * 80;
    const dx = Math.cos(a) * d;
    const dy = Math.sin(a) * d - 50;
    p.style.cssText = `left:${x}px;top:${y}px;background:${COLORS[i % COLORS.length]};width:${5 + Math.random() * 5}px;height:${7 + Math.random() * 7}px;border-radius:${Math.random() < 0.35 ? '50%' : '2px'}`;
    layer.appendChild(p);
    p.animate(
      [
        { transform: 'translate(-50%, -50%) rotate(0deg) scale(0.4)', opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${Math.random() * 400}deg) scale(1)`, opacity: 1, offset: 0.55 },
        { transform: `translate(calc(-50% + ${dx * 1.2}px), calc(-50% + ${dy + 110}px)) rotate(${Math.random() * 720}deg) scale(0.7)`, opacity: 0 },
      ],
      { duration: 900 + Math.random() * 500, easing: 'cubic-bezier(0.15, 0.7, 0.3, 1)', fill: 'forwards' }
    );
  }
  setTimeout(() => layer.remove(), 1600);
}

export function burstFrom(el) {
  if (!el?.getBoundingClientRect) return;
  const r = el.getBoundingClientRect();
  burst(r.left + r.width / 2, r.top + r.height / 2);
}

/** Big numbers count up from 0 when a screen opens. */
export function countUp(root) {
  if (reduced()) return;
  root.querySelectorAll('.hero-grade, .sum-big bdi, .sum-big, .countdown .hero-num, .grade-avg, .done-avg b, .nb-hero-stats b, .att-stats .stat-value').forEach((el) => {
    if (el.children.length) return;
    const txt = el.textContent.trim();
    if (!/^\d{1,3}(\.\d)?$/.test(txt) || +txt === 0) return;
    const target = +txt;
    const dec = txt.includes('.') ? 1 : 0;
    const t0 = performance.now();
    const dur = 650 + Math.min(450, target * 4);
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      el.textContent = k < 1 ? (target * (1 - (1 - k) ** 3)).toFixed(dec) : txt;
      if (k < 1) requestAnimationFrame(step);
    };
    el.textContent = (0).toFixed(dec);
    requestAnimationFrame(step);
  });
}

/** Notebook cover swings open, then we go in. */
export function openNotebook(card, go) {
  if (reduced()) return go();
  card.classList.add('opening');
  setTimeout(go, 280);
}

/**
 * Edge swipe back (home-screen app only — Safari has its own): drag from the
 * start edge, the page follows the finger; let go past ⅓ to go back.
 */
export function enableEdgeSwipe(view) {
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  if (!standalone) return;
  let st = null;
  const edge = (x) => (RTL ? x > innerWidth - 24 : x < 24);
  const sign = RTL ? -1 : 1; // which way "inward" is
  document.addEventListener(
    'touchstart',
    (e) => {
      const t = e.touches[0];
      const back = view.querySelector('.navbar .back');
      st = back && edge(t.clientX) && !document.querySelector('.sheet-wrap') ? { x: t.clientX, y: t.clientY, back, moved: false } : null;
    },
    { passive: true }
  );
  document.addEventListener(
    'touchmove',
    (e) => {
      if (!st) return;
      const t = e.touches[0];
      const dx = (t.clientX - st.x) * sign;
      if (!st.moved && Math.abs(t.clientY - st.y) > Math.abs(dx)) {
        st = null;
        return;
      }
      st.moved = true;
      view.style.transition = 'none';
      view.style.transform = `translateX(${Math.max(0, dx) * sign}px)`;
      view.classList.add('swiping');
    },
    { passive: true }
  );
  document.addEventListener(
    'touchend',
    (e) => {
      if (!st) return;
      const dx = (e.changedTouches[0].clientX - st.x) * sign;
      const { back } = st;
      st = null;
      view.style.transition = 'transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)';
      if (dx > innerWidth / 3) {
        view.style.transform = `translateX(${innerWidth * sign}px)`;
        setTimeout(() => {
          skipNext = true;
          view.style.transition = 'none';
          view.style.transform = '';
          view.classList.remove('swiping');
          back.click();
        }, 200);
      } else {
        view.style.transform = '';
        setTimeout(() => view.classList.remove('swiping'), 220);
      }
    },
    { passive: true }
  );
}
