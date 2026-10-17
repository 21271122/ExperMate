import { usePageData } from '../../app/usePageData';
import { services } from '../../runtime/services';
import { statuses, type Experiment } from './model';

export function Timeline() {
  const { data, error } = usePageData<Experiment[]>('/api/v1/timeline', '/timeline');
  const colors: Record<string, string> = { done: 'blue', planned: 'yellow', running: 'white', failed: 'red' };
  return <><h1 style={{ borderBottom: 'none', paddingBottom: 0, marginBottom: 0 }}>实验时间线</h1>
    <p style={{ fontWeight: 700, fontSize: '0.8rem', opacity: 0.5, letterSpacing: 1, marginTop: 0 }}>按日期查看实验记录</p>
    {error ? <div className="flash flash-error" role="alert">{error}</div> : !data ? <div role="status">加载中…</div> : data.length ? <div style={{ position: 'relative', padding: '1rem 0', marginLeft: '1rem' }}>
      <div style={{ position: 'absolute', left: 14, top: 0, bottom: 0, width: 8, background: 'var(--black)' }} />
      {data.map(exp => <div key={exp.id} style={{ position: 'relative', paddingLeft: 50, paddingBottom: '2rem', cursor: 'pointer', transition: 'transform 0.1s' }}
        onClick={() => services.PanelManager?.navigate('/experiments/' + encodeURIComponent(exp.id))} onMouseEnter={e => { e.currentTarget.style.transform = 'translateX(4px)'; }} onMouseLeave={e => { e.currentTarget.style.transform = ''; }}>
        <div style={{ position: 'absolute', left: 6, top: 6, width: 15.3, height: 12, border: '3px solid var(--black)', zIndex: 1, background: `var(--${colors[exp.status || ''] || 'off-white'})` }} />
        <div style={{ border: '4px solid var(--black)', background: 'var(--white)', padding: '0.8rem 1rem', boxShadow: '6px 6px 0px var(--shadow-color)', transition: 'box-shadow 0.15s' }}
          onMouseEnter={e => { e.currentTarget.style.boxShadow = '10px 10px 0px var(--shadow-color)'; }} onMouseLeave={e => { e.currentTarget.style.boxShadow = '6px 6px 0px var(--shadow-color)'; }}>
          <div style={{ fontWeight: 700, fontSize: '0.75rem', opacity: 0.5, letterSpacing: 1, marginBottom: '0.2rem' }}>{exp.date}</div>
          <div style={{ fontWeight: 700, fontSize: '0.78rem', marginBottom: '0.2rem' }}>{exp.id}</div>
          <div style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.4rem' }}>{exp.title || '未命名实验'}</div>
          <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}><span className={`status-badge status-${exp.status}`}>{statuses[exp.status || ''] || exp.status}</span>
            {(exp.tags || []).slice(0, 3).map(tag => <span className="tag-pill" key={tag}>{tag}</span>)}</div></div></div>)}</div>
      : <div className="empty-state"><h3>还没有实验记录</h3><p>创建第一条实验记录后，它会按日期显示在这里。</p><a href="/new" role="button" style={{ marginTop: '1rem' }}>+ 新建实验记录</a></div>}</>;
}
