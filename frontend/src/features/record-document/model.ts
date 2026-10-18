export type Source = { id: string; kind: 'message' | 'attachment' | 'experiment' | 'legacy'; reference: string; page?: number | null; revision?: number | null; field_id?: string | null; excerpt?: string };
type Base = { id: string; label: string; note?: string; source_refs?: string[] };
export type TableData = { columns: { id: string; label: string; type?: 'text' | 'number' }[]; rows: { id: string; cells: Record<string, string> }[] };
export type ProcessData = { nodes: { id: string; label: string; note?: string }[]; actions: {
  id: string; label: string; source_ids: string[]; target_ids: string[]; repeat_note?: string; note?: string;
  parameters: { id: string; label: string; value: string; unit?: string }[];
}[]; layout?: Record<string, { x: number; y: number }> };
export type RecordField = Base & (
  { kind: 'text'; presentation: 'text'; content: { text: string } } |
  { kind: 'table'; presentation: 'table' | 'cards'; content: TableData } |
  { kind: 'process'; presentation: 'flow' | 'steps'; content: ProcessData } |
  { kind: 'formula'; presentation: 'formula'; content: { latex: string; explanation: string; substitution: string; result: string } } |
  { kind: 'assets'; presentation: 'gallery' | 'files'; content: { items: { sha256: string; caption: string }[] } }
);
export type RecordDocument = { format_version: 2; sections: { id: 'conditions' | 'process' | 'results'; fields: RecordField[] }[]; sources: Source[] };
export type RecordValue = { id: string; revision: number; content_revision?: number; document: RecordDocument; metadata?: Record<string, unknown>; title?: string; date?: string; experimenter?: string; status?: string; original_notes?: string; archived?: boolean; format_version?: number; published_id?: string | null };
export type ProposalChange = { kind: string; message: string; field_id: string | null; warning: boolean; review_content: boolean };
export type StructureProposal = { id: string; target_kind: 'draft' | 'experiment'; target_id: string; base_revision: number; hash: string; status: string; document: RecordDocument; before: RecordDocument; change_summary?: { changes: ProposalChange[] } };
export const sectionLabels = { conditions: '实验条件', process: '实验过程', results: '结果与分析' };
export const fieldLabels = { text: '文本', table: '表格', process: '流程图', formula: '公式', assets: '附件' };
export const newId = () => crypto.randomUUID().replaceAll('-', '');
export function newField(kind: RecordField['kind']): RecordField {
  const base = { id: newId(), label: '新字段', note: '', source_refs: [] };
  switch (kind) {
    case 'text': return { ...base, kind, presentation: 'text', content: { text: '' } };
    case 'table': return { ...base, kind, presentation: 'table', content: { columns: [{ id: newId(), label: '名称', type: 'text' }], rows: [] } };
    case 'process': return { ...base, kind, presentation: 'flow', content: { nodes: [], actions: [], layout: {} } };
    case 'formula': return { ...base, kind, presentation: 'formula', content: { latex: '', explanation: '', substitution: '', result: '' } };
    case 'assets': return { ...base, kind, presentation: 'files', content: { items: [] } };
  }
}
