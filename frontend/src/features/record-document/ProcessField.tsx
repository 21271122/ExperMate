import { useId, useLayoutEffect, useRef, useState } from 'react';
import { layoutProcess } from './process-layout';
import type { ProcessData } from './model';
import { newId } from './model';

type Selection = { kind: 'material' | 'action'; id: string };
export function ProcessView({ data, onSelect, selected }: { data: ProcessData; onSelect?: (value: Selection) => void; selected?: Selection | null }) {
  const arrow = useId().replaceAll(':', '');
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useLayoutEffect(() => {
    const element = container.current!;
    const measure = () => { if (element.clientWidth) setWidth(element.clientWidth); };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const layout = layoutProcess(data, width);
  return <div className="record-process-container" ref={container}>
    <svg className="record-process" role={onSelect ? 'group' : 'img'} aria-label="物质与操作流程图" data-direction={layout.direction} width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`}>
      <defs><marker id={arrow} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
      {layout.paths.map((path, index) => <path key={index} d={path.d} fill="none" stroke="currentColor" strokeWidth="1.5" markerEnd={path.arrow ? `url(#${arrow})` : undefined} />)}
      {layout.boxes.map(box => <g key={box.id} className="record-process-target" data-selected={selected?.kind === box.kind && selected.id === box.id.slice(2) || undefined}
        role={onSelect ? 'button' : undefined} tabIndex={onSelect ? 0 : undefined} aria-label={onSelect ? `编辑${box.kind === 'material' ? '物质' : '动作'}：${box.kind === 'material' ? data.nodes.find(node => 'm:' + node.id === box.id)?.label : data.actions.find(action => 'a:' + action.id === box.id)?.label}` : undefined}
        onClick={onSelect ? () => onSelect({ kind: box.kind, id: box.id.slice(2) }) : undefined} onKeyDown={onSelect ? event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect({ kind: box.kind, id: box.id.slice(2) }); } } : undefined}>
        {onSelect && box.kind === 'action' && <rect className="record-action-hit" x={box.x} y={box.y} width={box.width} height={box.height} fill="transparent" stroke="none" />}
        {box.kind === 'material' && <rect x={box.x} y={box.y} width={box.width} height={box.height} fill="var(--white,white)" stroke="currentColor" strokeWidth="2" />}
        <text x={box.x + box.width / 2} y={box.y + box.height / 2 - (box.lines.length - 1) * 9 + 5} textAnchor="middle" fontSize="14"
          fontWeight={box.kind === 'material' ? 600 : 400} paintOrder="stroke" stroke="var(--white,white)" strokeWidth="4" strokeLinejoin="round" fill="currentColor">
          {box.lines.map((line, index) => <tspan key={index} x={box.x + box.width / 2} dy={index ? 18 : 0}>{line}</tspan>)}
          <title>{box.kind === 'material' ? data.nodes.find(node => 'm:' + node.id === box.id)?.note : data.actions.find(action => 'a:' + action.id === box.id)?.note}</title>
        </text>
      </g>)}
    </svg>
  </div>;
}

export function ProcessEditor({ data, change }: { data: ProcessData; change: (value: ProcessData) => void }) {
  const [selected, setSelected] = useState<Selection | null>(null);
  const node = selected?.kind === 'material' ? data.nodes.find(item => item.id === selected.id) : undefined;
  const action = selected?.kind === 'action' ? data.actions.find(item => item.id === selected.id) : undefined;
  const patchNode = (values: Partial<ProcessData['nodes'][number]>) => node && change({ ...data, nodes: data.nodes.map(item => item.id === node.id ? { ...item, ...values } : item) });
  const patchAction = (values: Partial<ProcessData['actions'][number]>) => action && change({ ...data, actions: data.actions.map(item => item.id === action.id ? { ...item, ...values } : item) });
  return <div className="record-flow-editor"><ProcessView data={data} onSelect={setSelected} selected={selected} />
    <p className="record-note">点击图中的物质或动作编辑，也可从下方选择。</p>
    <div className="record-controls record-process-choices"><label className="record-label">编辑对象<select aria-label="编辑对象" value={selected ? `${selected.kind}:${selected.id}` : ''} onChange={e => { const [kind, id] = e.target.value.split(':'); setSelected(id ? { kind: kind as Selection['kind'], id } : null); }}><option value="">选择物质或动作…</option>{data.nodes.map(item => <option key={'m' + item.id} value={`material:${item.id}`}>物质 · {item.label}</option>)}{data.actions.map(item => <option key={'a' + item.id} value={`action:${item.id}`}>动作 · {item.label}</option>)}</select></label>
      <button type="button" onClick={() => { const id = newId(); change({ ...data, nodes: [...data.nodes, { id, label: '新物质' }] }); setSelected({ kind: 'material', id }); }}>添加物质</button>
      <button type="button" disabled={data.nodes.length < 2} onClick={() => { const id = newId(); change({ ...data, actions: [...data.actions, { id, label: '新动作', source_ids: [data.nodes[0].id], target_ids: [data.nodes[1].id], parameters: [] }] }); setSelected({ kind: 'action', id }); }}>添加动作</button>
    </div>
    {node && <div className="record-object-editor"><h4>编辑物质 / 中间状态</h4><div className="record-form-grid"><label className="record-label">物质名称<input aria-label="物质名称" value={node.label} onChange={e => patchNode({ label: e.target.value })} /></label><label className="record-label">物质备注<input aria-label="物质备注" value={node.note || ''} onChange={e => patchNode({ note: e.target.value })} /></label></div><button type="button" className="record-danger" onClick={() => { const layout = { ...data.layout }; delete layout[node.id]; change({ ...data, layout, nodes: data.nodes.filter(n => n.id !== node.id), actions: data.actions.filter(a => !a.source_ids.includes(node.id) && !a.target_ids.includes(node.id)) }); setSelected(null); }}>删除物质及关联动作</button></div>}
    {action && <div className="record-object-editor"><h4>编辑动作</h4><div className="record-form-grid"><label className="record-label">动作名称<input aria-label="动作名称" value={action.label} onChange={e => patchAction({ label: e.target.value })} /></label><label className="record-label">重复说明<input aria-label="重复说明" placeholder="例如：重复 3 次" value={action.repeat_note || ''} onChange={e => patchAction({ repeat_note: e.target.value })} /></label></div>
      {(['source_ids', 'target_ids'] as const).map(key => <div className="record-node-choices" role="group" aria-label={key === 'source_ids' ? '输入物质' : '输出物质'} key={key}><strong>{key === 'source_ids' ? '输入物质' : '输出物质'}</strong><div>{data.nodes.map(item => <label key={item.id}><input type="checkbox" checked={action[key].includes(item.id)} onChange={e => patchAction({ [key]: e.target.checked ? [...action[key], item.id] : action[key].filter(id => id !== item.id) })} />{item.label}</label>)}</div></div>)}
      <strong className="record-parameter-heading">动作参数</strong>{action.parameters.map(parameter => <div className="record-parameter-row" key={parameter.id}>{(['label', 'value', 'unit'] as const).map(key => <label className="record-label" key={key}>{{ label: '参数名称', value: '数值', unit: '单位' }[key]}<input aria-label={`参数${{ label: '名称', value: '数值', unit: '单位' }[key]}`} value={parameter[key] || ''} onChange={e => patchAction({ parameters: action.parameters.map(p => p.id === parameter.id ? { ...p, [key]: e.target.value } : p) })} /></label>)}<button type="button" aria-label={`删除参数${parameter.label}`} onClick={() => patchAction({ parameters: action.parameters.filter(p => p.id !== parameter.id) })}>删除</button></div>)}
      <div className="record-controls"><button type="button" onClick={() => patchAction({ parameters: [...action.parameters, { id: newId(), label: '参数', value: '', unit: '' }] })}>添加参数</button><button type="button" className="record-danger" onClick={() => { change({ ...data, actions: data.actions.filter(a => a.id !== action.id) }); setSelected(null); }}>删除动作</button></div>
      <label className="record-label">动作备注<textarea rows={2} value={action.note || ''} onChange={e => patchAction({ note: e.target.value })} /></label>
    </div>}
  </div>;
}
