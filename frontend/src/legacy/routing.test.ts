import { expect, test } from 'vitest';
import { createPanelManager } from '../runtime/panel';

test.each([
  ['', '/', '/'], ['', '/experiments/A-01', '/experiments/A-01'],
  ['/app', '/app/', '/'], ['/app', '/app/experiments/A-01', '/experiments/A-01'],
  ['/app', '/app/settings', '/settings'], ['/app', '/application', '/application'],
])('原入口和 React 前缀正确解析：%s %s', (base, pathname, expected) => {
  document.documentElement.dataset.expermateBase = base;
  window.history.replaceState(null, '', pathname);
  const panel = createPanelManager({ listen() {}, cleanup() {} });
  expect(panel.currentPath()).toBe(expected);
  document.documentElement.dataset.expermateBase = '';
  window.history.replaceState(null, '', '/');
});
