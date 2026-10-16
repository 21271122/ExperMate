import { createScope } from './scope';
import { createPanelManager } from './panel';
import { initializeMotion } from './motion';
import { initializeTheme } from './theme';
import { initializeSound } from './sound';
import { invoke } from '../legacy/invoke';

export function startShell() {
  const scope = createScope();
  initializeMotion(scope); initializeTheme(scope); initializeSound(scope);
  const panel = createPanelManager(scope);
  Object.assign(window, { PanelManager: panel, navigateToPage: panel.navigate });
  panel.init(); invoke('ChatUI.init');
  invoke('AgentClient.init', {
    onMessage: (data: unknown) => invoke('ChatUI.onMessage', data),
    onStreamStart: () => invoke('ChatUI.onStreamStart'), onStreamChunk: (data: unknown) => invoke('ChatUI.onStreamChunk', data),
    onStreamEnd: (data: unknown) => invoke('ChatUI.onStreamEnd', data), onToolCard: (data: unknown) => invoke('ChatUI.onToolCard', data),
    onError: (data: unknown) => invoke('ChatUI.onError', data), onIdle: () => invoke('ChatUI.onIdle'),
    onStateChange: (data: unknown) => { invoke('ChatUI.updateModeBadge', invoke('AgentClient.getMode')); invoke('ChatUI.updateThreadColor', data); },
  });
  let dividerTimer: ReturnType<typeof setTimeout> | undefined;
  const stopDivider = () => { scope.clearTimeout(dividerTimer); dividerTimer = undefined; document.querySelectorAll<HTMLElement>('#color-divider span').forEach(span => { span.style.flexGrow = '1'; }); };
  const animate = () => {
    const values = Array.from({ length: 4 }, () => Math.random() * 70 + 8), total = values.reduce((a, b) => a + b, 0);
    document.querySelectorAll<HTMLElement>('#color-divider span').forEach((span, index) => { span.style.flexGrow = (values[index] / total * 10).toFixed(2); });
    dividerTimer = scope.timeout(animate, 800 + Math.random() * 600);
  };
  Object.assign(window, { startColorDivider: () => { if (!dividerTimer) animate(); }, stopColorDivider: stopDivider });
  let disposed = false;
  void Promise.resolve(invoke('ExperMateAccount.verifySession')).then(() => {
    if (disposed) return;
    const path = panel.currentPath();
    if (path !== '/' && path !== '/ai-shell/' && path !== '/ai-shell') panel.navigate(path + location.search);
    return invoke('AgentClient.start');
  }).then(ok => {
    if (!disposed && !ok) invoke('ChatUI.connectionFailed');
  }).catch(reason => { if (!disposed) invoke('ChatUI.onError', reason.message); });
  return () => {
    disposed = true; stopDivider(); scope.dispose();
    for (const key of ['PanelManager', 'navigateToPage', 'startColorDivider', 'stopColorDivider', 'ExMotion', 'ExdiaryTheme', 'ExdiarySound']) Reflect.deleteProperty(window, key);
  };
}
