/**
 * child-agent.js — 子 Agent 对话模块。
 * sessionStorage 持久化状态，支持实验编辑与分析审阅两种模式。
 */
(function () {
  "use strict";

  // ---- State ----

  window._childState = null;
  window._childPreview = null;
  window._childLegacyData = null;

  function _childKind() {
    return document.body.dataset.childAgentKind || "experiment";
  }

  function _childResourceId() {
    if (_childKind() === "analysis") return document.body.dataset.analysisId || "";
    return document.body.dataset.expId || window.location.pathname.split("/").pop();
  }

  function _childEndpoint() {
    var id = encodeURIComponent(_childResourceId());
    return _childKind() === "analysis" ? "/api/analysis/" + id + "/chat" : "/api/exp/" + id + "/chat";
  }

  function _childSessionKey() {
    return (_childKind() === "analysis" ? "exdiary_analysis_child_" : "exdiary_child_") + _childResourceId();
  }

  function loadChildSession() {
    try { var s = sessionStorage.getItem(_childSessionKey()); return s ? JSON.parse(s) : null; }
    catch (e) { return null; }
  }

  function saveChildSession() {
    try { if (window._childState) sessionStorage.setItem(_childSessionKey(), JSON.stringify(window._childState)); }
    catch (e) { /* noop */ }
  }

  window.clearChildSession = function () {
    try { sessionStorage.removeItem(_childSessionKey()); } catch (e) { /* noop */ }
  };

  function _childIsInternal(m) {
    if (m.role === "system") return true;
    if (m.role === "assistant" && m.tool_calls && (!m.content || !String(m.content).trim())) return true;
    if (m.role === "tool") return true;
    return false;
  }

  function _setChildInputEnabled(e) {
    var input = document.getElementById("child-input");
    var send = document.getElementById("btn-child-send");
    if (input) {
      input.disabled = false;
      input.readOnly = false;
      input.setAttribute("aria-busy", e ? "false" : "true");
      input.placeholder = e ? (input.dataset.idlePlaceholder || input.placeholder) : "可继续输入，回复结束后再发送…";
    }
    if (send) send.disabled = !e;
  }

  // 忙标记：任何 LLM 请求在途时禁用输入与发送，防止生成期间乱发。
  window._childBusy = false;
  var _childColorTimer = null;

  function _formatChildTime(createdAt) {
    var raw = createdAt ? String(createdAt).replace(" ", "T") : "";
    var date = raw ? new Date(raw) : new Date();
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString("zh-CN", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    });
  }

  function _updateChildStatus(text) {
    var status = document.getElementById("child-status-bar");
    if (!status) return;
    var turn = window._childState && Number(window._childState.turn_count || 0);
    if (!text && !turn) { status.style.display = "none"; return; }
    status.style.display = "block";
    status.textContent = [text, turn ? "Round " + turn : ""].filter(Boolean).join(" — ");
  }

  function _animateChildDivider() {
    var spans = document.querySelectorAll("#child-color-divider span");
    if (!spans.length) return;
    var parts = [Math.random() * 70 + 8, Math.random() * 70 + 8,
      Math.random() * 70 + 8, Math.random() * 70 + 8];
    var total = parts.reduce(function (a, b) { return a + b; }, 0);
    spans.forEach(function (span, index) {
      span.style.transition = "flex-grow .8s cubic-bezier(.4,0,.2,1)";
      span.style.flexGrow = (parts[index] / total * 10).toFixed(2);
    });
    _childColorTimer = setTimeout(_animateChildDivider, 800 + Math.random() * 600);
  }

  function _setChildDividerActive(active) {
    clearTimeout(_childColorTimer);
    _childColorTimer = null;
    var spans = document.querySelectorAll("#child-color-divider span");
    if (active) _animateChildDivider();
    else spans.forEach(function (span) { span.style.flexGrow = "1"; });
  }

  function _setChildBusy(b) {
    window._childBusy = !!b;
    _setChildInputEnabled(!b);
    var modal = document.getElementById("child-modal");
    if (modal) modal.classList.toggle("child-agent-busy", !!b);
    _setChildDividerActive(!!b);
    _updateChildStatus(b ? "AI 正在回复…" : "");
  }

  function _childResponse(response) {
    return response.json().catch(function () { return {}; }).then(function (data) {
      if (!response.ok || !data.ok) throw new Error(data.error || "请求失败");
      return data;
    });
  }

  function _mountChildModal() {
    var modal = document.getElementById("child-modal");
    var pane = document.getElementById("content-body");
    if (pane && modal && modal.parentElement !== pane) pane.appendChild(modal);
    return modal;
  }

  function _attachmentMarkup(attachments) {
    if (!attachments || !attachments.length) return "";
    return '<div style="margin-top:0.45rem;font-size:0.78em;opacity:0.8;border-top:1px solid currentColor;padding-top:0.3rem">附件：' +
      attachments.map(function (item) { return escHtml(item.name || "未命名附件"); }).join("、") + "</div>";
  }

  function _appendChildMsg(role, content, attachments, createdAt) {
    var c = document.getElementById("child-msgs");
    var d = document.createElement("div");
    d.className = "child-msg-row " + role;
    d.style.cssText = "display:flex;margin-bottom:14px;" + (role === "user" ? "justify-content:flex-end" : "");
    d.innerHTML = '<div class="child-msg-wrap"><div class="child-msg-content child-chat-bubble child-chat-bubble-' + role + '">' +
      (role === "agent" && typeof marked !== "undefined" ? marked.parse(content) : escHtml(content)) +
      _attachmentMarkup(attachments) + '</div><time class="child-msg-time" datetime="' + escHtml(createdAt || "") + '">' +
      escHtml(_formatChildTime(createdAt)) + "</time></div>";
    var wrap = d.querySelector(".child-msg-wrap");
    var bubble = d.querySelector(".child-msg-content");
    var time = d.querySelector(".child-msg-time");
    if (wrap) wrap.style.cssText = "display:flex;flex-direction:column;max-width:82%;min-width:0;" + (role === "user" ? "align-items:flex-end" : "");
    if (bubble) bubble.style.cssText = role === "agent"
      ? "box-sizing:border-box;min-width:0;overflow-wrap:anywhere;word-break:break-word;background:var(--bubble-agent-bg);border:2px solid var(--black);padding:8px 12px;font-size:0.88rem;line-height:1.6;color:var(--black)"
      : "box-sizing:border-box;min-width:0;overflow-wrap:anywhere;word-break:break-word;background:var(--black);color:var(--white);padding:8px 14px;border:3px solid var(--black);font-size:0.88rem;line-height:1.6;font-weight:600";
    if (time) time.style.cssText = "margin-top:3px;color:var(--gray);font-family:var(--font-mono,monospace);font-size:0.65rem;line-height:1";
    c.appendChild(d);
    c.scrollTop = c.scrollHeight;
    return d;
  }

  document.addEventListener("input", function (event) {
    if (event.target.id !== "child-input") return;
    event.target.style.height = "auto";
    event.target.style.height = Math.min(event.target.scrollHeight, 140) + "px";
  });

  function _showChildPreview(data) {
    window._childPreview = data;
    document.getElementById("child-preview").style.display = "";
    var c = document.getElementById("child-preview-content");
    c.innerHTML = '<h4 style="font-weight:700;text-transform:uppercase">Preview Changes</h4>';
    ["title", "status", "tags", "purpose", "conclusion"].forEach(function (f) {
      if (data[f]) c.innerHTML += '<div style="margin:0.3rem 0"><strong>' + f + "</strong>: " +
        escHtml(typeof data[f] === "string" ? data[f] : JSON.stringify(data[f])) + "</div>";
    });
    c.innerHTML += '<button onclick="confirmChildChange()" style="margin-top:0.5rem">Confirm</button>';
  }

  function _renderChildHistory(data) {
    var container = document.getElementById("child-msgs");
    container.innerHTML = "";
    var msgs = data.state ? data.state.history : [];
    var split = (data.state && data.state._child_initial_history_len) || 0;
    var hasHistory = false;
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      if (i === split && split > 0 && hasHistory) {
        var sep = document.createElement("div");
        sep.style.cssText = "text-align:center;margin:0.6rem 0;font-weight:700;font-size:0.7rem;opacity:0.5";
        sep.innerHTML = '<span style="background:var(--white);padding:0 0.5rem">—— Modification session ——</span>';
        container.appendChild(sep);
      }
      if (_childIsInternal(m)) continue;
      if (m.role === "user" && m.content) { _appendChildMsg("user", m.content, m.attachments, m.created_at); if (i < split) hasHistory = true; }
      else if (["assistant", "agent"].includes(m.role) && m.content) { _appendChildMsg("agent", m.content, null, m.created_at); if (i < split) hasHistory = true; }
    }
    container.scrollTop = container.scrollHeight;
    _updateChildStatus("");
  }

  async function _consumeChildStream(response, createdAt) {
    if (!response.ok) {
      var failure = await response.json().catch(function () { return {}; });
      throw new Error(failure.error || "请求失败");
    }
    if (!response.body) throw new Error("浏览器不支持流式回复");

    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = "";
    var text = "";
    var row = null;
    var bubble = null;

    function renderText() {
      if (!row) {
        row = _appendChildMsg("agent", "", null, createdAt);
        bubble = row && row.querySelector(".child-msg-content");
        if (bubble) bubble.classList.add("stream-active");
      }
      if (bubble) {
        bubble.innerHTML = typeof marked !== "undefined" ? marked.parse(text) : escHtml(text);
        var list = document.getElementById("child-msgs");
        list.scrollTop = list.scrollHeight;
      }
    }

    function finishText() {
      if (bubble) bubble.classList.remove("stream-active");
    }

    while (true) {
      var next = await reader.read();
      buffer += decoder.decode(next.value || new Uint8Array(), { stream: !next.done });
      var chunks = buffer.split("\n\n");
      buffer = chunks.pop();
      for (var i = 0; i < chunks.length; i++) {
        var payload = chunks[i].split("\n").filter(function (line) {
          return line.indexOf("data:") === 0;
        }).map(function (line) { return line.slice(5).trim(); }).join("\n");
        if (!payload) continue;
        var event;
        try { event = JSON.parse(payload); } catch (e) { continue; }
        if (event.event === "text") {
          text += event.content || "";
          renderText();
        } else if (event.event === "tool") {
          finishText();
          _updateChildStatus("AI 正在处理…");
        } else if (event.event === "tool_done") {
          _updateChildStatus("AI 正在回复…");
        } else if (event.event === "error") {
          throw new Error(event.message || "AI 处理失败");
        } else if (event.event === "done") {
          finishText();
          if (event.state) {
            window._childState = event.state;
            saveChildSession();
            if (event.type === "extract" && event.preview) _showChildPreview(event.preview);
            else _renderChildHistory({ state: event.state });
          }
          return event;
        }
      }
      if (next.done) break;
    }
    throw new Error("回复连接意外结束");
  }

  // ---- 公开 API ----

  window.openChildAgent = function () {
    var modal = _mountChildModal();
    if (!modal) return;
    modal.classList.add("active");
    document.getElementById("child-legacy").style.display = "none";
    document.getElementById("child-preview").style.display = "none";
    window._childPreview = null;
    window._childLegacyData = null;
    document.getElementById("child-msgs").innerHTML = '<div style="text-align:center;opacity:0.5;padding:2rem">Loading...</div>';
    _setChildInputEnabled(false);
    _updateChildStatus("");
    var saved = loadChildSession();
    var body = { message: "" };
    if (saved) { body.state = saved; window._childState = saved; }
    fetch(_childEndpoint(), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    })
      .then(_childResponse)
      .then(function (data) {
        if (data.is_legacy) {
          document.getElementById("child-legacy").style.display = "";
          window._childLegacyData = data.exp_data || data.anal_data || null;
          _setChildInputEnabled(true);
        } else {
          window._childState = data.state; saveChildSession();
          _renderChildHistory(data); _setChildInputEnabled(true);
        }
      })
      .catch(function (error) {
        document.getElementById("child-msgs").innerHTML = '<div style="text-align:center;color:var(--red);padding:2rem">加载失败：' + escHtml(error.message || "请稍后重试") + "</div>";
        _setChildInputEnabled(true);
      });
  };

  window.confirmLegacy = async function () {
    document.getElementById("child-legacy").style.display = "none";
    document.getElementById("child-msgs").innerHTML = '<div style="text-align:center;opacity:0.5;padding:2rem">Loading...</div>';
    _setChildBusy(true); // LLM 生成期间禁用输入
    try {
      var response = await fetch(_childEndpoint(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
        message: _childKind() === "analysis" ? "加载分析报告以便审阅" : "加载实验数据以便修改",
        is_legacy: true,
          stream: true,
        }),
      });
      await _consumeChildStream(response, new Date().toISOString());
    } catch (error) {
      document.getElementById("child-msgs").innerHTML = '<div style="text-align:center;color:var(--red);padding:2rem">加载失败：' + escHtml(error.message || "请稍后重试") + "</div>";
    } finally { _setChildBusy(false); }
  };

  window.closeChildAgent = function () {
    var modal = document.getElementById("child-modal");
    if (modal) modal.classList.remove("active");
    if (window._childState && window._childState.modified_values && Object.keys(window._childState.modified_values).length > 0) {
      setTimeout(function () { location.reload(); }, 1500);
    }
  };

  window.sendChildMsg = async function () {
    if (window._childBusy) return; // LLM 生成中禁止再次发送
    var inp = document.getElementById("child-input"), msg = inp.value.trim();
    if (!msg) return;
    _setChildBusy(true); // 请求在途禁用输入
    try {
      var content = msg;
      inp.value = "";
      var createdAt = new Date().toISOString();
      _appendChildMsg("user", content, null, createdAt);
      var body = { message: content, created_at: createdAt, stream: true };
      if (window._childState) body.state = window._childState;
      var response = await fetch(_childEndpoint(), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      await _consumeChildStream(response, createdAt);
    } catch (error) {
      _appendChildMsg("agent", "抱歉，本轮处理失败：" + (error.message || "请稍后重试"));
    } finally { _setChildBusy(false); }
  };

  window.confirmChildChange = function () {
    if (_childKind() === "analysis") return;
    var body = { preview: window._childPreview || {} };
    if (window._childState) body.state = window._childState;
    var expId = _childResourceId();
    fetch("/api/exp/" + expId + "/confirm", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Exdiary-Client-Id": window.AgentClient && AgentClient.getClientId ? AgentClient.getClientId() : "",
      },
      body: JSON.stringify(body),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.ok) { clearChildSession(); document.getElementById("child-preview").style.display = "none"; closeChildAgent(); }
      });
  };

  document.addEventListener("wheel", function (e) {
    var modal = document.getElementById("child-modal");
    if (!modal || !modal.classList.contains("active") || e.target !== modal) return;
    var scroller = document.getElementById("fragment-mount") || document.scrollingElement;
    if (!scroller) return;
    scroller.scrollTop += e.deltaY;
    if (e.deltaX) scroller.scrollLeft += e.deltaX;
    e.preventDefault();
  }, { passive: false });

})();
