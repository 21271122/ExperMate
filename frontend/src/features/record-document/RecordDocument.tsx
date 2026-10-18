import katex from 'katex';
import DOMPurify from 'dompurify';
import 'katex/dist/katex.min.css';
import { markdown } from '../../shared/markdown';
import type { RecordDocument as DocumentData, RecordField, TableData } from './model';
import { fieldLabels, newField, newId, sectionLabels } from './model';
import { ProcessEditor, ProcessView } from './ProcessField';
import { AssetsEditor } from './AssetsEditor';
import { FormulaView } from './FormulaView';
import './record-document.css';

export function FieldView({ field }: { field: RecordField }) {
  switch (field.kind) {
    case 'text': return <div className="markdown-content" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(markdown(field.content.text), { USE_PROFILES: { html: true } }) }} />;
    case 'table': return field.presentation === 'cards' ? <div className="record-card-grid">{field.content.rows.map(row => <dl key={row.id}>{field.content.columns.map(column => <div key={column.id}><dt>{column.label}</dt><dd>{row.cells[column.id] || ''}</dd></div>)}</dl>)}</div> : <div className={`record-table-scroll${field.content.columns.length > 4 ? ' record-table-stacked' : ''}`}><table className="record-table"><thead><tr>{field.content.columns.map(column => <th key={column.id}>{column.label}</th>)}</tr></thead><tbody>{field.content.rows.map(row => <tr key={row.id}>{field.content.columns.map(column => <td key={column.id} data-label={column.label}>{row.cells[column.id] || ''}</td>)}</tr>)}</tbody></table></div>;
    case 'process': return field.presentation === 'flow' ? <ProcessView data={field.content} /> : <ol>{field.content.actions.map(action => <li key={action.id}>{action.source_ids.map(id => field.content.nodes.find(node => node.id === id)?.label).join('、')} → {action.label} {action.repeat_note} {action.parameters.map(p => `${p.label} ${p.value}${p.unit || ''}`).join('，')} → {action.target_ids.map(id => field.content.nodes.find(node => node.id === id)?.label).join('、')}</li>)}</ol>;
    case 'formula': return <><FormulaView html={katex.renderToString(field.content.latex, { throwOnError: false, trust: false, displayMode: true, maxExpand: 200, maxSize: 20 })} />{(['explanation', 'substitution', 'result'] as const).map(key => field.content[key] && <p key={key} style={{ whiteSpace: 'pre-wrap' }}>{field.content[key]}</p>)}</>;
    case 'assets': return <div className="record-assets">{field.content.items.map(item => <figure key={item.sha256}>{field.presentation === 'gallery' && <img alt={item.caption || '实验附件'} src={`/api/attachments/${encodeURIComponent(item.sha256)}`} loading="lazy" />}<figcaption><a href={`/api/v1/attachments/${encodeURIComponent(item.sha256)}`} download>{item.caption || item.sha256.slice(0, 12)}</a></figcaption></figure>)}</div>;
  }
}

function TableEditor({ data, change }: { data: TableData; change: (value: TableData) => void }) {
  return <><div className={`record-table-scroll record-table-editor${data.columns.length > 4 ? ' record-table-stacked' : ''}`}><table className="record-table"><colgroup>{data.columns.map(column => <col key={column.id} />)}<col className="record-row-action-column" /></colgroup><thead><tr>{data.columns.map(column => <th key={column.id}>{column.label}</th>)}<th><span className="record-note">操作</span></th></tr></thead><tbody>{data.rows.map((row, index) => <tr key={row.id}>{data.columns.map(column => <td key={column.id} data-label={column.label}><textarea rows={1} aria-label={column.label} value={row.cells[column.id] || ''} onChange={e => change({ ...data, rows: data.rows.map(r => r.id === row.id ? { ...r, cells: { ...r.cells, [column.id]: e.target.value } } : r) })} /></td>)}<td><button type="button" className="record-remove-row" aria-label={`删除第 ${index + 1} 行`} onClick={() => change({ ...data, rows: data.rows.filter(r => r.id !== row.id) })}>移除</button></td></tr>)}</tbody></table></div>
    <div className="record-controls"><button type="button" aria-label="添加行" onClick={() => change({ ...data, rows: [...data.rows, { id: newId(), cells: {} }] })}>＋ 添加行</button></div>
    </>;
}

function TableColumns({ data, change }: { data: TableData; change: (value: TableData) => void }) {
  return <div className="record-table-columns"><h4>表格列</h4>{data.columns.map(column => <div className="record-column-editor" key={column.id}><label className="record-label">列名<input aria-label="列名" value={column.label} onChange={e => change({ ...data, columns: data.columns.map(c => c.id === column.id ? { ...c, label: e.target.value } : c) })} /></label><button type="button" onClick={() => change({ columns: data.columns.filter(c => c.id !== column.id), rows: data.rows.map(row => ({ ...row, cells: Object.fromEntries(Object.entries(row.cells).filter(([id]) => id !== column.id)) })) })}>删除列</button></div>)}<button type="button" onClick={() => change({ ...data, columns: [...data.columns, { id: newId(), label: '新列', type: 'text' }] })}>添加列</button></div>;
}

function FieldEditor({ field, change }: { field: RecordField; change: (value: RecordField) => void }) {
  switch (field.kind) {
    case 'text': return <textarea aria-label={`${field.label}内容`} rows={4} value={field.content.text} onChange={e => change({ ...field, content: { text: e.target.value } })} />;
    case 'table': return <TableEditor data={field.content} change={content => change({ ...field, content })} />;
    case 'process': return <ProcessEditor data={field.content} change={content => change({ ...field, content })} />;
    case 'formula': return <div className="record-formula-editor"><div className="record-form-grid">{(['latex', 'explanation', 'substitution', 'result'] as const).map(key => <label className={`record-label${key === 'latex' ? ' record-formula-source' : ''}`} key={key}>{{ latex: 'LaTeX 公式', explanation: '变量与单位说明', substitution: '代入过程', result: '计算结果（非实测）' }[key]}<textarea rows={2} value={field.content[key]} onChange={e => change({ ...field, content: { ...field.content, [key]: e.target.value } })} /></label>)}</div><div className="record-formula-preview"><span className="record-note">公式预览</span><FormulaView html={katex.renderToString(field.content.latex, { throwOnError: false, trust: false, displayMode: true, maxExpand: 200, maxSize: 20 })} /></div></div>;
    case 'assets': return <AssetsEditor field={field} change={change} />;
  }
}

export function RecordDocument({ value, change }: { value: DocumentData; change?: (value: DocumentData) => void }) {
  return <div className={`record-document${change ? ' record-document-editing' : ''}`}>
    {change && <p className="record-edit-hint">直接修改下方内容，完成后统一保存。字段名称、呈现方式和备注可在“字段设置”中调整。</p>}
    {value.sections.map((section, sectionIndex) => {
      const setFields = (fields: RecordField[]) => change?.({ ...value, sections: value.sections.map((s, i) => i === sectionIndex ? { ...s, fields } : s) });
      return <section key={section.id} className="record-section"><h2><span className="record-section-index" aria-hidden="true">{String(sectionIndex + 1).padStart(2, '0')}</span>{sectionLabels[section.id]}</h2>{section.fields.map((field, index) => {
        const editing = !!change;
        const setField = (next: RecordField) => setFields(section.fields.map(f => f.id === field.id ? next : f));
        const move = (offset: number) => { const fields = [...section.fields]; [fields[index], fields[index + offset]] = [fields[index + offset], fields[index]]; setFields(fields); };
        return <article key={field.id} className={`record-field${change ? ' record-field-editing' : ''}`}>
          <header><h3>{field.label}</h3>{editing && <span className="record-field-kind">{fieldLabels[field.kind]}</span>}</header>
          <div className="record-field-content">
            {editing ? <FieldEditor field={field} change={setField} /> : <FieldView field={field} />}
            {!editing && field.note && <p className="record-note">{field.note}</p>}
            {editing && <details className="record-editor-details record-field-settings"><summary>字段设置</summary><div className="record-form-grid">
              <label className="record-label">字段名称<input aria-label="字段名称" value={field.label} onChange={e => setField({ ...field, label: e.target.value })} /></label>
              <label className="record-label">字段类型<select aria-label="字段类型" value={field.kind} onChange={e => { if (confirm('更换字段类型会重置该字段当前内容，是否继续？')) setField({ ...newField(e.target.value as RecordField['kind']), id: field.id, label: field.label, note: field.note, source_refs: field.source_refs }); }}>{Object.entries(fieldLabels).map(([kind, label]) => <option value={kind} key={kind}>{label}</option>)}</select></label>
              <label className="record-label">所属板块<select aria-label="移动至板块" value={section.id} onChange={e => change!({ ...value, sections: value.sections.map(s => s.id === section.id ? { ...s, fields: s.fields.filter(f => f.id !== field.id) } : s.id === e.target.value ? { ...s, fields: [...s.fields, field] } : s) })}>{value.sections.map(s => <option key={s.id} value={s.id}>{sectionLabels[s.id]}</option>)}</select></label>
              {field.kind === 'table' && <label className="record-label">呈现方式<select aria-label="表格呈现" value={field.presentation} onChange={e => setField({ ...field, presentation: e.target.value as 'table' | 'cards' })}><option value="table">表格</option><option value="cards">卡片</option></select></label>}
              {field.kind === 'process' && <label className="record-label">呈现方式<select aria-label="流程呈现" value={field.presentation} onChange={e => setField({ ...field, presentation: e.target.value as 'flow' | 'steps' })}><option value="flow">流程图</option><option value="steps">步骤视图</option></select></label>}
              <label className="record-label record-settings-note">字段备注<textarea aria-label={`${field.label}备注`} rows={2} value={field.note || ''} onChange={e => setField({ ...field, note: e.target.value })} /></label>
            </div>{field.kind === 'table' && <TableColumns data={field.content} change={content => setField({ ...field, content })} />}<div className="record-controls"><button type="button" disabled={!index} onClick={() => move(-1)}>上移</button><button type="button" disabled={index === section.fields.length - 1} onClick={() => move(1)}>下移</button><button type="button" className="record-danger" onClick={() => setFields(section.fields.filter(f => f.id !== field.id))}>删除字段</button></div></details>}
            {!!field.source_refs?.length && <details><summary>查看来源</summary>{field.source_refs.map(id => { const source = value.sources.find(s => s.id === id); return source && <p key={id}>{source.kind === 'attachment' ? <a href={`/api/attachments/${encodeURIComponent(source.reference)}${source.page ? `#page=${source.page}` : ''}`}>原件{source.page ? ` · 第 ${source.page} 页` : ''}</a> : source.kind === 'experiment' ? <a href={`/experiments/${encodeURIComponent(source.reference)}`}>{source.reference} · 修订 {source.revision ?? '未记录'}</a> : source.reference}{source.excerpt && <>：{source.excerpt}</>}</p>; })}</details>}
          </div>
        </article>;
      })}{change && <details className="record-add-fields"><summary>添加字段</summary><div className="record-controls">{Object.entries(fieldLabels).map(([kind, label]) => <button type="button" key={kind} onClick={() => { const field = newField(kind as RecordField['kind']); setFields([...section.fields, field]); }}>＋{label}字段</button>)}</div></details>}{!section.fields.length && !change && <p className="record-note">尚未记录</p>}</section>;
    })}
  </div>;
}
