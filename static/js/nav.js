/* Navigation history system (sessionStorage) */
// Global: render markdown content blocks
document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('.markdown-content').forEach(function(el) {
    if (el.dataset.rendered) return;
    el.innerHTML = marked.parse(el.textContent);
    el.dataset.rendered = '1';
  });
});

// Global: observe new content added by htmx
if (typeof htmx !== 'undefined') {
  htmx.on('htmx:afterSwap', function() {
    document.querySelectorAll('.markdown-content:not([data-rendered])').forEach(function(el) {
      el.innerHTML = marked.parse(el.textContent);
      el.dataset.rendered = '1';
    });
  });
}

// ===== Navigation history system (sessionStorage) =====
(function() {
  var STORAGE_KEY = 'exdiary_nav';
  var pageId = document.body.dataset.page || 'unknown';

  function loadNavData() {
    try {
      return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{"history":[],"states":{},"isBack":false}');
    } catch(e) {
      return {history: [], states: {}, isBack: false};
    }
  }

  function saveNavData(data) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch(e) {}
  }

  var navData = loadNavData();

  var state = navData.states[pageId];
  if (state !== undefined && typeof window.restorePageState === 'function') {
    window.restorePageState(state);
  }
  if (navData.isBack) {
    navData.isBack = false;
    saveNavData(navData);
  }

  function isInternalNav(href) {
    if (!href || href === '#') return false;
    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//')) return false;
    if (href.startsWith('javascript:')) return false;
    if (href.startsWith('/api/')) {
      if (href === '/api/favorites' || href === '/api/list-collections') return true;
      return false;
    }
    if (href.startsWith('/uploads/')) return false;
    return true;
  }

  async function navigateTo(url, origin) {
    if (typeof window.savePageState === 'function') {
      var state = window.savePageState();
      if (state !== undefined) {
        navData.states[pageId] = state;
      }
    }

    if (navData.history.length > 0) {
      var lastEntry = navData.history[navData.history.length - 1];
      var lastParsed = new URL(lastEntry.url);
      var targetParsed = new URL(url, window.location.origin);
      if (lastParsed.pathname === targetParsed.pathname && lastParsed.search === targetParsed.search) {
        navData.history.pop();
        navData.isBack = true;
        saveNavData(navData);
        if (window.ExMotion) await window.ExMotion.begin(url, origin);
        window.location.href = url;
        return;
      }
    }

    navData.history.push({page: pageId, url: window.location.href});
    navData.isBack = false;
    saveNavData(navData);
    if (window.ExMotion) await window.ExMotion.begin(url, origin);
    window.location.href = url;
  }

  document.addEventListener('click', function(e) {
    if (e.target.closest('.edit-modal-overlay')) return;
    if (e.target.closest('.ql-toolbar') || e.target.closest('.ql-editor')) return;
    var link = e.target.closest('a');
    if (!link) return;
    var href = link.getAttribute('href');
    if (!isInternalNav(href)) return;
    if (link.getAttribute('target') === '_blank') return;
    if (link.hasAttribute('download')) return;
    e.preventDefault();
    navigateTo(href, link);
  });

  window.navigateToPage = function(url) {
    navigateTo(url);
  };
})();
