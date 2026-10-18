"""灵活正文唯一写入口：CAS、完整版本、人工结构方案及幂等提交。"""
from datetime import datetime, timezone
import hashlib
import uuid

from lib.core.record_document import empty_document, structure_signature, validate_document
from lib.repositories.sqlite_record import SqliteRecordRepository, encode
from lib.services.record_projection import document_text, legacy_document


class RecordError(ValueError):
    def __init__(self, code, status=409, **details):
        super().__init__(code)
        self.code, self.status, self.details = code, status, details


META_FIELDS = {'title', 'date', 'experimenter', 'status', 'tags'}


def timestamp():
    return datetime.now(timezone.utc).isoformat()


class RecordDocumentService:
    def __init__(self, db, experiments, logs, uid_provider, attachments=None):
        self.db, self.experiments, self.logs = db, experiments, logs
        self.storage = SqliteRecordRepository(db, uid_provider)
        self.uid = uid_provider
        self.attachments = attachments

    def _meta(self, metadata):
        if not isinstance(metadata, dict) or set(metadata) - META_FIELDS:
            raise RecordError('invalid_metadata', 422)
        for key, value in metadata.items():
            if key == 'tags':
                if not isinstance(value, list) or any(not isinstance(v, str) for v in value):
                    raise RecordError('invalid_metadata', 422)
            elif not isinstance(value, str): raise RecordError('invalid_metadata', 422)
        if 'status' in metadata and metadata['status'] not in {'planned', 'running', 'done', 'failed', 'repeated'}:
            raise RecordError('invalid_metadata', 422)
        return metadata

    def create_draft(self, metadata):
        draft = {'id': uuid.uuid4().hex, 'revision': 1, 'document': empty_document(),
                 'metadata': self._meta(metadata), 'created_at': timestamp(), 'published_id': None}
        with self.db.transaction(): self.storage.save_draft(draft)
        return draft

    def get(self, kind, target_id):
        if kind == 'draft':
            value = self.storage.draft(target_id)
        elif kind == 'experiment':
            value = self.experiments.load(target_id)
            if value is not None and value.get('format_version') != 2:
                value['document'] = legacy_document(value)
        else: raise RecordError('invalid_target', 422)
        if value is None: raise RecordError('not_found', 404)
        if kind == 'experiment':
            value['content_revision'] = self.storage.content_revision(target_id, value['revision'])
        return value

    def _current(self, kind, target_id, revision):
        current = self.get(kind, target_id)
        if type(revision) is not int or current['revision'] != revision:
            raise RecordError('revision_conflict', revision=current['revision'])
        if kind == 'draft' and current['published_id']:
            raise RecordError('draft_published')
        return current

    def _validate(self, document):
        document = validate_document(document)
        for source in document['sources']:
            if source['kind'] == 'attachment' and (not self.attachments or not self.attachments.meta(source['reference'])):
                raise RecordError('source_not_accessible', 422)
            if source['kind'] == 'experiment':
                record = self.experiments.load(source['reference'])
                if not record: raise RecordError('source_not_accessible', 422)
                if record['revision'] != source['revision'] and not self.storage.snapshot(source['reference'], source['revision']):
                    raise RecordError('source_revision_unavailable', 422)
        for section in document['sections']:
            for field in section['fields']:
                if field['kind'] == 'assets':
                    for item in field['content']['items']:
                        if not self.attachments or not self.attachments.meta(item['sha256']):
                            raise RecordError('attachment_not_accessible', 422)
        return document

    def _request(self, request_id, fingerprint, work):
        if not isinstance(request_id, str) or not 1 <= len(request_id) <= 128:
            raise RecordError('invalid_request_id', 422)
        fingerprint = hashlib.sha256(encode(fingerprint).encode()).hexdigest()
        with self.db.transaction():
            previous = self.storage.request(request_id)
            if previous:
                if previous[0] != fingerprint: raise RecordError('request_id_reused')
                return previous[1]
            result = work()
            self.storage.save_request(request_id, fingerprint, result)
            return result

    def update(self, kind, target_id, revision, document, metadata, request_id, *, manual=False):
        metadata = self._meta(metadata)
        document = self._validate(document)
        def work():
            current = self._current(kind, target_id, revision)
            if not manual and structure_signature(current['document']) != structure_signature(document):
                raise RecordError('structure_change_requires_confirmation')
            if kind == 'experiment' and current.get('format_version') != 2 and not manual:
                raise RecordError('structure_change_requires_confirmation')
            return self._write(kind, current, document, metadata, 'manual' if manual else 'agent')
        return self._request(request_id, ['update', kind, target_id, revision, document, metadata, manual], work)

    def propose(self, kind, target_id, revision, document):
        document = self._validate(document)
        with self.db.transaction():
            current = self._current(kind, target_id, revision)
            for previous in self.storage.proposals_for(kind, target_id):
                previous.update(status='superseded', resolved_at=timestamp())
                self.storage.save_proposal(previous)
            proposal = {'id': uuid.uuid4().hex, 'target_kind': kind, 'target_id': target_id,
                        'base_revision': revision, 'document': document, 'before': current['document'],
                        'hash': hashlib.sha256(encode(document).encode()).hexdigest(),
                        'status': 'pending', 'created_at': timestamp(), 'result': None}
            self.storage.save_proposal(proposal)
            return proposal

    def proposal(self, proposal_id):
        value = self.storage.proposal(proposal_id)
        if value is None: raise RecordError('not_found', 404)
        self.get(value['target_kind'], value['target_id'])
        return value

    def resolve(self, proposal_id, decision):
        """只由人工 HTTP 入口调用，不注册为 Agent 工具。"""
        if decision not in {'approved', 'rejected', 'cancelled'}: raise RecordError('invalid_decision', 422)
        with self.db.transaction():
            proposal = self.proposal(proposal_id)
            if proposal['status'] == decision: return proposal['result']
            if proposal['status'] != 'pending': raise RecordError('proposal_not_pending')
            if decision == 'approved':
                if hashlib.sha256(encode(proposal['document']).encode()).hexdigest() != proposal['hash']:
                    raise RecordError('proposal_changed')
                current = self._current(proposal['target_kind'], proposal['target_id'], proposal['base_revision'])
                document = self._validate(proposal['document'])
                result = self._write(proposal['target_kind'], current, document, {}, 'structure_approval')
            else: result = {'id': proposal_id, 'status': decision}
            proposal.update(status=decision, result=result, resolved_at=timestamp())
            self.storage.save_proposal(proposal)
            return result

    def _save_snapshot(self, record):
        self.storage.save_snapshot(record)

    def _document_links(self, document, existing=()):
        links = {item['sha256']: item for item in existing if item.get('sha256')}
        ids = {source['reference'] for source in document['sources'] if source['kind'] == 'attachment'}
        ids.update(item['sha256'] for section in document['sections'] for field in section['fields']
                   if field['kind'] == 'assets' for item in field['content']['items'])
        for sha256 in ids:
            meta = self.attachments.meta(sha256) if self.attachments else None
            if meta: links.setdefault(sha256, {**meta, 'sha256': sha256, 'url': f'/api/attachments/{sha256}'})
        return list(links.values())

    def _write(self, kind, current, document, metadata, source):
        if source == 'manual' and structure_signature(current['document']) != structure_signature(document):
            for proposal in self.storage.proposals_for(kind, current['id']):
                proposal.update(status='superseded', resolved_at=timestamp())
                self.storage.save_proposal(proposal)
        if kind == 'draft':
            result = {**current, 'document': document, 'metadata': {**current['metadata'], **metadata},
                      'revision': current['revision'] + 1, 'updated_at': timestamp()}
            self.storage.save_draft(result)
            return result
        # Preserve a complete pre-upgrade snapshot for legacy edits.
        if not self.storage.snapshot(current['id'], current['revision']): self._save_snapshot(current)
        text = document_text(document)
        values = {**metadata, 'format_version': 2, 'document_json': encode(document),
                  'summary_text': text[:200], 'search_text': text, 'updated_at': timestamp(),
                  'attachments': encode(self._document_links(document, current.get('attachments', []))),
                  'references': encode(list(dict.fromkeys(source['reference'] for source in document['sources'] if source['kind'] == 'experiment')))}
        assignments = ','.join(f'"{key}"=?' for key in values)
        parameters = [encode(value) if key == 'tags' else value for key, value in values.items()]
        cursor = self.db.execute(f'UPDATE experiments SET {assignments},revision=revision+1 WHERE id=? AND user_id=? AND revision=?',
                                 [*parameters, current['id'], self.uid(), current['revision']])
        if cursor.rowcount != 1: raise RecordError('revision_conflict')
        result = self.experiments.load(current['id'])
        self._save_snapshot(result)
        self.logs.append(current['id'], source, [{'path': 'document', 'field': '实验正文',
                                                 'old': current['revision'], 'new': result['revision']}])
        return result

    def publish(self, draft_id, revision, request_id):
        def work():
            draft = self._current('draft', draft_id, revision)
            if self.storage.proposals_for('draft', draft_id): raise RecordError('pending_structure_proposal')
            document = self._validate(draft['document'])
            exp_id = self.experiments.next_id()
            metadata = {'title': '', 'date': '', 'experimenter': '', 'status': 'running', 'tags': [], **draft['metadata']}
            text = document_text(document)
            self.db.execute('''INSERT INTO experiments
                (id,user_id,title,date,experimenter,status,tags,format_version,document_json,summary_text,search_text,revision,created_at,updated_at,attachments,"references")
                VALUES (?,?,?,?,?,?,?,2,?,?,?,1,?,?,?,?)''',
                (exp_id, self.uid(), metadata['title'], metadata['date'], metadata['experimenter'], metadata['status'],
                 encode(metadata['tags']), encode(document), text[:200], text, timestamp(), timestamp(),
                 encode(self._document_links(document)), encode(list(dict.fromkeys(source['reference'] for source in document['sources'] if source['kind'] == 'experiment')))))
            result = self.experiments.load(exp_id)
            self._save_snapshot(result)
            draft.update(published_id=exp_id)
            self.storage.save_draft(draft)
            return result
        return self._request(request_id, ['publish', draft_id, revision], work)

    def revisions(self, exp_id):
        current = self.get('experiment', exp_id)
        values = self.storage.revisions(exp_id)
        # 旧入口的附件或归档操作也会推进并发修订号；尚未留快照的当前状态允许先查看。
        if not self.storage.snapshot(exp_id, current['revision']): values.insert(0, current)
        return values

    def revision(self, exp_id, revision):
        current = self.get('experiment', exp_id)
        snapshot = self.storage.snapshot(exp_id, revision)
        if snapshot is None and revision == current['revision']: snapshot = current
        if snapshot is None: raise RecordError('not_found', 404)
        return {**snapshot, 'document': snapshot.get('document') or legacy_document(snapshot)}

    def restore(self, exp_id, old_revision, revision, request_id):
        if type(old_revision) is not int or old_revision < 0: raise RecordError('invalid_revision', 422)
        def work():
            current = self._current('experiment', exp_id, revision)
            snapshot = self.revision(exp_id, old_revision)
            target_revision = snapshot['revision']
            if current['content_revision'] == target_revision: return current
            document = self._validate(snapshot['document'])
            links = snapshot.get('attachments', [])
            if any(not isinstance(item, dict) or not item.get('sha256') or not self.attachments or not self.attachments.meta(item['sha256']) for item in links):
                raise RecordError('attachment_not_accessible', 422)
            if not self.storage.snapshot(exp_id, current['revision']): self._save_snapshot(current)
            values = {**{key: snapshot[key] for key in META_FIELDS if key in snapshot},
                      'format_version': 2, 'document_json': encode(document),
                      'summary_text': document_text(document)[:200], 'search_text': document_text(document),
                      'original_notes': snapshot.get('original_notes', ''), 'updated_at': timestamp(),
                      'attachments': encode(self._document_links(document, links)),
                      'references': encode(list(dict.fromkeys(source['reference'] for source in document['sources'] if source['kind'] == 'experiment')))}
            assignments = ','.join(f'"{key}"=?' for key in values)
            parameters = [encode(value) if key == 'tags' else value for key, value in values.items()]
            cursor = self.db.execute(f'UPDATE experiments SET {assignments},revision=revision+1 WHERE id=? AND user_id=? AND revision=?',
                                     [*parameters, exp_id, self.uid(), revision])
            if cursor.rowcount != 1: raise RecordError('revision_conflict')
            # 切换只记录并发修订到既有内容版本的映射，不复制一份内容快照。
            self.storage.link_revision(exp_id, revision + 1, target_revision)
            for proposal in self.storage.proposals_for('experiment', exp_id):
                proposal.update(status='superseded', resolved_at=timestamp())
                self.storage.save_proposal(proposal)
            self.logs.append(exp_id, 'version_switch', [{'path': 'content_revision', 'field': '当前版本',
                                                       'old': current['content_revision'], 'new': target_revision}])
            return self.get('experiment', exp_id)
        return self._request(request_id, ['switch_version', exp_id, old_revision, revision], work)
