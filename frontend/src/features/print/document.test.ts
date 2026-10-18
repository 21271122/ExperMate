import { describe, expect, it, vi } from 'vitest';
import { enhancePrintDocument } from './document';

describe('standalone print document', () => {
  it('renders Markdown and connects controls to its own window', () => {
    document.body.innerHTML = '<div class="markdown-content">**实验结果**\n\n|指标|值|\n|---|---|\n|温度|25℃|</div><button data-print-action="print">打印</button><button data-print-action="close">关闭</button>';
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    const close = vi.spyOn(window, 'close').mockImplementation(() => {});
    enhancePrintDocument(document);
    expect(document.querySelector('strong')).toHaveTextContent('实验结果');
    expect(document.querySelector('td')).toHaveTextContent('温度');
    document.querySelector<HTMLButtonElement>('[data-print-action="print"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-print-action="close"]')!.click();
    expect(print).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });
});
