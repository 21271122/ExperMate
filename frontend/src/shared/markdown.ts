import { marked } from 'marked';

export function markdown(text: string) {
  return marked.parse(text, { async: false });
}
