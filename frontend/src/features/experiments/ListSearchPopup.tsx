import { createPortal } from 'react-dom';
import { statuses, type Filters } from './model';

export function ListSearchPopup({ filters, tags, change, close }: { filters: Filters; tags: string[]; change: (filters: Filters) => void; close: () => void }) {
  const patch = (value: Partial<Filters>) => change({ ...filters, ...value });
  return createPortal(<div id="shell-search-popup" style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div style={{ background: 'var(--white)', border: '4px solid var(--black)', boxShadow: 'var(--shadow)', padding: '1.2rem', width: 'min(420px,90vw)', maxHeight: '80vh', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}><span style={{ fontWeight: 700, fontSize: '0.9rem', letterSpacing: 1 }}>搜索与筛选</span>
        <button type="button" onClick={close} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.3rem', fontWeight: 700, lineHeight: 1, padding: 0, fontFamily: 'inherit' }}>×</button></div>
      <input type="search" id="shell-search-input" placeholder="搜索实验记录…" autoComplete="off" autoFocus style={{ width: '100%', marginBottom: '0.6rem', fontSize: '0.9rem', padding: '0.5rem 0.7rem', border: '3px solid var(--black)' }} value={filters.query} onChange={event => patch({ query: event.target.value })} />
      <div id="shell-status-filters" style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>{['', 'done', 'planned', 'running', 'failed', 'repeated'].map(status => <span key={status} className={`filter-chip${filters.status === status ? ' active' : ''}`} data-status={status} onClick={() => patch({ status })}>{statuses[status]}</span>)}</div>
      <details style={{ marginTop: '0.3rem' }}><summary style={{ fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer', letterSpacing: 1, opacity: 0.6 }}>高级筛选</summary>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem', marginTop: '0.5rem', padding: '0.6rem', border: '2px solid var(--black)', background: 'var(--off-white)' }}>
          <div><label style={{ fontSize: '0.72rem', fontWeight: 700, display: 'block', marginBottom: '0.2rem' }}>标签</label><div id="shell-tag-filters" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.2rem' }}>{tags.map(tag => <span key={tag} className={`filter-chip${filters.tags.includes(tag) ? ' active' : ''}`} data-tag={tag}
            onClick={() => patch({ tags: filters.tags.includes(tag) ? filters.tags.filter(value => value !== tag) : [...filters.tags, tag] })}>{tag}</span>)}</div></div>
          <div><label style={{ fontSize: '0.72rem', fontWeight: 700, display: 'block', marginBottom: '0.2rem' }}>日期范围</label><div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <input type="date" id="shell-date-from" style={{ width: 'auto', fontSize: '0.78rem' }} value={filters.dateFrom} onChange={event => patch({ dateFrom: event.target.value })} /><span style={{ fontWeight: 700 }}>~</span>
            <input type="date" id="shell-date-to" style={{ width: 'auto', fontSize: '0.78rem' }} value={filters.dateTo} onChange={event => patch({ dateTo: event.target.value })} /></div></div></div></details>
      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}><button type="button" className="outline" style={{ fontSize: '0.75rem', padding: '0.3rem 0.8rem' }} onClick={() => change({ query: '', status: '', tags: [], dateFrom: '', dateTo: '' })}>清除</button>
        <button type="button" style={{ fontSize: '0.75rem', padding: '0.3rem 0.8rem' }} onClick={close}>完成</button></div></div></div>, document.body);
}
