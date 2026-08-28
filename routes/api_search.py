import json
from flask import Blueprint, request, jsonify, g
from lib.experiment_ids import is_experiment_id

api_search_bp = Blueprint("api_search", __name__)


@api_search_bp.route("/experiments/search")
def api_experiments_search():
    include_archived = request.args.get("include_archived") in ("1", "true")
    return jsonify(g.exp_repo.list_all_full(include_archived=include_archived))


@api_search_bp.route("/resolve-reference", methods=["POST"])
def api_resolve_reference():
    data = request.get_json()
    text = (data.get("text") or "").strip()
    if not text or len(text) < 2:
        return jsonify({"ok": False, "results": []})

    exact_id = text.lstrip("@").upper()
    if is_experiment_id(exact_id):
        exp = g.exp_repo.load(exact_id)
        if exp:
            return jsonify({"ok": True, "results": [{
                "id": exp.get("id"), "title": exp.get("title", ""),
                "date": exp.get("date", ""), "tags": exp.get("tags", []), "score": 1.0
            }]})

    all_exps = g.exp_repo.list_all_full()
    results = []
    text_lower = text.lower()
    for exp in all_exps:
        score = 0.0
        title = (exp.get("title") or "").lower()
        tags = " ".join(exp.get("tags") or []).lower()
        purpose = (exp.get("purpose") or "")[:200].lower()
        materials = " ".join(m.get("name", "") for m in (exp.get("materials") or [])).lower()
        searchable = f"{title} {tags} {purpose} {materials}"

        keywords = text_lower.split()
        for kw in keywords:
            if kw in searchable: score += 0.2
            if len(kw) >= 2 and kw in searchable: score += 0.1
        for tag in (exp.get("tags") or []):
            if tag.lower() in text_lower: score += 0.3
        if score > 0:
            results.append({"id": exp.get("id"), "title": exp.get("title", ""),
                            "date": exp.get("date", ""), "tags": exp.get("tags", []),
                            "score": min(score, 0.99)})

    results.sort(key=lambda r: r["score"], reverse=True)
    top = results[:5]

    if (not top or top[0]["score"] < 0.3) and not is_experiment_id(exact_id):
        llm = g.get_extract_llm()
        if llm:
            try:
                exp_list = json.dumps([{"id": e["id"], "title": e.get("title", ""),
                                        "tags": e.get("tags", [])} for e in all_exps],
                                      ensure_ascii=False)
                llm_result = llm.analyze(
                    system_prompt="你是实验记录搜索引擎。根据用户对历史实验的模糊描述，从实验列表中找出最匹配的。返回 JSON 数组：只包含 id 字段，按匹配度降序排列，最多返回5个。只返回JSON数组，不要其他文字。",
                    user_prompt=f"实验列表：\n{exp_list}\n\n用户描述：{text}\n\n请返回最匹配的实验ID列表(JSON数组):",
                    temperature=0.1)
                try:
                    parsed = json.loads(llm_result.strip())
                    ai_ids = [item["id"] for item in parsed if "id" in item] if isinstance(parsed, list) else []
                    ai_results = []
                    for aid in ai_ids[:5]:
                        e = g.exp_repo.load(aid)
                        if e:
                            ai_results.append({"id": e.get("id"), "title": e.get("title", ""),
                                               "date": e.get("date", ""), "tags": e.get("tags", []),
                                               "score": 0.85})
                    if ai_results: results = ai_results
                    else: results = top
                except json.JSONDecodeError: results = top
            except Exception: results = top

    return jsonify({"ok": True, "results": results[:5]})
