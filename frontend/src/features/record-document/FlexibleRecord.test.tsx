import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { FlexibleRecord } from './FlexibleRecord';
import { newField, type RecordValue } from './model';

vi.mock('../experiments/DetailAttachments', () => ({ DetailAttachments: () => <p>附件管理</p> }));
vi.mock('../experiments/ChildConversation', () => ({ ChildConversation: () => null }));
afterEach(() => vi.restoreAllMocks());

function record(): RecordValue {
  return { id: 'test-record', revision: 3, title: '原始标题', date: '2026-10-18', document: { format_version: 2, sections: [{ id: 'conditions', fields: [{ ...newField('text'), label: '实验目的' }] }, { id: 'process', fields: [] }, { id: 'results', fields: [] }], sources: [] } };
}
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

test('编辑页包含三板块；取消恢复内容，保存提交当前版本并退出编辑', async () => {
  const initial = record();
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response({ data: initial }));
  const { container } = render(<FlexibleRecord initial={initial} />);
  await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: '编辑' }));
  expect(container.querySelectorAll('.record-edit-content .record-section')).toHaveLength(3);
  expect(container.querySelector('.record-edit-content')?.tagName).toBe('DIV');
  expect(screen.getByText('附件管理')).not.toBeVisible();
  fireEvent.change(screen.getByLabelText('标题'), { target: { value: '放弃修改' } });
  fireEvent.click(screen.getByRole('button', { name: '取消编辑' }));
  expect(screen.getByRole('heading', { name: '原始标题' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '编辑' }));
  fireEvent.change(screen.getByLabelText('标题'), { target: { value: '新标题' } });
  fireEvent.click(screen.getByRole('button', { name: '编辑实验目的' }));
  fireEvent.change(screen.getByLabelText('实验目的内容'), { target: { value: '已整理的目的' } });
  fetcher.mockImplementationOnce(async (_url, options) => {
    const body = JSON.parse(options!.body as string);
    expect(body.expected_revision).toBe(3);
    expect(body.document.sections[0].fields[0].content.text).toBe('已整理的目的');
    expect(body.metadata.title).toBe('新标题');
    return response({ data: { ...initial, ...body.metadata, document: body.document, revision: 4 } });
  });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await screen.findByRole('heading', { name: '新标题' });
  expect(screen.getByText('已整理的目的')).toBeVisible();
  expect(screen.getByText('附件管理')).toBeVisible();
});

test('版本冲突保留未保存的字段内容和元数据', async () => {
  const initial = record();
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response({ data: initial }));
  render(<FlexibleRecord initial={initial} />);
  await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: '编辑' }));
  fireEvent.change(screen.getByLabelText('标题'), { target: { value: '待保存标题' } });
  fireEvent.click(screen.getByRole('button', { name: '编辑实验目的' }));
  fireEvent.change(screen.getByLabelText('实验目的内容'), { target: { value: '未保存目的' } });
  fetcher.mockResolvedValueOnce(response({ error: '版本冲突', revision: 4 }, 409));
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await screen.findByText(/版本冲突/);
  expect(screen.getByLabelText('标题')).toHaveValue('待保存标题');
  expect(screen.getByLabelText('实验目的内容')).toHaveValue('未保存目的');
  expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
});
