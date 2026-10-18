import { useEffect, useRef, useState } from 'react';
import { requestJson } from '../../shared/api';
import type { RecordField } from './model';

type Assets = Extract<RecordField, { kind: 'assets' }>;
export function AssetsEditor({ field, change }: { field: Assets; change: (field: Assets) => void }) {
  const [files, setFiles] = useState<{ sha256: string; name: string; mime: string }[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const controller = useRef(new AbortController());
  const current = useRef(field); current.current = field;
  useEffect(() => { const active = controller.current;
    void requestJson('/api/v1/record-attachments', { signal: active.signal }).then(body => setFiles(body.data)).catch(reason => { if (!active.signal.aborted) setError(reason.message); });
    return () => active.abort();
  }, []);
  const add = (sha256: string, caption: string) => { const field = current.current; if (sha256 && !field.content.items.some(item => item.sha256 === sha256)) change({ ...field, content: { items: [...field.content.items, { sha256, caption }] } }); };
  return <div>{error && <p role="alert">{error}</p>}
    <select aria-label="选择已上传附件" value="" onChange={event => { const file = files.find(item => item.sha256 === event.target.value); if (file) add(file.sha256, file.name); }}><option value="">选择已上传附件…</option>{files.map(file => <option key={file.sha256} value={file.sha256}>{file.name || '未命名附件'}</option>)}</select>
    <label className="record-label">或上传附件<input type="file" disabled={busy} onChange={event => {
      const file = event.target.files?.[0]; if (!file || busy) return;
      setBusy(true); setError(''); const form = new FormData(); form.append('file', file);
      void requestJson('/api/agent/attachments', { method: 'POST', body: form, signal: controller.current.signal }).then(body => {
        const item = body.attachment; setFiles(old => [item, ...old.filter(f => f.sha256 !== item.sha256)]); add(item.sha256, item.name);
      }).catch(reason => { if (!controller.current.signal.aborted) setError(reason.message); }).finally(() => { if (!controller.current.signal.aborted) setBusy(false); });
      event.target.value = '';
    }} /></label>
    {field.content.items.map(item => <div className="record-controls" key={item.sha256}><a href={`/api/v1/attachments/${item.sha256}`} download>{files.find(file => file.sha256 === item.sha256)?.name || '已引用附件'}</a><input aria-label="附件说明" value={item.caption} onChange={e => change({ ...field, content: { items: field.content.items.map(old => old.sha256 === item.sha256 ? { ...old, caption: e.target.value } : old) } })} /><button type="button" onClick={() => change({ ...field, content: { items: field.content.items.filter(old => old.sha256 !== item.sha256) } })}>移除引用</button></div>)}
  </div>;
}
