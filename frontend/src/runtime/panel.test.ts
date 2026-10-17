import { services } from './services';
import { afterEach, expect, test, vi } from 'vitest';
import { createPanelManager } from './panel';
import { createScope } from './scope';

afterEach(() => {
  Reflect.deleteProperty(services, 'ExMotion'); Reflect.deleteProperty(services, 'ExperMatePages');
  window.history.replaceState(null, '', '/');
});

test('快速切换时忽略旧转场，卸载和返回首页后不再挂载迟到的页面', async () => {
  const transitions: (() => void)[] = [], canRender = vi.fn(() => false);
  Object.assign(services, { ExMotion: { begin: () => new Promise<void>(resolve => transitions.push(resolve)), reveal: vi.fn() }, ExperMatePages: { canRender, clear: vi.fn() } });
  const scope = createScope(), panel = createPanelManager(scope);
  panel.navigate('/timeline'); panel.navigate('/settings');
  transitions.shift()!(); await Promise.resolve(); expect(canRender).not.toHaveBeenCalled();
  transitions.shift()!(); await Promise.resolve(); expect(canRender).toHaveBeenCalledExactlyOnceWith('/settings');
  canRender.mockClear(); panel.navigate('/analyze'); panel.reset();
  transitions.shift()!(); await Promise.resolve(); expect(canRender).not.toHaveBeenCalled();
  panel.navigate('/experiments'); scope.dispose();
  transitions.shift()!(); await Promise.resolve(); expect(canRender).not.toHaveBeenCalled();
});
