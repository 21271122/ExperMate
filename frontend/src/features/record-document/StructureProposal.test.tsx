import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { StructureProposal } from './StructureProposal';
import type { RecordDocument, StructureProposal as Proposal } from './model';

afterEach(() => vi.restoreAllMocks());
const response = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
function proposal(): Proposal {
  const before: RecordDocument = { format_version: 2, sections: [{ id: 'conditions', fields: [{ id: 'a', label: '目的', kind: 'text', presentation: 'text', content: { text: '原始记录' } }] }, { id: 'process', fields: [] }, { id: 'results', fields: [] }], sources: [] };
  const document = structuredClone(before); document.sections[0].fields[0].label = '实验目的';
  (document.sections[0].fields[0].content as { text: string }).text = '调整后的记录';
  return { id: 'p1', target_kind: 'draft', target_id: 'd1', base_revision: 3, hash: 'hash-one', status: 'pending', before, document,
    change_summary: { changes: [
      { kind: 'field_renamed', field_id: 'a', message: '字段「目的」改名为「实验目的」。', warning: false, review_content: false },
      { kind: 'content_changed', field_id: 'a', message: '内容同时发生变化，请核对。', warning: true, review_content: true },
    ] } };
}

test('展示服务端摘要，按字段核对变更内容，批准仍绑定服务端哈希和版本', async () => {
  const data = proposal();
  data.change_summary!.changes[0].message = '<img src=x onerror=alert(1)>字段改名';
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response(data)).mockResolvedValueOnce(response({ revision: 4 }));
  const updated = vi.fn();
  const { container } = render(<StructureProposal id="p1" updated={updated} />);
  const summary = await screen.findByRole('region', { name: '方案变更摘要' });
  expect(within(summary).getByText('<img src=x onerror=alert(1)>字段改名')).toBeVisible();
  expect(summary.querySelector('img')).toBeNull();
  expect(within(summary).queryByText('原始记录')).toBeNull();
  fireEvent.click(within(summary).getByText('核对「实验目的」的内容'));
  await waitFor(() => expect(within(summary).getByText('原始记录')).toBeVisible());
  expect(within(summary).getByText('调整后的记录')).toBeVisible();
  expect(container.querySelectorAll('.record-change-review')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '批准此方案' }));
  await screen.findByText('基于修订 3 · 已批准');
  expect(JSON.parse(fetcher.mock.calls[1][1]?.body as string)).toEqual({ decision: 'approved', proposal_hash: 'hash-one', base_revision: 3 });
  expect(updated).toHaveBeenCalledOnce();
});

test('调整时隐藏旧摘要，保存后显示服务端新摘要，保存调整不会自动批准', async () => {
  const initial = proposal(), revised = proposal();
  revised.id = 'p2'; revised.hash = 'hash-two';
  revised.change_summary = { changes: [{ kind: 'field_renamed', field_id: 'a', message: '服务端重新计算的摘要', warning: false, review_content: false }] };
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response(initial)).mockResolvedValueOnce(response(revised)).mockResolvedValueOnce(response({ revision: 4 }));
  render(<StructureProposal id="p1" updated={vi.fn()} />);
  await screen.findByRole('region', { name: '方案变更摘要' });
  fireEvent.click(screen.getByRole('button', { name: '调整方案' }));
  expect(screen.queryByRole('region', { name: '方案变更摘要' })).toBeNull();
  expect(screen.getByText(/保存调整不会批准方案/)).toBeVisible();
  fireEvent.change(screen.getByLabelText('实验目的内容'), { target: { value: '人工调整的内容' } });
  fireEvent.click(screen.getByRole('button', { name: '保存调整后的方案' }));
  await screen.findByText('服务端重新计算的摘要');
  expect(fetcher).toHaveBeenCalledTimes(2);
  const request = JSON.parse(fetcher.mock.calls[1][1]?.body as string);
  expect(request.document.sections[0].fields[0].content.text).toBe('人工调整的内容');
  expect(request).not.toHaveProperty('change_summary');
  fireEvent.click(screen.getByRole('button', { name: '批准此方案' }));
  await screen.findByText('基于修订 3 · 已批准');
  expect(fetcher.mock.calls[2][0]).toBe('/api/v1/structure-proposals/p2/resolve');
  expect(JSON.parse(fetcher.mock.calls[2][1]?.body as string).proposal_hash).toBe('hash-two');
});
