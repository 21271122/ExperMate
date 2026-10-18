import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { RecordHistory } from './RecordHistory';
import type { RecordValue } from './model';

afterEach(() => vi.restoreAllMocks());
function value(revision: number): RecordValue {
  return { id: 'E1', revision, title: `历史标题 ${revision}`, document: { format_version: 2, sections: [{ id: 'conditions', fields: [{ id: 'a', label: '目的', kind: 'text', presentation: 'text', content: { text: `历史正文 ${revision}` } }] }, { id: 'process', fields: [] }, { id: 'results', fields: [] }], sources: [] } };
}
const reply = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status });

test('历史可只读预览，查看不会切换；当前内容版本与并发修订号分开', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(reply([{ revision: 2, title: '第二版', summary: '新条件', is_current: true }, { revision: 1, title: '第一版', summary: '旧条件' }])).mockResolvedValueOnce(reply(value(1)));
  const switchVersion = vi.fn(async () => {});
  const { rerender } = render(<RecordHistory current={{ ...value(7), content_revision: 2 }} locked={false} close={vi.fn()} switchVersion={switchVersion} />);
  await screen.findByRole('button', { name: '查看版本 1' });
  expect(screen.queryByText('历史正文 1')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '查看版本 1' }));
  const preview = await screen.findByRole('region', { name: '版本 1 内容预览' });
  expect(within(preview).getByText('历史正文 1')).toBeVisible();
  expect(within(preview).queryByRole('textbox')).toBeNull();
  expect(switchVersion).not.toHaveBeenCalled();
  fireEvent.click(within(preview).getByRole('button', { name: '设为当前版本' }));
  expect(switchVersion).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '取消切换' }));
  expect(switchVersion).not.toHaveBeenCalled();
  fireEvent.click(within(preview).getByRole('button', { name: '设为当前版本' }));
  fireEvent.click(screen.getByRole('button', { name: '确认切换' }));
  expect(switchVersion).toHaveBeenCalledWith(1);
  fetcher.mockResolvedValueOnce(reply([{ revision: 2, title: '第二版' }, { revision: 1, title: '第一版', is_current: true }]));
  rerender(<RecordHistory current={{ ...value(8), content_revision: 1 }} locked={false} close={vi.fn()} switchVersion={switchVersion} />);
  await waitFor(() => expect(within(preview).getByRole('button', { name: '当前版本' })).toBeDisabled());
  expect(screen.queryByText('版本 8')).toBeNull();
});

test('预览读取失败时显示错误，不能切换不存在的预览', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(reply([{ revision: 1, title: '第一版' }])).mockResolvedValueOnce(new Response(JSON.stringify({ error: '无法读取历史内容' }), { status: 503 }));
  const switchVersion = vi.fn(async () => {});
  render(<RecordHistory current={value(2)} locked={false} close={vi.fn()} switchVersion={switchVersion} />);
  fireEvent.click(await screen.findByRole('button', { name: '查看版本 1' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('无法读取历史内容');
  expect(screen.queryByRole('button', { name: '设为当前版本' })).toBeNull();
  expect(switchVersion).not.toHaveBeenCalled();
});
