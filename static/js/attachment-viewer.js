/* Application-local, read-only attachment preview. */
var AttachmentViewer = (function () {
  "use strict";

  function _url(item) {
    return item.url || "/api/attachments/" + encodeURIComponent(item.sha256);
  }

  function _headers() {
    var token = localStorage.getItem("exdiary_token") || "";
    return token ? { "Authorization": "Bearer " + token } : {};
  }

  async function downloadAttachment(item) {
    var url = new URL(_url(item) + "?download=1", window.location.origin).href;
    var name = item.name || "attachment";
    var api = window.pywebview && window.pywebview.api;
    if (api && typeof api.save_attachment === "function") {
      var result = await api.save_attachment(url, name, localStorage.getItem("exdiary_token") || "");
      if (!result || !result.ok) {
        if (result && result.cancelled) return result;
        throw new Error((result && result.error) || "附件下载失败");
      }
      return result;
    }
    var link = document.createElement("a");
    link.href = url; link.download = name;
    document.body.appendChild(link); link.click(); link.remove();
    return { ok: true };
  }

  function _kind(item) {
    var name = (item.name || "").toLowerCase();
    var mime = (item.mime || "").toLowerCase();
    if (name.endsWith(".xlsx") || mime.indexOf("spreadsheetml") >= 0) return "xlsx";
    if (name.endsWith(".csv") || name.endsWith(".tsv") || mime === "text/csv") return "table";
    if (name.endsWith(".txt") || mime.indexOf("text/") === 0) return "text";
    if (name.endsWith(".pdf") || mime === "application/pdf") return "pdf";
    if (mime.indexOf("image/") === 0 || /\.(png|jpe?g|gif|webp|bmp)$/i.test(name)) return "image";
    return "file";
  }

  function _modal(item) {
    var overlay = document.createElement("div");
    overlay.className = "attachment-preview-overlay";
    overlay.style.cssText = "position:fixed;inset:0;z-index:10050;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:1rem";
    var panel = document.createElement("section");
    panel.className = "attachment-preview-panel";
    panel.style.cssText = "width:min(1180px,96vw);height:min(820px,92vh);box-sizing:border-box;background:var(--white,#fff);border:3px solid var(--black,#111);display:flex;flex-direction:column;box-shadow:12px 12px 0 rgba(0,0,0,.28)";
    var head = document.createElement("header");
    head.className = "attachment-preview-head";
    head.style.cssText = "display:flex;gap:.7rem;align-items:center;padding:.55rem .75rem;background:var(--black,#111);color:#fff;font-weight:800;min-width:0";
    var title = document.createElement("span"); title.className = "attachment-preview-title"; title.textContent = item.name || "附件"; title.style.cssText = "flex:1;min-width:0;overflow-wrap:anywhere";
    var body = document.createElement("div"); body.className = "attachment-preview-body"; body.style.cssText = "flex:1;min-height:0;overflow:hidden;padding:.75rem;display:flex;flex-direction:column";
    var zoom = 100;
    var zoomLabel = document.createElement("span"); zoomLabel.className = "attachment-preview-zoom-label"; zoomLabel.textContent = "100%"; zoomLabel.style.cssText = "min-width:3.1rem;text-align:center;font-size:.78rem";
    var setZoom = function (next) {
      zoom = Math.max(50, Math.min(200, next));
      body._attachmentZoom = zoom;
      zoomLabel.textContent = zoom + "%";
      body.querySelectorAll(".attachment-preview-zoomable").forEach(function (element) { element.style.zoom = zoom + "%"; });
    };
    var zoomOut = document.createElement("button"); zoomOut.type = "button"; zoomOut.textContent = "−"; zoomOut.title = "缩小";
    var zoomReset = document.createElement("button"); zoomReset.type = "button"; zoomReset.textContent = "100%"; zoomReset.title = "恢复原始大小";
    var zoomIn = document.createElement("button"); zoomIn.type = "button"; zoomIn.textContent = "＋"; zoomIn.title = "放大";
    [zoomOut, zoomReset, zoomIn].forEach(function (button) { button.style.cssText = "font-weight:800;cursor:pointer;min-width:1.8rem"; });
    zoomOut.addEventListener("click", function () { setZoom(zoom - 10); });
    zoomReset.addEventListener("click", function () { setZoom(100); });
    zoomIn.addEventListener("click", function () { setZoom(zoom + 10); });
    var download = document.createElement("button"); download.type = "button"; download.textContent = "下载"; download.style.cssText = "color:#fff;font-size:.8rem;cursor:pointer";
    download.addEventListener("click", function () {
      downloadAttachment(item).catch(function (error) { window.alert(error.message || "附件下载失败"); });
    });
    var close = document.createElement("button"); close.type = "button"; close.className = "attachment-preview-close"; close.textContent = "关闭"; close.style.cssText = "font-weight:800;cursor:pointer";
    var controls = document.createElement("div"); controls.className = "attachment-preview-controls";
    controls.style.cssText = "display:flex;gap:.35rem;align-items:center;flex-shrink:0";
    controls.append(zoomOut, zoomLabel, zoomReset, zoomIn, download);
    head.append(title, controls, close);
    panel.append(head, body); overlay.appendChild(panel); document.body.appendChild(overlay);
    var dismiss = function () { overlay.remove(); document.removeEventListener("keydown", onKey); };
    var onKey = function (event) { if (event.key === "Escape") dismiss(); };
    close.addEventListener("click", dismiss);
    document.addEventListener("keydown", onKey);
    return body;
  }

  function _applyExcelStyle(cell, style) {
    if (!style) return;
    var font = style.font || {};
    if (font.family) cell.style.fontFamily = font.family;
    if (font.size) cell.style.fontSize = font.size + "px";
    if (font.bold) cell.style.fontWeight = "700";
    if (font.italic) cell.style.fontStyle = "italic";
    if (font.underline || font.strike) {
      cell.style.textDecoration = (font.underline ? "underline" : "") + (font.strike ? " line-through" : "");
    }
    if (font.color) cell.style.color = font.color;
    if (style.fill) cell.style.backgroundColor = style.fill;
    var alignment = style.alignment || {};
    if (alignment.horizontal) cell.style.textAlign = alignment.horizontal;
    if (alignment.vertical) cell.style.verticalAlign = alignment.vertical;
    if (alignment.wrap) { cell.style.whiteSpace = "pre-wrap"; cell.style.overflowWrap = "anywhere"; }
    if (alignment.rotation) cell.style.transform = "rotate(" + alignment.rotation + "deg)";
    var borders = style.borders || {};
    if (borders.left) cell.style.borderLeft = borders.left;
    if (borders.right) cell.style.borderRight = borders.right;
    if (borders.top) cell.style.borderTop = borders.top;
    if (borders.bottom) cell.style.borderBottom = borders.bottom;
  }

  function _escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (char) {
      return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[char];
    });
  }

  function _selectionPayload(selection, values) {
    if (!selection.anchor || !selection.focus) return null;
    var minRow = Math.min(selection.anchor.row, selection.focus.row);
    var maxRow = Math.max(selection.anchor.row, selection.focus.row);
    var minCol = Math.min(selection.anchor.col, selection.focus.col);
    var maxCol = Math.max(selection.anchor.col, selection.focus.col);
    var textRows = [], htmlRows = [];
    for (var row = minRow; row <= maxRow; row++) {
      var textCells = [], htmlCells = [];
      for (var col = minCol; col <= maxCol; col++) {
        var key = row + ":" + col;
        var value = Object.prototype.hasOwnProperty.call(values, key) ? values[key] : "";
        textCells.push(String(value).replace(/[\t\r\n]+/g, " "));
        htmlCells.push("<td>" + _escapeHtml(value).replace(/\n/g, "<br>") + "</td>");
      }
      textRows.push(textCells.join("\t"));
      htmlRows.push("<tr>" + htmlCells.join("") + "</tr>");
    }
    return { text: textRows.join("\n"), html: "<table><tbody>" + htmlRows.join("") + "</tbody></table>" };
  }

  function _copyTablePayload(table, payload, notice) {
    if (!payload) { notice("请先拖拽选择单元格"); return; }
    var handled = false;
    var onCopy = function (event) {
      if (!event.clipboardData) return;
      event.clipboardData.setData("text/plain", payload.text);
      event.clipboardData.setData("text/html", payload.html);
      event.preventDefault(); handled = true;
    };
    document.addEventListener("copy", onCopy, { once: true });
    table.focus();
    if (document.execCommand && document.execCommand("copy") && handled) {
      notice("已复制所选单元格，可粘贴到 Excel/WPS"); return;
    }
    document.removeEventListener("copy", onCopy);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(payload.text).then(function () {
        notice("已复制所选单元格");
      }).catch(function () { notice("复制失败，请使用 Ctrl+C"); });
    } else {
      notice("复制失败，请使用 Ctrl+C");
    }
  }

  function _table(body, rows, columns, startRow, preview) {
    var wrap = document.createElement("div"); wrap.style.cssText = "flex:1 1 auto;min-height:0;overflow:auto;border:2px solid var(--black,#111)";
    var table = document.createElement("table"); table.className = "attachment-preview-zoomable"; table.tabIndex = 0; table.style.cssText = "border-collapse:collapse;width:max-content;min-width:100%;font-size:.82rem;outline:none;zoom:" + (body._attachmentZoom || 100) + "%";
    var widths = (preview && preview.column_widths) || {};
    var colgroup = document.createElement("colgroup");
    var rowNumberCol = document.createElement("col"); rowNumberCol.style.width = "3.4rem"; colgroup.appendChild(rowNumberCol);
    (columns || []).forEach(function (column) {
      var col = document.createElement("col");
      if (widths[column]) col.style.width = widths[column] + "px";
      colgroup.appendChild(col);
    });
    table.appendChild(colgroup);
    var head = document.createElement("thead"), tr = document.createElement("tr"), corner = document.createElement("th");
    corner.textContent = "#"; tr.appendChild(corner);
    (columns || []).forEach(function (column) { var th = document.createElement("th"); th.textContent = column; tr.appendChild(th); });
    head.appendChild(tr); table.appendChild(head);
    var tbody = document.createElement("tbody");
    var mergeStarts = {}, mergedCovered = {}, cellValues = {};
    ((preview && preview.merged_cells) || []).forEach(function (merge) {
      var start = merge.start_row + ":" + merge.start_col;
      mergeStarts[start] = merge;
      for (var rowIndex = merge.start_row; rowIndex <= merge.end_row; rowIndex++) {
        for (var colIndex = merge.start_col; colIndex <= merge.end_col; colIndex++) {
          if (rowIndex !== merge.start_row || colIndex !== merge.start_col) mergedCovered[rowIndex + ":" + colIndex] = true;
        }
      }
    });
    (rows || []).forEach(function (row, index) {
      var rowNumber = (startRow || 1) + index;
      var line = document.createElement("tr"), num = document.createElement("th"); num.textContent = String(rowNumber); line.appendChild(num);
      var rowHeights = (preview && preview.row_heights) || {};
      if (rowHeights[String(rowNumber)]) line.style.height = rowHeights[String(rowNumber)] + "px";
      row.forEach(function (value, columnIndex) {
        var columnNumber = columnIndex + 1;
        cellValues[rowNumber + ":" + columnNumber] = value;
        if (mergedCovered[rowNumber + ":" + columnNumber]) return;
        var td = document.createElement("td"); td.textContent = value;
        td.dataset.excelRow = rowNumber;
        td.dataset.excelCol = columnNumber;
        var merge = mergeStarts[rowNumber + ":" + columnNumber];
        if (merge) {
          td.rowSpan = merge.end_row - merge.start_row + 1;
          td.colSpan = merge.end_col - merge.start_col + 1;
        }
        var coordinate = (columns[columnIndex] || "") + rowNumber;
        _applyExcelStyle(td, preview && preview.cell_styles && preview.cell_styles[coordinate]);
        line.appendChild(td);
      });
      tbody.appendChild(line);
    });
    table.appendChild(tbody); wrap.appendChild(table); body.appendChild(wrap);
    table.querySelectorAll("th,td").forEach(function (cell) {
      cell.style.padding = ".28rem .45rem";
      if (!cell.style.whiteSpace) cell.style.whiteSpace = "pre-wrap";
      if (!cell.style.verticalAlign) cell.style.verticalAlign = "top";
      if (!cell.style.border && !cell.style.borderLeft) cell.style.borderLeft = "1px solid #777";
      if (!cell.style.border && !cell.style.borderRight) cell.style.borderRight = "1px solid #777";
      if (!cell.style.border && !cell.style.borderTop) cell.style.borderTop = "1px solid #777";
      if (!cell.style.border && !cell.style.borderBottom) cell.style.borderBottom = "1px solid #777";
    });

    var selection = { anchor: null, focus: null }, dragging = false;

    function selectCell(cell, extend) {
      if (!cell) return;
      var point = { row: Number(cell.dataset.excelRow), col: Number(cell.dataset.excelCol) };
      if (!extend || !selection.anchor) selection.anchor = point;
      selection.focus = point;
      var minRow = Math.min(selection.anchor.row, selection.focus.row);
      var maxRow = Math.max(selection.anchor.row, selection.focus.row);
      var minCol = Math.min(selection.anchor.col, selection.focus.col);
      var maxCol = Math.max(selection.anchor.col, selection.focus.col);
      table.querySelectorAll("td[data-excel-row]").forEach(function (item) {
        var row = Number(item.dataset.excelRow), col = Number(item.dataset.excelCol);
        var selected = row >= minRow && row <= maxRow && col >= minCol && col <= maxCol;
        item.style.boxShadow = selected ? "inset 0 0 0 9999px rgba(58,145,255,.24)" : "";
      });
    }

    function selectedPayload() { return _selectionPayload(selection, cellValues); }
    function copySelected() { _copyTablePayload(table, selectedPayload(), function () {}); }
    table.addEventListener("mousedown", function (event) {
      var cell = event.target.closest("td[data-excel-row]");
      if (!cell || !table.contains(cell)) return;
      event.preventDefault(); table.focus(); dragging = true; selectCell(cell, event.shiftKey);
    });
    table.addEventListener("mouseover", function (event) {
      if (!dragging) return;
      var cell = event.target.closest("td[data-excel-row]");
      if (cell && table.contains(cell)) selectCell(cell, true);
    });
    table.addEventListener("mouseup", function () { dragging = false; });
    table.addEventListener("keydown", function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") { event.preventDefault(); copySelected(); }
      if (event.key === "Escape") { selection.anchor = null; selection.focus = null; table.querySelectorAll("td[data-excel-row]").forEach(function (cell) { cell.style.boxShadow = ""; }); }
    });
    table.addEventListener("copy", function (event) {
      var payload = selectedPayload();
      if (!payload || !event.clipboardData) return;
      event.clipboardData.setData("text/plain", payload.text);
      event.clipboardData.setData("text/html", payload.html);
      event.preventDefault();
    });
  }

  async function _structuredPreview(item, body) {
    var base = _url(item) + "/preview";
    var render = async function (sheet, startRow) {
      body.textContent = "正在加载预览…";
      var params = [];
      if (sheet) params.push("sheet=" + encodeURIComponent(sheet));
      if (startRow && startRow > 1) params.push("start_row=" + encodeURIComponent(startRow));
      var url = base + (params.length ? "?" + params.join("&") : "");
      var response = await fetch(url, { headers: _headers() });
      var raw = await response.text();
      var data = {};
      try { data = JSON.parse(raw); } catch (_) { /* 服务端可能返回了 HTML 错误页 */ }
      if (!response.ok || !data.ok) {
        throw new Error(data.error || ("附件预览接口不可用（HTTP " + response.status + "），请重启 ExperMate｜小同门后重试。"));
      }
      body.innerHTML = "";
      if (data.kind === "xlsx") {
        var tabs = document.createElement("div"); tabs.style.cssText = "display:flex;gap:.35rem;flex-wrap:wrap;margin-bottom:.65rem";
        data.sheets.forEach(function (info) {
          var button = document.createElement("button"); button.type = "button"; button.textContent = info.name + " (" + info.rows + "×" + info.columns + ")";
          button.className = "outline"; button.style.fontSize = ".72rem"; button.disabled = info.name === data.sheet;
          button.addEventListener("click", function () { render(info.name, 1).catch(showError); }); tabs.appendChild(button);
        });
        body.appendChild(tabs); _table(body, data.rows, data.columns, data.start_row, data);
        if (data.start_row > 1 || data.has_more) {
          var pager = document.createElement("div"); pager.style.cssText = "display:flex;gap:.45rem;align-items:center;margin-top:.55rem";
          if (data.start_row > 1) { var prev = document.createElement("button"); prev.type = "button"; prev.className = "outline"; prev.textContent = "上一页"; prev.addEventListener("click", function () { render(data.sheet, Math.max(1, data.start_row - 200)).catch(showError); }); pager.appendChild(prev); }
          if (data.has_more) { var next = document.createElement("button"); next.type = "button"; next.className = "outline"; next.textContent = "下一页"; next.addEventListener("click", function () { render(data.sheet, data.start_row + 200).catch(showError); }); pager.appendChild(next); }
          var note = document.createElement("small"); note.textContent = "显示第 " + data.start_row + "–" + (data.start_row + data.rows.length - 1) + " 行"; pager.appendChild(note); body.appendChild(pager);
        }
      } else if (data.kind === "table") {
        var width = Math.max.apply(null, data.rows.map(function (row) { return row.length; }).concat([0]));
        _table(body, data.rows, Array.from({length: width}, function (_, i) { return "列 " + (i + 1); }), 1);
      } else {
        var pre = document.createElement("pre"); pre.textContent = data.content || ""; pre.style.cssText = "margin:0;white-space:pre-wrap;word-break:break-word;font:13px/1.5 ui-monospace,Consolas,monospace"; body.appendChild(pre);
      }
    };
    var showError = function (error) { body.textContent = error.message || "附件预览失败"; };
    await render("", 1);
  }

  async function open(item) {
    var body = _modal(item), kind = _kind(item);
    if (kind === "pdf") {
      var frame = document.createElement("iframe"); frame.src = _url(item); frame.title = item.name || "PDF"; frame.style.cssText = "width:100%;height:100%;border:0"; body.style.padding = "0"; body.appendChild(frame); return;
    }
    if (kind === "image") {
      var image = document.createElement("img"); image.src = _url(item); image.alt = item.name || "图片附件"; image.style.cssText = "display:block;max-width:100%;max-height:100%;margin:auto;object-fit:contain"; body.style.background = "#222"; body.appendChild(image); return;
    }
    if (kind === "xlsx" || kind === "table" || kind === "text") {
      try { await _structuredPreview(item, body); } catch (error) { body.textContent = error.message || "附件预览失败"; }
      return;
    }
    body.textContent = "该文件类型暂不支持应用内预览，请下载后打开。";
  }

  return { open: open, download: downloadAttachment };
})();
