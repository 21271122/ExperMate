import type { ChangeEvent, FormEvent } from 'react';
export type ControlProps = {value?:string;checked?:boolean;disabled?:boolean;onChange:(event:ChangeEvent<HTMLInputElement|HTMLSelectElement>)=>void};
type Props = {field:(name:string)=>ControlProps;soundField:(name:string)=>ControlProps;theme:string;setTheme:(theme:string)=>void;tracks:{id:string;title:string}[];agentPlaceholder:string;analyzePlaceholder:string;pending:boolean; submit:(event:FormEvent<HTMLFormElement>)=>void;providers:{id:string;label:string;base_url:string}[];maskedAgent:string;maskedAnalyze:string;message:string;failed:boolean};
// 按原设置模板转换，保留标签层级、文字和内联样式。
export function SettingsForm({field,soundField,theme,setTheme,tracks,agentPlaceholder,analyzePlaceholder,pending,submit,providers,maskedAgent,maskedAnalyze,message,failed}:Props){return <>
    <link rel={"stylesheet"} href={"/static/css/settings.css"} />
    <section className={"settings-content"}>
      <h1 style={{"borderBottom": "none", "paddingBottom": "0"}}>
        {"设置"}
      </h1>
      <p className={"settings-kicker"} style={{"fontWeight": "700", "fontSize": "0.8rem", "opacity": "0.5", "letterSpacing": "1px"}}>
        {"配置模型、兼容接口与服务"}
      </p>
      {message && <div className={`flash flash-${failed ? "error" : "success"}`} role="status" style={{borderLeft:"8px solid var(--black)"}}>{message}</div>}
      <form onSubmit={submit} style={{"marginTop": "1.5rem"}}>
        <h3 style={{"margin": "1.2rem 0 0.3rem"}}>
          {"助手与结构化提取模型"}
        </h3>
        <small style={{"fontWeight": "500", "opacity": "0.65"}}>
          {"必须选择支持 Function Calling 的模型；同一模型也用于把自然语言整理为实验记录。"}
        </small>
        <label style={{"marginTop": "0.8rem"}}>
          <strong>
            {"模型服务商"}
          </strong>
        </label>
        <select {...field("LLM_AGENT_PROVIDER")} id={"agent-provider"} name={"LLM_AGENT_PROVIDER"} data-base-target={"agent-base-url"}>
          {providers.map(provider => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
        </select>
        <label style={{"marginTop": "0.8rem"}}>
          <strong>
            {"API 密钥"}
          </strong>
        </label>
        <input {...field("LLM_AGENT_API_KEY")} type={"password"} name={"LLM_AGENT_API_KEY"} autoComplete={"off"} placeholder={maskedAgent ? `已保存：${maskedAgent}（留空不修改）` : "输入所选服务的 API Key"} className={"settings-code-input"} />
        <label style={{"marginTop": "0.8rem"}}>
          <strong>
            {"Base URL（可选）"}
          </strong>
          <small style={{"fontWeight": "500", "opacity": "0.6"}}>
            {"留空使用所选厂商的官方 OpenAI 兼容地址；自定义服务必须填写。"}
          </small>
        </label>
        <input {...field("LLM_AGENT_BASE_URL")} type={"url"} id={"agent-base-url"} name={"LLM_AGENT_BASE_URL"} placeholder={agentPlaceholder} />
        <label style={{"marginTop": "0.8rem"}}>
          <strong>
            {"模型名称"}
          </strong>
        </label>
        <input {...field("LLM_AGENT_MODEL")} type={"text"} name={"LLM_AGENT_MODEL"} placeholder={"例如 deepseek-chat、qwen-plus、glm-5.3"} />
        <label htmlFor={"llm-reasoning-effort"} style={{"marginTop": "0.8rem"}}>
          <strong>
            {"思考强度"}
          </strong>
        </label>
        <select {...field("LLM_REASONING_EFFORT")} id={"llm-reasoning-effort"} name={"LLM_REASONING_EFFORT"}>
          <option value={"low"}>
            {"低 · 更快"}
          </option>
          <option value={"medium"}>
            {"中 · 平衡"}
          </option>
          <option value={"high"}>
            {"高 · 更充分"}
          </option>
          <option value={"max"}>
            {"最高 · 当前默认"}
          </option>
        </select>
        <small style={{"fontWeight": "500", "opacity": "0.6"}}>
          {"作用于助手、子 Agent 和分析报告生成。仅支持该参数的模型服务会收到此设置；其他服务保持原有调用方式。"}
        </small>
        <h3 style={{"margin": "1.4rem 0 0.3rem"}}>
          {"主聊天会话整理"}
        </h3>
        <small style={{"fontWeight": "500", "opacity": "0.65"}}>
          {"只作用于主 Agent 当前会话。到达阈值后，将较早原文整理为摘要；完整原文仍保存在聊天记录中，可继续翻阅。"}
        </small>
        <div style={{"display": "flex", "gap": "1rem", "flexWrap": "wrap", "marginTop": "0.8rem"}}>
          <div style={{"flex": "1", "minWidth": "180px"}}>
            <label htmlFor={"compression-trigger"}>
              <strong>
                {"触发阈值"}
              </strong>
            </label>
            <input {...field("CONTEXT_COMPRESSION_TRIGGER_TOKENS")} id={"compression-trigger"} type={"number"} name={"CONTEXT_COMPRESSION_TRIGGER_TOKENS"} min={"10000"} max={"1000000"} step={"1000"} />
          </div>
          <div style={{"flex": "1", "minWidth": "180px"}}>
            <label htmlFor={"compression-chunk"}>
              <strong>
                {"每次整理量"}
              </strong>
            </label>
            <input {...field("CONTEXT_COMPRESSION_CHUNK_TOKENS")} id={"compression-chunk"} type={"number"} name={"CONTEXT_COMPRESSION_CHUNK_TOKENS"} min={"1000"} max={"990000"} step={"1000"} />
          </div>
        </div>
        <small style={{"fontWeight": "500", "opacity": "0.6"}}>
          {"单位均为 token。默认 300,000 / 260,000，整理后通常保留最近约 40,000 token 的完整消息；工具调用会按完整组保留，因此会有少量偏差。"}
        </small>
        <h3 style={{"margin": "1.4rem 0 0.3rem"}}>
          {"分析模型 "}
          <small style={{"fontWeight": "500", "opacity": "0.55"}}>
            {"可选"}
          </small>
        </h3>
        <small style={{"fontWeight": "500", "opacity": "0.65"}}>
          {"留空则完全继承 Agent 配置；可单独设置为更适合长文推理的模型。"}
        </small>
        <label style={{"marginTop": "0.8rem"}}>
          <strong>
            {"模型服务商"}
          </strong>
        </label>
        <select {...field("LLM_ANALYZE_PROVIDER")} id={"analyze-provider"} name={"LLM_ANALYZE_PROVIDER"} data-base-target={"analyze-base-url"}>
          <option value={""}>
            {"继承 Agent 配置"}
          </option>
          {providers.map(provider => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
        </select>
        <label style={{"marginTop": "0.8rem"}}>
          <strong>
            {"API 密钥（可选）"}
          </strong>
        </label>
        <input {...field("LLM_ANALYZE_API_KEY")} type={"password"} name={"LLM_ANALYZE_API_KEY"} autoComplete={"off"} placeholder={maskedAnalyze ? `已保存：${maskedAnalyze}（留空不修改）` : "留空继承 Agent API Key"} className={"settings-code-input"} />
        <label style={{"marginTop": "0.8rem"}}>
          <strong>
            {"Base URL（可选）"}
          </strong>
        </label>
        <input {...field("LLM_ANALYZE_BASE_URL")} type={"url"} id={"analyze-base-url"} name={"LLM_ANALYZE_BASE_URL"} placeholder={analyzePlaceholder} />
        <label style={{"marginTop": "0.8rem"}}>
          <strong>
            {"模型名称（可选）"}
          </strong>
        </label>
        <input {...field("LLM_ANALYZE_MODEL")} type={"text"} name={"LLM_ANALYZE_MODEL"} placeholder={"留空继承 Agent Model"} />
        <label style={{"marginTop": "0.8rem"}}>
          <strong>
            {"分析任务总时限"}
          </strong>
        </label>
        <input {...field("ANALYSIS_TIMEOUT_MINUTES")} type={"number"} name={"ANALYSIS_TIMEOUT_MINUTES"} min={"1"} max={"30"} step={"1"} />
        <small style={{"fontWeight": "500", "opacity": "0.6"}}>
          {"单位：分钟。到达上限会直接返回，不自动重试。"}
        </small>
        <p style={{"fontSize": "0.75rem", "lineHeight": "1.5", "opacity": "0.65", "margin": "0.9rem 0 0"}}>
          {"已内置 DeepSeek、千问、GLM、Kimi、MiniMax、百度 AI Studio/千帆、火山方舟预设；也可填写任意 OpenAI Chat Completions 兼容地址。厂商侧仍须确认所选 Agent 模型支持 Function Calling。"}
        </p>
        <hr style={{"border": "3px solid var(--black)", "margin": "1.5rem 0"}} />
        <div style={{"display": "flex", "gap": "1rem", "flexWrap": "wrap"}}>
          <div style={{"flex": "1", "minWidth": "120px"}}>
            <label>
              <strong>
                {"端口"}
              </strong>
            </label>
            <input {...field("PORT")} type={"number"} id={"port"} name={"PORT"} min={"1024"} max={"65535"} />
          </div>
          <div style={{"flex": "2", "minWidth": "180px"}}>
            <label>
              <strong>
                {"主机地址"}
              </strong>
            </label>
            <input {...field("HOST")} type={"text"} id={"host"} name={"HOST"} />
          </div>
        </div>
        <label style={{"marginTop": "1rem", "display": "flex", "alignItems": "center", "gap": "0.5rem", "cursor": "pointer"}}>
          <input {...field("GUI")} type={"checkbox"} name={"GUI"} style={{"width": "auto"}} />
          <span>
            <strong>
              {"启动时打开桌面窗口"}
            </strong>
            <br />
            <small style={{"fontWeight": "500", "opacity": "0.6"}}>
              {"需要 pywebview；未安装时会以浏览器模式打开。"}
            </small>
          </span>
        </label>
        <p style={{"fontWeight": "700", "fontSize": "0.75rem", "opacity": "0.5", "marginTop": "0.5rem", "letterSpacing": "0.5px"}}>
          {"\n    修改端口或主机地址后需要重启。\n  "}
        </p>
        <label style={{"marginTop": "1rem"}}>
          <strong>
            {"外观"}
          </strong>
        </label>
        <div id={"theme-options"} style={{"display": "flex", "gap": "0.4rem", "flexWrap": "wrap", "marginBottom": "1rem"}}>
          <button type={"button"} className={`filter-chip${theme === 'system' ? ' active' : ''}`} data-pref={"system"} onClick={()=>setTheme('system')}>
            {"跟随系统"}
          </button>
          <button type={"button"} className={`filter-chip${theme === 'light' ? ' active' : ''}`} data-pref={"light"} onClick={()=>setTheme('light')}>
            {"浅色"}
          </button>
          <button type={"button"} className={`filter-chip${theme === 'dark' ? ' active' : ''}`} data-pref={"dark"} onClick={()=>setTheme('dark')}>
            {"深色"}
          </button>
        </div>
        <section style={{"marginTop": "1.3rem", "paddingTop": "1rem", "borderTop": "3px solid var(--black)"}}>
          <h3 style={{"margin": "0 0 0.3rem"}}>
            {"声音"}
          </h3>
          <small style={{"fontWeight": "500", "opacity": "0.65"}}>
            {"声音偏好仅保存在这台设备。背景音乐默认关闭；播放结束后会随机切换下一首。"}
          </small>
          <label style={{"marginTop": "0.8rem", "display": "flex", "alignItems": "center", "gap": "0.5rem", "cursor": "pointer"}}>
            <input {...soundField('sfx')} id={"sound-sfx"} type={"checkbox"} style={{"width": "auto"}} />
            <span>
              <strong>
                {"操作音效"}
              </strong>
              <br />
              <small style={{"fontWeight": "500", "opacity": "0.6"}}>
                {"发送、回复完成、保存、跳转与错误提示。"}
              </small>
            </span>
          </label>
          <label style={{"marginTop": "0.5rem", "display": "block"}}>
            <strong>
              {"音效音量"}
            </strong>
            <input {...soundField('sfxVolume')} id={"sound-sfx-volume"} type={"range"} min={"0"} max={"100"} style={{"display": "block", "width": "100%", "accentColor": "var(--blue)"}} />
          </label>
          <label style={{"marginTop": "0.9rem", "display": "flex", "alignItems": "center", "gap": "0.5rem", "cursor": "pointer"}}>
            <input {...soundField('bgm')} id={"sound-bgm"} type={"checkbox"} style={{"width": "auto"}} />
            <span>
              <strong>
                {"古典背景音乐"}
              </strong>
              <br />
              <small style={{"fontWeight": "500", "opacity": "0.6"}}>
                {"当前曲库共 30 首；可手动切换当前曲目。"}
              </small>
            </span>
          </label>
          <label style={{"marginTop": "0.5rem", "display": "block"}}>
            <strong>
              {"背景音乐音量"}
            </strong>
            <input {...soundField('bgmVolume')} id={"sound-bgm-volume"} type={"range"} min={"0"} max={"30"} style={{"display": "block", "width": "100%", "accentColor": "var(--blue)"}} />
          </label>
          <label htmlFor={"sound-bgm-track"} style={{"marginTop": "0.8rem", "display": "block"}}>
            <strong>
              {"播放曲目"}
            </strong>
            <select {...soundField('bgmTrack')} id={"sound-bgm-track"} style={{"marginTop": "0.35rem"}}>{tracks.map(track=><option key={track.id} value={track.id}>{track.title}</option>)}</select>
            <small style={{"display": "block", "fontWeight": "500", "opacity": "0.6", "marginTop": "0.3rem"}}>
              {"选择一首会立即切换；播放结束后仍随机播放下一首。"}
            </small>
          </label>
        </section>
        <button type={"submit"} disabled={pending} style={{"minWidth": "140px", "marginTop": "1rem"}}>
          {"保存设置"}
        </button>
      </form>
    </section>
</>;}
