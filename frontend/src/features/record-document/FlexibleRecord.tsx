import { useEffect, useRef, useState } from 'react';
import { requestJson } from '../../shared/api';
import { services } from '../../runtime/services';
import { ChildConversation } from '../experiments/ChildConversation';
import { DetailAttachments } from '../experiments/DetailAttachments';
import { FieldView, RecordDocument } from './RecordDocument';
import { StructureProposal } from './StructureProposal';
import { RecordHistory } from './RecordHistory';
import { newId, type RecordValue, type StructureProposal as Proposal } from './model';

export function NewRecord() {
  const [error, setError] = useState('');
  const started = useRef(false);
  useEffect(() => { if (started.current) return; started.current = true;
    const draftId = new URLSearchParams(location.search).get('draft');
    if (draftId) { services.PanelManager?.navigate('/record-drafts/' + encodeURIComponent(draftId)); return; }
    void requestJson('/api/v1/record-drafts', { method: 'POST', body: '{}' }).then(body => services.PanelManager?.navigate('/record-drafts/' + body.data.id)).catch(reason => setError(reason.message));
  }, []);
  return <p role={error ? 'alert' : 'status'}>{error || '正在创建记录草稿…'}</p>;
}

export function DraftList() {
  const [drafts, setDrafts] = useState<RecordValue[]>([]), [error, setError] = useState('');
  useEffect(() => { const controller = new AbortController();
    void requestJson('/api/v1/record-drafts', { signal: controller.signal }).then(body => setDrafts(body.data)).catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, []);
  return <><h1>继续整理草稿</h1><a href="/new" role="button">新建记录</a>{error && <p role="alert">{error}</p>}{drafts.map(draft => <p key={draft.id}><a href={`/record-drafts/${draft.id}`}>{String(draft.metadata?.title || '未命名实验草稿')}</a> · 修订 {draft.revision}</p>)}{!drafts.length && !error && <p>当前没有未发布草稿。</p>}</>;
}

export function FlexibleRecord({ initial, draftId }: { initial?: RecordValue; draftId?: string }) {
  const [record, setRecord] = useState<RecordValue | null>(initial || null), [draft, setDraft] = useState<RecordValue | null>(initial || null);
  const [editing, setEditing] = useState(!!draftId), [busy, setBusy] = useState(false), [feedback, setFeedback] = useState(''), [child, setChild] = useState(false);
  const [proposals, setProposals] = useState<Proposal[]>([]), [history, setHistory] = useState(false);
  const controller = useRef(new AbortController()), mutation = useRef(false);
  const kind = draftId ? 'record-drafts' : 'experiments', id = draftId || initial!.id;
  const base = `/api/v1/${kind}/${encodeURIComponent(id)}`;
  async function reload() {
    const body = await requestJson(base, { signal: controller.current.signal });
    setRecord(body.data); setDraft(structuredClone(body.data)); setProposals(body.proposals || []);
  }
  useEffect(() => {
    void reload().catch(reason => { if (!controller.current.signal.aborted) setFeedback(reason.message); });
    const active = controller.current; return () => active.abort();
  }, [id]);
  useEffect(() => { services._isEditing = editing || busy || child; return () => { services._isEditing = false; }; }, [editing, busy, child]);
  async function action(work: () => Promise<void>) {
    if (mutation.current) return;
    mutation.current = true; setBusy(true); setFeedback('');
    try { await work(); } catch (reason) { setFeedback((reason as Error).message); }
    finally { mutation.current = false; setBusy(false); }
  }
  if (!record || !draft) return <p role={feedback ? 'alert' : 'status'}>{feedback || '加载中…'}</p>;
  const value = editing ? draft : record;
  const metadata = (value.metadata || value) as Record<string, unknown>;
  const setMeta = (key: string, text: string | string[]) => setDraft(old => old && (draftId ? { ...old, metadata: { ...old.metadata, [key]: text } } : { ...old, [key]: text }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(record);
  async function save() {
    await action(async () => {
      const meta = Object.fromEntries(['title', 'date', 'experimenter', 'status', 'tags'].filter(key => key in metadata).map(key => [key, metadata[key]]));
      const body = await requestJson(base + '/operations', { method: 'POST', body: JSON.stringify({ expected_revision: record!.revision, request_id: newId(), document: draft!.document, metadata: meta }) });
      setRecord(body.data); setDraft(structuredClone(body.data)); setProposals(body.proposals || []); setEditing(false); setFeedback('已保存 · 版本 ' + (body.data.content_revision ?? body.data.revision));
    });
  }
  return <div className={`flexible-record${editing ? ' record-is-editing' : ''}`}><div className={`record-controls record-toolbar${editing ? ' record-toolbar-editing' : ''}`}><small>{draftId ? `实验草稿 · 修订 ${record.revision}` : `${record.id} · 当前版本 ${record.content_revision ?? record.revision}`}</small>{editing && <span className="record-save-indicator">{busy ? '保存中…' : dirty ? '有未保存修改' : '正在编辑'}</span>}
    {record.published_id && <a href={`/experiments/${record.published_id}`}>已发布，打开实验记录</a>}
    {!editing && <button type="button" disabled={busy} onClick={() => { setFeedback(''); setHistory(false); setEditing(true); }}>编辑</button>}
    {editing && <><button type="button" disabled={busy || !dirty} onClick={() => void save()}>保存</button><button type="button" className="outline" disabled={busy} onClick={() => { setDraft(structuredClone(record)); setEditing(false); setFeedback(''); }}>取消编辑</button></>}
    {draftId ? <button type="button" disabled={busy || dirty || proposals.length > 0 || !!record.published_id} onClick={() => void action(async () => { const body = await requestJson(base + '/publish', { method: 'POST', body: JSON.stringify({ expected_revision: record.revision, request_id: 'publish-' + record.id }) }); services.PanelManager?.navigate('/experiments/' + body.data.id); })}>完成整理并保存记录</button>
      : !editing && <><button type="button" disabled={busy || editing} onClick={() => setChild(old => !old)}>对话编辑</button><button type="button" onClick={() => services.openExperimentPrint?.(id)}>PDF</button><button type="button" disabled={busy || editing} onClick={() => setHistory(old => !old)}>修改历史</button><button type="button" disabled={busy || editing} onClick={() => void action(async () => { await requestJson(`/experiments/${id}/${record.archived ? 'restore' : 'archive'}`, { method: 'POST', body: JSON.stringify({ expected_revision: record.revision }) }); await reload(); })}>{record.archived ? '恢复归档' : '归档'}</button></>}
  </div>
    {feedback && <div className="flash" role="status">{feedback}{dirty && '（未保存的编辑仍保留在页面中）'}<button type="button" disabled={busy} onClick={() => { if (!dirty || confirm('加载最新内容将放弃当前未保存的编辑，是否继续？')) void action(async () => { await reload(); setEditing(false); }); }}>加载最新内容</button></div>}
    {history && !draftId && <RecordHistory current={record} locked={busy || editing || child} close={() => setHistory(false)} switchVersion={version => action(async () => {
      await requestJson(base + '/restore', { method: 'POST', body: JSON.stringify({ revision: version, expected_revision: record.revision, request_id: newId() }) });
      await reload(); setFeedback('已切换到版本 ' + version + '，历史版本已保留。');
    })} />}
    <div className="record-edit-content" hidden={history} inert={busy} aria-busy={busy}>
      {editing ? <section className="record-meta-editor" aria-label="基本信息"><h2>基本信息</h2><div className="record-meta-grid">
        <label className="record-label record-meta-wide">标题<input type="text" value={String(metadata.title || '')} onChange={e => setMeta('title', e.target.value)} /></label>
        <label className="record-label">日期<input type="date" value={String(metadata.date || '')} onChange={e => setMeta('date', e.target.value)} /></label>
        <label className="record-label">实验者<input type="text" value={String(metadata.experimenter || '')} onChange={e => setMeta('experimenter', e.target.value)} /></label>
        <label className="record-label">状态<select value={String(metadata.status || 'running')} onChange={e => setMeta('status', e.target.value)}>{Object.entries({ running: '进行中', done: '已完成', failed: '失败', repeated: '复刻', planned: '计划中' }).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="record-label">标签（逗号分隔）<input type="text" value={(metadata.tags as string[] || []).join(', ')} onChange={e => setMeta('tags', e.target.value.split(/[,，]/).map(s => s.trim()).filter(Boolean))} /></label>
      </div></section>
        : <header className="record-heading"><h1>{String(metadata.title || '未命名实验')}</h1><p>{String(metadata.date || '日期未注明')} · {String(metadata.experimenter || '作者未注明')}</p></header>}
      {record.original_notes && <details><summary>原始记录</summary><FieldView field={{ id: 'original', label: '原始记录', kind: 'text', presentation: 'text', content: { text: record.original_notes } }} /></details>}
      <RecordDocument value={value.document} change={editing ? document => setDraft(old => old && ({ ...old, document })) : undefined} />
    </div>
    {!editing && !history && proposals.map(proposal => <StructureProposal key={proposal.id} id={proposal.id} updated={() => void reload()} />)}

    {editing && !draftId && <p className="record-note">保存或取消编辑后，可继续管理实验附件。</p>}
    {!draftId && <div hidden={editing || history}><DetailAttachments label="附件" expId={id} revision={record.revision} locked={editing || busy || child} onChanged={reload} onConflict={reason => setFeedback((reason as Error).message)} onBusy={setBusy} /></div>}
    {child && <ChildConversation expId={id} updated={() => { setChild(false); void reload(); }} />}
  </div>;
}
