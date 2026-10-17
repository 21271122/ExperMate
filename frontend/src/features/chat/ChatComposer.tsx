import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { services } from '../../runtime/services';
import { useChat, type Attachment } from './ChatContext';

export function ChatComposer() {
  const {state, connection} = useChat();
  const [draft, setDraft] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const uploadRef = useRef(false);
  const textArea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploads = useRef<AbortController | null>(null);
  function send(text = draft) {
    const message = text.trim();
    if (!message && !files.length) return;
    if (connection.ui.isBusy() || connection.client.isSending()) {
      setDraft(text); connection.ui.updateStatus('AI 正在回复；内容已保留，回复结束后再发送。'); return;
    }
    setDraft(''); setFiles([]);
    if (textArea.current) textArea.current.style.height = 'auto';
    connection.ui.setSending(true);
    services.ExdiarySound?.play('message');
    void connection.client.sendMessage(message || '我上传了附件，请查看并处理。', files);
  }
  useEffect(() => { connection.ui.setComposer(send); return () => connection.ui.setComposer(undefined); });
  useEffect(() => () => uploads.current?.abort(), []);
  async function upload(selected: File[]) {
    if (!selected.length || uploadRef.current) return;
    if (files.length + selected.length > 10) { connection.ui.updateStatus('一次最多添加 10 个附件'); return; }
    const controller = new AbortController(); uploads.current = controller;
    uploadRef.current = true; setUploading(true);
    try {
      for (let index = 0; index < selected.length; index++) {
        connection.ui.updateStatus(`正在上传附件 ${index + 1}/${selected.length}…`);
        const body = new FormData(); body.append('file', selected[index]);
        const response = await fetch('/api/agent/attachments', {method:'POST',body,signal:controller.signal});
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || '附件上传失败');
        setFiles(previous => [...previous, data.attachment]);
      }
      connection.ui.updateStatus('');
    } catch (error) {
      if (!controller.signal.aborted) connection.ui.updateStatus(error instanceof Error ? error.message : '附件上传失败');
    } finally { if (!controller.signal.aborted) setUploading(false); uploadRef.current = false; }
  }
  useEffect(() => {
    const panel = document.getElementById('chat-panel');
    if (!panel) return;
    let depth = 0;
    const isFile = (event: DragEvent) => [...(event.dataTransfer?.types || [])].includes('Files');
    const enter = (event: DragEvent) => { if (isFile(event)) { event.preventDefault(); depth++; panel.classList.add('chat-file-dragging'); } };
    const over = (event: DragEvent) => { if (isFile(event)) event.preventDefault(); };
    const leave = (event: DragEvent) => { if (isFile(event) && --depth <= 0) panel.classList.remove('chat-file-dragging'); };
    const drop = (event: DragEvent) => {
      if (!isFile(event)) return;
      event.preventDefault(); depth = 0; panel.classList.remove('chat-file-dragging');
      void upload([...(event.dataTransfer?.files || [])]);
    };
    panel.addEventListener('dragenter',enter); panel.addEventListener('dragover',over);
    panel.addEventListener('dragleave',leave); panel.addEventListener('drop',drop);
    return () => {
      panel.removeEventListener('dragenter',enter); panel.removeEventListener('dragover',over);
      panel.removeEventListener('dragleave',leave); panel.removeEventListener('drop',drop);
    };
  }, [files, connection]);
  function keyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      if (connection.ui.isBusy()) return;
      event.preventDefault(); send();
    }
  }
  return <div id="chat-input-area">
    <div id="content-restore-btn" title="Restore panel" onClick={() => services.PanelManager?.restoreContent()} />
    <input id="chat-attachment-file" ref={fileInput} type="file" multiple
      accept=".png,.jpg,.jpeg,.gif,.webp,.bmp,.pdf,.csv,.txt,.xlsx,.mp3,.ogg,.wav,.m4a,.aac,.flac,image/*,audio/*,application/pdf,text/csv,text/plain"
      style={{display:'none'}} onChange={event => { void upload([...(event.target.files || [])]); event.target.value = ''; }} />
    <button id="btn-chat-attachment" className="outline" type="button" title="添加聊天附件" aria-label="添加聊天附件"
      disabled={uploading} style={{padding:'0.35rem 0.5rem'}} onClick={() => fileInput.current?.click()}>＋</button>
    <div id="chat-input-wrapper">
      <textarea id="chat-input" ref={textArea} placeholder="输入消息…" rows={1} value={draft} onKeyDown={keyDown}
        onChange={event => {
          setDraft(event.target.value); event.target.style.height = 'auto';
          event.target.style.height = `${Math.min(event.target.scrollHeight,160)}px`;
        }} />
      <div id="chat-attachment-drafts" style={{display:'flex',gap:'0.25rem',flexWrap:'wrap',marginTop:'0.3rem'}}>
        {files.map((file,index) => <button type="button" className="outline" key={`${file.sha256}-${index}`}
          style={{fontSize:'0.65rem',padding:'0.1rem 0.3rem'}} title="移除此附件"
          onClick={() => setFiles(previous => previous.filter((_,position) => position !== index))}>📎 {file.name || '附件'} ×</button>)}
      </div>
    </div>
    <button id="btn-send" disabled={state.busy || uploading} onClick={() => send()}>发送</button>
  </div>;
}
