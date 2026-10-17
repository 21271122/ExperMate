export type SelectorItem = { id: string; title?: string; date?: string; experimenter?: string };
export type ToolResult = {
  display?: string; title?: string; summary?: string; message?: string;
  changes?: { exp_id?: string; field?: string; old?: string; new?: string }[];
  question?: string; answer?: string; source?: string; exp_ids?: string[];
  markdown?: string; anal_id?: string; topic?: string; exp_id?: string;
  action?: string; track?: { title?: string }; current?: { enabled?: boolean }; tracks?: unknown[];
  count?: number; experiments?: SelectorItem[]; items?: SelectorItem[]; preselected?: string[];
  status?: string; selected_ids?: string[]; _tcId?: string;
};

export type ToolActions = {
  setSending: (busy: boolean) => void;
  showToast: (message: string) => void;
  appendSystemMsg: (message: string) => unknown;
  send: (message: string) => void;
  client: () => { resolveSelector: (id: string, selected: string[], status: string) => Promise<unknown> };
};
