import { expect, test } from 'vitest';
import type { ProcessData } from './model';
import { layoutProcess } from './process-layout';

const simple: ProcessData = {
  nodes: [{ id: 'water', label: '去离子水' }, { id: 'mixed', label: '搅拌后的液体' }],
  actions: [{ id: 'stir', label: '搅拌', source_ids: ['water'], target_ids: ['mixed'], parameters: [{ id: 'time', label: '时间', value: '5', unit: 'min' }] }],
};

function expectFits(data: ProcessData, width: number) {
  const result = layoutProcess(data, width);
  expect(result.width).toBeLessThanOrEqual(width);
  for (const box of result.boxes) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(result.width + .01);
    expect(box.y + box.height).toBeLessThanOrEqual(result.height + .01);
  }
  return result;
}

function pathPoints(path: string) {
  const tokens = path.match(/[MLC]|-?\d*\.?\d+/g)!;
  const points: { x: number; y: number }[] = []; let current = { x: 0, y: 0 };
  for (let i = 0; i < tokens.length;) {
    const command = tokens[i++], start = current;
    const pair = () => ({ x: Number(tokens[i++]), y: Number(tokens[i++]) });
    if (command === 'M') { current = pair(); continue; }
    const control1 = pair(), control2 = command === 'C' ? pair() : control1;
    const end = command === 'C' ? pair() : control1;
    for (let step = 0; step <= 40; step++) {
      const t = step / 40, u = 1 - t;
      points.push(command === 'C' ? { x: u ** 3 * start.x + 3 * u ** 2 * t * control1.x + 3 * u * t ** 2 * control2.x + t ** 3 * end.x,
        y: u ** 3 * start.y + 3 * u ** 2 * t * control1.y + 3 * u * t ** 2 * control2.y + t ** 3 * end.y } : { x: start.x * u + end.x * t, y: start.y * u + end.y * t });
    }
    current = end;
  }
  return points;
}

test('根据实际容器选择横排或竖排，不放大短流程的字体与节点', () => {
  const desktop = expectFits(simple, 800), phone = expectFits(simple, 240);
  expect(desktop.direction).toBe('horizontal'); expect(phone.direction).toBe('vertical');
  expect(desktop.width).toBeLessThan(500);
  const water = desktop.boxes.find(box => box.id === 'm:water')!;
  expect(water.height).toBe(34); expect(water.width).toBeLessThan(100);
  expect(phone.boxes.find(box => box.id === 'm:mixed')!.y).toBeGreaterThan(phone.boxes.find(box => box.id === 'm:water')!.y);
});

test('多输入分支和多输出分支在窄屏换行，动作及参数只出现一次', () => {
  const data: ProcessData = {
    nodes: [...Array.from({ length: 9 }, (_, i) => ({ id: 'input-' + i, label: '溶液 ' + i })), { id: 'one', label: '上层清液' }, { id: 'two', label: '沉淀样品' }],
    actions: [{ id: 'separate', label: '混合后离心', source_ids: Array.from({ length: 9 }, (_, i) => 'input-' + i), target_ids: ['one', 'two'], parameters: [{ id: 'speed', label: '转速', value: '3000', unit: 'rpm' }] }],
  };
  for (const width of [160, 240, 320, 600, 1200]) {
    const result = expectFits(data, width);
    expect(result.boxes.filter(box => box.kind === 'action')).toHaveLength(1);
    expect(result.paths).toHaveLength(11);
    expect(result.paths.filter(path => path.arrow)).toHaveLength(2);
    for (const path of result.paths) for (const point of pathPoints(path.d)) {
      expect(result.boxes.some(box => point.x > box.x + 1 && point.x < box.x + box.width - 1 && point.y > box.y + 1 && point.y < box.y + box.height - 1)).toBe(false);
    }
  }
});

test('长物质名称、动作条件及循环均完整保留，不改写持久化布局或事实', () => {
  const data = structuredClone(simple);
  data.nodes[0].label = '含聚乙烯吡咯烷酮的硝酸镍水溶液 / Ni(NO3)2·6H2O';
  data.actions[0].repeat_note = '重复洗涤三次，每次重新加入新鲜去离子水';
  data.actions.push({ id: 'return', label: '取样后返回原容器', source_ids: ['mixed'], target_ids: ['water'], parameters: [] });
  data.layout = { water: { x: 10000, y: 20000 } };
  const before = JSON.stringify(data);
  for (const width of [160, 240, 400, 1000]) {
    const result = expectFits(data, width);
    const label = result.boxes.find(box => box.id === 'm:water')!.lines.join('');
    expect(label.replaceAll(' ', '')).toBe(data.nodes[0].label.replaceAll(' ', ''));
    expect(result.paths.every(path => !/NaN|Infinity/.test(path.d))).toBe(true);
  }
  expect(JSON.stringify(data)).toBe(before);
});
