import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { readJsonEvents } from '../chat/events';
import { services } from '../../runtime/services';
import { requestJson } from '../../shared/api';
import { escapeHtml, markdown } from './detail-model';

type Message = { role: string; content?: string; attachments?: { name?: string }[]; created_at?: string; tool_calls?: unknown[]; separator?: boolean };
type ChildState = { history?: Message[]; _child_initial_history_len?: number; turn_count?: number; modified_values?: Record<string, unknown>; [key: string]: unknown };
function messageHtml(message: Message) {
  const content = message.role === 'agent' ? markdown(message.content || '') : escapeHtml(message.content || '');
  return content + (message.attachments?.length ? '<div style="margin-top:0.45rem;font-size:0.78em;opacity:0.8;border-top:1px solid currentColor;padding-top:0.3rem">附件：'
    + message.attachments.map(item => escapeHtml(item.name || '未命名附件')).join('、') + '</div>' : '');
}
export function ChildConversation({ expId, updated, kind = 'experiment' }: { expId: string; updated: () => void; kind?: 'experiment' | 'analysis' }) {
  const [messages, setMessages] = useState<Message[]>([]), [draft, setDraft] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [legacy, setLegacy] = useState(false), [preview, setPreview] = useState<Record<string, unknown> | null>(null), [error, setError] = useState(''), [status, setStatus] = useState(''), [turn, setTurn] = useState(0);
  const controller = useRef(new AbortController()), pending = useRef(false), list = useRef<HTMLDivElement>(null), divider = useRef<HTMLDivElement>(null);
  const analysis = kind === 'analysis', placeholder = analysis ? '输入想核对的问题…' : '描述需要修改的内容…';
  const endpoint = `/api/${analysis ? 'analysis' : 'exp'}/${encodeURIComponent(expId)}/chat`;
  function persist(state: ChildState) {
    setTurn(Number(state.turn_count || 0));
  }
  function history(state: ChildState) {
    const split = state._child_initial_history_len || 0; let earlier = false;
    const rows: Message[] = [];
    (state.history || []).forEach((message, index) => {
      if (index === split && split > 0 && earlier) rows.push({ role: 'separator', separator: true });
      if (!message.content || !['user', 'assistant', 'agent'].includes(message.role)) return;
      rows.push({ ...message, role: message.role === 'user' ? 'user' : 'agent' }); if (index < split) earlier = true;
    }); setMessages(rows);
  }
  useEffect(() => {
    const signal = controller.current.signal;
    void requestJson(endpoint, { method: 'POST', signal, body: JSON.stringify({ message: '' }) }).then(data => {
      if (signal.aborted) return;
      setLegacy(!!data.is_legacy); if (data.state) { persist(data.state); history(data.state); }
    }).catch(reason => { if (!signal.aborted) setError('加载失败：' + reason.message); }).finally(() => { if (!signal.aborted) setLoading(false); });
    return () => controller.current.abort();
  }, [expId]);
  useLayoutEffect(() => { if (list.current) list.current.scrollTop = list.current.scrollHeight; }, [messages]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const animate = () => {
      const spans = divider.current?.querySelectorAll<HTMLElement>('span');
      const parts = Array.from({ length: 4 }, () => Math.random() * 70 + 8), total = parts.reduce((a, b) => a + b, 0);
      spans?.forEach((span, i) => { span.style.flexGrow = (parts[i] / total * 10).toFixed(2); });
      timer = setTimeout(animate, 800 + Math.random() * 600);
    };
    if (busy) animate(); else divider.current?.querySelectorAll<HTMLElement>('span').forEach(span => { span.style.flexGrow = '1'; });
    return () => clearTimeout(timer);
  }, [busy]);
  async function send(initialLegacy = false) {
    if (pending.current || loading || (!initialLegacy && !draft.trim())) return;
    pending.current = true; setBusy(true); setError(''); setStatus('AI 正在回复…'); setLegacy(false);
    const content = initialLegacy ? analysis ? '加载分析报告以便审阅' : '加载实验数据以便修改' : draft.trim(), created_at = new Date().toISOString();
    if (!initialLegacy) { setDraft(''); setMessages(old => [...old, { role: 'user', content, created_at }]); }
    let text = '', streaming = false;
    try {
      const response = await fetch(endpoint, { method: 'POST', signal: controller.current.signal,
        headers: { 'Content-Type': 'application/json', 'X-Exdiary-Client-Id': services.AgentClient?.getClientId() || '' },
        body: JSON.stringify({ message: content, created_at, stream: true, ...(initialLegacy ? { is_legacy: true } : {}) }) });
      if (!response.ok) { if (response.status === 401) services.showAuthModal?.(); const body = await response.json(); throw new Error(body.error || '请求失败'); }
      let complete = false;
      for await (const event of readJsonEvents(response)) {
        if (controller.current.signal.aborted) return;
        if (event.event === 'text') {
          text += event.content || '';
          if (!streaming) { streaming = true; setMessages(old => [...old, { role: 'agent', content: text, created_at }]); }
          else setMessages(old => old.map((row, index) => index === old.length - 1 ? { ...row, content: text } : row));
        } else if (event.event === 'tool') setStatus('AI 正在处理…');
        else if (event.event === 'tool_done') setStatus('AI 正在回复…');
        else if (event.event === 'error') throw new Error(event.message || 'AI 处理失败');
        else if (event.event === 'done') {
          complete = true;
          if (event.state) { persist(event.state); if (!analysis && event.type === 'extract' && event.preview) setPreview(event.preview); else history(event.state); }
          break;
        }
      }
      if (!complete) throw new Error('回复连接意外结束');
    } catch (reason) { if (!controller.current.signal.aborted) setError('抱歉，本轮处理失败：' + (reason as Error).message); }
    finally { pending.current = false; if (!controller.current.signal.aborted) { setBusy(false); setStatus(''); } }
  }
  async function confirmChanges() {
    if (pending.current) return; pending.current = true; setBusy(true);
    try {
      await requestJson(`/api/exp/${encodeURIComponent(expId)}/confirm`, { method: 'POST', signal: controller.current.signal, body: JSON.stringify({}) });
      updated();
    } catch (reason) { if (!controller.current.signal.aborted) setError((reason as Error).message); }
    finally { pending.current = false; if (!controller.current.signal.aborted) setBusy(false); }
  }
  function dismiss() { controller.current.abort(); updated(); }
  const pane = document.getElementById('content-body') || document.body;
  return createPortal(<div className={`edit-modal-overlay ${analysis ? 'analysis' : 'experiment'}-pane-modal active${busy ? ' child-agent-busy' : ''}`} id="child-modal" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); dismiss(); } }}>
    <div className="edit-modal-box child-agent-box" style={{ maxWidth: 520, width: '95%', height: '70vh', display: 'flex', flexDirection: 'column' }}>
      <div className="child-agent-head" style={{ padding: '0.5rem', fontWeight: 700, borderBottom: '3px solid var(--black)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><span>{analysis ? '分析对话' : '编辑'} {expId}</span>
        <button type="button" onClick={dismiss} style={{ border: '2px solid var(--black)', background: 'var(--white)', color: 'var(--black)', padding: '0.2rem 0.6rem', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem' }}>关闭</button></div>
      <div id="child-legacy" className="flash" style={{ display: legacy ? undefined : 'none', margin: '0.5rem' }}>{analysis ? '该分析报告还没有聊天记录，你可以直接与 Agent 对话核对相关实验和报告结论。' : '该实验还没有聊天记录，你可以直接与 Agent 对话来修改它。'}
        <button type="button" onClick={() => void send(true)} style={{ marginLeft: '0.5rem' }}>开始对话</button></div>
      <div ref={list} id="child-msgs" className="child-msgs" style={{ flex: 1, overflowY: 'auto', padding: '0.5rem', minHeight: 200, maxHeight: '50vh', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        {loading && <div style={{ textAlign: 'center', opacity: 0.5, padding: '2rem' }}>Loading...</div>}
        {messages.map((message, index) => message.separator ? <div key={index} style={{ textAlign: 'center', margin: '0.6rem 0', fontWeight: 700, fontSize: '0.7rem', opacity: 0.5 }}><span style={{ background: 'var(--white)', padding: '0 0.5rem' }}>—— Modification session ——</span></div>
          : <div key={index} className={`child-msg-row ${message.role}`} style={{ display: 'flex', marginBottom: 14, justifyContent: message.role === 'user' ? 'flex-end' : undefined }}>
            <div className="child-msg-wrap" style={{ display: 'flex', flexDirection: 'column', maxWidth: '82%', minWidth: 0, alignItems: message.role === 'user' ? 'flex-end' : undefined }}>
              <div className={`child-msg-content child-chat-bubble child-chat-bubble-${message.role}`} style={{ boxSizing: 'border-box', minWidth: 0, overflowWrap: 'anywhere', wordBreak: 'break-word', background: message.role === 'agent' ? 'var(--bubble-agent-bg)' : 'var(--black)', border: `${message.role === 'agent' ? 2 : 3}px solid var(--black)`, padding: message.role === 'agent' ? '8px 12px' : '8px 14px', fontSize: '0.88rem', lineHeight: 1.6, color: message.role === 'agent' ? 'var(--black)' : 'var(--white)', fontWeight: message.role === 'agent' ? undefined : 600 }} dangerouslySetInnerHTML={{ __html: messageHtml(message) }} />
              <time className="child-msg-time" dateTime={message.created_at} style={{ marginTop: 3, color: 'var(--gray)', fontFamily: 'var(--font-mono,monospace)', fontSize: '0.65rem', lineHeight: 1 }}>{message.created_at && new Date(message.created_at.replace(' ', 'T')).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</time></div></div>)}
        {error && <div role="alert" style={{ textAlign: 'center', color: 'var(--red)', padding: '2rem' }}>{error}</div>}</div>
      <div id="child-preview" style={{ display: preview ? undefined : 'none', padding: '0.5rem', border: '3px solid var(--black)', margin: '0.5rem' }}><div id="child-preview-content"><h4 style={{ fontWeight: 700, textTransform: 'uppercase' }}>Preview Changes</h4>
        {preview && ['title', 'status', 'tags', 'purpose', 'conclusion'].filter(key => preview[key]).map(key => <div key={key} style={{ margin: '0.3rem 0' }}><strong>{key}</strong>: {typeof preview[key] === 'string' ? preview[key] as string : JSON.stringify(preview[key])}</div>)}
        <button type="button" disabled={busy} onClick={() => void confirmChanges()} style={{ marginTop: '0.5rem' }}>Confirm</button></div></div>
      <small id="child-status-bar" className="child-status-bar" style={{ display: status || turn ? undefined : 'none', padding: '0.3rem 0.5rem', fontWeight: 700, fontSize: '0.7rem', color: 'var(--text-3)' }}>{[status, turn ? 'Round ' + turn : ''].filter(Boolean).join(' — ')}</small>
      <div ref={divider} id="child-color-divider" className="child-color-divider" style={{ display: 'flex', height: 3, margin: '0 0.5rem 4px' }}>{['red', 'white', 'yellow', 'blue'].map(color => <span key={color} className={`cd-${color}`} style={{ flex: 1, background: `var(--${color})`, transition: 'flex-grow .8s cubic-bezier(.4,0,.2,1)' }} />)}</div>
      <div className="child-input-area" style={{ display: 'flex', alignItems: 'stretch', gap: 10, padding: '0 0.5rem 0.5rem' }}><div className="child-input-wrapper" style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', border: '3px solid var(--black)', padding: '4px 10px', background: 'var(--white)' }}>
        <textarea id="child-input" placeholder={busy ? '可继续输入，回复结束后再发送…' : placeholder} aria-busy={busy} rows={1} value={draft} onChange={e => { setDraft(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px'; }}
          style={{ flex: 1, minWidth: 0, minHeight: 24, maxHeight: 140, border: 'none', outline: 'none', resize: 'none', fontFamily: 'inherit', fontSize: '0.88rem', lineHeight: 1.5, padding: '2px 0', margin: 0, color: 'var(--black)', background: 'transparent' }}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !busy) { e.preventDefault(); void send(); } }} /></div>
        <button type="button" id="btn-child-send" className="child-send-button" disabled={busy || loading} onClick={() => void send()} style={{ flexShrink: 0, padding: '4px 14px', border: '3px solid var(--black)', background: 'var(--yellow)', color: 'var(--black)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.78rem', fontWeight: 700, letterSpacing: 1 }}>发送</button></div>
    </div></div>, pane);
}
