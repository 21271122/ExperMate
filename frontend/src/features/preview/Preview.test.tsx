import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { AttachmentPreview, downloadAttachment } from './AttachmentPreview';
import { PrintPreview } from './PrintPreview';

const reply = (body: unknown) => new Response(JSON.stringify(body));
afterEach(() => { vi.unstubAllGlobals(); Reflect.deleteProperty(window,'pywebview'); });
test('Excel 预览保留样式、合并单元格、分页和工作表切换；所选单元格复制为表格', async () => {
  const fetchMock = vi.fn(async (url: string) => reply({ ok: true, kind: 'xlsx', sheet: url.includes('sheet=B') ? 'B' : 'A', sheets: [{ name:'A',rows:300,columns:2 },{ name:'B',rows:1,columns:1 }],
    columns: ['A','B'], rows: [['one','two'],['three','four']], start_row:url.includes('start_row=201')?201:1, has_more:!url.includes('start_row=201'), cell_styles:{ A1:{font:{bold:true},fill:'#ffff00'} }, merged_cells:[] }));
  vi.stubGlobal('fetch', fetchMock); const user=userEvent.setup(), close=vi.fn(); render(<AttachmentPreview item={{sha256:'sheet',url:'/api/attachments/sheet',name:'test.xlsx'}} close={close}/>);
  const first=await screen.findByText('one');expect(first).toHaveStyle({fontWeight:700,backgroundColor:'#ffff00'});
  fireEvent.mouseDown(first);fireEvent.mouseOver(screen.getByText('four'));fireEvent.mouseUp(screen.getByText('four'));
  const clipboard={setData:vi.fn()};fireEvent.copy(first.closest('table')!,{clipboardData:clipboard});
  expect(clipboard.setData).toHaveBeenCalledWith('text/plain','one\ttwo\nthree\tfour');expect(clipboard.setData).toHaveBeenCalledWith('text/html',expect.stringContaining('<td>four</td>'));
  await user.click(screen.getByTitle('放大'));expect(document.querySelector('table')).toHaveStyle({zoom:'110%'});
  await user.click(screen.getByRole('button',{name:'下一页'}));await waitFor(()=>expect(fetchMock.mock.calls.some(([url])=>url.includes('start_row=201'))).toBe(true));
  await screen.findByRole('button',{name:'上一页'});await user.click(screen.getByRole('button',{name:'B (1×1)'}));await waitFor(()=>expect(fetchMock.mock.calls.some(([url])=>url.includes('sheet=B'))).toBe(true));
  await user.click(screen.getByRole('button',{name:'关闭'}));expect(close).toHaveBeenCalledOnce();
});
test('打印预览使用原文档输出，加载后才启用打印，关闭时取消读取', async()=>{
  const fetchMock=vi.fn(async()=>new Response('<html><body>Print fixture</body></html>'));vi.stubGlobal('fetch',fetchMock);
  const user=userEvent.setup(),close=vi.fn(),view=render(<PrintPreview request={{path:'/experiments/E1/print',label:'实验'}} close={close}/>);
  await waitFor(()=>expect(screen.getByTitle('实验打印预览')).toHaveAttribute('srcdoc',expect.stringContaining('Print fixture')));
  expect(screen.getByRole('button',{name:'打印'})).toBeEnabled();await user.click(screen.getByRole('button',{name:'关闭打印预览'}));expect(close).toHaveBeenCalledOnce();
  view.unmount();expect((fetchMock.mock.calls[0] as unknown as [string,RequestInit])[1].signal?.aborted).toBe(true);
});
test('桌面下载先通过 Cookie 获取内容，再交给本机保存窗口，不向 JavaScript 暴露会话令牌',async()=>{
  const save=vi.fn(async()=>({ok:true}));Object.assign(window,{pywebview:{api:{save_attachment_data:save}}});
  const fetchMock=vi.fn(async()=>new Response(new Uint8Array([0,1,2,255])));vi.stubGlobal('fetch',fetchMock);
  await downloadAttachment({sha256:'a',url:'/api/attachments/a',name:'test.bin'});
  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/attachments/a?download=1'));expect(save).toHaveBeenCalledWith('test.bin','AAEC/w==');
});
