import { markdown } from '../../shared/markdown';

export function enhancePrintDocument(doc: Document) {
  doc.querySelectorAll<HTMLElement>('.markdown-content').forEach(element => {
    element.innerHTML = markdown(element.textContent || '');
  });
  doc.querySelectorAll<HTMLButtonElement>('[data-print-action]').forEach(button => {
    button.addEventListener('click', () => {
      if (button.dataset.printAction === 'print') doc.defaultView?.print();
      else doc.defaultView?.close();
    });
  });
}
