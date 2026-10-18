import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { RecordDocument, FieldView } from './RecordDocument';
import { ProcessEditor } from './ProcessField';
import { newField, type RecordDocument as DocumentData, type RecordField, type ProcessData } from './model';
import { StructureProposal } from './StructureProposal';

test('三板块编辑允许一层字段、表格行列和直接内容修改', () => {
  function Editor() {
    const [value, setValue] = useState<DocumentData>({ format_version: 2, sections: [{ id: 'conditions', fields: [] }, { id: 'process', fields: [] }, { id: 'results', fields: [] }], sources: [] });
    return <><RecordDocument value={value} change={setValue} /><output>{JSON.stringify(value)}</output></>;
  }
  render(<Editor />);
  fireEvent.click(screen.getAllByText('添加字段')[0]);
  fireEvent.click(screen.getAllByRole('button', { name: '＋表格字段' })[0]);
  fireEvent.click(screen.getByText('字段设置'));
  fireEvent.change(screen.getByLabelText('字段名称'), { target: { value: '药品列表' } });
  fireEvent.click(screen.getByRole('button', { name: '添加行' }));
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: '乙醇' } });
  expect(screen.getByRole('status')).toHaveTextContent('乙醇');
  fireEvent.change(screen.getByLabelText('移动至板块'), { target: { value: 'process' } });
  expect(screen.getByRole('status')).toHaveTextContent('药品列表');
  expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(3);
});

test('切换字段编辑保留未保存内容，默认显示预览并收起结构设置', () => {
  function Editor() {
    const [value, setValue] = useState<DocumentData>({ format_version: 2, sections: [{ id: 'conditions', fields: [{ ...newField('text'), id: 'a', label: '目的' }, { ...newField('text'), id: 'b', label: '备注说明' }] }, { id: 'process', fields: [] }, { id: 'results', fields: [] }], sources: [] });
    return <RecordDocument value={value} change={setValue} />;
  }
  render(<Editor />);
  expect(screen.queryByRole('textbox')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '编辑目的' }));
  expect(screen.getByText('字段设置').closest('details')).not.toHaveAttribute('open');
  fireEvent.change(screen.getByLabelText('目的内容'), { target: { value: '测量不同浓度的影响' } });
  fireEvent.click(screen.getByRole('button', { name: '编辑备注说明' }));
  expect(screen.getByText('测量不同浓度的影响')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '编辑目的' }));
  expect(screen.getByLabelText('目的内容')).toHaveValue('测量不同浓度的影响');
});

test('选择流程图动作修改共享参数，切换物质后仍保留并更新预览', () => {
  function Editor() {
    const [data, setData] = useState<ProcessData>({ nodes: [{ id: 'a', label: '溶液 A' }, { id: 'b', label: '溶液 B' }, { id: 'c', label: '混合液' }], actions: [{ id: 'mix', label: '搅拌', source_ids: ['a', 'b'], target_ids: ['c'], parameters: [{ id: 'time', label: '时间', value: '10', unit: 'min' }] }] });
    return <ProcessEditor data={data} change={setData} />;
  }
  render(<Editor />);
  expect(screen.queryByLabelText('参数数值')).toBeNull();
  fireEvent.keyDown(screen.getByRole('button', { name: '编辑动作：搅拌' }), { key: 'Enter' });
  fireEvent.change(screen.getByLabelText('参数数值'), { target: { value: '15' } });
  fireEvent.click(screen.getByRole('button', { name: '编辑物质：混合液' }));
  fireEvent.change(screen.getByLabelText('物质名称'), { target: { value: '搅拌后混合液' } });
  fireEvent.change(screen.getByLabelText('编辑对象'), { target: { value: 'action:mix' } });
  expect(screen.getByLabelText('参数数值')).toHaveValue('15');
  expect(screen.getAllByText('搅拌 · 时间 15min').length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: '编辑物质：搅拌后混合液' })).toBeInTheDocument();
});

test('新正文清洗不可信 Markdown 并本地排版公式', () => {
  const field = newField('text') as Extract<RecordField, { kind: 'text' }>;
  field.content.text = '**已记录**<img src=x onerror="alert(1)"><script>alert(1)</script>[恶意](javascript:alert(1))';
  const { container, rerender } = render(<FieldView field={field} />);
  expect(screen.getByText('已记录').tagName).toBe('STRONG');
  expect(container.querySelector('script,[onerror],a[href^="javascript:"]')).toBeNull();
  const formula = newField('formula') as Extract<RecordField, { kind: 'formula' }>;
  formula.content.latex = 'm = c V M';
  rerender(<FieldView field={formula} />);
  expect(container.querySelector('.katex')).not.toBeNull();
});

test('流程图节点为物质，多个输入共享同一个动作参数', () => {
  const field = newField('process') as Extract<RecordField, { kind: 'process' }>;
  field.content = { nodes: [{ id: 'a', label: '溶液 A' }, { id: 'b', label: '溶液 B' }, { id: 'c', label: '混合液' }], actions: [{ id: 'mix', label: '搅拌', source_ids: ['a', 'b'], target_ids: ['c'], parameters: [{ id: 'time', label: '时间', value: '10', unit: 'min' }] }] };
  const { container } = render(<FieldView field={field} />);
  expect(screen.getByRole('img', { name: '物质与操作流程图' })).toBeInTheDocument();
  expect(container.querySelectorAll('rect')).toHaveLength(3);
  expect(container.querySelectorAll('path[marker-end]')).toHaveLength(1);
  expect(container.querySelectorAll('path[stroke]')).toHaveLength(3);
  expect(screen.getAllByText('搅拌 · 时间 10min').length).toBeGreaterThan(0);
});

test('结构方案加载后不自动批准，手动按钮发送绑定哈希与版本', async () => {
  const document: DocumentData = { format_version: 2, sections: [{ id: 'conditions', fields: [] }, { id: 'process', fields: [] }, { id: 'results', fields: [] }], sources: [] };
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'p1', base_revision: 3, hash: 'bound-hash', status: 'pending', before: document, document } }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: { revision: 4 } }), { status: 200 }));
  const updated = vi.fn();
  render(<StructureProposal id="p1" updated={updated} />);
  const approve = await screen.findByRole('button', { name: '批准此方案' });
  expect(screen.getByText('查看完整方案').closest('details')).toHaveAttribute('open');
  expect(fetcher).toHaveBeenCalledTimes(1);
  fireEvent.click(approve);
  await screen.findByText('基于修订 3 · 已批准');
  expect(screen.getByText('查看完整方案').closest('details')).not.toHaveAttribute('open');
  expect(JSON.parse(fetcher.mock.calls[1][1]?.body as string)).toEqual({ decision: 'approved', base_revision: 3, proposal_hash: 'bound-hash' });
  expect(updated).toHaveBeenCalledOnce(); fetcher.mockRestore();
});
