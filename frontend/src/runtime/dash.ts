// 原编辑器的 SVG 虚线装饰；字段内容与事件由 React 管理。
export function drawDash(element: HTMLElement) {
  const { width, height } = element.getBoundingClientRect(); if (width < 4 || height < 4) return;
  element.querySelector('.dash-svg')?.remove();
  const namespace = 'http://www.w3.org/2000/svg', svg = document.createElementNS(namespace, 'svg'), rect = document.createElementNS(namespace, 'rect');
  svg.setAttribute('class', 'dash-svg'); svg.setAttribute('width', String(width)); svg.setAttribute('height', String(height));
  for (const [name, value] of Object.entries({ x: 1, y: 1, width: width - 2, height: height - 2, fill: 'none', 'stroke-width': 2, 'stroke-dasharray': '8 6' })) rect.setAttribute(name, String(value));
  rect.style.stroke = 'var(--black)'; svg.appendChild(rect); element.appendChild(svg);
}
