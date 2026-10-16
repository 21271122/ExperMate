import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { type Experiment, isArchived, normalizeDate, statuses, dateLabel } from './model';

type Props = { exp: Experiment; cards: boolean; pinned: boolean; other: boolean; selected: boolean;
  category: string; categories: string[]; menu: string; setMenu: (id: string) => void;
  open: () => void; pin: () => void; categorize: () => void };

export function Record({ exp, cards, pinned, other, selected, category, categories, menu, setMenu, open, pin, categorize }: Props) {
  const button = useRef<HTMLButtonElement>(null);
  const dropdown = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const expanded = menu === exp.id;
  useLayoutEffect(() => {
    if (!expanded || !button.current || !dropdown.current) return;
    const b = button.current.getBoundingClientRect(), m = dropdown.current.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(b.right - m.width, innerWidth - m.width - 8)),
      top: b.bottom + m.height + 4 > innerHeight ? Math.max(8, b.top - m.height - 4) : b.bottom + 4 });
  }, [expanded]);
  const archived = isArchived(exp);
  const menuItems = <><button ref={button} type="button" className={cards ? 'card-menu-btn' : 'row-menu-btn'} aria-label="Experiment actions"
    onClick={() => setMenu(expanded ? '' : exp.id)}>⋮</button>
    <div ref={dropdown} className="card-menu-dropdown" hidden={!expanded} style={expanded ? { position: 'fixed', ...position } : undefined}>
      {!other && <button type="button" className="card-menu-item pin-item" onClick={pin}>
        {pinned ? 'Unpin' : 'Pin'} {category === '__all__' ? 'Globally' : 'in Category'}</button>}
      <button type="button" className="card-menu-item category-item" onClick={categorize}>Categorize{categories.length ? ` (${categories.length})` : ''}</button>
    </div></>;
  return <article className={`${cards ? 'record-card' : 'record-row'}${cards && pinned ? ' pinned-card' : ''}${archived ? ' archived-record' : ''}${other ? ' other-result' : ''}${selected ? ' selected' : ''}${expanded ? ' menu-open' : ''}`}
    data-exp-id={exp.id} tabIndex={0} onClick={e => { if (!(e.target as Element).closest('button,input')) open(); }}
    onKeyDown={e => { if (e.target === e.currentTarget && ['Enter', ' '].includes(e.key)) { e.preventDefault(); open(); } }}>
    {cards ? <><div className="card-header"><div className="header-exp">{exp.id}{menuItems}</div>
      <div className={`header-status s-${exp.status || 'planned'}`}>{archived ? '已归档' : statuses[exp.status || 'planned'] || 'Plan'}</div></div>
      <div className="card-body"><div className="main-content"><div className="black-overhang" />
        <h2 className="content-title">{exp.title || '(untitled)'}</h2><div className="tags-container">{(exp.tags || []).map(tag => <span className="tag" key={tag}>{tag}</span>)}</div></div>
        <div className="sidebar"><div className="date-block">{normalizeDate(exp.date) || '-'}</div>
          <div className="person-box"><div className="person-accent" /><div className="person-name">{exp.experimenter || '-'}</div></div>
          <div className="date-block">{normalizeDate(exp.end_date || exp.date) || '-'}</div></div></div></>
      : <><div className="row-dot-col"><span className={`row-dot ${archived ? 'archived-dot' : `s-${exp.status || 'planned'}`}`} />{pinned && <span className="pin-mark" />}</div>
        <div className="row-line1"><span className="row-id">{exp.id}</span><span className="row-person">{exp.experimenter || ''}</span>{archived && <span className="row-archive">已归档</span>}</div>
        <div className="row-line2"><span className="row-title">{exp.title || '(untitled)'}</span></div><div className="row-menu-col">{menuItems}</div></>}
  </article>;
}

export function DateGroup({ date, children }: { date: string; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(!date);
  return <><div className={`date-group-head${collapsed ? ' collapsed' : ''}`}>
    <span className="date-marker" role="button" tabIndex={0} title="展开/收起本组" onClick={() => setCollapsed(!collapsed)}
      onKeyDown={e => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); setCollapsed(!collapsed); } }} />
    <span className="date-text">{dateLabel(date)}</span>{date && !Number.isNaN(new Date(date + 'T00:00:00').getTime()) && <span className="date-full">{date}</span>}</div>
    <div className="date-group-body"><div className="date-group-inner">{children}</div></div></>;
}
