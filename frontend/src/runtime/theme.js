import { services } from './services';
/**
 * theme.js — 深色模式切换（跟随系统 + 手动覆盖）
 *   localStorage 'exdiary_theme': 'dark' | 'light' = 手动偏好；缺失/其他 = 跟随系统
 *   应用方式：<html data-theme="dark|light">，令牌在 de-stijl.css [data-theme="dark"] 定义
 */
export function initializeTheme(scope) {
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

  function refreshUI() { updateButton(); }

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
    scope.listen(mq, "change", function () {
      if (!currentPref()) { apply(systemTheme()); refreshUI(); }
    });
  } else if (mq && mq.addListener) {
    var changed = function () {
      if (!currentPref()) { apply(systemTheme()); refreshUI(); }
    };
    mq.addListener(changed);
    scope.cleanup(function () { mq.removeListener(changed); });
  }

  if (document.readyState === "loading") scope.listen(document, "DOMContentLoaded", refreshUI);
  else refreshUI();

  const api = {
    setPref: setPref,
    toggleTheme: toggleTheme,
    resolvedTheme: resolvedTheme,
    updateButton: updateButton
  };
  services.ExdiaryTheme = api;
  return api;
}
