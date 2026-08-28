/**
 * edit-mode.js — 内联编辑框架。
 * 函数: addDashSVG, toggleEdit, cancelEdit, saveEdit, collectData,
 *        addArrayItem, addTableRow, regenerate, openEditModal,
 *        closeEditModal, execCmd, execLink, archiveExp, editTag, etc.
 */
(function () {
  "use strict";

  window._isEditing = false;
  window._editingTarget = null;
  window._savedHtml = {};
  var _editBaseline = "";
  var _savedPdfBtn = null;

  function _setEditLockedControls(locked) {
    document.querySelectorAll("[data-edit-lock]").forEach(function (el) {
      el.classList.toggle("edit-locked", locked);
      el.setAttribute("aria-disabled", locked ? "true" : "false");
      if ("disabled" in el) {
        if (locked) {
          el.dataset.editLockDisabled = el.disabled ? "1" : "0";
          el.disabled = true;
        } else {
          el.disabled = el.dataset.editLockDisabled === "1";
          delete el.dataset.editLockDisabled;
        }
      } else {
        el.inert = locked;
      }
    });
  }

  // ---- SVG 虚线框 ----

  window.addDashSVG = function (el) {
    var rect = el.getBoundingClientRect(), w = rect.width, h = rect.height;
    if (w < 4 || h < 4) return;
    var svgNS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("class", "dash-svg");
    svg.setAttribute("width", w);
    svg.setAttribute("height", h);
    var r = document.createElementNS(svgNS, "rect");
    r.setAttribute("x", "1"); r.setAttribute("y", "1");
    r.setAttribute("width", w - 2); r.setAttribute("height", h - 2);
    r.setAttribute("fill", "none"); r.style.stroke = "var(--black)";
    r.setAttribute("stroke-width", "2"); r.setAttribute("stroke-dasharray", "8 6");
    svg.appendChild(r);
    var old = el.querySelector(".dash-svg");
    if (old) old.remove();
    el.appendChild(svg);
  };

  // ---- 编辑模式切换 ----

  window.toggleEdit = function () {
    window._isEditing = true;
    _setEditLockedControls(true);
    document.querySelectorAll(".view-mode").forEach(function (el) { el.style.display = "none"; });
    document.querySelectorAll(".edit-mode").forEach(function (el) { el.style.display = ""; });
    document.getElementById("btn-edit").style.display = "none";
    document.getElementById("btn-save").style.display = "";
    document.getElementById("btn-cancel").style.display = "";
    var pdfBtn = document.getElementById("btn-print");
    if (pdfBtn) { pdfBtn.style.display = "none"; _savedPdfBtn = pdfBtn; }
    window._savedHtml = {};
    ["field-title", "field-date-range", "field-experimenter", "field-status", "field-tags-container"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        window._savedHtml[id] = {
          html: el.innerHTML,
          className: el.className,
          style: el.style.cssText,
          value: el.dataset.value
        };
      }
    });
    var titleEl = document.getElementById("field-title");
    if (titleEl) {
      titleEl.innerHTML = '<span class="editable-dashed" data-field="title" data-label="Title" data-type="text" style="font-size:inherit;font-weight:inherit">' +
        escHtml(titleEl.textContent.trim()) + "</span>";
    }
    _makeDateRangeEdit();
    var expEl = document.getElementById("field-experimenter");
    if (expEl) {
      expEl.innerHTML = '<span class="editable-dashed" data-field="experimenter" data-label="Experimenter" data-type="text">' +
        escHtml(expEl.textContent.trim()) + "</span>";
    }
    _makeStatusEdit();
    _makeTagsEdit();
    document.querySelectorAll(".edit-mode .markdown-content").forEach(function (el) {
      if (!el.dataset.rendered && typeof marked !== "undefined") {
        el.innerHTML = marked.parse(el.textContent);
        el.dataset.rendered = "1";
      }
    });
    setTimeout(function () {
      document.querySelectorAll(".editable-dashed").forEach(function (el) { addDashSVG(el); });
      setTimeout(_equalizeRowHeights, 30);
    }, 20);
    _captureEditBaseline();
  };

  window.cancelEdit = function () {
    window._isEditing = false;
    _setEditLockedControls(false);
    document.querySelectorAll(".view-mode").forEach(function (el) { el.style.display = ""; });
    document.querySelectorAll(".edit-mode").forEach(function (el) { el.style.display = "none"; });
    document.getElementById("btn-edit").style.display = "";
    document.getElementById("btn-save").style.display = "none";
    document.getElementById("btn-cancel").style.display = "none";
    if (_savedPdfBtn) { _savedPdfBtn.style.display = ""; _savedPdfBtn = null; }
    if (window._savedHtml) {
      Object.keys(window._savedHtml).forEach(function (id) {
        var el = document.getElementById(id);
        var saved = window._savedHtml[id];
        if (!el || !saved) return;
        // 状态徽章进入编辑时会临时清空 class/style；取消必须完整还原。
        el.innerHTML = saved.html;
        el.className = saved.className;
        el.style.cssText = saved.style;
        if (saved.value !== undefined) el.dataset.value = saved.value;
      });
    }
    _editBaseline = "";
  };

  // ---- 行高均衡 ----

  function _equalizeRowHeights() {
    document.querySelectorAll(".edit-mode table.academic-table tbody tr").forEach(function (tr) {
      var maxH = 0, cells = [];
      tr.querySelectorAll(".editable-dashed").forEach(function (el) { el.style.height = ""; });
      tr.querySelectorAll(".editable-dashed").forEach(function (el) {
        var h = el.scrollHeight; if (h > maxH) maxH = h; cells.push(el);
      });
      cells.forEach(function (el) { el.style.height = maxH + "px"; el.style.minHeight = maxH + "px"; addDashSVG(el); });
    });
  }

  // ---- 日期/状态/标签编辑 ----

  function _makeDateRangeEdit() {
    var el = document.getElementById("field-date-range"); if (!el) return;
    var raw = el.textContent.trim(), parts = raw.split("~"),
        startDate = (parts[0] || "").trim(), endDate = (parts[1] || "").trim();
    if (!endDate || endDate === startDate) endDate = startDate;
    el.innerHTML = '<span class="editable-dashed" data-field="date" data-label="Start Date" data-type="date" data-value="' +
      escHtml(startDate) + '">' + escHtml(startDate) + '</span> ~ <span class="editable-dashed" data-field="end_date" data-label="End Date" data-type="date" data-value="' +
      escHtml(endDate) + '">' + escHtml(endDate) + "</span>";
  }

  function _makeStatusEdit() {
    var el = document.getElementById("field-status"); if (!el) return;
    var cur = el.dataset.value || el.textContent.trim();
    el.className = ""; el.style.cssText = "display:inline-block";
    var opts = ["planned", "running", "done", "failed", "repeated"],
        allOpts = opts.concat(opts).concat(opts);
    var h = '<div class="status-slider" id="status-slider">';
    for (var i = 0; i < allOpts.length; i++) {
      var o = allOpts[i];
      h += '<span class="status-option' + (o === cur ? " selected" : "") + '" data-value="' + o + '" onclick="selectStatus(\'' + o + "',this)\">" + o + "</span>";
    }
    h += '<input type="hidden" id="inl-status" value="' + escHtml(cur) + '">';
    el.innerHTML = h;
    setTimeout(function () {
      var allNodes = document.querySelectorAll("#status-slider .status-option");
      var target = allNodes[5 + opts.indexOf(cur)];
      if (target) target.scrollIntoView({ behavior: "instant", block: "nearest", inline: "center" });
      _setupSliderLoop();
    }, 40);
  }

  function _setupSliderLoop() {
    var slider = document.getElementById("status-slider"); if (!slider) return;
    var allNodes = slider.querySelectorAll(".status-option"); if (allNodes.length < 10) return;
    var setW = allNodes[5].offsetLeft - allNodes[0].offsetLeft, timer;
    slider.addEventListener("scroll", function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var sl = slider.scrollLeft;
        if (sl < setW * 0.4) slider.scrollLeft += setW;
        else if (sl > setW * 1.6) slider.scrollLeft -= setW;
      }, 120);
    }, { passive: true });
  }

  window.selectStatus = function (v, clickedEl) {
    document.getElementById("inl-status").value = v;
    var slider = document.getElementById("status-slider");
    slider.querySelectorAll(".status-option").forEach(function (b) { b.classList.toggle("selected", b.dataset.value === v); });
    if (clickedEl) clickedEl.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    _updateEditDirtyState();
  };

  function _makeTagsEdit() {
    var c = document.getElementById("field-tags-container"); if (!c) return;
    var h = "";
    c.querySelectorAll(".tag-pill").forEach(function (p, i) {
      h += '<span class="tag-pill tag-jitter" style="display:inline-flex;align-items:center;gap:4px;animation-delay:' +
        (Math.random() * 0.5).toFixed(2) + 's">' + escHtml(p.textContent.trim()) +
        '<button onclick="this.parentElement.remove();refreshEditDirtyState()" style="font-size:0.65rem;padding:0 2px;line-height:1;background:none;border:none;cursor:pointer;font-weight:700">&times;</button></span>';
    });
    h += '<span style="display:inline-flex;align-items:center;gap:2px;margin:0.15em"><input id="new-tag-input" placeholder="New tag" style="width:80px;font-size:0.7em;padding:0.15em 0.4em;border:2px solid var(--black)" onkeydown="if(event.key===\'Enter\'){addTag();event.preventDefault()}"><button onclick="addTag()" style="font-size:0.65rem;padding:0 4px;border:2px solid var(--black);background:var(--white);cursor:pointer">+</button></span>';
    c.innerHTML = h;
  }

  window.getExistingTags = function () {
    var c = document.getElementById("field-tags-container"); if (!c) return [];
    var r = [];
    c.querySelectorAll(".tag-pill").forEach(function (p) {
      var clone = p.cloneNode(true); var btn = clone.querySelector("button"); if (btn) btn.remove();
      var t = clone.textContent.trim(); if (t) r.push(t);
    });
    return r;
  };

  window.addTag = function () {
    var inp = document.getElementById("new-tag-input"); if (!inp || !inp.value.trim()) return;
    var pill = document.createElement("span");
    pill.className = "tag-pill";
    pill.style.cssText = "display:inline-flex;align-items:center;gap:4px";
    pill.innerHTML = escHtml(inp.value.trim()) + '<button onclick="this.parentElement.remove()" style="font-size:0.65rem;padding:0 2px;line-height:1;background:none;border:none;cursor:pointer;font-weight:700">&times;</button>';
    inp.parentElement.before(pill);
    inp.value = "";
    _updateEditDirtyState();
  };

  // ---- 数据收集与保存 ----

  function _getFieldValue(fieldName) {
    var el = document.querySelector('.editable-dashed[data-field="' + fieldName + '"]');
    if (!el) return "";
    return el.dataset.value !== undefined ? el.dataset.value : el.textContent.trim();
  }

  window.collectData = function () {
    var d = {};
    d["title"] = _getFieldValue("title");
    d["experimenter"] = _getFieldValue("experimenter");
    d["date"] = _getFieldValue("date");
    var endDate = _getFieldValue("end_date");
    if (endDate && endDate !== d["date"]) d["end_date"] = endDate;
    d["purpose"] = _getFieldValue("purpose");
    d["conclusion"] = _getFieldValue("conclusion");
    var st = document.getElementById("inl-status"); if (st) d["status"] = st.value;
    d["tags"] = getExistingTags();
    d["original_notes"] = _getFieldValue("original_notes");
    d["sop"] = _collectArr("sop");
    d["next_steps"] = _collectArr("next_steps");
    var na = document.getElementById("edit-observations-no_anomalies");
    d["observations"] = { no_anomalies: na ? na.checked : false, items: _collectArr("observations_items") };
    d["materials"] = _collectTbl("materials", ["name", "purity", "vendor", "amount", "notes"]);
    d["equipment"] = _collectTbl("equipment", ["device", "model", "location"]);
    d["experimental_plan"] = _collectTbl("experimental_plan", ["group", "condition", "expected"]);
    d["process_parameters"] = _collectTbl("process_parameters", ["step", "parameter", "setpoint", "actual", "deviation"]);
    d["characterization"] = _collectTbl("characterization", ["method", "sample_id", "preparation", "submission_date", "data_path"]);
    d["results"] = { qualitative: _getFieldValue("results_qualitative"), key_data: _collectTbl("results_key_data", ["metric", "value", "comparison", "change"]), figures: [] };
    return d;
  };

  function _setSaveEnabled(enabled) {
    var btn = document.getElementById("btn-save");
    if (!btn) return;
    btn.disabled = !enabled;
    btn.setAttribute("aria-disabled", enabled ? "false" : "true");
  }

  function _captureEditBaseline() {
    _editBaseline = JSON.stringify(collectData());
    _setSaveEnabled(false);
  }

  function _updateEditDirtyState() {
    if (!window._isEditing || !_editBaseline) return;
    _setSaveEnabled(JSON.stringify(collectData()) !== _editBaseline);
  }
  window.refreshEditDirtyState = _updateEditDirtyState;

  function _collectTbl(name, keys) {
    var t = document.getElementById("table-" + name); if (!t) return [];
    var rows = [];
    t.querySelectorAll("tbody tr").forEach(function (tr) {
      var row = {};
      tr.querySelectorAll(".editable-dashed[data-key]").forEach(function (el) {
        row[el.dataset.key] = el.dataset.value !== undefined ? el.dataset.value : el.textContent.trim();
      });
      if (keys.some(function (k) { return row[k] && row[k].trim(); })) rows.push(row);
    });
    return rows;
  }

  function _collectArr(name) {
    var list = document.getElementById("list-" + name); if (!list) return [];
    var vals = [];
    list.querySelectorAll(".editable-dashed").forEach(function (el) {
      var val = el.dataset.value !== undefined ? el.dataset.value : el.textContent.trim();
      if (val) vals.push(val);
    });
    return vals;
  }

  // SPA 内刷新当前页（不再整页 reload）：
  // PanelManager.navigate(同路径) 会去重不入栈、重新拉取当前片段
  function _reloadCurrentPage() {
    window._isEditing = false;
    if (window.PanelManager && window.PanelManager.navigate) {
      window.PanelManager.navigate(window.location.pathname);
    } else {
      location.reload();
    }
  }

  function _clientIdHeader() {
    return window.AgentClient && AgentClient.getClientId ? AgentClient.getClientId() : "";
  }

  function _showSaveFeedback(message, kind, actionLabel, action) {
    if (typeof window.showExperimentSaveFeedback === "function") {
      window.showExperimentSaveFeedback(message, kind, actionLabel, action);
    } else {
      alert(message);
    }
  }

  function _openPrintPreview(path, label, notFoundMessage) {
    // 桌面 WebView 会把 window.open('about:blank') 交给系统处理；直接在当前应用
    // 内展示预览。请求仍由当前页携带 Bearer token，因此不会误读离线数据库。
    var token = "";
    try { token = localStorage.getItem("exdiary_token") || ""; } catch (_) {}
    var headers = token ? { Authorization: "Bearer " + token } : {};
    fetch(path, { headers: headers })
      .then(function (response) {
        if (!response.ok) throw new Error(response.status === 404 ? notFoundMessage : "打印内容加载失败");
        return response.text();
      })
      .then(function (html) {
        var old = document.getElementById("exdiary-print-preview");
        if (old) old.remove();
        var modal = document.createElement("div");
        modal.id = "exdiary-print-preview";
        modal.className = "pane-scoped-modal";
        modal.style.cssText = "position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:1rem;background:rgba(0,0,0,.58)";
        modal.innerHTML = '<section role="dialog" aria-modal="true" aria-label="' + label + '打印预览" style="width:min(980px,100%);height:min(92vh,980px);display:flex;flex-direction:column;background:var(--white);border:4px solid var(--black);box-shadow:8px 8px 0 var(--black)"><header style="display:flex;align-items:center;gap:.5rem;padding:.55rem .7rem;border-bottom:3px solid var(--black);background:var(--off-white)"><strong style="font-size:.85rem;letter-spacing:.06em">打印预览</strong><span style="margin-left:auto;font-size:.72rem;color:var(--text-2)">在系统对话框中选择“另存为 PDF”</span><button type="button" class="print-preview-action" data-print style="min-width:44px;min-height:36px;border:2px solid var(--black);background:var(--yellow);font:inherit;font-weight:900;cursor:pointer">打印</button><button type="button" class="print-preview-action" data-close aria-label="关闭打印预览" style="min-width:44px;min-height:36px;border:2px solid var(--black);background:var(--white);font:inherit;font-weight:900;cursor:pointer">关闭</button></header><iframe title="' + label + '打印预览" style="width:100%;flex:1;border:0;background:white"></iframe></section>';
        var frame = modal.querySelector("iframe");
        frame.srcdoc = html;
        modal.querySelector("[data-close]").addEventListener("click", function () { modal.remove(); });
        modal.querySelector("[data-print]").addEventListener("click", function () {
          if (frame.contentWindow) { frame.contentWindow.focus(); frame.contentWindow.print(); }
        });
        modal.addEventListener("click", function (event) { if (event.target === modal) modal.remove(); });
        document.body.appendChild(modal);
      })
      .catch(function (error) {
        _showSaveFeedback("无法打开打印预览：" + error.message, "error");
      });
  }

  window.openExperimentPrint = function (expId) {
    _openPrintPreview("/experiments/" + encodeURIComponent(expId) + "/print", "实验", "未找到该实验记录");
  };

  window.openAnalysisPrint = function (analysisId) {
    _openPrintPreview("/experiments/analysis/" + encodeURIComponent(analysisId) + "/print", "分析报告", "未找到该分析报告");
  };

  function _rememberSaveSuccess(revision) {
    try {
      sessionStorage.setItem("exdiary_experiment_save_notice", JSON.stringify({
        kind: "success",
        message: "已保存 · 修订 " + revision,
      }));
    } catch (_) { /* feedback still appears after a normal page reload only when storage is available */ }
  }

  window.saveEdit = function () {
    var expId = document.body.dataset.expId || window.location.pathname.split("/").pop();
    var data = collectData();
    data.expected_revision = Number(document.body.dataset.expRevision || 0);
    var btn = document.getElementById("btn-save");
    if (btn && btn.disabled) return;
    if (btn) { btn.disabled = true; btn.textContent = "Saving..."; }

    function restoreSaveButton() {
      if (btn) { btn.disabled = false; btn.textContent = "Save"; }
    }

    fetch("/experiments/" + expId + "/save-json", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Exdiary-Client-Id": _clientIdHeader() },
      body: JSON.stringify(data),
    })
      .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
      .then(function (result) {
        if (result.ok && result.data.ok) {
          var revision = result.data.revision;
          if (revision !== undefined) document.body.dataset.expRevision = revision;
          _rememberSaveSuccess(revision === undefined ? "?" : revision);
          _reloadCurrentPage();
          return;
        }
        restoreSaveButton();
        if (result.data && result.data.revision !== undefined) document.body.dataset.expRevision = result.data.revision;
        if (result.data && result.data.revision !== undefined) {
          _showSaveFeedback("内容已在另一窗口更新；本次修改未保存。", "error", "加载最新内容", _reloadCurrentPage);
        } else {
          _showSaveFeedback("保存失败：" + ((result.data && result.data.error) || "未知错误"), "error", "重试", window.saveEdit);
        }
      })
      .catch(function (e) {
        restoreSaveButton();
        _showSaveFeedback("保存失败：" + e.message, "error", "重试", window.saveEdit);
      });
  };

  // ---- 动态行/数组 ----

  window.addArrayItem = function (name) {
    var list = document.getElementById("list-" + name); if (!list) return;
    var li = document.createElement("li");
    li.style.cssText = "display:flex;gap:0.3rem;align-items:center;margin-bottom:0.3rem";
    li.innerHTML = '<span class="editable-dashed" data-array="' + escHtml(name) + '" data-index="new" data-type="textarea" data-label="' + escHtml(name) + '" style="flex:1;min-height:1.2em"></span><button class="outline row-del" style="font-size:0.7rem;padding:0 0.3rem;flex-shrink:0" onclick="this.closest(\'li\').remove()">X</button>';
    list.appendChild(li);
    setTimeout(function () { var newSpan = li.querySelector(".editable-dashed"); if (newSpan) addDashSVG(newSpan); }, 20);
  };

  window.addTableRow = function (name, keys, headers) {
    var t = document.getElementById("table-" + name); if (!t) return;
    var tr = document.createElement("tr");
    var h = "";
    keys.forEach(function (k, i) {
      var label = (headers && headers[i]) ? headers[i] : k;
      h += '<td><span class="editable-dashed" data-table="' + escHtml(name) + '" data-row="new" data-key="' + escHtml(k) + '" data-label="' + escHtml(label) + '" data-type="textarea" style="display:block;min-width:60px;min-height:1.2em"></span></td>';
    });
    h += '<td><button class="outline row-del" style="font-size:0.7rem;padding:0 0.3rem" onclick="this.closest(\'tr\').remove()">X</button></td>';
    tr.innerHTML = h;
    t.querySelector("tbody").appendChild(tr);
    setTimeout(function () {
      tr.querySelectorAll(".editable-dashed").forEach(function (el) { addDashSVG(el); });
      setTimeout(_equalizeRowHeights, 30);
    }, 20);
  };

  // ---- Regenerate ----

  window.regenerate = function (expId) {
    var btn = document.getElementById("btn-regenerate"), s = document.getElementById("regen-status");
    btn.disabled = true; btn.textContent = "Regenerating..."; s.textContent = "";
    var notesEl = document.querySelector('.editable-dashed[data-field="original_notes"]');
    var notesContent = notesEl ? (notesEl.dataset.value !== undefined ? notesEl.dataset.value : notesEl.textContent.trim()) : "";
    var fd = new FormData(); fd.append("original_notes", notesContent);
    fetch("/experiments/" + expId + "/regenerate", {
      method: "POST", body: fd, headers: { "X-Exdiary-Client-Id": _clientIdHeader() }
    })
      .then(function (r) { return r.json(); })
      .then(function (r) {
        if (r.ok) { s.textContent = "Done."; setTimeout(_reloadCurrentPage, 600); }
        else { s.textContent = "Failed: " + (r.error || "unknown"); btn.disabled = false; btn.innerHTML = "Regenerate from Notes"; }
      })
      .catch(function (e) { s.textContent = "Failed: " + e.message; btn.disabled = false; btn.innerHTML = "Regenerate from Notes"; });
  };

  // ---- Modal 编辑 ----

  window.openEditModal = function (dashedEl) {
    if (!window._isEditing) return;
    window._editingTarget = dashedEl;
    var label = dashedEl.dataset.label || "", type = dashedEl.dataset.type || "text",
        value = dashedEl.dataset.value !== undefined ? dashedEl.dataset.value : dashedEl.textContent.trim();
    document.getElementById("edit-modal-label").textContent = label;
    var textarea = document.getElementById("edit-modal-input"),
        rich = document.getElementById("edit-modal-rich"),
        dateInput = document.getElementById("edit-modal-date"),
        toolbar = document.getElementById("edit-modal-toolbar");
    textarea.style.display = "none"; rich.style.display = "none"; dateInput.style.display = "none"; toolbar.style.display = "none";
    if (type === "date") {
      dateInput.value = value; dateInput.style.display = ""; dateInput.focus();
    } else if (type === "markdown" || type === "textarea" || type === "html") {
      toolbar.style.display = "";
      var html = value;
      if (type === "html") { /* keep as-is */ }
      else if (type === "markdown" && typeof marked !== "undefined") { html = marked.parse(value); }
      else { html = value.split("\n").map(function (line) { return line ? "<div>" + escHtml(line) + "</div>" : "<div><br></div>"; }).join(""); }
      rich.innerHTML = html; rich.style.display = ""; rich.focus();
    } else {
      textarea.value = value; textarea.style.display = ""; _autoResizeTextarea(textarea); textarea.focus(); textarea.select();
    }
    document.getElementById("edit-modal").classList.add("active");
  };

  function _autoResizeTextarea(ta) { ta.style.height = "auto"; ta.style.height = Math.max(36, ta.scrollHeight) + "px"; }

  window.closeEditModal = function (save) {
    if (save && window._editingTarget) {
      var type = window._editingTarget.dataset.type || "text", newValue;
      if (type === "date") { newValue = document.getElementById("edit-modal-date").value; }
      else if (type === "markdown" || type === "textarea" || type === "html") {
        newValue = document.getElementById("edit-modal-rich").innerText.trim();
      } else { newValue = document.getElementById("edit-modal-input").value; }
      window._editingTarget.dataset.value = newValue;
      if (type === "html") { window._editingTarget.innerHTML = newValue; }
      else if (type === "markdown" && typeof marked !== "undefined") {
        window._editingTarget.innerHTML = marked.parse(newValue);
        window._editingTarget.dataset.rendered = "1";
      } else if (type === "date") { window._editingTarget.textContent = newValue || "Not set"; }
      else { window._editingTarget.textContent = newValue; }
      addDashSVG(window._editingTarget);
      setTimeout(_equalizeRowHeights, 30);
      _updateEditDirtyState();
    }
    window._editingTarget = null;
    document.getElementById("edit-modal").classList.remove("active");
  };

  function _focusRich() { document.getElementById("edit-modal-rich").focus(); }
  window.execCmd = function (cmd, val) { _focusRich(); document.execCommand(cmd, false, val || null); };
  window.execLink = function () {
    _focusRich(); var sel = window.getSelection(); if (!sel.rangeCount) return;
    var url = prompt("URL:", "https://"); if (!url) return;
    if (sel.isCollapsed) { document.execCommand("insertHTML", false, '<a href="' + escHtml(url) + '" target="_blank">link</a>'); }
    else { document.execCommand("createLink", false, url); }
  };

  // ---- 事件委托: 编辑模式 ----

  document.addEventListener("click", function (e) {
    if (e.target.closest("#edit-modal")) return;
    var dashed = e.target.closest(".editable-dashed");
    if (dashed && window._isEditing) openEditModal(dashed);
  });
  document.addEventListener("click", function () {
    if (window._isEditing) setTimeout(_updateEditDirtyState, 0);
  });
  document.addEventListener("change", function () {
    if (window._isEditing) _updateEditDirtyState();
  });

  // ---- 归档 / 恢复 ----

  window.archiveExp = function (id, isArchived) {
    if (window._isEditing) return;
    var restoring = isArchived === true || isArchived === "true";
    var btn = document.getElementById("btn-archive");
    if (btn && btn.disabled) return;
    if (btn) { btn.disabled = true; btn.textContent = restoring ? "恢复中…" : "归档中…"; }
    fetch("/experiments/" + encodeURIComponent(id) + "/" + (restoring ? "restore" : "archive"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Exdiary-Client-Id": _clientIdHeader() },
      body: JSON.stringify({ expected_revision: Number(document.body.dataset.expRevision || 0) }),
    })
      .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
      .then(function (result) {
        if (!result.ok || !result.data.ok) {
          if (result.data && result.data.revision !== undefined) document.body.dataset.expRevision = result.data.revision;
          _showSaveFeedback((result.data && result.data.error) || "操作失败", "error", "重新加载", _reloadCurrentPage);
          if (btn) { btn.disabled = false; btn.textContent = restoring ? "恢复到实验列表" : "归档"; }
          return;
        }
        if (result.data.revision !== undefined) document.body.dataset.expRevision = result.data.revision;
        if (window.ExdiarySound) window.ExdiarySound.play("delete");
        _reloadCurrentPage();
      })
      .catch(function (error) {
        if (btn) { btn.disabled = false; btn.textContent = restoring ? "恢复到实验列表" : "归档"; }
        _showSaveFeedback("操作失败：" + error.message, "error", "重试", function () { window.archiveExp(id, isArchived); });
      });
  };

  // ---- 标签双击编辑 ----

  window.editTag = function (pill) {
    if (window._isEditing) return;
    if (pill.querySelector("input, button")) return;
    var orig = pill.textContent.trim();
    pill.innerHTML = '<input type="text" value="' + escHtml(orig) + '" style="font-size:0.75rem;width:8em;padding:0 2px;border:2px solid var(--black)">';
    var inp = pill.querySelector("input"); inp.focus(); inp.select();
    function commit() { var v = inp.value.trim(); if (v) pill.textContent = v; else pill.textContent = orig; }
    inp.addEventListener("blur", commit);
    inp.addEventListener("keydown", function (ev) { if (ev.key === "Enter") commit(); if (ev.key === "Escape") { pill.textContent = orig; } });
  };

  // ---- SOP/Next-steps 清理（全局函数，片段加载时也可调用） ----
  window.cleanupSopPrefixes = function (root) {
    root = root || document;
    var sopList = root.querySelector ? root.querySelector("#sop-list") : document.getElementById("sop-list");
    if (sopList) {
      sopList.querySelectorAll("li").forEach(function (li) { li.textContent = li.textContent.replace(/^(\d+[\.\、\)]\s*|Step\s*\d+\s*[：:]\s*)+/i, "").trim(); });
    }
    var nsView = root.querySelector ? root.querySelector("#next-steps-view") : document.getElementById("next-steps-view");
    if (nsView) { nsView.querySelectorAll("div").forEach(function (div) { div.textContent = div.textContent.replace(/^\[[ xX]\]\s*/, ""); }); }
  };

  document.addEventListener("DOMContentLoaded", function () { cleanupSopPrefixes(); });
})();
