import { services } from '../../runtime/services';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { Timeline } from './Timeline';
import { Comparison } from './Comparison';
import { TemplateLibrary } from './TemplateLibrary';
import { canRenderPage } from '../../app/PageHost';

afterEach(() => vi.unstubAllGlobals());
const reply = (data: unknown) => new Response(JSON.stringify({ data }));
test('时间线保留顺序和状态样式，点击进入对应详情', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => reply([{ id: 'E1', date: '2026-10-01', title: 'Earlier', status: 'done', tags: ['XRD'] }, { id: 'E2', date: '2026-10-02', title: 'Later', status: 'running' }])));
  const navigate = vi.fn(), user = userEvent.setup(); Object.assign(services, { PanelManager: { navigate } }); render(<Timeline />); await user.click(await screen.findByText('Earlier'));
  expect(navigate).toHaveBeenCalledWith('/experiments/E1'); expect(screen.getByText('已完成')).toHaveClass('status-done');
});
test('模板库保留卡片内容并进入原创建入口', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => reply([{ id: 'T1', title: 'Template', category: 'Test', description: 'Description', tags: ['A'] }])));
  const navigate = vi.fn(), user = userEvent.setup(); Object.assign(services, { PanelManager: { navigate } }); render(<TemplateLibrary />); await user.click(await screen.findByText('Template'));
  expect(navigate).toHaveBeenCalledWith('/new?template=T1'); expect(screen.getByText('Description')).toBeInTheDocument();
});
test('对比按原章节显示各记录，有数据的章节才显示；所有业务路由已交由 React', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => reply([{ id: 'E1', purpose: 'One', materials: [{ name: 'Copper' }], results: { qualitative: 'Result' } }, { id: 'E2', purpose: 'Two', conclusion: 'Conclusion' }])));
  render(<Comparison />); await screen.findByText('One'); expect(screen.getByText('Copper')).toBeInTheDocument(); expect(screen.queryByText('3. 设备')).toBeNull(); expect(screen.getByText('Conclusion')).toBeInTheDocument();
  for (const path of ['/experiments','/experiments/E1','/favorites','/timeline','/templates','/compare','/analyze','/analysis/R1','/settings','/login']) expect(canRenderPage(path)).toBe(true);
});
