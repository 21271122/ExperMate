import { CanvasSurface } from './CanvasSurface';
// 原始 ai-shell/index.html 的 DOM 结构，使用现有 CSS；不得在框架迁移中改版。
import { services } from '../runtime/services';
import { ChatPanel } from "../features/chat/ChatPanel";

export function ShellFrame() {
  return <>
    <div id={"app-shell"}>
      <div id={"main-split"}>
        <ChatPanel />
        <div id={"divider"} />
        <div id={"content-panel"}>
          <div id={"content-header"}>
            <button id={"content-header-back"} title={"返回上一页"} onClick={() => { services.PanelManager?.back(); }}>
              {"←"}
            </button>
            <span id={"content-header-title"} />
            <span id={"content-header-track"} title={"当前背景音乐"} style={{"display": "none", "marginLeft": "auto", "maxWidth": "38%", "overflow": "hidden", "textOverflow": "ellipsis", "whiteSpace": "nowrap", "fontSize": "0.72rem", "fontWeight": "700", "opacity": "0.82"}} />
            <span id={"content-header-menu-wrap"} style={{"position": "relative"}}>
              <button id={"content-header-menu-btn"} title={"Menu"} style={{"background": "none", "border": "1.5px solid rgba(255,255,255,0.5)", "color": "inherit", "cursor": "pointer", "fontSize": "1rem", "fontWeight": "700", "padding": "0 5px", "fontFamily": "inherit", "lineHeight": "1"}}>
                {"⋮"}
              </button>
              <div id={"content-header-menu-dd"} style={{"display": "none", "position": "absolute", "right": "0", "top": "calc(100% + 4px)", "zIndex": "999", "background": "var(--white)", "border": "4px solid var(--black)", "boxShadow": "var(--shadow)", "minWidth": "140px", "padding": "0.3rem 0"}}>
                <div className={"menu-item"} data-action={"search"} style={{"padding": "0.5rem 1rem", "fontSize": "0.82rem", "fontWeight": "600", "cursor": "pointer", "color": "var(--black)", "whiteSpace": "nowrap"}}>
                  {"🔍 Search"}
                </div>
                <div className={"menu-item"} data-action={"categories"} style={{"padding": "0.5rem 1rem", "fontSize": "0.82rem", "fontWeight": "600", "cursor": "pointer", "color": "var(--black)", "whiteSpace": "nowrap"}}>
                  {"📁 Categories"}
                </div>
                <div className={"menu-item"} data-action={"filters"} style={{"padding": "0.5rem 1rem", "fontSize": "0.82rem", "fontWeight": "600", "cursor": "pointer", "color": "var(--black)", "whiteSpace": "nowrap"}}>
                  {"⚙ Filters"}
                </div>
                <div className={"menu-item"} data-action={"compare"} style={{"padding": "0.5rem 1rem", "fontSize": "0.82rem", "fontWeight": "600", "cursor": "pointer", "color": "var(--black)", "whiteSpace": "nowrap"}}>
                  {"⚖ Compare"}
                </div>
              </div>
            </span>
            <a href={"/settings"} id={"content-header-settings"} title={"设置"} aria-label={"设置"}>
              <svg viewBox={"0 0 24 24"} aria-hidden={"true"}>
                <path d={"M4 7h16M4 12h16M4 17h16M9 5v4M15 10v4M11 15v4"} />
              </svg>
            </a>
          </div>
          <div id={"content-body"}>
            <CanvasSurface />
            <div id={"fragment-mount"} style={{"display": "none"}} />
          </div>
        </div>
      </div>
      <button id={"chat-float-btn"} title={"Open Chat"} onClick={() => { services.PanelManager?.expandChat(); }}>
        {"↑"}
      </button>
    </div>
  </>;
}
