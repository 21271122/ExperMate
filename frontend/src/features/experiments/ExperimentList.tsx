import { useEffect, useRef, useState, type FormEvent } from 'react';
import { invoke } from '../../legacy/invoke';
import { requestJson } from './api';
import { DateGroup, Record } from './Record';
import { ToolPanel } from './ToolPanel';
import { ListSearchPopup } from './ListSearchPopup';
import { createPortal } from 'react-dom';
import { emptyData, isArchived, matches, normalizeDate, sortExperiments, statuses, type Experiment, type Filters, type ListData } from './model';

function savedFilters(path: string): Filters {
  let saved: Partial<Filters> = {};
  try { saved = JSON.parse(localStorage.getItem('exdiary_view_state') || '{}')[path] || {}; } catch { /* 原存储损坏时使用默认值 */ }
  return { status: saved.status || '', tags: saved.tags || [], dateFrom: saved.dateFrom || '', dateTo: saved.dateTo || '', query: '' };
}
type Modal = { mode: 'add' | 'edit' | 'assign'; name: string; description: string; original?: string; expId?: string; assigned: string[] };

export function ExperimentList({ path }: { path: string }) {
  const [data, setData] = useState<ListData>(emptyData);
  const [filters, setFilters] = useState(() => savedFilters(path));
  const [category, setCategory] = useState('__all__');
  const [panel, setPanel] = useState(new URLSearchParams(location.search).get('panel') || '');
  const [popup, setPopup] = useState('');
  const [searchPopup, setSearchPopup] = useState(false), [mobileCompare, setMobileCompare] = useState(false);
  const [editing, setEditing] = useState(false);
  const [cards, setCards] = useState(() => sessionStorage.getItem('exdiary_list_view') === 'cards');
  const [selected, setSelected] = useState<string[]>([]);
  const [menu, setMenu] = useState('');
  const [dropTarget, setDropTarget] = useState('');
  const [modal, setModal] = useState<Modal | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const drag = useRef('');
  const mutation = useRef(false);
  const mounted = useRef(true);
  const compare = panel === 'compare';
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const filtersRef = useRef(filters); filtersRef.current = filters;
  const emptyModal = (): Modal => ({ mode: 'add', name: '', description: '', assigned: [] });

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void requestJson('/api/v1/experiment-list', { signal: controller.signal }).then(body => {
      if (controller.signal.aborted) return;
      setData(body.data); setLoading(false);
      requestAnimationFrame(() => {
        if (!mounted.current) return;
        try {
          const scroll = JSON.parse(localStorage.getItem('exdiary_view_state') || '{}')[path]?.scroll || 0;
          const mount = document.getElementById('fragment-mount'); if (mount) mount.scrollTop = scroll;
        } catch { /* 无可恢复状态 */ }
      });
    }).catch(reason => { if (!controller.signal.aborted) { setError(reason.message); setLoading(false); } });
    return () => { mounted.current = false; controller.abort(); };
  }, [path]);

  function activatePanel(value: string) { setPanel(value); if (value !== 'compare') { selectedRef.current = []; setSelected([]); setMobileCompare(false); } }
  function toggle(id: string) {
    const old = selectedRef.current;
    if (!old.includes(id) && old.length >= 4) return false;
    const next = old.includes(id) ? old.filter(item => item !== id) : [...old, id];
    selectedRef.current = next; setSelected(next); return true;
  }
  function goCompare() { if (selectedRef.current.length >= 2) invoke('PanelManager.navigate', '/compare?ids=' + selectedRef.current.join(',')); }
  useEffect(() => { invoke('onCompareBarUpdate', selected.length); }, [selected]);
  useEffect(() => {
    // 移动端工具栏继续使用原接口，状态和行渲染由 React 管理。
    const api = { toggle, isSelected: (id: string) => selectedRef.current.includes(id), getCount: () => selectedRef.current.length,
      exit: () => activatePanel(''), go: goCompare };
    const enter = () => { activatePanel('compare'); setMobileCompare(innerWidth <= 720); };
    const filter = () => {
      const active = document.querySelector<HTMLElement>('#status-filters .active');
      setFilters({ query: (document.getElementById('search-input') as HTMLInputElement)?.value || '',
        status: active?.dataset.archive === 'true' ? 'archived' : active?.dataset.status || '',
        tags: [...document.querySelectorAll<HTMLElement>('#tag-filters .active')].map(el => el.dataset.tag || ''),
        dateFrom: (document.getElementById('date-from') as HTMLInputElement)?.value || '',
        dateTo: (document.getElementById('date-to') as HTMLInputElement)?.value || '' });
    };
    const list = { openPanelPopup: (name: string) => { setPopup(name); activatePanel(name); }, openSearchPopup: () => setSearchPopup(true),
      getViewState: () => { const { query: _query, ...saved } = filtersRef.current; return saved; } };
    Object.assign(window, { compareApi: api, enterCompareMode: enter, filterExperiments: filter, ExperMateList: list });
    return () => {
      for (const name of ['compareApi', 'enterCompareMode', 'filterExperiments', 'ExperMateList']) delete (window as unknown as { [name: string]: unknown })[name];
    };
  }, []);
  useEffect(() => {
    const close = (event: Event) => {
      const target = event.target as Element;
      if (event.type === 'scroll' || !target.closest('.card-menu-dropdown,.row-menu-btn,.card-menu-btn')) setMenu('');
      if (event.type === 'click' && panel && panel !== 'compare' && !target.closest('.tool-tabs,.tool-panel,#category-modal')) activatePanel('');
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenu(''); setPopup(''); setSearchPopup(false); if (!mutation.current) setModal(null); } };
    document.addEventListener('click', close); window.addEventListener('scroll', close, true); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('click', close); window.removeEventListener('scroll', close, true); document.removeEventListener('keydown', escape); };
  }, [panel]);

  async function mutate(operation: () => Promise<void>) {
    if (mutation.current) return;
    mutation.current = true; setPending(true); setError(''); setMenu('');
    try { await operation(); } catch (reason) { if (mounted.current) setError((reason as Error).message); }
    finally { mutation.current = false; if (mounted.current) setPending(false); }
  }
  async function refreshCategories() {
    const result = await requestJson('/api/categories');
    if (mounted.current) setData(old => ({ ...old, collections: result.collections || {}, collectionMeta: result.meta || {}, categoryPinned: result.category_pinned || {} }));
  }
  function pin(exp: Experiment) {
    const scope = category;
    void mutate(async () => {
      const result = await requestJson(`/api/experiments/${encodeURIComponent(exp.id)}/pin`, { method: 'POST', body: JSON.stringify(scope === '__all__' ? {} : { collection: scope }) });
      if (!mounted.current) return;
      setData(old => {
        const ids = scope === '__all__' ? old.pinnedIds : old.categoryPinned[scope] || [];
        const next = result.pinned ? ids.includes(exp.id) ? ids : [...ids, exp.id] : ids.filter(id => id !== exp.id);
        return scope === '__all__' ? { ...old, pinnedIds: next } : { ...old, categoryPinned: { ...old.categoryPinned, [scope]: next } };
      });
    });
  }
  function assign(exp: Experiment) {
    setMenu('');
    setModal(Object.keys(data.collections).length ? { mode: 'assign', name: '', description: '', expId: exp.id,
      assigned: Object.keys(data.collections).filter(name => data.collections[name].includes(exp.id)) } : emptyModal());
  }
  function saveModal(event: FormEvent) {
    event.preventDefault(); if (!modal) return;
    const current = modal;
    void mutate(async () => {
      if (current.mode === 'assign') {
        // favorite 是切换接口：只提交发生变化的成员，禁止重复提交。
        try {
          for (const name of Object.keys(data.collections)) {
            if (data.collections[name].includes(current.expId!) !== current.assigned.includes(name)) {
              await requestJson(`/api/experiments/${encodeURIComponent(current.expId!)}/favorite`, { method: 'POST', body: JSON.stringify({ collection: name }) });
            }
          }
        } finally {
          // 部分成功也重新读服务端状态，避免再次保存时反向切换已成功的分类。
          if (mounted.current) setModal(null);
          await refreshCategories();
        }
      } else {
        await requestJson('/api/categories' + (current.mode === 'edit' ? '/' + encodeURIComponent(current.original!) : ''), {
          method: current.mode === 'edit' ? 'PATCH' : 'POST', body: JSON.stringify({ name: current.name.trim(), description: current.description.trim() }),
        });
        if (category === current.original) setCategory(current.name.trim());
      }
      await refreshCategories(); if (mounted.current) setModal(null);
    });
  }
  function removeCategory(name: string) {
    if (!confirm(`删除分类“${name}”？实验记录仍会保留在“全部实验”中。`)) return;
    void mutate(async () => {
      await requestJson('/api/categories/' + encodeURIComponent(name), { method: 'DELETE' });
      if (category === name) setCategory('__all__'); await refreshCategories();
    });
  }
  function reorder(target: string) {
    const source = drag.current; drag.current = ''; setDropTarget('');
    if (!source || source === target) return;
    const names = Object.keys(data.collections).filter(name => name !== source);
    names.splice(names.indexOf(target), 0, source);
    void mutate(async () => { await requestJson('/api/categories/reorder', { method: 'POST', body: JSON.stringify({ names }) }); await refreshCategories(); });
  }

  const setFilter = (patch: Partial<Filters>) => setFilters(old => ({ ...old, ...patch }));
  const tags = [...new Set(data.experiments.flatMap(exp => exp.tags || []))].sort();
  const pinIds = category === '__all__' ? data.pinnedIds : data.categoryPinned[category] || [];
  const filtered = sortExperiments(data.experiments.filter(exp => matches(exp, filters)));
  const activeFilters = !!(filters.query.trim() || filters.status || filters.tags.length || filters.dateFrom || filters.dateTo);
  const primary = filtered.filter(exp => category === '__all__' || (data.collections[category] || []).includes(exp.id));
  const other = category === '__all__' || !activeFilters ? [] : filtered.filter(exp => !primary.includes(exp) && Object.values(data.collections).some(ids => ids.includes(exp.id)));
  const pinned = primary.filter(exp => pinIds.includes(exp.id)).sort((a, b) => pinIds.indexOf(a.id) - pinIds.indexOf(b.id));
  const timeline = primary.filter(exp => !pinIds.includes(exp.id));
  const dates = [...new Set(timeline.map(exp => normalizeDate(exp.date)))].sort((a, b) => !a ? -1 : !b ? 1 : b.localeCompare(a));
  const filterLabels = [filters.status && statuses[filters.status], filters.tags.length && 'TAG',
    filters.dateFrom && filters.dateTo ? filters.dateFrom + '~' + filters.dateTo : filters.dateFrom || filters.dateTo].filter(Boolean);
  const record = (exp: Experiment, isOther = false) => <Record key={exp.id} exp={exp} cards={cards} pinned={!isOther && pinIds.includes(exp.id)} other={isOther}
    selected={selected.includes(exp.id)} category={category} categories={Object.keys(data.collections).filter(name => data.collections[name].includes(exp.id))}
    menu={menu} setMenu={setMenu} pin={() => { if (!pending) pin(exp); }} categorize={() => assign(exp)}
    open={() => { if (compare) { if (!toggle(exp.id)) alert('Max 4 experiments'); } else invoke('PanelManager.navigate', '/experiments/' + encodeURIComponent(exp.id)); }} />;
  const categories = ['__all__', ...Object.keys(data.collections)];

  return <><link rel="stylesheet" href="/static/css/experiments.css" />
    {searchPopup && <ListSearchPopup filters={filters} tags={tags} change={setFilters} close={() => setSearchPopup(false)} />}
    {compare && mobileCompare && document.getElementById('page-toolbar') && createPortal(<div id="compare-bar" style={{ position:'sticky',top:0,zIndex:50,background:'var(--yellow)',borderBottom:'4px solid var(--black)',padding:'0.45rem 0.9rem',display:'flex',alignItems:'center',gap:'0.6rem',fontWeight:900,fontSize:'0.8rem',letterSpacing:'0.5px' }}>
      <span style={{flex:1}}>{selected.length < 2 ? `已选择 ${selected.length} / 需 2` : `已选择 ${selected.length} experiments`}</span><button type="button" className="outline" disabled={selected.length<2} onClick={goCompare}>Start Compare</button><button type="button" className="outline secondary" onClick={()=>activatePanel('')}>取消</button></div>, document.getElementById('page-toolbar')!)}
    <section className="exp-list-page" aria-label="Experiment list">
      <header className="exp-list-header"><h1>实验记录</h1><div className="header-right">
        <span id="list-context">{data.experiments.filter(exp => isArchived(exp) === (filters.status === 'archived')).length} 条记录 · {filters.status === 'archived' ? '已归档' : `分类：${category === '__all__' ? '全部实验' : category}`}</span>
        <div className="view-toggle" id="view-toggle" role="group" aria-label="List view">{[false, true].map(value => <button key={String(value)} type="button" data-view={value ? 'cards' : 'rows'}
          className={cards === value ? 'active' : ''} title={value ? '卡片视图' : '索引行'} aria-pressed={cards === value}
          onClick={() => { if (!compare) { setCards(value); sessionStorage.setItem('exdiary_list_view', value ? 'cards' : 'rows'); } }}>{value ? '▦' : '≡'}</button>)}</div></div></header>
      <section className="search-block" aria-label="搜索实验记录"><label className="sr-only" htmlFor="search-input">搜索实验记录</label>
        <input type="search" id="search-input" placeholder="搜索实验记录…" autoComplete="off" value={filters.query} onChange={e => setFilter({ query: e.target.value })} /></section>
      <nav className="tool-tabs" aria-label="Experiment tools">{[['categories', '分类'], ['filters', '筛选'], ['compare', '对比']].map(([key, label]) => <button key={key} type="button"
        className={`tool-tab${panel === key ? ' active' : ''}${key === 'filters' && filterLabels.length ? ' filter-active' : ''}`} data-panel={key} aria-expanded={panel === key}
        title={key === 'filters' ? filterLabels.length ? '当前筛选：' + filterLabels.join('、') : '筛选' : undefined}
        onClick={() => activatePanel(panel === key ? '' : key)}>{key === 'filters' && filterLabels.length ? '筛选 · ' + filterLabels.join(' · ') : label}</button>)}</nav>
      <ToolPanel name="categories" label="Categories" active={panel === 'categories'} popup={popup} close={() => { setPopup(''); activatePanel(''); }}>
        <div className="panel-header"><span>分类</span><button type="button" className={`panel-action${editing ? ' active' : ''}`} id="category-edit-toggle" onClick={() => setEditing(!editing)}>{editing ? '完成' : '编辑'}</button></div>
        <div id="category-list" className={`category-list${editing ? ' editing' : ''}`}>{categories.map(name => {
          const all = name === '__all__';
          return <div key={name} className={`category-row${all ? ' default-category' : ''}${category === name ? ' active' : ''}${dropTarget === name ? ' drag-over' : ''}`} tabIndex={0} data-category={name}
            draggable={editing && !all} onDragStart={() => { drag.current = name; }} onDragEnd={() => { drag.current = ''; setDropTarget(''); }}
            onDragOver={e => { if (editing && !all) { e.preventDefault(); setDropTarget(name); } }} onDragLeave={() => setDropTarget('')} onDrop={e => { e.preventDefault(); if (!all) reorder(name); }}
            onClick={e => { if (!(e.target as Element).closest('button,.drag-handle')) { setCategory(name); if (!editing) activatePanel(''); } }}
            onKeyDown={e => { if (e.target === e.currentTarget && ['Enter', ' '].includes(e.key)) { e.preventDefault(); setCategory(name); if (!editing) activatePanel(''); } }}>
            <div className="category-main"><div className="category-title-line"><span className="category-name">{all ? '全部实验' : name}</span>{all && <span className="default-badge">Default</span>}</div>
              <div className="category-desc">{all ? 'Default scope across every experiment record.' : data.collectionMeta[name]?.description || 'No description yet.'}</div></div>
            <div className="category-count">{data.experiments.filter(exp => !isArchived(exp) && (all || data.collections[name].includes(exp.id))).length}</div>
            {!all && <div className="category-actions"><span className="drag-handle" title="Drag to reorder">|||</span>
              <button type="button" className="category-edit" title="Rename" disabled={pending} onClick={() => setModal({ mode: 'edit', name, original: name, description: data.collectionMeta[name]?.description || '', assigned: [] })}>T</button>
              <button type="button" className="category-delete" title="Delete" disabled={pending} onClick={() => removeCategory(name)}>X</button></div>}</div>;
        })}</div><div id="category-editor" className="category-editor" hidden={!editing}><button type="button" id="add-category-btn" className="add-category-btn" onClick={() => setModal(emptyModal())}>+ 新建分类</button></div>
      </ToolPanel>
      <ToolPanel name="filters" label="筛选" active={panel === 'filters'} popup={popup} close={() => { setPopup(''); activatePanel(''); }}>
        <div className="panel-header filter-panel-header"><span>筛选</span><span>状态 / 标签 / 日期</span></div><div className="filter-rows">
          <div className="filter-row"><div className="filter-label">类型</div><div id="status-filters" className="chip-row">{Object.entries(statuses).map(([status, label]) => <button key={status} type="button"
            className={`filter-chip${filters.status === status ? ' active' : ''}${status === 'archived' ? ' archive-filter' : ''}`} data-status={status === 'archived' ? undefined : status}
            data-archive={status === 'archived' ? 'true' : undefined} onClick={() => setFilter({ status })}>{label}</button>)}</div></div>
          <div className="filter-row"><div className="filter-label">标签</div><div id="tag-filters" className="chip-row">{tags.map(tag => <button key={tag} type="button" className={`filter-chip${filters.tags.includes(tag) ? ' active' : ''}`}
            data-tag={tag} onClick={() => setFilter({ tags: filters.tags.includes(tag) ? filters.tags.filter(t => t !== tag) : [...filters.tags, tag] })}>{tag}</button>)}</div></div>
          <div className="filter-row"><div className="filter-label">日期</div><div className="date-range"><label className="sr-only" htmlFor="date-from">Date from</label>
            <input type="date" id="date-from" value={filters.dateFrom} onChange={e => setFilter({ dateFrom: e.target.value })} /><span>~</span><label className="sr-only" htmlFor="date-to">Date to</label>
            <input type="date" id="date-to" value={filters.dateTo} onChange={e => setFilter({ dateTo: e.target.value })} /></div></div></div>
      </ToolPanel>
      <section id="panel-compare" className={`tool-panel${compare ? ' active' : ''}`} aria-label="Compare"><div className="compare-row">
        <span id="compare-count">{selected.length < 2 ? `已选择 ${selected.length} 条 / 至少选择 2 条` : `已选择 ${selected.length} 条实验记录`}</span>
        <button type="button" id="compare-go-btn" className="outline" disabled={selected.length < 2} onClick={goCompare}>开始对比</button></div></section>
      <section id="pinned-results" className="result-section" aria-label="Pinned experiments" hidden={!pinned.length}>{pinned.map(exp => record(exp))}</section>
      <section id="primary-results" className="result-section" aria-label="Current category results">{dates.map(date => <DateGroup key={date} date={date}>{timeline.filter(exp => normalizeDate(exp.date) === date).map(exp => record(exp))}</DateGroup>)}</section>
      <div id="other-divider" className="other-divider" hidden={!other.length}><span /><strong>其他分类中的匹配记录</strong><span /></div>
      <section id="other-results" className="result-section" aria-label="Other category matches">{other.map(exp => record(exp, true))}</section>
      <div id="no-results" className="empty-state" hidden={!!(primary.length + other.length) || loading || !!error}><h3>没有匹配的实验记录</h3><p>请调整搜索条件、筛选条件或分类。</p></div>
      {loading && <div className="empty-state" role="status">加载中…</div>}
      {error && <div className="empty-state" role="alert">{error}</div>}
    </section>
    <div className="category-modal" id="category-modal" hidden={!modal} onClick={e => { if (e.target === e.currentTarget && !pending) setModal(null); }}>
      <form className="category-modal-box" id="category-modal-form" onSubmit={saveModal}>
        <div className="category-modal-title" id="category-modal-title">{modal?.mode === 'assign' ? 'Categorize' : modal?.mode === 'edit' ? 'Edit Category' : 'Add Category'}</div>
        <label hidden={modal?.mode === 'assign'}><span>Name</span><input type="text" id="category-name-input" required={modal?.mode !== 'assign'} disabled={pending || modal?.mode === 'assign'} maxLength={60}
          value={modal?.name || ''} onChange={e => setModal(old => old && ({ ...old, name: e.target.value }))} /></label>
        <label hidden={modal?.mode === 'assign'}><span>Description</span><textarea id="category-desc-input" rows={3} maxLength={180} disabled={pending || modal?.mode === 'assign'}
          value={modal?.description || ''} onChange={e => setModal(old => old && ({ ...old, description: e.target.value }))} /></label>
        {modal?.mode === 'assign' && <div className="assign-list">{Object.keys(data.collections).map(name => <label className="assign-row" key={name}>
          <input type="checkbox" value={name} disabled={pending} checked={modal.assigned.includes(name)} onChange={() => setModal(old => old && ({ ...old,
            assigned: old.assigned.includes(name) ? old.assigned.filter(n => n !== name) : [...old.assigned, name] }))} /><span>{name}</span></label>)}</div>}
        <div className="category-modal-actions"><button type="button" className="outline secondary" id="category-modal-cancel" disabled={pending} onClick={() => setModal(null)}>Cancel</button>
          <button type="submit" id="category-modal-save" disabled={pending}>Save</button></div>
      </form>
    </div></>;
}
