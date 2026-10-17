import { afterEach, expect, test, vi } from 'vitest';
import { createScope } from './scope';
import { createSplitLayout } from './split-layout';

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

test('拖动保存尺寸，横竖屏切换清除残留样式，卸载后不再处理输入', () => {
  vi.stubGlobal('innerWidth', 1000); vi.stubGlobal('innerHeight', 800);
  document.body.innerHTML = '<div id="app-shell"><div id="main-split"><div id="chat-panel"></div><div id="divider"></div><div id="content-header"></div><div id="fragment-mount"></div></div></div>';
  const shell = document.getElementById('app-shell')!, divider = document.getElementById('divider')!;
  document.getElementById('main-split')!.getBoundingClientRect = () => ({ left: 0, width: 1000, height: 800 } as DOMRect);
  document.getElementById('chat-panel')!.getBoundingClientRect = () => ({ width: 400 } as DOMRect);
  const onResize = vi.fn(), onModeChange = vi.fn(), onFocus = vi.fn();
  const scope = createScope(), split = createSplitLayout(scope, { onResize, onModeChange, onFocus, getContentTitle: () => '实验记录' });
  split.init();
  expect(onResize).toHaveBeenCalledOnce();
  divider.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: 650 }));
  window.dispatchEvent(new MouseEvent('mouseup'));
  expect(shell.style.getPropertyValue('--chat-width')).toBe('650px');
  expect(JSON.parse(localStorage.getItem('exdiary_panel_sizes')!).chatWidth).toBe(650);
  vi.stubGlobal('innerWidth', 390); window.dispatchEvent(new Event('resize'));
  expect(onModeChange).toHaveBeenCalledOnce();
  expect(shell.style.getPropertyValue('--chat-panel-h')).toBe('267px');
  vi.stubGlobal('innerWidth', 1000); window.dispatchEvent(new Event('resize'));
  expect(shell.style.getPropertyValue('--chat-panel-h')).toBe('');
  expect(shell.style.getPropertyValue('--chat-width')).toBe('650px');
  const calls = onResize.mock.calls.length;
  divider.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  expect(document.body.style.cursor).toBe('col-resize');
  scope.dispose();
  expect(document.body.style.cursor).toBe('');
  expect(divider).not.toHaveClass('dragging');
  window.dispatchEvent(new Event('resize')); window.dispatchEvent(new Event('focus'));
  expect(onResize).toHaveBeenCalledTimes(calls); expect(onFocus).not.toHaveBeenCalled();
});
