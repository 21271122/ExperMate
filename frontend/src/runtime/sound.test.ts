import { afterEach, expect, test, vi } from 'vitest';
import { initializeSound } from './sound';
import { createScope } from './scope';
import { services } from './services';

afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear();
  Reflect.deleteProperty(services, 'ExdiarySound');
});

test('音频淡入首帧时间早于起点时，音量仍在有效范围内', async () => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback); return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(performance, 'now').mockReturnValue(100);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ ok: false }) }));
  const volumes: number[] = [];
  class TestAudio extends EventTarget {
    paused = true; ended = false; readyState = 3; currentTime = 0;
    src = ''; preload = ''; private level = 0;
    get volume() { return this.level; }
    set volume(value: number) {
      if (value < 0 || value > 1) throw new RangeError('Invalid volume');
      this.level = value; volumes.push(value);
    }
    load() {}
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
  }
  vi.stubGlobal('Audio', TestAudio);
  const scope = createScope();
  try {
    const sound = initializeSound(scope);
    sound.update({ bgm: true });
    await Promise.resolve();
    const step = frames.values().next().value!;
    expect(() => step(99)).not.toThrow();
    expect(volumes.at(-1)).toBe(0);
  } finally { scope.dispose(); }
});
