import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { invoke } from '../../legacy/invoke';
import { ApiError, requestJson } from './api';
import { ArrayEdit, Editable, EditModal, EditorContext, Modes, TableEdit, TableView, type EditTarget } from './DetailEditor';
import { DetailAttachments } from './DetailAttachments';
import { ChildConversation } from './ChildConversation';
import { editableData, markdown, resultTable, tableFields, type ExperimentDetailData, type TableRow } from './detail-model';
import { statuses } from './model';

function StatusSlider({ value, save }: { value: string; save: (value: string) => void }) {
  const slider = useRef<HTMLDivElement>(null);
  const options = ['planned', 'running', 'done', 'failed', 'repeated'];
  useLayoutEffect(() => {
    const node = slider.current?.children[5 + options.indexOf(value)] as HTMLElement;
    node?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  }, []);
  useEffect(() => {
    const element = slider.current!; let timer: ReturnType<typeof setTimeout>;
    const loop = () => { clearTimeout(timer); timer = setTimeout(() => {
      const nodes = element.querySelectorAll<HTMLElement>('.status-option'), width = nodes[5].offsetLeft - nodes[0].offsetLeft;
      if (element.scrollLeft < width * 0.4) element.scrollLeft += width;
      else if (element.scrollLeft > width * 1.6) element.scrollLeft -= width;
    }, 120); };
    element.addEventListener('scroll', loop, { passive: true });
    return () => { clearTimeout(timer); element.removeEventListener('scroll', loop); };
  }, []);
  return <div ref={slider} className="status-slider" id="status-slider">{[...options, ...options, ...options].map((option, i) => <span key={i} className={`status-option${option === value ? ' selected' : ''}`} data-value={option}
    onClick={e => { save(option); e.currentTarget.scrollIntoView?.({ behavior: 'smooth', block: 'nearest', inline: 'center' }); }}>{option}</span>)}<input type="hidden" id="inl-status" value={value} /></div>;
}

export function ExperimentDetail({ expId }: { expId: string }) {
  const [exp, setExp] = useState<ExperimentDetailData | null>(null), [draft, setDraft] = useState<ExperimentDetailData | null>(null);
  const [editing, setEditing] = useState(false), [target, setTarget] = useState<EditTarget | null>(null), [pending, setPending] = useState(false), [attachmentBusy, setAttachmentBusy] = useState(false);
  const [child, setChild] = useState(false), [tag, setTag] = useState('');
  const [feedback, setFeedback] = useState<{ message: string; error?: boolean; conflict?: boolean } | null>(null);
  const [loadError, setLoadError] = useState('');
  const request = useRef(new AbortController()), saving = useRef(false), conflict = useRef(false);
  const load = useCallback(async () => {
    const body = await requestJson('/api/v1/experiments/' + encodeURIComponent(expId), { signal: request.current.signal });
    if (request.current.signal.aborted) return;
    setExp(body.data); setDraft(structuredClone(body.data)); setEditing(false); setTarget(null); conflict.current = false;
  }, [expId]);
  useEffect(() => {
    const controller = request.current;
    void load().catch(error => { if (!controller.signal.aborted) setLoadError(error.message); });
    return () => controller.abort();
  }, [load]);
  useLayoutEffect(() => {
    Object.assign(window, { ExperMateDetail: true, _isEditing: editing || child || pending || attachmentBusy });
    return () => { delete (window as unknown as { ExperMateDetail?: boolean }).ExperMateDetail; Object.assign(window, { _isEditing: false }); };
  }, [editing, child, pending, attachmentBusy]);
  useLayoutEffect(() => {
    if (!exp) return;
    document.body.dataset.childAgentKind = 'experiment'; document.body.dataset.expId = exp.id; document.body.dataset.expRevision = String(exp.revision || 0);
    delete document.body.dataset.analysisId;
    return () => { delete document.body.dataset.childAgentKind; delete document.body.dataset.expId; delete document.body.dataset.expRevision; };
  }, [exp?.id, exp?.revision]);
  useEffect(() => {
    if (!exp) return;
    // 数据异步到达后再恢复 details/滚动；不能让旧路由在空页面上恢复。
    const frame = requestAnimationFrame(() => {
      try {
        const state = JSON.parse(localStorage.getItem('exdiary_view_state') || '{}')['/experiments/' + expId];
        const mount = document.getElementById('fragment-mount'); if (!state || !mount) return;
        mount.querySelectorAll('details').forEach((node, index) => {
          const saved = state.details?.[index]; if (saved && node.querySelector('summary')?.textContent?.trim() === saved.key) node.open = saved.open;
        }); mount.scrollTop = state.scroll || 0;
      } catch { /* 没有可恢复状态 */ }
    });
    return () => cancelAnimationFrame(frame);
  }, [expId, !!exp]);
  useEffect(() => {
    if (!feedback || feedback.error) return;
    const timer = setTimeout(() => setFeedback(null), 4200); return () => clearTimeout(timer);
  }, [feedback]);
  function fail(error: unknown) {
    if (request.current.signal.aborted) return;
    const stale = error instanceof ApiError && error.status === 409;
    if (stale) conflict.current = true;
    setFeedback({ message: stale ? '内容已在另一窗口更新；本次修改未保存。' : (error as Error).message, error: true, conflict: stale });
  }
  async function action(work: () => Promise<void>) {
    if (saving.current || conflict.current) return;
    saving.current = true; setPending(true); setFeedback(null);
    try { await work(); } catch (error) { fail(error); }
    finally { saving.current = false; if (!request.current.signal.aborted) setPending(false); }
  }
  if (!exp || !draft) return <div className="flash" role={loadError ? 'alert' : 'status'}>{loadError || '加载中…'}</div>;
  const current = editing ? draft : exp;
  const dirty = JSON.stringify(editableData(draft)) !== JSON.stringify(editableData(exp));
  const busy = pending || attachmentBusy;
  const patch = (value: Partial<ExperimentDetailData>) => setDraft(old => old && ({ ...old, ...value }));
  const field = (name: string, label: string, type: EditTarget['type'] = 'text', block = false, style?: React.CSSProperties, className?: string) =>
    <Editable field={name} value={String((name === 'end_date' ? draft.end_date || draft.date : draft[name]) || '')} label={label} type={type} block={block} style={style} className={className} save={value => patch({ [name]: value })} />;
  const obs = typeof current.observations === 'object' ? current.observations : {};
  const draftObs = typeof draft.observations === 'object' ? draft.observations : {};
  const result = typeof current.results === 'object' ? current.results : {};
  const draftResult = typeof draft.results === 'object' ? draft.results : {};
  const table = (name: keyof typeof tableFields) => {
    const config = tableFields[name], rows = current[name] || [], editRows = draft[name] || [];
    return <details className="section-group" open={!!exp[name]?.length}><summary>{config.label}</summary><Modes view={<TableView rows={rows} {...config} />}
      edit={<TableEdit name={name} rows={editRows} {...config} save={value => patch({ [name]: value })} />} /></details>;
  };
  function save() {
    if (!dirty || !editing) return;
    void action(async () => {
      const response = await requestJson(`/experiments/${encodeURIComponent(expId)}/save-json`, { method: 'POST', signal: request.current.signal,
        body: JSON.stringify({ ...draft!, expected_revision: exp!.revision || 0 }) });
      await load(); setFeedback({ message: '已保存 · 修订 ' + response.revision });
    });
  }
  function archive() {
    void action(async () => {
      await requestJson(`/experiments/${encodeURIComponent(expId)}/${exp!.archived ? 'restore' : 'archive'}`, { method: 'POST', signal: request.current.signal, body: JSON.stringify({ expected_revision: exp!.revision || 0 }) });
      invoke('ExdiarySound.play', 'delete'); await load();
    });
  }
  function reloadLatest() {
    if (dirty && editing && !confirm('加载最新内容会放弃当前未保存的修改，是否继续？')) return;
    void load().then(() => setFeedback(null)).catch(fail);
  }
  const locked = (extra = false) => editing || busy || extra;
  return <EditorContext.Provider value={{ editing, open: setTarget }}><link rel="stylesheet" href="/static/css/experiment-detail.css" />
    <div id="experiment-save-feedback" className={`flash${feedback ? feedback.error ? ' flash-error' : ' flash-success' : ''}`} role="status" aria-live="polite" hidden={!feedback}>{feedback?.message}
      {feedback?.conflict && <button type="button" className="outline" style={{ marginLeft: '0.6rem' }} onClick={reloadLatest}>加载最新内容</button>}</div>
    <div className="experiment-detail-header"><div style={{ minWidth: 0 }}>
      <small style={{ fontWeight: 700, fontSize: '0.75rem', opacity: 0.5, letterSpacing: 1 }}>{exp.id}{exp.archived && <span className="archive-badge">已归档</span>}</small>
      <h1 style={{ margin: 0, borderBottom: 'none', paddingBottom: 0 }} id="field-title">{editing ? field('title', 'Title', 'text', false, { fontSize: 'inherit', fontWeight: 'inherit' }) : exp.title || '(untitled)'}</h1>
      <small className="experiment-detail-meta"><span id="field-date-range">{editing ? <>{field('date', 'Start Date', 'date')} ~ {field('end_date', 'End Date', 'date')}</> : <>{exp.date}{exp.end_date && ' ~ ' + exp.end_date}</>}</span>
        {' · '}<span id="field-experimenter">{editing ? field('experimenter', 'Experimenter') : exp.experimenter || '未填写'}</span>{' '}
        {(exp.tags?.length || editing) ? <span id="field-tags-container">{(current.tags || []).map((value, i) => <span key={i} className={`tag-pill${editing ? ' tag-jitter' : ''}`} style={editing ? { display: 'inline-flex', alignItems: 'center', gap: 4 } : undefined}>{value}
          {editing && <button type="button" style={{ fontSize: '0.65rem', padding: '0 2px', lineHeight: 1, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }} onClick={() => patch({ tags: draft.tags!.filter((_, index) => index !== i) })}>×</button>}</span>)}
          {editing && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, margin: '0.15em' }}><input id="new-tag-input" placeholder="New tag" style={{ width: 80, fontSize: '0.7em', padding: '0.15em 0.4em', border: '2px solid var(--black)' }} value={tag}
            onChange={e => setTag(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (tag.trim()) { patch({ tags: [...(draft.tags || []), tag.trim()] }); setTag(''); } } }} />
            <button type="button" style={{ fontSize: '0.65rem', padding: '0 4px', border: '2px solid var(--black)', background: 'var(--white)', cursor: 'pointer' }} onClick={() => { if (tag.trim()) { patch({ tags: [...(draft.tags || []), tag.trim()] }); setTag(''); } }}>+</button></span>}</span> : null}
      </small></div>
      <div className="experiment-detail-actions"><span className={editing ? '' : `status-badge status-${exp.status}`} id="field-status" data-value={current.status} style={editing ? { display: 'inline-block' } : undefined}>
        {editing ? <StatusSlider value={draft.status || 'planned'} save={status => patch({ status })} /> : statuses[exp.status || ''] || exp.status}</span>
        <button id="btn-child" data-edit-lock className={`outline experiment-detail-action${editing ? ' edit-locked' : ''}`} disabled={locked()} onClick={() => setChild(true)}>对话编辑</button>
        <button id="btn-edit" className="outline experiment-detail-action" style={editing ? { display: 'none' } : undefined} disabled={busy || conflict.current} onClick={() => { setDraft(structuredClone(exp)); setEditing(true); setFeedback(null); }}>编辑</button>
        <button id="btn-save" className="experiment-detail-action" style={editing ? undefined : { display: 'none' }} disabled={!dirty || busy || conflict.current} aria-disabled={!dirty || busy || conflict.current} onClick={save}>{pending ? 'Saving...' : '保存'}</button>
        <button id="btn-cancel" className="outline experiment-detail-action" style={editing ? undefined : { display: 'none' }} disabled={busy} onClick={() => { setDraft(structuredClone(exp)); setTarget(null); setEditing(false); }}>取消</button>
        <button id="btn-print" data-edit-lock className="outline experiment-detail-action" style={editing ? { display: 'none' } : undefined} disabled={locked()} onClick={() => invoke('openExperimentPrint', exp.id)}>PDF</button>
        <button id="btn-archive" data-edit-lock className={`outline experiment-detail-action archive-action${editing ? ' edit-locked' : ''}`} disabled={locked() || conflict.current} onClick={archive}>{exp.archived ? '恢复到实验列表' : '归档'}</button>
      </div></div>
    {exp.original_notes && <details className="section-group narrative-section" id="section-original-notes"><summary>0. 原始记录</summary><Modes
      view={exp.original_notes.includes('<') ? <div className="rich-notes" dangerouslySetInnerHTML={{ __html: exp.original_notes }} /> : <div className="markdown-content" style={{ background: 'var(--off-white)', padding: '1rem', border: '3px solid var(--black)' }} dangerouslySetInnerHTML={{ __html: markdown(exp.original_notes) }} />}
      edit={<>{field('original_notes', 'Original Notes', exp.original_notes.includes('<') ? 'html' : 'textarea', true, exp.original_notes.includes('<') ? undefined : { whiteSpace: 'pre-wrap', background: 'var(--off-white)', padding: '1rem', border: '3px solid var(--black)' }, exp.original_notes.includes('<') ? 'rich-notes' : '')}
        <button id="btn-regenerate" data-edit-lock className="edit-locked" disabled style={{ marginTop: '0.5rem' }}>Regenerate from Notes</button><span id="regen-status" style={{ marginLeft: '0.5rem', fontWeight: 700, opacity: 0.5 }} /></>} /></details>}
    {exp.purpose && <details className="section-group narrative-section" open><summary>1. 实验目的</summary><Modes view={<div className="markdown-content" dangerouslySetInnerHTML={{ __html: markdown(exp.purpose) }} />} edit={field('purpose', '1. 实验目的', 'markdown', true, undefined, 'markdown-content')} /></details>}
    {table('materials')}{table('equipment')}{table('experimental_plan')}
    <details className="section-group narrative-section" open><summary>5. 实验步骤</summary><Modes view={<ol id="sop-list">{(exp.sop || []).map((step, i) => <li key={i}>{step.replace(/^(\d+[\.\、\)]\s*|Step\s*\d+\s*[：:]\s*)+/i, '').trim()}</li>)}</ol>}
      edit={<ArrayEdit name="sop" items={draft.sop || []} save={sop => patch({ sop })} />} /></details>
    {table('process_parameters')}
    <details className="section-group narrative-section" open={typeof exp.observations !== 'string' && !obs?.no_anomalies}><summary>7. 实验观察</summary><Modes
      view={typeof exp.observations === 'string' ? <div className="markdown-content" dangerouslySetInnerHTML={{ __html: markdown(exp.observations) }} /> : <>{obs?.no_anomalies && <p style={{ fontWeight: 700 }}>未发现异常</p>}{!!obs?.items?.length && <ul>{obs.items.map((item, i) => <li key={i}>{item}</li>)}</ul>}</>}
      edit={<><label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}><input type="checkbox" id="edit-observations-no_anomalies" checked={!!draftObs?.no_anomalies} style={{ width: 'auto' }} onChange={e => patch({ observations: { ...draftObs, no_anomalies: e.target.checked } })} /> 未发现异常</label>
        <ArrayEdit name="observations_items" items={draftObs?.items || (typeof draft.observations === 'string' ? [draft.observations] : [])} save={items => patch({ observations: { ...draftObs, items } })} /></>} /></details>
    {table('characterization')}
    <details className="section-group" open><summary>9. 实验结果</summary><Modes view={typeof exp.results === 'string' ? <div className="markdown-content" dangerouslySetInnerHTML={{ __html: markdown(exp.results) }} /> : <>
      {result?.qualitative && <><h4>定性结果</h4><div className="markdown-content" dangerouslySetInnerHTML={{ __html: markdown(result.qualitative) }} /></>}{!!result?.key_data?.length && <><h4>关键数据</h4><TableView rows={result.key_data} {...resultTable} /></>}</>}
      edit={<><label style={{ fontWeight: 700, fontSize: '0.8rem' }}>定性结果</label><Editable block field="results_qualitative" className="markdown-content" label="定性结果" type="markdown" value={draftResult?.qualitative || (typeof draft.results === 'string' ? draft.results : '')} save={qualitative => patch({ results: { ...draftResult, qualitative } })} />
        <label style={{ fontWeight: 700, fontSize: '0.8rem', marginTop: '0.5rem' }}>关键数据</label><TableEdit name="results_key_data" rows={draftResult?.key_data || []} {...resultTable} save={(key_data: TableRow[]) => patch({ results: { ...draftResult, key_data } })} /></>} /></details>
    <details className="section-group" open><summary>10. 实验结论</summary><Modes view={<div className="markdown-content" dangerouslySetInnerHTML={{ __html: markdown(exp.conclusion || '') }} />} edit={field('conclusion', '实验结论', 'markdown', true, undefined, 'markdown-content')} /></details>
    <details className="section-group narrative-section" open><summary>11. 下一步计划</summary><Modes view={<div id="next-steps-view">{(exp.next_steps || []).map((step, i) => <div key={i} style={{ padding: '0.2rem 0' }}>{step.replace(/^\[[ xX]\]\s*/, '')}</div>)}</div>}
      edit={<ArrayEdit name="next_steps" items={draft.next_steps || []} save={next_steps => patch({ next_steps })} />} /></details>
    <DetailAttachments expId={exp.id} revision={exp.revision || 0} locked={editing || child || pending || conflict.current} onBusy={setAttachmentBusy} onConflict={error => { if (error instanceof ApiError && error.status === 409) fail(error); }}
      onChanged={async () => {
        try { await load(); } catch (error) {
          if (!request.current.signal.aborted) { conflict.current = true; setFeedback({ message: '附件已变更，但最新记录加载失败。请重新加载后继续编辑。', error: true, conflict: true }); }
          throw error;
        }
      }} />
    {!!(exp.references?.length || exp.referenced_by?.length || exp.analyzed_in?.length) && <div style={{ marginTop: '2rem', padding: '1rem', border: '4px solid var(--black)', background: 'var(--off-white)' }}><details className="section-group" open><summary>关联记录</summary>
      {(['references', 'referenced_by', 'analyzed_in'] as const).map((key, index) => !!exp[key]?.length && <div key={key} style={index < 2 ? { marginBottom: '0.8rem' } : undefined}><strong style={{ fontSize: '0.8rem' }}>{['引用的实验：', '被以下实验引用：', '已纳入分析：'][index]}</strong>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.3rem' }}>{exp[key]!.map(id => <a key={id} href={`${index === 2 ? '/analysis/' : '/experiments/'}${encodeURIComponent(id)}`} className="tag-pill"
          style={{ textDecoration: 'none', fontWeight: 700, ...(index === 0 ? { background: 'var(--black)', color: 'var(--white)' } : index === 2 ? { background: 'var(--yellow)', color: 'var(--black)' } : {}) }}>{id}</a>)}</div></div>)}</details></div>}
    <div data-edit-lock className={editing ? 'edit-locked' : undefined} inert={editing} style={{ textAlign: 'center', marginTop: '2rem' }}><a href="/" role="button" className="outline">← 返回首页</a></div>
    <EditModal target={target} close={() => setTarget(null)} />
    {child && <ChildConversation expId={exp.id} updated={() => { setChild(false); void load().catch(fail); }} />}
  </EditorContext.Provider>;
}
