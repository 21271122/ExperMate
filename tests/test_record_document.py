"""灵活正文、人工审批和原子持久化；仅使用内存数据库。"""
from copy import deepcopy
import sqlite3

import pytest
from pydantic import ValidationError

from lib.core.record_document import empty_document, structure_signature, validate_document
from lib.repositories.sqlite_common import ThreadSafeConnection
from lib.repositories.sqlite_experiment import SqliteExperimentRepository
from lib.repositories.sqlite_update_log import SqliteUpdateLogRepository


def sample_document():
    document = empty_document()
    document['sections'][0]['fields'] = [{
        'id': 'purpose', 'label': '目的', 'kind': 'text', 'content': {'text': '验证记录流程'},
    }]
    return validate_document(document)


def test_contract_rejects_extra_sections_nesting_duplicate_ids_and_missing_sources():
    base = sample_document()
    invalid = []
    document = deepcopy(base); document['sections'].reverse(); invalid.append(document)
    document = deepcopy(base); document['sections'][0]['fields'][0]['children'] = []; invalid.append(document)
    document = deepcopy(base); document['sections'][1]['fields'] = deepcopy(document['sections'][0]['fields']); invalid.append(document)
    document = deepcopy(base); document['sections'][0]['fields'][0]['source_refs'] = ['missing']; invalid.append(document)
    for document in invalid:
        with pytest.raises(ValidationError): validate_document(document)


def test_process_has_material_nodes_multi_input_actions_and_separate_parameters():
    document = empty_document()
    document['sections'][1]['fields'] = [{
        'id': 'flow', 'label': '流程', 'kind': 'process', 'content': {
            'nodes': [{'id': key, 'label': label} for key, label in [('a', '溶液 A'), ('b', '溶液 B'), ('c', '混合液')]],
            'actions': [{'id': 'mix', 'source_ids': ['a', 'b'], 'target_ids': ['c'], 'label': '搅拌',
                         'parameters': [{'id': 'time', 'label': '时间', 'value': '10', 'unit': 'min'}]}],
        },
    }]
    result = validate_document(document)
    changed = deepcopy(result)
    changed['sections'][1]['fields'][0]['content']['actions'][0]['parameters'][0]['value'] = '20'
    assert structure_signature(result) == structure_signature(changed)
    changed['sections'][1]['fields'][0]['content']['nodes'].pop()
    with pytest.raises(ValidationError): validate_document(changed)


def test_transaction_rolls_back_nested_repository_commit_and_savepoint():
    conn = ThreadSafeConnection(sqlite3.connect(':memory:'))
    conn.execute('CREATE TABLE test (value TEXT)')
    with pytest.raises(RuntimeError):
        with conn.transaction():
            conn.execute("INSERT INTO test VALUES ('outer')")
            conn.commit()
            with conn.transaction(): conn.execute("INSERT INTO test VALUES ('inner')")
            raise RuntimeError('fail after writes')
    assert conn.execute('SELECT * FROM test').fetchall() == []
    with conn.transaction():
        conn.execute("INSERT INTO test VALUES ('kept')")
        with pytest.raises(ValueError):
            with conn.transaction():
                conn.execute("INSERT INTO test VALUES ('discarded')")
                raise ValueError('inner failure')
    assert conn.execute('SELECT value FROM test').fetchone()[0] == 'kept'


@pytest.fixture
def records():
    from lib.services.record_document import RecordDocumentService
    conn = ThreadSafeConnection(sqlite3.connect(':memory:'))
    owner = ['alice']
    repo = SqliteExperimentRepository(conn, uid_provider=lambda: owner[0], device_code='TEST')
    logs = SqliteUpdateLogRepository(conn, uid_provider=lambda: owner[0])
    service = RecordDocumentService(conn, repo, logs, uid_provider=lambda: owner[0])
    yield service, repo, conn, owner
    conn.close()


def test_draft_requires_manual_structure_resolution_and_content_can_update(records):
    service, repo, _, _ = records
    draft = service.create_draft({'title': '本日总结'})
    proposed = service.propose('draft', draft['id'], 1, sample_document())
    assert service.get('draft', draft['id'])['document'] == empty_document()
    approved = service.resolve(proposed['id'], 'approved')
    assert approved['revision'] == 2
    assert service.resolve(proposed['id'], 'approved') == approved
    doc = service.get('draft', draft['id'])['document']
    doc['sections'][0]['fields'][0]['content']['text'] = '已追加现场信息'
    updated = service.update('draft', draft['id'], 2, doc, {}, 'request-1')
    assert updated['revision'] == 3
    assert service.update('draft', draft['id'], 2, doc, {}, 'request-1') == updated
    published = service.publish(draft['id'], 3, 'publish-1')
    assert service.publish(draft['id'], 3, 'publish-1') == published
    assert repo.load(published['id'])['document'] == doc


def test_content_route_rejects_structure_and_request_id_cannot_be_reused(records):
    from lib.services.record_document import RecordError
    service, _, _, _ = records
    draft = service.create_draft({})
    with pytest.raises(RecordError, match='structure_change_requires_confirmation'):
        service.update('draft', draft['id'], 1, sample_document(), {}, 'bad-structure')
    service.update('draft', draft['id'], 1, empty_document(), {'title': '一'}, 'same-request')
    with pytest.raises(RecordError, match='request_id_reused'):
        service.update('draft', draft['id'], 1, empty_document(), {'title': '二'}, 'same-request')


def test_proposal_conflict_rejection_and_account_scope(records):
    from lib.services.record_document import RecordError
    service, _, _, owner = records
    draft = service.create_draft({})
    proposal = service.propose('draft', draft['id'], 1, sample_document())
    owner[0] = 'bob'
    with pytest.raises(RecordError, match='not_found'): service.resolve(proposal['id'], 'approved')
    with pytest.raises(RecordError, match='not_found'): service.get('draft', draft['id'])
    owner[0] = 'alice'
    service.update('draft', draft['id'], 1, empty_document(), {'title': '另一窗口'}, 'edit')
    with pytest.raises(RecordError, match='revision_conflict'): service.resolve(proposal['id'], 'approved')
    assert service.proposal(proposal['id'])['status'] == 'pending'
    assert service.resolve(proposal['id'], 'rejected')['status'] == 'rejected'
    with pytest.raises(RecordError, match='proposal_not_pending'): service.resolve(proposal['id'], 'approved')


def test_failed_proposal_application_rolls_back_every_write(records, monkeypatch):
    service, _, conn, _ = records
    draft = service.create_draft({})
    published = service.publish(draft['id'], 1, 'publish')
    proposal = service.propose('experiment', published['id'], 1, sample_document())
    def fail(*args, **kwargs): raise RuntimeError('snapshot failure')
    monkeypatch.setattr(service, '_save_snapshot', fail)
    with pytest.raises(RuntimeError, match='snapshot failure'): service.resolve(proposal['id'], 'approved')
    assert service.get('experiment', published['id'])['revision'] == 1
    assert service.get('experiment', published['id'])['document'] == empty_document()
    assert service.proposal(proposal['id'])['status'] == 'pending'
    assert conn.execute('SELECT count(*) FROM update_logs').fetchone()[0] == 0


def test_old_write_cannot_overwrite_v2_and_restore_creates_new_revision(records):
    from lib.services.record_document import RecordError
    service, repo, _, _ = records
    draft = service.create_draft({})
    service.resolve(service.propose('draft', draft['id'], 1, sample_document())['id'], 'approved')
    published = service.publish(draft['id'], 2, 'pub')
    doc = deepcopy(published['document']); doc['sections'][0]['fields'][0]['content']['text'] = '新值'
    service.update('experiment', published['id'], 1, doc, {}, 'edit')
    assert len(service.revisions(published['id'])) == 2
    restored = service.restore(published['id'], 1, 2, 'restore')
    assert restored['revision'] == 3
    assert restored['document'] == published['document']
    with pytest.raises(ValueError, match='V2'): repo.save({'id': published['id'], 'title': '旧入口'})
    with pytest.raises(RecordError, match='revision_conflict'):
        service.update('experiment', published['id'], 1, doc, {}, 'stale')


def test_http_structure_approval_and_legacy_write_guard(tmp_path):
    from app import create_app
    app = create_app({'TESTING': True, 'DATA_DIR': tmp_path})
    try:
        app.extensions['e2ee'].register('writer', 'writer@example.test', 'Test-password-932!')
        client = app.test_client()
        assert client.post('/api/v1/record-drafts', json={}).status_code == 401
        assert client.post('/api/e2ee/login', json={'account': 'writer', 'password': 'Test-password-932!'}).status_code == 200
        draft = client.post('/api/v1/record-drafts', json={'metadata': {'title': '晚间整理'}}).json['data']
        proposal = client.post(f"/api/v1/record-drafts/{draft['id']}/structure-proposals", json={
            'expected_revision': 1, 'document': sample_document()}).json['data']
        endpoint = f"/api/v1/structure-proposals/{proposal['id']}/resolve"
        data = {'decision': 'approved', 'proposal_hash': 'wrong', 'base_revision': 1}
        assert client.post(endpoint, json=data).status_code == 409
        data['proposal_hash'] = proposal['hash']
        assert client.post(endpoint, json=data).json['data']['revision'] == 2
        published = client.post(f"/api/v1/record-drafts/{draft['id']}/publish", json={
            'expected_revision': 2, 'request_id': 'publish'}).json['data']
        assert client.get(f"/api/v1/experiments/{published['id']}").json['data']['document'] == sample_document()
        assert client.post(f"/experiments/{published['id']}/save-json", json={'title': '旧接口'}).status_code == 409
        bad = client.post(f"/api/v1/experiments/{published['id']}/operations", json={
            'expected_revision': 1, 'request_id': 'invalid', 'document': {'sections': []}})
        assert bad.status_code == 422 and bad.json['error']['code'] == 'invalid_document'
    finally: app.extensions['exdiary_ctx'].shutdown()


def test_agent_uses_approved_document_without_second_extraction_and_cannot_approve(records):
    from lib.agent_v2 import AgentLoop
    service, repo, _, _ = records
    class NoExtraction:
        def structured_extract(self, *args, **kwargs): raise AssertionError('不得再次提取正文')
    loop = AgentLoop(NoExtraction(), repo, record_svc=service)
    loop.thread.id, loop.thread.type = 'test-thread', 'record'
    loop._enter_record_mode()
    result = loop.tools.execute('propose_record_structure', {'expected_revision': 1, 'document': sample_document()}, loop)
    assert result['display'] == 'structure_proposal'
    assert loop.tools.execute('resolve_structure', {'decision': 'approved'}, loop)['error'] == 'unknown_tool'
    assert loop.tools.execute('generate_record', {}, loop)['error'] == 'pending_structure_proposal'
    service.resolve(result['proposal_id'], 'approved')
    saved = loop.tools.execute('generate_record', {}, loop)
    assert saved['display'] == 'record_generated'
    assert repo.load(saved['exp_id'])['document'] == sample_document()
    restored = AgentLoop.from_dict(NoExtraction(), repo, loop.state_to_dict(), record_svc=service)
    assert restored.record_draft_id == loop.record_draft_id
    read = restored.tools.execute('read_experiment', {'refs': [saved['exp_id']]}, restored)
    assert read['experiments'][saved['exp_id']]['document'] == sample_document()


def test_agent_content_cannot_smuggle_structure_or_cross_child_scope(records):
    from lib.agent_v2 import AgentLoop
    service, repo, _, _ = records
    loop = AgentLoop(object(), repo, record_svc=service)
    loop.thread.id, loop.thread.type = 'record', 'record'
    loop._enter_record_mode()
    result = loop.tools.execute('update_schema', {'expected_revision': 1, 'document': sample_document()}, loop)
    assert result['error'] == 'structure_change_requires_confirmation'
    saved = loop.tools.execute('update_schema', {'expected_revision': 1, 'document': empty_document(), 'metadata': {'title': '草稿标题'}}, loop)
    assert saved['target_kind'] == 'draft' and saved['draft_id'] == loop.record_draft_id
    assert saved['changes'][0]['exp_id'] is None and saved['changes'][0]['field'] == '修订'
    loop.child.agent_role, loop.child.exp_id = 'exp_editor', 'bound-record'
    result = loop.tools.execute('propose_record_structure', {'refs': ['other-record'], 'expected_revision': 1, 'document': sample_document()}, loop)
    assert result['error'] == 'child_scope_restricted'


def test_native_pdf_pages_are_rendered_and_unread_range_is_explicit():
    from io import BytesIO
    from pypdf import PdfWriter
    from PIL import Image
    from lib.services.attachment_reader import read_visual_attachment
    writer = PdfWriter()
    for _ in range(3): writer.add_blank_page(width=300, height=400)
    buffer = BytesIO(); writer.write(buffer)
    class Vision:
        def read_document_pages(self, pages, name, context):
            assert name == 'scan.pdf' and context == '本次实验'
            assert [number for number, _ in pages] == [2]
            with Image.open(BytesIO(pages[0][1])) as image:
                assert image.format == 'JPEG' and max(image.size) <= 1800
            return '第 2 页为空白，不补造。'
    result = read_visual_attachment(Vision(), buffer.getvalue(), {'name': 'scan.pdf', 'mime': 'application/pdf'},
                                    'a' * 64, start_page=2, page_count=1, context='本次实验')
    assert result['read_pages'] == [2] and result['next_page'] == 3 and result['unread_before']
    assert result['sources'][0]['page'] == 2
    assert read_visual_attachment(object(), b'', {}, 'a' * 64)['status'] == 'vision_unavailable'


def test_v2_search_and_snapshot_keep_actual_content_without_old_defaults(records):
    service, repo, _, _ = records
    draft = service.create_draft({})
    service.resolve(service.propose('draft', draft['id'], 1, sample_document())['id'], 'approved')
    record = service.publish(draft['id'], 2, 'search-publish')
    assert 'observations' not in record and 'sop' not in record
    assert repo.search('验证记录流程')[0]['id'] == record['id']
    assert '验证记录流程' in repo.summarize_all()
    assert service.revisions(record['id'])[0]['document'] == sample_document()


def test_amended_proposal_invalidates_old_approval_and_manual_edit_supersedes(records):
    from lib.services.record_document import RecordError
    service, _, _, _ = records
    draft = service.create_draft({})
    first = service.propose('draft', draft['id'], 1, sample_document())
    amended = sample_document()
    amended['sections'][0]['fields'][0]['label'] = '本次实验目的'
    second = service.propose('draft', draft['id'], 1, amended)
    assert service.proposal(first['id'])['status'] == 'superseded'
    with pytest.raises(RecordError, match='proposal_not_pending'):
        service.resolve(first['id'], 'approved')
    service.update('draft', draft['id'], 1, amended, {}, 'manual-edit', manual=True)
    assert service.proposal(second['id'])['status'] == 'superseded'
    assert service.get('draft', draft['id'])['document'] == amended


def test_legacy_read_is_non_mutating_and_explicit_revision_zero_source_can_be_reused(records):
    service, repo, conn, _ = records
    repo.save({'id': 'old-record', 'title': '历史条件', 'purpose': '历史原文'})
    before = dict(conn.execute('SELECT * FROM experiments WHERE id=?', ('old-record',)).fetchone())
    assert service.get('experiment', 'old-record')['document']['sections'][0]['fields']
    assert dict(conn.execute('SELECT * FROM experiments WHERE id=?', ('old-record',)).fetchone()) == before
    doc = sample_document()
    doc['sources'] = [{'id': 'previous', 'kind': 'experiment', 'reference': 'old-record',
                       'revision': before['revision'], 'excerpt': '历史原文'}]
    doc['sections'][0]['fields'][0]['source_refs'] = ['previous']
    draft = service.create_draft({})
    result = service.resolve(service.propose('draft', draft['id'], 1, doc)['id'], 'approved')
    assert result['document']['sources'][0]['revision'] == before['revision']
