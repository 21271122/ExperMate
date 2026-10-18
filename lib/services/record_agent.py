"""将现有 Agent 工具桥接到统一记录服务；不执行任何人工批准。"""
import json
import uuid

from lib.services.record_document import RecordError


def target(loop, args):
    if loop.child.agent_role == 'exp_editor':
        return 'experiment', loop.child.exp_id
    refs = args.get('refs') or []
    if refs:
        if len(refs) != 1: raise RecordError('one_record_at_a_time', 422)
        return 'experiment', refs[0]
    if not loop.record_draft_id: raise RecordError('not_in_record_mode')
    return 'draft', loop.record_draft_id


def execute_record_tool(loop, name, args):
    service = loop.record_svc
    kind, target_id = target(loop, args)
    if name == 'propose_record_structure':
        proposal = service.propose(kind, target_id, args['expected_revision'], args['document'])
        return {'display': 'structure_proposal', 'proposal_id': proposal['id'], 'status': 'pending', 'pause': True,
                'message': '字段结构方案等待用户在界面手动确认', 'draft_id': target_id if kind == 'draft' else None}
    if name == 'generate_record':
        if kind != 'draft': raise RecordError('use_modify_experiment')
        draft = service.get(kind, target_id)
        record = service.publish(target_id, draft['revision'], 'agent-publish-' + target_id)
        loop._generated_preview = record
        loop._generated_notes = ''
        return {'status': 'generated', 'pause': True, 'display': 'record_generated',
                'response_type': 'generate', 'include_state': True,
                'exp_id': record['id'], 'title': record['title'], 'id': record['id']}
    record = service.update(kind, target_id, args['expected_revision'], args['document'],
                            args.get('metadata', {}), uuid.uuid4().hex)
    return {'display': 'diff', 'target_kind': kind, 'draft_id': target_id if kind == 'draft' else None,
            'revision': record['revision'], 'changes': [
        {'exp_id': target_id if kind == 'experiment' else None, 'field': '修订',
         'old': str(args['expected_revision']), 'new': str(record['revision'])}]}


def record_status(loop):
    if not loop.record_draft_id: return '[记录状态] 当前没有草稿'
    value = loop.record_svc.get('draft', loop.record_draft_id)
    proposals = loop.record_svc.storage.proposals_for('draft', value['id'])
    return '[记录状态] 以下为服务端真实状态；待批字段不可直接使用。\n' + json.dumps(
        {'draft_id': value['id'], 'revision': value['revision'], 'metadata': value['metadata'],
         'document': value['document'], 'pending_proposals': [{'id': p['id'], 'document': p['document']} for p in proposals]}, ensure_ascii=False)
