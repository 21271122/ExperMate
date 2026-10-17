import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { ChildConversation } from './ChildConversation';

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const event = (body: unknown) => new TextEncoder().encode('data: ' + JSON.stringify(body) + '\n\n');
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });

test('子对话流式结束后按服务端历史对齐、不重复消息，生成期间保留下一条草稿', async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
    const body = JSON.parse(String(options?.body));
    return !body.message ? reply({ ok: true, state: { history: [], turn_count: 0 } })
      : new Response(new ReadableStream({ start(controller) { stream = controller; } }));
  }); vi.stubGlobal('fetch', fetchMock);
  const updated = vi.fn(), user = userEvent.setup(); render(<ChildConversation expId="E1" updated={updated} />);
  const input = screen.getByPlaceholderText('描述需要修改的内容…'); await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).toBeEnabled());
  await user.type(input, '<b>change</b>'); await user.click(screen.getByRole('button', { name: '发送' }));
  await user.type(input, 'next draft'); expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
  stream.enqueue(event({ event: 'text', content: '已' })); stream.enqueue(event({ event: 'text', content: '修改' }));
  stream.enqueue(event({ event: 'done', state: { history: [{ role: 'user', content: '<b>change</b>' }, { role: 'assistant', content: '已修改' }], turn_count: 1, modified_values: { title: 'updated' } } })); stream.close();
  await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).toBeEnabled());
  expect(input).toHaveValue('next draft'); expect(screen.getAllByText('已修改')).toHaveLength(1); expect(document.querySelectorAll('#child-msgs b')).toHaveLength(0);
  expect(sessionStorage.getItem('exdiary_child_E1')).toBeNull();
  await user.click(screen.getByRole('button', { name: '关闭' })); expect(updated).toHaveBeenCalledOnce(); expect(fetchMock).toHaveBeenCalledTimes(2);
});

test('旧记录提取预览由确认接口保存，失败保持预览且支持重试', async () => {
  let attempts = 0;
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith('/confirm')) return ++attempts === 1 ? reply({ ok: false, error: '保存失败' }, 503) : reply({ ok: true });
    const body = JSON.parse(String(options?.body));
    return !body.message ? reply({ ok: true, is_legacy: true }) : new Response(new ReadableStream({ start(controller) {
      controller.enqueue(event({ event: 'done', type: 'extract', preview: { title: 'Preview title' }, state: { history: [], turn_count: 1 } })); controller.close();
    } }));
  }); vi.stubGlobal('fetch', fetchMock);
  const user = userEvent.setup(), updated = vi.fn(); render(<ChildConversation expId="E1" updated={updated} />);
  await user.click(await screen.findByRole('button', { name: '开始对话' }));
  const preview = within(document.getElementById('child-preview')!); await preview.findByText(/Preview title/);
  await user.click(preview.getByRole('button', { name: 'Confirm' })); expect(await screen.findByRole('alert')).toHaveTextContent('保存失败'); expect(updated).not.toHaveBeenCalled();
  await user.click(preview.getByRole('button', { name: 'Confirm' })); await waitFor(() => expect(updated).toHaveBeenCalledOnce());
});

test('离开子对话取消连接，不留下活动请求；意外结束显示错误并恢复发送', async () => {
  const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => JSON.parse(String(options?.body)).message
    ? new Response(new ReadableStream({ start(controller) { controller.enqueue(event({ event: 'text', content: 'partial' })); controller.close(); } }))
    : reply({ ok: true, state: { history: [] } })); vi.stubGlobal('fetch', fetchMock);
  const user = userEvent.setup(), view = render(<ChildConversation expId="E1" updated={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).toBeEnabled());
  await user.type(screen.getByPlaceholderText('描述需要修改的内容…'), 'change'); await user.click(screen.getByRole('button', { name: '发送' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('回复连接意外结束'); expect(screen.getByRole('button', { name: '发送' })).toBeEnabled();
  view.unmount(); expect(fetchMock.mock.calls.every(([, options]) => options?.signal?.aborted)).toBe(true);
});
