import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type PrintRequest = { path: string; label: string };
export function PrintPreview({ request, close }: { request: PrintRequest; close: () => void }) {
  const [html, setHtml] = useState(''), [error, setError] = useState('');
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(request.path, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(response.status === 404 ? '未找到该记录' : '打印内容加载失败');
      const content = await response.text(); if (!controller.signal.aborted) setHtml(content);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); }; document.addEventListener('keydown', onKey);
    return () => { controller.abort(); document.removeEventListener('keydown', onKey); };
  }, [request]);
  return createPortal(<div id="exdiary-print-preview" style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', background: 'rgba(0,0,0,.58)' }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <section role="dialog" aria-modal="true" aria-label={request.label + '打印预览'} style={{ width: 'min(980px,100%)', height: 'min(92vh,980px)', display: 'flex', flexDirection: 'column', background: 'var(--white)', border: '4px solid var(--black)', boxShadow: '8px 8px 0 var(--black)' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.55rem .7rem', borderBottom: '3px solid var(--black)', background: 'var(--off-white)' }}><strong style={{ fontSize: '.85rem', letterSpacing: '.06em' }}>打印预览</strong>
        <span style={{ marginLeft: 'auto', fontSize: '.72rem', color: 'var(--text-2)' }}>在系统对话框中选择“另存为 PDF”</span>
        <button type="button" className="print-preview-action" data-print disabled={!html} style={{ minWidth: 44, minHeight: 36, border: '2px solid var(--black)', background: 'var(--yellow)', font: 'inherit', fontWeight: 900, cursor: 'pointer' }} onClick={() => { frame.current?.contentWindow?.focus(); frame.current?.contentWindow?.print(); }}>打印</button>
        <button type="button" className="print-preview-action" data-close aria-label="关闭打印预览" style={{ minWidth: 44, minHeight: 36, border: '2px solid var(--black)', background: 'var(--white)', font: 'inherit', fontWeight: 900, cursor: 'pointer' }} onClick={close}>关闭</button></header>
      {error ? <div className="flash flash-error" role="alert">无法打开打印预览：{error}</div> : <iframe ref={frame} srcDoc={html || undefined} title={request.label + '打印预览'} style={{ width: '100%', flex: 1, border: 0, background: 'white' }} />}
    </section></div>, document.body);
}
