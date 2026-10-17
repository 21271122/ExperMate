import { services } from '../../runtime/services';
import { AccountLink } from '../account/AccountContext';
import { useChat } from './ChatContext';
import { ChatMessages } from './ChatMessages';
import { ChatComposer } from './ChatComposer';
import { HistorySearch } from './HistorySearch';

export function ChatPanel() {
  const {state, connection} = useChat();
  return <>
        <div id={"chat-panel"} data-thread-theme={state.theme}>
          <div id={"chat-header"}>
            <a href={"/"} id={"chat-brand"} title={"ExperMate｜小同门"} onClick={event=>{event.preventDefault();if(event.detail!==2)services.PanelManager?.navigate('/');}} onDoubleClick={event=>{event.preventDefault();services.showSupportModal?.();}}>
              <span className={"dot"} />
              <span className={"brand-letters"}>
                <span>
                  {"E"}
                </span>
                <span>
                  {"x"}
                </span>
                <span>
                  {"p"}
                </span>
                <span>
                  {"e"}
                </span>
                <span>
                  {"r"}
                </span>
                <span>
                  {"M"}
                </span>
                <span>
                  {"a"}
                </span>
                <span>
                  {"t"}
                </span>
                <span>
                  {"e"}
                </span>
              </span>
            </a>
            <span id="mode-badge" className={state.mode === 'record' ? 'record' : state.mode === 'analyze' ? 'analyze' : undefined}>
              {state.mode === null ? '自由' : state.mode === 'record' ? 'Recording' : state.mode === 'analyze' ? 'Analyzing' : ''}
            </span>
            <AccountLink />
            <button onClick={connection.ui.openHistory} id={"chat-history-search"} title={"查找聊天记录"} aria-label={"查找聊天记录"}>
              <svg viewBox={"0 0 24 24"} aria-hidden={"true"}>
                <path d={"M3.5 4.5h12v8.3H9.6L6 16v-3.2H3.5z"} />
                <circle cx={"16.5"} cy={"16.5"} r={"3.2"} />
                <path d={"m18.8 18.8 2 2"} />
              </svg>
            </button>
            <a href={"#"} id={"chat-header-settings"} title={"设置"} aria-label={"设置"} onClick={(event) => { services.PanelManager?.navigate('/settings');event.preventDefault(); }}>
              <svg viewBox={"0 0 24 24"} aria-hidden={"true"}>
                <path d={"M4 7h16M4 12h16M4 17h16M9 5v4M15 10v4M11 15v4"} />
              </svg>
            </a>
          </div>
          <div id={"chat-top"}>
            <ChatMessages />
            <small id="status-bar" style={state.status === null ? undefined : {display:state.status ? 'block' : 'none'}}>{state.status}</small>
            <div id="quick-replies" style={state.quick === null ? undefined : {display:state.quick.length ? 'flex' : 'none'}}>
              {state.quick?.map((reply,index) => <button key={index} onClick={() => connection.ui.handleQuickReply(typeof reply === 'string' ? reply : reply.action)}>
                {typeof reply === 'string' ? reply : reply.label}
              </button>)}
            </div>
          </div>
          <div id={"color-divider"}>
            <span className={"cd-red"} />
            <span className={"cd-white"} />
            <span className={"cd-yellow"} />
            <span className={"cd-blue"} />
          </div>
          <ChatComposer />
        </div>
    <HistorySearch />
  </>;
}
