import { useEffect, useRef, useState, type FormEvent } from 'react';

export function LoginPage() {
  const [registering, setRegistering] = useState(false), [fields, setFields] = useState<Record<string, string>>({}), [message, setMessage] = useState(''), [pending, setPending] = useState(false);
  const controller = useRef(new AbortController()), busy = useRef(false);
  useEffect(() => () => controller.current.abort(), []);
  async function post(path: string, body: unknown) {
    const response = await fetch('/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.current.signal, body: JSON.stringify(body) });
    const data = await response.json(); if (!response.ok || !data.ok) throw new Error(data.error || '请求失败'); return data;
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy.current) return;
    const account = (fields[registering ? 'reg-username' : 'login-username'] || '').trim(), password = fields[registering ? 'reg-password' : 'login-password'] || '';
    busy.current = true; setPending(true); setMessage('');
    try {
      let registration;
      if (registering) registration = await post('e2ee/register', { account, email: (fields['reg-email'] || '').trim(), password });
      const session = await post('e2ee/login', { account, password });
      for (const key of ['exdiary_token', 'exdiary_login_event']) localStorage.removeItem(key);
      localStorage.setItem('exdiary_account', session.account || account);
      for (const key of Object.keys(sessionStorage)) if (/^exdiary_(agent|child|analysis_child)/.test(key)) sessionStorage.removeItem(key);
      if (registration?.has_offline_data && confirm('检测到本地离线数据，是否导入到您的账号？')) await post('auth/import-offline', {});
      setFields({}); location.assign('/');
    } catch (reason) { if (!controller.current.signal.aborted) setMessage((reason as Error).message); }
    finally { busy.current = false; if (!controller.current.signal.aborted) setPending(false); }
  }
  const field = (id: string) => ({ id, value: fields[id] || '', disabled: pending, onChange: (event: React.ChangeEvent<HTMLInputElement>) => setFields(old => ({ ...old, [id]: event.target.value })) });
  return <><link rel="stylesheet" href="/static/css/login.css" /><div id="auth-box"><div className="tab-bar">
    <button type="button" id="tab-login-btn" className={registering ? '' : 'active'} onClick={() => { setRegistering(false); setFields({}); setMessage(''); }} disabled={pending}>登录</button>
    <button type="button" id="tab-register-btn" className={registering ? 'active' : ''} onClick={() => { setRegistering(true); setFields({}); setMessage(''); }} disabled={pending}>注册</button></div>
    <form id="login-form" className={`tab-form${registering ? '' : ' active'}`} onSubmit={submit}>
      <input {...field('login-username')} type="text" placeholder="用户名" required autoComplete="username" /><input {...field('login-password')} type="password" placeholder="密码" required autoComplete="current-password" />
      <button type="submit" disabled={pending}>登录</button><div id="login-msg" style={{ marginTop: '0.5rem', fontSize: '0.8rem', fontWeight: 700, color: 'var(--red)' }}>{!registering && message}</div></form>
    <form id="register-form" className={`tab-form${registering ? ' active' : ''}`} onSubmit={submit}>
      <input {...field('reg-username')} type="text" placeholder="用户名（至少2字符）" required autoComplete="username" minLength={2} /><input {...field('reg-email')} type="email" placeholder="邮箱（用于找回密码）" required autoComplete="email" />
      <input {...field('reg-password')} type="password" placeholder="密码（至少8个字符，仅字母/数字/一般标点）" required autoComplete="new-password" minLength={8} />
      <button type="submit" disabled={pending}>注册</button><div id="reg-msg" style={{ marginTop: '0.5rem', fontSize: '0.8rem', fontWeight: 700, color: 'var(--red)' }}>{registering && message}</div></form></div>
    <p style={{ textAlign: 'center', opacity: 0.5, fontSize: '0.8rem' }}><a href="/" style={{ color: 'inherit' }}>跳过登录，进入离线模式</a></p></>;
}
