"""灵活记录草稿、结构方案和完整版本；与实验仓储使用同一事务连接。"""
import json

from lib.repositories.sqlite_common import UserScopeMixin


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


class SqliteRecordRepository(UserScopeMixin):
    def __init__(self, db, uid_provider):
        super().__init__(uid_provider)
        self.db = db
        db.execute('''CREATE TABLE IF NOT EXISTS record_drafts (
            user_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
            PRIMARY KEY(user_id,id))''')
        db.execute('''CREATE TABLE IF NOT EXISTS record_structure_proposals (
            user_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
            PRIMARY KEY(user_id,id))''')
        db.execute('''CREATE TABLE IF NOT EXISTS experiment_revisions (
            user_id TEXT NOT NULL, exp_id TEXT NOT NULL, revision INTEGER NOT NULL,
            data TEXT NOT NULL, PRIMARY KEY(user_id,exp_id,revision))''')
        db.execute('''CREATE TABLE IF NOT EXISTS record_requests (
            user_id TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
            result TEXT NOT NULL, PRIMARY KEY(user_id,request_id))''')

    def draft(self, target_id):
        return self._get('record_drafts', target_id)

    def drafts(self):
        rows = self.db.execute('SELECT data FROM record_drafts WHERE user_id=? ORDER BY rowid DESC',
                               (self._uid(),)).fetchall()
        return [{key: value[key] for key in ('id', 'metadata', 'revision', 'created_at')}
                for row in rows if not (value := json.loads(row[0])).get('published_id')]

    def proposal(self, proposal_id):
        return self._get('record_structure_proposals', proposal_id)

    def _get(self, table, target_id):
        row = self.db.execute(f'SELECT data FROM {table} WHERE user_id=? AND id=?',
                              (self._uid(), target_id)).fetchone()
        return json.loads(row[0]) if row else None

    def save_draft(self, data):
        self._put('record_drafts', data)

    def save_proposal(self, data):
        self._put('record_structure_proposals', data)

    def _put(self, table, data):
        self.db.execute(f'''INSERT INTO {table}(user_id,id,data) VALUES (?,?,?)
            ON CONFLICT(user_id,id) DO UPDATE SET data=excluded.data''',
                        (self._uid(), data['id'], encode(data)))

    def proposals_for(self, kind, target_id):
        # Each account's proposals are small; JSON target metadata remains an internal detail.
        rows = self.db.execute('SELECT data FROM record_structure_proposals WHERE user_id=?',
                               (self._uid(),)).fetchall()
        return [value for row in rows if (value := json.loads(row[0]))['target_kind'] == kind
                and value['target_id'] == target_id and value['status'] == 'pending']

    def snapshot(self, exp_id, revision):
        row = self.db.execute('SELECT data FROM experiment_revisions WHERE user_id=? AND exp_id=? AND revision=?',
                              (self._uid(), exp_id, revision)).fetchone()
        return json.loads(row[0]) if row else None

    def revisions(self, exp_id):
        rows = self.db.execute('SELECT data FROM experiment_revisions WHERE user_id=? AND exp_id=? ORDER BY revision DESC',
                               (self._uid(), exp_id)).fetchall()
        return [json.loads(row[0]) for row in rows]

    def save_snapshot(self, record):
        self.db.execute('INSERT INTO experiment_revisions(user_id,exp_id,revision,data) VALUES (?,?,?,?)',
                        (self._uid(), record['id'], record['revision'], encode(record)))

    def request(self, request_id):
        row = self.db.execute('SELECT fingerprint,result FROM record_requests WHERE user_id=? AND request_id=?',
                              (self._uid(), request_id)).fetchone()
        return (row[0], json.loads(row[1])) if row else None

    def save_request(self, request_id, fingerprint, result):
        self.db.execute('INSERT INTO record_requests(user_id,request_id,fingerprint,result) VALUES (?,?,?,?)',
                        (self._uid(), request_id, fingerprint, encode(result)))
