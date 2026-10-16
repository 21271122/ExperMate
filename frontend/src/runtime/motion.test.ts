import { afterEach, expect, test, vi } from 'vitest';
import { initializeMotion } from './motion';
import { createScope } from './scope';

afterEach(() => { vi.useRealTimers(); Reflect.deleteProperty(window, 'ExMotion'); });
test('快速导航提前揭幕后不会访问已清除的转场节点，卸载移除未结束的遮罩', async () => {
  vi.useFakeTimers(); const scope = createScope(); initializeMotion(scope);
  const motion = (window as unknown as { ExMotion: { begin: (path: string) => Promise<void>; reveal: () => Promise<void> } }).ExMotion;
  const entering = motion.begin('/experiments'), revealing = motion.reveal();
  await vi.advanceTimersByTimeAsync(400);
  await expect(entering).resolves.toBeUndefined(); await revealing;
  expect(document.querySelector('.exm-transition-block')).toBeNull();
  void motion.begin('/settings'); expect(document.querySelector('.exm-transition-block')).not.toBeNull();
  scope.dispose(); expect(document.querySelector('.exm-transition-block')).toBeNull();
});
