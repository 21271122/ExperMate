import { createScope } from './scope';
import { createPanelManager } from './panel';
import { initializeMotion } from './motion';
import { initializeTheme } from './theme';
import { initializeSound } from './sound';
import { services } from './services';

export function startShell() {
  const scope = createScope();
  initializeMotion(scope); initializeTheme(scope); initializeSound(scope);
  const panel = createPanelManager(scope);
  services.PanelManager = panel;
  panel.init(); services.ChatUI?.init();
  const ui = services.ChatUI;
  services.AgentClient?.init({
    onMessage: ui?.onMessage,
    onStreamStart: ui?.onStreamStart, onStreamChunk: ui?.onStreamChunk,
    onStreamEnd: ui?.onStreamEnd, onToolCard: ui?.onToolCard,
    onError: ui?.onError, onIdle: ui?.onIdle,
    onStateChange: (data: Record<string, unknown> | null) => {
      ui?.updateModeBadge(services.AgentClient?.getMode() || 'free');
      ui?.updateThreadColor(data);
    },
  });
  let dividerTimer: ReturnType<typeof setTimeout> | undefined;
  const stopDivider = () => { scope.clearTimeout(dividerTimer); dividerTimer = undefined; document.querySelectorAll<HTMLElement>('#color-divider span').forEach(span => { span.style.flexGrow = '1'; }); };
  const animate = () => {
    const values = Array.from({ length: 4 }, () => Math.random() * 70 + 8), total = values.reduce((a, b) => a + b, 0);
    document.querySelectorAll<HTMLElement>('#color-divider span').forEach((span, index) => { span.style.flexGrow = (values[index] / total * 10).toFixed(2); });
    dividerTimer = scope.timeout(animate, 800 + Math.random() * 600);
  };
  Object.assign(services, { startColorDivider: () => { if (!dividerTimer) animate(); }, stopColorDivider: stopDivider });
  let disposed = false;
  void Promise.resolve(services.ExperMateAccount?.verifySession()).then(session => {
    if (disposed) return;
    const path = panel.currentPath();
    if (session && session.valid === false) {
      if (path === '/login') panel.navigate(path); else services.showAuthModal?.();
      return;
    }
    if (path !== '/' && path !== '/ai-shell/' && path !== '/ai-shell') panel.navigate(path + location.search);
    return services.AgentClient?.start();
  }).then(ok => {
    if (!disposed && ok === false) services.ChatUI?.connectionFailed();
  }).catch(reason => { if (!disposed) services.ChatUI?.onError(reason.message); });
  return () => {
    disposed = true; stopDivider(); scope.dispose();
    for (const key of ['PanelManager', 'startColorDivider', 'stopColorDivider', 'ExMotion', 'ExdiaryTheme', 'ExdiarySound']) Reflect.deleteProperty(services, key);
  };
}
