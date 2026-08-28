/**
 * chat.js — 聊天面板：消息渲染、流式文本、工具卡片、输入管理
 * 与原版 new.html Agent Chat 功能完全对齐
 */
var ChatUI = (function () {
  "use strict";

  var _container = null;
  var _inputEl = null;
  var _sendBtn = null;
  var _modeBadge = null;
  var _statusEl = null;
  var _quickEl = null;
  var _panelEl = null;
  var _attachmentInput = null;
  var _attachmentBtn = null;
  var _attachmentDrafts = null;
  var _pendingAttachments = [];
  var _attachmentUploadInProgress = false;
  var _streamDiv = null;
  var _renderedContent = {};
  var _isPageLoad = false;
  var _historyRendering = false;
  var _loadOlder = null;
  var _loadOlderBound = false;

  function resetDedup() {
    _renderedContent = {};
  }

  // ---- Init ----

  function init(opts) {
    _container  = document.getElementById("chat-messages");
    _inputEl    = document.getElementById("chat-input");
    _sendBtn    = document.getElementById("btn-send");
    _modeBadge  = document.getElementById("mode-badge");
    _statusEl   = document.getElementById("status-bar");
    _quickEl    = document.getElementById("quick-replies");
    _panelEl    = document.getElementById("chat-panel");
    _attachmentInput = document.getElementById("chat-attachment-file");
    _attachmentBtn = document.getElementById("btn-chat-attachment");
    _attachmentDrafts = document.getElementById("chat-attachment-drafts");

    var historySearchBtn = document.getElementById("chat-history-search");
    if (historySearchBtn) historySearchBtn.addEventListener("click", openHistorySearch);

    if (_sendBtn) {
      _sendBtn.addEventListener("click", function () { sendUserMessage(); });
    }
    if (_inputEl) {
      _inputEl.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
          // 回复期间保留正常换行，不能通过 Enter 绕过禁用的发送按钮。
          if (AgentClient.isSending()) return;
          e.preventDefault();
          sendUserMessage();
        }
      });
      _inputEl.addEventListener("input", function () {
        this.style.height = "auto";
        this.style.height = Math.min(this.scrollHeight, 160) + "px";
      });
    }
    if (_attachmentBtn && _attachmentInput) {
      _attachmentBtn.addEventListener("click", function () {
        if (!_attachmentUploadInProgress) _attachmentInput.click();
      });
      _attachmentInput.addEventListener("change", function () {
        _uploadChatAttachments(Array.prototype.slice.call(this.files || []));
        this.value = "";
      });
    }
    _bindAttachmentDrop();
    _setSending(false);
  }

  function _hasDroppedFiles(event) {
    var transfer = event.dataTransfer;
    return !!(transfer && Array.prototype.indexOf.call(transfer.types || [], "Files") >= 0);
  }

  function _bindAttachmentDrop() {
    if (!_panelEl) return;
    var dragDepth = 0;
    var clearDragState = function () {
      dragDepth = 0;
      _panelEl.classList.remove("chat-file-dragging");
    };

    _panelEl.addEventListener("dragenter", function (event) {
      if (!_hasDroppedFiles(event)) return;
      event.preventDefault();
      dragDepth += 1;
      _panelEl.classList.add("chat-file-dragging");
    });
    _panelEl.addEventListener("dragover", function (event) {
      if (_hasDroppedFiles(event)) event.preventDefault();
    });
    _panelEl.addEventListener("dragleave", function (event) {
      if (!_hasDroppedFiles(event)) return;
      dragDepth -= 1;
      if (dragDepth <= 0) clearDragState();
    });
    _panelEl.addEventListener("drop", function (event) {
      if (!_hasDroppedFiles(event)) return;
      event.preventDefault();
      clearDragState();
      _uploadChatAttachments(Array.prototype.slice.call(event.dataTransfer.files || []));
    });
  }

  function _renderAttachmentDrafts() {
    if (!_attachmentDrafts) return;
    _attachmentDrafts.innerHTML = "";
    _pendingAttachments.forEach(function (attachment, index) {
      var chip = document.createElement("button");
      chip.type = "button"; chip.className = "outline";
      chip.style.cssText = "font-size:0.65rem;padding:0.1rem 0.3rem";
      chip.textContent = "📎 " + (attachment.name || "附件") + " ×";
      chip.title = "移除此附件";
      chip.addEventListener("click", function () {
        _pendingAttachments.splice(index, 1);
        _renderAttachmentDrafts();
      });
      _attachmentDrafts.appendChild(chip);
    });
  }

  async function _uploadChatAttachments(files) {
    if (!files.length || _attachmentUploadInProgress) return;
    if (files.length + _pendingAttachments.length > 10) {
      updateStatus("一次最多添加 10 个附件"); return;
    }
    _attachmentUploadInProgress = true;
    _syncComposerAvailability();
    try {
      for (var i = 0; i < files.length; i++) {
        updateStatus("正在上传附件 " + (i + 1) + "/" + files.length + "…");
        var body = new FormData(); body.append("file", files[i]);
        var response = await fetch("/api/agent/attachments", {method: "POST", body: body});
        var data = await response.json().catch(function () { return {}; });
        if (!response.ok || !data.ok) throw new Error(data.error || "附件上传失败");
        _pendingAttachments.push(data.attachment);
      }
      _renderAttachmentDrafts(); updateStatus("");
    } catch (error) {
      updateStatus(error.message || "附件上传失败");
    } finally {
      _attachmentUploadInProgress = false;
      _syncComposerAvailability();
    }
  }

  function setLoadOlder(callback) {
    _loadOlder = callback;
    if (!_container || _loadOlderBound) return;
    _loadOlderBound = true;
    _container.addEventListener("scroll", function () {
      // 列表重绘会暂时把滚动条置顶；只有用户真实上翻时才请求上一页。
      if (!_historyRendering && _container.scrollTop <= 48 && _loadOlder) _loadOlder();
    });
  }

  function setHistoryRendering(value) {
    _historyRendering = !!value;
  }

  // ---- Chat history search ----

  function _historySearchText(message) {
    if (message.role !== "tool") return String(message.content || "");
    try {
      var result = typeof message.content === "string" ? JSON.parse(message.content) : message.content;
      if (result && typeof result.display === "string") return result.display;
      if (result && result.message) return String(result.message);
    } catch (e) {}
    return "";
  }

  function _renderHistorySearchContent(element, text, role) {
    text = text || "（无可读正文）";
    // 与常规聊天保持一致：仅助手回复作为 Markdown 渲染；用户输入保持纯文本，
    // 避免历史中的任意 HTML 被当作页面内容执行。
    if (role === "assistant") {
      element.classList.add("history-markdown");
      element.innerHTML = md2html(text);
    } else {
      element.textContent = text;
    }
  }

  function _closeHistorySearch() {
    var overlay = document.getElementById("history-search-overlay");
    if (overlay) overlay.remove();
  }

  function openHistorySearch() {
    _closeHistorySearch();
    var overlay = document.createElement("div");
    overlay.id = "history-search-overlay";
    overlay.className = "history-search-overlay";
    var panel = document.createElement("section");
    panel.className = "history-search-panel";
    overlay.appendChild(panel);

    var header = document.createElement("div");
    header.className = "history-search-header";
    var title = document.createElement("strong");
    title.textContent = "查找聊天记录";
    var close = document.createElement("button");
    close.type = "button"; close.textContent = "×"; close.title = "关闭";
    close.addEventListener("click", _closeHistorySearch);
    header.append(title, close);
    panel.appendChild(header);

    var form = document.createElement("form");
    form.className = "history-search-form";
    var input = document.createElement("input");
    input.type = "search"; input.placeholder = "输入关键词，查找当前和已压缩的对话";
    input.maxLength = 200;
    var submit = document.createElement("button");
    submit.type = "submit"; submit.textContent = "查找";
    form.append(input, submit);
    panel.appendChild(form);

    var status = document.createElement("p");
    status.className = "history-search-status";
    status.textContent = "只加载命中的简短摘要；点击结果可查看附近对话。";
    panel.appendChild(status);
    var results = document.createElement("div");
    results.className = "history-search-results";
    panel.appendChild(results);

    function renderContext(context, targetSequence) {
      results.innerHTML = "";
      status.textContent = "附近对话" + (context.has_older || context.has_newer ? "（可继续通过搜索定位更多内容）" : "");
      (context.messages || []).forEach(function (message) {
        var item = document.createElement("article");
        item.className = "history-context-message" + (message.sequence === targetSequence ? " current" : "");
        var meta = document.createElement("small");
        meta.textContent = (message.role === "user" ? "你" : message.role === "assistant" ? "AI" : "工具") + " · " + _formatMessageTime(message.created_at);
        var content = document.createElement("div");
        _renderHistorySearchContent(content, _historySearchText(message), message.role);
        item.append(meta, content);
        results.appendChild(item);
      });
    }

    function renderMatches(matches) {
      results.innerHTML = "";
      if (!matches.length) { status.textContent = "没有找到匹配的聊天记录。"; return; }
      status.textContent = "找到 " + matches.length + " 条记录";
      matches.forEach(function (match) {
        var item = document.createElement("article");
        item.className = "history-search-result"; item.tabIndex = 0; item.setAttribute("role", "button");
        var meta = document.createElement("small");
        meta.textContent = (match.role === "user" ? "你" : match.role === "assistant" ? "AI" : "工具") + " · " + _formatMessageTime(match.created_at);
        var snippet = document.createElement("div");
        _renderHistorySearchContent(snippet, match.snippet, match.role);
        item.append(meta, snippet);
        var loadContext = async function () {
          status.textContent = "正在加载附近对话…";
          try {
            var context = await AgentClient.readHistoryContext(match.session_id, match.sequence, 3, 3);
            renderContext(context, match.sequence);
          } catch (e) { status.textContent = e.message || "聊天记录读取失败"; }
        };
        item.addEventListener("click", loadContext);
        item.addEventListener("keydown", function (event) {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); loadContext(); }
        });
        results.appendChild(item);
      });
    }

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      var query = input.value.trim();
      if (!query) { status.textContent = "请输入要查找的关键词。"; return; }
      submit.disabled = true; status.textContent = "正在查找…"; results.innerHTML = "";
      try {
        renderMatches(await AgentClient.searchHistory(query));
      } catch (e) { status.textContent = e.message || "聊天记录搜索失败"; }
      finally { submit.disabled = false; }
    });
    overlay.addEventListener("click", function (event) { if (event.target === overlay) _closeHistorySearch(); });
    document.body.appendChild(overlay);
    input.focus();
  }

  function sendUserMessage() {
    try {
      var msg = (_inputEl.value || "").trim();
      if (!msg && !_pendingAttachments.length) return;
      if (AgentClient.isSending()) {
        // 保留草稿与附件，等待用户在本轮结束后自行确认发送。
        updateStatus("AI 正在回复；内容已保留，回复结束后再发送。");
        return;
      }
      _inputEl.value = "";
      _inputEl.style.height = "auto";
      var attachments = _pendingAttachments;
      _pendingAttachments = [];
      _renderAttachmentDrafts();
      _setSending(true);
      if (window.ExdiarySound) window.ExdiarySound.play("message");
      AgentClient.sendMessage(msg || "我上传了附件，请查看并处理。", attachments);
    } catch (e) {
      _setSending(false);
    }
  }

  // Agent 空闲后只恢复发送能力；不会自动发送用户等待期间写下的草稿。
  function onIdle() {
    _setSending(false);
  }

  function _setSending(v) {
    // 输入框与附件入口始终可用；仅发送能力受 Agent 状态约束。
    _syncComposerAvailability(v);
    if (v) { if (typeof startColorDivider === 'function') startColorDivider(); }
    else   { if (typeof stopColorDivider  === 'function') stopColorDivider(); }
    // 品牌字母动画：agent 运行时激活
    var brand = document.getElementById('chat-brand');
    if (brand) { if (v) brand.classList.add('agent-active'); else brand.classList.remove('agent-active'); }
  }

  function _syncComposerAvailability(isSending) {
    if (_sendBtn) _sendBtn.disabled = !!isSending || _attachmentUploadInProgress;
    if (_attachmentBtn) _attachmentBtn.disabled = _attachmentUploadInProgress;
  }

  // ---- Thread color ----

  function updateThreadColor(state) {
    if (!_panelEl) return;
    var tt = state && state._thread_type;
    _panelEl.dataset.threadTheme = tt || "";
    // 主题由 data 属性和 CSS 控制，横竖屏切换清理内联布局样式时不会丢失。
    _panelEl.style.removeProperty("background");
  }

  // ---- Status bar ----

  function updateStatus(text, turn) {
    if (!_statusEl) return;
    if (!text && (!turn || turn <= 0)) { _statusEl.style.display = "none"; return; }
    _statusEl.style.display = "block";
    var parts = [];
    if (text) parts.push(text);
    if (turn > 0) parts.push("Round " + turn);
    _statusEl.textContent = parts.join(" — ");
  }

  // ---- Quick replies ----

  function updateQuickReplies(replies) {
    if (!_quickEl) return;
    if (!replies || !replies.length) { _quickEl.style.display = "none"; return; }
    _quickEl.style.display = "flex";
    _quickEl.innerHTML = replies.map(function (r) {
      var label  = typeof r === "string" ? r : r.label;
      var action = typeof r === "string" ? r : r.action;
      return '<button onclick="ChatUI.handleQuickReply(\'' +
        escHtml(String(action)) + "')" + '">' + escHtml(label) + "</button>";
    }).join("");
  }

  function handleQuickReply(action) {
    if (!_inputEl) return;
    if (action === "skip") { _inputEl.value = "OK, generate now"; sendUserMessage(); }
    else if (action === "quill") { /* no-op in Shell */ }
    else { _inputEl.value = action; sendUserMessage(); }
  }

  // ---- Agent state persistence ----

  function saveAgentState() {
    var state = AgentClient.getState();
    if (state) {
      try { sessionStorage.setItem("exdiary_agent_state", JSON.stringify(state)); } catch (e) {}
    }
  }

  // ---- State persistence (read-only from sessionStorage) ----

  function restoreAgentState() {
    try {
      var raw = sessionStorage.getItem("exdiary_agent_state");
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }

  function clearMessages() {
    if (_container) _container.innerHTML = "";
    _renderedContent = {};
  }

  function appendCompressionDivider() {
    if (!_container || _container.querySelector(".chat-compression-divider")) return;
    var divider = document.createElement("div");
    divider.className = "chat-compression-divider";
    divider.setAttribute("role", "note");
    divider.textContent = "此前对话已压缩为 AI 上下文摘要；原始记录仍可继续向上查看";
    _container.appendChild(divider);
  }

  function setPageLoad(v) {
    _isPageLoad = v;
  }

  // ---- Agent callbacks ----

  function onMessage(data) {
    _appendMsg(data.role, data.content, data.created_at, data.attachments);
  }

  function onStreamStart() {
    _streamDiv = null;
  }

  function onStreamChunk(html) {
    if (!_streamDiv) {
      _streamDiv = _createMsgRow("agent", new Date().toISOString());
      _streamDiv.querySelector(".msg-content").classList.add("stream-active");
    }
    _streamDiv.querySelector(".msg-content").innerHTML = md2html(html);
    _scrollBottom();
  }

  function onStreamEnd(content) {
    if (_streamDiv) {
      _streamDiv.querySelector(".msg-content").classList.remove("stream-active");
      _streamDiv.querySelector(".msg-content").innerHTML = md2html(content);
      _streamDiv = null;
    }
  }

  function onToolCard(data) {
    var result = data.result;
    if (!result || !result.display) return;

    var html = buildToolCardHTML(result);
    if (!html) return;

    var row = _createMsgRow("tool", data.created_at);
    row.querySelector(".msg-content").innerHTML = html;
    if (!_isPageLoad && !_historyRendering) {
      var card = row.querySelector(".tool-card, .sel-card");
      if (card) card.classList.add("tool-card-enter");
    }

    // Auto-render markdown inside tool cards
    row.querySelectorAll(".markdown-content:not([data-rendered])").forEach(function (el) {
      el.innerHTML = md2html(el.textContent);
      el.dataset.rendered = "1";
    });

    _scrollBottom();

    if (result.display === "selector") {
      bindSelectorEvents(row, data.toolCallId);
    }
  }

  function onError(msg) {
    if (window.ExdiarySound) window.ExdiarySound.play("general");
    _setSending(false);
    if (_streamDiv) { _streamDiv.remove(); _streamDiv = null; }
    var row = _createMsgRow("agent");
    row.querySelector(".msg-content").innerHTML =
      '<span style="color:var(--red)">Error: ' + escHtml(msg) + "</span>";
    _scrollBottom();
  }

  // ---- Message Rendering ----

  function _appendMsg(role, content, createdAt, attachments) {
    if (!content) return;
    if (role === "agent") {
      var key = "agent:" + content;
      if (_renderedContent[key]) return;
      _renderedContent[key] = true;
    }
    var row = _createMsgRow(role, createdAt);
    if (!_isPageLoad && !_historyRendering && role === "user") row.classList.add("message-enter");
    var el = row.querySelector(".msg-content");
    if (role === "agent") {
      el.innerHTML = md2html(content);
    } else if (role === "system") {
      el.innerHTML = '<div class="schema-status">' + escHtml(content) + "</div>";
    } else {
      el.textContent = content;
    }
    if (attachments && attachments.length) {
      var files = document.createElement("div");
      files.style.cssText = "display:flex;gap:0.25rem;flex-wrap:wrap;margin-top:0.4rem";
      attachments.forEach(function (attachment) {
        var chip = document.createElement("button");
        chip.type = "button";
        chip.style.cssText = "font-size:0.7rem;font-weight:700;border:1px solid currentColor;padding:0.08rem 0.3rem;background:transparent;cursor:pointer";
        chip.textContent = "📎 " + (attachment.name || "附件");
        chip.addEventListener("click", function () {
          if (window.AttachmentViewer && attachment.sha256) {
            AttachmentViewer.open({
              sha256: attachment.sha256, name: attachment.name || "附件",
              mime: attachment.mime || "", size: attachment.size || 0,
              url: "/api/attachments/" + encodeURIComponent(attachment.sha256),
            });
          }
        });
        files.appendChild(chip);
      });
      el.appendChild(files);
    }
    _scrollBottom();
  }

  function appendSystemMsg(msg) {
    _appendMsg("system", msg);
  }

  function _formatMessageTime(createdAt) {
    var date = createdAt ? new Date(createdAt) : new Date();
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString("zh-CN", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    });
  }

  function _createMsgRow(role, createdAt) {
    var row = document.createElement("div");
    row.className = "msg-row " + role;
    var wrap = document.createElement("div");
    wrap.className = "msg-wrap";
    var content = document.createElement("div");
    content.className = "msg-content";
    wrap.appendChild(content);
    var time = document.createElement("time");
    time.className = "msg-time";
    time.dateTime = createdAt || "";
    time.textContent = _formatMessageTime(createdAt);
    wrap.appendChild(time);
    row.appendChild(wrap);
    var empty = _container.querySelector(".chat-empty");
    if (empty) empty.remove();
    _container.appendChild(row);
    return row;
  }

  function _scrollBottom() {
    if (_historyRendering) return;
    if (_container) _container.scrollTop = _container.scrollHeight;
  }

  function scrollToLatest() {
    if (!_container) return;
    var container = _container;
    var setBottom = function () { container.scrollTop = container.scrollHeight; };
    setBottom();
    // Markdown 和工具卡片的最终高度会在插入后的数帧内确定；同时补两次，
    // 避免首屏停在倒数几条消息。CSS 已禁用平滑滚动，校正不会产生回弹动画。
    if (window.requestAnimationFrame) {
      window.requestAnimationFrame(function () {
        setBottom();
        window.requestAnimationFrame(function () {
          setBottom();
          setTimeout(setBottom, 100);
        });
      });
    } else {
      setTimeout(setBottom, 100);
    }
  }

  // ---- Tool Card Builder ----

  function buildToolCardHTML(r) {
    var html = "", header = "", body = "", footer = "", variant = "";

    switch (r.display) {
      case "diff":
        variant = "diff";
        header = "Modified Experiment";
        (r.changes || []).forEach(function (c) {
          body += '<div class="diff-row"><span class="df">' + escHtml(
            (c.exp_id ? c.exp_id + " · " : "") + (c.field || "")
          ) +
            '</span> <span class="do">' + escHtml(c.old || "") +
            "</span> → <span class='dn'>" + escHtml(c.new || "") + "</span></div>";
        });
        break;

      case "answer":
        variant = "answer";
        header = "Q: " + escHtml(r.question || "");
        body = "<p>" + escHtml(r.answer || "") + "</p>";
        footer = "Source: " + (r.source === "file" ? "Confirmed from file" : "Conversation memory");
        if (r.exp_ids) {
          r.exp_ids.forEach(function (id) {
            footer += ' <a href="#" onclick="event.preventDefault();PanelManager.show(\'exp-detail\',{expId:\'' + escHtml(id) + "'},this)\">" + escHtml(id) + "</a>";
          });
        }
        break;

      case "report":
        variant = "report";
        body = '<div class="markdown-content">' + md2html(r.markdown || "") + "</div>";
        break;

      case "analysis_done":
        variant = "analysis_done";
        header = "分析已归档";
        body = '<div><span style="opacity:.62">分析编号</span> <strong>' + escHtml(r.anal_id || "") + "</strong></div>";
        body += '<div style="margin-top:4px"><span style="opacity:.62">分析主题</span> ' + escHtml(r.topic || r.title || "") + "</div>";
        if (r.summary) body += '<div class="markdown-content" style="margin-top:4px;font-size:0.8rem">' + md2html(r.summary) + "</div>";
        if (r.anal_id) footer = '<a href="#" class="tool-card-btn" onclick="event.preventDefault();PanelManager.show(\'analysis\',{analId:\'' + escHtml(r.anal_id) + "'},this)\">查看报告 →</a>";
        break;

      case "record_generated":
        variant = "record";
        header = "Experiment Generated";
        body = "<strong>" + escHtml(r.exp_id || "") + "</strong> — " + escHtml(r.title || "");
        if (r.summary) body += '<div style="margin-top:4px;font-size:0.8rem">' + escHtml(r.summary) + "</div>";
        if (r.exp_id) footer = '<a href="#" class="tool-card-btn" onclick="event.preventDefault();PanelManager.show(\'exp-detail\',{expId:\'' + escHtml(r.exp_id) + "'},this)\">View Experiment →</a>";
        break;

      case "music_control":
        var action = r.action || "status";
        var track = r.track || {};
        var trackTitle = track.title || "";
        variant = "music music-" + action;
        header = "音乐控制";
        if (action === "add") {
          body = "已加入曲库：<strong>" + escHtml(trackTitle || "该音频") + "</strong>";
          footer = "曲库已更新";
        } else if (action === "stop") {
          body = trackTitle ? "已停止播放：<strong>" + escHtml(trackTitle) + "</strong>" : "背景音乐已停止";
          footer = "音乐已关闭";
        } else if (action === "next") {
          body = "已切换为：<strong>" + escHtml(trackTitle || "下一首") + "</strong>";
          footer = "正在播放";
        } else if (action === "play") {
          body = "已开始播放：<strong>" + escHtml(trackTitle || "当前曲目") + "</strong>";
          footer = "正在播放";
        } else {
          body = r.current && r.current.enabled && trackTitle ? "当前播放：<strong>" + escHtml(trackTitle) + "</strong>" : "当前没有播放背景音乐";
          footer = "曲库 " + ((r.tracks || []).length || 0) + " 首";
        }
        break;

      case "list":
        variant = "list";
        header = "Found " + (r.count || 0) + " experiments";
        (r.experiments || []).forEach(function (exp) {
          body += '<article class="list-item"' +
            ' onclick="PanelManager.show(\'exp-detail\',{expId:\'' + escHtml(exp.id) + "'},this)\">" +
            "<strong>" + escHtml(exp.id) + "</strong> " + escHtml(exp.title || "") +
            ' <small>' + escHtml(exp.date || "") + "</small>" +
            '<span class="open-hint"> 打开 →</span></article>';
        });
        break;

      case "selector":
        return buildSelectorHTML(r);

      case "toast":
        if (!_isPageLoad) showToast(r.message);
        return "";

      default:
        appendSystemMsg("[Tool: unknown]");
        return "";
    }

    if (!body) return "";
    html = '<div class="tool-card ' + variant + '">';
    if (header) html += '<div class="tool-card-header">' + header + "</div>";
    html += '<div class="tool-card-body">' + body + "</div>";
    if (footer) html += '<div class="tool-card-footer">' + footer + "</div>";
    html += "</div>";
    return html;
  }

  // ---- Selector ----

  function buildSelectorHTML(r) {
    var items = r.items || [];
    var presel = r.preselected || [];
    var isExpired = (_isPageLoad && !r.status);
    var isConfirmed = (r.status === "confirmed");
    var isCancelled = (r.status === "cancelled");
    var tcIdAttr = r._tcId ? ' data-tool-call-id="' + escHtml(r._tcId) + '"' : "";

    if (isExpired) {
      // Auto-cancel expired selector on page load
      setTimeout(function () {
        var history = AgentClient.getHistory ? AgentClient.getHistory() : [];
        if (history.length) {
          for (var i2 = history.length - 1; i2 >= 0; i2--) {
            var m2 = history[i2];
            if (m2.role === "tool" && _shouldRenderToolResult(m2.content)) {
              var orig2 = _parseToolResult(m2.content);
              if (orig2.display === "selector") {
                orig2.status = "cancelled";
                m2.content = JSON.stringify(orig2);
                break;
              }
            }
          }
        }
        saveAgentState();
        _setSending(false);
      }, 0);
      return '<div class="sel-card"><div class="sel-topbar" style="color:var(--red)">Previous selection expired</div>' +
        '<div class="sel-topbar">Auto-cancelled</div></div>';
    }

    if (isConfirmed) {
      return '<div class="sel-card" data-tool="selector" data-status="confirmed"' + tcIdAttr + '>' +
        '<div class="sel-topbar">Selected ' + (r.selected_ids || []).length +
        " experiments: " + (r.selected_ids || []).join(", ") + "</div></div>";
    }

    if (isCancelled) {
      return '<div class="sel-card" data-tool="selector" data-status="cancelled"' + tcIdAttr + '>' +
        '<div class="sel-topbar">Selection cancelled</div></div>';
    }

    // Active selector
    var html = '<div class="sel-card" data-tool="selector" data-status="active"' + tcIdAttr + '>';
    var allPreselected = items.length > 0 && presel.length === items.length;
    html += '<div class="sel-topbar"><span>' + escHtml(r.title || "Select experiments") +
      '</span><button class="sel-btn sel-toggle-all" onclick="ChatUI.selToggleAll(this)">' +
      (allPreselected ? "Deselect All" : "Select All") + '</button></div>';
    html += '<div class="sel-body">';

    items.slice(0, 8).forEach(function (item) {
      var checked = presel.indexOf(item.id) >= 0 ? " checked" : "";
      html += '<div class="sel-item" data-exp-id="' + escHtml(item.id) + '" onclick="ChatUI.selItemClick(this)">';
      html += '<span class="sel-check' + checked + '">✓</span>';
      html += '<div class="sel-info">';
      html += '<div class="sel-id">' + escHtml(item.id) + "</div>";
      html += '<div style="font-weight:600;font-size:0.8rem">' + escHtml(item.title || "(untitled)") + "</div>";
      html += '<div style="font-size:0.7rem;opacity:0.5">' + escHtml(item.date || "") +
        " " + escHtml(item.experimenter || "") + "</div>";
      html += "</div></div>";
    });

    if (items.length > 8) {
      html += '<button onclick="ChatUI.selShowMore(this)" data-all=\'' +
        JSON.stringify(items) + "' style='width:100%;padding:0.4rem;font-weight:700;cursor:pointer;" +
        "border:none;border-top:2px solid var(--black);background:var(--off-white)'>Show More (" +
        items.length + " total)</button>";
    }

    html += "</div>";
    html += '<div class="sel-bottombar">' +
      '<span style="font-size:0.78rem;font-weight:600">Selected <b class="sel-count-num">' +
      presel.length + "</b></span>";
    html += '<span><button class="sel-btn" onclick="ChatUI.selCancel(this)">Cancel</button> ';
    html += '<button class="sel-btn primary" onclick="ChatUI.selConfirm(this)">Confirm (' +
      presel.length + ")</button></span></div>";
    html += "</div>";

    _setSending(true);
    return html;
  }

  function bindSelectorEvents(cardEl, toolCallId) {
    var card = cardEl.querySelector(".sel-card");
    if (card) card.dataset.toolCallId = toolCallId || "";
  }

  function selToggleAll(btn) {
    var card = btn.closest(".sel-card");
    var checks = card.querySelectorAll(".sel-check");
    var allChecked = Array.from(checks).every(function (ch) { return ch.classList.contains("checked"); });
    checks.forEach(function (ch) { ch.classList.toggle("checked", !allChecked); });
    btn.textContent = allChecked ? "Select All" : "Deselect All";
    selUpdateCount(card);
  }

  function selItemClick(el) {
    var card = el.closest(".sel-card");
    if (!card || card.dataset.status !== "active") return;
    el.querySelector(".sel-check").classList.toggle("checked");
    selUpdateCount(card);
  }

  function selUpdateCount(card) {
    var count = card.querySelectorAll(".sel-check.checked").length;
    var el = card.querySelector(".sel-count-num");
    if (el) el.textContent = count;
    var btn = card.querySelector(".sel-btn.primary");
    if (btn) btn.textContent = "Confirm (" + count + ")";
  }

  async function selConfirm(btn) {
    var card = btn.closest(".sel-card");
    var ids = [];
    card.querySelectorAll(".sel-check.checked").forEach(function (ch) {
      ids.push(ch.closest(".sel-item").dataset.expId);
    });
    if (!ids.length) return;

    var tcId = card.dataset.toolCallId;
    btn.disabled = true;
    try {
      await AgentClient.resolveSelector(tcId, ids, "confirmed");
      _inputEl.value = "Selected: " + ids.join(", ") + ". Continue analysis.";
      sendUserMessage();
    } catch (e) {
      btn.disabled = false;
      showToast(e.message || "提交选择失败");
    }
  }

  async function selCancel(btn) {
    var card = btn.closest(".sel-card");
    var tcId = card.dataset.toolCallId;
    btn.disabled = true;
    try {
      await AgentClient.resolveSelector(tcId, [], "cancelled");
      _inputEl.value = "Selection cancelled. Continue.";
      sendUserMessage();
    } catch (e) {
      btn.disabled = false;
      showToast(e.message || "取消选择失败");
    }
  }

  function selShowMore(btn) {
    var allItems = JSON.parse(btn.dataset.all || "[]");
    var card = btn.closest(".sel-card");
    var checked = {};
    card.querySelectorAll(".sel-check.checked").forEach(function (ch) {
      checked[ch.closest(".sel-item").dataset.expId] = true;
    });

    var overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:2000;display:flex;align-items:center;justify-content:center";
    var modal = document.createElement("div");
    modal.style.cssText = "background:var(--white);border:4px solid var(--black);width:90vw;max-width:520px;max-height:75vh;display:flex;flex-direction:column;box-shadow:var(--shadow-lg)";

    var searchHtml = '<div style="padding:10px 14px;border-bottom:2px solid var(--black)">' +
      '<input type="text" placeholder="Search (ID / title / tags / materials)" ' +
      'style="width:100%;padding:8px 12px;border:2px solid var(--black);font-size:0.85rem;outline:none;font-family:inherit"' +
      ' oninput="var q=this.value.toLowerCase();this.closest(\'div\').nextElementSibling.querySelectorAll(\'.sel-item\').forEach(function(el){el.style.display=q?((el.textContent||\'\').toLowerCase().indexOf(q)>=0?\'\':\'none\'):\'\'})"></div>';

    var listHtml = '<div style="flex:1;overflow-y:auto;max-height:50vh">';
    allItems.forEach(function (item) {
      var c = checked[item.id] ? " checked" : "";
      listHtml += '<div class="sel-item" data-exp-id="' + escHtml(item.id) +
        '" onclick="this.querySelector(\'.sel-check\').classList.toggle(\'checked\')">';
      listHtml += '<span class="sel-check' + c + '">✓</span>';
      listHtml += '<span class="sel-id">' + escHtml(item.id) + '</span>';
      listHtml += '<span class="sel-title">' + escHtml(item.title || "") + '</span>';
      listHtml += '<span style="font-size:0.7rem;opacity:0.5">' + (item.date || "") + '</span>';
      listHtml += "</div>";
    });
    listHtml += "</div>";

    var bottomHtml = '<div style="display:flex;justify-content:flex-end;gap:8px;padding:10px 14px;border-top:2px solid var(--black)">';
    bottomHtml += '<button class="sel-btn" onclick="this.closest(\'#sel-modal-overlay\').remove()">Cancel</button>';
    bottomHtml += '<button class="sel-btn primary" id="sel-modal-confirm">Confirm</button></div>';

    modal.innerHTML = searchHtml + listHtml + bottomHtml;
    overlay.id = "sel-modal-overlay";
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    overlay.addEventListener("click", function (e) { if (e.target === overlay) overlay.remove(); });
    modal.querySelector("#sel-modal-confirm").addEventListener("click", function () {
      modal.querySelectorAll(".sel-item").forEach(function (item) {
        var expId = item.dataset.expId;
        var mainItem = card.querySelector('.sel-item[data-exp-id="' + expId + '"]');
        if (mainItem) {
          var mainCheck = mainItem.querySelector(".sel-check");
          var modalCheck = item.querySelector(".sel-check");
          mainCheck.classList.toggle("checked", modalCheck.classList.contains("checked"));
        }
      });
      selUpdateCount(card);
      overlay.remove();
    });
  }

  // ---- Mode Badge ----

  function updateModeBadge(mode) {
    if (!_modeBadge) return;
    _modeBadge.className = "";
    if (mode === "record") { _modeBadge.className = "record"; _modeBadge.textContent = "Recording"; }
    else if (mode === "analyze") { _modeBadge.className = "analyze"; _modeBadge.textContent = "Analyzing"; }
    else { _modeBadge.className = ""; _modeBadge.textContent = ""; }
  }

  // ---- Toast ----

  function showToast(msg) {
    var t = document.createElement("div");
    t.className = "toast"; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () {
      t.style.opacity = "0"; t.style.transition = "opacity 0.3s";
      setTimeout(function () { t.remove(); }, 300);
    }, 2000);
  }

  // ---- Utils ----

  function md2html(text) {
    if (typeof marked !== "undefined") return marked.parse(text);
    return escHtml(text).replace(/\n/g, "<br>");
  }

  function escHtml(s) {
    var d = document.createElement("div");
    d.textContent = s || "";
    return d.innerHTML;
  }

  return {
    init: init,
    onMessage: onMessage,
    onStreamStart: onStreamStart,
    onStreamChunk: onStreamChunk,
    onStreamEnd: onStreamEnd,
    onToolCard: onToolCard,
    onError: onError,
    updateModeBadge: updateModeBadge,
    updateThreadColor: updateThreadColor,
    updateStatus: updateStatus,
    updateQuickReplies: updateQuickReplies,
    handleQuickReply: handleQuickReply,
    saveAgentState: saveAgentState,
    restoreAgentState: restoreAgentState,
    clearMessages: clearMessages,
    appendCompressionDivider: appendCompressionDivider,
    setPageLoad: setPageLoad,
    setLoadOlder: setLoadOlder,
    setHistoryRendering: setHistoryRendering,
    scrollToLatest: scrollToLatest,
    setSending: _setSending,
    resetDedup: resetDedup,
    onIdle: onIdle,
    appendSystemMsg: appendSystemMsg,
    selToggleAll: selToggleAll,
    selItemClick: selItemClick,
    selConfirm: selConfirm,
    selCancel: selCancel,
    selShowMore: selShowMore,
    escHtml: escHtml,
    showToast: showToast,
  };
})();
