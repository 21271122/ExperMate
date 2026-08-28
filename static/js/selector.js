/* Experiment selector panel */
<!-- ============================================================
     _selector_scripts.html — 实验选择卡片交互 JS
     用于 select_experiments 工具渲染，需在 new.html 的 scope 中 include
     依赖：_agentState, saveAgentState(), lockInput(), sendMessage()
     ============================================================ -->


var _selectorModalOpen = false;  // 子对话框是否打开
var _selectorModalChecked = {};  // 子对话框中的勾选状态 {expId: true}

// -- 全选/取消全选（单个切换按钮） --
function selToggleBtn(btn) {
  var card = btn.closest('.sel-card');
  var checks = card.querySelectorAll('.sel-check');
  var allChecked = true;
  checks.forEach(function(ch) { if (!ch.classList.contains('checked')) allChecked = false; });
  checks.forEach(function(ch) {
    if (allChecked) ch.classList.remove('checked');
    else ch.classList.add('checked');
  });
  btn.textContent = allChecked ? '☑ 全选' : '☐ 取消全选';
  updateSelCount(card);
  syncModalFromCard(card);
}

// -- 勾选框点击 --
function selItemClick(el) {
  var card = el.closest('.sel-card');
  if (!card || card.dataset.status !== 'active') return;
  var check = el.querySelector('.sel-check');
  check.classList.toggle('checked');
  updateSelCount(card);
  syncModalFromCard(card);
}

// -- 整行点击切换 --
function selRowClick(el) {
  selItemClick(el);
}

// -- 更新计数显示 --
function updateSelCount(card) {
  var count = card.querySelectorAll('.sel-check.checked').length;
  var el = card.querySelector('.sel-count b');
  if (el) el.textContent = count;
  var confirmBtn = card.querySelector('.sel-btn-confirm');
  if (confirmBtn) confirmBtn.textContent = '确认选择 (' + count + ')';
}

// -- 确认选择 --
function confirmSelector(btn) {
  var card = btn.closest('.sel-card');
  var checked = card.querySelectorAll('.sel-check.checked');
  var ids = [];
  checked.forEach(function(ch) { ids.push(ch.closest('.sel-item').dataset.expId); });
  if (!ids.length) return;

  // 替换 history 中原始 tool 消息 content
  var tcId = card.dataset.toolCallId;
  if (tcId && _agentState) {
    for (var i = _agentState.history.length - 1; i >= 0; i--) {
      var m = _agentState.history[i];
      if (m.role === 'tool' && m.tool_call_id === tcId) {
        try {
          var orig = JSON.parse(typeof m.content === 'string' ? m.content : '{}');
          orig.status = 'confirmed';
          orig.selected_ids = ids;
          m.content = JSON.stringify(orig);
        } catch(e) {}
        break;
      }
    }
  }

  // 卡片变形：移除列表 → 显示确认状态
  card.dataset.status = 'confirmed';
  var body = card.querySelector('.sel-body');
  var topbar = card.querySelector('.sel-topbar');
  var bottombar = card.querySelector('.sel-bottombar');
  if (body) body.remove();
  if (topbar) topbar.remove();
  if (bottombar) bottombar.remove();
  var statusEl = document.createElement('div');
  statusEl.className = 'sel-status-text confirmed';
  statusEl.textContent = '已选择 ' + ids.length + ' 个实验: ' + ids.join(', ');
  card.appendChild(statusEl);

  saveAgentState();
  lockInput(false);

  // 继续 Agent 循环
  document.getElementById('chat-input').value = '已选择实验: ' + ids.join(', ') + '。请继续分析。';
  document.getElementById('btn-send').click();
}

// -- 取消选择 --
function cancelSelector(btn) {
  var card = btn.closest('.sel-card');

  // 替换 history 中原始 tool 消息 content
  var tcId = card.dataset.toolCallId;
  if (tcId && _agentState) {
    for (var i = _agentState.history.length - 1; i >= 0; i--) {
      var m = _agentState.history[i];
      if (m.role === 'tool' && m.tool_call_id === tcId) {
        try {
          var orig = JSON.parse(typeof m.content === 'string' ? m.content : '{}');
          orig.status = 'cancelled';
          m.content = JSON.stringify(orig);
        } catch(e) {}
        break;
      }
    }
  }

  // 卡片变形：移除列表 → 显示取消状态
  card.dataset.status = 'cancelled';
  var body = card.querySelector('.sel-body');
  var topbar = card.querySelector('.sel-topbar');
  var bottombar = card.querySelector('.sel-bottombar');
  if (body) body.remove();
  if (topbar) topbar.remove();
  if (bottombar) bottombar.remove();
  var statusEl = document.createElement('div');
  statusEl.className = 'sel-status-text cancelled';
  statusEl.textContent = '已取消选择';
  card.appendChild(statusEl);

  saveAgentState();
  lockInput(false);

  // 继续 Agent 循环
  document.getElementById('chat-input').value = '已取消选择。继续对话。';
  document.getElementById('btn-send').click();
}

// -- "查看更多" → 弹出子对话框 --
function selShowMoreBtn(btn) {
  var card = btn.closest('.sel-card');
  var allItems = JSON.parse(btn.dataset.allItems || '[]');

  // 收集当前主列表勾选状态
  _selectorModalChecked = {};
  card.querySelectorAll('.sel-check.checked').forEach(function(ch) {
    _selectorModalChecked[ch.closest('.sel-item').dataset.expId] = true;
  });

  // 构建 modal HTML
  var overlay = document.createElement('div');
  overlay.className = 'sel-modal-overlay';
  overlay.id = 'sel-modal-overlay';

  var modal = document.createElement('div');
  modal.className = 'sel-modal';

  // 搜索框
  var searchHtml = '<div class="sel-modal-search"><input type="text" placeholder="搜索实验（ID / 标题 / 标签 / 材料）" oninput="selModalSearch(this)" autofocus></div>';

  // 列表
  var listHtml = '<div class="sel-modal-list" id="sel-modal-list">';
  allItems.forEach(function(item) {
    var checked = _selectorModalChecked[item.id] ? ' checked' : '';
    listHtml += '<div class="sel-item" data-exp-id="' + escHtml(item.id) + '" onclick="selModalItemClick(this)">';
    listHtml += '<span class="sel-check' + checked + '">&#x2713;</span>';
    listHtml += '<span class="sel-id">' + escHtml(item.id) + '</span>';
    listHtml += '<span class="sel-title">' + escHtml(item.title || '') + '</span>';
    listHtml += '<span class="sel-date">' + (item.date || '') + '</span>';
    listHtml += '</div>';
  });
  listHtml += '</div>';

  // 底部栏
  var checkedCount = Object.keys(_selectorModalChecked).length;
  var bottomHtml = '<div class="sel-modal-bottombar">';
  bottomHtml += '<span class="sel-count" id="sel-modal-count">已选 <b>' + checkedCount + '</b> 个</span>';
  bottomHtml += '<span class="sel-actions">';
  bottomHtml += '<button onclick="selModalCancel()" class="sel-btn-cancel">取消</button>';
  bottomHtml += '<button onclick="selModalConfirm()" class="sel-btn-confirm">确认 (' + checkedCount + ')</button>';
  bottomHtml += '</span></div>';

  modal.innerHTML = searchHtml + listHtml + bottomHtml;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // 点击遮罩关闭
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) closeSelectorModal(card);
  });

  _selectorModalOpen = true;
}

// -- 子对话框：搜索过滤 --
function selModalSearch(input) {
  var query = input.value.toLowerCase();
  var items = document.querySelectorAll('#sel-modal-list .sel-item');
  items.forEach(function(item) {
    var text = (item.textContent || '').toLowerCase();
    item.style.display = query ? (text.indexOf(query) >= 0 ? '' : 'none') : '';
  });
}

// -- 子对话框：条目点击切换 --
function selModalItemClick(el) {
  var check = el.querySelector('.sel-check');
  check.classList.toggle('checked');
  var expId = el.dataset.expId;
  if (check.classList.contains('checked')) {
    _selectorModalChecked[expId] = true;
  } else {
    delete _selectorModalChecked[expId];
  }
  updateModalCount();
}

// -- 子对话框：更新计数 --
function updateModalCount() {
  var count = Object.keys(_selectorModalChecked).length;
  var el = document.getElementById('sel-modal-count');
  if (el) el.innerHTML = '已选 <b>' + count + '</b> 个';
  var confirmBtn = document.querySelector('.sel-btn-confirm');
  if (confirmBtn) confirmBtn.textContent = '确认 (' + count + ')';
}

// -- 子对话框：确认 --
function selModalConfirm() {
  var card = document.querySelector('.sel-card[data-tool="selector"]');
  if (!card) return;
  // 同步勾选到主列表
  card.querySelectorAll('.sel-item').forEach(function(item) {
    var expId = item.dataset.expId;
    var check = item.querySelector('.sel-check');
    if (_selectorModalChecked[expId]) {
      check.classList.add('checked');
    } else {
      check.classList.remove('checked');
    }
  });
  closeSelectorModal(card);
}

// -- 子对话框：取消 --
function selModalCancel() {
  var card = document.querySelector('.sel-card[data-tool="selector"]');
  closeSelectorModal(card);
}

// -- 关闭子对话框 --
function closeSelectorModal(card) {
  var overlay = document.getElementById('sel-modal-overlay');
  if (overlay) overlay.remove();
  _selectorModalOpen = false;
  if (card) updateSelCount(card);
}

// -- 同步主列表勾选 → 子对话框 --
function syncModalFromCard(card) {
  if (!_selectorModalOpen) return;
  card.querySelectorAll('.sel-item').forEach(function(item) {
    var expId = item.dataset.expId;
    var check = item.querySelector('.sel-check');
    if (check.classList.contains('checked')) {
      _selectorModalChecked[expId] = true;
    } else {
      delete _selectorModalChecked[expId];
    }
  });
  updateModalCount();
}
