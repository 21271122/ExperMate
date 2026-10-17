import { services } from './services';
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
  for (const key of ['ExperMateAccount', 'AgentClient', 'ChatUI', 'showAuthModal']) Reflect.deleteProperty(services, key);
});

test('服务端模式未登录时打开登录界面，不读取业务页面或启动 Agent', async () => {
  const start = vi.fn(), auth = vi.fn();
  Object.assign(services, { ExperMateAccount: { verifySession: async () => ({ valid: false }) }, showAuthModal: auth, AgentClient: { init() {}, start }, ChatUI: { init() {} } });
  const stop = startShell();
  await vi.waitFor(() => expect(auth).toHaveBeenCalledOnce());
  expect(runtime.navigate).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled(); stop();
});

test('深链接等待会话校验和失效 Cookie 清理完成后才加载页面', async () => {
  let verified!: () => void;
  const start = vi.fn();
  Object.assign(services, { ExperMateAccount: { verifySession: () => new Promise<void>(resolve => { verified = resolve; }) }, AgentClient: { init() {}, start }, ChatUI: { init() {} } });
  const stop = startShell();
  expect(runtime.navigate).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled();
  verified(); await vi.waitFor(() => expect(runtime.navigate).toHaveBeenCalledWith('/settings'));
  expect(start).toHaveBeenCalledOnce(); stop();
});

test('会话校验未结束就卸载时不启动页面或 Agent', async () => {
  let verified!: () => void;
  const start = vi.fn();
  Object.assign(services, { ExperMateAccount: { verifySession: () => new Promise<void>(resolve => { verified = resolve; }) }, AgentClient: { init() {}, start }, ChatUI: { init() {} } });
  const stop = startShell(); stop(); verified(); await Promise.resolve();
  expect(runtime.navigate).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled();
});
