import { useEffect, useRef, useState, type FormEvent } from 'react';
import { usePageData } from '../../app/usePageData';
import { requestJson } from '../../shared/api';
import { services } from '../../runtime/services';
import { SettingsForm, type ControlProps } from './SettingsForm';

type SettingsData = { can_configure: boolean; values: Record<string, string | number | boolean>; providers: { id: string; label: string; base_url: string }[]; masked_agent_key: string; masked_analyze_key: string };
function initialValues(data: SettingsData) {
  const config = data.values;
  return Object.fromEntries(Object.entries({ ...config, LLM_AGENT_PROVIDER: config.LLM_AGENT_PROVIDER || 'deepseek', LLM_AGENT_API_KEY: '', LLM_ANALYZE_API_KEY: '',
    LLM_AGENT_MODEL: config.LLM_AGENT_MODEL || config.DEEPSEEK_MODEL || '', LLM_ANALYZE_MODEL: config.LLM_ANALYZE_MODEL || config.DEEPSEEK_ANALYZE_MODEL || '',
    LLM_REASONING_EFFORT: config.LLM_REASONING_EFFORT || 'max', CONTEXT_COMPRESSION_TRIGGER_TOKENS: config.CONTEXT_COMPRESSION_TRIGGER_TOKENS || 300000,
    CONTEXT_COMPRESSION_CHUNK_TOKENS: config.CONTEXT_COMPRESSION_CHUNK_TOKENS || 260000, ANALYSIS_TIMEOUT_MINUTES: Math.floor(Number(config.ANALYSIS_TIMEOUT_SECONDS || 480) / 60),
  }).map(([key, value]) => [key, String(value)]));
}
export function SettingsPage() {
  const { data, error, signal } = usePageData<SettingsData>('/api/v1/settings', '/settings');
  const [values, setValues] = useState<Record<string, string>>({}), [pending, setPending] = useState(false), [message, setMessage] = useState(''), [failed, setFailed] = useState(false);
  const [masked, setMasked] = useState({ agent: '', analyze: '' });
  const [theme, setTheme] = useState(() => localStorage.getItem('exdiary_theme') || 'system');
  const [sound, setSound] = useState<Record<string, string | number | boolean>>(() => services.ExdiarySound?.getSettings() || { sfx: true, sfxVolume: 65, bgm: false, bgmVolume: 12, bgmTrack: '' });
  const [tracks, setTracks] = useState<{ id: string; title: string }[]>(() => services.ExdiarySound?.getTracks() || []);
  const [placeholders, setPlaceholders] = useState({ agent: '由 Provider 自动使用官方地址', analyze: '留空继承 Agent Base URL' });
  const saving = useRef(false);
  useEffect(() => {
    if (data) { setValues(initialValues(data)); setMasked({ agent: data.masked_agent_key, analyze: data.masked_analyze_key }); services.AgentClient?.setAnalysisTimeoutSeconds(Number(data.values.ANALYSIS_TIMEOUT_SECONDS || 480)); }
  }, [data]);
  useEffect(() => {
    const changed = () => { setSound(services.ExdiarySound?.getSettings() || {}); setTracks(services.ExdiarySound?.getTracks() || []); };
    window.addEventListener('exdiary-sound-change', changed);
    return () => window.removeEventListener('exdiary-sound-change', changed);
  }, []);
  function field(name: string): ControlProps {
    return { value: values[name] || '', disabled: pending || !data?.can_configure,
      onChange: event => {
        const value = event.target.value;
        setValues(old => ({ ...old, [name]: value }));
        if (name.endsWith('_PROVIDER')) {
          const kind = name === 'LLM_AGENT_PROVIDER' ? 'agent' : 'analyze';
          setPlaceholders(old => ({ ...old, [kind]: data?.providers.find(provider => provider.id === value)?.base_url || (value ? '由 Provider 自动使用官方地址' : '留空继承 Agent Base URL') }));
        }
      } };
  }
  function soundField(name: string): ControlProps {
    return { ...(name === 'sfx' || name === 'bgm' ? { checked: !!sound[name] } : { value: String(sound[name] ?? '') }), onChange: event => {
      const value = name === 'sfx' || name === 'bgm' ? (event.target as HTMLInputElement).checked : name.endsWith('Volume') ? Number(event.target.value) : event.target.value;
      setSound(old => ({ ...old, [name]: value })); services.ExdiarySound?.update({ [name]: value });
    } };
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving.current || !data?.can_configure) return;
    saving.current = true; setPending(true); setMessage('');
    const body = new FormData(event.currentTarget);
    try {
      const result = await requestJson('/api/v1/settings', { method: 'POST', body, signal });
      if (!signal.aborted) { setValues(initialValues(result.data)); setMasked({ agent: result.data.masked_agent_key, analyze: result.data.masked_analyze_key }); setFailed(false); setMessage(result.message); services.AgentClient?.setAnalysisTimeoutSeconds(Number(result.data.values.ANALYSIS_TIMEOUT_SECONDS || 480)); }
    } catch (reason) { if (!signal.aborted) { setFailed(true); setMessage((reason as Error).message); } }
    finally { saving.current = false; if (!signal.aborted) setPending(false); }
  }
  if (!data || !Object.keys(values).length) return <div className="flash" role={error ? 'alert' : 'status'}>{error || '加载中…'}</div>;
  return <SettingsForm canConfigure={data.can_configure} field={field} soundField={soundField} theme={theme} setTheme={value => { setTheme(value); services.ExdiaryTheme?.setPref(value); }} tracks={tracks} agentPlaceholder={placeholders.agent} analyzePlaceholder={placeholders.analyze}
    pending={pending} submit={submit} providers={data.providers} maskedAgent={masked.agent} maskedAnalyze={masked.analyze} message={message} failed={failed} />;
}
