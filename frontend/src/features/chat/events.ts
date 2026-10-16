// 服务端协议为每个 data 行一个 JSON；保留分块 UTF-8 和末尾无换行的事件。
export async function* readJsonEvents(response: Response): AsyncGenerator<Record<string, any>> {
  if (!response.body) throw new Error('服务端未返回消息流');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  function parse(line: string) {
    if (!line.startsWith('data:')) return null;
    try { return JSON.parse(line.slice(5).trim()); } catch { return null; }
  }
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) { const event = parse(line); if (event) yield event; }
      if (chunk.done) { const event = parse(buffer); if (event) yield event; break; }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
