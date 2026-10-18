"""灵活记录的人工编辑与结构审批接口；不提供给 Agent 调用批准。"""
from flask import Blueprint, g, jsonify, request
from pydantic import ValidationError

from lib.services.record_document import RecordError

api_record_bp = Blueprint('api_record', __name__)


@api_record_bp.before_request
def require_user():
    if not getattr(g, 'user_id', None):
        return jsonify(error={'code': 'unauthenticated', 'message': '请先登录'}), 401


@api_record_bp.errorhandler(RecordError)
def record_error(error):
    messages = {
        'revision_conflict': '内容已在另一窗口更新；本次修改未保存，请加载最新版本后再编辑。',
        'structure_change_requires_confirmation': '字段结构变更需要手动确认方案。',
        'pending_structure_proposal': '还有字段结构方案等待处理，请先批准或拒绝。',
        'proposal_not_pending': '此方案已处理或被新方案替代，请读取最新状态。',
        'proposal_changed': '方案内容或版本发生变化，请重新查看。',
        'draft_published': '此草稿已经发布为实验记录。', 'not_found': '记录不存在或不可访问。',
        'request_id_reused': '请求标识已用于不同操作，请刷新后重试。',
        'attachment_not_accessible': '无法访问字段引用的附件。', 'source_not_accessible': '无法访问记录来源。',
    }
    return jsonify(error={'code': error.code, 'message': messages.get(error.code, '请求内容无效：' + error.code), **error.details}), error.status


@api_record_bp.errorhandler(ValidationError)
def invalid_document(error):
    return jsonify(error={'code': 'invalid_document', 'message': '正文结构无效',
                          'details': error.errors(include_context=False, include_input=False)}), 422


def body(required=(), optional=()):
    value = request.get_json(silent=True)
    if not isinstance(value, dict) or set(required) - set(value) or set(value) - set(required) - set(optional):
        raise RecordError('invalid_request', 422)
    return value


def changed(kind, target_id, result):
    if kind == 'experiment':
        from routes.api_agent import publish_resource_change
        publish_resource_change(target_id, 'edited', request.headers.get('X-Exdiary-Client-Id', ''))
    return jsonify(data=result, proposals=g.record_svc.storage.proposals_for(kind, target_id))


@api_record_bp.post('/record-drafts')
def create_draft():
    data = body(optional=('metadata',))
    return jsonify(data=g.record_svc.create_draft(data.get('metadata', {}))), 201


@api_record_bp.get('/record-drafts')
def list_drafts():
    return jsonify(data=g.record_svc.storage.drafts())


@api_record_bp.get('/record-attachments')
def list_attachments():
    return jsonify(data=g.attachment_store.list_all())


@api_record_bp.get('/record-drafts/<target_id>')
def get_draft(target_id):
    value = g.record_svc.get('draft', target_id)
    return jsonify(data=value, proposals=g.record_svc.storage.proposals_for('draft', target_id))


@api_record_bp.post('/record-drafts/<target_id>/operations', defaults={'kind': 'draft'})
@api_record_bp.post('/experiments/<target_id>/operations', defaults={'kind': 'experiment'})
def operations(kind, target_id):
    data = body(('expected_revision', 'document', 'request_id'), ('metadata',))
    result = g.record_svc.update(kind, target_id, data['expected_revision'], data['document'],
                                data.get('metadata', {}), data['request_id'], manual=True)
    return changed(kind, target_id, result)


@api_record_bp.post('/record-drafts/<target_id>/structure-proposals', defaults={'kind': 'draft'})
@api_record_bp.post('/experiments/<target_id>/structure-proposals', defaults={'kind': 'experiment'})
def propose(kind, target_id):
    data = body(('expected_revision', 'document'))
    return jsonify(data=g.record_svc.propose(kind, target_id, data['expected_revision'], data['document'])), 201


@api_record_bp.get('/structure-proposals/<proposal_id>')
def get_proposal(proposal_id):
    return jsonify(data=g.record_svc.proposal(proposal_id))


@api_record_bp.post('/structure-proposals/<proposal_id>/resolve')
def resolve(proposal_id):
    data = body(('decision', 'proposal_hash', 'base_revision'))
    proposal = g.record_svc.proposal(proposal_id)
    if data['proposal_hash'] != proposal['hash'] or data['base_revision'] != proposal['base_revision']:
        raise RecordError('proposal_changed')
    result = g.record_svc.resolve(proposal_id, data['decision'])
    return changed(proposal['target_kind'], proposal['target_id'], result)


@api_record_bp.post('/record-drafts/<target_id>/publish')
def publish(target_id):
    data = body(('expected_revision', 'request_id'))
    result = g.record_svc.publish(target_id, data['expected_revision'], data['request_id'])
    from routes.api_agent import publish_named_resource_change
    publish_named_resource_change('experiment', 'created', exp_id=result['id'])
    return jsonify(data=result)


@api_record_bp.get('/experiments/<exp_id>/revisions')
def revisions(exp_id):
    return jsonify(data=[{'revision': item['revision'], 'updated_at': item.get('updated_at', ''),
                          'title': item.get('title', '')} for item in g.record_svc.revisions(exp_id)])


@api_record_bp.get('/experiments/<exp_id>/revisions/<int:revision>')
def revision(exp_id, revision):
    g.record_svc.get('experiment', exp_id)
    snapshot = g.record_svc.storage.snapshot(exp_id, revision)
    if snapshot is None: raise RecordError('not_found', 404)
    return jsonify(data=snapshot)


@api_record_bp.post('/experiments/<exp_id>/restore')
def restore(exp_id):
    data = body(('revision', 'expected_revision', 'request_id'))
    result = g.record_svc.restore(exp_id, data['revision'], data['expected_revision'], data['request_id'])
    return changed('experiment', exp_id, result)
