import { services } from '../../runtime/services';
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createAgentClient } from './agent-client';
import type { ToolResult } from './tool-model';
export type { ToolResult } from './tool-model';

export type Attachment = { sha256: string; name?: string; mime?: string; size?: number };
export type ChatRow = {
  id: number; role: string; content: string; createdAt: string; attachments?: Attachment[];
  kind?: 'error' | 'tool' | 'compression'; tool?: ToolResult; toolCallId?: string;
  streaming?: boolean; animate?: boolean; historical?: boolean;
};
type ChatState = {
  rows: ChatRow[] | null; busy: boolean; mode: string | null; theme?: string;
  status: string | null; quick: (string | { label: string; action: string })[] | null; historyOpen: boolean; disconnected?: boolean;
};
const initial: ChatState = { rows: null, busy: true, mode: null, status: null, quick: null, historyOpen: false };

function createController(update: (change: (state: ChatState) => ChatState) => void) {
  let sequence = 0;
  let streaming: number | null = null;
  let historical = false;
  let renderingHistory = false;
  let busy = true;
  let hasCompression = false;
  let bottom = false;
  let anchor: { height: number; top: number } | null = null;
  let loadOlder: (() => void) | undefined;
  let composer: ((text?: string) => void) | undefined;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const patch = (change: Partial<ChatState>) => update(state => ({ ...state, ...change }));
  const append = (row: Omit<ChatRow, 'id' | 'createdAt'> & { createdAt?: string }) => {
    const item = { ...row, id: ++sequence, createdAt: row.createdAt || new Date().toISOString() };
    if (!renderingHistory) bottom = true;
    update(state => ({ ...state, rows: [...(state.rows || []), item] }));
    return item.id;
  };
  const ui = {
    init: () => ui.setSending(false),
    connectionFailed: () => patch({disconnected:true,busy:false}),
    onMessage(data: { role: string; content: string; created_at?: string; attachments?: Attachment[] }) {
      if (data.content) append({ role: data.role, content: data.content, createdAt: data.created_at,
        attachments: data.attachments, animate: !historical && !renderingHistory && data.role === 'user' });
    },
    onStreamStart() { streaming = null; },
    onStreamChunk(content: string) {
      if (streaming === null) streaming = append({ role: 'agent', content, streaming: true });
      else update(state => ({ ...state, rows: (state.rows || []).map(row => row.id === streaming ? { ...row, content } : row) }));
      bottom = true;
    },
    onStreamEnd(content: string) {
      const id = streaming;
      update(state => ({ ...state, rows: (state.rows || []).map(row => row.id === id ? { ...row, content, streaming: false } : row) }));
      streaming = null;
    },
    onToolCard(data: { result: ToolResult; toolCallId: string; created_at?: string }) {
      append({ role: 'tool', kind: 'tool', content: '', tool: data.result, toolCallId: data.toolCallId,
        createdAt: data.created_at, historical, animate: !historical && !renderingHistory });
    },
    onError(text: string) {
      services.ExdiarySound?.play('general');
      const id = streaming;
      streaming = null;
      update(state => ({ ...state, rows: (state.rows || []).filter(row => row.id !== id) }));
      append({ role: 'agent', kind: 'error', content: text });
      ui.setSending(false);
    },
    onIdle() { ui.setSending(false); },
    setSending(value: boolean) { busy = value; patch({ busy: value }); },
    isBusy: () => busy,
    updateModeBadge: (mode: string) => patch({ mode }),
    updateThreadColor: (state: Record<string, any> | null) => patch({ theme: state?._thread_type || '' }),
    updateStatus(text = '', turn?: number) {
      const count = turn ?? client.getState()?.turn_count ?? 0;
      patch({ status: [text, count > 0 ? `Round ${count}` : ''].filter(Boolean).join(' — ') });
    },
    updateQuickReplies: (quick: ChatState['quick']) => patch({ quick: quick || [] }),
    handleQuickReply(action: string) { if (action !== 'quill') composer?.(action === 'skip' ? 'OK, generate now' : action); },
    appendSystemMsg: (content: string) => append({ role: 'system', content }),
    clearMessages() { streaming = null; hasCompression = false; patch({ rows: [] }); },
    resetDedup() {},
    appendCompressionDivider() {
      if (!hasCompression) { hasCompression = true; append({ role: 'system', kind: 'compression', content: '' }); }
    },
    setPageLoad(value: boolean) { historical = value; },
    setHistoryRendering(value: boolean) { renderingHistory = value; },
    setLoadOlder(callback: () => void) { loadOlder = callback; },
    loadOlder() { if (!renderingHistory) loadOlder?.(); },
    preparePrepend() {
      const element = document.getElementById('chat-messages');
      if (element) anchor = { height: element.scrollHeight, top: element.scrollTop };
    },
    finishPrepend() {},
    scrollToLatest() { bottom = true; },
    adjustScroll() {
      const element = document.getElementById('chat-messages');
      if (!element) return;
      if (anchor) { element.scrollTop = element.scrollHeight - anchor.height + anchor.top; anchor = null; }
      else if (bottom) element.scrollTop = element.scrollHeight;
      bottom = false;
    },
    showToast(message: string) {
      const element = document.createElement('div');
      element.className = 'toast'; element.textContent = message; document.body.appendChild(element);
      const timer = setTimeout(() => { element.remove(); timers.delete(timer); }, 2300);
      timers.add(timer);
    },
    setComposer(callback?: (text?: string) => void) { composer = callback; },
    send(text: string) { composer?.(text); },
    isPageLoad: () => historical,
    openHistory: () => patch({ historyOpen: true }),
    closeHistory: () => patch({ historyOpen: false }),
    client: () => client,
    dispose() { client.dispose(); timers.forEach(clearTimeout); document.querySelectorAll('.toast').forEach(element => element.remove()); },
  };
  const client = createAgentClient(ui);
  return { ui, client };
}

export type Connection = ReturnType<typeof createController>;
const ChatContext = createContext<{ state: ChatState; connection: Connection } | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(initial);
  const mounted = useRef(true);
  const [connection] = useState(() => createController(change => { if (mounted.current) setState(change); }));
  useLayoutEffect(() => {
    Object.assign(services, { AgentClient: connection.client, ChatUI: connection.ui });
    return () => {
      mounted.current = false;
      connection.ui.dispose();
      Reflect.deleteProperty(services, 'AgentClient'); Reflect.deleteProperty(services, 'ChatUI');
    };
  }, [connection]);
  useLayoutEffect(() => connection.ui.adjustScroll(), [state.rows, connection]);
  useEffect(() => {
    if (state.busy) services.startColorDivider?.(); else services.stopColorDivider?.();
    document.getElementById('chat-brand')?.classList.toggle('agent-active', state.busy);
  }, [state.busy]);
  return <ChatContext.Provider value={{ state, connection }}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) throw new Error('ChatProvider is required');
  return context;
}

export { markdown } from '../../shared/markdown';

export function formatTime(createdAt: string) {
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}
