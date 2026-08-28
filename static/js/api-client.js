/**
 * api-client.js — 统一 fetch 封装，覆盖所有 API 调用模式。
 * 全局事件委托注册在 body 上，兼容 HTMX 动态插入的 DOM 元素。
 */
(function () {
  "use strict";

  // ---- 工具函数 ----

  window.escHtml = function (s) {
    var d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  };

  // ---- 事件委托: HTMX 动态元素 ----

  if (typeof htmx !== "undefined") {
    htmx.on("htmx:afterSwap", function () {
      // Markdown 渲染
      document.querySelectorAll(".markdown-content:not([data-rendered])").forEach(
        function (el) {
          if (typeof marked !== "undefined") {
            el.innerHTML = marked.parse(el.textContent);
            el.dataset.rendered = "1";
          }
        }
      );
    });
  }

  // DOMContentLoaded 时渲染已有 Markdown
  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll(".markdown-content").forEach(function (el) {
      if (el.dataset.rendered) return;
      if (typeof marked !== "undefined") {
        el.innerHTML = marked.parse(el.textContent);
        el.dataset.rendered = "1";
      }
    });
  });
})();
