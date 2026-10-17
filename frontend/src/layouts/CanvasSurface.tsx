import { useLayoutEffect, useRef } from 'react';
import { createCanvasEngine } from '../runtime/canvas-engine';
import { loadCanvasStats } from '../runtime/canvas-data';
import { createScope } from '../runtime/scope';
import { services } from '../runtime/services';

export function CanvasSurface() {
  const canvas = useRef<HTMLCanvasElement>(null), container = useRef<HTMLDivElement>(null);
  const note = useRef<HTMLDivElement>(null), hover = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const scope = createScope();
    const engine = createCanvasEngine(scope, {
      canvas: canvas.current, container: container.current, note: note.current, hover: hover.current,
      onNavigate: (path: string, origin: Event) => services.PanelManager?.navigate(path, origin),
      getMode: () => services.AgentClient?.getMode() || 'free',
    });
    services.Canvas = engine;
    engine.start();
    loadCanvasStats(scope, engine.updateStats);
    return () => { scope.dispose(); if (services.Canvas === engine) delete services.Canvas; };
  }, []);
  return (
            <div ref={container} id={"canvas-container"}>
              <canvas ref={canvas} id={"de-stijl-canvas"} />
              <div ref={note} id={"agent-tip"}>
                <div className={"nb-head"}>
                  <span>
                    {"小同门实验笔记"}
                  </span>
                  <span className={"nb-date"} id={"nb-date"} />
                </div>
                <div id={"nb-body"} />
              </div>
              <div ref={hover} id={"hover-tip"} />
            </div>
  );
}
