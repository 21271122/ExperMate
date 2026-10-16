import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

type Dialog = 'account' | 'auth' | 'forgot' | 'password' | 'email' | null;
type Feedback = { text: string; success: boolean };
type Reply = { ok: boolean; account?: string; error?: string; notice?: string; token?: string };

function storedAccount() {
  try { return localStorage.getItem('exdiary_account') || ''; } catch { return ''; }
}

function clearSession() {
  try {
    localStorage.removeItem('exdiary_token');
    localStorage.removeItem('exdiary_account');
    sessionStorage.removeItem('exdiary_agent_state');
  } catch { /* 存储不可用仍可使用 Cookie */ }
}

export function useAccountState(onSessionChanged: () => void) {
  const [account, setAccount] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [registering, setRegistering] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});
  const [forgotStep, setForgotStep] = useState(1);
  const [emailStep, setEmailStep] = useState(1);
  const [forgotNotice, setForgotNotice] = useState('');
  const [emailNotice, setEmailNotice] = useState('');
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const requestRef = useRef<AbortController | null>(null);
  const sessionVersion = useRef(0);
  const alive = useRef(true);
  const restartTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const refresh = useCallback(async () => {
    const version = sessionVersion.current;
    try {
      const response = await fetch('/api/e2ee/me', { credentials: 'same-origin' });
      const data: Reply = await response.json();
      if (!alive.current || version !== sessionVersion.current) return { valid: false, expired: false };
      if (response.ok && data.ok && data.account) {
        setAccount(data.account);
        try { localStorage.setItem('exdiary_account', data.account); } catch { /* 显示名仅为偏好 */ }
        return { valid: true, expired: false };
      } else if (response.status === 401) {
        const expired = !!storedAccount();
        clearSession();
        setAccount('');
        if (expired) {
          setDialog('auth');
          setFeedback({ auth: { text: '登录已过期，请重新登录。', success: false } });
        }
        return { valid: false, expired };
      }
    } catch { /* 暂时断网不抹去已确认会话，也不冒充登录成功 */ }
    return { valid: false, expired: false };
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const onFocus = () => { void refresh(); };
    const onVisibility = () => { if (!document.hidden) void refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      alive.current = false;
      requestRef.current?.abort();
      clearTimeout(restartTimer.current);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  useEffect(() => {
    const bridge = {
      ExperMateReactAuth: true,
      ExperMateAccount: { verifySession: refresh, clearLogin: () => { clearSession(); setAccount(''); } },
      showAuthModal: () => open('auth'),
      showAccountModal: () => open(account ? 'account' : 'auth'),
    };
    Object.assign(window, bridge);
    return () => {
      for (const key of Object.keys(bridge)) Reflect.deleteProperty(window, key);
    };
  }, [account, refresh]);

  useEffect(() => {
    const id = { auth: 'auth-username', forgot: 'forgot-account', password: 'change-old', email: 'ce-password' };
    if (dialog && dialog !== 'account') document.getElementById(id[dialog])?.focus();
  }, [dialog]);

  function close() {
    clearTimeout(restartTimer.current);
    requestRef.current?.abort();
    requestRef.current = null;
    pendingRef.current = false;
    setPending(false);
    setDialog(null);
    setFields({});
    setFeedback({});
  }
  function open(next: Dialog) {
    close();
    setDialog(next);
    if (next === 'forgot') { setForgotStep(1); setForgotNotice(''); }
    if (next === 'email') { setEmailStep(1); setEmailNotice(''); }
  }
  function message(section: string, text: string, success = false) {
    setFeedback(previous => ({ ...previous, [section]: { text, success } }));
  }
  async function submit(section: string, path: string, body: Record<string, string>,
                        success: (data: Reply) => void) {
    if (pendingRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    pendingRef.current = true;
    setPending(true);
    message(section, '');
    try {
      const response = await fetch(`/api/e2ee/${path}`, {
        method: 'POST', credentials: 'same-origin', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data: Reply = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok || !data.ok) throw new Error(data.error || '请求失败，请稍后重试');
      success(data);
    } catch (error) {
      if (!controller.signal.aborted) message(section, error instanceof Error ? error.message : '网络错误');
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        pendingRef.current = false;
        if (alive.current) setPending(false);
      }
    }
  }
  function login() {
    const username = (fields['auth-username'] || '').trim();
    const password = fields['auth-password'] || '';
    const email = (fields['auth-email'] || '').trim();
    if (!username || !password) { message('auth', '请填写完整'); return; }
    if (registering && !email.includes('@')) { message('auth', '请填写有效恢复邮箱'); return; }
    void submit('auth', registering ? 'register' : 'login',
      registering ? { account: username, password, email } : { account: username, password }, data => {
        if (registering) {
          setRegistering(false);
          setFields(previous => ({ ...previous, 'auth-password': '' }));
          message('auth', data.notice || '注册成功，请登录', true);
          return;
        }
        sessionVersion.current++;
        clearSession();
        setAccount(data.account || username);
        try { localStorage.setItem('exdiary_account', data.account || username); } catch { /* 可选显示缓存 */ }
        close();
        onSessionChanged();
      });
  }
  function logout() {
    void submit('account', 'logout', {}, () => {
      sessionVersion.current++;
      clearSession();
      setAccount('');
      close();
      onSessionChanged();
    });
  }
  function forgot() {
    void submit('forgot', 'forgot', {
      account: (fields['forgot-account'] || '').trim(), email: (fields['forgot-email'] || '').trim(),
    }, data => {
      setForgotNotice((data.notice || '已发送') + (data.token ? `\n验证码：${data.token}` : ''));
      setForgotStep(2);
    });
  }
  function reset() {
    void submit('forgot', 'reset', {
      account: (fields['forgot-account'] || '').trim(), token: (fields['forgot-token'] || '').trim(),
      new_password: fields['forgot-password'] || '',
    }, data => {
      setFields({});
      message('forgot', data.notice || '已重置，请用新密码登录', true);
      restartTimer.current = setTimeout(() => open('auth'), 1800);
    });
  }
  function changePassword() {
    if (fields['change-new'] !== fields['change-confirm']) {
      message('password', '两次新密码不一致'); return;
    }
    void submit('password', 'change-password', {
      account, old_password: fields['change-old'] || '', new_password: fields['change-new'] || '',
    }, data => {
      sessionVersion.current++;
      clearSession();
      setAccount('');
      setFields({});
      message('password', data.notice || '密码已修改', true);
      restartTimer.current = setTimeout(onSessionChanged, 1800);
    });
  }
  function requestEmail() {
    void submit('email', 'change-email-request', {
      account, password: fields['ce-password'] || '', new_email: (fields['ce-email'] || '').trim(),
    }, data => {
      setEmailNotice((data.notice || '已发送') + (data.token ? `\n验证码：${data.token}` : ''));
      setEmailStep(2);
    });
  }
  function confirmEmail() {
    void submit('email', 'change-email-confirm', {
      account, password: fields['ce-password'] || '', token: (fields['ce-token'] || '').trim(),
    }, data => {
      setFields({});
      message('email', data.notice || '恢复邮箱已更新', true);
      restartTimer.current = setTimeout(close, 1800);
    });
  }
  return { account, dialog, registering, fields, feedback, forgotStep, emailStep,
    forgotNotice, emailNotice, pending, refresh, close, open,
    setField: (id: string, value: string) => setFields(previous => ({ ...previous, [id]: value })),
    toggleMode: () => { requestRef.current?.abort(); setRegistering(value => !value); setFeedback({}); },
    login, logout, forgot, reset, changePassword, requestEmail, confirmEmail };
}

type AccountState = ReturnType<typeof useAccountState>;
const AccountContext = createContext<AccountState | null>(null);

export function AccountProvider({ children, onSessionChanged = () => window.location.reload() }: {
  children: ReactNode; onSessionChanged?: () => void;
}) {
  const state = useAccountState(onSessionChanged);
  return <AccountContext.Provider value={state}>{children}</AccountContext.Provider>;
}

export function useAccount() {
  const state = useContext(AccountContext);
  if (!state) throw new Error('AccountProvider is required');
  return state;
}

export function AccountLink() {
  const account = useAccount();
  return <a href="#" id="chat-header-auth" title={account.account ? '已登录' : undefined}
    onClick={event => { event.preventDefault(); account.open(account.account ? 'account' : 'auth'); }}>
    {account.account || '登录/注册'}
  </a>;
}
