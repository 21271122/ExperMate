import { afterEach, expect, test, vi } from 'vitest';
import { createCanvasEngine } from './canvas-engine';
import { createScope } from './scope';

afterEach(() => { vi.unstubAllGlobals(); });

test('独立引擎按模式绘制，隐藏暂停、恢复只启动一条帧循环，卸载移除输入和动画', () => {
  let id = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame));
  document.body.innerHTML = '<div id="container"><canvas></canvas><div id="note"><span id="nb-date"></span><div id="nb-body"></div></div><div id="hover"></div></div>';
  const canvas = document.querySelector('canvas')!, container = document.getElementById('container')!;
  const rect = { width: 640, height: 480, left: 0, top: 0 } as DOMRect;
  container.getBoundingClientRect = () => rect; canvas.getBoundingClientRect = () => rect;
  const context: Record<string, unknown> = { measureText: (text: string) => ({ width: text.length * 8 }) };
  const drawing = new Proxy(context, { get: (target, key: string) => target[key] ?? (target[key] = vi.fn()) });
  vi.spyOn(canvas, 'getContext').mockReturnValue(drawing as unknown as CanvasRenderingContext2D);
  let mode = 'free'; const onNavigate = vi.fn(), scope = createScope();
  const engine = createCanvasEngine(scope, { canvas, container, note: document.getElementById('note'), hover: document.getElementById('hover'), onNavigate, getMode: () => mode });
  const tick = () => { const batch = [...frames.values()]; frames.clear(); batch.forEach(callback => callback(1)); };
  engine.start(); tick();
  expect(canvas.width).toBe(640 * (window.devicePixelRatio || 1));
  rect.width = 800; engine.resize();
  expect(canvas.width).toBe(800 * (window.devicePixelRatio || 1));
  expect(document.getElementById('nb-body')).toHaveTextContent('自由对话');
  mode = 'record'; tick();
  expect(document.getElementById('nb-body')).toHaveTextContent('记录中');
  engine.updateStats({ total: 7, unfinished: 2 });
  expect(document.getElementById('nb-body')).toHaveTextContent('共 7 条');
  engine.setVisible(false); expect(frames.size).toBe(0);
  engine.setVisible(true); engine.setVisible(true); expect(frames.size).toBe(1);
  scope.dispose(); expect(frames.size).toBe(0);
  canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, clientY: 10 }));
  expect(canvas.style.cursor).toBe(''); expect(onNavigate).not.toHaveBeenCalled();
});
