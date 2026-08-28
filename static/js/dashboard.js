/* Mondrian De Stijl Canvas Dashboard */
window.savePageState = function() { return {}; };
window.restorePageState = function(s) {};

(function() {
  var inner = document.getElementById('stage-inner');
  var canvas = document.getElementById('de-stijl-canvas');
  var ctx = canvas.getContext('2d');

  var CHUNK_SIZE = 400;
  var ZOOM = 2.25;

  var camera = { x: 0, y: 0 };
  var time = Math.random() * Math.PI * 2;
  var activeChunks = new Map();
  var currentSpeedX = 0, currentSpeedY = 0;

  // Transition state for click → expand animation
  var transition = { active: false, progress: 0, color: '', route: '', sx: 0, sy: 0, sw: 0, sh: 0, text: '', navigated: false, targetBg: '' };

  // Color → page + target background mapping
  var PAGE_BG = {
    '#D20E1C': '#fdf2f2', // red → experiments
    '#1A3E92': '#f2f4fd', // blue → analysis / timeline
    '#F6CE24': '#fdf8e7', // yellow → favorites
    '#FFFFFF': '#ffffff'  // white → chat
  };
  var BLUE_TIMELINE_RATIO = 0.45;

  function lerpColor(c1, c2, t) {
    var r1 = parseInt(c1.slice(1,3), 16), g1 = parseInt(c1.slice(3,5), 16), b1 = parseInt(c1.slice(5,7), 16);
    var r2 = parseInt(c2.slice(1,3), 16), g2 = parseInt(c2.slice(3,5), 16), b2 = parseInt(c2.slice(5,7), 16);
    var r = Math.round(r1 + (r2 - r1) * t);
    var g = Math.round(g1 + (g2 - g1) * t);
    var b = Math.round(b1 + (b2 - b1) * t);
    return '#' + r.toString(16).padStart(2,'0') + g.toString(16).padStart(2,'0') + b.toString(16).padStart(2,'0');
  }

  function resize() {
    var rect = inner.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
  }
  resize();
  window.addEventListener('resize', function() {
    resize();
    activeChunks.clear();
  });

  function pseudoRandom(seed) {
    var x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
  }

  function areAdjacent(r1, r2) {
    var eps = 0.5;
    var touchLeft  = Math.abs(r1.x - (r2.x + r2.w)) < eps;
    var touchRight = Math.abs((r1.x + r1.w) - r2.x) < eps;
    var touchTop   = Math.abs(r1.y - (r2.y + r2.h)) < eps;
    var touchBottom = Math.abs((r1.y + r1.h) - r2.y) < eps;
    var overlapX = r1.x < r2.x + r2.w - eps && r1.x + r1.w > r2.x + eps;
    var overlapY = r1.y < r2.y + r2.h - eps && r1.y + r1.h > r2.y + eps;
    return ((touchLeft || touchRight) && overlapY) || ((touchTop || touchBottom) && overlapX);
  }

  function getColorByArea(area, seed, forbiddenColors) {
    var chunkArea = CHUNK_SIZE * CHUNK_SIZE;
    var ratio = area / chunkArea;
    var weights = {'#FFFFFF': 0, '#D20E1C': 0, '#1A3E92': 0, '#F6CE24': 0};

    if (ratio > 0.18) {
      weights['#FFFFFF'] = 65; weights['#D20E1C'] = 25; weights['#1A3E92'] = 8; weights['#F6CE24'] = 2;
    } else if (ratio > 0.05) {
      weights['#FFFFFF'] = 15; weights['#D20E1C'] = 30; weights['#1A3E92'] = 40; weights['#F6CE24'] = 15;
    } else {
      weights['#FFFFFF'] = 2; weights['#D20E1C'] = 15; weights['#1A3E92'] = 38; weights['#F6CE24'] = 45;
    }

    forbiddenColors.forEach(function(c) {
      if (weights[c] !== undefined) weights[c] = 0;
    });

    var total = 0;
    for (var k in weights) total += weights[k];
    if (total <= 0) {
      var all = ['#FFFFFF', '#D20E1C', '#1A3E92', '#F6CE24'];
      var pool = all.filter(function(c) { return forbiddenColors.indexOf(c) === -1; });
      if (pool.length === 0) pool = all;
      return pool[Math.floor(pseudoRandom(seed) * pool.length)];
    }

    var r = pseudoRandom(seed) * total;
    for (k in weights) {
      r -= weights[k];
      if (r <= 0) return k;
    }
    return '#FFFFFF';
  }

  function generateChunk(cx, cy, activeChunksMap) {
    var seed = cx * 73856.093 + cy * 19349.663;

    var rects = [{ x: cx * CHUNK_SIZE, y: cy * CHUNK_SIZE, w: CHUNK_SIZE, h: CHUNK_SIZE }];
    var iterations = 8 + Math.floor(pseudoRandom(seed++) * 6);

    for (var i = 0; i < iterations; i++) {
      rects.sort(function(a, b) { return (b.w * b.h) - (a.w * a.h); });

      var targetIdx = 0;
      if (rects.length > 1 && pseudoRandom(seed++) > 0.65) {
        targetIdx = Math.floor(pseudoRandom(seed++) * rects.length);
      }

      var target = rects[targetIdx];
      var splitH = target.w > target.h;
      var minRatio, maxRatio;
      if (splitH) {
        minRatio = Math.max(0.5 * target.h / target.w, 1 - 2 * target.h / target.w);
        maxRatio = Math.min(2 * target.h / target.w, 1 - 0.5 * target.h / target.w);
      } else {
        minRatio = Math.max(0.5 * target.w / target.h, 1 - 2 * target.w / target.h);
        maxRatio = Math.min(2 * target.w / target.h, 1 - 0.5 * target.w / target.h);
      }
      minRatio = Math.max(0.05, minRatio);
      maxRatio = Math.min(0.95, maxRatio);

      var ratio;
      if (minRatio <= maxRatio) {
        ratio = minRatio + pseudoRandom(seed++) * (maxRatio - minRatio);
      } else { ratio = 0.5; seed++; }

      var r1, r2, minSize = 20;
      if (splitH) {
        var w1 = target.w * ratio;
        if (w1 < minSize || target.w - w1 < minSize) continue;
        r1 = { x: target.x, y: target.y, w: w1, h: target.h };
        r2 = { x: target.x + w1, y: target.y, w: target.w - w1, h: target.h };
      } else {
        var h1 = target.h * ratio;
        if (h1 < minSize || target.h - h1 < minSize) continue;
        r1 = { x: target.x, y: target.y, w: target.w, h: h1 };
        r2 = { x: target.x, y: target.y + h1, w: target.w, h: target.h - h1 };
      }
      rects.splice(targetIdx, 1);
      rects.push(r1, r2);
    }

    var neighborRects = [];
    for (var dx = -1; dx <= 1; dx++) {
      for (var dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        var nKey = cx + ',' + (cy + dx);
        // fix: use correct key format
        var realKey = (cx + dx) + ',' + (cy + dy);
        if (activeChunksMap.has(realKey)) {
          neighborRects = neighborRects.concat(activeChunksMap.get(realKey));
        }
      }
    }

    rects.sort(function(a, b) { return (b.w * b.h) - (a.w * a.h); });

    for (var j = 0; j < rects.length; j++) {
      var rect = rects[j];
      var forbiddenColors = [];
      for (var k = 0; k < j; k++) {
        if (areAdjacent(rect, rects[k])) {
          forbiddenColors.push(rects[k].color);
        }
      }
      for (var ni = 0; ni < neighborRects.length; ni++) {
        if (areAdjacent(rect, neighborRects[ni])) {
          forbiddenColors.push(neighborRects[ni].color);
        }
      }
      rect.color = getColorByArea(rect.w * rect.h, seed++, forbiddenColors);

      // Lock text edge at generation time
      var candidates = [];
      if (currentSpeedX > 0) candidates.push(3);
      else if (currentSpeedX < 0) candidates.push(1);
      if (currentSpeedY > 0) candidates.push(0);
      else if (currentSpeedY < 0) candidates.push(2);
      if (candidates.length === 0) candidates.push(0, 1, 2, 3);
      rect.edge = candidates[Math.floor(pseudoRandom(seed++) * candidates.length)];

      // Determine target page route
      if (rect.color === '#FFFFFF') {
        rect.route = '/new';
      } else if (rect.color === '#D20E1C') {
        rect.route = '/experiments';
      } else if (rect.color === '#F6CE24') {
        rect.route = '/experiments?panel=categories';
      } else {
        // Blue: split between analyze and timeline
        rect.route = pseudoRandom(seed++) > BLUE_TIMELINE_RATIO ? '/analyze' : '/timeline';
      }
    }

    return rects;
  }

  canvas.addEventListener('click', function(e) {
    var rect = canvas.getBoundingClientRect();
    var clickX = (e.clientX - rect.left) * (canvas.width / (window.devicePixelRatio || 1) / rect.width);
    var clickY = (e.clientY - rect.top) * (canvas.height / (window.devicePixelRatio || 1) / rect.height);

    for (var chunks of activeChunks.values()) {
      for (var i = 0; i < chunks.length; i++) {
        var r = chunks[i];
        var drawX = r.x - camera.x;
        var drawY = r.y - camera.y;

        var thH = 0.5 + r.w * 0.03;
        var thV = 0.5 + r.h * 0.03;
        var insetX = thV / 2;
        var insetY = thH / 2;

        var sx = (drawX + insetX) * ZOOM;
        var sy = (drawY + insetY) * ZOOM;
        var sw = (r.w - insetX * 2) * ZOOM;
        var sh = (r.h - insetY * 2) * ZOOM;

        if (clickX >= sx && clickX <= sx + sw && clickY >= sy && clickY <= sy + sh) {
          if (r.route && !transition.active) {
            var label = '';
            if (r.color === '#F6CE24') label = '收藏夹';
            else if (r.color === '#FFFFFF') label = 'ExperMate';
            else if (r.color === '#D20E1C') label = '实验列表';
            else if (r.color === '#1A3E92') label = r.route === '/analyze' ? '分析中心' : '时间线';
            transition = {
              active: true, progress: 0, navigated: false,
              color: r.color, route: r.route,
              sx: sx, sy: sy, sw: sw, sh: sh, text: label,
              targetBg: PAGE_BG[r.color] || '#ffffff'
            };
          }
          return;
        }
      }
    }
  });

  function render() {
    var cw = canvas.width / (window.devicePixelRatio || 1);
    var ch = canvas.height / (window.devicePixelRatio || 1);

    // Auto-pan camera (freeze during transition)
    if (!transition.active) {
      var baseTurnSpeed = 0.0006;
      time += baseTurnSpeed * 0.75;
      var baseMoveSpeed = 0.4;
      currentSpeedX = Math.cos(time) * baseMoveSpeed * 0.75;
      currentSpeedY = Math.sin(time) * baseMoveSpeed * 0.75;
      camera.x += currentSpeedX;
      camera.y += currentSpeedY;
    }

    var viewW = cw / ZOOM;
    var viewH = ch / ZOOM;

    var minCx = Math.floor((camera.x - CHUNK_SIZE) / CHUNK_SIZE);
    var maxCx = Math.floor((camera.x + viewW + CHUNK_SIZE) / CHUNK_SIZE);
    var minCy = Math.floor((camera.y - CHUNK_SIZE) / CHUNK_SIZE);
    var maxCy = Math.floor((camera.y + viewH + CHUNK_SIZE) / CHUNK_SIZE);

    if (!transition.active) {
      for (var cx = minCx; cx <= maxCx; cx++) {
        for (var cy = minCy; cy <= maxCy; cy++) {
          var key = cx + ',' + cy;
          if (!activeChunks.has(key)) {
            activeChunks.set(key, generateChunk(cx, cy, activeChunks));
          }
        }
      }

      var keysToDelete = [];
      activeChunks.forEach(function(_, key) {
        var parts = key.split(',').map(Number);
        if (parts[0] < minCx - 1 || parts[0] > maxCx + 1 || parts[1] < minCy - 1 || parts[1] > maxCy + 1) {
          keysToDelete.push(key);
        }
      });
      keysToDelete.forEach(function(k) { activeChunks.delete(k); });
    }

    // Draw
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);

    ctx.save();
    ctx.scale(ZOOM, ZOOM);

    activeChunks.forEach(function(chunkRects) {
      for (var i = 0; i < chunkRects.length; i++) {
        var rect = chunkRects[i];
        var drawX = rect.x - camera.x;
        var drawY = rect.y - camera.y;

        if (drawX + rect.w < 0 || drawX > viewW || drawY + rect.h < 0 || drawY > viewH) continue;

        var thH = 0.5 + rect.w * 0.03;
        var thV = 0.5 + rect.h * 0.03;
        var insetX = thV / 2;
        var insetY = thH / 2;

        // Fill
        ctx.fillStyle = rect.color;
        ctx.fillRect(drawX + insetX, drawY + insetY, rect.w - insetX*2, rect.h - insetY*2);

        // Label
        var label = '';
        if (rect.color === '#F6CE24') label = '收藏夹';
        else if (rect.color === '#FFFFFF') label = 'ExperMate';
        else if (rect.color === '#D20E1C') label = '实验列表';
        else if (rect.color === '#1A3E92') label = rect.route === '/analyze' ? '分析中心' : '时间线';

        if (label) {
          // Light tint of block color (same hue), white blocks get black
          if (rect.color === '#FFFFFF') ctx.fillStyle = '#000';
          else if (rect.color === '#D20E1C') ctx.fillStyle = '#f4a0a4';
          else if (rect.color === '#1A3E92') ctx.fillStyle = '#8aa8e0';
          else if (rect.color === '#F6CE24') ctx.fillStyle = '#6b5a10';

          var availW = rect.w - insetX * 2;
          var availH = rect.h - insetY * 2;

          ctx.save();
          ctx.beginPath();
          ctx.rect(drawX + insetX, drawY + insetY, availW, availH);
          ctx.clip();

          var edge = rect.edge !== undefined ? rect.edge : 0;
          var maxLength = (edge === 0 || edge === 2) ? availW : availH;
          var maxDepth  = (edge === 0 || edge === 2) ? availH : availW;
          maxLength -= 12;
          maxDepth  -= 6;

          if (maxLength > 15 && maxDepth > 5) {
            ctx.font = 'bold 10px sans-serif';
            var testW = ctx.measureText(label).width;
            var idealFS = 10 * (maxLength / testW);
            var fs = Math.min(idealFS, maxDepth);
            ctx.font = 'bold ' + fs + 'px sans-serif';

            var textW = ctx.measureText(label).width;
            var txtSeed2 = rect.x * 123 + rect.y * 456;
            var rand2 = function() { var x = Math.sin(txtSeed2++) * 10000; return x - Math.floor(x); };
            var availSpace = maxLength - textW;
            var offset = 6 + availSpace * rand2();

            ctx.translate(drawX + insetX, drawY + insetY);

            if (edge === 0) {         // top edge, text from bottom
              ctx.translate(availW, 0);
              ctx.rotate(Math.PI);
              ctx.textBaseline = 'bottom';
              ctx.fillText(label, offset, -4);
            } else if (edge === 1) {  // right edge
              ctx.translate(availW, availH);
              ctx.rotate(-Math.PI / 2);
              ctx.textBaseline = 'bottom';
              ctx.fillText(label, offset, -4);
            } else if (edge === 2) {  // bottom edge
              ctx.textBaseline = 'bottom';
              ctx.fillText(label, offset, availH - 4);
            } else if (edge === 3) {  // left edge
              ctx.rotate(Math.PI / 2);
              ctx.textBaseline = 'bottom';
              ctx.fillText(label, offset, -4);
            }
          }
          ctx.restore();
        }
      }
    });

    ctx.restore();

    // Transition: expand → blend to page bg → hold until navigation
    if (transition.active) {
      transition.progress += 0.03;
      if (transition.progress > 1) transition.progress = 1;

      // Expand the rect to full canvas
      var p = 1 - Math.pow(1 - Math.min(transition.progress / 0.7, 1), 3);
      var curX = transition.sx + (0 - transition.sx) * p;
      var curY = transition.sy + (0 - transition.sy) * p;
      var curW = transition.sw + (cw - transition.sw) * p;
      var curH = transition.sh + (ch - transition.sh) * p;

      if (transition.progress < 0.7) {
        // Phase 1 (0→70%): expand in block color
        ctx.fillStyle = transition.color;
        ctx.fillRect(curX, curY, curW, curH);
      } else {
        // Phase 2 (70%→100%): blend from block color to page bg color
        var t = (transition.progress - 0.7) / 0.3;
        var blendColor = lerpColor(transition.color, transition.targetBg, t);
        ctx.fillStyle = blendColor;
        ctx.fillRect(0, 0, cw, ch);

        // Navigate once the screen is fully covered and blending begins
        if (!transition.navigated) {
          transition.navigated = true;
          window.navigateToPage(transition.route);
        }
      }
    }

    requestAnimationFrame(render);
  }

  render();
})();
