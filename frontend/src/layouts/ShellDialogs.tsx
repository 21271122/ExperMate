// 原始 ai-shell/index.html 的 DOM 结构，使用现有 CSS；不得在框架迁移中改版。
import { services } from '../runtime/services';
import { useAccount } from "../features/account/AccountContext";
import { useEffect, useLayoutEffect, useState } from 'react';

export function ShellDialogs() {
  const account = useAccount();
  const [support, setSupport] = useState(false), [configured, setConfigured] = useState(false);
  const [hideSupport, setHideSupport] = useState(() => localStorage.getItem('expermate_support_modal_hidden') === '1');
  useEffect(() => setConfigured(true), []);
  useLayoutEffect(() => {
    Object.assign(services, { showSupportModal: () => { if (!hideSupport) { setSupport(true); requestAnimationFrame(() => document.getElementById('support-modal-close')?.focus()); } }, closeSupportModal: () => setSupport(false) });
    return () => { Reflect.deleteProperty(services, 'showSupportModal'); Reflect.deleteProperty(services, 'closeSupportModal'); };
  }, [hideSupport]);
  const field = (id: string) => ({ value: account.fields[id] || '',
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => account.setField(id, event.target.value) });
  return <>
    <div id={"support-modal"} className={"support-modal-overlay"} role={"dialog"} aria-modal={"true"} aria-labelledby={"support-modal-title"} style={support ? {display:'flex'} : undefined} onKeyDown={event=>{if(event.key==='Escape')setSupport(false);}}>
      <section className={"support-modal-dialog"}>
        <header className={"support-modal-head"}>
          <span id={"support-modal-title"}>
            {"支持小同门"}
          </span>
          <button id={"support-modal-close"} className={"support-modal-close"} type={"button"} aria-label={"关闭支持窗口"} onClick={()=>setSupport(false)}>
            {"×"}
          </button>
        </header>
        <div className={"support-modal-content"}>
          <p className={"support-modal-copy"}>
            {"感谢您的使用！这是主包的个人项目，有很多地方做得非常粗糙，诚邀您填写问卷，我会持续迭代！"}
          </p>
          <a id={"support-survey-link"} className={"support-survey-link"} href={configured ? 'https://v.wjx.cn/vm/PyP0GKm.aspx#' : '#'} aria-disabled={configured ? undefined : 'true'} tabIndex={configured ? undefined : -1} target={configured ? '_blank' : undefined} rel={configured ? 'noopener noreferrer' : undefined}>
            {configured ? '填写反馈问卷' : '问卷链接待接入'}
          </a>
          <div className={"support-modal-divider"} aria-hidden={"true"}>
            <span />
            <span />
            <span />
          </div>
          <h2 className={"support-token-title"}>
            {"Buy me some tokens"}
          </h2>
          <p className={"support-modal-copy"}>
            {"本项目截至 2026 年 8 月底，共耗时 4 个月，消耗 60 亿+ tokens。如果觉得项目有帮助，可否小小补贴一下 token 的开销？"}
          </p>
          <div className={"support-qr-wrap"}>
            <img id={"support-qr"} alt={"支持 ExperMate 的收款二维码"} hidden={!configured} src={configured ? '/app/img/support-qr.png' : undefined} />
            <span id={"support-qr-placeholder"} className={"support-qr-placeholder"} hidden={configured}>
              {"收款码待接入"}
            </span>
          </div>
          <label className={"support-hide-option"}>
            <input id={"support-hide-forever"} type={"checkbox"} checked={hideSupport} onChange={event=>{const hidden=event.target.checked;setHideSupport(hidden);if(hidden)localStorage.setItem('expermate_support_modal_hidden','1');else localStorage.removeItem('expermate_support_modal_hidden');}} />
            {"以后不再显示"}
          </label>
        </div>
      </section>
    </div>
    <div id={"account-modal"} style={{"display": account.dialog === "account" ? "flex" : "none", "position": "fixed", "inset": "0", "zIndex": "9998", "background": "rgba(0,0,0,0.5)", "alignItems": "center", "justifyContent": "center"}}>
      <div style={{"background": "var(--white)", "border": "6px solid var(--black)", "boxShadow": "12px 12px 0 var(--shadow-color)", "width": "340px", "maxWidth": "90vw"}}>
        <div style={{"display": "flex", "alignItems": "center", "justifyContent": "space-between", "background": "var(--black)", "color": "var(--white)", "padding": "10px 16px", "fontSize": "0.9rem", "fontWeight": "700"}}>
          <span>
            {"账户"}
          </span>
          <button type={"button"} onClick={() => { account.close(); }} aria-label={"关闭账户菜单"} style={{"border": "0", "background": "transparent", "color": "inherit", "font": "700 1.2rem/1 inherit", "cursor": "pointer"}}>
            {"×"}
          </button>
        </div>
        <div style={{"padding": "18px 20px"}}>
          <strong id={"account-modal-name"} style={{"display": "block", "marginBottom": "14px"}}>{account.account}</strong>
          <button type={"button"} className={"outline"} style={{"display": "block", "width": "100%", "marginBottom": "8px"}} onClick={() => { account.close();account.open("password"); }}>
            {"修改密码"}
          </button>
          <button type={"button"} className={"outline"} style={{"display": "block", "width": "100%", "marginBottom": "8px"}} onClick={() => { account.close();account.open("email"); }}>
            {"修改恢复邮箱"}
          </button>
          <button type={"button"} className={"outline"} style={{"display": "block", "width": "100%", "marginBottom": "8px"}} onClick={() => { account.close();services.PanelManager?.navigate('/settings'); }}>
            {"设置"}
          </button>
          <button type={"button"} className={"outline danger"} style={{"display": "block", "width": "100%"}} onClick={() => { account.logout(); }} disabled={account.pending}>
            {"退出登录"}
          </button>
          {account.feedback.account?.text && <div role="alert" style={{color: 'var(--red)', fontSize: '0.75rem', fontWeight: 700, marginTop: 10}}>{account.feedback.account.text}</div>}
        </div>
      </div>
    </div>
    <div id={"auth-modal"} style={{"display": account.dialog === "auth" ? "flex" : "none", "position": "fixed", "inset": "0", "zIndex": "9999", "background": "rgba(0,0,0,0.5)", "alignItems": "center", "justifyContent": "center"}}>
      <div style={{"background": "var(--white)", "border": "6px solid var(--black)", "boxShadow": "12px 12px 0px var(--shadow-color)", "width": "340px", "maxWidth": "90vw", "position": "relative"}}>
        <button onClick={() => { account.close(); }} style={{"position": "absolute", "top": "8px", "right": "12px", "background": "none", "border": "none", "fontSize": "1.2rem", "fontWeight": "900", "cursor": "pointer", "color": "var(--white)", "zIndex": "1"}}>
          {"×"}
        </button>
        <div style={{"background": "var(--black)", "color": "var(--white)", "padding": "10px 16px", "fontSize": "0.9rem", "fontWeight": "700", "letterSpacing": "1px"}} id={"auth-modal-title"}>
          {account.registering ? "注册" : "登录"}
        </div>
        <div style={{"padding": "20px 20px 16px"}}>
          <form id={"auth-form"} onSubmit={(event) => { event.preventDefault(); account.login(); }}>
            <label style={{"fontSize": "0.72rem", "fontWeight": "700", "display": "block", "marginBottom": "4px"}}>
              {"用户名"}
            </label>
            <input type={"text"} id={"auth-username"} {...field("auth-username")} required autoComplete={"username"} style={{"width": "100%", "padding": "6px 8px", "fontSize": "0.85rem", "border": "3px solid var(--black)", "marginBottom": "12px", "boxSizing": "border-box"}} />
            <label style={{"fontSize": "0.72rem", "fontWeight": "700", "display": "block", "marginBottom": "4px"}}>
              {"密码"}
            </label>
            <input type={"password"} id={"auth-password"} {...field("auth-password")} required autoComplete={"current-password"} style={{"width": "100%", "padding": "6px 8px", "fontSize": "0.85rem", "border": "3px solid var(--black)", "marginBottom": "12px", "boxSizing": "border-box"}} />
            <div id={"auth-email-wrap"} style={{"display": account.registering ? "block" : "none"}}>
              <label style={{"fontSize": "0.72rem", "fontWeight": "700", "display": "block", "marginBottom": "4px"}}>
                {"恢复邮箱（忘记密码靠它找回）"}
              </label>
              <input type={"email"} id={"auth-email"} {...field("auth-email")} autoComplete={"email"} style={{"width": "100%", "padding": "6px 8px", "fontSize": "0.85rem", "border": "3px solid var(--black)", "marginBottom": "16px", "boxSizing": "border-box"}} />
            </div>
            <div id={"auth-error"} style={{"display": account.feedback.auth?.text ? "block" : "none", "color": account.feedback.auth?.success ? "var(--ok-green)" : "var(--red)", "fontSize": "0.75rem", "fontWeight": "600", "marginBottom": "10px"}}>{account.feedback.auth?.text}</div>
            <button type={"submit"} id={"auth-submit-btn"} disabled={account.pending} style={{"width": "100%", "padding": "8px", "background": "var(--black)", "color": "var(--white)", "border": "3px solid var(--black)", "fontSize": "0.85rem", "fontWeight": "700", "cursor": "pointer", "letterSpacing": "1px"}}>
              {account.registering ? "REGISTER" : "LOGIN"}
            </button>
          </form>
          <div style={{"textAlign": "center", "marginTop": "12px", "fontSize": "0.72rem"}}>
            <span id={"auth-toggle-text"}>
              {account.registering ? "已有账号？" : "没有账号？"}
            </span>
            <a href={"#"} id={"auth-toggle-link"} onClick={(event) => { account.toggleMode();event.preventDefault(); }} style={{"color": "var(--blue)", "fontWeight": "700", "textDecoration": "none"}}>
              {account.registering ? "登录" : "注册"}
            </a>
          </div>
          <div style={{"textAlign": "center", "marginTop": "4px", "fontSize": "0.72rem"}}>
            <a href={"#"} onClick={(event) => { account.open("forgot");event.preventDefault(); }} style={{"color": "var(--blue)", "fontWeight": "700", "textDecoration": "none"}}>
              {"忘记密码？"}
            </a>
          </div>
        </div>
      </div>
    </div>
    <div id={"forgot-modal"} style={{"display": account.dialog === "forgot" ? "flex" : "none", "position": "fixed", "inset": "0", "zIndex": "9998", "background": "rgba(0,0,0,0.5)", "alignItems": "center", "justifyContent": "center"}}>
      <div style={{"background": "var(--white)", "border": "6px solid var(--black)", "boxShadow": "12px 12px 0 var(--shadow-color)", "width": "340px", "maxWidth": "90vw"}}>
        <div style={{"background": "var(--black)", "color": "var(--white)", "padding": "10px 16px", "fontSize": "0.9rem", "fontWeight": "700"}}>
          {"忘记密码"}
        </div>
        <div style={{"padding": "20px"}}>
          <div id={"forgot-step1"} style={{display: account.forgotStep === 1 ? undefined : "none"}}>
            <label style={{"fontSize": "0.72rem", "fontWeight": "700", "display": "block", "marginBottom": "4px"}}>
              {"账号"}
            </label>
            <input id={"forgot-account"} {...field("forgot-account")} style={{"width": "100%", "padding": "6px 8px", "fontSize": "0.85rem", "border": "3px solid var(--black)", "marginBottom": "12px", "boxSizing": "border-box"}} />
            <label style={{"fontSize": "0.72rem", "fontWeight": "700", "display": "block", "marginBottom": "4px"}}>
              {"恢复邮箱"}
            </label>
            <input type={"email"} id={"forgot-email"} {...field("forgot-email")} style={{"width": "100%", "padding": "6px 8px", "fontSize": "0.85rem", "border": "3px solid var(--black)", "marginBottom": "14px", "boxSizing": "border-box"}} />
            <button onClick={() => { account.forgot(); }} disabled={account.pending} style={{"width": "100%", "padding": "8px", "background": "var(--black)", "color": "var(--white)", "border": "3px solid var(--black)", "fontSize": "0.85rem", "fontWeight": "700", "cursor": "pointer"}}>
              {"发送验证码"}
            </button>
          </div>
          <div id={"forgot-step2"} style={{"display": account.forgotStep === 2 ? "block" : "none"}}>
            <div id={"forgot-msg"} style={{"fontSize": "0.75rem", "fontWeight": "700", "marginBottom": "10px"}}>{account.forgotNotice}</div>
            <label style={{"fontSize": "0.72rem", "fontWeight": "700", "display": "block", "marginBottom": "4px"}}>
              {"验证码"}
            </label>
            <input id={"forgot-token"} {...field("forgot-token")} style={{"width": "100%", "padding": "6px 8px", "fontSize": "0.85rem", "border": "3px solid var(--black)", "marginBottom": "12px", "boxSizing": "border-box"}} />
            <label style={{"fontSize": "0.72rem", "fontWeight": "700", "display": "block", "marginBottom": "4px"}}>
              {"新密码"}
            </label>
            <input type={"password"} id={"forgot-password"} {...field("forgot-password")} style={{"width": "100%", "padding": "6px 8px", "fontSize": "0.85rem", "border": "3px solid var(--black)", "marginBottom": "14px", "boxSizing": "border-box"}} />
            <button onClick={() => { account.reset(); }} disabled={account.pending} style={{"width": "100%", "padding": "8px", "background": "var(--black)", "color": "var(--white)", "border": "3px solid var(--black)", "fontSize": "0.85rem", "fontWeight": "700", "cursor": "pointer"}}>
              {"重置密码"}
            </button>
          </div>
          <div id={"forgot-error"} style={{"color": account.feedback.forgot?.success ? "var(--ok-green)" : "var(--red)", "fontWeight": "700", "fontSize": "0.75rem", "minHeight": "1.2em", "marginTop": "10px"}}>{account.feedback.forgot?.text}</div>
        </div>
      </div>
    </div>
    <div id={"change-modal"} style={{"display": account.dialog === "password" ? "flex" : "none", "position": "fixed", "inset": "0", "zIndex": "9997", "background": "rgba(0,0,0,0.5)", "alignItems": "center", "justifyContent": "center"}}>
      <div style={{"background": "var(--white)", "border": "6px solid var(--black)", "boxShadow": "12px 12px 0 var(--shadow-color)", "width": "340px", "maxWidth": "90vw"}}>
        <div style={{"display": "flex", "alignItems": "center", "justifyContent": "space-between", "background": "var(--black)", "color": "var(--white)", "padding": "10px 16px", "fontSize": "0.9rem", "fontWeight": "700"}}>
          <span>
            {"修改密码"}
          </span>
          <button type={"button"} onClick={() => { account.close(); }} aria-label={"关闭修改密码窗口"} style={{"border": "0", "background": "transparent", "color": "inherit", "font": "700 1.2rem/1 inherit", "cursor": "pointer"}}>
            {"×"}
          </button>
        </div>
        <div style={{"padding": "20px"}}>
          <label style={{"fontSize": "0.72rem", "fontWeight": "700", "display": "block", "marginBottom": "4px"}}>
            {"当前密码"}
          </label>
          <input type={"password"} id={"change-old"} {...field("change-old")} style={{"width": "100%", "padding": "6px 8px", "fontSize": "0.85rem", "border": "3px solid var(--black)", "marginBottom": "12px", "boxSizing": "border-box"}} />
          <label style={{"fontSize": "0.72rem", "fontWeight": "700", "display": "block", "marginBottom": "4px"}}>
            {"新密码（至少 6 位）"}
          </label>
          <input type={"password"} id={"change-new"} {...field("change-new")} style={{"width": "100%", "padding": "6px 8px", "fontSize": "0.85rem", "border": "3px solid var(--black)", "marginBottom": "12px", "boxSizing": "border-box"}} />
          <label style={{"fontSize": "0.72rem", "fontWeight": "700", "display": "block", "marginBottom": "4px"}}>
            {"确认新密码"}
          </label>
          <input type={"password"} id={"change-confirm"} {...field("change-confirm")} style={{"width": "100%", "padding": "6px 8px", "fontSize": "0.85rem", "border": "3px solid var(--black)", "marginBottom": "14px", "boxSizing": "border-box"}} />
          <button onClick={() => { account.changePassword(); }} disabled={account.pending} style={{"width": "100%", "padding": "8px", "background": "var(--black)", "color": "var(--white)", "border": "3px solid var(--black)", "fontSize": "0.85rem", "fontWeight": "700", "cursor": "pointer"}}>
            {"修改密码"}
          </button>
          <div id={"change-error"} style={{"color": account.feedback.password?.success ? "var(--ok-green)" : "var(--red)", "fontWeight": "700", "fontSize": "0.75rem", "minHeight": "1.2em", "marginTop": "10px"}}>{account.feedback.password?.text}</div>
        </div>
      </div>
    </div>
    <div id={"change-email-modal"} style={{"display": account.dialog === "email" ? "flex" : "none", "position": "fixed", "inset": "0", "zIndex": "9996", "background": "rgba(0,0,0,0.5)", "alignItems": "center", "justifyContent": "center"}}>
      <div style={{"background": "var(--white)", "border": "6px solid var(--black)", "boxShadow": "12px 12px 0 var(--shadow-color)", "width": "340px", "maxWidth": "90vw"}}>
        <div style={{"display": "flex", "alignItems": "center", "justifyContent": "space-between", "background": "var(--black)", "color": "var(--white)", "padding": "10px 16px", "fontSize": "0.9rem", "fontWeight": "700"}}>
          <span>
            {"修改恢复邮箱"}
          </span>
          <button type={"button"} onClick={() => { account.close(); }} aria-label={"关闭修改恢复邮箱窗口"} style={{"border": "0", "background": "transparent", "color": "inherit", "font": "700 1.2rem/1 inherit", "cursor": "pointer"}}>
            {"×"}
          </button>
        </div>
        <div style={{"padding": "20px"}}>
          <p style={{"fontSize": "0.75rem", "lineHeight": "1.5", "margin": "0 0 12px", "opacity": "0.72"}}>
            {"这是安全敏感操作，请先确认当前登录密码；新邮箱仍须通过验证码验证。"}
          </p>
          <label htmlFor={"ce-password"} style={{"fontSize": "0.72rem", "fontWeight": "700", "display": "block", "marginBottom": "4px"}}>
            {"当前密码"}
          </label>
          <input type={"password"} id={"ce-password"} {...field("ce-password")} autoComplete={"current-password"} style={{"width": "100%", "padding": "6px 8px", "fontSize": "0.85rem", "border": "3px solid var(--black)", "marginBottom": "14px", "boxSizing": "border-box"}} />
          <div id={"ce-step1"} style={{display: account.emailStep === 1 ? undefined : "none"}}>
            <label style={{"fontSize": "0.72rem", "fontWeight": "700", "display": "block", "marginBottom": "4px"}}>
              {"新恢复邮箱"}
            </label>
            <input type={"email"} id={"ce-email"} {...field("ce-email")} style={{"width": "100%", "padding": "6px 8px", "fontSize": "0.85rem", "border": "3px solid var(--black)", "marginBottom": "14px", "boxSizing": "border-box"}} />
            <button onClick={() => { account.requestEmail(); }} disabled={account.pending} style={{"width": "100%", "padding": "8px", "background": "var(--black)", "color": "var(--white)", "border": "3px solid var(--black)", "fontSize": "0.85rem", "fontWeight": "700", "cursor": "pointer"}}>
              {"发送验证码到新邮箱"}
            </button>
          </div>
          <div id={"ce-step2"} style={{"display": account.emailStep === 2 ? "block" : "none"}}>
            <div id={"ce-msg"} style={{"fontSize": "0.75rem", "fontWeight": "700", "marginBottom": "10px"}}>{account.emailNotice}</div>
            <label style={{"fontSize": "0.72rem", "fontWeight": "700", "display": "block", "marginBottom": "4px"}}>
              {"验证码"}
            </label>
            <input id={"ce-token"} {...field("ce-token")} style={{"width": "100%", "padding": "6px 8px", "fontSize": "0.85rem", "border": "3px solid var(--black)", "marginBottom": "14px", "boxSizing": "border-box"}} />
            <button onClick={() => { account.confirmEmail(); }} disabled={account.pending} style={{"width": "100%", "padding": "8px", "background": "var(--black)", "color": "var(--white)", "border": "3px solid var(--black)", "fontSize": "0.85rem", "fontWeight": "700", "cursor": "pointer"}}>
              {"确认更换邮箱"}
            </button>
          </div>
          <div id={"ce-error"} style={{"color": account.feedback.email?.success ? "var(--ok-green)" : "var(--red)", "fontWeight": "700", "fontSize": "0.75rem", "minHeight": "1.2em", "marginTop": "10px"}}>{account.feedback.email?.text}</div>
        </div>
      </div>
    </div>
  </>;
}
