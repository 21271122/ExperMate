// 统计接口适配层，与 Canvas 引擎分离。
export function loadCanvasStats(scope, update) {
  const _stats = { total: 0, unfinished: 0, favorites: 0, analysis: 0, lastRecordDays: 0 };
    try {
      scope.fetch("/api/experiments/search")
        .then(function (r) { return r.json(); })
        .then(function (list) {
          if (!list || !list.length) return;
          _stats.total = list.length;
          _stats.unfinished = list.filter(function (e) { return e.status && e.status !== "done"; }).length;
          var maxDate = null;
          list.forEach(function (e) {
            if (!e.date) return;
            var t = new Date(e.date).getTime();
            if (!isNaN(t) && (!maxDate || t > maxDate)) maxDate = t;
          });
          if (maxDate) {
            var days = Math.floor((Date.now() - maxDate) / 86400000);
            _stats.lastRecordDays = Math.max(0, days);
          }
          update({ ..._stats });
        }).catch(function () {});
    } catch (e) {}
    try {
      scope.fetch("/api/analysis-history")
        .then(function (r) { return r.json(); })
        .then(function (list) {
          if (list) _stats.analysis = list.length;
          update({ ..._stats });
        }).catch(function () {});
    } catch (e) {}
    try {
      scope.fetch("/api/list-collections")
        .then(function (r) { return r.json(); })
        .then(function (collections) {
          if (collections) {
            var n = 0;
            for (var k in collections) n += (collections[k] || []).length;
            _stats.favorites = n;
          }
          update({ ..._stats });
        }).catch(function () {});
    } catch (e) {}
  }
