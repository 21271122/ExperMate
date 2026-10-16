import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ExperimentDetail } from './ExperimentDetail';
import type { ExperimentDetailData } from './detail-model';

let record: ExperimentDetailData;
let fetchMock: ReturnType<typeof vi.fn>;
let conflict = false;
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => {
  record = { id: 'E1', revision: 4, title: 'Original title', date: '2026-10-16', status: 'done', tags: ['XRD'],
    purpose: 'Original purpose', original_notes: '<p><strong>Rich notes</strong></p>', conclusion: 'Original conclusion',
    materials: [{ name: 'Copper', amount: '1 g', purity: '99%', vendor: 'A', notes: '' }], sop: ['1. Heat'], next_steps: ['[ ] Measure'],
    results: { qualitative: 'Done', figures: [{ url: 'keep-me' }] }, attachments: [], referenced_by: ['E2'], analyzed_in: ['R1'] };
  conflict = false;
  fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/v1/experiments/E1') return reply({ data: record });
    if (url === '/api/experiments/E1/attachments') return reply({ ok: true, attachments: record.attachments });
    if (url.endsWith('/save-json')) {
      if (conflict) return reply({ ok: false, error: 'revision_conflict', revision: 7 }, 409);
      record = { ...JSON.parse(String(options?.body)), revision: 5 }; return reply({ ok: true, revision: 5 });
    }
    if (url.endsWith('/archive') || url.endsWith('/restore')) { record = { ...record, revision: record.revision! + 1, archived: url.endsWith('/archive') }; return reply({ ok: true, revision: record.revision }); }
    return reply({ ok: true });
  });
  vi.stubGlobal('fetch', fetchMock); vi.stubGlobal('confirm', vi.fn(() => true));
});
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); localStorage.clear(); });
async function mount() { const user = userEvent.setup(); render(<ExperimentDetail expId="E1" />); await screen.findByRole('heading', { name: 'Original title' }); return user; }
async function changeTitle(user: ReturnType<typeof userEvent.setup>, value: string) {
  await user.click(document.querySelector('#field-title .editable-dashed')!);
  await user.clear(screen.getByRole('textbox', { name: 'Title' })); await user.type(screen.getByRole('textbox', { name: 'Title' }), value);
  await user.click(within(document.getElementById('edit-modal')!).getByRole('button', { name: '确认' }));
}

test('详情保留原字段结构，取消编辑恢复数据且不发送保存', async () => {
  const user = await mount(); expect(document.getElementById('sop-list')).toHaveTextContent('Heat'); expect(document.getElementById('next-steps-view')).toHaveTextContent('Measure');
  await user.click(screen.getByRole('button', { name: '编辑' })); expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
  await changeTitle(user, 'Changed title'); expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: '取消' })); expect(screen.getByRole('heading', { name: 'Original title' })).toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/save-json'))).toBe(false);
});

test('保存携带初始版本号并保留嵌套结果、附件和分析关系，成功后退出编辑', async () => {
  const user = await mount(); await user.click(screen.getByRole('button', { name: '编辑' })); await changeTitle(user, 'Saved title');
  await user.click(screen.getByRole('button', { name: '保存' })); await screen.findByText('已保存 · 修订 5');
  const saved = JSON.parse(String(fetchMock.mock.calls.find(([url]) => url.endsWith('/save-json'))![1]?.body));
  expect(saved).toMatchObject({ expected_revision: 4, title: 'Saved title', results: { figures: [{ url: 'keep-me' }] }, referenced_by: ['E2'], analyzed_in: ['R1'], attachments: [] });
  expect(screen.getByRole('button', { name: '编辑' })).toBeVisible(); expect(screen.getByRole('heading', { name: 'Saved title' })).toBeInTheDocument();
});

test('409 保留草稿并禁止用服务器新版本号重试，加载最新内容须确认丢弃草稿', async () => {
  const user = await mount(); await user.click(screen.getByRole('button', { name: '编辑' })); await changeTitle(user, 'My draft'); conflict = true;
  await user.click(screen.getByRole('button', { name: '保存' })); await screen.findByText('内容已在另一窗口更新；本次修改未保存。');
  expect(screen.getByRole('heading', { name: 'My draft' })).toBeInTheDocument(); expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
  record = { ...record, revision: 7, title: 'Remote title' }; await user.click(screen.getByRole('button', { name: '加载最新内容' }));
  expect(confirm).toHaveBeenCalled(); await screen.findByRole('heading', { name: 'Remote title' });
  expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/save-json'))).toHaveLength(1);
});

test('HTML 编辑确认保留格式，表格增删与数组修改进入同一草稿', async () => {
  const user = await mount(); await user.click(screen.getByRole('button', { name: '编辑' }));
  await user.click(document.querySelector('[data-field="original_notes"]')!);
  const rich = screen.getByRole('textbox', { name: 'Original Notes' }); rich.innerHTML = '<p><em>New rich notes</em></p>'; fireEvent.input(rich);
  await user.click(within(document.getElementById('edit-modal')!).getByRole('button', { name: '确认' }));
  const tableSection = document.getElementById('table-materials')!.closest('details')!;
  await user.click(within(tableSection).getByRole('button', { name: '+ 添加一行' })); expect(document.querySelectorAll('#table-materials tbody tr')).toHaveLength(2);
  await user.click(within(tableSection).getAllByRole('button', { name: 'X' })[1]);
  await user.click(screen.getByRole('button', { name: '保存' })); await screen.findByText('已保存 · 修订 5');
  expect(record.original_notes).toBe('<p><em>New rich notes</em></p>'); expect(record.materials).toHaveLength(1);
});

test('归档和恢复使用当前版本号，编辑期间禁用附件及其他写操作', async () => {
  const user = await mount(); await user.click(screen.getByRole('button', { name: '归档' })); await screen.findByRole('button', { name: '恢复到实验列表' });
  expect(JSON.parse(String(fetchMock.mock.calls.find(([url]) => url.endsWith('/archive'))![1]?.body))).toEqual({ expected_revision: 4 });
  await user.click(screen.getByRole('button', { name: '恢复到实验列表' })); await screen.findByRole('button', { name: '归档' });
  await user.click(screen.getByRole('button', { name: '编辑' })); expect(screen.getByRole('button', { name: '归档' })).toBeDisabled();
  expect(document.getElementById('attachment-section')).toHaveAttribute('inert'); expect(screen.getByRole('button', { name: '对话编辑' })).toBeDisabled();
});

test('附件部分成功后只保留失败文件，后续正文保存保留已上传引用', async () => {
  const user = await mount(); let first = true;
  const base = fetchMock.getMockImplementation() as (url: string, options?: RequestInit) => Promise<Response>;
  fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url === '/api/attachments') {
      if (!first) return reply({ ok: false, error: '第二个附件失败' }, 503); first = false;
      record = { ...record, revision: 5, attachments: [{ sha256: 'a', url: '/api/attachments/a', name: 'a.txt' }] };
      return reply({ ok: true, revision: 5, attachment: record.attachments![0] });
    } return base(url, options);
  });
  await user.upload(document.getElementById('attachment-file') as HTMLInputElement, [new File(['a'], 'a.txt', { type: 'text/plain' }), new File(['b'], 'b.txt', { type: 'text/plain' })]);
  await user.click(screen.getByRole('button', { name: '添加附件' })); await screen.findByText('第二个附件失败');
  expect(document.getElementById('attachment-file-selection')).toHaveTextContent('b.txt');
  await waitFor(() => expect(screen.getByRole('button', { name: '编辑' })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: '编辑' })); await changeTitle(user, 'After upload'); await user.click(screen.getByRole('button', { name: '保存' }));
  await screen.findByText('已保存 · 修订 5');
  const saved = JSON.parse(String(fetchMock.mock.calls.find(([url]) => url.endsWith('/save-json'))![1]?.body)); expect(saved.expected_revision).toBe(5); expect(saved.attachments[0].sha256).toBe('a');
});

test('附件已保存但完整记录刷新失败时，禁止用旧快照的新版本号继续编辑', async () => {
  const user = await mount(); const base = fetchMock.getMockImplementation() as (url: string, options?: RequestInit) => Promise<Response>;
  let uploaded = false;
  fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url === '/api/attachments') { uploaded = true; return reply({ ok: true, revision: 5 }); }
    if (url === '/api/v1/experiments/E1' && uploaded) return reply({ error: '暂时无法加载' }, 503);
    return base(url, options);
  });
  await user.upload(document.getElementById('attachment-file') as HTMLInputElement, new File(['a'], 'a.txt', { type: 'text/plain' }));
  await user.click(screen.getByRole('button', { name: '添加附件' })); await screen.findByText('附件已变更，但最新记录加载失败。请重新加载后继续编辑。');
  expect(screen.getByRole('button', { name: '编辑' })).toBeDisabled(); expect(screen.getByRole('button', { name: '加载最新内容' })).toBeEnabled();
  expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/save-json'))).toBe(false);
});
