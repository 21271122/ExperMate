import { useEffect, useRef, useState, type FormEvent } from 'react';
import { invoke } from '../../legacy/invoke';
import { requestJson } from './api';
import type { Attachment } from './detail-model';

const isImage = (item: Attachment) => item.mime?.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(item.name || '');
function typeLabel(item: Attachment) {
  const name = item.name?.toLowerCase() || '', mime = item.mime?.toLowerCase() || '';
  return isImage(item) ? '图片' : name.endsWith('.xlsx') || mime.includes('spreadsheetml') ? 'Excel 表格' : name.endsWith('.pdf') || mime === 'application/pdf' ? 'PDF 文档'
    : /\.(csv|tsv)$/.test(name) || mime === 'text/csv' ? '表格数据' : name.endsWith('.txt') || mime.startsWith('text/') ? '文本文件' : '附件';
}
const formatSize = (size: number) => size < 1024 ? size + ' B' : size < 1024 * 1024 ? (size / 1024).toFixed(1) + ' KB' : (size / 1024 / 1024).toFixed(1) + ' MB';
function AttachmentImage({ item }: { item: Attachment }) {
  const [src, setSrc] = useState(''), [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController(); let objectUrl = '';
    void fetch(item.url, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('图片读取失败');
      const blob = await response.blob(); if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob); setSrc(objectUrl);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [item.url]);
  return error ? <>{error}</> : <img src={src || undefined} alt={item.title || item.caption || item.name || '附件图片'}
    style={{ display: 'block', maxWidth: '100%', maxHeight: 340, objectFit: 'contain', border: '2px solid var(--black)', marginTop: '0.5rem', cursor: 'zoom-in' }}
    onClick={() => invoke('AttachmentViewer.open', item)} />;
}

export function DetailAttachments({ expId, revision, locked, onBusy, onConflict, onChanged }: {
  expId: string; revision: number; locked: boolean; onBusy: (busy: boolean) => void; onConflict: (error: unknown) => void; onChanged: () => Promise<void>;
}) {
  const [items, setItems] = useState<Attachment[]>([]), [files, setFiles] = useState<File[]>([]), [title, setTitle] = useState(''), [status, setStatus] = useState(''), [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null), controller = useRef(new AbortController()), pending = useRef(false), currentRevision = useRef(revision);
  useEffect(() => { currentRevision.current = revision; }, [revision]);
  const url = `/api/experiments/${encodeURIComponent(expId)}/attachments`;
  async function load() {
    const data = await requestJson(url, { signal: controller.current.signal });
    if (!controller.current.signal.aborted) setItems(data.attachments || []);
  }
  useEffect(() => {
    const request = controller.current;
    void load().catch(error => { if (!request.signal.aborted) setStatus(error.message); });
    return () => request.abort();
  }, [expId]);
  function updateRevision(value?: number) { if (value !== undefined) currentRevision.current = value; }
  async function operation(work: () => Promise<void>) {
    if (pending.current || locked) return;
    pending.current = true; setBusy(true); onBusy(true);
    const startingRevision = currentRevision.current;
    try { await work(); } catch (error) { if (!controller.current.signal.aborted) { setStatus((error as Error).message); onConflict(error); } }
    finally {
      // 保存接口接收完整记录；上传部分成功后也必须刷新附件引用，防止后续正文保存覆盖它。
      if (!controller.current.signal.aborted && currentRevision.current !== startingRevision) {
        try { await onChanged(); } catch (error) { if (!controller.current.signal.aborted) setStatus((error as Error).message); }
      }
      pending.current = false; if (!controller.current.signal.aborted) { setBusy(false); onBusy(false); }
    }
  }
  function upload(event: FormEvent) {
    event.preventDefault(); if (!files.length) { setStatus('请选择附件'); return; }
    void operation(async () => {
      let remaining = [...files];
      try {
        for (let index = 0; index < files.length; index++) {
          setStatus(`正在添加 ${index + 1}/${files.length}…`);
          const body = new FormData(); body.append('experiment_id', expId); body.append('file', files[index]);
          body.append('expected_revision', String(currentRevision.current)); if (title.trim()) body.append('title', title.trim());
          const result = await requestJson('/api/attachments', { method: 'POST', body, signal: controller.current.signal });
          updateRevision(result.revision); remaining = remaining.slice(1);
          if (!controller.current.signal.aborted) setFiles(remaining);
        }
        setTitle(''); if (input.current) input.current.value = ''; setStatus('附件已添加');
      } finally { if (!controller.current.signal.aborted) await load(); }
    });
  }
  function remove(item: Attachment) {
    if (!confirm('仅从当前实验移除此附件？附件文件不会立即删除。')) return;
    void operation(async () => {
      const result = await requestJson(`${url}/${encodeURIComponent(item.sha256)}?expected_revision=${currentRevision.current}`, { method: 'DELETE', signal: controller.current.signal });
      updateRevision(result.revision); invoke('ExdiarySound.play', 'delete'); await load();
    });
  }
  return <details className={`section-group${locked ? ' edit-locked' : ''}`} id="attachment-section" data-edit-lock aria-disabled={locked} inert={locked} open>
    <summary>12. 附件 <span id="attachment-count">{items.length}</span></summary>
    <div id="attachment-list" style={{ display: 'grid', gap: '0.45rem', margin: '0.7rem 0' }}>{!items.length ? <small style={{ opacity: 0.65 }}>还没有附件。</small> : items.map(item => <details key={item.sha256}
      style={{ border: '2px solid var(--black)', padding: '0.45rem 0.6rem', background: 'var(--off-white)' }} open={!!isImage(item)}>
      <summary style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, cursor: 'pointer' }}>
        <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{item.title || item.caption || item.name || item.sha256}</span>
        <span style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', flexShrink: 0 }}>{['下载', '移除'].map((label, i) => <button key={label} type="button" className={`outline${i ? ' danger' : ''}`}
          style={{ fontSize: '0.7rem', padding: '0.15rem 0.45rem' }} disabled={busy} onClick={event => {
            event.preventDefault(); event.stopPropagation(); if (i) remove(item); else void Promise.resolve(invoke('AttachmentViewer.download', item)).catch(error => setStatus(error.message));
          }}>{label}</button>)}</span></summary>
      <div style={{ display: 'flex', gap: '0.55rem', alignItems: 'center', flexWrap: 'wrap', paddingTop: '0.55rem' }}><div style={{ flex: 1, minWidth: 180 }}>
        <small style={{ display: 'block', opacity: 0.7 }}>{formatSize(item.size || 0)} · {typeLabel(item)} · {item.sync_state === 'synced' ? '已同步' : '待同步'}</small>
        {item.description && <small style={{ display: 'block', marginTop: '0.3rem' }}>{item.description}</small>}
        {isImage(item) ? <AttachmentImage item={item} /> : <button type="button" style={{ fontWeight: 700, color: 'var(--black)', padding: 0, border: 0, background: 'none', textDecoration: 'underline', cursor: 'pointer', marginTop: '0.35rem' }} onClick={() => invoke('AttachmentViewer.open', item)}>{item.name || item.sha256}</button>}
      </div></div></details>)}</div>
    <form id="attachment-upload-form" style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', flexWrap: 'wrap' }} onSubmit={upload}>
      <input ref={input} id="attachment-file" type="file" multiple disabled={busy} accept=".png,.jpg,.jpeg,.gif,.webp,.bmp,.pdf,.csv,.txt,.xlsx,image/*,application/pdf,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style={{ maxWidth: '100%' }}
        onChange={e => { setFiles(Array.from(e.target.files || [])); setStatus('点击“添加附件”开始上传'); }} />
      <small id="attachment-file-selection" style={{ fontWeight: 700, opacity: 0.65 }}>{files.length === 1 ? '已选择：' + files[0].name : files.length ? `已选择 ${files.length} 个附件` : '未选择附件'}</small>
      <input id="attachment-title" type="text" maxLength={200} placeholder="附件标题（默认文件名）" style={{ flex: 1, minWidth: 160 }} disabled={busy} value={title} onChange={e => setTitle(e.target.value)} />
      <button id="attachment-upload-btn" type="submit" className="outline" style={{ fontSize: '0.75rem' }} disabled={busy}>添加附件</button>
      <small id="attachment-status" style={{ fontWeight: 700, opacity: 0.65 }}>{status}</small></form>
    <small style={{ display: 'block', marginTop: '0.5rem', opacity: 0.65 }}>支持图片、PDF、CSV、TXT；单个文件最大 16 MB。附件会随实验加密同步。</small>
  </details>;
}
