import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { App } from './App';
import { startShell } from '../runtime/start';

vi.mock('../runtime/start', () => ({ startShell: vi.fn(() => vi.fn()) }));
const original = new DOMParser().parseFromString(
  readFileSync('src/test-fixtures/shell.html', 'utf8'), 'text/html');

function structure(node: Node): unknown {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.replace(/\s+/g, ' ').trim() || null;
  if (!(node instanceof Element)) return null;
  const attributes = [...node.attributes].filter(attr => !attr.name.startsWith('on') && attr.name !== 'style'
    && !(attr.name === 'value' && attr.value === ''))
    .map(attr => [attr.name, attr.value]).sort(([left], [right]) => left.localeCompare(right));
  // 以相同方式规范化源码属性与 React 的逐属性写入，避免 jsdom 简写展开差异。
  const declaration = document.createElement('div').style;
  for (const property of (node.getAttribute('style') || '').split(';')) {
    const colon = property.indexOf(':');
    if (colon >= 0) declaration.setProperty(property.slice(0, colon).trim(), property.slice(colon + 1).trim());
  }
  const style = [...declaration].map(name => [name, declaration.getPropertyValue(name)])
    .sort(([left], [right]) => left.localeCompare(right));
  return { tag: node.tagName, attributes, style, children: [...node.childNodes].map(structure).filter(Boolean) };
}

beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ok:false}), {status:401}))));
afterEach(() => {vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();});

test('React 外壳与原版保持相同标签、层级、class、属性、内联样式和文字', () => {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(<App />);
  const expected = [...original.body.children].filter(node => node.tagName !== 'SCRIPT').map(structure);
  expect([...container.children].map(structure)).toEqual(expected);
  expect(container.querySelector('iframe')).toBeNull();
});

test('仅复用原有 CSS，加载顺序一致，不包含替代样式表', () => {
  const frontend = new DOMParser().parseFromString(
    readFileSync('index.html', 'utf8'), 'text/html');
  const styles = (document: Document) => [...document.querySelectorAll('link[rel="stylesheet"]')]
    .map(node => node.getAttribute('href'));
  expect(styles(frontend)).toEqual(styles(original));
  expect(frontend.querySelector('style')).toBeNull();
});

test('React 挂载后初始化模块化外壳，卸载清理，不加载旧业务脚本或 HTML 片段', () => {
  const source = readFileSync('src/runtime/start.ts','utf8');
  expect(source).not.toContain('createElement("script")');
  expect(source).not.toContain('/static/js/');
  expect(readFileSync('src/runtime/panel.js','utf8')).not.toContain('_buildFragmentUrl');
  const cleanup = vi.fn();vi.mocked(startShell).mockReturnValueOnce(cleanup);
  const view=render(<App />);
  expect(startShell).toHaveBeenCalled();
  expect(document.getElementById('chat-panel')).toBeInTheDocument();
  expect(document.getElementById('de-stijl-canvas')).toBeInTheDocument();
  expect(document.getElementById('fragment-mount')).toBeInTheDocument();
  view.unmount();expect(cleanup).toHaveBeenCalledOnce();
});

test('原有按钮调用原处理函数，并保持链接阻止默认跳转', async () => {
  const user = userEvent.setup();
  const navigate = vi.fn();
  Object.assign(window, { PanelManager: { navigate } });
  render(<App />);
  await user.click(screen.getByRole('link', { name: '登录/注册' }));
  expect(document.getElementById('auth-modal')).toHaveStyle({display:'flex'});
  await user.click(document.getElementById('chat-header-settings')!);
  expect(navigate).toHaveBeenCalledWith('/settings');
});

test('初始化失败时在原状态栏提示，不替换成另一套界面', async () => {
  vi.mocked(startShell).mockImplementationOnce(()=>{throw new Error('资源暂不可用');});
  render(<App />);
  await screen.findByText('资源暂不可用');
  expect(document.getElementById('app-shell')).toBeInTheDocument();
});
