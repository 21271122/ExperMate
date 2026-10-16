import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { LoginPage } from './LoginPage';

afterEach(() => vi.unstubAllGlobals());
test('原登录页显示认证错误、清理请求，并在切换注册时清空密码', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: false, error: '账号或密码错误' }), { status: 401 }));
  vi.stubGlobal('fetch', fetchMock);
  const user = userEvent.setup(), view = render(<LoginPage />);
  await user.type(screen.getByPlaceholderText('用户名', { exact: true }), 'fixture-user');
  await user.type(screen.getByPlaceholderText('密码', { exact: true }), 'test-password');
  await user.click(document.querySelector('#login-form button')!);
  await screen.findByText('账号或密码错误');
  expect(fetchMock).toHaveBeenCalledWith('/api/e2ee/login', expect.objectContaining({ body: JSON.stringify({ account: 'fixture-user', password: 'test-password' }) }));
  await user.click(document.getElementById('tab-register-btn')!);
  expect(screen.getByPlaceholderText('密码', { exact: true })).toHaveValue('');
  expect(document.getElementById('register-form')).toHaveClass('active');
  view.unmount();
  expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].signal?.aborted).toBe(true);
});
