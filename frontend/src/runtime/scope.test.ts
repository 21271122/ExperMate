import { expect, test, vi } from 'vitest';
import { createScope } from './scope';

test('外壳卸载清理事件、计时器、动画帧和在途请求', async()=>{
  vi.useFakeTimers();const handler=vi.fn(),timer=vi.fn(),scope=createScope();
  let signal:AbortSignal|undefined;vi.stubGlobal('fetch',vi.fn((_url:string,options:RequestInit)=>{signal=options.signal as AbortSignal;return Promise.resolve(new Response('{}'));}));
  try{
    scope.listen(document,'click',handler);scope.timeout(timer,100);scope.frame(timer);await scope.fetch('/api/test');
    document.dispatchEvent(new Event('click'));expect(handler).toHaveBeenCalledOnce();scope.dispose();document.dispatchEvent(new Event('click'));vi.runAllTimers();
    expect(handler).toHaveBeenCalledOnce();expect(timer).not.toHaveBeenCalled();expect(signal?.aborted).toBe(true);
  }finally{vi.useRealTimers();vi.unstubAllGlobals();}
});
