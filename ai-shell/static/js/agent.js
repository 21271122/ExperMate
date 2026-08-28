/**
 * agent.js — Agent 状态管理 + SSE 流式通信
 * 复用现有 /api/agent/start 和 /api/agent/message/stream 端点
 */
var AgentClient = (function () {
  "use strict";

  var _state = null;
  var _sending = false;
  var _onMessage = null;
  var _onStreamStart = null;
  var _onStreamChunk = null;
  var _onStreamEnd = null;
  var _onToolCard = null;
  var _onError = null;
  var _onStateChange = null;
  var _onIdle = null;
  var _clientId = "";
  var _eventStreamStarted = false;
  var _remoteRequestId = null;
  var _remoteStreamContent = "";
  var _remoteStreamStarted = false;
  var _remoteCompletedStreamContents = [];
  var _remoteUserMessage = "";
  var _remoteUserAttachments = [];
  var _history = [];
  var _historyStart = 0;
  var _historyTotal = 0;
  var _historyLoading = false;
  var _analysisTimeoutSeconds = 8 * 60;

  function getToken() {
    return localStorage.getItem("exdiary_token") || "";
  }

  function authHeaders() {
    var h = { "Content-Type": "application/json" };
    var t = getToken();
    if (t) h["Authorization"] = "Bearer " + t;
    return h;
  }

  // ---- Public API ----

  function init(opts) {
    _onMessage     = opts.onMessage || null;
    _onStreamStart = opts.onStreamStart || null;
    _onStreamChunk = opts.onStreamChunk || null;
    _onStreamEnd   = opts.onStreamEnd || null;
    _onToolCard    = opts.onToolCard || null;
    _onError       = opts.onError || null;
    _onStateChange = opts.onStateChange || null;
    _onIdle        = opts.onIdle || null;
    _clientId = _loadClientId();
  }

  function getState() { return _state; }
  function getHistory() { return _history; }
  function isSending() { return _sending; }
  function getClientId() { return _clientId; }

  function getMode() {
    if (!_state) return "free";
    var tt = _state._thread_type;
    if (tt === "record") return "record";
    if (tt === "analyze") return "analyze";
    return "free";
  }

  // ---- 工具名 → 用户可读的中文进度文案（避免状态栏暴露内部工具名） ----
  var TOOL_LABELS = {
    load_reference: "正在读取实验数据…",
    search_experiments: "正在搜索历史实验…",
    list_experiments: "正在加载实验列表…",
    read_experiment: "正在读取实验字段…",
    read_update_log: "正在读取修改历史…",
    modify_experiment: "正在修改实验…",
    manage_collection: "正在整理收藏…",
    manage_music: "正在管理背景音乐…",
    end_thread: "正在结束对话…",
    start_record_thread: "正在开始记录…",
    update_schema: "正在整理实验信息…",
    generate_record: "正在生成实验记录…",
    start_analyze_thread: "正在开始分析…",
    select_experiments: "正在准备实验选择…",
    generate_analysis: "",
    modify_analysis: "正在修改分析报告…"
  };
  function _analysisTimeoutLabel() {
    return "正在生成分析报告（最长 " + Math.round(_analysisTimeoutSeconds / 60) + " 分钟）…";
  }
  function toolLabel(name) {
    return name === "generate_analysis" ? _analysisTimeoutLabel() : (TOOL_LABELS[name] || "正在处理…");
  }

  function setAnalysisTimeoutSeconds(value) {
    var parsed = Number(value);
    if (Number.isFinite(parsed)) _analysisTimeoutSeconds = Math.max(60, Math.min(parsed, 30 * 60));
  }

  // ---- State persistence ----

  function saveAgentState() {
    if (typeof ChatUI !== "undefined" && ChatUI.saveAgentState) {
      ChatUI.saveAgentState();
    }
  }

  // ---- UI helpers (delegate to ChatUI if available) ----

  function _updateThreadColor() {
    if (typeof ChatUI !== "undefined" && ChatUI.updateThreadColor) {
      ChatUI.updateThreadColor(_state);
    }
  }

  function _updateStatus(text, turn) {
    if (typeof ChatUI !== "undefined" && ChatUI.updateStatus) {
      ChatUI.updateStatus(text, turn !== undefined ? turn : (_state ? _state.turn_count : 0));
    }
  }

  function _clearQuickReplies() {
    if (typeof ChatUI !== "undefined" && ChatUI.updateQuickReplies) {
      ChatUI.updateQuickReplies([]);
    }
  }

  function _loadClientId() {
    var key = "exdiary_agent_client_id";
    try {
      var id = sessionStorage.getItem(key);
      if (id) return id;
      id = window.crypto && window.crypto.randomUUID
        ? window.crypto.randomUUID()
        : "client-" + Date.now() + "-" + Math.random().toString(16).slice(2);
      sessionStorage.setItem(key, id);
      return id;
    } catch (e) {
      return "client-" + Date.now() + "-" + Math.random().toString(16).slice(2);
    }
  }

  function _setSendUIBusy(busy) {
    if (typeof ChatUI !== "undefined" && ChatUI.setSending) ChatUI.setSending(busy);
  }

  function _setHistoryPage(history, start, total) {
    _history = Array.isArray(history) ? history : [];
    _historyStart = Number.isFinite(start) ? start : 0;
    _historyTotal = Number.isFinite(total) ? total : _history.length;
  }

  function _replaceState(state, history, historyStart, historyTotal) {
    _state = state || {};
    if (history === undefined && Array.isArray(_state.history)) history = _state.history;
    if (historyStart === undefined) historyStart = _historyStart;
    if (historyTotal === undefined) historyTotal = _historyTotal;
    delete _state.history;
    _setHistoryPage(history, historyStart, historyTotal);
    var selectorModal = document.getElementById("sel-modal-overlay");
    if (selectorModal) selectorModal.remove();
    // 清空并重建消息列表会让 scrollTop 短暂归零。此时不能把它误认为
    // 用户上翻到底，触发“加载更早消息”，否则会与本次状态替换抢滚动位置。
    if (typeof ChatUI !== "undefined" && ChatUI.setHistoryRendering) {
      ChatUI.setHistoryRendering(true);
    }
    _uiClearAndPrepare();
    renderHistoryMsgs(_history);
    if (typeof ChatUI !== "undefined" && ChatUI.setHistoryRendering) {
      ChatUI.setHistoryRendering(false);
    }
    _uiFinishPrepare(true);
    _updateThreadColor();
    if (_onStateChange) _onStateChange(_state);
    saveAgentState();
  }

  function _appendHistory(messages, skipUserContent, skipAssistantContents) {
    if (!Array.isArray(messages) || !messages.length) return false;
    skipAssistantContents = skipAssistantContents || [];
    var renderedAssistant = false;
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      _history.push(m);
      if (m.role === "user" && m.content === skipUserContent) continue;
      if (m.role === "assistant" && m.content && skipAssistantContents.indexOf(m.content) !== -1) continue;
      if (m.role === "assistant" && m.content) renderedAssistant = true;
      renderHistoryMsg(m);
    }
    _historyTotal = Math.max(_historyTotal, _historyStart + _history.length);
    return renderedAssistant;
  }

  async function loadOlderHistory() {
    if (_historyLoading || _historyStart <= 0) return;
    _historyLoading = true;
    try {
      var r = await fetch("/api/agent/history?before=" + encodeURIComponent(_historyStart) + "&limit=50", {
        headers: authHeaders(),
      });
      var data = await r.json();
      if (!r.ok || !data.ok || !data.history || !data.history.length) return;
      var container = document.getElementById("chat-messages");
      var oldHeight = container ? container.scrollHeight : 0;
      var oldTop = container ? container.scrollTop : 0;
      _history = data.history.concat(_history);
      _historyStart = data.history_start;
      _historyTotal = data.history_total;
      if (typeof ChatUI !== "undefined" && ChatUI.setHistoryRendering) ChatUI.setHistoryRendering(true);
      _uiClearAndPrepare();
      renderHistoryMsgs(_history);
      _uiFinishPrepare();
      if (typeof ChatUI !== "undefined" && ChatUI.setHistoryRendering) ChatUI.setHistoryRendering(false);
      if (container) container.scrollTop = container.scrollHeight - oldHeight + oldTop;
    } catch (e) {
      // 保留已加载消息；下次滚动到顶部仍可重试。
    } finally {
      _historyLoading = false;
    }
  }

  async function searchHistory(query, options) {
    var params = new URLSearchParams();
    params.set("q", query || "");
    params.set("limit", String((options && options.limit) || 20));
    if (options && options.dateFrom) params.set("date_from", options.dateFrom);
    if (options && options.dateTo) params.set("date_to", options.dateTo);
    var response = await fetch("/api/agent/history/search?" + params.toString(), {
      headers: authHeaders(),
    });
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok || !data.ok) throw new Error(data.error || "聊天记录搜索失败");
    return data.matches || [];
  }

  async function readHistoryContext(sessionId, sequence, before, after) {
    var params = new URLSearchParams({
      session_id: sessionId,
      sequence: String(sequence),
      before: String(before === undefined ? 3 : before),
      after: String(after === undefined ? 3 : after),
    });
    var response = await fetch("/api/agent/history/context?" + params.toString(), {
      headers: authHeaders(),
    });
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok || !data.ok) throw new Error(data.error || "聊天记录读取失败");
    return data;
  }

  function _beginRemoteRun(evt) {
    if (!evt.request_id || _remoteRequestId === evt.request_id) return;
    _remoteRequestId = evt.request_id;
    _remoteStreamContent = "";
    _remoteStreamStarted = false;
    _remoteCompletedStreamContents = [];
    _remoteUserMessage = evt.message || "";
    _remoteUserAttachments = Array.isArray(evt.attachments) ? evt.attachments : [];
    _sending = true;
    _setSendUIBusy(true);
    if (evt.message && _onMessage) _onMessage({
      role: "user", content: evt.message, created_at: evt.created_at,
      attachments: _remoteUserAttachments
    });
    _updateStatus("正在思考…");
  }

  function _handleRemoteEvent(evt) {
    if (!evt || evt.origin_id === _clientId) return;
    if (evt.event === "resource_changed") {
      if (window.PanelManager && PanelManager.handleResourceChange) {
        PanelManager.handleResourceChange(evt);
      } else if (typeof ChatUI !== "undefined" && ChatUI.showToast) {
        ChatUI.showToast("实验 " + (evt.exp_id || "") + " 已在另一窗口更新");
      }
      return;
    }
    if (evt.event === "state" && evt.state) {
      _replaceState(evt.state, evt.history, evt.history_start, evt.history_total);
      return;
    }
    if (evt.event === "sync") {
      if (!evt.busy) return;
      _beginRemoteRun(evt);
      if (evt.text) {
        _remoteStreamStarted = true;
        _remoteStreamContent = evt.text;
        if (_onStreamStart) _onStreamStart();
        if (_onStreamChunk) _onStreamChunk(_remoteStreamContent);
      }
      return;
    }
    if (evt.event === "start") {
      _beginRemoteRun(evt);
      return;
    }
    if (!evt.request_id || evt.request_id !== _remoteRequestId) return;

    if (evt.event === "text") {
      if (!_remoteStreamStarted) {
        _remoteStreamStarted = true;
        if (_onStreamStart) _onStreamStart();
      }
      _remoteStreamContent += evt.content || "";
      if (_onStreamChunk) _onStreamChunk(_remoteStreamContent);
    } else if (evt.event === "tool") {
      _updateStatus(toolLabel(evt.name));
      if (_remoteStreamStarted && _onStreamEnd) {
        _onStreamEnd(_remoteStreamContent);
        _remoteCompletedStreamContents.push(_remoteStreamContent);
        _remoteStreamStarted = false;
        _remoteStreamContent = "";
      }
      _setSendUIBusy(true);
    } else if (evt.event === "tool_done") {
      if (evt.music_control && window.ExdiarySound && ExdiarySound.applyMusicControl) {
        ExdiarySound.applyMusicControl(evt.music_control);
      }
      _renderLiveToolCard(evt);
      _updateStatus("正在思考…");
    } else if (evt.event === "done") {
      var streamContent = _remoteStreamContent;
      if (_remoteStreamStarted && _onStreamEnd) {
        _onStreamEnd(streamContent);
        _remoteCompletedStreamContents.push(streamContent);
      }
      var hadAnyStream = _remoteCompletedStreamContents.length > 0;
      _state = evt.state;
      _updateThreadColor();
      var renderedAssistant = false;
      if (evt.history_reset) {
        _replaceState(evt.state, evt.history, evt.history_start, evt.history_total);
      } else {
        renderedAssistant = _appendHistory(evt.history_append, _remoteUserMessage,
          _remoteCompletedStreamContents);
      }
      if (_onStateChange) _onStateChange(_state);
      if (evt.type !== "saved" && evt.message && !hadAnyStream && !renderedAssistant && _onMessage) {
        _onMessage({ role: "agent", content: evt.message });
      }
      _updateStatus("");
      _clearQuickReplies();
      saveAgentState();
      _remoteRequestId = null;
      _remoteStreamContent = "";
      _remoteStreamStarted = false;
      _remoteCompletedStreamContents = [];
      _remoteUserMessage = "";
      _sending = false;
      _setSendUIBusy(false);
    } else if (evt.event === "error") {
      if (_onError) _onError(evt.message || "Stream error");
      _updateStatus("");
      _remoteRequestId = null;
      _remoteStreamContent = "";
      _remoteStreamStarted = false;
      _sending = false;
      _setSendUIBusy(false);
    }
  }

  function _openEventStream() {
    if (_eventStreamStarted) return;
    _eventStreamStarted = true;
    fetch("/api/agent/events", { headers: authHeaders() })
      .then(function (resp) {
        if (!resp.ok) throw new Error("Event stream unavailable (" + resp.status + ")");
        var reader = resp.body.getReader();
        var decoder = new TextDecoder();
        var buffer = "";
        function read() {
          return reader.read().then(function (chunk) {
            if (chunk.done) return;
            buffer += decoder.decode(chunk.value, { stream: true });
            var lines = buffer.split("\n");
            buffer = lines.pop();
            lines.forEach(function (line) {
              if (!line.startsWith("data: ")) return;
              try { _handleRemoteEvent(JSON.parse(line.slice(6))); } catch (e) {}
            });
            return read();
          });
        }
        return read();
      })
      .catch(function () {})
      .then(function () {
        _eventStreamStarted = false;
        setTimeout(_openEventStream, 1500);
      });
  }

  // ---- Start / Send ----

  function _getCachedState() {
    if (typeof ChatUI !== "undefined" && ChatUI.restoreAgentState) {
      return ChatUI.restoreAgentState();
    }
    return null;
  }

  function _uiClearAndPrepare() {
    if (typeof ChatUI !== "undefined") {
      if (ChatUI.clearMessages)  ChatUI.clearMessages();
      if (ChatUI.setPageLoad)    ChatUI.setPageLoad(true);
    }
  }

  function _uiFinishPrepare(scrollToLatest) {
    if (typeof ChatUI === "undefined") return;
    if (ChatUI.setPageLoad) ChatUI.setPageLoad(false);
    if (scrollToLatest && ChatUI.scrollToLatest) ChatUI.scrollToLatest();
  }

  async function start() {
    // 实验资源变更也要跨窗口同步；这不依赖 Agent 是否已配置或能否启动。
    _openEventStream();
    if (typeof ChatUI !== "undefined" && ChatUI.setLoadOlder) ChatUI.setLoadOlder(loadOlderHistory);
    // 服务端运行态由各窗口共享；刷新时必须优先读取它，而不是本窗口旧缓存。
    var state = null;
    var isRestored = false;
    var data = null;
    var cached = _getCachedState();

    try {
      var r = await fetch("/api/agent/start", {
        method: "POST", headers: authHeaders(), body: "{}",
      });
      data = await r.json();
      setAnalysisTimeoutSeconds(data.analysis_timeout_seconds);
      if (!data.ok) {
        if (!cached) {
          if (_onError) _onError(data.error || "Agent init failed");
          return false;
        }
        state = cached;
        isRestored = true;
      } else {
        state = data.state;
      }
    } catch (e) {
      if (cached) {
        state = cached;
        isRestored = true;
      } else {
        if (_onError) _onError(e.message);
        return false;
      }
    }

    _replaceState(state,
      data && data.history !== undefined ? data.history : (state && state.history),
      data && data.history_start !== undefined ? data.history_start : 0,
      data && data.history_total !== undefined ? data.history_total : undefined);

    // Greeting only for fresh fetch (not restore — history already has it)
    if (!isRestored && data && data.message) {
      if (_onMessage) _onMessage({ role: "agent", content: data.message });
    }

    _updateStatus("", state ? state.turn_count : 0);
    _clearQuickReplies();
    return true;
  }

  async function sendMessage(userMsg, attachments) {
    if (_sending || !userMsg.trim()) return;
    _sending = true;

    attachments = Array.isArray(attachments) ? attachments : [];
    var createdAt = new Date().toISOString();
    if (_onMessage) _onMessage({
      role: "user", content: userMsg, created_at: createdAt, attachments: attachments
    });
    _updateStatus("正在思考…");

    try {
      var resp = await fetch("/api/agent/message/stream", {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ message: userMsg, state: _state, client_id: _clientId,
          attachments: attachments, created_at: createdAt }),
      });
      if (!resp.ok) {
        var failure = await resp.json().catch(function () { return {}; });
        throw new Error(failure.error || "发送失败");
      }

      var reader = resp.body.getReader();
      var decoder = new TextDecoder();
      var buf = "";
      var streamContent = "";
      var streamStarted = false;
      var completedStreamContents = [];

      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buf += decoder.decode(chunk.value, { stream: true });
        var lines = buf.split("\n");
        buf = lines.pop();

        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          if (!line.startsWith("data: ")) continue;
          try { var evt = JSON.parse(line.slice(6)); } catch (e) { continue; }

          if (evt.event === "text") {
            if (!streamStarted) {
              streamStarted = true;
              if (_onStreamStart) _onStreamStart();
            }
            streamContent += evt.content;
            if (_onStreamChunk) _onStreamChunk(streamContent);
          } else if (evt.event === "tool") {
            _updateStatus(toolLabel(evt.name));
            if (_onStreamEnd && streamStarted) {
              _onStreamEnd(streamContent);
              completedStreamContents.push(streamContent);
              streamStarted = false;
              streamContent = "";
            }
          } else if (evt.event === "tool_done") {
            if (evt.music_control && window.ExdiarySound && ExdiarySound.applyMusicControl) {
              ExdiarySound.applyMusicControl(evt.music_control);
            }
            _renderLiveToolCard(evt);
            _updateStatus("正在思考…");
          } else if (evt.event === "compression") {
            _updateStatus("正在整理较早对话，生成会话摘要…");
          } else if (evt.event === "done") {
            if (streamStarted && _onStreamEnd) {
              _onStreamEnd(streamContent);
              completedStreamContents.push(streamContent);
              streamStarted = false;
              streamContent = "";
            }
            var hadAnyStream = completedStreamContents.length > 0;
            _state = evt.state;
            _updateThreadColor();
            var renderedAssistant = false;
            if (evt.history_reset) {
              _replaceState(evt.state, evt.history, evt.history_start, evt.history_total);
            } else {
              renderedAssistant = _appendHistory(evt.history_append, userMsg,
                completedStreamContents);
            }
            if (_onStateChange) _onStateChange(_state);

            if (evt.type === "saved" && evt.exp_id) {
              // saved: card already rendered by tool
            } else if (evt.type === "reply" && evt.message && !hadAnyStream && !renderedAssistant) {
              if (_onMessage) _onMessage({ role: "agent", content: evt.message });
            } else if (evt.type === "generate" && evt.message) {
              if (_onMessage) _onMessage({ role: "agent", content: evt.message });
            }
            _updateStatus("");
            _clearQuickReplies();
            saveAgentState();
            if (window.ExdiarySound) window.ExdiarySound.play("message");
          } else if (evt.event === "error") {
            if (_onError) _onError(evt.message || "Stream error");
            _updateStatus("");
          }
        }
      }
    } catch (e) {
      if (_onError) _onError(e.message);
      _updateStatus("");
    }
    _sending = false;
    // 一轮对话结束：通知 UI 恢复/发送排队消息
    if (_onIdle) _onIdle();
  }

  async function resolveSelector(toolCallId, selectedIds, status) {
    var response = await fetch("/api/agent/selection", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        tool_call_id: toolCallId,
        selected_ids: selectedIds,
        status: status,
        client_id: _clientId,
      }),
    });
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok || !data.ok) throw new Error(data.error || "提交选择失败");
    _replaceState(data.state, data.history, data.history_start, data.history_total);
    return true;
  }

  // ---- History Rendering ----

  var _renderedLen = 0;
  var _renderedToolIds = {};

  function _renderLiveToolCard(event) {
    var toolCallId = event && event.tool_call_id;
    var result = event && event.display_result;
    if (!toolCallId || !result || !result.display || _renderedToolIds[toolCallId]) return;
    _renderedToolIds[toolCallId] = true;
    renderToolCard(result, toolCallId, event.created_at);
  }

  function _legacyAskUserContent(m) {
    var content = m.content || "";
    var calls = m.tool_calls || [];
    for (var i = 0; i < calls.length; i++) {
      var fn = calls[i].function || {};
      if (fn.name !== "ask_user") continue;
      try {
        var args = JSON.parse(fn.arguments || "{}");
        var questions = Array.isArray(args.questions) ? args.questions.filter(Boolean) : [];
        if (questions.length) {
          var text = questions.map(function (question, index) {
            return (index + 1) + ". " + question;
          }).join("\n");
          return content ? content + "\n\n" + text : text;
        }
      } catch (e) { /* invalid legacy arguments: keep the stored text */ }
    }
    return content;
  }

  function renderHistoryMsg(m) {
    if (_isInternal(m)) return;
    if (m.role === "user" && m.content) {
      if (_onMessage) _onMessage({ role: "user", content: m.content, created_at: m.created_at, attachments: m.attachments });
    } else if (m.role === "assistant" && m.content) {
      if (_onMessage) _onMessage({ role: "agent", content: _legacyAskUserContent(m), created_at: m.created_at });
    } else if (m.role === "tool" && m.content && _shouldRender(m.content)) {
      if (_renderedToolIds[m.tool_call_id]) return;
      _renderedToolIds[m.tool_call_id] = true;
      renderToolCardFromMsg(m);
    }
  }

  function renderHistoryMsgs(history) {
    _renderedLen = 0;
    _renderedToolIds = {};
    if (typeof ChatUI !== "undefined" && ChatUI.resetDedup) {
      ChatUI.resetDedup();
    }
    for (var i = 0; i < history.length; i++) {
      renderHistoryMsg(history[i]);
      var boundary = Number(_state && _state._compressed_until_sequence);
      var currentSequence = Number(history[i] && history[i]._sequence);
      var nextSequence = i + 1 < history.length ? Number(history[i + 1]._sequence) : NaN;
      if (Number.isFinite(boundary) && Number.isFinite(currentSequence)
          && currentSequence <= boundary
          && (!Number.isFinite(nextSequence) || nextSequence > boundary)
          && typeof ChatUI !== "undefined" && ChatUI.appendCompressionDivider) {
        ChatUI.appendCompressionDivider();
      }
    }
    _renderedLen = history.length;
  }

  function renderNewToolCards(state) {
    if (!state || !state.history) return;
    for (var i = _renderedLen; i < state.history.length; i++) {
      var m = state.history[i];
      if (m.role === "tool" && m.content && _shouldRender(m.content)) {
        if (_renderedToolIds[m.tool_call_id]) continue;
        _renderedToolIds[m.tool_call_id] = true;
        renderToolCardFromMsg(m);
      }
    }
    _renderedLen = state.history.length;
  }

  function renderToolCardFromMsg(m) {
    try {
      var r = typeof m.content === "string" ? JSON.parse(m.content) : m.content;
    } catch (e) { return; }
    // 旧历史里的 analysis_done 只有 title，而 title 曾错误地取自报告首句。
    // 从同一个 tool_call 的原始参数恢复用户确认的分析主题，无须迁移历史数据。
    if (r && r.display === "analysis_done" && !r.topic) {
      r.topic = _analysisTopicForToolCall(m.tool_call_id) || r.title || "";
    }
    renderToolCard(r, m.tool_call_id, m.created_at);
  }

  function _analysisTopicForToolCall(toolCallId) {
    for (var i = 0; i < _history.length; i++) {
      var message = _history[i];
      if (message.role !== "assistant") continue;
      var calls = message.tool_calls || [];
      for (var j = 0; j < calls.length; j++) {
        if (calls[j].id !== toolCallId || !(calls[j].function || {}).arguments) continue;
        try {
          var args = JSON.parse(calls[j].function.arguments);
          if ((calls[j].function || {}).name === "generate_analysis" && args.query) {
            return String(args.query);
          }
        } catch (e) { /* 忽略损坏的旧工具参数，回退到已保存标题。 */ }
      }
    }
    return "";
  }

  function renderToolCard(result, toolCallId, createdAt) {
    var r = result;
    if (!r || !r.display) return;
    // Pass toolCallId through to the renderer
    r._tcId = toolCallId;
    if (_onToolCard) _onToolCard({ toolCallId: toolCallId, result: r, created_at: createdAt });
  }

  function _isInternal(m) {
    if (m.role === "system") return true;
    if (m.role === "assistant" && m.tool_calls && (!m.content || !String(m.content).trim())) return true;
    return false;
  }

  function _shouldRender(content) {
    try {
      var r = typeof content === "string" ? JSON.parse(content) : content;
      return r && r.display;
    } catch (e) { return false; }
  }

  return {
    init: init,
    start: start,
    sendMessage: sendMessage,
    getState: getState,
    getHistory: getHistory,
    getMode: getMode,
    isSending: isSending,
    getClientId: getClientId,
    setAnalysisTimeoutSeconds: setAnalysisTimeoutSeconds,
    saveAgentState: saveAgentState,
    resolveSelector: resolveSelector,
    searchHistory: searchHistory,
    readHistoryContext: readHistoryContext,
  };
})();
