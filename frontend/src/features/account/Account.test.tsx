import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { AccountLink, AccountProvider } from './AccountContext';
import { ShellDialogs } from '../../layouts/ShellDialogs';

const reply = (data: unknown, status=200) => new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});

function mount(handler?: (path:string,options?:RequestInit)=>Promise<Response>) {
  const fetchMock = vi.fn(handler || (async ()=>reply({ok:false},401)));
  vi.stubGlobal('fetch',fetchMock);
  const changed=vi.fn();
  render(<AccountProvider onSessionChanged={changed}><AccountLink /><ShellDialogs /></AccountProvider>);
  return {fetchMock,changed,user:userEvent.setup()};
}
const input = (id:string) => document.getElementById(id) as HTMLInputElement;
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();localStorage.clear();sessionStorage.clear();});

test('原弹窗完成登录，Cookie 会话不保存返回的 token，关闭时清除密码',async()=>{
  const {user,changed,fetchMock}=mount(async path=>path.endsWith('/login') ? reply({ok:true,account:'alice',token:'do-not-store'}) :reply({ok:false},401));
  await user.click(screen.getByRole('link',{name:'登录/注册'}));
  await user.type(input('auth-username'),'alice');await user.type(input('auth-password'),'password');
  await user.click(screen.getByRole('button',{name:'LOGIN'}));
  await waitFor(()=>expect(changed).toHaveBeenCalledOnce());
  expect(localStorage.getItem('exdiary_token')).toBeNull();
  expect(input('auth-password').value).toBe('');
  expect(fetchMock.mock.calls.find(([url])=>url.endsWith('/login'))?.[1]?.body).toBe(JSON.stringify({account:'alice',password:'password'}));
});

test('注册在原表单切换，校验邮箱并在成功后回到登录',async()=>{
  const {user,changed,fetchMock}=mount(async path=>path.endsWith('/register')?reply({ok:true,notice:'注册成功，请登录'}):reply({ok:false},401));
  await user.click(screen.getByRole('link',{name:'登录/注册'}));await user.click(screen.getByRole('link',{name:'注册'}));
  await user.type(input('auth-username'),'alice');await user.type(input('auth-password'),'password');
  await user.click(screen.getByRole('button',{name:'REGISTER'}));
  expect(await screen.findByText('请填写有效恢复邮箱')).toBeInTheDocument();
  await user.type(input('auth-email'),'alice@example.test');await user.click(screen.getByRole('button',{name:'REGISTER'}));
  await screen.findByRole('button',{name:'LOGIN'});
  expect(changed).not.toHaveBeenCalled();
  expect(fetchMock.mock.calls.filter(([url])=>url.endsWith('/register'))).toHaveLength(1);
});

test('关闭弹窗会取消进行中的请求，迟到响应不能重新登录',async()=>{
  let finish!: (response:Response)=>void;
  const {user,changed}=mount(async path=>path.endsWith('/login')?new Promise(resolve=>{finish=resolve;}):reply({ok:false},401));
  await user.click(screen.getByRole('link',{name:'登录/注册'}));
  await user.type(input('auth-username'),'alice');await user.type(input('auth-password'),'password');
  await user.click(screen.getByRole('button',{name:'LOGIN'}));
  const close=document.getElementById('auth-modal')!.querySelector('button')!;await user.click(close);
  finish(reply({ok:true,account:'alice'}));
  await waitFor(()=>expect(input('auth-password').value).toBe(''));
  expect(changed).not.toHaveBeenCalled();expect(document.getElementById('auth-modal')).toHaveStyle({display:'none'});
});

test('改密不一致不会发请求',async()=>{
  const {user,fetchMock}=mount(async path=>path.endsWith('/me')?reply({ok:true,account:'alice'}):reply({ok:true,notice:'已发送'}));
  await user.click(await screen.findByRole('link',{name:'alice'}));
  await user.click(screen.getByRole('button',{name:'修改密码'}));
  await user.type(input('change-new'),'new-password');await user.type(input('change-confirm'),'different');
  await user.click(screen.getByRole('button',{name:'修改密码'}));
  await screen.findByText('两次新密码不一致');
  expect(fetchMock.mock.calls.some(([url])=>url.endsWith('/change-password'))).toBe(false);
  await user.click(screen.getByRole('button',{name:'关闭修改密码窗口'}));
});

test('退出失败保留当前账号并在原弹窗显示错误',async()=>{
  const {user,changed}=mount(async path=>path.endsWith('/me')?reply({ok:true,account:'alice'}):reply({ok:false,error:'暂时无法退出'},503));
  await user.click(await screen.findByRole('link',{name:'alice'}));
  await user.click(screen.getByRole('button',{name:'退出登录'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法退出');
  expect(screen.getByRole('link',{name:'alice'})).toBeInTheDocument();expect(changed).not.toHaveBeenCalled();
});
