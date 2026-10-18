import { services } from '../../runtime/services';
import { ToolCard, hasToolCard } from './ToolCard';
import { formatTime, markdown, useChat, type ChatRow } from './ChatContext';

function ToolContent({ row }: { row: ChatRow }) {
  const { connection } = useChat();
  const card = <ToolCard result={row.tool} historical={row.historical} animate={row.animate} toolCallId={row.toolCallId} api={connection.ui} />;
  if (!hasToolCard(row.tool)) return card;
  return <div className={`msg-row tool${row.tool?.display === 'structure_proposal' ? ' record-proposal-row' : ''}`}><div className="msg-wrap">
    <div className="msg-content">{card}</div>
    <time className="msg-time" dateTime={row.createdAt}>{formatTime(row.createdAt)}</time>
  </div></div>;
}

function Message({ row }: { row: ChatRow }) {
  if (row.kind === 'tool') return <ToolContent row={row} />;
  if (row.kind === 'compression') return <div className="chat-compression-divider" role="note">
    此前对话已压缩为 AI 上下文摘要；原始记录仍可继续向上查看
  </div>;
  return <div className={`msg-row ${row.role}${row.animate ? ' message-enter' : ''}`}>
    <div className="msg-wrap">
      {row.role === 'agent' && row.kind !== 'error' ?
        <div className={`msg-content${row.streaming ? ' stream-active' : ''}`} dangerouslySetInnerHTML={{__html:markdown(row.content)}} /> :
        <div className={`msg-content${row.streaming ? ' stream-active' : ''}`}>
          {row.kind === 'error' ? <span style={{color:'var(--red)'}}>Error: {row.content}</span> :
            row.role === 'system' ? <div className="schema-status">{row.content}</div> : row.content}
          {!!row.attachments?.length && <div style={{display:'flex',gap:'0.25rem',flexWrap:'wrap',marginTop:'0.4rem'}}>
            {row.attachments.map(file => <button type="button" key={file.sha256}
              style={{fontSize:'0.7rem',fontWeight:700,border:'1px solid currentColor',padding:'0.08rem 0.3rem',background:'transparent',cursor:'pointer'}}
              onClick={() => {
                const viewer = services.AttachmentViewer;
                viewer?.open({...file,url:`/api/attachments/${encodeURIComponent(file.sha256)}`});
              }}>📎 {file.name || '附件'}</button>)}
          </div>}
        </div>}
      <time className="msg-time" dateTime={row.createdAt}>{formatTime(row.createdAt)}</time>
    </div>
  </div>;
}

export function ChatMessages() {
  const {state, connection} = useChat();
  return <div id="chat-messages" onScroll={event => {
    if (event.currentTarget.scrollTop <= 48) connection.ui.loadOlder();
  }}>
    {state.rows === null ? <div className="chat-empty"><h2>{state.disconnected ? 'Not Connected' : 'ExperMate｜小同门'}</h2>
      {state.disconnected ? <p>连接未就绪，请检查登录状态，或联系管理员检查<a href="/settings">服务端配置</a>。</p> : <p>你可以询问实验、查找记录、分析数据，或直接描述一次新实验。</p>}</div> :
      state.rows.map(row => <Message key={row.id} row={row} />)}
  </div>;
}
