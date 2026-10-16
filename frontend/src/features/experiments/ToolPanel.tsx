import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function ToolPanel({ name, label, active, popup, close, children }: {
  name: string; label: string; active: boolean; popup: string; close: () => void; children: ReactNode;
}) {
  const floating = popup === name;
  const section = <section id={`panel-${name}`} className={`tool-panel${active || floating ? ' active' : ''}`} aria-label={label}
    style={floating ? { display: 'block' } : undefined}>{children}</section>;
  if (!floating) return section;
  // 原移动端把节点移出 React 根节点，事件委托会失效；Portal 保留原弹窗结构与事件归属。
  return createPortal(<div id="shell-panel-popup" style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    onClick={e => { if (e.target === e.currentTarget) close(); }}>
    <div style={{ background: 'var(--white)', border: '4px solid var(--black)', boxShadow: 'var(--shadow)', width: 'min(440px,92vw)', maxHeight: '80vh', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 1rem', background: 'var(--black)', color: 'var(--white)', fontWeight: 700, fontSize: '0.82rem', letterSpacing: 1, textTransform: 'uppercase' }}>
        {name === 'categories' ? 'Categories' : 'Filters'}<button type="button" style={{ background: 'none', border: 'none', color: 'var(--white)', cursor: 'pointer', fontSize: '1.2rem', fontWeight: 700, lineHeight: 1, padding: 0, fontFamily: 'inherit' }} onClick={close}>×</button>
      </div>{section}</div></div>, document.body);
}
