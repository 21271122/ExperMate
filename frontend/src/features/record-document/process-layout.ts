import type { ProcessData } from './model';

type Box = { id: string; kind: 'material' | 'action'; lines: string[]; width: number; height: number; x: number; y: number; rank: number; rowTop?: number; rowBottom?: number; columnLeft?: number; columnRight?: number };
type Link = { source: string; target: string; arrow: boolean };
const padding = 18, gap = 24, lineHeight = 18;
const textWidth = (text: string) => Array.from(text).reduce((sum, char) => sum + (/[^\u0000-\u00ff]/.test(char) ? 14 : /[MW@]/.test(char) ? 13 : /[A-Z]/.test(char) ? 9.5 : /[il.,\s]/.test(char) ? 4 : 7.5), 0);

// SVG text does not wrap itself. Keep every character, including long sample names and units.
function wrap(text: string, width: number) {
  return text.split('\n').flatMap(paragraph => {
    const lines: string[] = []; let line = '';
    for (const char of Array.from(paragraph)) {
      if (line && textWidth(line + char) > width) {
        const space = line.lastIndexOf(' ');
        if (space > line.length / 2) { lines.push(line.slice(0, space)); line = line.slice(space + 1); }
        else { lines.push(line); line = ''; }
      }
      line += char;
    }
    return [...lines, line.trimEnd()];
  });
}

export function layoutProcess(data: ProcessData, containerWidth: number) {
  const available = Math.max(80, containerWidth), boxes: Box[] = [], links: Link[] = [];
  function add(id: string, kind: Box['kind'], text: string) {
    const inset = kind === 'material' ? 20 : 8;
    const lines = wrap(text, Math.max(14, Math.min(172, available - padding * 2 - inset)));
    boxes.push({ id, kind, lines, width: Math.max(kind === 'material' ? 58 : 24, ...lines.map(textWidth)) + inset,
      height: lines.length * lineHeight + (kind === 'material' ? 16 : 8), x: 0, y: 0, rank: 0 });
  }
  data.nodes.forEach(node => add('m:' + node.id, 'material', node.label));
  data.actions.forEach(action => {
    add('a:' + action.id, 'action', [action.label, action.repeat_note, ...action.parameters.map(p => `${p.label} ${p.value}${p.unit || ''}`)].filter(Boolean).join(' · '));
    action.source_ids.forEach(id => links.push({ source: 'm:' + id, target: 'a:' + action.id, arrow: false }));
    action.target_ids.forEach(id => links.push({ source: 'a:' + action.id, target: 'm:' + id, arrow: true }));
  });
  const byId = Object.fromEntries(boxes.map(box => [box.id, box]));
  const incoming = Object.fromEntries(boxes.map(box => [box.id, 0]));
  for (const link of links) if (byId[link.source] && byId[link.target]) incoming[link.target]++;
  const remaining = new Set(boxes.map(box => box.id));
  // For cycles, break one ordering dependency and draw its return edge in the outer gutter.
  while (remaining.size) {
    const id = [...remaining].find(key => incoming[key] === 0) || remaining.values().next().value!;
    remaining.delete(id);
    for (const link of links) if (link.source === id && remaining.has(link.target)) {
      byId[link.target].rank = Math.max(byId[link.target].rank, byId[id].rank + 1);
      incoming[link.target]--;
    }
  }
  const ranks = [...new Set(boxes.map(box => box.rank))].sort((a, b) => a - b);
  const stages = ranks.map(rank => boxes.filter(box => box.rank === rank));
  const horizontalWidth = padding * 2 + stages.reduce((sum, stage) => sum + Math.max(...stage.map(box => box.width)), 0) + Math.max(0, stages.length - 1) * gap;
  const direction = horizontalWidth <= available ? 'horizontal' : 'vertical';
  const wrappedRanks = new Set<number>();
  let width: number, height: number;
  if (direction === 'horizontal') {
    width = horizontalWidth;
    height = padding * 2 + Math.max(0, ...stages.map(stage => stage.reduce((sum, box) => sum + box.height, 0) + (stage.length - 1) * gap));
    let x = padding;
    for (const stage of stages) {
      const stageWidth = Math.max(...stage.map(box => box.width));
      let y = (height - stage.reduce((sum, box) => sum + box.height, 0) - (stage.length - 1) * gap) / 2;
      for (const box of stage) { box.x = x + (stageWidth - box.width) / 2; box.y = y; box.columnLeft = x; box.columnRight = x + stageWidth; y += box.height + gap; }
      x += stageWidth + gap;
    }
  } else {
    width = available;
    let y = padding;
    for (const stage of stages) {
      const rows: Box[][] = [[]]; let used = 0;
      for (const box of stage) {
        if (used && used + gap + box.width > available - padding * 2) { rows.push([]); used = 0; }
        rows[rows.length - 1].push(box); used += (used ? gap : 0) + box.width;
      }
      if (rows.length > 1) wrappedRanks.add(stage[0].rank);
      for (const row of rows) {
        const rowHeight = Math.max(...row.map(box => box.height));
        let x = (width - row.reduce((sum, box) => sum + box.width, 0) - (row.length - 1) * gap) / 2;
        for (const box of row) { box.x = x; box.y = y + (rowHeight - box.height) / 2; box.rowTop = y; box.rowBottom = y + rowHeight; x += box.width + gap; }
        y += rowHeight + gap;
      }
    }
    height = y - gap + padding;
  }
  const paths = links.filter(link => byId[link.source] && byId[link.target]).map(link => {
    const a = byId[link.source], b = byId[link.target];
    const forward = b.rank > a.rank;
    let d: string;
    if (direction === 'horizontal') {
      const x1 = a.x + a.width, y1 = a.y + a.height / 2, x2 = b.x, y2 = b.y + b.height / 2;
      d = forward ? `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`
        : `M${x1},${y1} L${a.columnRight! + gap / 2},${y1} L${a.columnRight! + gap / 2},6 L${b.columnLeft! - gap / 2},6 L${b.columnLeft! - gap / 2},${y2} L${x2},${y2}`;
    } else {
      const x1 = a.x + a.width / 2, y1 = a.y + a.height, x2 = b.x + b.width / 2, y2 = b.y;
      if (forward && (wrappedRanks.has(a.rank) || wrappedRanks.has(b.rank) || b.rank - a.rank > 1)) {
        // Route through row gaps and the outer gutter, never through a wrapped material row.
        const actionId = a.kind === 'action' ? a.id : b.id;
        const lane = 5 + (data.actions.findIndex(action => 'a:' + action.id === actionId) + 1) / (data.actions.length + 1) * 8;
        const gutter = a.kind === 'action' ? width - lane : lane;
        d = `M${x1},${y1} L${x1},${a.rowBottom! + gap / 2} L${gutter},${a.rowBottom! + gap / 2} L${gutter},${b.rowTop! - gap / 2} L${x2},${b.rowTop! - gap / 2} L${x2},${y2}`;
      } else d = forward ? `M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`
        : `M${x1},${y1} L${x1},${a.rowBottom! + gap / 2} L6,${a.rowBottom! + gap / 2} L6,${b.rowTop! - gap / 2} L${x2},${b.rowTop! - gap / 2} L${x2},${y2}`;
    }
    return { ...link, d };
  });
  return { direction, width: Math.max(padding * 2, width), height: Math.max(padding * 2, height), boxes, paths };
}
