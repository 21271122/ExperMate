import { services } from './services';
import { createSplitLayout } from './split-layout';
/**
 * panel.js — 保留原 Canvas、分栏和转场，业务页面由 React Portal 渲染。
 *   services.PanelManager.navigate(url)   将 React 页面挂载到右栏
 *   services.PanelManager.reset()         回到 Canvas 空闲状态
 *   Router                       客户端路由 + History API
 */
export function createPanelManager(scope) {
  "use strict";

  var _contentBody = null;
  var _contentPanel = null;   // 右栏容器：转场色块只盖这里，不盖左侧聊天分屏
  var _fragmentMount = null;
  var _canvasContainer = null;
  var _currentView = "canvas";
  var _contentHeader = null;
  var _contentBack = null;
  var _contentTitle = null;
  var _currentPath = "/";   // 当前右栏显示内容的路径（用于保存旧视图状态）
  var _navigationVersion = 0;
  scope.cleanup(function () { _navigationVersion++; });

  // React 迁移入口使用 /app；业务路由与原片段地址保持不变。
  var _basePath = document.documentElement.dataset.expermateBase || "";
  function routePath(path) {
    return _basePath && (path === _basePath || path.indexOf(_basePath + "/") === 0)
      ? path.slice(_basePath.length) || "/" : path;
  }
  function currentPath() { return routePath(window.location.pathname); }

  // ---- 路由表 ----

  var ROUTES = {
    "/new":                      { color: "var(--black)", title: "新建记录" },
    "/record-drafts":            { color: "var(--black)", title: "继续整理草稿" },
    "/record-drafts/:id":        { color: "var(--black)", title: "实验草稿" },
    "/experiments":              { color: "var(--black)", title: "实验记录" },
    "/experiments/:id":          { color: "var(--black)", title: "Experiment" },
    "/experiments/:id/print":    { color: "#E32636", title: "Print" },
    "/timeline":                 { color: "#1D54A6", title: "实验时间线" },
    "/analyze":                  { color: "#E32636", title: "分析报告" },
    "/analysis/:id":             { color: "#E32636", title: "分析报告" },
    "/compare":                  { color: "#E32636", title: "Compare" },
    "/favorites":                { color: "#F8D030", title: "Categories" },
    "/settings":                 { color: "var(--white)", title: "设置" },
    "/templates":                { color: "var(--white)", title: "Templates" },
    "/login":                    { color: "var(--white)", title: "Login" },
  };

  const split = createSplitLayout(scope, {
    onResize() { if (_currentView === "canvas") { services.Canvas?.resize(); } },
    onModeChange() {
      if (_currentView !== "content") return;
      const matched = _matchRoute(currentPath());
      if (matched) _updateContentHeader(matched.route.color, matched.route.title);
      _updateHeaderMenu();
    },
    onFocus: _refreshCurrentResourceOnFocus,
    getContentTitle: () => _contentTitle && _contentTitle.textContent,
  });

  // ---- Init ----

  function init() {
    _contentBody    = document.getElementById("content-body");
    _contentPanel   = document.getElementById("content-panel");
    _fragmentMount  = document.getElementById("fragment-mount");
    _canvasContainer = document.getElementById("canvas-container");
    _contentHeader = document.getElementById("content-header");
    _contentBack   = document.getElementById("content-header-back");
    _contentTitle  = document.getElementById("content-header-title");

    // 初始化顶栏菜单
    _initHeaderMenu();

    // 监听浏览器后退/前进
    scope.listen(window, "popstate", function (e) {
      var st = e.state;
      if (st && st.path) {
        // 回到仪表盘状态：播放"从顶栏展开"的反向转场后显示 canvas
        // 首页展示 Canvas，不挂载业务页面。
        if (st.path === "/" || st.path === "/ai-shell/" || st.path === "/ai-shell") {
          _animateBackToCanvas();
        } else {
          // 返回非 canvas 页面：同样播放"从顶栏展开、当前页颜色"的返回动画
          _animateBackToPage(st.path, st.query || "");
        }
      } else {
        // 没有 state → 可能是回到初始 Shell 状态
        var path = currentPath();
        if (path === "/" || path === "/ai-shell/") {
          _animateBackToCanvas();
        } else {
          _animateBackToPage(path, window.location.search.slice(1));
        }
      }
    });

    // 拦截所有内部链接（捕获阶段：先于链接自身的 stopPropagation 执行。
    // 否则带 onclick="event.stopPropagation()" 的链接（如分析卡片的实验编号）
    // 会绕过路由变成整页跳转 —— 页面刷新导致聊天面板重载、历史状态丢失）
    scope.listen(document, "click", function (e) {
      var link = e.target.closest("a[href]");
      if (!link) return;
      if (link.id === "chat-brand") return;
      var href = link.getAttribute("href");
      if (!href || href === "#") return;
      if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("//")) return;
      if (href.startsWith("/api/") || href.startsWith("/uploads/") || href.startsWith("/static/")) return;
      if (link.target === "_blank" || link.hasAttribute("download")) return;

      e.preventDefault();
      if (href === "/") {
        if (services.ExMotion) {
          // 颜色追踪当前页（未返回时的顶部栏颜色），从链接位置展开
          services.ExMotion.begin(_backColorPath(), link, _contentPanel).then(function () { services.ExMotion.reveal(); });
        }
        reset();  // reset() 内部按需 push 根状态，不再重复入栈
      } else {
        navigate(href, link);
      }
    }, true);

    split.init();
  }

  // ---- 路由匹配 ----

  function _matchRoute(path) {
    // 精确匹配
    if (ROUTES[path]) return { route: ROUTES[path], params: {} };
    // 模式匹配（支持 :id 参数）
    var pathParts = path.split("/").filter(Boolean);
    for (var pattern in ROUTES) {
      var patternParts = pattern.split("/").filter(Boolean);
      if (patternParts.length !== pathParts.length) continue;
      var params = {};
      var matched = true;
      for (var i = 0; i < patternParts.length; i++) {
        if (patternParts[i].charAt(0) === ":") {
          params[patternParts[i].slice(1)] = pathParts[i];
        } else if (patternParts[i] !== pathParts[i]) {
          matched = false;
          break;
        }
      }
      if (matched) return { route: ROUTES[pattern], params: params };
    }
    return null;
  }

  // 面包屑中文标题按路径前缀推断，再使用路由标题兜底。
  function _zhRouteTitle(path, matched) {
    if (path.indexOf("/experiments") === 0) return "实验";
    if (path.indexOf("/analysis") === 0) return "分析";
    if (path.indexOf("/timeline") === 0) return "时间线";
    if (path.indexOf("/favorites") === 0) return "分类";
    if (path.indexOf("/compare") === 0) return "对比";
    if (path.indexOf("/templates") === 0) return "模板";
    if (path.indexOf("/settings") === 0) return "设置";
    if (matched) return matched.route.title;
    return "";
  }

  // ---- 公共 API ----

  function navigate(path, origin) {
    path = routePath(path);
    if (services.ExdiarySound) services.ExdiarySound.play("general");
    // 解析查询字符串
    var qIdx = path.indexOf("?");
    var cleanPath = qIdx >= 0 ? path.slice(0, qIdx) : path;
    var query = qIdx >= 0 ? path.slice(qIdx + 1) : "";

    _navigateToPath(cleanPath, query, true, origin);
  }

  async function _navigateToPath(path, query, pushState, origin, silentRefresh) {
    var version = ++_navigationVersion;
    // 根路径统一回到 Canvas。
    if (path === "/" || path === "/ai-shell/" || path === "/ai-shell") {
      if (services.ExMotion) await services.ExMotion.begin(_backColorPath(), origin, _contentPanel);
      if (version !== _navigationVersion) return;
      if (pushState) _pushState("/", "", null);
      reset();
      if (services.ExMotion) services.ExMotion.reveal();
      return;
    }

    // 1. 先更新地址栏（pushState），确保 currentPath() 正确
    var fullUrl = path + (query ? "?" + query : "");
    // 去重：目标与当前 state 相同 → 不重复入栈（避免历史栈堆积无意义条目）
    var curState = window.history.state;
    if (pushState) {
      var samePath = curState && curState.path === path && (curState.query || "") === (query || "");
      var onRoot = (path === "/" || path === "/ai-shell/" || path === "/ai-shell");
      if (!samePath && !(onRoot && currentPath() === "/")) {
        var fromPath = _currentPath && _currentPath !== path ? _currentPath : null;
        _pushState(path, query, fromPath);
      }
    }

    // 2. 再更新 header（此时读取 currentPath() 是新 URL）
    var matched = _matchRoute(path);
    if (!matched) {
      _updateContentHeader("var(--black)", "");
    } else {
      _updateContentHeader(matched.route.color, matched.route.title);
    }
    _updateHeaderMenu();

    // 路由标题 → 面包屑/返回按钮提示
    if (matched) _currentTitle = _zhRouteTitle(path, matched);
    _updateBackUI();

    if (services.ExMotion && !silentRefresh) await services.ExMotion.begin(path, origin, _contentPanel);
    if (version !== _navigationVersion) return;
    if (!services.ExperMatePages || !services.ExperMatePages.canRender(path)) {
      _showError("Page not found");
      if (services.ExMotion) services.ExMotion.reveal();
      return;
    }
    _injectContent(path);
  }

  var _lastFocusRefresh = 0;
  function _refreshCurrentResourceOnFocus() {
    var path = _currentPath || currentPath() || "";
    if (!/^\/(experiments|analysis|analyze|favorites)(?:\/|$)/.test(path) || services._isEditing) return;
    if (Date.now() - _lastFocusRefresh < 3000) return;
    _lastFocusRefresh = Date.now();
    _navigateToPath(path, window.location.search.slice(1), false, null, true);
  }

  // ---- 导航状态：压栈 + 面包屑 + 返回按钮 ----

  // 当前页标题（用于面包屑渲染）
  var _currentTitle = "";

  function _pushState(path, query, fromPath) {
    var st = { path: path, query: query || "" };
    // 直链/刷新后首次进入（无应用内前史）：标记 _initial，
    // back() 时退化为 reset()（回首页），避免 history.back() 离开应用
    if (window.history.state == null) st._initial = true;
    // 记录来源（面包屑上一级）；fromPath 非空时取它的标题
    if (fromPath) {
      var fromMatch = _matchRoute(fromPath);
      st._from = fromPath;
      st._fromTitle = _zhRouteTitle(fromPath, fromMatch);
    }
    history.pushState(st, "", _basePath + path + (query ? "?" + query : ""));
  }

  // 返回按钮显隐：可退（在某个应用页面且非根）→ 显示；根/无历史 → 隐藏。
  // 不渲染面包屑小字提示（按用户要求移除）。
  function _updateBackUI() {
    if (!_contentBack) return;
    var st = window.history.state;
    var onRoot = !st || !st.path || st.path === "/" || st.path === "/ai-shell/" || st.path === "/ai-shell";
    _contentBack.style.display = onRoot ? "none" : "inline-block";
  }

  // 返回时的"当前页路径"：popstate/back 触发时 _currentPath 尚未更新，
  // 仍是返回前所在页面 —— 用它作为动画颜色来源（瞄准未返回时的顶部栏颜色）
  function _backColorPath() {
    return (_currentPath && _currentPath !== "/" && _currentPath !== "/ai-shell/" && _currentPath !== "/ai-shell")
      ? _currentPath
      : "/";
  }

  // 返回仪表盘的反向转场：色块从右栏顶部栏（content-header）展开覆盖右栏，再显示 canvas。
  // 颜色取返回前所在页（未返回时的顶部栏颜色），而非固定的黑色。
  function _animateBackToCanvas() {
    if (services.ExMotion && _contentHeader) {
      services.ExMotion.begin(_backColorPath(), _contentHeader, _contentPanel).then(function () {
        reset();
        services.ExMotion.reveal();
      });
    } else {
      reset();
    }
  }

  // 返回（非 canvas 页面，如 详情→列表）：统一播放"从顶栏展开、当前页颜色"的返回动画，
  // 动画结束后加载目标页（内部 _navigateToPath 的 begin 会被 isTransitioning 跳过，不重复播）。
  function _animateBackToPage(path, query) {
    if (services.ExMotion && _contentHeader) {
      services.ExMotion.begin(_backColorPath(), _contentHeader, _contentPanel).then(function () {
        _navigateToPath(path, query, false);
      });
    } else {
      _navigateToPath(path, query, false);
    }
  }

  // 返回：优先后退到浏览器历史上的上一步（popstate 统一恢复并负责转场动画），
  // 无可退历史或直链进入时回仪表盘（不离开应用）。
  // 注意：这里不要自行 services.ExMotion.begin —— popstate → _navigateToPath/reset 会配对
  // begin/reveal；若在 begin 后手动 history.back() 且目标是根路径，popstate 只调
  // reset()（无 reveal），全屏色块会残留导致界面卡在纯色。
  function back() {
    var st = window.history.state;
    var canGoBack = st && st.path && st.path !== "/" && st.path !== "/ai-shell/" && st.path !== "/ai-shell";
    if (!canGoBack) {
      reset();
      return;
    }
    if (st && st._initial) {
      // 直链进入（无应用内前史）：返回即回仪表盘，播放反向转场
      _animateBackToCanvas();
      return;
    }
    history.back();
  }

  function _showResourceChangeNotice(message, label, onClick) {
    var old = document.getElementById("resource-change-notice");
    if (old) old.remove();
    var notice = document.createElement("div");
    notice.id = "resource-change-notice";
    notice.style.cssText = "display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--yellow);border-bottom:3px solid var(--black);font-size:0.8rem;font-weight:700";
    notice.appendChild(document.createTextNode(message));
    var button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.style.cssText = "margin-left:auto;padding:3px 8px;background:var(--white);border:2px solid var(--black);font:inherit;font-size:0.75rem;font-weight:700;cursor:pointer";
    scope.listen(button, "click", onClick);
    notice.appendChild(button);
    if (_contentBody && _contentBody.parentNode) _contentBody.parentNode.insertBefore(notice, _contentBody);
  }

  function handleResourceChange(change) {
    if (!change) return;
    var path = _currentPath || currentPath() || "";
    if (change.resource === "categories" || change.resource === "favorites") {
      if (path === "/experiments" || path === "/favorites") {
        navigate(path);
      } else if (typeof services.ChatUI !== "undefined" && services.ChatUI.showToast) {
        services.ChatUI.showToast("分类或置顶状态已在另一窗口更新");
      }
      return;
    }
    if (change.resource === "analysis") {
      var analysisPath = change.anal_id ? "/analysis/" + change.anal_id : "";
      if (analysisPath && path === analysisPath && change.action !== "deleted") {
        navigate(analysisPath);
      } else if (path === "/analyze" || path === "/analysis") {
        navigate(path);
      } else if (typeof services.ChatUI !== "undefined" && services.ChatUI.showToast) {
        services.ChatUI.showToast("分析报告已在另一窗口" + (change.action === "deleted" ? "删除" : "更新"));
      }
      return;
    }
    if (change.resource !== "experiment" || !change.exp_id) return;
    var detailPath = "/experiments/" + change.exp_id;
    var message = "实验 " + change.exp_id + " 已在另一窗口" +
      (change.action === "deleted" ? "删除。" : "更新。");

    if (path === detailPath) {
      if (change.action !== "deleted" && !services._isEditing) {
        navigate(detailPath);
        return;
      }
      _showResourceChangeNotice(
        message + (change.action === "deleted" ? "当前页面内容已失效。" : "你的未保存编辑尚未被覆盖。"),
        change.action === "deleted" ? "返回列表" : "重新加载",
        function () { navigate(change.action === "deleted" ? "/experiments" : detailPath); }
      );
      return;
    }

    if (path === "/experiments") {
      navigate(path);
      return;
    }
    if (typeof services.ChatUI !== "undefined" && services.ChatUI.showToast) services.ChatUI.showToast(message);
  }

  // ---- 视图状态保持：滚动位置 + details 展开 + 列表页过滤上下文 ----
  // 片段导航是整块 innerHTML 替换，离开页面的滚动位置/展开状态/编辑上下文会全部丢失。
  // 这里在替换前保存、注入后恢复，返回列表/详情时保持用户所在位置。
  // 用 localStorage 持久化：关闭标签页/重启应用后再次进入仍可恢复（"退出前状态"）。
  // 搜索词不恢复：残留关键词会让有记录的列表显示为“无匹配”，误导为数据丢失。
  var _VIEW_STORE_KEY = "exdiary_view_state";
  function _loadViewStore() {
    try {
      var store = JSON.parse(localStorage.getItem(_VIEW_STORE_KEY) || "{}");
      var changed = false;
      Object.keys(store).forEach(function(path) {
        if (path.indexOf("/experiments") !== 0 || !store[path] || store[path].search === undefined) return;
        delete store[path].search;
        changed = true;
      });
      if (changed) _saveViewStore(store);
      return store;
    } catch (e) { return {}; }
  }
  function _saveViewStore(store) {
    try { localStorage.setItem(_VIEW_STORE_KEY, JSON.stringify(store)); } catch (e) {}
  }

  function _saveViewState(path) {
    if (!_fragmentMount || !path) return;
    var store = _loadViewStore();
    var state = store[path] || {};
    state.scroll = _fragmentMount.scrollTop;
    // details 展开状态（按 summary 文本匹配）
    var details = {};
    _fragmentMount.querySelectorAll("details").forEach(function (d, i) {
      var s = d.querySelector("summary");
      details[i] = { key: s ? s.textContent.trim() : String(i), open: d.open };
    });
    state.details = details;
    // 列表筛选由 React 状态提供，避免再次从 DOM 拼装一份状态。
    if (services.ExperMateList) Object.assign(state, services.ExperMateList.getViewState());
    store[path] = state;
    _saveViewStore(store);
  }

  function _injectContent(path) {
    if (!_fragmentMount) return;

    // React Portal 必须在清理旧节点之前卸载，且先保存当前页面状态。
    _saveViewState(_currentPath);
    if (services.closePagePreviews) services.closePagePreviews();
    if (services.ExperMatePages) services.ExperMatePages.clear();

    document.querySelectorAll(".pane-scoped-modal").forEach(function (modal) {
      modal.remove();
    });

    // 隐藏 canvas，显示片段挂载点
    if (_canvasContainer) _canvasContainer.style.display = "none";
    _fragmentMount.style.display = "";
    _currentView = "content";
    services.Canvas?.setVisible(false);

    // 清理旧内容
    _fragmentMount.innerHTML = "";

    // 注入新 HTML
    var toolbar = document.createElement('div'); toolbar.id = 'page-toolbar'; toolbar.style.display = 'contents'; _fragmentMount.appendChild(toolbar);
    var content = document.createElement('div'); content.className = 'fragment-content'; _fragmentMount.appendChild(content);
    _currentPath = path;

    services.ExperMatePages.show(path, content);
    if (services.ExMotion) {
      services.ExMotion.enter(_fragmentMount);
      services.ExMotion.reveal();
    }

    // 返回按钮显隐 + 面包屑（由导航栈状态决定，而非无条件显示）
    _updateBackUI();

    // 滚动到顶部
    _fragmentMount.scrollTop = 0;

    // 恢复本路径上次的视图状态（详情展开、过滤、滚动位置）

  }

  function _showError(msg) {
    if (!_fragmentMount) return;
    if (services.ExperMatePages) services.ExperMatePages.clear();
    if (_canvasContainer) _canvasContainer.style.display = "none";
    _fragmentMount.style.display = "";
    _currentView = "content";
    services.Canvas?.setVisible(false);
    _fragmentMount.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;height:100%;text-align:center;opacity:0.5">' +
      '<div><h3 style="font-weight:700;letter-spacing:2px">加载失败</h3>' +
      '<p style="font-size:0.85rem">' + escHtml(msg) + '</p></div></div>';
  }

  function reset() {
    _navigationVersion++;
    if (services.closePagePreviews) services.closePagePreviews();
    _currentView = "canvas";
    services.Canvas?.setVisible(true);
    // 离开前保存当前页面状态（滚动/过滤/展开），返回仪表盘后再进入仍可恢复
    if (_fragmentMount && _currentPath && _currentPath !== "/" &&
        _currentPath !== "/ai-shell/" && _currentPath !== "/ai-shell") {
      _saveViewState(_currentPath);
    }
    _currentPath = "/";
    _currentTitle = "";
    if (services.ExperMatePages) services.ExperMatePages.clear();
    if (_fragmentMount) { _fragmentMount.style.display = "none"; _fragmentMount.innerHTML = ""; }
    if (_canvasContainer) {
      _canvasContainer.style.display = "";
      scope.frame(function () {
        services.Canvas?.resize();
      });
    }
    // 仅当 URL 不在根时才 push 根状态 —— 避免历史栈堆积重复的 "/"
    if (currentPath() !== "/") _pushState("/", "", null);
    _updateContentHeader("", "");
    _updateHeaderMenu();
    _updateBackUI();
    if (_contentTitle) _contentTitle.textContent = "";
  }

  // ---- Content Header ----

  function _updateContentHeader(color, title) {
    if (_contentHeader) {
      _contentHeader.style.background = color || "var(--black)";
      _contentHeader.style.color = (color === "var(--white)") ? "var(--black)" : "var(--white)";
    }
    if (_contentTitle) _contentTitle.textContent = title || "";
  }

  // ---- Content Header Menu ----

  function _updateHeaderMenu(visible) {
    var wrap = document.getElementById("content-header-menu-wrap");
    if (!wrap) return;
    if (visible === undefined) {
      visible = currentPath() === "/experiments";
    }
    wrap.classList.toggle("visible", !!visible);
  }

  function _initHeaderMenu() {
    var btn = document.getElementById("content-header-menu-btn");
    var dd = document.getElementById("content-header-menu-dd");
    if (!btn || !dd) return;

    scope.listen(btn, "click", function (e) {
      e.stopPropagation();
      dd.style.display = dd.style.display === "block" ? "none" : "block";
    });

    scope.listen(document, "click", function (e) {
      if (!e.target.closest("#content-header-menu-wrap")) dd.style.display = "none";
    });

    dd.querySelectorAll(".menu-item").forEach(function (item) {
      scope.listen(item, "click", function () {
        dd.style.display = "none";
        var action = this.dataset.action;
        if (action === "search") _openSearchPopup();
        else if (action === "categories" || action === "filters") _openPanelPopup(action);
        else if (action === "compare") _toggleCompareFromMenu();
      });
      scope.listen(item, "mouseenter", function () { this.style.background = "var(--black)"; this.style.color = "var(--white)"; });
      scope.listen(item, "mouseleave", function () { this.style.background = ""; this.style.color = "var(--black)"; });
    });
  }

  // 手机工具面板由当前 React 列表管理，避免移动受 React 管理的节点。
  function _openSearchPopup() { if (services.ExperMateList) services.ExperMateList.openSearchPopup(); }
  function _openPanelPopup(name) {
    if (!services.ExperMateList) return;
    if (name === "compare") services.enterCompareMode();
    else services.ExperMateList.openPanelPopup(name);
  }
  function _toggleCompareFromMenu() { _openPanelPopup("compare"); }

  // ---- show() — 工具卡片兼容接口 ----

  function show(viewName, data, origin) {
    var urlMap = {
      "exp-detail": data && data.expId ? "/experiments/" + data.expId : "/experiments",
      "exp-list": "/experiments",
      "analysis": data && data.analId ? "/analysis/" + data.analId : "/analyze",
      "favorites": "/experiments?panel=categories",
      "compare": data && data.ids ? "/compare?ids=" + data.ids.join(",") : "/experiments",
    };
    navigate(urlMap[viewName] || "/experiments", origin);
  }

  // Close menu dropdown on outside click
  scope.listen(document, "click", function (e) {
    if (!e.target.closest("#content-header-menu-wrap")) {
      var dd = document.getElementById("content-header-menu-dd");
      if (dd) dd.style.display = "none";
    }
  });

  return {
    init: init,
    currentPath: currentPath,
    navigate: navigate,
    back: back,
    show: show,
    reset: reset,
    expandChat: split.expandChat,
    restoreContent: split.restoreContent,
    canvasHighlight: (route, flashes) => services.Canvas?.highlight(route, flashes),
    canvasFlash: (route, duration) => services.Canvas?.flash(route, duration),
    handleResourceChange: handleResourceChange,
  };
}

// 工具函数
function escHtml(s) { var d = document.createElement("div"); d.textContent = s || ""; return d.innerHTML; }
