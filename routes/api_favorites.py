from flask import Blueprint, g, jsonify, request

api_favorites_bp = Blueprint("api_favorites", __name__)


def _json_body() -> dict:
    return request.get_json(silent=True) or {}


def _notify_favorites_change() -> None:
    from routes.api_agent import publish_named_resource_change
    publish_named_resource_change(
        "categories", "updated", request.headers.get("X-Exdiary-Client-Id", "")
    )


@api_favorites_bp.route("/experiments/<exp_id>/pin", methods=["POST"])
def api_toggle_pin(exp_id):
    data = _json_body()
    collection = (data.get("collection") or "").strip()
    if collection:
        result = g.favorites_repo.toggle_category_pin(exp_id, collection)
    else:
        result = g.favorites_repo.toggle_pin(exp_id)
    if result.get("ok"):
        _notify_favorites_change()
    return jsonify(result)


@api_favorites_bp.route("/experiments/<exp_id>/favorite", methods=["POST"])
def api_toggle_favorite(exp_id):
    data = _json_body()
    collection = data.get("collection") or data.get("category") or "Default"
    result = g.favorites_repo.toggle_favorite(exp_id, collection)
    if result.get("ok"):
        _notify_favorites_change()
    return jsonify(result)


@api_favorites_bp.route("/list-collections")
def api_list_collections():
    return jsonify(g.favorites_repo.get_collections())


@api_favorites_bp.route("/collections", methods=["POST"])
def api_create_collection():
    data = _json_body()
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"ok": False, "error": "Category name cannot be empty"}), 400
    result = g.favorites_repo.create_collection(name)
    if result.get("ok") and data.get("description"):
        result = g.favorites_repo.update_collection(name, description=data.get("description", ""))
    if result.get("ok"):
        _notify_favorites_change()
    return jsonify(result)


@api_favorites_bp.route("/collections/<name>", methods=["DELETE"])
def api_delete_collection(name):
    result = g.favorites_repo.delete_collection(name)
    if result.get("ok"):
        _notify_favorites_change()
    return jsonify(result)


@api_favorites_bp.route("/collections/<name>", methods=["PATCH"])
def api_update_collection(name):
    data = _json_body()
    result = g.favorites_repo.update_collection(
        name,
        new_name=data.get("name"),
        description=data.get("description"),
    )
    if result.get("ok"):
        _notify_favorites_change()
    return jsonify(result)


@api_favorites_bp.route("/collections/reorder", methods=["POST"])
def api_reorder_collections():
    data = _json_body()
    names = data.get("names") or []
    if not isinstance(names, list):
        return jsonify({"ok": False, "error": "names must be a list"}), 400
    result = g.favorites_repo.reorder_collections([str(name) for name in names])
    if result.get("ok"):
        _notify_favorites_change()
    return jsonify(result)


@api_favorites_bp.route("/categories")
def api_list_categories():
    return jsonify(
        {
            "collections": g.favorites_repo.get_collections(),
            "meta": g.favorites_repo.get_collection_meta(),
            "category_pinned": g.favorites_repo.get_category_pinned(),
        }
    )


@api_favorites_bp.route("/categories", methods=["POST"])
def api_create_category():
    return api_create_collection()


@api_favorites_bp.route("/categories/<name>", methods=["PATCH"])
def api_update_category(name):
    return api_update_collection(name)


@api_favorites_bp.route("/categories/<name>", methods=["DELETE"])
def api_delete_category(name):
    return api_delete_collection(name)


@api_favorites_bp.route("/categories/reorder", methods=["POST"])
def api_reorder_categories():
    return api_reorder_collections()
