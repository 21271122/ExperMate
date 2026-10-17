import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SelectorItem, ToolActions, ToolResult } from './tool-model';

function MoreRecords({ items, selected, apply, close }: {
  items: SelectorItem[]; selected: string[]; apply: (ids: string[]) => void; close: () => void;
}) {
  const [query, setQuery] = useState(''), [draft, setDraft] = useState(selected);
  const toggle = (id: string) => setDraft(old => old.includes(id) ? old.filter(value => value !== id) : [...old, id]);
  return createPortal(<div id="sel-modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div style={{ background: 'var(--white)', border: '4px solid var(--black)', width: '90vw', maxWidth: 520, maxHeight: '75vh', display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)' }}>
      <div style={{ padding: '10px 14px', borderBottom: '2px solid var(--black)' }}>
        <input type="text" placeholder="Search (ID / title / tags / materials)" value={query} onChange={event => setQuery(event.target.value)}
          style={{ width: '100%', padding: '8px 12px', border: '2px solid var(--black)', fontSize: '.85rem', outline: 'none', fontFamily: 'inherit' }} />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', maxHeight: '50vh' }}>{items.map(item => <div key={item.id} className="sel-item" data-exp-id={item.id}
        style={{ display: `${item.id} ${item.title || ''} ${item.date || ''}`.toLowerCase().includes(query.toLowerCase()) ? undefined : 'none' }} onClick={() => toggle(item.id)}>
        <span className={`sel-check${draft.includes(item.id) ? ' checked' : ''}`}>✓</span><span className="sel-id">{item.id}</span>
        <span className="sel-title">{item.title || ''}</span><span style={{ fontSize: '.7rem', opacity: .5 }}>{item.date || ''}</span>
      </div>)}</div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '10px 14px', borderTop: '2px solid var(--black)' }}>
        <button className="sel-btn" id="sel-modal-cancel" onClick={close}>Cancel</button>
        <button className="sel-btn primary" id="sel-modal-confirm" onClick={() => { apply(draft); close(); }}>Confirm</button>
      </div>
    </div>
  </div>, document.body);
}

export function SelectorCard({ result, historical, animate, toolCallId, api }: {
  result: ToolResult; historical?: boolean; animate?: boolean; toolCallId?: string; api: ToolActions;
}) {
  const items = result.items || [];
  const [selected, setSelected] = useState(() => items.filter(item => result.preselected?.includes(item.id)).map(item => item.id));
  const [more, setMore] = useState(false), [pending, setPending] = useState(false), [resolved, setResolved] = useState('');
  const submitting = useRef(false), mounted = useRef(true);
  const expired = !!historical && !result.status;
  const status = result.status || resolved || 'active';
  const active = !expired && status === 'active';
  useEffect(() => {
    if (active) api.setSending(true);
    else if (expired) api.setSending(false);
  }, [active, expired, api]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function submit(next: 'confirmed' | 'cancelled') {
    if (!active || submitting.current || next === 'confirmed' && !selected.length) return;
    submitting.current = true; setPending(true);
    const ids = next === 'confirmed' ? items.filter(item => selected.includes(item.id)).map(item => item.id) : [];
    try {
      await api.client().resolveSelector(toolCallId || result._tcId || '', ids, next);
      if (mounted.current) setResolved(next);
      api.setSending(false);
      api.send(next === 'confirmed' ? `Selected: ${ids.join(', ')}. Continue analysis.` : 'Selection cancelled. Continue.');
    } catch (error) {
      if (mounted.current) api.showToast((error as Error).message || (next === 'confirmed' ? '提交选择失败' : '取消选择失败'));
    } finally {
      submitting.current = false;
      if (mounted.current) setPending(false);
    }
  }
  const className = `sel-card${animate ? ' tool-card-enter' : ''}`;
  if (expired) return <div className={className}><div className="sel-topbar" style={{ color: 'var(--red)' }}>Previous selection expired</div><div className="sel-topbar">Auto-cancelled</div></div>;
  if (!active) return <div className={className} data-tool="selector" data-status={status} data-tool-call-id={toolCallId || result._tcId}>
    <div className="sel-topbar">{status === 'confirmed' ? `Selected ${(result.selected_ids || selected).length} experiments: ${(result.selected_ids || selected).join(', ')}` : 'Selection cancelled'}</div>
  </div>;
  const all = items.length > 0 && items.every(item => selected.includes(item.id));
  return <div className={className} data-tool="selector" data-status="active" data-tool-call-id={toolCallId || result._tcId}>
    <div className="sel-topbar"><span>{result.title || 'Select experiments'}</span>
      <button className="sel-btn sel-toggle-all" disabled={pending} onClick={() => setSelected(all ? [] : items.map(item => item.id))}>{all ? 'Deselect All' : 'Select All'}</button>
    </div>
    <div className="sel-body">{items.slice(0, 8).map(item => <div key={item.id} className="sel-item" data-exp-id={item.id} onClick={() => {
      if (!pending) setSelected(old => old.includes(item.id) ? old.filter(id => id !== item.id) : [...old, item.id]);
    }}>
      <span className={`sel-check${selected.includes(item.id) ? ' checked' : ''}`}>✓</span>
      <div className="sel-info"><div className="sel-id">{item.id}</div><div style={{ fontWeight: 600, fontSize: '.8rem' }}>{item.title || '(untitled)'}</div>
        <div style={{ fontSize: '.7rem', opacity: .5 }}>{item.date || ''} {item.experimenter || ''}</div></div>
    </div>)}{items.length > 8 && <button disabled={pending} onClick={() => setMore(true)} style={{ width: '100%', padding: '.4rem', fontWeight: 700, cursor: 'pointer', border: 'none', borderTop: '2px solid var(--black)', background: 'var(--off-white)' }}>Show More ({items.length} total)</button>}</div>
    <div className="sel-bottombar"><span style={{ fontSize: '.78rem', fontWeight: 600 }}>Selected <b className="sel-count-num">{selected.length}</b></span>
      <span><button className="sel-btn" disabled={pending} onClick={() => void submit('cancelled')}>Cancel</button>{' '}
        <button className="sel-btn primary" disabled={pending} onClick={() => void submit('confirmed')}>Confirm ({selected.length})</button></span>
    </div>
    {more && <MoreRecords items={items} selected={selected} apply={setSelected} close={() => setMore(false)} />}
  </div>;
}
