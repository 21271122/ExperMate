import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import { markdown } from '../../shared/markdown';
import { services } from '../../runtime/services';
import { SelectorCard } from './SelectorCard';
import type { ToolActions, ToolResult } from './tool-model';
import { StructureProposal } from '../record-document/StructureProposal';

const cardDisplays = new Set(['diff', 'answer', 'report', 'analysis_done', 'record_generated', 'music_control', 'list', 'selector', 'structure_proposal']);
export const hasToolCard = (result?: ToolResult) => cardDisplays.has(result?.display || '')
  && (result?.display !== 'diff' || !!result.changes?.length)
  && (result?.display !== 'list' || !!result.experiments?.length);
function Markdown({ text, style }: { text: string; style?: React.CSSProperties }) {
  return <div className="markdown-content" style={style} dangerouslySetInnerHTML={{ __html: markdown(text) }} />;
}
function Frame({ variant, title, children, footer, animate }: { variant: string; title?: ReactNode; children: ReactNode; footer?: ReactNode; animate?: boolean }) {
  return <div className={`tool-card ${variant}${animate ? ' tool-card-enter' : ''}`}>
    {title && <div className="tool-card-header">{title}</div>}<div className="tool-card-body">{children}</div>
    {footer && <div className="tool-card-footer">{footer}</div>}
  </div>;
}
function MusicCard({ result, animate }: { result: ToolResult; animate?: boolean }) {
  const action = result.action || 'status', title = result.track?.title || '';
  const labels: Record<string, [ReactNode, string]> = {
    add: [<>已加入曲库：<strong>{title || '该音频'}</strong></>, '曲库已更新'],
    stop: [title ? <>已停止播放：<strong>{title}</strong></> : '背景音乐已停止', '音乐已关闭'],
    next: [<>已切换为：<strong>{title || '下一首'}</strong></>, '正在播放'],
    play: [<>已开始播放：<strong>{title || '当前曲目'}</strong></>, '正在播放'],
  };
  const [body, footer] = labels[action] || [result.current?.enabled && title ? <>当前播放：<strong>{title}</strong></> : '当前没有播放背景音乐', `曲库 ${result.tracks?.length || 0} 首`];
  return <Frame variant={`music music-${action}`} title="音乐控制" footer={footer} animate={animate}>{body}</Frame>;
}

export function ToolCard({ result, historical, animate, toolCallId, api }: {
  result?: ToolResult; historical?: boolean; animate?: boolean; toolCallId?: string; api: ToolActions;
}) {
  const notified = useRef(false);
  useEffect(() => {
    if (notified.current || cardDisplays.has(result?.display || '')) return;
    notified.current = true;
    if (result?.display === 'toast') { if (!historical) api.showToast(result.message || ''); }
    else api.appendSystemMsg('[Tool: unknown]');
  }, [result, historical, api]);
  if (!result) return null;
  const frame = { animate };
  switch (result.display) {
    case 'structure_proposal': return result.proposal_id ? <StructureProposal id={result.proposal_id} updated={() => { api.setSending(false); api.send('字段方案已处理，请继续整理。'); }} /> : null;
    case 'selector': return <SelectorCard result={result} historical={historical} animate={animate} toolCallId={toolCallId} api={api} />;
    case 'diff': return result.changes?.length ? <Frame {...frame} variant="diff" title={result.target_kind === 'draft' ? '草稿已保存' : '修改已保存'}>{result.changes.map((change, index) => <div className="diff-row" key={index}>
      <span className="df">{change.exp_id ? `${change.exp_id} · ` : ''}{change.field || ''}</span>{' '}<span className="do">{change.old || ''}</span>{' → '}<span className="dn">{change.new || ''}</span>
    </div>)}</Frame> : null;
    case 'answer': return <Frame {...frame} variant="answer" title={`Q: ${result.question || ''}`} footer={<>Source: {result.source === 'file' ? 'Confirmed from file' : 'Conversation memory'}{result.exp_ids?.map(id => <Fragment key={id}>{' '}<a href={`/experiments/${encodeURIComponent(id)}`}>{id}</a></Fragment>)}</>}><p>{result.answer || ''}</p></Frame>;
    case 'report': return <Frame {...frame} variant="report"><Markdown text={result.markdown || ''} /></Frame>;
    case 'analysis_done': return <Frame {...frame} variant="analysis_done" title="分析已归档" footer={result.anal_id && <a href={`/analysis/${encodeURIComponent(result.anal_id)}`} className="tool-card-btn">查看报告 →</a>}>
      <div><span style={{ opacity: .62 }}>分析编号</span>{' '}<strong>{result.anal_id || ''}</strong></div>
      <div style={{ marginTop: 4 }}><span style={{ opacity: .62 }}>分析主题</span>{' '}{result.topic || result.title || ''}</div>
      {result.summary && <Markdown text={result.summary} style={{ marginTop: 4, fontSize: '.8rem' }} />}
    </Frame>;
    case 'record_generated': return <Frame {...frame} variant="record" title="Experiment Generated" footer={result.exp_id && <a href={`/experiments/${encodeURIComponent(result.exp_id)}`} className="tool-card-btn">View Experiment →</a>}>
      <strong>{result.exp_id || ''}</strong>{' — '}{result.title || ''}{result.summary && <div style={{ marginTop: 4, fontSize: '.8rem' }}>{result.summary}</div>}
    </Frame>;
    case 'music_control': return <MusicCard result={result} animate={animate} />;
    case 'list': return result.experiments?.length ? <Frame {...frame} variant="list" title={`Found ${result.count || 0} experiments`}>{result.experiments.map(item => <article className="list-item" key={item.id}
      onClick={event => services.PanelManager?.navigate(`/experiments/${encodeURIComponent(item.id)}`, event.currentTarget)}>
      <strong>{item.id}</strong>{' '}{item.title || ''}{' '}<small>{item.date || ''}</small><span className="open-hint"> 打开 →</span>
    </article>)}</Frame> : null;
    default: return null;
  }
}
