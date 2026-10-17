// 原生绘图引擎：React 提供节点、模式与导航回调，并管理生命周期。
export function createCanvasEngine(scope, { canvas, container, note, hover, onNavigate, getMode }) {
  const _canvasEl = canvas, _canvasContainer = container;
  let _ctx = null, _animFrameId = null, visible = true;
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
  var _canvasMode = "free";               // free | record | analyze（由宿主回调提供）
  var _agentTipEl = note;                 // 便签板元素
  var _hoverTipEl = hover;                 // hover 提示条元素
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
  var FONT_CN = "'Source Han Sans SC','Noto Sans SC Variable','Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif";

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
            if (url) onNavigate(url, e);
          }
          return;
        }
      }
    }
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
    var nb = _agentTipEl.querySelector('#nb-body');
    var dateEl = _agentTipEl.querySelector('#nb-date');
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
    if (!visible) return;
    _now = performance.now();
    var cw = _canvasEl.width / (window.devicePixelRatio || 1);
    var ch = _canvasEl.height / (window.devicePixelRatio || 1);
    if (cw <= 0 || ch <= 0) { _animFrameId = scope.frame(render); return; }

    /* 模式同步（AgentClient 的线程类型驱动） */
    var newMode = getMode();
    if (newMode !== _canvasMode) { _canvasMode = newMode; renderNote(); }

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
    _animFrameId = scope.frame(render);
  }

  /* ---- Canvas 公共接口（供 Agent 联动） ---- */

  function canvasHighlight(route, flashes) {
    _highlights.push({ route: route, t0: performance.now(), total: flashes, period: 550, hits: 0, last: 0 });
  }
  function canvasFlash(route, duration) {
    _flashes.push({ route: route, t0: performance.now(), duration: duration });
  }

  function setVisible(next) {
    if (visible === next) return;
    visible = next;
    if (_animFrameId !== null) scope.cancelFrame(_animFrameId);
    _animFrameId = null;
    if (visible) { resizeCanvas(); _canvasResetCache(); render(); }
  }
  scope.cleanup(() => {
    visible = false;
    if (_canvasEl) _canvasEl.style.cursor = '';
  });
  return {
    start() {
    if (_canvasEl) {
      _ctx = _canvasEl.getContext("2d");
      scope.frame(function () {
        resizeCanvas();
        activeChunks.clear();
        renderNote();
      });
      scope.listen(_canvasEl, "click", handleCanvasClick);
      // 拖拽平移 + hover 追踪
      scope.listen(_canvasEl, "mousedown", function (e) {
        _canvasDrag.active = true;
        _canvasDrag.moved = false;
        _canvasDrag.startX = e.clientX;
        _canvasDrag.startY = e.clientY;
        _canvasDrag.lastX = e.clientX;
        _canvasDrag.lastY = e.clientY;
        _canvasEl.style.cursor = "grabbing";
      });
      scope.listen(window, "mousemove", function (e) {
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
      scope.listen(window, "mouseup", function () {
        if (_canvasDrag.active) {
          _canvasDrag.active = false;
          _canvasEl.style.cursor = "";
        }
      });
      scope.listen(_canvasEl, "mouseleave", function () {
        if (hoverRect) { hoverRect.hovered = false; hoverRect = null; }
        if (_hoverTipEl) _hoverTipEl.style.display = "none";
      });
      // 触摸拖拽
      scope.listen(_canvasEl, "touchstart", function (e) {
        if (e.touches.length === 1) {
          _canvasDrag.active = true;
          _canvasDrag.lastX = e.touches[0].clientX;
          _canvasDrag.lastY = e.touches[0].clientY;
        }
      }, { passive: true });
      scope.listen(window, "touchmove", function (e) {
        if (!_canvasDrag.active || !e.touches.length) return;
        var z = _zoom();
        var dx = (e.touches[0].clientX - _canvasDrag.lastX) / z;
        var dy = (e.touches[0].clientY - _canvasDrag.lastY) / z;
        camera.x -= dx;
        camera.y -= dy;
        _canvasDrag.lastX = e.touches[0].clientX;
        _canvasDrag.lastY = e.touches[0].clientY;
      }, { passive: true });
      scope.listen(window, "touchend", function () { _canvasDrag.active = false; });
      render();
    }

    },
    resize() { resizeCanvas(); _canvasResetCache(); },
    setVisible,
    updateStats(next) { Object.assign(_stats, next); renderNote(); },
    highlight: canvasHighlight,
    flash: canvasFlash,
  };
}
