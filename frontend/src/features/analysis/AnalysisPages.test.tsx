import { services } from '../../runtime/services';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { AnalysisDetail, AnalysisList } from './AnalysisPages';

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
afterEach(() => vi.unstubAllGlobals());
test('分析列表导航与引用链接互不干扰，删除成功刷新列表，失败保留卡片', async () => {
  let removed = false; const navigate = vi.fn(), user = userEvent.setup(); Object.assign(services, { PanelManager: { navigate } }); vi.stubGlobal('confirm', vi.fn(() => true));
  const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method) { removed = true; return reply({ ok: true }); }
    return reply({ data: removed ? [] : [{ id: 'R1', question: 'Compare', selected_ids: ['E1'] }] });
  }); vi.stubGlobal('fetch', fetchMock); render(<AnalysisList />); await screen.findByText('Compare');
  await user.click(document.querySelector('.analysis-card')!); expect(navigate).toHaveBeenCalledWith('/analysis/R1');
  await user.click(screen.getByRole('button', { name: '删除' })); await waitFor(() => expect(document.querySelector('.analysis-card')).toBeNull());
  expect(screen.getByText('还没有分析报告')).toBeInTheDocument(); expect(fetchMock.mock.calls.some(([url, options]) => url === '/api/analysis-history/R1' && options?.method === 'DELETE')).toBe(true);
});
test('报告显示证据过期与原始内容，分析子对话使用独立接口和缓存', async () => {
  const print = vi.fn(), user = userEvent.setup(); Object.assign(services, { openAnalysisPrint: print });
  const fetchMock = vi.fn(async (url: string) => url.endsWith('/chat') ? reply({ ok: true, state: { history: [{ role: 'assistant', content: 'Review reply' }] } })
    : reply({ data: { analysis: { id: 'R1', question: 'Question', selected_ids: ['E1'], analysis: 'Report body', source_snapshot: { records: [{ id: 'E1' }], attachments: [] } }, stale_ids: ['E1'] } }));
  vi.stubGlobal('fetch', fetchMock); render(<AnalysisDetail id="R1" />); await screen.findByText('Report body');
  expect(screen.getByText(/已在报告生成后更新/)).toBeInTheDocument(); await user.click(screen.getByRole('button', { name: '打印' })); expect(print).toHaveBeenCalledWith('R1');
  await user.click(screen.getByRole('button', { name: '分析对话' })); await within(document.getElementById('child-modal')!).findByText('Review reply');
  expect(fetchMock.mock.calls.some(([url]) => url === '/api/analysis/R1/chat')).toBe(true); expect(sessionStorage.getItem('exdiary_analysis_child_R1')).toBeNull();
});
