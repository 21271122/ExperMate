import { services } from '../../runtime/services';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { ChatProvider } from './ChatContext';
import { ChatPanel } from './ChatPanel';
import { AccountProvider } from '../account/AccountContext';
import { createAgentClient } from './agent-client';

const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status});
const wire=(event:unknown)=>new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
type Bridge = {AgentClient: ReturnType<typeof createAgentClient>;ChatUI:Record<string,any>};
const bridge=()=>services as unknown as Bridge;

async function mount(stream:()=>Response) {
  const fetchMock=vi.fn(async(path:string)=>{
    if(path==='/api/e2ee/me')return json({ok:false},401);
    if(path==='/api/agent/events')return new Response(new ReadableStream({start(){}}));
    if(path==='/api/agent/start')return json({ok:true,state:{},history:[],history_start:0,history_total:0});
    if(path==='/api/agent/message/stream')return stream();
    if(path.startsWith('/api/agent/history/search'))return json({ok:true,matches:[{role:'user',snippet:'实验记录',session_id:'s1',sequence:1,created_at:'2026-10-15T00:00:00Z'}]});
    if(path.startsWith('/api/agent/history/context'))return json({ok:true,messages:[{role:'user',content:'原始实验记录',sequence:1,created_at:'2026-10-15T00:00:00Z'}]});
    return json({ok:false},404);
  });
  vi.stubGlobal('fetch',fetchMock);
  render(<AccountProvider onSessionChanged={()=>{}}><ChatProvider><ChatPanel /></ChatProvider></AccountProvider>);
  const ui=bridge().ChatUI;
  await act(async()=>{
    ui.init();bridge().AgentClient.init({...ui,onStateChange:()=>{}});
    await bridge().AgentClient.start();
  });
  return {fetchMock,user:userEvent.setup()};
}
afterEach(()=>{vi.unstubAllGlobals();localStorage.clear();sessionStorage.clear();});

test('真实 React 输入、流式回复和工具卡只生成一次，用户 HTML 是文本',async()=>{
  const {user}=await mount(()=>new Response(new ReadableStream({start(controller){
    for(const event of [
      {event:'text',content:'已记录'},
      {event:'tool_done',tool_call_id:'t1',display_result:{display:'record_generated',exp_id:'EXP-1',title:'薄膜实验'}},
      {event:'done',type:'reply',message:'已记录',state:{},history_append:[{role:'user',content:'<img onerror=alert(1)>'},
        {role:'assistant',content:'已记录'},{role:'tool',tool_call_id:'t1',content:JSON.stringify({display:'record_generated',exp_id:'EXP-1',title:'薄膜实验'})}]},
    ])controller.enqueue(wire(event));controller.close();
  }})));
  await user.type(screen.getByPlaceholderText('输入消息…'),'<img onerror=alert(1)>');
  await user.click(screen.getByRole('button',{name:'发送'}));
  await screen.findByText('已记录');await screen.findByText('薄膜实验',{exact:false});
  expect(document.querySelectorAll('.msg-row.user')).toHaveLength(1);
  expect(document.querySelectorAll('.msg-row.agent')).toHaveLength(1);
  expect(document.querySelectorAll('.tool-card.record')).toHaveLength(1);
  expect(document.querySelector('.msg-row.user img')).toBeNull();
});

test('生成期间保留新草稿，完成后不自动发送',async()=>{
  let controller!:ReadableStreamDefaultController<Uint8Array>;
  const {user,fetchMock}=await mount(()=>new Response(new ReadableStream({start(value){controller=value;controller.enqueue(wire({event:'text',content:'正在整理'}));}})));
  const composer=screen.getByPlaceholderText('输入消息…');
  await user.type(composer,'第一条');await user.click(screen.getByRole('button',{name:'发送'}));
  await screen.findByText('正在整理');await user.type(composer,'待确认的第二条');
  expect(screen.getByRole('button',{name:'发送'})).toBeDisabled();
  await act(async()=>{controller.enqueue(wire({event:'done',type:'reply',message:'正在整理',state:{}}));controller.close();});
  await waitFor(()=>expect(screen.getByRole('button',{name:'发送'})).toBeEnabled());
  expect(composer).toHaveValue('待确认的第二条');
  expect(fetchMock.mock.calls.filter(([path])=>path==='/api/agent/message/stream')).toHaveLength(1);
});

test('聊天历史搜索和附近对话由 React 渲染原样弹窗',async()=>{
  const {user}=await mount(()=>json({}));
  await user.click(screen.getByRole('button',{name:'查找聊天记录'}));
  await user.type(screen.getByPlaceholderText('输入关键词，查找当前和已压缩的对话'),'实验');
  await user.click(screen.getByRole('button',{name:'查找'}));
  await user.click(await screen.findByRole('button',{name:/实验记录/}));
  await screen.findByText('原始实验记录');
  expect(document.querySelector('.history-context-message.current')).toBeInTheDocument();
});
