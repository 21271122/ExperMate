/* Exdiary motion manager. Keeps page changes and controls feeling related. */
(function () {
  "use strict";

  var prefersReduced = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var activeBlock = null;
  var isTransitioning = false;

  var ROUTE_COLORS = [
    { re: /^\/experiments(?:\/|$)?/, color: "var(--black)" },
    { re: /^\/analyze(?:\/|$)?/, color: "#E32636" },
    { re: /^\/analysis(?:\/|$)?/, color: "#E32636" },
    { re: /^\/compare(?:\/|$)?/, color: "#E32636" },
    { re: /^\/timeline(?:\/|$)?/, color: "#1D54A6" },
    { re: /^\/favorites(?:\/|$)?/, color: "#F8D030" },
    { re: /^\/settings(?:\/|$)?/, color: "var(--white)" },
    { re: /^\/templates(?:\/|$)?/, color: "var(--white)" },
    { re: /^\/login(?:\/|$)?/, color: "var(--white)" },
  ];

  function routeColor(path) {
    path = path || window.location.pathname || "/";
    for (var i = 0; i < ROUTE_COLORS.length; i++) {
      if (ROUTE_COLORS[i].re.test(path)) return ROUTE_COLORS[i].color;
    }
    return "var(--black)";
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function rectFromOrigin(origin) {
    if (origin && origin.clientX !== undefined && origin.clientY !== undefined) {
      return { left: origin.clientX - 12, top: origin.clientY - 12, width: 24, height: 24 };
    }
    if (origin && origin.getBoundingClientRect) {
      var r = origin.getBoundingClientRect();
      if (r.width && r.height) {
        return { left: r.left, top: r.top, width: r.width, height: r.height };
      }
    }
    return {
      left: window.innerWidth / 2 - 16,
      top: window.innerHeight / 2 - 16,
      width: 32,
      height: 32,
    };
  }

  async function begin(path, origin, container) {
    if (prefersReduced) return;
    if (isTransitioning) return;
    isTransitioning = true;

    var r = rectFromOrigin(origin);
    var color = routeColor(path);
    activeBlock = document.createElement("div");
    activeBlock.className = "exm-transition-block";
    if (container && container.getBoundingClientRect) {
      // 面板内模式：色块挂到容器（右栏 content-panel）内，只盖住容器区域；
      // origin 是视口坐标，先换算为容器内坐标
      var cr = container.getBoundingClientRect();
      activeBlock.classList.add("in-panel");
      container.appendChild(activeBlock);
      r.left -= cr.left;
      r.top -= cr.top;
    } else {
      document.body.appendChild(activeBlock);
    }
    activeBlock.style.left = r.left + "px";
    activeBlock.style.top = r.top + "px";
    activeBlock.style.width = Math.max(16, r.width) + "px";
    activeBlock.style.height = Math.max(16, r.height) + "px";
    activeBlock.style.backgroundColor = color;
    activeBlock.style.borderColor = color === "var(--white)" ? "var(--black)" : color;

    await wait(20);
    activeBlock.classList.add("is-full");
    await wait(230);
  }

  async function reveal() {
    if (prefersReduced) return;
    var block = activeBlock;
    activeBlock = null;
    if (!block) {
      isTransitioning = false;
      return;
    }
    block.classList.add("is-revealing");
    await wait(380);
    block.remove();
    isTransitioning = false;
  }

  function enter(container) {
    if (prefersReduced || !container) return;
    container.classList.remove("exm-fragment-enter");
    void container.offsetWidth;
    container.classList.add("exm-fragment-enter");
    container.addEventListener("animationend", function cleanupFragmentEnter(e) {
      if (e.target !== container || e.animationName !== "exm-fragment-enter") return;
      container.classList.remove("exm-fragment-enter");
      container.removeEventListener("animationend", cleanupFragmentEnter);
    });

    var items = container.querySelectorAll(
      ".record-card, .analysis-summary-card, .tool-card, .sel-card, .section-group, .academic-table, form, .empty-state"
    );
    Array.prototype.slice.call(items, 0, 18).forEach(function (el, i) {
      el.classList.remove("exm-item-enter");
      el.style.animationDelay = Math.min(i * 28, 360) + "ms";
      void el.offsetWidth;
      el.classList.add("exm-item-enter");
    });
  }

  function bindPressFeedback() {
    document.addEventListener("pointerdown", function (e) {
      var el = e.target.closest("button, .button, [role='button'], a[role='button'], .filter-chip, .sel-item");
      if (!el || el.disabled || el.getAttribute("aria-disabled") === "true") return;
      el.classList.add("exm-pressed");
    }, true);

    ["pointerup", "pointercancel", "mouseleave"].forEach(function (type) {
      document.addEventListener(type, function (e) {
        var el = e.target.closest && e.target.closest(".exm-pressed");
        if (!el) return;
        el.classList.remove("exm-pressed");
        el.classList.add("exm-flash");
        setTimeout(function () { el.classList.remove("exm-flash"); }, 240);
      }, true);
    });
  }

  document.addEventListener("DOMContentLoaded", bindPressFeedback);

  window.ExMotion = {
    begin: begin,
    reveal: reveal,
    enter: enter,
    routeColor: routeColor,
  };
})();
