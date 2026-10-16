// Canvas、动效与声音需要原生事件/定时器；统一跟随 React 外壳的生命周期清理。
export function createScope() {
  const cleanup = [], timers = new Set(), frames = new Set();
  const controller = new AbortController();
  let disposed = false;
  return {
    listen(target, name, handler, options) {
      target.addEventListener(name, handler, options);
      cleanup.push(() => target.removeEventListener(name, handler, options));
    },
    timeout(callback, delay, ...args) {
      const id = setTimeout(() => { timers.delete(id); if (!disposed) callback(...args); }, delay);
      timers.add(id); return id;
    },
    clearTimeout(id) { timers.delete(id); clearTimeout(id); },
    frame(callback) {
      const id = requestAnimationFrame(time => { frames.delete(id); if (!disposed) callback(time); });
      frames.add(id); return id;
    },
    cancelFrame(id) { frames.delete(id); cancelAnimationFrame(id); },
    cleanup(callback) { cleanup.push(callback); },
    fetch(input, options = {}) { return fetch(input, { ...options, signal: options.signal || controller.signal }); },
    dispose() {
      disposed = true; cleanup.splice(0).reverse().forEach(callback => callback());
      controller.abort();
      timers.forEach(clearTimeout); frames.forEach(cancelAnimationFrame); timers.clear(); frames.clear();
    },
  };
}
