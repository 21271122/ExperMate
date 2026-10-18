import type { ReactNode } from 'react';
import { usePageData } from '../../app/usePageData';
import { markdown, resultTable, tableFields, type ExperimentDetailData, type TableRow } from './detail-model';
import { statuses } from './model';
import { RecordDocument } from '../record-document/RecordDocument';
import type { RecordDocument as DocumentData } from '../record-document/model';

const colors = ['#2563eb', '#dc2626', '#16a34a', '#9333ea'];
function Table({ rows, keys, headers }: { rows: TableRow[]; keys: string[]; headers: string[] }) {
  return <table className="academic-table" style={{ fontSize: '0.78rem' }}><thead><tr>{headers.map(header => <th key={header}>{header}</th>)}</tr></thead>
    <tbody>{rows.map((row, index) => <tr key={index}>{keys.map(key => <td key={key}>{row?.[key] || ''}</td>)}</tr>)}</tbody></table>;
}
export function Comparison() {
  const ids = new URLSearchParams(location.search).get('ids') || '';
  const { data, error } = usePageData<ExperimentDetailData[]>('/api/v1/compare?ids=' + encodeURIComponent(ids), '/compare');
  if (!data) return <div className={`flash${error ? ' flash-error' : ''}`} role={error ? 'alert' : 'status'}>{error || '加载中…'}</div>;
  if (data.some(record => record.format_version === 2)) return <><h1>实验对比</h1>{data.map(record => <section key={record.id} style={{ borderLeft: '5px solid var(--black)', paddingLeft: '1rem' }}><h2>{record.id} · {record.title}</h2>{record.document ? <RecordDocument value={record.document as DocumentData} /> : <p>此旧记录请打开详情查看：<a href={`/experiments/${record.id}`}>{record.title || record.id}</a></p>}</section>)}</>;
  function section(label: string, has: (exp: ExperimentDetailData) => boolean, content: (exp: ExperimentDetailData) => ReactNode, footer = false) {
    if (!data!.some(has)) return null;
    return <details className="section-group" open><summary style={{ borderBottom: '3px solid var(--black)' }}>{label}</summary><div style={{ marginTop: '0.5rem' }}>
      {data!.map((exp, index) => (!footer || has(exp)) && <div key={exp.id} style={{ borderLeft: `6px solid ${colors[index]}`, paddingLeft: '0.8rem', marginBottom: '0.8rem' }}>
        <small style={{ color: colors[index], fontWeight: 700 }}>{exp.id}{!footer && <> · {exp.date || ''} · <span className={`status-badge status-${exp.status}`}>{statuses[exp.status || ''] || exp.status}</span></>}</small>
        {content(exp)}</div>)}</div></details>;
  }
  const text = (key: 'purpose' | 'conclusion') => (exp: ExperimentDetailData) => <div className="markdown-content" dangerouslySetInnerHTML={{ __html: markdown(exp[key] || '') }} />;
  const table = (key: keyof typeof tableFields, label: string) => section(label, exp => !!exp[key]?.length, exp => {
    const config = tableFields[key];
    const headers = key === 'experimental_plan' ? ['分组', '条件', '预期'] : key === 'characterization' ? ['方法', '样品', '制样方式', '送样日期', '数据路径'] : config.headers;
    return !!exp[key]?.length && <Table rows={exp[key]!} keys={config.keys} headers={headers} />;
  });
  return <><h1 style={{ borderBottom: 'none', paddingBottom: 0 }}>实验对比</h1><div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1.5rem' }}>
    {data.map((exp, index) => <span key={exp.id} style={{ padding: '0.25em 0.7em', fontSize: '0.78rem', fontWeight: 700, color: '#fff', background: colors[index], border: '2px solid var(--black)' }}>{exp.id}</span>)}</div>
    {section('1. 实验目的', exp => !!exp.purpose, text('purpose'))}{table('materials', '2. 材料')}{table('equipment', '3. 设备')}{table('experimental_plan', '4. 实验方案')}
    {section('5. SOP', exp => !!exp.sop?.length, exp => !!exp.sop?.length && <ol style={{ margin: '0.3em 0', paddingLeft: '1.2em', fontSize: '0.85rem' }}>{exp.sop.map((item, i) => <li key={i}>{item}</li>)}</ol>)}
    {table('process_parameters', '6. 过程参数')}
    {section('7. 观察记录', exp => typeof exp.observations === 'object' && !!(exp.observations.items?.length || !exp.observations.no_anomalies), exp => {
      const obs = typeof exp.observations === 'object' ? exp.observations : null;
      return <>{obs?.no_anomalies && <p style={{ fontSize: '0.85rem', fontWeight: 700 }}>未见异常</p>}{!!obs?.items?.length && <ul style={{ margin: '0.2em 0', paddingLeft: '1.2em', fontSize: '0.85rem' }}>{obs.items.map((item, i) => <li key={i}>{item}</li>)}</ul>}</>;
    })}{table('characterization', '8. 表征')}
    {section('9. 实验结果', exp => typeof exp.results === 'object' && !!(exp.results.qualitative || exp.results.key_data?.length), exp => {
      const result = typeof exp.results === 'object' ? exp.results : null;
      return <>{result?.qualitative && <p style={{ fontSize: '0.85rem' }}>{result.qualitative}</p>}{!!result?.key_data?.length && <Table rows={result.key_data} {...resultTable} />}</>;
    })}
    {section('10. 结论', exp => !!exp.conclusion, text('conclusion'), true)}
    {section('11. 下一步', exp => !!exp.next_steps?.length, exp => <ol style={{ margin: '0.2em 0', paddingLeft: '1.2em', fontSize: '0.85rem' }}>{exp.next_steps?.map((item, i) => <li key={i}>{item}</li>)}</ol>, true)}
    <div style={{ textAlign: 'center', marginTop: '2rem' }}><a href="/" role="button" className="outline">← 返回首页</a></div></>;
}
