import { useEffect, useRef, useState } from 'react';
import { requestJson } from '../../shared/api';
import { FieldView, RecordDocument } from './RecordDocument';
import type { RecordValue } from './model';

type Version = { revision: number; title: string; updated_at: string; date: string; summary: string; is_current: boolean };
type Snapshot = RecordValue & { attachments?: { sha256: string; title?: string; name?: string }[] };

function versionTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

export function RecordHistory({ current, locked, close, switchVersion }: { current: RecordValue; locked: boolean; close: () => void; switchVersion: (revision: number) => Promise<void> }) {
  const [versions, setVersions] = useState<Version[]>([]), [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true), [previewing, setPreviewing] = useState(false), [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const selection = useRef<AbortController | null>(null);
  const base = `/api/v1/experiments/${encodeURIComponent(current.id)}`;
  useEffect(() => {
    const controller = new AbortController(); selection.current?.abort(); setSnapshot(old => old?.id === current.id ? old : null); setConfirming(false); setPreviewing(false); setLoading(true); setError('');
    void requestJson(base + '/revisions', { signal: controller.signal }).then(body => setVersions(body.data)).catch(reason => { if (!controller.signal.aborted) setError(reason.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); selection.current?.abort(); };
  }, [current.id, current.revision]);
  async function preview(revision: number) {
    selection.current?.abort(); const controller = new AbortController(); selection.current = controller;
    setSnapshot(null); setConfirming(false); setError(''); setPreviewing(true);
    try { const body = await requestJson(base + '/revisions/' + revision, { signal: controller.signal }); if (!controller.signal.aborted) setSnapshot(body.data); }
    catch (reason) { if (!controller.signal.aborted) setError((reason as Error).message); }
    finally { if (!controller.signal.aborted) setPreviewing(false); }
  }
  const currentVersion = current.content_revision ?? current.revision;
  return <section className="record-history" aria-label="版本历史"><header><h2>版本历史</h2><button type="button" className="outline" onClick={close}>关闭历史</button></header>
    <p className="record-note">当前版本 {currentVersion}。先查看内容，再选择设为当前版本；切换保留全部历史，不生成重复版本。</p>
    {error && <p role="alert">{error}</p>}{loading && <p role="status">正在加载历史…</p>}
    {!loading && !versions.length && !error && <p>暂无可查看的历史版本。</p>}
    <div className="record-version-list">{versions.map(version => <article key={version.revision} className="record-version-item"><div><strong>版本 {version.revision}</strong>{version.is_current && <span className="record-version-current">当前</span>}<span className="record-note">{versionTime(version.updated_at || version.date || '') || '时间未记录'}</span><p>{version.title || '未命名实验'}</p>{version.summary && <p className="record-note">{version.summary}</p>}</div><button type="button" className="outline" disabled={locked || previewing} onClick={() => void preview(version.revision)}>查看版本 {version.revision}</button></article>)}</div>
    {previewing && <p role="status">正在读取版本内容…</p>}
    {snapshot && <section className="record-version-preview" aria-label={`版本 ${snapshot.revision} 内容预览`}><header><h3>版本 {snapshot.revision} · 只读预览</h3><button type="button" disabled={locked || confirming || snapshot.revision === currentVersion} onClick={() => setConfirming(true)}>{snapshot.revision === currentVersion ? '当前版本' : '设为当前版本'}</button></header>
      {confirming && <div className="record-version-confirm" role="group" aria-label="确认版本切换"><p>将版本 {snapshot.revision} 设为当前版本？后续历史会保留，不会创建重复版本。</p><div className="record-controls"><button type="button" disabled={locked} onClick={() => { setConfirming(false); void switchVersion(snapshot.revision); }}>确认切换</button><button type="button" className="outline" disabled={locked} onClick={() => setConfirming(false)}>取消切换</button></div></div>}
      <h4>{snapshot.title || '未命名实验'}</h4><p className="record-note">{snapshot.date || '日期未注明'} · {snapshot.experimenter || '作者未注明'} · 状态：{({ running: '进行中', done: '已完成', failed: '失败', repeated: '复刻', planned: '计划中' } as Record<string, string>)[snapshot.status || ''] || snapshot.status || '未注明'}</p>
      <RecordDocument value={snapshot.document} />
      {snapshot.original_notes && <details><summary>原始记录</summary><FieldView field={{ id: 'original', label: '原始记录', kind: 'text', presentation: 'text', content: { text: snapshot.original_notes } }} /></details>}
      {!!snapshot.attachments?.length && <div><h4>该版本的附件</h4>{snapshot.attachments.map(item => <p key={item.sha256}><a href={`/api/v1/attachments/${encodeURIComponent(item.sha256)}`} download>{item.title || item.name || item.sha256}</a></p>)}</div>}
    </section>}
  </section>;
}
