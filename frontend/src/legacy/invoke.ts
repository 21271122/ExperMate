// 只桥接原有控件的已知处理函数，不执行来自页面或模型的代码字符串。
export function invoke(name: string, ...args: unknown[]) {
  const parts = name.split('.');
  let owner = window as unknown as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) owner = owner?.[part] as Record<string, unknown>;
  const handler = owner?.[parts[parts.length - 1]];
  // 资源尚在加载时控件已可见，不能因提前点击而抛出运行错误。
  if (typeof handler === 'function') return handler.apply(owner, args);
}
