import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { requestJson } from '../experiments/api';
import { escapeHtml, type Attachment } from '../experiments/detail-model';

export function attachmentKind(item: Attachment) {
  const name = (item.name || '').toLowerCase(), mime = (item.mime || '').toLowerCase();
  return name.endsWith('.xlsx') || mime.includes('spreadsheetml') ? 'xlsx' : /\.(csv|tsv)$/.test(name) || mime === 'text/csv' ? 'table'
    : name.endsWith('.txt') || mime.startsWith('text/') ? 'text' : name.endsWith('.pdf') || mime === 'application/pdf' ? 'pdf'
      : mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/.test(name) ? 'image' : 'file';
}
export async function downloadAttachment(item: Attachment) {
  const url = new URL(item.url || '/api/attachments/' + encodeURIComponent(item.sha256), location.origin); url.searchParams.set('download', '1');
  const desktop = (window as unknown as { pywebview?: { api?: { save_attachment_data?: (name: string, data: string) => Promise<{ ok: boolean; cancelled?: boolean; error?: string }> } } }).pywebview?.api;
  if (desktop?.save_attachment_data) {
    const response = await fetch(url.href); if (!response.ok) throw new Error('附件下载失败');
    const data = new Uint8Array(await response.arrayBuffer()); let binary = '';
    for (let offset = 0; offset < data.length; offset += 8192) binary += String.fromCharCode(...data.subarray(offset, offset + 8192));
    const result = await desktop.save_attachment_data(item.name || 'attachment', btoa(binary));
    if (!result.ok && !result.cancelled) throw new Error(result.error || '附件保存失败'); return result;
  }
  const link = document.createElement('a'); link.href = url.href; link.download = item.name || 'attachment'; document.body.appendChild(link); link.click(); link.remove();
  return { ok: true };
}
type PreviewData = { kind: string; rows?: string[][]; columns?: string[]; content?: string; sheets?: { name: string; rows: number; columns: number }[]; sheet?: string; start_row?: number; has_more?: boolean;
  column_widths?: Record<string, number>; row_heights?: Record<string, number>; cell_styles?: Record<string, { font?: { family?: string; size?: number; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; color?: string }; fill?: string; alignment?: { horizontal?: string; vertical?: string; wrap?: boolean; rotation?: number }; borders?: Record<string, string> }>;
  merged_cells?: { start_row: number; start_col: number; end_row: number; end_col: number }[] };
type Point = { row: number; col: number };
function cellStyle(data: PreviewData, coordinate: string): CSSProperties {
  const style = data.cell_styles?.[coordinate], font = style?.font, alignment = style?.alignment, border = style?.borders;
  return { padding: '.28rem .45rem', whiteSpace: 'pre-wrap', verticalAlign: (alignment?.vertical || 'top') as CSSProperties['verticalAlign'],
    borderLeft: border?.left || '1px solid #777', borderRight: border?.right || '1px solid #777', borderTop: border?.top || '1px solid #777', borderBottom: border?.bottom || '1px solid #777',
    fontFamily: font?.family, fontSize: font?.size, fontWeight: font?.bold ? 700 : undefined, fontStyle: font?.italic ? 'italic' : undefined,
    textDecoration: (font?.underline ? 'underline' : '') + (font?.strike ? ' line-through' : ''), color: font?.color, backgroundColor: style?.fill,
    textAlign: alignment?.horizontal as CSSProperties['textAlign'], overflowWrap: alignment?.wrap ? 'anywhere' : undefined, transform: alignment?.rotation ? `rotate(${alignment.rotation}deg)` : undefined };
}
function PreviewTable({ data, zoom }: { data: PreviewData; zoom: number }) {
  const rows = data.rows || [], start = data.start_row || 1, columns = data.columns || Array.from({ length: Math.max(0, ...rows.map(row => row.length)) }, (_, i) => '列 ' + (i + 1));
  const [selection, setSelection] = useState<{ anchor: Point; focus: Point } | null>(null), dragging = useRef(false), table = useRef<HTMLTableElement>(null);
  useEffect(() => { const stop = () => { dragging.current = false; }; document.addEventListener('mouseup', stop); return () => document.removeEventListener('mouseup', stop); }, []);
  const selected = (row: number, col: number) => !!selection && row >= Math.min(selection.anchor.row, selection.focus.row) && row <= Math.max(selection.anchor.row, selection.focus.row) && col >= Math.min(selection.anchor.col, selection.focus.col) && col <= Math.max(selection.anchor.col, selection.focus.col);
  function payload() {
    if (!selection) return null; const text: string[] = [], html: string[] = [];
    for (let row = Math.min(selection.anchor.row, selection.focus.row); row <= Math.max(selection.anchor.row, selection.focus.row); row++) {
      const values: string[] = []; for (let col = Math.min(selection.anchor.col, selection.focus.col); col <= Math.max(selection.anchor.col, selection.focus.col); col++) values.push(String(rows[row - start]?.[col - 1] || ''));
      text.push(values.map(value => value.replace(/[\t\r\n]+/g, ' ')).join('\t')); html.push('<tr>' + values.map(value => '<td>' + escapeHtml(value).replace(/\n/g, '<br>') + '</td>').join('') + '</tr>');
    } return { text: text.join('\n'), html: '<table><tbody>' + html.join('') + '</tbody></table>' };
  }
  const merges = data.merged_cells || [], baseStyle = cellStyle({kind:'table'}, '');
  return <div style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto', border: '2px solid var(--black,#111)' }}>
    <table ref={table} className="attachment-preview-zoomable" tabIndex={0} style={{ borderCollapse: 'collapse', width: 'max-content', minWidth: '100%', fontSize: '.82rem', outline: 'none', zoom: zoom + '%' }}
      onCopy={event => { const content = payload(); if (!content) return; event.clipboardData.setData('text/plain', content.text); event.clipboardData.setData('text/html', content.html); event.preventDefault(); }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); setSelection(null); }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && selection) {
          event.preventDefault(); if (!document.execCommand?.('copy')) void navigator.clipboard?.writeText(payload()!.text);
        }
      }}>
      <colgroup><col style={{ width: '3.4rem' }} />{columns.map(column => <col key={column} style={{ width: data.column_widths?.[column] }} />)}</colgroup>
      <thead><tr><th style={baseStyle}>#</th>{columns.map(column => <th key={column} style={baseStyle}>{column}</th>)}</tr></thead><tbody>
        {rows.map((row, index) => { const rowNumber = start + index; return <tr key={rowNumber} style={{ height: data.row_heights?.[String(rowNumber)] }}><th style={baseStyle}>{rowNumber}</th>{row.map((value, col) => {
          const columnNumber = col + 1, merge = merges.find(merge => rowNumber >= merge.start_row && rowNumber <= merge.end_row && columnNumber >= merge.start_col && columnNumber <= merge.end_col);
          if (merge && (merge.start_row !== rowNumber || merge.start_col !== columnNumber)) return null;
          const point = { row: rowNumber, col: columnNumber };
          return <td key={col} data-excel-row={rowNumber} data-excel-col={columnNumber} rowSpan={merge ? merge.end_row - merge.start_row + 1 : undefined} colSpan={merge ? merge.end_col - merge.start_col + 1 : undefined}
            style={{ ...cellStyle(data, columns[col] + rowNumber), boxShadow: selected(rowNumber, columnNumber) ? 'inset 0 0 0 9999px rgba(58,145,255,.24)' : undefined }}
            onMouseDown={event => { event.preventDefault(); table.current?.focus(); dragging.current = true; setSelection(old => ({ anchor: event.shiftKey && old ? old.anchor : point, focus: point })); }}
            onMouseOver={() => { if (dragging.current) setSelection(old => ({ anchor: old?.anchor || point, focus: point })); }}>{value}</td>;
        })}</tr>; })}</tbody></table></div>;
}
export function AttachmentPreview({ item, close }: { item: Attachment; close: () => void }) {
  const kind = attachmentKind(item), url = item.url || '/api/attachments/' + encodeURIComponent(item.sha256);
  const [zoom, setZoom] = useState(100), [data, setData] = useState<PreviewData | null>(null), [error, setError] = useState(''), [page, setPage] = useState({ sheet: '', start: 1 });
  useEffect(() => {
    const controller = new AbortController();
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); }; document.addEventListener('keydown', escape);
    if (['xlsx', 'table', 'text'].includes(kind)) {
      setData(null); setError(''); const params = new URLSearchParams(); if (page.sheet) params.set('sheet', page.sheet); if (page.start > 1) params.set('start_row', String(page.start));
      void requestJson(url + '/preview' + (params.size ? '?' + params.toString() : ''), { signal: controller.signal }).then(body => { if (!controller.signal.aborted) setData(body); }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    }
    return () => { controller.abort(); document.removeEventListener('keydown', escape); };
  }, [item, page]);
  return createPortal(<div className="attachment-preview-overlay" style={{ position: 'fixed', inset: 0, zIndex: 10050, background: 'rgba(0,0,0,.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
    <section className="attachment-preview-panel" style={{ width: 'min(1180px,96vw)', height: 'min(820px,92vh)', boxSizing: 'border-box', background: 'var(--white,#fff)', border: '3px solid var(--black,#111)', display: 'flex', flexDirection: 'column', boxShadow: '12px 12px 0 rgba(0,0,0,.28)' }}>
      <header className="attachment-preview-head" style={{ display: 'flex', gap: '.7rem', alignItems: 'center', padding: '.55rem .75rem', background: 'var(--black,#111)', color: '#fff', fontWeight: 800, minWidth: 0 }}>
        <span className="attachment-preview-title" style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{item.name || '附件'}</span>
        <div className="attachment-preview-controls" style={{ display: 'flex', gap: '.35rem', alignItems: 'center', flexShrink: 0 }}>
          <button type="button" title="缩小" style={{ fontWeight: 800, cursor: 'pointer', minWidth: '1.8rem' }} onClick={() => setZoom(old => Math.max(50, old - 10))}>−</button><span className="attachment-preview-zoom-label" style={{ minWidth: '3.1rem', textAlign: 'center', fontSize: '.78rem' }}>{zoom}%</span>
          <button type="button" title="恢复原始大小" style={{ fontWeight: 800, cursor: 'pointer', minWidth: '1.8rem' }} onClick={() => setZoom(100)}>100%</button><button type="button" title="放大" style={{ fontWeight: 800, cursor: 'pointer', minWidth: '1.8rem' }} onClick={() => setZoom(old => Math.min(200, old + 10))}>＋</button>
          <button type="button" style={{ color: '#fff', fontSize: '.8rem', cursor: 'pointer' }} onClick={() => void downloadAttachment(item).catch(reason => setError(reason.message))}>下载</button></div>
        <button type="button" className="attachment-preview-close" style={{ fontWeight: 800, cursor: 'pointer' }} onClick={close}>关闭</button></header>
      <div className="attachment-preview-body" style={{ flex: 1, minHeight: 0, overflow: 'hidden', padding: kind === 'pdf' ? 0 : '.75rem', display: 'flex', flexDirection: 'column', background: kind === 'image' ? '#222' : undefined }}>
        {error ? <div role="alert">{error}</div> : kind === 'pdf' ? <iframe src={url} title={item.name || 'PDF'} style={{ width: '100%', height: '100%', border: 0 }} />
          : kind === 'image' ? <img src={url} alt={item.name || '图片附件'} style={{ display: 'block', maxWidth: '100%', maxHeight: '100%', margin: 'auto', objectFit: 'contain' }} />
            : kind === 'file' ? '该文件类型暂不支持应用内预览，请下载后打开。' : !data ? '正在加载预览…' : <>
              {data.kind === 'xlsx' && <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap', marginBottom: '.65rem' }}>{data.sheets?.map(sheet => <button type="button" key={sheet.name} className="outline" style={{ fontSize: '.72rem' }} disabled={sheet.name === data.sheet} onClick={() => setPage({ sheet: sheet.name, start: 1 })}>{sheet.name} ({sheet.rows}×{sheet.columns})</button>)}</div>}
              {data.kind === 'xlsx' || data.kind === 'table' ? <PreviewTable key={data.sheet + ':' + data.start_row} data={data} zoom={zoom} /> : <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', font: '13px/1.5 ui-monospace,Consolas,monospace' }}>{data.content || ''}</pre>}
              {data.kind === 'xlsx' && ((data.start_row || 1) > 1 || data.has_more) && <div style={{ display: 'flex', gap: '.45rem', alignItems: 'center', marginTop: '.55rem' }}>{(data.start_row || 1) > 1 && <button type="button" className="outline" onClick={() => setPage({ sheet: data.sheet || '', start: Math.max(1, (data.start_row || 1) - 200) })}>上一页</button>}
                {data.has_more && <button type="button" className="outline" onClick={() => setPage({ sheet: data.sheet || '', start: (data.start_row || 1) + 200 })}>下一页</button>}<small>显示第 {data.start_row}–{(data.start_row || 1) + (data.rows?.length || 0) - 1} 行</small></div>}</>}
      </div></section></div>, document.body);
}
