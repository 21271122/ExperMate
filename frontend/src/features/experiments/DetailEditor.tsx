import { createContext, useContext, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { drawDash } from '../../runtime/dash';
import { escapeHtml, markdown, type TableRow } from './detail-model';

export type EditTarget = { label: string; type: 'text' | 'date' | 'textarea' | 'markdown' | 'html'; value: string; save: (value: string) => void };
export const EditorContext = createContext<{ editing: boolean; open: (target: EditTarget) => void }>({ editing: false, open() {} });

export function Editable({ value = '', label, type = 'text', save, block, field, style, className = '' }: {
  value?: string; label: string; type?: EditTarget['type']; save: (value: string) => void; block?: boolean; field?: string; style?: CSSProperties; className?: string;
}) {
  const editor = useContext(EditorContext);
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (ref.current && editor.editing) drawDash(ref.current);
  }, [value, editor.editing]);
  const props = { className: `editable-dashed${block ? ' block' : ''}${className ? ' ' + className : ''}`, style,
    'data-field': field, 'data-type': type, 'data-label': label, 'data-value': value,
    onClick: () => editor.editing && editor.open({ label, type, value, save }) };
  const html = type === 'html' ? value : type === 'markdown' ? markdown(value) : escapeHtml(value || (type === 'date' ? 'Not set' : ''));
  return block ? <div {...props} ref={ref as React.RefObject<HTMLDivElement>} dangerouslySetInnerHTML={{ __html: html }} />
    : <span {...props} ref={ref as React.RefObject<HTMLSpanElement>} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Modes({ view, edit }: { view: ReactNode; edit: ReactNode }) {
  const { editing } = useContext(EditorContext);
  return <><div className="view-mode" style={editing ? { display: 'none' } : undefined}>{view}</div>
    <div className="edit-mode" style={editing ? undefined : { display: 'none' }}>{edit}</div></>;
}

export function TableView({ rows, keys, headers }: { rows: TableRow[]; keys: string[]; headers: string[] }) {
  return <table className="academic-table"><thead><tr>{headers.map(h => <th key={h}>{h}</th>)}</tr></thead>
    <tbody>{rows.map((row, i) => <tr key={i}>{keys.map(key => <td key={key}>{row?.[key] || ''}</td>)}</tr>)}</tbody></table>;
}
export function TableEdit({ name, rows, keys, headers, save }: { name: string; rows: TableRow[]; keys: string[]; headers: string[]; save: (rows: TableRow[]) => void }) {
  const ref = useRef<HTMLTableElement>(null), { editing } = useContext(EditorContext);
  useLayoutEffect(() => {
    if (!editing) return;
    ref.current?.querySelectorAll('tbody tr').forEach(row => {
      const cells = [...row.querySelectorAll<HTMLElement>('.editable-dashed')];
      cells.forEach(cell => { cell.style.height = ''; cell.style.minHeight = '1.2em'; });
      const height = Math.max(0, ...cells.map(cell => cell.scrollHeight));
      if (height) cells.forEach(cell => { cell.style.height = height + 'px'; cell.style.minHeight = height + 'px'; drawDash(cell); });
    });
  }, [rows, editing]);
  return <><table ref={ref} id={`table-${name}`} className="academic-table"><thead><tr>{headers.map(h => <th key={h}>{h}</th>)}<th style={{ width: '2em' }} /></tr></thead>
    <tbody>{rows.map((row, i) => <tr key={i} data-row={i}>{keys.map((key, col) => <td key={key}>
      <Editable value={row?.[key] || ''} label={headers[col]} type="textarea" style={{ display: 'block', minWidth: 60, minHeight: '1.2em' }}
        save={value => save(rows.map((old, index) => index === i ? { ...old, [key]: value } : old))} /></td>)}
      <td style={{ width: '2em' }}><button type="button" className="outline row-del" style={{ fontSize: '0.7rem', padding: '0 0.3rem' }} onClick={() => save(rows.filter((_, index) => index !== i))}>X</button></td></tr>)}</tbody></table>
    <button type="button" className="outline" style={{ fontSize: '0.75rem', marginTop: '0.3rem' }} onClick={() => save([...rows, Object.fromEntries(keys.map(key => [key, '']))])}>+ 添加一行</button></>;
}
export function ArrayEdit({ name, items, save }: { name: string; items: string[]; save: (items: string[]) => void }) {
  return <><ul id={`list-${name}`} style={{ listStyle: 'none', padding: 0 }}>{items.map((item, i) => <li key={i} style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', marginBottom: '0.3rem' }}>
    <Editable value={item} label={name} type="textarea" style={{ flex: 1, minHeight: '1.2em' }} save={value => save(items.map((old, index) => index === i ? value : old))} />
    <button type="button" className="outline row-del" style={{ fontSize: '0.7rem', padding: '0 0.3rem', flexShrink: 0 }} onClick={() => save(items.filter((_, index) => index !== i))}>X</button></li>)}</ul>
    <button type="button" className="outline" style={{ fontSize: '0.75rem', marginTop: '0.3rem' }} onClick={() => save([...items, ''])}>+ 添加</button></>;
}

export function EditModal({ target, close }: { target: EditTarget | null; close: () => void }) {
  const [value, setValue] = useState('');
  const rich = useRef<HTMLDivElement>(null), text = useRef<HTMLTextAreaElement>(null), date = useRef<HTMLInputElement>(null);
  const formatted = !!target && ['textarea', 'markdown', 'html'].includes(target.type);
  useLayoutEffect(() => {
    if (!target) return;
    setValue(target.value);
    if (formatted && rich.current) {
      rich.current.innerHTML = target.type === 'html' ? target.value : target.type === 'markdown' ? markdown(target.value)
        : target.value.split('\n').map(line => line ? `<div>${escapeHtml(line)}</div>` : '<div><br></div>').join('');
      rich.current.focus();
    } else if (target.type === 'date') date.current?.focus();
    else { text.current?.focus(); text.current?.select(); }
  }, [target]);
  function command(cmd: string, arg?: string) { rich.current?.focus(); document.execCommand(cmd, false, arg); }
  function confirm() {
    if (!target) return;
    target.save(formatted ? target.type === 'html' ? rich.current!.innerHTML : (rich.current!.innerText ?? rich.current!.textContent ?? '').trim() : value);
    close();
  }
  // 模态框属于 React，避免旧脚本移动节点或改变正在编辑的字段。
  return createPortal(<div className={`edit-modal-overlay${target ? ' active' : ''}`} id="edit-modal" aria-hidden={!target} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }}>
    <div className="edit-modal-box"><div className="edit-modal-label" id="edit-modal-label">{target?.label}</div>
      <div className="edit-modal-toolbar" id="edit-modal-toolbar" style={formatted ? undefined : { display: 'none' }} onMouseDown={e => e.preventDefault()}>
        <button type="button" title="Bold" onClick={() => command('bold')}><b>B</b></button><button type="button" title="Italic" onClick={() => command('italic')}><i>I</i></button>
        <button type="button" title="Underline" onClick={() => command('underline')}><u>U</u></button><button type="button" title="Strikethrough" onClick={() => command('strikeThrough')}><s>S</s></button>
        <span className="tb-sep" /><button type="button" title="UL" onClick={() => command('insertUnorderedList')}>•</button><button type="button" title="OL" onClick={() => command('insertOrderedList')}>1.</button>
        <button type="button" title="Quote" onClick={() => command('formatBlock', 'BLOCKQUOTE')}>“</button><span className="tb-sep" /><button type="button" title="Link" onClick={() => {
          const url = prompt('URL:', 'https://'); if (url) command('createLink', url);
        }}>🔗</button></div>
      <textarea ref={text} className="edit-modal-input" id="edit-modal-input" aria-label={target?.label} rows={1} style={target?.type === 'text' ? undefined : { display: 'none' }}
        value={value} onChange={e => { setValue(e.target.value); e.target.style.height = Math.max(36, e.target.scrollHeight) + 'px'; }} />
      <div ref={rich} className="edit-modal-rich" id="edit-modal-rich" role="textbox" aria-label={formatted ? target?.label : undefined} contentEditable suppressContentEditableWarning style={formatted ? undefined : { display: 'none' }} />
      <input ref={date} type="date" className="edit-modal-date" id="edit-modal-date" aria-label={target?.type === 'date' ? target.label : undefined}
        style={target?.type === 'date' ? undefined : { display: 'none' }} value={value} onChange={e => setValue(e.target.value)} />
      <div className="edit-modal-actions"><button type="button" className="outline" onClick={close}>取消</button><button type="button" onClick={confirm}>确认</button></div></div></div>, document.body);
}
