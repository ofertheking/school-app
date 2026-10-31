// Late-bound navigation hooks so feature modules can re-render / navigate
// without importing app.js (which would create an import cycle).
export const hooks = {
  render: () => {},
  navigate: () => {},
};

export const rerender = () => hooks.render();
export const go = (hash) => hooks.navigate(hash);
