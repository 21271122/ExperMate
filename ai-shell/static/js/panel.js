/**
 * panel.js — 内容面板：Canvas 默认 + fetch 片段注入
 *   PanelManager.navigate(url)   加载 HTML 片段到右栏
 *   PanelManager.reset()         回到 Canvas 空闲状态
 *   Router                       客户端路由 + History API
 */
var PanelManager = (function () {
  "use strict";

  var _contentBody = null;
  var _contentPanel = null;   // 右栏容器：转场色块只盖这里，不盖左侧聊天分屏
  var _fragmentMount = null;
  var _canvasContainer = null;
  var _canvasEl = null;
  var _ctx = null;
  var _currentView = "canvas";
  var _canvasRunning = false;
  var _animFrameId = null;
  var _contentHeader = null;
  var _contentBack = null;
  var _contentTitle = null;
  var _currentPath = "/";   // 当前右栏显示内容的路径（用于保存旧视图状态）

  // ---- Canvas State ----

  var CHUNK_SIZE = 400;
  var ZOOM_DESKTOP = 2.25;
  var ZOOM_MOBILE = 1.5;
  function _zoom() { return window.innerWidth <= 600 ? ZOOM_MOBILE : ZOOM_DESKTOP; }
  var camera = { x: 0, y: 0 };
  var time = Math.random() * Math.PI * 2;
  var activeChunks = new Map();
  var currentSpeedX = 0;
  var currentSpeedY = 0;
  var _colorCache = new Map();            // 坐标→颜色/路由缓存，防止 resize 后变色
  var _canvasDrag = { active: false, lastX: 0, lastY: 0, startX: 0, startY: 0, moved: false };
  var hoverRect = null;                   // 当前悬浮块的引用（悬浮状态本体挂在块上：r.hovered / r.hoverT0）
  var _now = 0;                           // 当前帧时间戳
  var _canvasMode = "free";               // free | record | analyze（同步 AgentClient）
  var _agentTipEl = null;                 // 便签板元素
  var _hoverTipEl = null;                 // hover 提示条元素
  var _stats = { total: 0, unfinished: 0, favorites: 0, analysis: 0, lastRecordDays: 0 };
  var _highlights = [];                   // Agent 联动：高亮脉冲 {route, t0, total, period, hits, last}
  var _flashes = [];                      // Agent 联动：工具闪烁 {route, t0, duration}
  var _growths = [];                      // Agent 联动：生长动画 {rect, t0}

  // 统一色表（De Stijl 标准令牌）
  var ROUTE_COLORS = {
    experiments: "#FFFFFF",
    analyze: "#E32636",
    favorites: "#F8D030",
    timeline: "#1D54A6"
  };
  var ROUTE_TITLES = { experiments: "实验", analyze: "分析", favorites: "敬请期待", timeline: "敬请期待" };
  var ROUTE_SUBTITLES = { experiments: "EXPERIMENTS", analyze: "ANALYSIS", favorites: "COMING SOON", timeline: "COMING SOON" };
  var HEADER_COLORS = { experiments: "var(--black)", analyze: "#E32636", favorites: "#F8D030", timeline: "#1D54A6" };
  var FONT_CN = "'Source Han Sans SC','Noto Sans SC Variable','Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif";

  // ---- 路由表 ----

  var ROUTES = {
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

  // ---- Init ----

  function init() {
    _contentBody    = document.getElementById("content-body");
    _contentPanel   = document.getElementById("content-panel");
    _fragmentMount  = document.getElementById("fragment-mount");
    _canvasContainer = document.getElementById("canvas-container");
    _canvasEl        = document.getElementById("de-stijl-canvas");
    _contentHeader = document.getElementById("content-header");
    _contentBack   = document.getElementById("content-header-back");
    _contentTitle  = document.getElementById("content-header-title");

    _agentTipEl = document.getElementById("agent-tip");
    _hoverTipEl = document.getElementById("hover-tip");
    _loadStats();

    if (_canvasEl) {
      _ctx = _canvasEl.getContext("2d");
      requestAnimationFrame(function () {
        resizeCanvas();
        activeChunks.clear();
        renderNote();
      });
      _canvasEl.addEventListener("click", handleCanvasClick);
      // 拖拽平移 + hover 追踪
      _canvasEl.addEventListener("mousedown", function (e) {
        _canvasDrag.active = true;
        _canvasDrag.moved = false;
        _canvasDrag.startX = e.clientX;
        _canvasDrag.startY = e.clientY;
        _canvasDrag.lastX = e.clientX;
        _canvasDrag.lastY = e.clientY;
        _canvasEl.style.cursor = "grabbing";
      });
      window.addEventListener("mousemove", function (e) {
        if (_canvasDrag.active) {
          var dx = e.clientX - _canvasDrag.startX;
          var dy = e.clientY - _canvasDrag.startY;
          if (Math.abs(dx) > 3 || Math.abs(dy) > 3) _canvasDrag.moved = true;
          var z = _zoom();
          camera.x -= (e.clientX - _canvasDrag.lastX) / z;
          camera.y -= (e.clientY - _canvasDrag.lastY) / z;
          _canvasDrag.lastX = e.clientX;
          _canvasDrag.lastY = e.clientY;
          return;
        }
        // hover：命中检测 + 底部提示条（悬浮状态写入块本体）
        var p = _screenToWorld(e);
        var picked = pickRect(p.wx, p.wy);
        if (picked !== hoverRect) {
          if (hoverRect) hoverRect.hovered = false;
          hoverRect = picked;
          if (picked) { picked.hovered = true; picked.hoverT0 = performance.now(); }
        }
        if (hoverRect && _hoverTipEl) {
          _canvasEl.style.cursor = "pointer";
          _hoverTipEl.style.display = "block";
          _hoverTipEl.innerHTML = "点击进入「<b>" + ROUTE_TITLES[hoverRect.route] + "</b>」— " + routeDesc(hoverRect.route);
        } else if (_hoverTipEl) {
          _canvasEl.style.cursor = "grab";
          _hoverTipEl.style.display = "none";
        }
      });
      window.addEventListener("mouseup", function () {
        if (_canvasDrag.active) {
          _canvasDrag.active = false;
          _canvasEl.style.cursor = "";
        }
      });
      _canvasEl.addEventListener("mouseleave", function () {
        if (hoverRect) { hoverRect.hovered = false; hoverRect = null; }
        if (_hoverTipEl) _hoverTipEl.style.display = "none";
      });
      // 触摸拖拽
      _canvasEl.addEventListener("touchstart", function (e) {
        if (e.touches.length === 1) {
          _canvasDrag.active = true;
          _canvasDrag.lastX = e.touches[0].clientX;
          _canvasDrag.lastY = e.touches[0].clientY;
        }
      }, { passive: true });
      window.addEventListener("touchmove", function (e) {
        if (!_canvasDrag.active || !e.touches.length) return;
        var z = _zoom();
        var dx = (e.touches[0].clientX - _canvasDrag.lastX) / z;
        var dy = (e.touches[0].clientY - _canvasDrag.lastY) / z;
        camera.x -= dx;
        camera.y -= dy;
        _canvasDrag.lastX = e.touches[0].clientX;
        _canvasDrag.lastY = e.touches[0].clientY;
      }, { passive: true });
      window.addEventListener("touchend", function () { _canvasDrag.active = false; });
      _canvasRunning = true;
      render();
    }

    // 初始化顶栏菜单
    _initHeaderMenu();

    // 监听浏览器后退/前进
    window.addEventListener("popstate", function (e) {
      var st = e.state;
      if (st && st.path) {
        // 回到仪表盘状态：播放"从顶栏展开"的反向转场后显示 canvas
        // （_fragment/ 不存在，直接加载会 404，必须走 reset）
        if (st.path === "/" || st.path === "/ai-shell/" || st.path === "/ai-shell") {
          _animateBackToCanvas();
        } else {
          // 返回非 canvas 页面：同样播放"从顶栏展开、当前页颜色"的返回动画
          _animateBackToPage(st.path, st.query || "");
        }
      } else {
        // 没有 state → 可能是回到初始 Shell 状态
        var path = window.location.pathname;
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
    document.addEventListener("click", function (e) {
      var link = e.target.closest("a[href]");
      if (!link) return;
      var href = link.getAttribute("href");
      if (!href || href === "#") return;
      if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("//")) return;
      if (href.startsWith("/api/") || href.startsWith("/uploads/") || href.startsWith("/static/")) return;
      if (href.startsWith("/_fragment/")) return;
      if (link.target === "_blank" || link.hasAttribute("download")) return;

      e.preventDefault();
      if (href === "/") {
        if (window.ExMotion) {
          // 颜色追踪当前页（未返回时的顶部栏颜色），从链接位置展开
          window.ExMotion.begin(_backColorPath(), link, _contentPanel).then(function () { window.ExMotion.reveal(); });
        }
        reset();  // reset() 内部按需 push 根状态，不再重复入栈
      } else {
        navigate(href, link);
      }
    }, true);

    initDividerDrag();
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

  function _buildFragmentUrl(path) {
    return "/_fragment" + path;
  }

  // 面包屑中文标题：优先 ROUTE_TITLES 映射，其次按路径前缀推断，最后用路由英文标题兜底
  function _zhRouteTitle(path, matched) {
    var zh = ROUTE_TITLES[path];
    if (zh) return zh;
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
    if (window.ExdiarySound) window.ExdiarySound.play("general");
    // 解析查询字符串
    var qIdx = path.indexOf("?");
    var cleanPath = qIdx >= 0 ? path.slice(0, qIdx) : path;
    var query = qIdx >= 0 ? path.slice(qIdx + 1) : "";

    _navigateToPath(cleanPath, query, true, origin);
  }

  async function _navigateToPath(path, query, pushState, origin, silentRefresh) {
    // 根路径兜底：直接请求 _fragment/ 不存在（404），统一走 reset
    if (path === "/" || path === "/ai-shell/" || path === "/ai-shell") {
      if (window.ExMotion) await window.ExMotion.begin(_backColorPath(), origin, _contentPanel);
      if (pushState) _pushState("/", "", null);
      reset();
      if (window.ExMotion) window.ExMotion.reveal();
      return;
    }

    // 特殊路由：/new → 重定向到首页（agent 处理新建实验）
    if (path === "/new") {
      if (window.ExMotion) await window.ExMotion.begin(_backColorPath(), origin, _contentPanel);
      if (pushState) _pushState("/", "");
      reset();
      if (window.ExMotion) window.ExMotion.reveal();
      return;
    }

    // 1. 先更新地址栏（pushState），确保 window.location.pathname 正确
    var fullUrl = path + (query ? "?" + query : "");
    // 去重：目标与当前 state 相同 → 不重复入栈（避免历史栈堆积无意义条目）
    var curState = window.history.state;
    if (pushState) {
      var samePath = curState && curState.path === path && (curState.query || "") === (query || "");
      var onRoot = (path === "/" || path === "/ai-shell/" || path === "/ai-shell");
      if (!samePath && !(onRoot && window.location.pathname === "/")) {
        var fromPath = _currentPath && _currentPath !== path ? _currentPath : null;
        _pushState(path, query, fromPath);
      }
    }

    // 2. 再更新 header（此时读取 window.location.pathname 是新 URL）
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

    // 3. 先发起片段请求（不等待），与转场动画并行 ——
    //    避免"全屏色块盖住后干等后端"（实验列表/时间线片段数据量大时体感明显）
    var cacheBust = "_v=" + Date.now();
    var fragmentUrl = _buildFragmentUrl(path) + (query ? "?" + query + "&" + cacheBust : "?" + cacheBust);
    var token = localStorage.getItem("exdiary_token") || "";
    var headers = {};
    if (token) headers["Authorization"] = "Bearer " + token;
    var fetchPromise = fetch(fragmentUrl, { headers: headers });

    // 4. 播放转场动画（与 fetch 并行进行；色块只覆盖右栏 content-panel）
    if (window.ExMotion && !silentRefresh) await window.ExMotion.begin(path, origin, _contentPanel);

    // 5. 等 fetch 结果并注入（全屏等待 ≈ max(动画, 数据)，不再是 动画+数据）
    try {
      var resp = await fetchPromise;
      if (!resp.ok) {
        _showError("Page not found (" + resp.status + ")");
        if (window.ExMotion && !silentRefresh) window.ExMotion.reveal();
        return;
      }
      var html = await resp.text();
      _injectContent(html, path);
    } catch (e) {
      _showError("Failed to load: " + e.message);
      if (window.ExMotion && !silentRefresh) window.ExMotion.reveal();
    }
  }

  var _lastFocusRefresh = 0;
  function _refreshCurrentResourceOnFocus() {
    var path = _currentPath || window.location.pathname || "";
    if (!/^\/(experiments|analysis|analyze|favorites)(?:\/|$)/.test(path) || window._isEditing) return;
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
    history.pushState(st, "", path + (query ? "?" + query : ""));
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
    if (window.ExMotion && _contentHeader) {
      window.ExMotion.begin(_backColorPath(), _contentHeader, _contentPanel).then(function () {
        reset();
        window.ExMotion.reveal();
      });
    } else {
      reset();
    }
  }

  // 返回（非 canvas 页面，如 详情→列表）：统一播放"从顶栏展开、当前页颜色"的返回动画，
  // 动画结束后加载目标页（内部 _navigateToPath 的 begin 会被 isTransitioning 跳过，不重复播）。
  function _animateBackToPage(path, query) {
    if (window.ExMotion && _contentHeader) {
      window.ExMotion.begin(_backColorPath(), _contentHeader, _contentPanel).then(function () {
        _navigateToPath(path, query, false);
      });
    } else {
      _navigateToPath(path, query, false);
    }
  }

  // 返回：优先后退到浏览器历史上的上一步（popstate 统一恢复并负责转场动画），
  // 无可退历史或直链进入时回仪表盘（不离开应用）。
  // 注意：这里不要自行 ExMotion.begin —— popstate → _navigateToPath/reset 会配对
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
    button.addEventListener("click", onClick);
    notice.appendChild(button);
    if (_contentBody && _contentBody.parentNode) _contentBody.parentNode.insertBefore(notice, _contentBody);
  }

  function handleResourceChange(change) {
    if (!change) return;
    var path = _currentPath || window.location.pathname || "";
    if (change.resource === "categories" || change.resource === "favorites") {
      if (path === "/experiments" || path === "/favorites") {
        navigate(path);
      } else if (typeof ChatUI !== "undefined" && ChatUI.showToast) {
        ChatUI.showToast("分类或置顶状态已在另一窗口更新");
      }
      return;
    }
    if (change.resource === "analysis") {
      var analysisPath = change.anal_id ? "/analysis/" + change.anal_id : "";
      if (analysisPath && path === analysisPath && change.action !== "deleted") {
        navigate(analysisPath);
      } else if (path === "/analyze" || path === "/analysis") {
        navigate(path);
      } else if (typeof ChatUI !== "undefined" && ChatUI.showToast) {
        ChatUI.showToast("分析报告已在另一窗口" + (change.action === "deleted" ? "删除" : "更新"));
      }
      return;
    }
    if (change.resource !== "experiment" || !change.exp_id) return;
    var detailPath = "/experiments/" + change.exp_id;
    var message = "实验 " + change.exp_id + " 已在另一窗口" +
      (change.action === "deleted" ? "删除。" : "更新。");

    if (path === detailPath) {
      if (change.action !== "deleted" && !window._isEditing) {
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
    if (typeof ChatUI !== "undefined" && ChatUI.showToast) ChatUI.showToast(message);
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
    // 列表页过滤上下文（与搜索弹窗同步机制同构）；关键词仅当前页面有效。
    var si = _fragmentMount.querySelector("#search-input");
    if (si) delete state.search;
    var act = _fragmentMount.querySelector("#status-filters .filter-chip.active");
    if (act) state.status = act.dataset.status || "";
    var tags = [];
    _fragmentMount.querySelectorAll("#tag-filters .filter-chip.active").forEach(function (c) { tags.push(c.dataset.tag); });
    state.tags = tags;
    var df = _fragmentMount.querySelector("#date-from"); if (df) state.dateFrom = df.value;
    var dt = _fragmentMount.querySelector("#date-to");   if (dt) state.dateTo = dt.value;
    store[path] = state;
    _saveViewStore(store);
  }

  function _restoreViewState(path) {
    var store = _loadViewStore();
    var state = store[path];
    if (!state || !_fragmentMount) return;
    // details 展开状态（各页面通用）
    if (state.details) {
      _fragmentMount.querySelectorAll("details").forEach(function (d, i) {
        var meta = state.details[i];
        if (!meta) return;
        var s = d.querySelector("summary");
        if (!s || s.textContent.trim() === meta.key) d.open = meta.open;
      });
    }
    // 列表页过滤上下文：仅实验列表类页面恢复。
    // 旧片段脚本会把 filterExperiments 挂为全局函数，若在 analyze 等页面误调用，
    // 其内部 document.getElementById("date-from").value 会因元素缺失抛空指针。
    if (path.indexOf("/experiments") === 0) {
      var fi = _fragmentMount.querySelector("#search-input");
      var chip = _fragmentMount.querySelector('#status-filters .filter-chip[data-status="' + (state.status || "") + '"]');
      if (chip) {
        _fragmentMount.querySelectorAll("#status-filters .filter-chip").forEach(function (c) {
          c.classList.toggle("active", c === chip);
        });
        chip.dispatchEvent(new Event("click"));
      }
      (state.tags || []).forEach(function (t) {
        var c = _fragmentMount.querySelector('#tag-filters .filter-chip[data-tag="' + t + '"]');
        if (c) { c.classList.add("active"); c.dispatchEvent(new Event("click")); }
      });
      var df = _fragmentMount.querySelector("#date-from");
      if (df && state.dateFrom) { df.value = state.dateFrom; df.dispatchEvent(new Event("change")); }
      var dt = _fragmentMount.querySelector("#date-to");
      if (dt && state.dateTo)   { dt.value = state.dateTo;   dt.dispatchEvent(new Event("change")); }
      if (typeof filterExperiments === "function") filterExperiments();
    }
    // 滚动位置：内容常是异步渲染的（列表/分析页 fetch 后才有高度），
    // 单次设置会因页面还矮而失效 —— 持续重试直到达到目标或内容确实不够长
    requestAnimationFrame(function () {
      if (!_fragmentMount) return;
      var target = state.scroll || 0;
      var tries = 0;
      (function retryScroll() {
        if (!_fragmentMount) return;
        var max = _fragmentMount.scrollHeight || 0;
        _fragmentMount.scrollTop = Math.min(target, max);
        tries++;
        if (tries < 10 && max > 0 && Math.abs(_fragmentMount.scrollTop - target) > 2) {
          setTimeout(retryScroll, 120);
        }
      })();
    });
  }

  function _injectContent(html, path) {
    if (!_fragmentMount) return;

    document.querySelectorAll(".pane-scoped-modal").forEach(function (modal) {
      modal.remove();
    });

    // 替换前保存当前视图状态（滚动/展开/过滤上下文）
    _saveViewState(_currentPath);

    // 隐藏 canvas，显示片段挂载点
    if (_canvasContainer) _canvasContainer.style.display = "none";
    _fragmentMount.style.display = "";
    _currentView = "content";

    // 清理旧内容
    _fragmentMount.innerHTML = "";

    // 注入新 HTML
    _fragmentMount.innerHTML = '<div class="fragment-content">' + html + '</div>';
    _currentPath = path;

    // 初始化页面特定功能
    _initPageScripts(_fragmentMount, path);
    if (window.ExMotion) {
      window.ExMotion.enter(_fragmentMount);
      window.ExMotion.reveal();
    }

    // 返回按钮显隐 + 面包屑（由导航栈状态决定，而非无条件显示）
    _updateBackUI();

    // 滚动到顶部
    _fragmentMount.scrollTop = 0;

    // 恢复本路径上次的视图状态（详情展开、过滤、滚动位置）
    _restoreViewState(path);
  }

  function _initPageScripts(container, path) {
    // 1. 渲染 Markdown
    if (typeof marked !== "undefined") {
      container.querySelectorAll(".markdown-content:not([data-rendered])").forEach(function (el) {
        el.innerHTML = marked.parse(el.textContent);
        el.dataset.rendered = "1";
      });
    }

    // 2. 初始化 edit-mode（SVG 虚线框）
    if (typeof addDashSVG === "function") {
      container.querySelectorAll(".editable-dashed").forEach(function (el) {
        addDashSVG(el);
      });
    }

    // 3. 清理 SOP/Next-steps 序号前缀
    if (typeof cleanupSopPrefixes === "function") cleanupSopPrefixes(container);

    // 4. 执行页面内联 <script> 标签
    container.querySelectorAll("script").forEach(function (oldScript) {
      var newScript = document.createElement("script");
      if (oldScript.src) {
        newScript.src = oldScript.src;
      } else {
        newScript.textContent = oldScript.textContent;
      }
      oldScript.replaceWith(newScript);
    });

    if (path === "/settings" && window.ExdiarySound) window.ExdiarySound.bindSettings(container);

    // 5. 页面特定初始化
    if (path === "/experiments" || path === "/experiments/") {
      _initExperimentsPage(container);
    }
  }

  function _initExperimentsPage(container) {
    // experiments.html 的 JS 通过内联 <script> 执行
    // 这里不需要额外初始化
  }

  function _showError(msg) {
    if (!_fragmentMount) return;
    if (_canvasContainer) _canvasContainer.style.display = "none";
    _fragmentMount.style.display = "";
    _currentView = "content";
    _fragmentMount.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;height:100%;text-align:center;opacity:0.5">' +
      '<div><h3 style="font-weight:700;letter-spacing:2px">加载失败</h3>' +
      '<p style="font-size:0.85rem">' + escHtml(msg) + '</p></div></div>';
  }

  function reset() {
    _currentView = "canvas";
    // 离开前保存当前页面状态（滚动/过滤/展开），返回仪表盘后再进入仍可恢复
    if (_fragmentMount && _currentPath && _currentPath !== "/" &&
        _currentPath !== "/ai-shell/" && _currentPath !== "/ai-shell") {
      _saveViewState(_currentPath);
    }
    _currentPath = "/";
    _currentTitle = "";
    if (_fragmentMount) { _fragmentMount.style.display = "none"; _fragmentMount.innerHTML = ""; }
    if (_canvasContainer) {
      _canvasContainer.style.display = "";
      requestAnimationFrame(function () {
        resizeCanvas();
        _canvasResetCache();
      });
    }
    // 仅当 URL 不在根时才 push 根状态 —— 避免历史栈堆积重复的 "/"
    if (window.location.pathname !== "/") _pushState("/", "", null);
    _updateContentHeader("", "");
    _updateHeaderMenu();
    _updateBackUI();
    if (_contentTitle) _contentTitle.textContent = "";
    if (!_canvasRunning) {
      _canvasRunning = true;
      render();
    }
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
      visible = window.location.pathname === "/experiments";
    }
    wrap.classList.toggle("visible", !!visible);
  }

  function _initHeaderMenu() {
    var btn = document.getElementById("content-header-menu-btn");
    var dd = document.getElementById("content-header-menu-dd");
    if (!btn || !dd) return;

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      dd.style.display = dd.style.display === "block" ? "none" : "block";
    });

    document.addEventListener("click", function (e) {
      if (!e.target.closest("#content-header-menu-wrap")) dd.style.display = "none";
    });

    dd.querySelectorAll(".menu-item").forEach(function (item) {
      item.addEventListener("click", function () {
        dd.style.display = "none";
        var action = this.dataset.action;
        if (action === "search") _openSearchPopup();
        else if (action === "categories" || action === "filters") _openPanelPopup(action);
        else if (action === "compare") _toggleCompareFromMenu();
      });
      item.addEventListener("mouseenter", function () { this.style.background = "var(--black)"; this.style.color = "var(--white)"; });
      item.addEventListener("mouseleave", function () { this.style.background = ""; this.style.color = "var(--black)"; });
    });
  }

  // ---- Search Popup ----

  function _openSearchPopup() {
    // 移除旧弹窗
    var old = document.getElementById("shell-search-popup");
    if (old) old.remove();

    var overlay = document.createElement("div");
    overlay.id = "shell-search-popup";
    overlay.style.cssText = "position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center";
    overlay.addEventListener("click", function (e) { if (e.target === overlay) overlay.remove(); });

    var box = document.createElement("div");
    box.style.cssText = "background:var(--white);border:4px solid var(--black);box-shadow:var(--shadow);padding:1.2rem;width:min(420px,90vw);max-height:80vh;overflow-y:auto";

    box.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.8rem">' +
        '<span style="font-weight:700;font-size:0.9rem;letter-spacing:1px">搜索与筛选</span>' +
        '<button onclick="this.closest(\'#shell-search-popup\').remove()" style="background:none;border:none;cursor:pointer;font-size:1.3rem;font-weight:700;line-height:1;padding:0;font-family:inherit">&times;</button>' +
      '</div>' +
      '<input type="search" id="shell-search-input" placeholder="搜索实验记录…" autocomplete="off" style="width:100%;margin-bottom:0.6rem;font-size:0.9rem;padding:0.5rem 0.7rem;border:3px solid var(--black)">' +
      '<div id="shell-status-filters" style="display:flex;gap:0.3rem;flex-wrap:wrap;margin-bottom:0.6rem">' +
        '<span class="filter-chip active" data-status="">全部</span>' +
        '<span class="filter-chip" data-status="done">已完成</span>' +
        '<span class="filter-chip" data-status="planned">计划中</span>' +
        '<span class="filter-chip" data-status="running">进行中</span>' +
        '<span class="filter-chip" data-status="failed">失败</span>' +
        '<span class="filter-chip" data-status="repeated">复刻</span>' +
      '</div>' +
      '<details style="margin-top:0.3rem">' +
        '<summary style="font-weight:700;font-size:0.78rem;cursor:pointer;letter-spacing:1px;opacity:0.6">高级筛选</summary>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.8rem;margin-top:0.5rem;padding:0.6rem;border:2px solid var(--black);background:var(--off-white)">' +
          '<div><label style="font-size:0.72rem;font-weight:700;display:block;margin-bottom:0.2rem">标签</label>' +
            '<div id="shell-tag-filters" style="display:flex;flex-wrap:wrap;gap:0.2rem"></div></div>' +
          '<div><label style="font-size:0.72rem;font-weight:700;display:block;margin-bottom:0.2rem">日期范围</label>' +
            '<div style="display:flex;gap:0.3rem;align-items:center;flex-wrap:wrap">' +
              '<input type="date" id="shell-date-from" style="width:auto;font-size:0.78rem">' +
              '<span style="font-weight:700">~</span>' +
              '<input type="date" id="shell-date-to" style="width:auto;font-size:0.78rem">' +
            '</div></div>' +
        '</div>' +
      '</details>' +
      '<div style="display:flex;gap:0.5rem;justify-content:flex-end;margin-top:1rem">' +
        '<button class="outline" style="font-size:0.75rem;padding:0.3rem 0.8rem" onclick="_clearSearchPopup()">清除</button>' +
        '<button style="font-size:0.75rem;padding:0.3rem 0.8rem" onclick="document.getElementById(\'shell-search-popup\').remove()">完成</button>' +
      '</div>';

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    // 从 fragment 中读取当前过滤状态并同步到弹窗
    _syncFiltersFromFragment();

    // 绑定事件：弹窗中的过滤变化实时同步到 fragment
    var searchInput = document.getElementById("shell-search-input");
    if (searchInput) searchInput.addEventListener("input", _syncFiltersToFragment);

    document.querySelectorAll("#shell-status-filters .filter-chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        document.querySelectorAll("#shell-status-filters .filter-chip").forEach(function (c) { c.classList.remove("active"); });
        this.classList.add("active");
        _syncFiltersToFragment();
      });
    });

    var df = document.getElementById("shell-date-from");
    var dt = document.getElementById("shell-date-to");
    if (df) df.addEventListener("change", _syncFiltersToFragment);
    if (dt) dt.addEventListener("change", _syncFiltersToFragment);

    // 加载标签
    _loadTagsForPopup();

    searchInput.focus();
  }

  function _loadTagsForPopup() {
    fetch("/api/experiments/search")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var tagSet = {};
        data.forEach(function (exp) { (exp.tags || []).forEach(function (t) { tagSet[t] = true; }); });
        var container = document.getElementById("shell-tag-filters");
        if (!container) return;
        container.innerHTML = "";
        Object.keys(tagSet).sort().forEach(function (tag) {
          var chip = document.createElement("span");
          chip.className = "filter-chip";
          chip.textContent = tag;
          chip.dataset.tag = tag;
          chip.addEventListener("click", function () { this.classList.toggle("active"); _syncFiltersToFragment(); });
          container.appendChild(chip);
        });
      });
  }

  function _syncFiltersFromFragment() {
    // 从 fragment 的 hidden desktop-only 区域读取当前过滤状态
    var fragDoc = _fragmentMount || document;
    var fi = fragDoc.querySelector("#search-input");
    var si = document.getElementById("shell-search-input");
    if (fi && si) si.value = fi.value;
  }

  function _syncFiltersToFragment() {
    // 将弹窗中的过滤状态同步到 fragment 的隐藏元素，然后触发过滤
    var fragDoc = _fragmentMount || document;
    var si = document.getElementById("shell-search-input");
    var fi = fragDoc.querySelector("#search-input");
    if (si && fi) {
      fi.value = si.value;
      fi.dispatchEvent(new Event("input"));
    }

    // 同步状态过滤
    var activeChip = document.querySelector("#shell-status-filters .filter-chip.active");
    var statusVal = activeChip ? activeChip.dataset.status : "";
    fragDoc.querySelectorAll("#status-filters .filter-chip").forEach(function (c) {
      c.classList.toggle("active", c.dataset.status === statusVal);
    });

    // 同步日期
    var sdf = document.getElementById("shell-date-from");
    var sdt = document.getElementById("shell-date-to");
    var fdf = fragDoc.querySelector("#date-from");
    var fdt = fragDoc.querySelector("#date-to");
    if (sdf && fdf) { fdf.value = sdf.value; fdf.dispatchEvent(new Event("change")); }
    if (sdt && fdt) { fdt.value = sdt.value; fdt.dispatchEvent(new Event("change")); }

    // 同步标签
    var activeTags = [];
    document.querySelectorAll("#shell-tag-filters .filter-chip.active").forEach(function (c) { activeTags.push(c.dataset.tag.toLowerCase()); });
    fragDoc.querySelectorAll("#tag-filters .filter-chip").forEach(function (c) {
      c.classList.toggle("active", activeTags.indexOf(c.dataset.tag.toLowerCase()) !== -1);
    });

    // 触发 fragment 的过滤函数
    if (typeof filterExperiments === "function") filterExperiments();
  }

  function _clearSearchPopup() {
    var si = document.getElementById("shell-search-input");
    if (si) si.value = "";
    document.querySelectorAll("#shell-status-filters .filter-chip").forEach(function (c) { c.classList.remove("active"); });
    var allChip = document.querySelector('#shell-status-filters .filter-chip[data-status=""]');
    if (allChip) allChip.classList.add("active");
    document.querySelectorAll("#shell-tag-filters .filter-chip.active").forEach(function (c) { c.classList.remove("active"); });
    var df = document.getElementById("shell-date-from"); if (df) df.value = "";
    var dt = document.getElementById("shell-date-to"); if (dt) dt.value = "";
    _syncFiltersToFragment();
  }

  // ---- Compare Mode ----

  function _toggleCompareFromMenu() {
    _openPanelPopup("compare");
  }

  // ---- Panel Popup（Categories / Filters / Compare 悬浮窗） ----
  // 将 fragment 里的工具面板移入浮层显示（交互绑定保留在元素上），关闭时移回原位。

  var _panelPopupState = null;   // {panel, parent, next, wasActive}

  function _openPanelPopup(name) {
    // 竖屏下 Compare 不在弹窗中进行：直接进入页面内对比选择 + 顶部状态栏
    if (name === "compare" && window.innerWidth <= 720) {
      _closePanelPopup();
      if (typeof window.enterCompareMode === "function") window.enterCompareMode();
      _showCompareBar();
      return;
    }

    var fragDoc = _fragmentMount || document;
    var panel = fragDoc.querySelector("#panel-" + name);
    if (!panel) return;
    if (_panelPopupState && _panelPopupState.panel === panel) return;   // 同一面板已打开
    _closePanelPopup();

    var titles = { categories: "Categories", filters: "Filters", compare: "Compare" };
    _panelPopupState = {
      panel: panel,
      parent: panel.parentNode,
      next: panel.nextSibling,
      wasActive: panel.classList.contains("active")
    };

    var overlay = document.createElement("div");
    overlay.id = "shell-panel-popup";
    overlay.style.cssText = "position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center";
    overlay.addEventListener("click", function (e) { if (e.target === overlay) _closePanelPopup(); });

    var box = document.createElement("div");
    box.style.cssText = "background:var(--white);border:4px solid var(--black);box-shadow:var(--shadow);width:min(440px,92vw);max-height:80vh;overflow-y:auto";

    var header = document.createElement("div");
    header.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:0.6rem 1rem;background:var(--black);color:var(--white);font-weight:700;font-size:0.82rem;letter-spacing:1px;text-transform:uppercase";
    var closeBtn = document.createElement("button");
    closeBtn.style.cssText = "background:none;border:none;color:var(--white);cursor:pointer;font-size:1.2rem;font-weight:700;line-height:1;padding:0;font-family:inherit";
    closeBtn.innerHTML = "&times;";
    closeBtn.addEventListener("click", _closePanelPopup);
    header.appendChild(document.createTextNode(titles[name] || name));
    header.appendChild(closeBtn);
    box.appendChild(header);

    box.appendChild(panel);
    panel.classList.add("active");
    panel.style.display = "block";   // 覆盖竖屏媒体查询对 .tool-panel 的隐藏
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    if (name === "compare") {
      if (typeof window.enterCompareMode === "function") window.enterCompareMode();
      _buildComparePopupList(box);
    }
  }

  // 竖屏对比弹窗：把主内容区的实验卡片渲染成可勾选列表，避免"弹窗盖住卡片无法勾选"
  function _buildComparePopupList(box) {
    var fragDoc = _fragmentMount || document;
    var cards = fragDoc.querySelectorAll(".record-card");
    var list = document.createElement("div");
    list.style.cssText = "padding:0.8rem;display:flex;flex-direction:column;gap:0.4rem;max-height:50vh;overflow-y:auto;border-top:4px solid var(--black)";
    if (!cards.length) {
      list.innerHTML = '<div style="padding:0.5rem;font-size:0.8rem;font-weight:700;opacity:0.5">No experiments to compare</div>';
    } else {
      cards.forEach(function (card) {
        var id = card.dataset.expId;
        var t = card.querySelector(".content-title");
        var title = t ? t.textContent : id;
        var label = document.createElement("label");
        label.style.cssText = "display:flex;align-items:center;gap:0.5rem;border:2px solid var(--black);padding:0.3rem 0.5rem;cursor:pointer;font-weight:700;font-size:0.8rem";
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.style.cssText = "width:16px;height:16px;accent-color:var(--red);flex:none";
        cb.checked = !!(window.compareApi && window.compareApi.isSelected(id));
        cb.addEventListener("change", function () {
          if (window.compareApi && !window.compareApi.toggle(id)) cb.checked = false;  // 超过 4 个回退
        });
        var span = document.createElement("span");
        span.textContent = id + " · " + title;
        label.appendChild(cb);
        label.appendChild(span);
        list.appendChild(label);
      });
    }
    box.appendChild(list);
  }

  // 竖屏对比：页面顶部吸顶状态栏（已选数量 + Start Compare + 取消）
  var _compareBar = null;
  function _showCompareBar() {
    _hideCompareBar();
    var mount = _fragmentMount;
    if (!mount) return;
    var bar = document.createElement("div");
    bar.id = "compare-bar";
    bar.style.cssText = "position:sticky;top:0;z-index:50;background:var(--yellow);border-bottom:4px solid var(--black);padding:0.45rem 0.9rem;display:flex;align-items:center;gap:0.6rem;font-weight:900;font-size:0.8rem;letter-spacing:0.5px";
    var count = document.createElement("span");
    count.style.cssText = "flex:1";
    count.textContent = "已选择 0 / 需 2";
    var goBtn = document.createElement("button");
    goBtn.className = "outline";
    goBtn.textContent = "Start Compare";
    goBtn.disabled = true;
    goBtn.addEventListener("click", function () { if (window.compareApi) window.compareApi.go(); });
    var cancelBtn = document.createElement("button");
    cancelBtn.className = "outline secondary";
    cancelBtn.textContent = "取消";
    cancelBtn.addEventListener("click", _hideCompareBar);
    bar.appendChild(count);
    bar.appendChild(goBtn);
    bar.appendChild(cancelBtn);
    mount.insertBefore(bar, mount.firstChild);
    _compareBar = bar;
    // 注册更新钩子：勾选变化时实时刷新状态栏
    window.onCompareBarUpdate = function (n) {
      count.textContent = n < 2 ? "已选择 " + n + " / 需 2" : "已选择 " + n + " experiments";
      goBtn.disabled = n < 2;
    };
    if (window.compareApi && window.compareApi.getCount) window.onCompareBarUpdate(window.compareApi.getCount());
  }
  function _hideCompareBar() {
    window.onCompareBarUpdate = null;
    if (_compareBar) { _compareBar.remove(); _compareBar = null; }
    if (window.compareApi && window.compareApi.exit) window.compareApi.exit();
  }

  function _closePanelPopup() {
    var s = _panelPopupState;
    if (!s) return;
    var wasCompare = !!(s.panel && s.panel.id === "panel-compare");
    var overlay = document.getElementById("shell-panel-popup");
    if (overlay) overlay.remove();
    if (s.parent) {
      if (s.next && s.next.parentNode === s.parent) s.parent.insertBefore(s.panel, s.next);
      else s.parent.appendChild(s.panel);
    }
    s.panel.style.display = "";
    if (!s.wasActive) s.panel.classList.remove("active");
    _panelPopupState = null;
    // 关闭对比弹窗时必须退出对比模式，否则 compareMode 卡 true，
    // 会导致视图切换（索引行/卡片）被拦、卡片点击变成勾选而非跳转
    if (wasCompare && window.compareApi && window.compareApi.exit) window.compareApi.exit();
  }

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

  // ---- Canvas Click ----

  function handleCanvasClick(e) {
    if (!_canvasEl || _canvasDrag.moved) return;
    var rect = _canvasEl.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    var clickX = (e.clientX - rect.left) * (_canvasEl.width / dpr / rect.width);
    var clickY = (e.clientY - rect.top) * (_canvasEl.height / dpr / rect.height);

    for (var chunks of activeChunks.values()) {
      for (var i = 0; i < chunks.length; i++) {
        var r = chunks[i];
        var drawX = r.x - camera.x;
        var drawY = r.y - camera.y;
        var thH = 0.5 + r.w * 0.03;
        var thV = 0.5 + r.h * 0.03;
        var insetX = thV / 2;
        var insetY = thH / 2;
        var z = _zoom();
        var sx = (drawX + insetX) * z;
        var sy = (drawY + insetY) * z;
        var sw = (r.w - insetX * 2) * z;
        var sh = (r.h - insetY * 2) * z;

        if (clickX >= sx && clickX <= sx + sw && clickY >= sy && clickY <= sy + sh) {
          if (r.route) {
            var routeToUrl = {
              "new": "/new",
              "experiments": "/experiments",
              "analyze": "/analyze",
              // 黄/蓝色块尚未开放，保留在 Canvas 中但不响应跳转。
            };
            var url = routeToUrl[r.route];
            if (url) navigate(url, e);
          }
          return;
        }
      }
    }
  }

  // ---- Divider Drag Resize ----

  var _isDragging = false;
  var _dragSource = null;
  var _dragStartY = 0;
  var _dragStartPanelH = 0;
  var CHAT_MIN_WIDTH = 360;
  var MIN_PANEL_WIDTH = 200;
  var _chatWidth = 0;
  var _mobilePanelH = 0;

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

    // Desktop divider
    divider.addEventListener("mousedown", function (e) {
      if (window.innerWidth <= 600) return;
      e.preventDefault();
      _isDragging = true;
      _dragSource = "divider";
      divider.classList.add("dragging");
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    });

    divider.addEventListener("touchstart", function (e) {
      if (window.innerWidth <= 600) return;
      e.preventDefault();
      _isDragging = true;
      _dragSource = "divider";
      divider.classList.add("dragging");
    });

    // Mobile divider
    divider.addEventListener("mousedown", function (e) {
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

    divider.addEventListener("touchstart", function (e) {
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
    window.addEventListener("mousemove", function (e) {
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
      if (_currentView === "canvas") { resizeCanvas(); activeChunks.clear(); }
    });

    window.addEventListener("touchmove", function (e) {
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
      if (_currentView === "canvas") { resizeCanvas(); activeChunks.clear(); }
    });

    // Release
    window.addEventListener("mouseup", function () {
      if (!_isDragging) return;
      _isDragging = false;
      var div = document.getElementById("divider");
      if (div) div.classList.remove("dragging");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (_dragSource === "divider-mobile") _maybeCollapseChat();
      _dragSource = null;
      saveSizes();
      if (_currentView === "canvas") { resizeCanvas(); activeChunks.clear(); }
    });

    window.addEventListener("touchend", function () {
      if (!_isDragging) return;
      _isDragging = false;
      var div = document.getElementById("divider");
      if (div) div.classList.remove("dragging");
      if (_dragSource === "divider-mobile") _maybeCollapseChat();
      _dragSource = null;
      saveSizes();
      if (_currentView === "canvas") { resizeCanvas(); activeChunks.clear(); }
    });

    // Window resize — 检测横竖屏模式切换
    var _lastIsDesktop = window.innerWidth > 600;
    window.addEventListener("resize", function () {
      var isDesktop = window.innerWidth > 600;
      if (isDesktop !== _lastIsDesktop) {
        // 模式切换：清理内联样式，让 CSS 媒体查询重新接管
        _clearInlineStylesForModeSwitch();
        _lastIsDesktop = isDesktop;
        // 重新渲染当前页面的 header 颜色
        if (_currentView === "content") {
          var path = window.location.pathname;
          var matched = _matchRoute(path);
          if (matched) _updateContentHeader(matched.route.color, matched.route.title);
          _updateHeaderMenu();
        }
      }
      if (isDesktop) {
        enforceChatMinWidth();
      } else {
        if (!_mobilePanelH) _mobilePanelH = Math.round(window.innerHeight / 3);
        applySizes();
      }
      if (_currentView === "canvas") { resizeCanvas(); activeChunks.clear(); }
    });
    window.addEventListener("focus", _refreshCurrentResourceOnFocus);
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
    var title = (_contentTitle && _contentTitle.textContent) || "Panel";
    btn.title = "Restore " + title;
  }

  function _resetToDefaultRatio() {
    _mobilePanelH = Math.round(window.innerHeight / 3);
    applySizes();
    saveSizes();
    if (_currentView === "canvas") {
      requestAnimationFrame(function () {
        resizeCanvas();
        activeChunks.clear();
      });
    }
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

  // ---- Canvas Engine ----

  function resizeCanvas() {
    if (!_canvasEl || !_canvasContainer) return;
    var rect = _canvasContainer.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    var dpr = window.devicePixelRatio || 1;
    _canvasEl.width = rect.width * dpr;
    _canvasEl.height = rect.height * dpr;
    _canvasEl.style.width = rect.width + "px";
    _canvasEl.style.height = rect.height + "px";
    if (_ctx) { _ctx.setTransform(1, 0, 0, 1, 0, 0); _ctx.scale(dpr, dpr); }
  }

  function _canvasResetCache() {
    activeChunks.clear();
    hoverRect = null;
    if (_hoverTipEl) _hoverTipEl.style.display = "none";
  }

  function pseudoRandom(seed) { var x = Math.sin(seed++) * 10000; return x - Math.floor(x); }

  function areAdjacent(r1, r2) {
    var eps = 0.5;
    var touchLeft = Math.abs(r1.x - (r2.x + r2.w)) < eps;
    var touchRight = Math.abs(r1.x + r1.w - r2.x) < eps;
    var touchTop = Math.abs(r1.y - (r2.y + r2.h)) < eps;
    var touchBottom = Math.abs(r1.y + r1.h - r2.y) < eps;
    var overlapX = r1.x < r2.x + r2.w - eps && r1.x + r1.w > r2.x + eps;
    var overlapY = r1.y < r2.y + r2.h - eps && r1.y + r1.h > r2.y + eps;
    return ((touchLeft || touchRight) && overlapY) || ((touchTop || touchBottom) && overlapX);
  }

  function getColorByArea(area, seed, forbiddenColors, m) {
    var chunkArea = CHUNK_SIZE * CHUNK_SIZE;
    var ratio = area / chunkArea;
    var weights = { "#FFFFFF": 0, "#E32636": 0, "#1D54A6": 0, "#F8D030": 0 };
    if (ratio > 0.18) {
      weights["#FFFFFF"] = 65; weights["#E32636"] = 25; weights["#1D54A6"] = 2; weights["#F8D030"] = 8;
    } else if (ratio > 0.05) {
      weights["#FFFFFF"] = 15; weights["#E32636"] = 30; weights["#1D54A6"] = 15; weights["#F8D030"] = 40;
    } else {
      weights["#FFFFFF"] = 2; weights["#E32636"] = 15; weights["#1D54A6"] = 45; weights["#F8D030"] = 38;
    }
    /* 模式反馈：record 黄权重提升、analyze 红权重提升 */
    if (m === "record") { weights["#F8D030"] *= 1.8; weights["#E32636"] *= 0.6; }
    if (m === "analyze") { weights["#E32636"] *= 1.7; weights["#F8D030"] *= 0.6; }
    forbiddenColors.forEach(function (c) { if (weights[c] !== undefined) weights[c] = 0; });
    var total = 0;
    for (var k in weights) total += weights[k];
    if (total <= 0) return "#FFFFFF";
    var r2 = pseudoRandom(seed) * total;
    for (k in weights) { r2 -= weights[k]; if (r2 <= 0) return k; }
    return "#FFFFFF";
  }

  function generateChunk(cx, cy, activeChunksMap) {
    var seed = cx * 73856.093 + cy * 19349.663;
    var rects = [{ x: cx * CHUNK_SIZE, y: cy * CHUNK_SIZE, w: CHUNK_SIZE, h: CHUNK_SIZE }];
    var iterations = 9 + Math.floor(pseudoRandom(seed++) * 5);
    for (var i = 0; i < iterations; i++) {
      rects.sort(function (a, b) { return b.w * b.h - a.w * a.h; });
      var targetIdx = 0;
      if (rects.length > 1 && pseudoRandom(seed++) > 0.65) targetIdx = Math.floor(pseudoRandom(seed++) * rects.length);
      var target = rects[targetIdx];
      var splitH = target.w > target.h;
      var minRatio, maxRatio;
      if (splitH) {
        minRatio = Math.max(0.35 * target.h / target.w, 1 - 2.5 * target.h / target.w);
        maxRatio = Math.min(2.5 * target.h / target.w, 1 - 0.35 * target.h / target.w);
      } else {
        minRatio = Math.max(0.35 * target.w / target.h, 1 - 2.5 * target.w / target.h);
        maxRatio = Math.min(2.5 * target.w / target.h, 1 - 0.35 * target.w / target.h);
      }
      minRatio = Math.max(0.1, minRatio); maxRatio = Math.min(0.9, maxRatio);
      var ratio;
      if (minRatio <= maxRatio) { ratio = minRatio + pseudoRandom(seed++) * (maxRatio - minRatio); }
      else { ratio = 0.5; seed++; }
      var r1, r2_local, minSize = 18;
      if (splitH) {
        var w1 = target.w * ratio;
        if (w1 < minSize || target.w - w1 < minSize) continue;
        r1 = { x: target.x, y: target.y, w: w1, h: target.h };
        r2_local = { x: target.x + w1, y: target.y, w: target.w - w1, h: target.h };
      } else {
        var h1 = target.h * ratio;
        if (h1 < minSize || target.h - h1 < minSize) continue;
        r1 = { x: target.x, y: target.y, w: target.w, h: h1 };
        r2_local = { x: target.x, y: target.y + h1, w: target.w, h: target.h - h1 };
      }
      rects.splice(targetIdx, 1); rects.push(r1, r2_local);
    }
    var neighborRects = [];
    for (var dx = -1; dx <= 1; dx++) {
      for (var dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        var key = (cx + dx) + "," + (cy + dy);
        if (activeChunksMap.has(key)) neighborRects = neighborRects.concat(activeChunksMap.get(key));
      }
    }
    rects.sort(function (a, b) { return b.w * b.h - a.w * a.h; });
    for (var j = 0; j < rects.length; j++) {
      var rect = rects[j];
      var cacheKey = rect.x + "," + rect.y + "," + rect.w + "," + rect.h;
      var cached = _colorCache.get(cacheKey);
      if (cached) {
        rect.color = cached.color;
        rect.route = cached.route;
      } else {
        var forbiddenColors = [];
        for (var k = 0; k < j; k++) { if (areAdjacent(rect, rects[k])) forbiddenColors.push(rects[k].color); }
        for (var ni = 0; ni < neighborRects.length; ni++) { if (areAdjacent(rect, neighborRects[ni])) forbiddenColors.push(neighborRects[ni].color); }
        rect.color = getColorByArea(rect.w * rect.h, seed++, forbiddenColors, _canvasMode);
        rect.route = routeForColor(rect.color);
        _colorCache.set(cacheKey, { color: rect.color, route: rect.route });
      }
    }
    return rects;
  }

  function routeForColor(c) {
    if (c === "#FFFFFF") return "experiments";
    if (c === "#E32636") return "analyze";
    if (c === "#F8D030") return "favorites";
    return "timeline";
  }

  /* 中部数据文案（敬请期待色块不显示数据） */
  function subtitleFor(route) {
    if (route === "experiments") return _stats.total + " 条实验";
    if (route === "favorites" || route === "timeline") return null;
    if (route === "analyze") return _stats.analysis + " 份分析";
    return null;
  }

  function routeDesc(route) {
    if (route === "experiments") return "实验列表（" + _stats.unfinished + " 个未完成）";
    if (route === "favorites" || route === "timeline") return "敬请期待";
    if (route === "analyze") return "分析中心";
    return "";
  }

  /* 文字呼吸节奏（与模式联动） */
  function modePulse() {
    if (_canvasMode === "record") return { amp: 0.12, omega: 4.2 };
    if (_canvasMode === "analyze") return { amp: 0.06, omega: 2.0 };
    return { amp: 0, omega: 1 };
  }

  function modeParams() {
    if (_canvasMode === "record") return { speed: 0.45, veil: "rgba(248,208,48,0.05)" };
    if (_canvasMode === "analyze") return { speed: 0.12, veil: "rgba(227,38,54,0.045)" };
    return { speed: 0.25, veil: null };
  }

  /* 便签板：数据感知 + 导航图例 + 模式状态 */
  function renderNote() {
    if (!_agentTipEl) return;
    var ml = {
      free: ["Free", "自由对话"],
      record: ["Recording", "记录中 · 黄色区块增加"],
      analyze: ["Analyzing", "分析中 · 红色区块增加"]
    }[_canvasMode];
    var nb = document.getElementById("nb-body");
    var dateEl = document.getElementById("nb-date");
    if (dateEl) {
      var d = new Date();
      var days = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
      dateEl.textContent = d.getFullYear() + "." + ("0"+(d.getMonth()+1)).slice(-2) + "." + ("0"+d.getDate()).slice(-2) + " " + days[d.getDay()];
    }
    if (!nb) return;
    nb.innerHTML =
      '<div class="nb-row"><span class="nb-k">数据</span><span class="nb-v">' +
        '<b>' + _stats.unfinished + '</b> 个实验未完成 · 距上次记录 <b>' + _stats.lastRecordDays + '</b> 天 · 共 <b>' + _stats.total + '</b> 条' +
      '</span></div>' +
      '<div class="nb-row nb-legend"><span class="nb-k">导航</span><span class="nb-v">' +
        '<span class="sw sw-exp"></span>实验<span class="sw sw-ana"></span>分析<span class="sw sw-fav"></span>收藏<span class="sw sw-tl"></span>时间线' +
      '</span></div>' +
      '<div class="nb-row"><span class="nb-k">状态</span><span class="nb-v">' + ml[0] + ' — ' + ml[1] + '</span></div>';
  }

  /* 数据加载：实验总数/未完成/间隔 + 分析数 + 收藏数 */
  function _loadStats() {
    try {
      fetch("/api/experiments/search")
        .then(function (r) { return r.json(); })
        .then(function (list) {
          if (!list || !list.length) return;
          _stats.total = list.length;
          _stats.unfinished = list.filter(function (e) { return e.status && e.status !== "done"; }).length;
          var maxDate = null;
          list.forEach(function (e) {
            if (!e.date) return;
            var t = new Date(e.date).getTime();
            if (!isNaN(t) && (!maxDate || t > maxDate)) maxDate = t;
          });
          if (maxDate) {
            var days = Math.floor((Date.now() - maxDate) / 86400000);
            _stats.lastRecordDays = Math.max(0, days);
          }
          renderNote();
        }).catch(function () {});
    } catch (e) {}
    try {
      fetch("/api/analysis-history")
        .then(function (r) { return r.json(); })
        .then(function (list) {
          if (list) _stats.analysis = list.length;
          renderNote();
        }).catch(function () {});
    } catch (e) {}
    try {
      fetch("/api/list-collections")
        .then(function (r) { return r.json(); })
        .then(function (collections) {
          if (collections) {
            var n = 0;
            for (var k in collections) n += (collections[k] || []).length;
            _stats.favorites = n;
          }
          renderNote();
        }).catch(function () {});
    } catch (e) {}
  }

  /* 视口内每个 route 的最大块（Agent 联动动画锚点） */
  function biggestPerRoute(viewX0, viewY0, viewX1, viewY1) {
    var best = {};
    activeChunks.forEach(function (rects) {
      rects.forEach(function (r) {
        if (r.x + r.w < viewX0 || r.x > viewX1 || r.y + r.h < viewY0 || r.y > viewY1) return;
        var b = best[r.route];
        if (!b || r.w * r.h > b.w * b.h) best[r.route] = r;
      });
    });
    return best;
  }

  /* hover/点击命中检测 */
  function pickRect(wx, wy) {
    for (var chunks of activeChunks.values()) {
      for (var i = 0; i < chunks.length; i++) {
        var r = chunks[i];
        if (wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h) return r;
      }
    }
    return null;
  }

  function _screenToWorld(e) {
    var rect = _canvasEl.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    var x = (e.clientX - rect.left) * (_canvasEl.width / dpr / rect.width);
    var y = (e.clientY - rect.top) * (_canvasEl.height / dpr / rect.height);
    return { wx: x / _zoom() + camera.x, wy: y / _zoom() + camera.y };
  }

  /* 海报式三层排版：左下中文主字 + 数据小字 + 右上英文标题 + 印章方块 */
  function drawTitle(g, rect, opts) {
    opts = opts || {};
    var title = ROUTE_TITLES[rect.route];
    if (!title) return;
    var rw = rect.w, rh = rect.h;
    var vertical = rh > rw;
    var area = rw * rh;
    var fontSize;
    if (opts.fontSize) { fontSize = opts.fontSize; }
    else {
      if (area < 5000) { fontSize = 9 + (area - 2000) * 3 / 3000; }
      else if (area < 10000) { fontSize = 12 + (area - 5000) * 4 / 5000; }
      else if (area < 16000) { fontSize = 16 + (area - 10000) * 5 / 6000; }
      else { fontSize = 21 + (area - 16000) * 5 / 6400; }
      if (vertical) { fontSize = Math.min(fontSize, rw - 4, (rh - 4) / title.length - 1); }
      else { fontSize = Math.min(fontSize, rh - 4, (rw - 4) / title.length); }
    }
    fontSize = Math.max(6, fontSize);
    var isDark = rect.color !== "#FFFFFF";
    var alphaMul = opts.alphaMul !== undefined ? opts.alphaMul : 1;
    var baseA = isDark ? 0.95 : 0.92;
    /* ── 主字：海报主标题（字重 900 + 1.25× 字号 + 大字距，左下锚定） ── */
    var mainSize = Math.max(7, Math.min(
      fontSize * 1.25,
      vertical ? Math.min(rw - 4, (rh - 4) / title.length - 1)
               : Math.min(rh - 4, (rw - 4) / title.length)
    ));
    g.font = "900 " + mainSize + "px " + FONT_CN;
    g.fillStyle = isDark
      ? "rgba(255,255,255," + (baseA * alphaMul).toFixed(3) + ")"
      : "rgba(17,17,17," + (baseA * alphaMul).toFixed(3) + ")";
    g.shadowColor = isDark ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.6)";
    g.shadowBlur = 1;
    if (vertical) {
      g.textBaseline = "top"; g.textAlign = "left";
      var cx = rect.x + mainSize * 0.4;
      var cy = rect.y + mainSize * 0.3;
      for (var ci = 0; ci < title.length; ci++) g.fillText(title[ci], cx, cy + ci * (mainSize + 3));
    } else {
      g.textBaseline = "bottom"; g.textAlign = "left";
      var sx0 = rect.x + mainSize * 0.3;
      for (var ci2 = 0; ci2 < title.length; ci2++) {
        g.fillText(title[ci2], sx0 + ci2 * (mainSize + 2), rect.y + rh - mainSize * 0.25);
      }
    }
    g.shadowBlur = 0;
    /* ── 数据小字：紧贴中文主字（标题横则数据横、竖则数据竖） ── */
    if (area > 6500 && fontSize >= 10) {
      var data = subtitleFor(rect.route);
      if (data) {
        var dA = 0.65 * alphaMul;
        if (opts.hovered) dA = 0.65 + 0.25 * (opts.subAlpha !== undefined ? opts.subAlpha : 1);
        var dSize = Math.max(6, Math.min(9, mainSize * 0.38));
        g.font = "700 " + dSize + "px " + FONT_CN;
        g.fillStyle = isDark
          ? "rgba(255,255,255," + dA.toFixed(3) + ")"
          : "rgba(17,17,17," + dA.toFixed(3) + ")";
        if (vertical) {
          g.textBaseline = "top"; g.textAlign = "left";
          var dX = rect.x + mainSize * 0.4 + mainSize + 4;
          var dY = rect.y + mainSize * 0.3;
          for (var di = 0; di < data.length; di++) g.fillText(data[di], dX, dY + di * (dSize + 1));
        } else {
          g.textBaseline = "alphabetic"; g.textAlign = "left";
          var x0 = rect.x + mainSize * 0.3;
          var yMainB = rect.y + rh - mainSize * 0.25;
          var dY2 = Math.max(rect.y + dSize + 2, yMainB - mainSize - 3);
          g.fillText(data, x0, dY2);
        }
      }
    }
    /* ── 英文标题：右上角 + ▪ 对比色印章方块（对角平衡，海报签章感） ── */
    if (area > 6500 && fontSize >= 10) {
      var en = ROUTE_SUBTITLES[rect.route];
      var enA = 0.6 * alphaMul;
      if (opts.hovered) enA = 0.6 + 0.25 * (opts.subAlpha !== undefined ? opts.subAlpha : 1);
      var enSize = Math.max(6, Math.min(10, fontSize * 0.45));
      g.font = "700 " + enSize + "px 'Courier New',Consolas,monospace";
      g.fillStyle = isDark
        ? "rgba(255,255,255," + enA.toFixed(3) + ")"
        : "rgba(17,17,17," + enA.toFixed(3) + ")";
      /* 印章方块：白块红章 / 黄块黑章 / 深色块白章（0.6em，比字母可视高 0.7em 略小） */
      var stamp = rect.color === "#FFFFFF" ? "#E32636" : rect.color === "#F8D030" ? "#111" : "#FFFFFF";
      var boxSize = enSize * 0.6;
      if (vertical) {
        g.textBaseline = "top"; g.textAlign = "left";
        var sx = rect.x + rw - enSize * 1.35;
        var sy0 = rect.y + enSize * 0.4;
        var enH = en.length * (enSize + 1.5) - 1.5;        // 字母列总高
        var topLimit = rect.y + 2;
        var bottomLimit = rect.y + rh - 2;
        var availH = bottomLimit - topLimit;
        /* 先计算空间再决定布局：纵向能堆叠 → 印章在字母顶部；不够 → 压缩印章；仍不够 → 印章在字母左侧 */
        var bx = Math.max(rect.x + 2, Math.min(sx, rect.x + rw - boxSize - 2));
        var stackY = null, stackSize = null, leftX = null, lettersY = sy0;
        if (boxSize + 3 + enH <= availH) {
          stackY = Math.max(topLimit, sy0 - boxSize - 3); stackSize = boxSize;
          lettersY = stackY + boxSize + 3;
        } else if (availH - enH - 3 >= 3) {
          stackY = topLimit; stackSize = Math.min(boxSize, availH - enH - 3);
          lettersY = stackY + stackSize + 3;
        } else if (sx - boxSize - 3 >= rect.x + 2) {
          leftX = sx - boxSize - 3;
        }
        /* 先画字母（fillStyle 保持文字色），再设印章色画印章——避免字母被染成印章色 */
        for (var si = 0; si < en.length; si++) g.fillText(en[si], sx, lettersY + si * (enSize + 1.5));
        g.fillStyle = stamp;
        if (stackSize !== null) g.fillRect(bx, stackY, stackSize, stackSize);
        else if (leftX !== null) g.fillRect(leftX, sy0, boxSize, boxSize);
      } else {
        var enW = g.measureText(en).width;
        var enLeft = rect.x + rw - enSize * 0.6 - enW;
        var enTop = rect.y + enSize * 0.5;
        g.textBaseline = "top"; g.textAlign = "left";
        g.fillText(en, enLeft, enTop);
        g.fillStyle = stamp;
        var boxSizeF = Math.min(boxSize, Math.max(2, enLeft - rect.x - 6));
        /* 方块垂直居中于字母（字母可视高约 0.7×enSize），右缘与字母左缘留 5px */
        var boxY = enTop + (enSize * 0.7 - boxSizeF) / 2;
        g.fillRect(Math.max(rect.x + 2, enLeft - boxSizeF - 5), boxY, boxSizeF, boxSizeF);
      }
    }
  }

  /* ---- 块几何与绘制（原生悬浮支持） ----
     liftRect：悬浮几何的唯一来源 —— 内缩（与底图黑缝一致）+ 向左上浮起 3px。
     文字层也使用 liftRect 的结果，从根源上保证"文字跟着块走"、悬浮不改变块尺寸。 */
  function liftRect(r) {
    var thH = 0.5 + r.w * 0.03;   // 垂直内缩
    var thV = 0.5 + r.h * 0.03;   // 水平内缩
    return {
      x: r.x - 3 + thV / 2, y: r.y - 3 + thH / 2,
      w: r.w - thV, h: r.h - thH,
      color: r.color, route: r.route
    };
  }

  /* drawBlock：单个色块的统一绘制入口。
     opts.lift   → 悬浮态（黑色硬阴影 + 原位黑框 + 浮起色块），返回浮起矩形供文字层复用
     opts.scale  → 生长动画（easeOutBack 缩放 + 黑框，覆盖底图）
     无 opts      → 底图色块（按黑缝内缩填充） */
  function drawBlock(g, r, opts) {
    opts = opts || {};
    if (opts.lift) {
      var rect = liftRect(r);
      var thH = 0.5 + r.w * 0.03, thV = 0.5 + r.h * 0.03;
      /* 阴影锚定浮起位置（右下方露出黑缝），黑色边框保持原位不随块体悬浮 */
      g.fillStyle = "#111";
      g.fillRect(rect.x + thV + 2, rect.y + thH + 2, rect.w, rect.h);
      g.strokeStyle = "#111"; g.lineWidth = 2;
      g.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      g.fillStyle = r.color;
      g.fillRect(rect.x, rect.y, rect.w, rect.h);
      return rect;
    }
    if (opts.scale) {
      var w = r.w * opts.scale, h = r.h * opts.scale;
      var sx = r.x + (r.w - w) / 2, sy = r.y + (r.h - h) / 2;
      g.fillStyle = r.color;
      g.fillRect(sx, sy, w, h);
      g.strokeStyle = "#111"; g.lineWidth = 2;
      g.strokeRect(sx, sy, w, h);
      return;
    }
    var thH2 = 0.5 + r.w * 0.03, thV2 = 0.5 + r.h * 0.03;
    g.fillStyle = r.color;
    g.fillRect(r.x + thV2 / 2, r.y + thH2 / 2, r.w - thV2, r.h - thH2);
  }

  function render() {
    if (!_ctx || !_canvasEl) return;
    if (_currentView !== "canvas") { _animFrameId = requestAnimationFrame(render); return; }
    _now = performance.now();
    var cw = _canvasEl.width / (window.devicePixelRatio || 1);
    var ch = _canvasEl.height / (window.devicePixelRatio || 1);
    if (cw <= 0 || ch <= 0) { _animFrameId = requestAnimationFrame(render); return; }

    /* 模式同步（AgentClient 的线程类型驱动） */
    if (typeof AgentClient !== "undefined" && AgentClient.getMode) {
      var newMode = AgentClient.getMode();
      if (newMode !== _canvasMode) {
        _canvasMode = newMode;
        renderNote();
      }
    }

    var mp = modeParams();
    var dragSlow = _canvasDrag.active ? 0.5 : 1.0;
    var turnScale = _canvasMode === "record" ? 1.6 : _canvasMode === "analyze" ? 0.5 : 1;
    time += 0.00035 * 0.75 * dragSlow * turnScale;
    currentSpeedX = Math.cos(time) * mp.speed * 0.75 * dragSlow;
    currentSpeedY = Math.sin(time) * mp.speed * 0.75 * dragSlow;
    camera.x += currentSpeedX;
    camera.y += currentSpeedY;

    var z = _zoom();
    var viewW = cw / z;
    var viewH = ch / z;
    var minCx = Math.floor((camera.x - CHUNK_SIZE) / CHUNK_SIZE);
    var maxCx = Math.floor((camera.x + viewW + CHUNK_SIZE) / CHUNK_SIZE);
    var minCy = Math.floor((camera.y - CHUNK_SIZE) / CHUNK_SIZE);
    var maxCy = Math.floor((camera.y + viewH + CHUNK_SIZE) / CHUNK_SIZE);

    for (var cx = minCx; cx <= maxCx; cx++) {
      for (var cy = minCy; cy <= maxCy; cy++) {
        var key = cx + "," + cy;
        if (!activeChunks.has(key)) activeChunks.set(key, generateChunk(cx, cy, activeChunks));
      }
    }
    var toDelete = [];
    activeChunks.forEach(function (_, key) {
      var parts = key.split(",").map(Number);
      if (parts[0] < minCx - 1 || parts[0] > maxCx + 1 || parts[1] < minCy - 1 || parts[1] > maxCy + 1) toDelete.push(key);
    });
    toDelete.forEach(function (k) { activeChunks.delete(k); });

    /* 清屏 + 矢量绘制色块（矢量缩放保持锐利，避免预渲染位图放大模糊）。
       悬浮块不参与底图/文字遍历，在特效层置顶绘制（保持 z-order） */
    _ctx.fillStyle = "#111";
    _ctx.fillRect(0, 0, cw, ch);
    _ctx.save();
    _ctx.scale(z, z);
    _ctx.translate(-camera.x, -camera.y);
    activeChunks.forEach(function (rects) {
      for (var i = 0; i < rects.length; i++) {
        var r = rects[i];
        if (r.hovered) continue;
        drawBlock(_ctx, r);
      }
    });

    /* 模式 veil（状态反馈：整体氛围色调） */
    if (mp.veil) {
      _ctx.restore();
      _ctx.fillStyle = mp.veil;
      _ctx.fillRect(0, 0, cw, ch);
      _ctx.save();
      _ctx.scale(z, z);
      _ctx.translate(-camera.x, -camera.y);
    }

    var bp = biggestPerRoute(camera.x, camera.y, camera.x + viewW, camera.y + viewH);

    /* 动态文字层：主字随模式呼吸（record 快 / analyze 慢 / free 静止）。
       悬浮块文字随其浮起矩形，推迟到特效层绘制 */
    var pulse = modePulse();
    var pa = 1 - pulse.amp * (1 + Math.sin(_now / 1000 * pulse.omega * Math.PI * 2)) / 2;
    activeChunks.forEach(function (rects) {
      rects.forEach(function (r) {
        if (!r.hovered &&
            r.w > 14 && r.h > 14 &&
            r.x + r.w > camera.x && r.x < camera.x + viewW &&
            r.y + r.h > camera.y && r.y < camera.y + viewH) {
          drawTitle(_ctx, r, { alphaMul: pa });
        }
      });
    });

    /* 特效层：悬浮块（De Stijl 语言，同卡片 hover 的 box-shadow）。
       悬浮是块的原生状态 —— drawBlock lift 返回浮起矩形，文字直接复用，
       不再有第二套几何计算 */
    if (hoverRect && hoverRect.hovered) {
      var hr = hoverRect;
      var subA = Math.min(1, (_now - hr.hoverT0) / 220);   // 副标提亮 220ms 淡入
      var lift = drawBlock(_ctx, hr, { lift: true });
      if (hr.w > 14 && hr.h > 14) drawTitle(_ctx, lift, { alphaMul: 1, hovered: true, subAlpha: subA });
    }

    /* Agent 联动：高亮脉冲 */
    _highlights = _highlights.filter(function (h) {
      var t = _now - h.t0;
      var cycle = Math.floor(t / h.period);
      var inCycle = t % h.period < 260;
      if (cycle > h.hits) { h.hits = cycle; h.last = t; }
      if (h.hits >= h.total && t > h.hits * h.period + 260) return false;
      var r = bp[h.route];
      if (r && inCycle) {
        _ctx.strokeStyle = "#FFFFFF"; _ctx.lineWidth = 4;
        _ctx.strokeRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
        _ctx.fillStyle = "rgba(255,255,255,0.18)";
        _ctx.fillRect(r.x, r.y, r.w, r.h);
      }
      return true;
    });

    /* Agent 联动：工具闪烁 */
    _flashes = _flashes.filter(function (f) {
      var t = _now - f.t0;
      if (t > f.duration) return false;
      var r = bp[f.route];
      if (r && Math.floor(t / 140) % 2 === 0) {
        _ctx.strokeStyle = "rgba(255,255,255,0.9)"; _ctx.lineWidth = 3;
        _ctx.strokeRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
      }
      return true;
    });

    /* Agent 联动：生长动画（新实验 pop-in） */
    _growths = _growths.filter(function (g) {
      var t = _now - g.t0;
      if (t > 3800) return false;
      var s = Math.min(1, t / 600);
      var ease = 1 + 2.7 * Math.pow(s - 1, 3) + 1.7 * Math.pow(s - 1, 2); // easeOutBack
      drawBlock(_ctx, g.rect, { scale: ease });
      return true;
    });

    _ctx.restore();
    _animFrameId = requestAnimationFrame(render);
  }

  /* ---- Canvas 公共接口（供 Agent 联动） ---- */

  function canvasHighlight(route, flashes) {
    _highlights.push({ route: route, t0: performance.now(), total: flashes, period: 550, hits: 0, last: 0 });
  }
  function canvasFlash(route, duration) {
    _flashes.push({ route: route, t0: performance.now(), duration: duration });
  }

  // Close menu dropdown on outside click
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#content-header-menu-wrap")) {
      var dd = document.getElementById("content-header-menu-dd");
      if (dd) dd.style.display = "none";
    }
  });

  return {
    init: init,
    navigate: navigate,
    back: back,
    show: show,
    reset: reset,
    expandChat: expandChat,
    restoreContent: restoreContent,
    canvasHighlight: canvasHighlight,
    canvasFlash: canvasFlash,
    handleResourceChange: handleResourceChange,
  };
})();

// 工具函数
function escHtml(s) { var d = document.createElement("div"); d.textContent = s || ""; return d.innerHTML; }
