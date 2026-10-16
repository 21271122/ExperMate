export type TableRow = Record<string, string>;
export type Attachment = { sha256: string; url: string; name?: string; title?: string; caption?: string; mime?: string; size?: number; description?: string; sync_state?: string };
export type ExperimentDetailData = {
  id: string; revision?: number; title?: string; date?: string; end_date?: string; experimenter?: string; status?: string; archived?: boolean;
  tags?: string[]; original_notes?: string; purpose?: string; conclusion?: string; sop?: string[]; next_steps?: string[];
  materials?: TableRow[]; equipment?: TableRow[]; experimental_plan?: TableRow[]; process_parameters?: TableRow[]; characterization?: TableRow[];
  observations?: { no_anomalies?: boolean; items?: string[] } | string;
  results?: { qualitative?: string; key_data?: TableRow[]; figures?: unknown[]; [key: string]: unknown } | string;
  references?: string[]; referenced_by?: string[]; analyzed_in?: string[]; attachments?: Attachment[];
  [key: string]: unknown;
};
export const tableFields = {
  materials: { label: '2. 材料与试剂', keys: ['name', 'purity', 'vendor', 'amount', 'notes'], headers: ['名称', '纯度', '供应商', '用量', '备注'] },
  equipment: { label: '3. 仪器设备', keys: ['device', 'model', 'location'], headers: ['设备', '型号', '位置'] },
  experimental_plan: { label: '4. 实验方案', keys: ['group', 'condition', 'expected'], headers: ['组别', '条件', '预期结果'] },
  process_parameters: { label: '6. 工艺参数', keys: ['step', 'parameter', 'setpoint', 'actual', 'deviation'], headers: ['步骤', '参数', '设定值', '实际值', '偏差'] },
  characterization: { label: '8. 表征与测试', keys: ['method', 'sample_id', 'preparation', 'submission_date', 'data_path'], headers: ['方法', '样品编号', '制样方式', '日期', '数据路径'] },
};
export const resultTable = { keys: ['metric', 'value', 'comparison', 'change'], headers: ['指标', '数值', '对比对象', '变化'] };
export const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function markdown(value: string) {
  const marked = (window as unknown as { marked?: { parse: (text: string) => string } }).marked;
  return marked ? marked.parse(value) : escapeHtml(value);
}
// 用可编辑字段比较脏状态；保存时提交带原版本号的完整快照，保留附件及扩展字段。
export function editableData(exp: ExperimentDetailData) {
  const keys = ['title', 'date', 'end_date', 'experimenter', 'status', 'tags', 'original_notes', 'purpose', 'conclusion',
    'sop', 'next_steps', ...Object.keys(tableFields), 'observations', 'results'];
  return Object.fromEntries(keys.filter(key => key in exp).map(key => [key, exp[key]]));
}
