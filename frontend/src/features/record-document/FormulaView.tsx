import { useLayoutEffect, useRef, useState } from 'react';

export function FormulaView({ html }: { html: string }) {
  const frame = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ scale: 1, height: 0 });
  useLayoutEffect(() => {
    const measure = () => {
      const width = frame.current!.clientWidth, child = content.current!;
      if (!width || !child.offsetWidth) return;
      const scale = Math.min(1, width / child.offsetWidth), height = child.offsetHeight * scale;
      setSize(old => old.scale === scale && old.height === height ? old : { scale, height });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(frame.current!); observer.observe(content.current!);
    return () => observer.disconnect();
  }, [html]);
  return <div className="record-formula" ref={frame} style={size.height ? { height: size.height } : undefined}>
    <div className="record-formula-content" ref={content} style={{ transform: `scale(${size.scale})` }} dangerouslySetInnerHTML={{ __html: html }} />
  </div>;
}
