import { usePageData } from '../../app/usePageData';
import { invoke } from '../../legacy/invoke';

export function TemplateLibrary() {
  const { data, error } = usePageData<{ id: string; title: string; category: string; description: string; tags?: string[] }[]>('/api/v1/templates', '/templates');
  return <><h1 style={{ borderBottom: 'none', paddingBottom: 0 }}>Template Library</h1>
    <p style={{ fontWeight: 700, fontSize: '0.8rem', opacity: 0.5, letterSpacing: 1, textTransform: 'uppercase' }}>Select a template to get started quickly</p>
    {error ? <div className="flash flash-error" role="alert">{error}</div> : !data ? <div role="status">加载中…</div> : data.length ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: '1rem', marginTop: '1.5rem' }}>
      {data.map(template => <article key={template.id} className="card" style={{ display: 'flex', flexDirection: 'column', marginBottom: 0 }} onClick={() => invoke('PanelManager.navigate', '/new?template=' + encodeURIComponent(template.id))}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.5rem' }}><strong style={{ fontSize: '0.95rem', textTransform: 'uppercase', letterSpacing: 1 }}>{template.title}</strong><span className="tag-pill" style={{ whiteSpace: 'nowrap' }}>{template.category}</span></div>
        <p style={{ fontSize: '0.8rem', opacity: 0.6, flex: 1, margin: '0 0 0.5rem 0', fontWeight: 500 }}>{template.description}</p>
        {!!template.tags?.length && <div style={{ marginTop: 'auto' }}>{template.tags.map((tag, i) => <span key={i} className="tag-pill" style={{ fontSize: '0.65rem' }}>{tag}</span>)}</div>}</article>)}</div>
      : <div className="empty-state"><h3>No Templates Available</h3><p>Built-in templates are created automatically on first launch.</p></div>}
    <div style={{ textAlign: 'center', marginTop: '2rem' }}><a href="/new" role="button" className="outline">Skip Templates, Free Writing</a></div></>;
}
