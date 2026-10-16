import { useCallback, useEffect, useRef, useState } from 'react';
import { requestJson } from '../features/experiments/api';

export function usePageData<T>(url: string, path: string) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState('');
  const controller = useRef(new AbortController());
  const reload = useCallback(async () => {
    const body = await requestJson(url, { signal: controller.current.signal });
    if (!controller.current.signal.aborted) { setData(body.data); setError(''); }
    return body;
  }, [url]);
  useEffect(() => {
    const current = controller.current;
    void reload().catch(reason => { if (!current.signal.aborted) setError(reason.message); });
    return () => current.abort();
  }, [reload]);
  useEffect(() => {
    if (!data) return;
    const frame = requestAnimationFrame(() => {
      try {
        const state = JSON.parse(localStorage.getItem('exdiary_view_state') || '{}')[path];
        const mount = document.getElementById('fragment-mount'); if (!state || !mount) return;
        mount.querySelectorAll('details').forEach((node, index) => {
          const saved = state.details?.[index]; if (saved && saved.key === node.querySelector('summary')?.textContent?.trim()) node.open = saved.open;
        }); mount.scrollTop = state.scroll || 0;
      } catch { /* 无可恢复状态 */ }
    });
    return () => cancelAnimationFrame(frame);
  }, [!!data, path]);
  return { data, error, setError, reload, signal: controller.current.signal };
}
