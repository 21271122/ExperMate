"""片段路由 — 返回纯 HTML 片段（无 base.html 包装），供 Shell 右栏 fetch 注入。"""

from flask import Blueprint, render_template, request, redirect, url_for, g

fragments_bp = Blueprint("fragments", __name__)


@fragments_bp.route("/_fragment/experiments")
def fragment_experiments():
    # 列表模板内已含本地筛选所需字段；不再在注入后重复请求完整实验正文。
    experiments = g.exp_repo.list_for_list_view(include_archived=True)
    pinned_ids = g.favorites_repo.get_pinned()
    collections = g.favorites_repo.get_collections()
    collection_meta = g.favorites_repo.get_collection_meta()
    category_pinned = g.favorites_repo.get_category_pinned()
    pinned = []
    others = []
    for exp in experiments:
        if exp["id"] in pinned_ids:
            pinned.append(exp)
        else:
            others.append(exp)
    pinned.sort(key=lambda e: pinned_ids.index(e["id"]) if e["id"] in pinned_ids else 99)
    return render_template("experiments.html",
                          experiments=pinned + others,
                          pinned_ids=pinned_ids,
                          collections=collections,
                          collection_meta=collection_meta,
                          category_pinned=category_pinned,
                          fragment=True)


@fragments_bp.route("/_fragment/experiments/<exp_id>")
def fragment_experiment_detail(exp_id):
    exp = g.exp_repo.load(exp_id)
    if not exp:
        return "<div style='padding:2rem;text-align:center;opacity:0.5'>Experiment not found</div>", 404
    return render_template("view.html", exp=exp, fragment=True)


# /new 已废弃 — 新建实验通过 Shell 左栏 agent 对话完成


@fragments_bp.route("/_fragment/timeline")
def fragment_timeline():
    # 时间线只需要摘要字段（id/title/date/status/tags），不要 list_all_full
    # （后者读取每条实验的完整数据含原文，YAML 模式下逐文件解析会明显拖慢页面）
    experiments = g.exp_repo.list_all()
    experiments.sort(key=lambda e: e.get("date") or "")
    return render_template("timeline.html", experiments=experiments, fragment=True)


@fragments_bp.route("/_fragment/analyze")
def fragment_analyze():
    return render_template("analyze.html", fragment=True)


@fragments_bp.route("/_fragment/analysis/<anal_id>")
def fragment_analysis_detail(anal_id):
    a = g.analysis_repo.load(anal_id)
    if not a:
        return "<div style='padding:2rem;text-align:center;opacity:0.5'>Analysis not found</div>", 404
    snapshot = a.get("source_snapshot") or {}
    stale_ids = []
    for record in snapshot.get("records") or []:
        exp_id = record.get("id") if isinstance(record, dict) else ""
        current = g.exp_repo.load(exp_id) if exp_id else None
        # 生成报告后，系统会把报告 ID 记到 analyzed_in。这是引用关系的
        # 元数据，不应让报告一生成就被误报为“实验内容已更新”。
        ignored = {"analyzed_in", "revision", "updated_at", "field_updated_at"}
        snapshot_content = {k: v for k, v in record.items() if k not in ignored}
        current_content = {
            k: v for k, v in (current or {}).items() if k not in ignored
        }
        if not current or current_content != snapshot_content:
            stale_ids.append(exp_id)
    return render_template("analysis_detail.html", analysis=a, fragment=True,
                           source_snapshot=snapshot, stale_ids=stale_ids)


@fragments_bp.route("/_fragment/compare")
def fragment_compare():
    ids_raw = request.args.get("ids", "")
    ids = [s.strip() for s in ids_raw.split(",") if s.strip()]
    if len(ids) < 2:
        return "<div style='padding:2rem;text-align:center;opacity:0.5'>Select at least 2 experiments</div>", 400
    experiments = []
    for eid in ids[:4]:
        exp = g.exp_repo.load(eid)
        if exp:
            experiments.append(exp)
    if len(experiments) < 2:
        return "<div style='padding:2rem;text-align:center;opacity:0.5'>Not enough valid experiments</div>", 400
    colors = ["#2563eb", "#dc2626", "#16a34a", "#9333ea"]
    for i, exp in enumerate(experiments):
        exp["_color"] = colors[i % len(colors)]
    return render_template("compare.html", experiments=experiments,
                          color_names=["蓝", "红", "绿", "紫"], fragment=True)


@fragments_bp.route("/_fragment/favorites")
def fragment_favorites():
    return fragment_experiments()


@fragments_bp.route("/_fragment/settings", methods=["GET"])
def fragment_settings():
    from routes.settings import settings_template_context
    return render_template("settings.html", config=g.config, fragment=True,
                           **settings_template_context(g.config))


@fragments_bp.route("/_fragment/templates")
def fragment_templates():
    templates = g.template_svc.list_all()
    return render_template("templates.html", templates=templates, fragment=True)


@fragments_bp.route("/_fragment/login")
def fragment_login():
    return render_template("login.html", fragment=True)
