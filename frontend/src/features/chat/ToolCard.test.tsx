import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { ToolCard, hasToolCard } from './ToolCard';
import type { ToolResult } from './tool-model';
import { services } from '../../runtime/services';

function mountCard(result: ToolResult) {
  const resolveSelector = vi.fn(async () => {}), send = vi.fn();
  const api = { setSending: vi.fn(), client: () => ({ resolveSelector }), send, showToast: vi.fn(), appendSystemMsg: vi.fn() };
  const view = render(<ToolCard result={result} api={api} />);
  expect(view.container.querySelector('[onclick],[oninput]')).toBeNull();
  return { ...view, resolveSelector, send, api, user: userEvent.setup() };
}

test('工具卡片使用正常链接，查询结果通过模块接口导航', async () => {
  const navigate = vi.fn(); Object.assign(services, { PanelManager: { navigate } });
  const view = mountCard({ display: 'list', experiments: [{ id: 'A/B', title: 'Result' }] });
  await view.user.click(screen.getByText('Result', { exact: false }));
  expect(navigate).toHaveBeenCalledWith('/experiments/A%2FB', expect.any(HTMLElement));
  view.unmount();
  mountCard({ display: 'record_generated', exp_id: 'A/B', title: 'Record' });
  expect(screen.getByRole('link', { name: 'View Experiment →' })).toHaveAttribute('href', '/experiments/A%2FB');
});

test('选择器通过 React 点击处理全选、取消和确认，不依赖全局函数', async () => {
  const view = mountCard({ display: 'selector', _tcId: 'T1', items: [{ id: 'E1', title: 'First' }, { id: 'E2', title: 'Second' }] });
  await view.user.click(screen.getByRole('button', { name: 'Select All' }));
  await view.user.click(screen.getByRole('button', { name: 'Confirm (2)' }));
  await waitFor(() => expect(view.resolveSelector).toHaveBeenCalledWith('T1', ['E1', 'E2'], 'confirmed'));
  expect(view.send).toHaveBeenCalledWith('Selected: E1, E2. Continue analysis.');
  view.unmount();
  const cancelled = mountCard({ display: 'selector', _tcId: 'T2', items: [{ id: 'E1', title: 'First' }] });
  await cancelled.user.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(cancelled.resolveSelector).toHaveBeenCalledWith('T2', [], 'cancelled'));
});

test('更多记录可搜索、选择并同步计数，卸载清理弹窗', async () => {
  const items = Array.from({ length: 9 }, (_, index) => ({ id: `E${index}`, title: index ? `Record ${index}` : "O'Brien" }));
  const view = mountCard({ display: 'selector', _tcId: 'T2', items });
  await view.user.click(screen.getByRole('button', { name: 'Show More (9 total)' }));
  const modal = document.getElementById('sel-modal-overlay')!;
  await view.user.type(within(modal).getByRole('textbox'), "O'Brien");
  expect(within(modal).getByText('Record 1').closest('.sel-item')).not.toBeVisible();
  await view.user.click(within(modal).getByText("O'Brien"));
  await view.user.click(within(modal).getByRole('button', { name: 'Confirm' }));
  expect(modal).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Confirm (1)' })).toBeInTheDocument();
  await view.user.click(screen.getByRole('button', { name: 'Show More (9 total)' }));
  view.unmount();
  expect(document.getElementById('sel-modal-overlay')).toBeNull();
});

test('第九条及以后的记录在弹窗选择后也会提交，不依赖主卡片的前八个 DOM 节点', async () => {
  const items = Array.from({ length: 10 }, (_, index) => ({ id: `E${index}`, title: `Record ${index}` }));
  const view = mountCard({ display: 'selector', _tcId: 'T9', items });
  await view.user.click(screen.getByRole('button', { name: 'Show More (10 total)' }));
  const modal = document.getElementById('sel-modal-overlay')!;
  await view.user.click(within(modal).getByText('Record 9'));
  await view.user.click(within(modal).getByRole('button', { name: 'Confirm' }));
  await view.user.click(screen.getByRole('button', { name: 'Confirm (1)' }));
  await waitFor(() => expect(view.resolveSelector).toHaveBeenCalledWith('T9', ['E9'], 'confirmed'));
});

test('请求中阻止重复确认，提交失败后保留勾选并允许重试', async () => {
  const view = mountCard({ display: 'selector', _tcId: 'T1', items: [{ id: 'E1', title: 'First' }], preselected: ['E1'] });
  let reject!: (error: Error) => void;
  view.resolveSelector.mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
  await view.user.dblClick(screen.getByRole('button', { name: 'Confirm (1)' }));
  expect(view.resolveSelector).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  await act(async () => reject(new Error('提交失败')));
  expect(view.api.showToast).toHaveBeenCalledWith('提交失败');
  await view.user.click(screen.getByRole('button', { name: 'Confirm (1)' }));
  expect(view.resolveSelector).toHaveBeenCalledTimes(2);
});

test('历史选择结果保持只读，过期卡片不会重新提交，历史提示不重复弹出', () => {
  const view = mountCard({ display: 'selector', status: 'confirmed', selected_ids: ['E1'] });
  expect(screen.getByText('Selected 1 experiments: E1')).toBeInTheDocument();
  expect(screen.queryByRole('button')).toBeNull(); view.unmount();
  const api = { setSending: vi.fn(), showToast: vi.fn(), appendSystemMsg: vi.fn(), send: vi.fn(), client: () => ({ resolveSelector: vi.fn() }) };
  const expired = render(<ToolCard result={{ display: 'selector' }} historical api={api} />);
  expect(screen.getByText('Auto-cancelled')).toBeInTheDocument(); expect(api.setSending).toHaveBeenCalledWith(false);
  expired.unmount();
  render(<ToolCard result={{ display: 'toast', message: 'Old toast' }} historical api={api} />);
  expect(api.showToast).not.toHaveBeenCalled();
});

test('空搜索结果和空变更保持隐藏，不产生空卡片或未知工具提示', () => {
  for (const result of [{ display: 'list', experiments: [] }, { display: 'diff', changes: [] }]) {
    const view = mountCard(result);
    expect(hasToolCard(result)).toBe(false);
    expect(view.container).toBeEmptyDOMElement();
    expect(view.api.appendSystemMsg).not.toHaveBeenCalled();
    view.unmount();
  }
});

test.each([
  [{ display: 'diff', changes: [{ field: 'title', old: '<img>', new: 'New' }] }, '.diff-row', '<img>'],
  [{ display: 'answer', question: 'Why?', answer: 'Answer', exp_ids: ['E1'] }, '.answer', 'Answer'],
  [{ display: 'report', markdown: '**Report**' }, '.report strong', 'Report'],
  [{ display: 'analysis_done', anal_id: 'R1', topic: 'Analysis', summary: '**Summary**' }, '.analysis_done strong', 'R1'],
  [{ display: 'music_control', action: 'play', track: { title: 'Canon' } }, '.music-play strong', 'Canon'],
] as const)('结果卡片保留原 class、文本和 Markdown，普通字段按文本渲染：%j', (result, selector, text) => {
  const view = mountCard(result as ToolResult);
  expect(view.container.querySelector(selector)).toHaveTextContent(text);
  expect(view.container.querySelector('img')).toBeNull();
});
