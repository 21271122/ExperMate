import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatTime, markdown, useChat } from './ChatContext';

type Match = {role:string;snippet:string;created_at:string;session_id:string;sequence:number};
type HistoryMessage = {role:string;content:string;created_at:string;sequence:number};

function historyText(message: HistoryMessage) {
  if (message.role !== 'tool') return message.content || '';
  try { const result=JSON.parse(message.content); return result.display || result.message || ''; }
  catch { return ''; }
}

function Content({text,role}: {text:string;role:string}) {
  return role === 'assistant' ? <div className="history-markdown" dangerouslySetInnerHTML={{__html:markdown(text || '（无可读正文）')}} /> :
    <div>{text || '（无可读正文）'}</div>;
}

export function HistorySearch() {
  const {state,connection} = useChat();
  const [query,setQuery] = useState('');
  const [status,setStatus] = useState('只加载命中的简短摘要；点击结果可查看附近对话。');
  const [matches,setMatches] = useState<Match[]>([]);
  const [context,setContext] = useState<HistoryMessage[] | null>(null);
  const [current,setCurrent] = useState<number | null>(null);
  const [pending,setPending] = useState(false);
  const requestId = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    requestId.current++;
    if (state.historyOpen) { setQuery(''); setMatches([]); setContext(null); setPending(false);
      setStatus('只加载命中的简短摘要；点击结果可查看附近对话。'); input.current?.focus(); }
  }, [state.historyOpen]);
  if (!state.historyOpen) return null;
  async function search() {
    if (!query.trim()) {setStatus('请输入要查找的关键词。'); return;}
    const id=++requestId.current;
    setPending(true);setContext(null);setMatches([]);setStatus('正在查找…');
    try {
      const found = await connection.client.searchHistory(query.trim(), {});
      if (id !== requestId.current) return;
      setMatches(found);setStatus(found.length ? `找到 ${found.length} 条记录` : '没有找到匹配的聊天记录。');
    } catch(error) { if(id===requestId.current) setStatus(error instanceof Error ? error.message : '聊天记录搜索失败'); }
    finally {if(id===requestId.current) setPending(false);}
  }
  async function nearby(match: Match) {
    const id=++requestId.current;setStatus('正在加载附近对话…');
    try {
      const result = await connection.client.readHistoryContext(match.session_id,match.sequence,3,3);
      if(id!==requestId.current)return;
      setContext(result.messages || []);setCurrent(match.sequence);
      setStatus('附近对话'+(result.has_older || result.has_newer ? '（可继续通过搜索定位更多内容）' : ''));
    }catch(error){if(id===requestId.current)setStatus(error instanceof Error ? error.message : '聊天记录读取失败');}
  }
  return createPortal(<div id="history-search-overlay" className="history-search-overlay"
    onClick={event=>{if(event.target===event.currentTarget)connection.ui.closeHistory();}}>
    <section className="history-search-panel">
      <div className="history-search-header"><strong>查找聊天记录</strong>
        <button type="button" title="关闭" onClick={connection.ui.closeHistory}>×</button></div>
      <form className="history-search-form" onSubmit={event=>{event.preventDefault();void search();}}>
        <input type="search" placeholder="输入关键词，查找当前和已压缩的对话" maxLength={200} ref={input}
          value={query} onChange={event=>setQuery(event.target.value)} />
        <button type="submit" disabled={pending}>查找</button>
      </form>
      <p className="history-search-status">{status}</p>
      <div className="history-search-results">{context ? context.map(message=>
        <article key={message.sequence} className={`history-context-message${message.sequence===current?' current':''}`}>
          <small>{message.role==='user'?'你':message.role==='assistant'?'AI':'工具'} · {formatTime(message.created_at)}</small>
          <Content text={historyText(message)} role={message.role} />
        </article>) : matches.map(match=><article key={`${match.session_id}-${match.sequence}`}
          className="history-search-result" role="button" tabIndex={0} onClick={()=>void nearby(match)}
          onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();void nearby(match);}}}>
          <small>{match.role==='user'?'你':match.role==='assistant'?'AI':'工具'} · {formatTime(match.created_at)}</small>
          <Content text={match.snippet} role={match.role} />
        </article>)}</div>
    </section>
  </div>,document.body);
}
