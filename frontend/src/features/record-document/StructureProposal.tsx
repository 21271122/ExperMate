import { useEffect, useState } from 'react';
import { requestJson } from '../../shared/api';
import type { RecordDocument as DocumentData, StructureProposal as Proposal } from './model';
import { RecordDocument } from './RecordDocument';

export function StructureProposal({ id, updated }: { id: string; updated: () => void }) {
  const [proposal, setProposal] = useState<Proposal | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [candidate, setCandidate] = useState<DocumentData | null>(null), [editing, setEditing] = useState(false);
  useEffect(() => { const controller = new AbortController();
    void requestJson(`/api/v1/structure-proposals/${encodeURIComponent(id)}`, { signal: controller.signal }).then(body => setProposal(body.data)).catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [id]);
  async function resolve(decision: 'approved' | 'rejected') {
    if (!proposal || busy) return;
    setBusy(true); setError('');
    try { await requestJson(`/api/v1/structure-proposals/${encodeURIComponent(proposal.id)}/resolve`, { method: 'POST', body: JSON.stringify({ decision, proposal_hash: proposal.hash, base_revision: proposal.base_revision }) }); setProposal({ ...proposal, status: decision }); updated(); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  async function amend() {
    if (!candidate || !proposal || busy) return;
    setBusy(true); setError('');
    try {
      const kind = proposal.target_kind === 'draft' ? 'record-drafts' : 'experiments';
      const body = await requestJson(`/api/v1/${kind}/${encodeURIComponent(proposal.target_id)}/structure-proposals`, { method: 'POST', body: JSON.stringify({ expected_revision: proposal.base_revision, document: candidate }) });
      setProposal(body.data); setEditing(false);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  return <article className="record-proposal"><strong>实验字段结构方案</strong>{error && <p role="alert">{error}</p>}{proposal && <>
    <p className="record-proposal-meta">基于修订 {proposal.base_revision} · {{ pending: '等待手动确认', approved: '已批准', rejected: '已拒绝', cancelled: '已取消', superseded: '已被新方案替代' }[proposal.status] || proposal.status}</p>
    <details><summary>查看修改前</summary><RecordDocument value={proposal.before} /></details>
    <details open={editing || proposal.status === 'pending'}><summary>查看完整方案</summary><RecordDocument value={editing && candidate ? candidate : proposal.document} change={editing ? setCandidate : undefined} /></details>
    {proposal.status === 'superseded' && <a href={proposal.target_kind === 'draft' ? `/record-drafts/${proposal.target_id}` : `/experiments/${proposal.target_id}`}>打开记录查看当前方案</a>}
    {proposal.status === 'pending' && <div className="record-controls">{editing ? <><button type="button" disabled={busy} onClick={() => void amend()}>保存调整后的方案</button><button type="button" disabled={busy} onClick={() => setEditing(false)}>取消调整</button></> : <><button type="button" disabled={busy} onClick={() => void resolve('approved')}>批准此方案</button><button type="button" disabled={busy} onClick={() => { setCandidate(structuredClone(proposal.document)); setEditing(true); }}>调整方案</button><button type="button" disabled={busy} onClick={() => void resolve('rejected')}>拒绝</button></>}</div>}
  </>}</article>;
}
