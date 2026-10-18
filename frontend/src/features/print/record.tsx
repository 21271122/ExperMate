import { createRoot } from 'react-dom/client';
import { FieldView, RecordDocument } from '../record-document/RecordDocument';
import type { RecordValue } from '../record-document/model';
import './experiment.css';

const node = document.getElementById('record-print-root');
const payload = document.getElementById('record-print-data');
if (node && payload) {
  const record: RecordValue = JSON.parse(payload.textContent || '{}');
  createRoot(node).render(<div className="print-wrapper">
    <div className="print-guide no-print">点击打印，在系统对话框中选择“另存为 PDF”。</div>
    <button className="print-btn no-print" onClick={() => window.print()}>打开打印对话框</button>
    <h1>{record.title || '未命名实验'}</h1><p className="meta">{record.id} · {record.date || '日期未注明'} · {record.experimenter || '作者未注明'}</p>
    <RecordDocument value={record.document} />
    {record.original_notes && <section><h2>附录：原始记录</h2><FieldView field={{ id: 'original', label: '原始记录', kind: 'text', presentation: 'text', content: { text: record.original_notes } }} /></section>}
  </div>);
}
