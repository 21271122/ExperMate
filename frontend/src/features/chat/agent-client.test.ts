import { afterEach, expect, test, vi } from 'vitest';
import { createAgentClient } from './agent-client';
import { readJsonEvents } from './events';

function eventResponse(events: unknown[]) {
  return new Response(events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join(''),{headers:{'Content-Type':'text/event-stream'}});
}
afterEach(()=>{vi.unstubAllGlobals();sessionStorage.clear();localStorage.clear();});

test('UTF-8 跨块、心跳与无末尾换行不会丢失事件',async()=>{
  const bytes=new TextEncoder().encode('data: {"event":"text","content":"实验"}\n\n: heartbeat\n\ndata: {"event":"done"}');
  const stream=new ReadableStream({start(controller){for(const value of bytes)controller.enqueue(new Uint8Array([value]));controller.close();}});
  const events=[];for await(const event of readJsonEvents(new Response(stream)))events.push(event);
  expect(events).toEqual([{event:'text',content:'实验'},{event:'done'}]);
});

test('流式前言、工具卡与最终回复只各显示一次',async()=>{
  const done={event:'done',type:'reply',message:'完成',state:{},history_append:[
    {role:'user',content:'记录实验'},{role:'assistant',content:'先读取',tool_calls:[{id:'t1'}]},
    {role:'tool',tool_call_id:'t1',content:JSON.stringify({display:'record_generated',exp_id:'A-1'})},
    {role:'assistant',content:'完成'},
  ]};
  vi.stubGlobal('fetch',vi.fn(async()=>eventResponse([
    {event:'text',content:'先读取'},{event:'tool',name:'read_experiment'},
    {event:'tool_done',tool_call_id:'t1',display_result:{display:'record_generated',exp_id:'A-1'}},
    {event:'text',content:'完成'},done,
  ])));
  const ui={updateStatus:vi.fn(),updateThreadColor:vi.fn(),updateQuickReplies:vi.fn(),saveAgentState:vi.fn()};
  const client=createAgentClient(ui);
  const message=vi.fn(),end=vi.fn(),tool=vi.fn();
  client.init({onMessage:message,onStreamEnd:end,onToolCard:tool});
  await client.sendMessage('记录实验',[]);
  expect(end.mock.calls.map(([text])=>text)).toEqual(['先读取','完成']);
  expect(tool).toHaveBeenCalledOnce();
  expect(message).toHaveBeenCalledOnce();
  expect(message.mock.calls[0][0].role).toBe('user');
  expect(client.isSending()).toBe(false);client.dispose();
});

test('组件释放会取消连接，不向已卸载界面报告取消错误',async()=>{
  let signal:AbortSignal|undefined;
  vi.stubGlobal('fetch',vi.fn(async(_path:string,options:RequestInit)=>{
    signal=options.signal as AbortSignal;
    return new Promise((_resolve,reject)=>signal!.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))));
  }));
  const client=createAgentClient({updateStatus:vi.fn()});const error=vi.fn();
  client.init({onError:error});const running=client.sendMessage('实验',[]);
  client.dispose();await running;
  expect(signal?.aborted).toBe(true);expect(error).not.toHaveBeenCalled();
});
