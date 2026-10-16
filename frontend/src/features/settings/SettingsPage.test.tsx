import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';

const context = { values: { LLM_AGENT_PROVIDER: 'deepseek', LLM_AGENT_MODEL: 'test-model', LLM_REASONING_EFFORT: 'high', ANALYSIS_TIMEOUT_SECONDS: 600, GUI: false, HOST: '127.0.0.1', PORT: 5000 },
  providers: [{ id: 'deepseek', label: 'DeepSeek', base_url: 'https://example.test/v1' }, { id: 'custom', label: 'Custom', base_url: '' }], masked_agent_key: 'test****1234', masked_analyze_key: '' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

test('设置读取脱敏值，留空密钥按原表单规则提交，成功清空已输入密钥且保留页面结构', async () => {
  const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => options?.method ? reply({ ok: true, data: context, message: '保存成功' }) : reply({ data: context }));
  vi.stubGlobal('fetch', fetchMock); const user = userEvent.setup(); render(<SettingsPage />);
  const key = await screen.findByPlaceholderText('已保存：test****1234（留空不修改）'); expect(key).toHaveValue('');
  expect(document.querySelector('[name="ANALYSIS_TIMEOUT_MINUTES"]')).toHaveValue(10);
  const model = document.querySelector<HTMLInputElement>('[name="LLM_AGENT_MODEL"]')!; await user.clear(model); await user.type(model, 'updated');
  await user.click(screen.getByRole('button', { name: '保存设置' })); await screen.findByText('保存成功');
  const post = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST')!;
  expect(post[0]).toBe('/api/v1/settings'); const form = post[1]!.body as FormData;
  expect(form.get('LLM_AGENT_API_KEY')).toBe(''); expect(form.get('LLM_AGENT_MODEL')).toBe('updated'); expect(form.has('GUI')).toBe(false);
  expect(document.querySelector('.settings-content > form')).toBeInTheDocument(); expect(key).toHaveValue('');
});

test('保存失败保留表单，切换 Provider 不覆盖自定义地址；外观声音立即更新本机偏好', async () => {
  const update = vi.fn(), setPref = vi.fn(); Object.assign(window, { ExdiarySound: { getSettings: () => ({ sfx: true, bgm: false, sfxVolume: 65, bgmVolume: 12, bgmTrack: 'one' }), getTracks: () => [{ id: 'one', title: 'Track' }], update }, ExdiaryTheme: { setPref } });
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => options?.method ? reply({ ok: false, error: '参数无效' }, 400) : reply({ data: context })));
  const user = userEvent.setup(); render(<SettingsPage />); await screen.findByRole('button', { name: '保存设置' });
  const base = document.getElementById('agent-base-url')!; await user.type(base, 'https://custom.test/v1'); await user.selectOptions(document.getElementById('agent-provider')!, 'custom'); expect(base).toHaveValue('https://custom.test/v1');
  await user.click(screen.getByRole('button', { name: '深色' })); expect(setPref).toHaveBeenCalledWith('dark');
  await user.click(document.getElementById('sound-sfx')!); expect(update).toHaveBeenCalledWith({ sfx: false });
  fireEvent.change(document.getElementById('sound-bgm-volume')!, { target: { value: '20' } }); expect(update).toHaveBeenCalledWith({ bgmVolume: 20 });
  await user.click(screen.getByRole('button', { name: '保存设置' })); await screen.findByText('参数无效'); expect(base).toHaveValue('https://custom.test/v1');
  await waitFor(() => expect(screen.getByRole('button', { name: '保存设置' })).toBeEnabled());
});
