// 分栏尺寸、拖动与横竖屏切换；不负责导航或 Canvas 绘制。
export function createSplitLayout(scope, { onResize, onModeChange, onFocus, getContentTitle }) {
  // ---- Divider Drag Resize ----

  var _isDragging = false;
  var _dragSource = null;
  var _dragStartY = 0;
  var _dragStartPanelH = 0;
  var CHAT_MIN_WIDTH = 360;
  var MIN_PANEL_WIDTH = 200;
  var _chatWidth = 0;
  var _mobilePanelH = 0;

  scope.cleanup(() => {
    document.getElementById('divider')?.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });

  function initDividerDrag() {
    var divider = document.getElementById("divider");
    var mainSplit = document.getElementById("main-split");
    if (!divider || !mainSplit) return;

    try {
      var saved = JSON.parse(localStorage.getItem("exdiary_panel_sizes") || "{}");
      if (saved.chatWidth) _chatWidth = saved.chatWidth;
      if (saved.panelH) _mobilePanelH = saved.panelH;
    } catch (e) {}

    if (!_chatWidth) {
      var chatPanel = document.getElementById("chat-panel");
      if (chatPanel) _chatWidth = chatPanel.getBoundingClientRect().width;
    }

    if (!_mobilePanelH && window.innerWidth <= 600) {
      _mobilePanelH = Math.round(window.innerHeight / 3);
    }

    applySizes();
    onResize();

    // Desktop divider
    scope.listen(divider, "mousedown", function (e) {
      if (window.innerWidth <= 600) return;
      e.preventDefault();
      _isDragging = true;
      _dragSource = "divider";
      divider.classList.add("dragging");
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    });

    scope.listen(divider, "touchstart", function (e) {
      if (window.innerWidth <= 600) return;
      e.preventDefault();
      _isDragging = true;
      _dragSource = "divider";
      divider.classList.add("dragging");
    });

    // Mobile divider
    scope.listen(divider, "mousedown", function (e) {
      if (window.innerWidth > 600) return;
      e.preventDefault();
      _isDragging = true;
      _dragSource = "divider-mobile";
      _dragStartY = e.clientY;
      var shell = document.getElementById("app-shell");
      if (shell) shell.classList.remove("chat-collapsed");
      _dragStartPanelH = _mobilePanelH || _mobileFixedHeight() || Math.round(window.innerHeight / 3);
      divider.classList.add("dragging");
      document.body.style.userSelect = "none";
    });

    scope.listen(divider, "touchstart", function (e) {
      if (window.innerWidth > 600) return;
      e.preventDefault();
      _isDragging = true;
      _dragSource = "divider-mobile";
      _dragStartY = e.touches[0].clientY;
      var shell = document.getElementById("app-shell");
      if (shell) shell.classList.remove("chat-collapsed");
      _dragStartPanelH = _mobilePanelH || _mobileFixedHeight() || Math.round(window.innerHeight / 3);
      divider.classList.add("dragging");
    });

    // Move
    scope.listen(window, "mousemove", function (e) {
      if (!_isDragging) return;
      var rect = mainSplit.getBoundingClientRect();
      if (_dragSource === "divider") {
        var chatWidth = e.clientX - rect.left;
        chatWidth = Math.max(CHAT_MIN_WIDTH, Math.min(rect.width - MIN_PANEL_WIDTH, chatWidth));
        _chatWidth = chatWidth;
      } else {
        var deltaY = e.clientY - _dragStartY;
        var rawH = _dragStartPanelH + deltaY;
        var fixedH = _mobileFixedHeight();
        var minH = fixedH;
        var maxH = rect.height - 44;
        if (maxH < minH) maxH = minH;
        rawH = Math.max(minH, Math.min(maxH, rawH));
        _mobilePanelH = Math.round(rawH);
      }
      applySizes();
      onResize();
    });

    scope.listen(window, "touchmove", function (e) {
      if (!_isDragging) return;
      var rect = mainSplit.getBoundingClientRect();
      if (_dragSource === "divider") {
        var chatWidth2 = e.touches[0].clientX - rect.left;
        chatWidth2 = Math.max(CHAT_MIN_WIDTH, Math.min(rect.width - MIN_PANEL_WIDTH, chatWidth2));
        _chatWidth = chatWidth2;
      } else {
        var deltaY2 = e.touches[0].clientY - _dragStartY;
        var rawH2 = _dragStartPanelH + deltaY2;
        var fixedH2 = _mobileFixedHeight();
        var minH2 = fixedH2;
        var maxH2 = rect.height - 44;
        if (maxH2 < minH2) maxH2 = minH2;
        rawH2 = Math.max(minH2, Math.min(maxH2, rawH2));
        _mobilePanelH = Math.round(rawH2);
      }
      applySizes();
      onResize();
    });

    // Release
    scope.listen(window, "mouseup", function () {
      if (!_isDragging) return;
      _isDragging = false;
      var div = document.getElementById("divider");
      if (div) div.classList.remove("dragging");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (_dragSource === "divider-mobile") _maybeCollapseChat();
      _dragSource = null;
      saveSizes();
      onResize();
    });

    scope.listen(window, "touchend", function () {
      if (!_isDragging) return;
      _isDragging = false;
      var div = document.getElementById("divider");
      if (div) div.classList.remove("dragging");
      if (_dragSource === "divider-mobile") _maybeCollapseChat();
      _dragSource = null;
      saveSizes();
      onResize();
    });

    // Window resize — 检测横竖屏模式切换
    var _lastIsDesktop = window.innerWidth > 600;
    scope.listen(window, "resize", function () {
      var isDesktop = window.innerWidth > 600;
      if (isDesktop !== _lastIsDesktop) {
        // 模式切换：清理内联样式，让 CSS 媒体查询重新接管
        _clearInlineStylesForModeSwitch();
        _lastIsDesktop = isDesktop;
        onModeChange();
      }
      if (isDesktop) {
        enforceChatMinWidth();
      } else {
        if (!_mobilePanelH) _mobilePanelH = Math.round(window.innerHeight / 3);
        applySizes();
      }
      onResize();
    });
    scope.listen(window, "focus", onFocus);
  }

  // ---- Desktop helpers ----

  function enforceChatMinWidth() {
    var mainSplit = document.getElementById("main-split");
    if (!mainSplit) return;
    var rect = mainSplit.getBoundingClientRect();
    var maxChat = rect.width - MIN_PANEL_WIDTH;
    if (_chatWidth < CHAT_MIN_WIDTH) _chatWidth = CHAT_MIN_WIDTH;
    if (_chatWidth > maxChat) _chatWidth = maxChat;
    applySizes();
  }

  /**
   * 清理横竖屏切换时残留的内联样式。
   * JS 设置的 inline style 优先级高于 CSS 媒体查询，
   * 必须显式清除才能让 CSS 重新接管。
   */
  function _clearInlineStylesForModeSwitch() {
    var shell = document.getElementById("app-shell");
    if (shell) {
      shell.style.removeProperty("--chat-panel-h");
      shell.classList.remove("chat-collapsed", "content-collapsed");
    }
    // content-header: 清除 JS 设置的背景色/文字颜色，让 CSS 默认值生效
    var header = document.getElementById("content-header");
    if (header) {
      header.style.removeProperty("background");
      header.style.removeProperty("color");
    }
    // fragment-mount: 清除 JS 可能设置的内联样式
    var mount = document.getElementById("fragment-mount");
    if (mount) {
      mount.style.removeProperty("max-width");
      mount.style.removeProperty("padding");
    }
    // chat-panel: 清除 JS 设置的背景色
    var chatPanel = document.getElementById("chat-panel");
    if (chatPanel) {
      chatPanel.style.removeProperty("background");
    }
  }

  // ---- Mobile helpers ----

  function _mobileFixedHeight() {
    var ch = document.getElementById("chat-header");
    var ca = document.querySelector(".chat-header-accent");
    var cd = document.getElementById("color-divider");
    var ia = document.getElementById("chat-input-area");
    return (ch ? ch.getBoundingClientRect().height : 36) +
           (ca ? ca.getBoundingClientRect().height : 3) +
           (cd ? cd.getBoundingClientRect().height : 10) +
           (ia ? ia.getBoundingClientRect().height : 56);
  }

  function _maybeCollapseChat() {
    var shell = document.getElementById("app-shell");
    if (!shell) return;
    var mainSplit = document.getElementById("main-split");
    if (!mainSplit) return;

    if (_mobilePanelH <= _mobileFixedHeight() + 4) {
      shell.classList.add("chat-collapsed");
      _mobilePanelH = 0;
      applySizes();
      saveSizes();
      return;
    }

    var maxH = mainSplit.getBoundingClientRect().height - 44;
    if (_mobilePanelH >= maxH - 4) {
      shell.classList.add("content-collapsed");
      _updateRestoreBtnColor();
    }
  }

  function _updateRestoreBtnColor() {
    var btn = document.getElementById("content-restore-btn");
    if (!btn) return;
    var header = document.getElementById("content-header");
    if (header) {
      btn.style.background = header.style.background || "var(--black)";
      btn.style.color = header.style.color || "var(--white)";
    }
    var title = getContentTitle() || "Panel";
    btn.title = "Restore " + title;
  }

  function _resetToDefaultRatio() {
    _mobilePanelH = Math.round(window.innerHeight / 3);
    applySizes();
    saveSizes();
    scope.frame(onResize);
  }

  function restoreContent() {
    var shell = document.getElementById("app-shell");
    if (shell) shell.classList.remove("content-collapsed");
    _resetToDefaultRatio();
  }

  function expandChat() {
    var shell = document.getElementById("app-shell");
    if (shell) shell.classList.remove("chat-collapsed");
    _mobilePanelH = Math.round(window.innerHeight / 3);
    applySizes();
    saveSizes();
  }

  // ---- Apply / Save ----

  function _captureChatScroll() {
    var container = document.getElementById("chat-messages");
    if (!container || !container.scrollHeight) return null;
    var maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
    var atBottom = maxScroll - container.scrollTop <= 32;
    var rect = container.getBoundingClientRect();
    var children = container.children;
    var anchor = null;
    for (var i = 0; i < children.length; i++) {
      var childRect = children[i].getBoundingClientRect();
      if (childRect.bottom > rect.top) {
        anchor = children[i];
        break;
      }
    }
    return {
      container: container,
      atBottom: atBottom,
      scrollTop: container.scrollTop,
      anchor: anchor,
      anchorOffset: anchor ? anchor.getBoundingClientRect().top - rect.top : 0,
    };
  }

  function _restoreChatScroll(state) {
    if (!state || !state.container.isConnected) return;
    var container = state.container;
    if (state.atBottom) {
      container.scrollTop = container.scrollHeight;
      return;
    }
    if (state.anchor && state.anchor.isConnected) {
      var offset = state.anchor.getBoundingClientRect().top - container.getBoundingClientRect().top;
      container.scrollTop += offset - state.anchorOffset;
    } else {
      container.scrollTop = state.scrollTop;
    }
  }

  function applySizes() {
    // 改变分栏宽度会使 Markdown 重新换行。保留当前可见消息的相对位置，
    // 避免旧的像素 scrollTop 把用户意外带到更早的内容。
    var chatScroll = _captureChatScroll();
    var isDesktop = window.innerWidth > 600;
    var shell = document.getElementById("app-shell");
    if (isDesktop) {
      if (shell) shell.style.setProperty("--chat-width", _chatWidth + "px");
    } else {
      var val = _mobilePanelH > 0 ? (_mobilePanelH + "px") : "auto";
      if (shell) shell.style.setProperty("--chat-panel-h", val);
    }
    _restoreChatScroll(chatScroll);
  }

  function saveSizes() {
    try {
      localStorage.setItem("exdiary_panel_sizes", JSON.stringify({
        chatWidth: _chatWidth, panelH: _mobilePanelH
      }));
    } catch (e) {}
  }

  return { init: initDividerDrag, expandChat, restoreContent };
}
