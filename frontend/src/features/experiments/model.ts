export type Experiment = {
  id: string; title?: string; date?: string; end_date?: string; status?: string;
  experimenter?: string; archived?: boolean | number | string; tags?: string[];
  purpose?: string; conclusion?: string; sop?: string[];
  materials?: { name?: string }[]; observations?: { items?: string[] };
};
export type ListData = {
  experiments: Experiment[]; pinnedIds: string[]; collections: Record<string, string[]>;
  collectionMeta: Record<string, { description?: string }>; categoryPinned: Record<string, string[]>;
};
export type Filters = { query: string; status: string; tags: string[]; dateFrom: string; dateTo: string };
export const statuses: Record<string, string> = { '': '全部', done: '已完成', running: '进行中', planned: '计划中', repeated: '复刻', failed: '失败', archived: '已归档' };
export const emptyData: ListData = { experiments: [], pinnedIds: [], collections: {}, collectionMeta: {}, categoryPinned: {} };
export const isArchived = (exp: Experiment) => [true, 1, '1', 'true'].includes(exp.archived ?? false);
export function normalizeDate(value?: string) {
  const s = String(value || '').trim();
  return /^(n\/?a|na|null|none|undefined|-|无|未标注|tbd)$/i.test(s) ? '' : s.slice(0, 10).replace(/\//g, '-');
}
export function matches(exp: Experiment, filters: Filters) {
  const { query, status, tags, dateFrom, dateTo } = filters;
  if (isArchived(exp) !== (status === 'archived')) return false;
  if (status && status !== 'archived' && exp.status !== status) return false;
  const text = [exp.id, exp.title, exp.purpose, exp.conclusion, exp.experimenter,
    ...(exp.tags || []), ...(exp.sop || []), ...(exp.materials || []).map(m => m.name),
    ...(exp.observations?.items || [])].join(' ').toLowerCase();
  if (query.trim() && !text.includes(query.trim().toLowerCase())) return false;
  if (tags.length && !tags.some(tag => (exp.tags || []).some(t => t.toLowerCase() === tag.toLowerCase()))) return false;
  const date = normalizeDate(exp.date);
  return !(dateFrom && (!date || date < dateFrom)) && !(dateTo && (!date || date > dateTo));
}
export const sortExperiments = (items: Experiment[]) => items.slice().sort((a, b) =>
  normalizeDate(b.date).localeCompare(normalizeDate(a.date)) || b.id.localeCompare(a.id));
export function dateLabel(value: string) {
  if (!value) return '未标注日期';
  const date = new Date(value + 'T00:00:00');
  if (Number.isNaN(date.getTime())) return value;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - date.getTime()) / 86400000);
  const relative = days <= 0 ? '今天' : days === 1 ? '昨天' : days < 7 ? `${days} 天前`
    : days < 14 ? '上周' : days < 21 ? '上上周' : days < 30 ? '三周前'
    : days < 60 ? '一个月前' : days < 90 ? '两个月前' : days < 180 ? '三个月前'
    : days < 365 ? `${Math.floor(days / 30)} 个月前` : days < 730 ? '一年前' : `${Math.floor(days / 365)} 年前`;
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} 周${'日一二三四五六'[date.getDay()]} · ${relative}`;
}
