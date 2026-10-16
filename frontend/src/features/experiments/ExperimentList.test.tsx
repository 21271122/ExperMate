import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ExperimentList } from './ExperimentList';
import { type ListData } from './model';

let data: ListData;
let fetchMock: ReturnType<typeof vi.fn>;
const navigate = vi.fn();
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => {
  data = { experiments: [
    { id: 'E1', title: 'XRD first', date: '2026-10-15', status: 'done', tags: ['XRD'], purpose: 'copper', experimenter: 'alice' },
    { id: 'E2', title: 'Heating', date: '2026-10-14', status: 'running', tags: ['thermal'] },
    { id: 'E3', title: 'Old archived', archived: true, status: 'done' },
    { id: 'E4', title: 'Undated', date: 'N/A', status: 'planned', tags: ['XRD'] },
    { id: 'E5', title: 'Other XRD', date: '2026-10-13', status: 'done', tags: ['XRD'] },
  ], pinnedIds: ['E1'], collections: { crystal: ['E1'], heat: ['E2', 'E5'] }, collectionMeta: {}, categoryPinned: {} };
  fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/v1/experiment-list') return reply({ data });
    if (url === '/api/categories' && !options?.method) return reply({ collections: data.collections, meta: {}, category_pinned: data.categoryPinned });
    if (url.endsWith('/pin')) return reply({ ok: true, pinned: false });
    if (url === '/api/categories' && options?.method === 'POST') { data.collections.new = []; return reply({ ok: true }); }
    return reply({ ok: true });
  });
  vi.stubGlobal('fetch', fetchMock); Object.assign(window, { PanelManager: { navigate } });
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear(); navigate.mockClear(); });
const row = (id: string) => document.querySelector<HTMLElement>(`[data-exp-id="${id}"]`)!;
async function mount() { const user = userEvent.setup(); render(<ExperimentList path="/experiments" />); await screen.findByText('XRD first'); return user; }

test('摘要加载后使用原行结构、独立置顶和未标注日期折叠，保留搜索/归档语义', async () => {
  const user = await mount();
  expect(document.querySelector('#pinned-results > .record-row[data-exp-id="E1"]')).toBeInTheDocument();
  expect(document.querySelector('.date-group-head.collapsed .date-text')).toHaveTextContent('未标注日期');
  expect(row('E1').querySelector('.row-person')).toHaveTextContent('alice'); expect(row('E3')).toBeNull();
  await user.type(screen.getByRole('searchbox'), 'copper'); expect(row('E2')).toBeNull(); expect(row('E1')).toBeInTheDocument();
  await user.clear(screen.getByRole('searchbox'));
  await user.click(screen.getByRole('button', { name: '筛选' })); await user.click(screen.getByRole('button', { name: '已归档' }));
  expect(row('E3')).toHaveClass('archived-record'); expect(row('E1')).toBeNull();
});

test('分类搜索显示其他分类匹配，标签为 OR，日期排除未标注记录', async () => {
  const user = await mount();
  await user.click(screen.getByRole('button', { name: '分类' })); await user.click(screen.getByText('crystal'));
  expect(row('E5')).toBeNull(); await user.type(screen.getByRole('searchbox'), 'XRD');
  expect(row('E5')).toHaveClass('other-result'); expect(document.getElementById('other-divider')).not.toHaveAttribute('hidden');
  await user.clear(screen.getByRole('searchbox'));
  await user.click(screen.getByRole('button', { name: '分类' })); await user.click(screen.getByText('全部实验'));
  await user.click(screen.getByRole('button', { name: '筛选' }));
  await user.click(screen.getByRole('button', { name: 'XRD' })); await user.click(screen.getByRole('button', { name: 'thermal' }));
  expect(row('E1')).toBeInTheDocument(); expect(row('E2')).toBeInTheDocument(); expect(row('E4')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Date from'), { target: { value: '2026-10-14' } }); expect(row('E4')).toBeNull(); expect(row('E5')).toBeNull();
});

test('卡片和对比均由 React 更新，离开对比清空选择，正常点击进入原详情路由', async () => {
  const user = await mount(); await user.click(screen.getByTitle('卡片视图'));
  expect(row('E1')).toHaveClass('record-card', 'pinned-card'); expect(sessionStorage.getItem('exdiary_list_view')).toBe('cards');
  await user.click(screen.getByRole('button', { name: '对比' })); await user.click(row('E1')); await user.click(row('E2'));
  expect(row('E1')).toHaveClass('selected'); await user.click(screen.getByRole('button', { name: '开始对比' }));
  expect(navigate).toHaveBeenCalledWith('/compare?ids=E1,E2');
  await user.click(screen.getByRole('button', { name: '对比' })); expect(row('E1')).not.toHaveClass('selected');
  await user.click(row('E1')); expect(navigate).toHaveBeenLastCalledWith('/experiments/E1');
});

test('菜单置顶和新建分类使用原接口，更新 React 数据且不触发详情导航', async () => {
  const user = await mount(); await user.click(within(row('E1')).getByRole('button', { name: 'Experiment actions' }));
  await user.click(screen.getByRole('button', { name: 'Unpin Globally' }));
  await waitFor(() => expect(document.getElementById('pinned-results')).toHaveAttribute('hidden'));
  expect(navigate).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '分类' })); await user.click(screen.getByRole('button', { name: '编辑' }));
  await user.click(screen.getByRole('button', { name: '+ 新建分类' }));
  await user.type(screen.getByLabelText('Name'), 'new'); await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('new')).toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([url, options]) => url === '/api/categories' && options?.body === JSON.stringify({ name: 'new', description: '' }))).toBe(true);
});

test('恢复过滤条件时不恢复旧搜索', async () => {
  localStorage.setItem('exdiary_view_state', JSON.stringify({ '/experiments': { search: 'stale', status: 'running', tags: [], dateFrom: '', dateTo: '' } }));
  const user = userEvent.setup(); render(<ExperimentList path="/experiments" />); await screen.findByText('Heating');
  expect(screen.getByRole('searchbox')).toHaveValue(''); expect(row('E2')).toBeInTheDocument(); expect(row('E1')).toBeNull();
  await user.click(screen.getByRole('button', { name: /筛选/ })); await user.click(screen.getByRole('button', { name: '全部' })); expect(row('E1')).toBeInTheDocument();
});

test('未登录时显示失败提示并打开原账号窗', async () => {
  const showAuthModal = vi.fn(); Object.assign(window, { showAuthModal });
  fetchMock.mockResolvedValueOnce(reply({ error: { message: '请先登录' } }, 401));
  render(<ExperimentList path="/experiments" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('请先登录'); expect(showAuthModal).toHaveBeenCalledOnce();
});

test('手机工具面板通过 Portal 保持事件可用，关闭和卸载不留下浮层', async () => {
  const user = userEvent.setup(); const view = render(<ExperimentList path="/experiments" />); await screen.findByText('XRD first');
  const list = (window as unknown as { ExperMateList: { openPanelPopup: (name: string) => void } }).ExperMateList;
  act(() => list.openPanelPopup('filters'));
  const popup = document.getElementById('shell-panel-popup')!;
  expect(popup.parentElement).toBe(document.body); expect(document.querySelectorAll('#panel-filters')).toHaveLength(1);
  await user.click(within(popup).getByRole('button', { name: '进行中' })); expect(row('E1')).toBeNull(); expect(row('E2')).toBeInTheDocument();
  await user.click(within(popup).getByRole('button', { name: '×' })); expect(document.getElementById('shell-panel-popup')).toBeNull();
  act(() => list.openPanelPopup('categories')); await user.click(within(document.getElementById('shell-panel-popup')!).getByText('heat'));
  view.unmount(); expect(document.getElementById('shell-panel-popup')).toBeNull();
});

test('分类分配部分失败时刷新已保存状态，避免重试反向切换成功的分类', async () => {
  const user = await mount();
  fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/favorite')) {
      const name = JSON.parse(String(options?.body)).collection;
      if (name === 'heat') return reply({ ok: false, error: '分类保存失败' }, 503);
      data.collections.crystal = []; return reply({ ok: true });
    }
    return reply({ collections: data.collections, meta: {}, category_pinned: {} });
  });
  await user.click(within(row('E1')).getByRole('button', { name: 'Experiment actions' }));
  await user.click(screen.getByRole('button', { name: 'Categorize (1)' }));
  const modal = within(document.getElementById('category-modal')!);
  await user.click(modal.getByRole('checkbox', { name: 'crystal' })); await user.click(modal.getByRole('checkbox', { name: 'heat' }));
  await user.click(modal.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('分类保存失败');
  expect(document.getElementById('category-modal')).toHaveAttribute('hidden');
  await user.click(within(row('E1')).getByRole('button', { name: 'Experiment actions' }));
  expect(within(row('E1')).getByRole('button', { name: 'Categorize' })).toBeInTheDocument();
});
