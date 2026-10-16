// 保留原工具卡片与选择器的 HTML，消息列表由 React 管理。
export function createToolCards(api) {
  var _cardHistorical = false;

  function escHtml(value) { var el = document.createElement('div'); el.textContent = String(value || ''); return el.innerHTML; }
  function md2html(text) { return window.marked ? window.marked.parse(text || '') : escHtml(text); }
  function _parseToolResult(value) { try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return {}; } }
  function _shouldRenderToolResult(value) { return !!_parseToolResult(value).display; }
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
        if (!_cardHistorical) api.showToast(r.message);
        return "";

      default:
        api.appendSystemMsg("[Tool: unknown]");
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
    var isExpired = (_cardHistorical && !r.status);
    var isConfirmed = (r.status === "confirmed");
    var isCancelled = (r.status === "cancelled");
    var tcIdAttr = r._tcId ? ' data-tool-call-id="' + escHtml(r._tcId) + '"' : "";

    if (isExpired) {
      // Auto-cancel expired selector on page load
      setTimeout(function () {
        var history = api.client().getHistory ? api.client().getHistory() : [];
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
        api.saveAgentState();
        api.setSending(false);
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

    api.setSending(true);
    return html;
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
      await api.client().resolveSelector(tcId, ids, "confirmed");
      api.setSending(false);
      api.send("Selected: " + ids.join(", ") + ". Continue analysis.");
    } catch (e) {
      btn.disabled = false;
      api.showToast(e.message || "提交选择失败");
    }
  }

  async function selCancel(btn) {
    var card = btn.closest(".sel-card");
    var tcId = card.dataset.toolCallId;
    btn.disabled = true;
    try {
      await api.client().resolveSelector(tcId, [], "cancelled");
      api.setSending(false);
      api.send("Selection cancelled. Continue.");
    } catch (e) {
      btn.disabled = false;
      api.showToast(e.message || "取消选择失败");
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


return {build: function(result, historical) { _cardHistorical = !!historical; return buildToolCardHTML(result); },selToggleAll,selItemClick,selConfirm,selCancel,selShowMore};
}
