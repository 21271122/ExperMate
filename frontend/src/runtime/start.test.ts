import { afterEach, expect, test, vi } from 'vitest';
import { startShell } from './start';

const runtime = vi.hoisted(() => ({ navigate: vi.fn(), dispose: vi.fn() }));
vi.mock('./panel', () => ({ createPanelManager: () => ({ init() {}, currentPath: () => '/settings', navigate: runtime.navigate }) }));
vi.mock('./scope', () => ({ createScope: () => ({ clearTimeout() {}, dispose: runtime.dispose }) }));
vi.mock('./motion', () => ({ initializeMotion() {} }));
vi.mock('./theme', () => ({ initializeTheme() {} }));
vi.mock('./sound', () => ({ initializeSound() {} }));

afterEach(() => {
  vi.clearAllMocks();
  for (const key of ['ExperMateAccount', 'AgentClient', 'ChatUI']) Reflect.deleteProperty(window, key);
});

test('深链接等待会话校验和失效 Cookie 清理完成后才加载页面', async () => {
  let verified!: () => void;
  const start = vi.fn();
  Object.assign(window, { ExperMateAccount: { verifySession: () => new Promise<void>(resolve => { verified = resolve; }) }, AgentClient: { init() {}, start }, ChatUI: { init() {} } });
  const stop = startShell();
  expect(runtime.navigate).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled();
  verified(); await vi.waitFor(() => expect(runtime.navigate).toHaveBeenCalledWith('/settings'));
  expect(start).toHaveBeenCalledOnce(); stop();
});

test('会话校验未结束就卸载时不启动页面或 Agent', async () => {
  let verified!: () => void;
  const start = vi.fn();
  Object.assign(window, { ExperMateAccount: { verifySession: () => new Promise<void>(resolve => { verified = resolve; }) }, AgentClient: { init() {}, start }, ChatUI: { init() {} } });
  const stop = startShell(); stop(); verified(); await Promise.resolve();
  expect(runtime.navigate).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled();
});
