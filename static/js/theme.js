/**
 * theme.js — 深色模式切换（跟随系统 + 手动覆盖）
 *   localStorage 'exdiary_theme': 'dark' | 'light' = 手动偏好；缺失/其他 = 跟随系统
 *   应用方式：<html data-theme="dark|light">，令牌在 de-stijl.css [data-theme="dark"] 定义
 */
(function () {
  "use strict";

  var KEY = "exdiary_theme";

  function currentPref() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }

  function systemTheme() {
    return (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
  }

  function resolvedTheme() {
    var t = currentPref();
    return t === "dark" || t === "light" ? t : systemTheme();
  }

  function apply(theme) {
    document.documentElement.setAttribute("data-theme", theme);
  }

  /* 顶部栏按钮图标：深色显示太阳（点击回浅色），浅色显示月亮（点击进深色） */
  function updateButton() {
    var btn = document.getElementById("chat-header-theme");
    if (!btn) return;
    btn.textContent = resolvedTheme() === "dark" ? "☀" : "☾";
    btn.title = resolvedTheme() === "dark" ? "浅色模式" : "深色模式";
  }

  /* 设置页三态 chips 高亮 */
  function updateChips() {
    var box = document.getElementById("theme-options");
    if (!box) return;
    var pref = currentPref() || "system";
    box.querySelectorAll(".filter-chip").forEach(function (c) {
      c.classList.toggle("active", c.dataset.pref === pref);
    });
  }

  function refreshUI() {
    updateButton();
    updateChips();
  }

  function setPref(pref) {
    try {
      if (pref === "dark" || pref === "light") localStorage.setItem(KEY, pref);
      else localStorage.removeItem(KEY);
    } catch (e) {}
    apply(resolvedTheme());
    refreshUI();
  }

  function toggleTheme() {
    setPref(resolvedTheme() === "dark" ? "light" : "dark");
  }

  /* 跟随系统：仅当无手动偏好时，实时响应系统主题变化 */
  var mq = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
  if (mq && mq.addEventListener) {
    mq.addEventListener("change", function () {
      if (!currentPref()) { apply(systemTheme()); refreshUI(); }
    });
  } else if (mq && mq.addListener) {
    mq.addListener(function () {
      if (!currentPref()) { apply(systemTheme()); refreshUI(); }
    });
  }

  /* 设置页 chips：document 级事件委托（SPA 中设置页以 fragment 动态注入，委托对动态元素同样生效） */
  document.addEventListener("click", function (e) {
    var chip = e.target.closest && e.target.closest("#theme-options .filter-chip");
    if (chip && chip.dataset.pref) setPref(chip.dataset.pref);
  });

  document.addEventListener("DOMContentLoaded", refreshUI);

  window.ExdiaryTheme = {
    setPref: setPref,
    toggleTheme: toggleTheme,
    resolvedTheme: resolvedTheme,
    updateButton: updateButton
  };
})();
