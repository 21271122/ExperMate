import { useLayoutEffect, useRef, useState } from 'react';
import { usePageData } from '../../app/usePageData';
import { requestJson } from '../experiments/api';
import { ChildConversation } from '../experiments/ChildConversation';
import { markdown, type ExperimentDetailData, type Attachment } from '../experiments/detail-model';
import { invoke } from '../../legacy/invoke';

type Analysis = { id: string; timestamp?: string; question?: string; selected_ids?: string[]; analysis?: string;
  source_snapshot?: { generated_at?: string; records?: ExperimentDetailData[]; attachments?: Attachment[] } };

export function AnalysisList() {
  const { data, error, setError, reload, signal } = usePageData<Analysis[]>('/api/v1/analysis', '/analyze');
  const [busy, setBusy] = useState(''), deleting = useRef(false);
  async function remove(id: string) {
    if (deleting.current || !confirm('删除分析报告 ' + id + '？')) return;
    deleting.current = true; setBusy(id);
    try { await requestJson('/api/analysis-history/' + encodeURIComponent(id), { method: 'DELETE', signal }); invoke('ExdiarySound.play', 'delete'); await reload(); }
    catch (reason) { if (!signal.aborted) setError((reason as Error).message); }
    finally { deleting.current = false; if (!signal.aborted) setBusy(''); }
  }
  return <><link rel="stylesheet" href="/static/css/analyze.css" /><h1 style={{ borderBottom: 'none', paddingBottom: 0 }}>分析报告</h1>
    <p style={{ fontWeight: 700, fontSize: '0.85rem', opacity: 0.5, marginBottom: '1.5rem' }}>由 AI 协助完成的跨实验分析</p>
    {error && <div className="flash flash-error" role="alert">{error}</div>}
    <div id="analysis-list" style={data?.length === 0 ? { display: 'none' } : undefined}>{!data ? <div style={{ textAlign: 'center', padding: '1rem', opacity: 0.5 }}>正在加载…</div> : data.map(analysis =>
      <article className="analysis-card" key={analysis.id} onClick={() => invoke('PanelManager.navigate', '/analysis/' + encodeURIComponent(analysis.id))}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="analysis-id">{analysis.id}</span><span className="analysis-date">{analysis.timestamp}</span></div>
        <div className="analysis-question">{analysis.question || '完整分析'}</div>
        {!!analysis.selected_ids?.length && <div className="analysis-refs">{analysis.selected_ids.map((id, i) => <span key={id} style={{ display: 'contents' }}>
          {i > 0 && ' '}<a href={'/experiments/' + encodeURIComponent(id)} onClick={event => event.stopPropagation()}>{id}</a></span>)}</div>}
        <button type="button" className="outline danger" style={{ fontSize: '0.7rem', padding: '0.2rem 0.6rem' }} disabled={!!busy} onClick={event => { event.stopPropagation(); void remove(analysis.id); }}>删除</button></article>)}</div>
    <div id="empty-state" className="empty-state" style={data?.length === 0 ? undefined : { display: 'none' }}><h3>还没有分析报告</h3><p>在对话中告诉助手你想分析哪些实验记录。</p><a href="/new" role="button">前往对话</a></div></>;
}

export function AnalysisDetail({ id }: { id: string }) {
  const { data, error, setError, reload, signal } = usePageData<{ analysis: Analysis; stale_ids: string[] }>('/api/v1/analysis/' + encodeURIComponent(id), '/analysis/' + id);
  const [child, setChild] = useState(false), [busy, setBusy] = useState(false), pending = useRef(false);
  useLayoutEffect(() => {
    Object.assign(window, { _isEditing: child || busy });
    return () => { Object.assign(window, { _isEditing: false }); };
  }, [child, busy]);
  async function remove() {
    if (pending.current || !confirm('Delete ' + id + '?')) return;
    pending.current = true; setBusy(true);
    try { await requestJson('/api/analysis-history/' + encodeURIComponent(id), { method: 'DELETE', signal }); invoke('ExdiarySound.play', 'delete'); invoke('PanelManager.navigate', '/analyze'); }
    catch (reason) { if (!signal.aborted) setError((reason as Error).message); }
    finally { pending.current = false; if (!signal.aborted) setBusy(false); }
  }
  if (!data) return <div className="flash" role={error ? 'alert' : 'status'}>{error || '加载中…'}</div>;
  const analysis = data.analysis, snapshot = analysis.source_snapshot;
  return <><link rel="stylesheet" href="/static/css/analysis-detail.css" />
    <h1 style={{ borderBottom: 'none', paddingBottom: 0, marginBottom: '0.3rem' }}>{analysis.id}</h1>
    <div style={{ fontWeight: 700, fontSize: '0.75rem', opacity: 0.5, letterSpacing: 1, marginBottom: '1rem' }}>{analysis.timestamp}</div>
    <div style={{ border: '4px solid var(--black)', padding: '0.8rem 1rem', marginBottom: '1rem', background: 'var(--off-white)' }}><strong style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: 1 }}>Question</strong><p style={{ margin: '0.3rem 0 0 0', fontWeight: 600, fontSize: '0.9rem' }}>{analysis.question}</p></div>
    {!!analysis.selected_ids?.length && <div style={{ border: '4px solid var(--black)', padding: '0.8rem 1rem', marginBottom: '1rem' }}><strong style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: 1 }}>Referenced Experiments ({analysis.selected_ids.length})</strong>
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.3rem' }}>{analysis.selected_ids.map(id => <a key={id} href={'/experiments/' + encodeURIComponent(id)} className="tag-pill" style={{ textDecoration: 'none', fontWeight: 700 }}>{id}</a>)}</div></div>}
    {snapshot && Object.keys(snapshot).length > 0 && <div style={{ border: '3px solid var(--black)', padding: '0.65rem 0.8rem', marginBottom: '1rem', fontSize: '0.78rem', fontWeight: 700, lineHeight: 1.5, borderLeft: `8px solid var(--${data.stale_ids.length ? 'red' : 'blue'})` }}>
      证据快照：{snapshot.generated_at} · {snapshot.records?.length || 0} 条实验 · {snapshot.attachments?.length || 0} 个附件
      {!!data.stale_ids.length && <><br />其中 {data.stale_ids.join('、')} 已在报告生成后更新；本报告仍基于当时的快照。</>}</div>}
    {error && <div className="flash flash-error" role="alert">{error}</div>}
    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}><button type="button" className="outline" style={{ fontSize: '0.75rem' }} disabled={busy} onClick={() => setChild(true)}>分析对话</button>
      <button type="button" className="outline" style={{ fontSize: '0.75rem' }} onClick={() => invoke('openAnalysisPrint', id)}>打印</button><button type="button" className="outline danger" style={{ fontSize: '0.75rem' }} disabled={busy} onClick={() => void remove()}>删除</button></div>
    <hr style={{ border: '3px solid var(--black)' }} /><div className="markdown-content" style={{ lineHeight: 1.7, marginTop: '1rem' }} dangerouslySetInnerHTML={{ __html: markdown(analysis.analysis || '') }} />
    {child && <ChildConversation expId={id} kind="analysis" updated={() => { setChild(false); void reload().catch(reason => setError(reason.message)); }} />}</>;
}
