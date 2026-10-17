"""React 页面数据接口；只使用服务端验证后的账号作用域。"""

from io import BytesIO

from flask import Blueprint, g, jsonify, request, send_file

api_v1_bp = Blueprint("api_v1", __name__)
_STATUSES = {"planned", "running", "done", "failed", "repeated"}


@api_v1_bp.before_request
def require_session():
    # 认证由应用装配层统一验证；接口不自行回退到匿名数据。
    if not getattr(g, "user_id", None):
        return jsonify(error={"code": "unauthenticated", "message": "请先登录"}), 401


@api_v1_bp.after_request
def private_response(response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    if response.status_code == 401 and request.cookies.get("exdiary_token"):
        response.delete_cookie("exdiary_token", path="/")
    return response


@api_v1_bp.get("/experiments")
def list_experiments():
    try:
        page = int(request.args.get("page", "1"))
        page_size = int(request.args.get("page_size", "20"))
    except ValueError:
        return jsonify(error={"code": "invalid_pagination", "message": "分页参数必须是整数"}), 400
    if page < 1 or not 1 <= page_size <= 100:
        return jsonify(error={"code": "invalid_pagination", "message": "页码至少为 1，每页为 1–100 条"}), 400
    status = request.args.get("status", "")
    query = request.args.get("q", "").strip()
    archived = request.args.get("include_archived", "0")
    if (status and status not in _STATUSES) or len(query) > 200 or archived not in {"0", "1"}:
        return jsonify(error={"code": "invalid_filter", "message": "筛选条件无效"}), 400
    result = g.exp_repo.list_page(page, page_size, query, status, archived == "1")
    return jsonify(data=result["items"], meta={key: value for key, value in result.items() if key != "items"})


@api_v1_bp.get("/experiments/<exp_id>")
def get_experiment(exp_id):
    experiment = g.exp_repo.load(exp_id)
    if experiment is None:
        return jsonify(error={"code": "not_found", "message": "实验不存在或不可访问"}), 404
    return jsonify(data=experiment)


@api_v1_bp.get("/experiment-list")
def experiment_list_context():
    # 与原列表使用同一摘要投影和分类顺序，避免搬运实验正文。
    return jsonify(data={
        "experiments": g.exp_repo.list_for_list_view(include_archived=True),
        "pinnedIds": g.favorites_repo.get_pinned(),
        "collections": g.favorites_repo.get_collections(),
        "collectionMeta": g.favorites_repo.get_collection_meta(),
        "categoryPinned": g.favorites_repo.get_category_pinned(),
    })


@api_v1_bp.get("/timeline")
def timeline_context():
    return jsonify(data=sorted(g.exp_repo.list_all(), key=lambda item: item.get("date") or ""))


@api_v1_bp.get("/compare")
def comparison_context():
    ids = [value.strip() for value in request.args.get("ids", "").split(",") if value.strip()][:4]
    records = [record for exp_id in ids if (record := g.exp_repo.load(exp_id)) is not None]
    if len(records) < 2:
        return jsonify(error={"code": "invalid_comparison", "message": "请至少选择两条可访问的实验记录"}), 400
    return jsonify(data=records)


@api_v1_bp.get("/templates")
def templates_context():
    return jsonify(data=g.template_svc.list_all())


@api_v1_bp.get("/analysis")
def analysis_context():
    return jsonify(data=g.analysis_repo.list_all())


@api_v1_bp.get("/analysis/<anal_id>")
def analysis_detail_context(anal_id):
    analysis = g.analysis_repo.load(anal_id)
    if analysis is None:
        return jsonify(error={"code": "not_found", "message": "报告不存在或不可访问"}), 404
    snapshot = analysis.get("source_snapshot") or {}
    stale_ids = []
    ignored = {"analyzed_in", "revision", "updated_at", "field_updated_at"}
    for record in snapshot.get("records") or []:
        exp_id = record.get("id") if isinstance(record, dict) else ""
        current = g.exp_repo.load(exp_id) if exp_id else None
        before = {key: value for key, value in record.items() if key not in ignored} if isinstance(record, dict) else {}
        after = {key: value for key, value in (current or {}).items() if key not in ignored}
        if not current or before != after:
            stale_ids.append(exp_id)
    return jsonify(data={"analysis": analysis, "stale_ids": stale_ids})


@api_v1_bp.route("/settings", methods=["GET", "POST"])
def settings_context():
    from routes.settings import settings_api_context, settings_save
    if request.method == "POST":
        return settings_save()
    return jsonify(data=settings_api_context(g.config))


@api_v1_bp.get("/attachments/<sha256>")
def download_attachment(sha256):
    meta = g.attachment_store.meta(sha256)
    content = g.attachment_store.get(sha256) if meta else None
    if content is None:
        return jsonify(error={"code": "not_found", "message": "附件不存在或不可访问"}), 404
    # 强制下载不受信任内容，避免同源内联执行。
    return send_file(BytesIO(content), mimetype="application/octet-stream", as_attachment=True,
                     download_name=meta.get("name") or sha256)
