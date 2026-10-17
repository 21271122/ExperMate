import { services } from '../runtime/services';
import { useLayoutEffect, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { ExperimentList } from '../features/experiments/ExperimentList';
import { ExperimentDetail } from '../features/experiments/ExperimentDetail';
import { Timeline } from '../features/experiments/Timeline';
import { TemplateLibrary } from '../features/experiments/TemplateLibrary';
import { Comparison } from '../features/experiments/Comparison';
import { AnalysisDetail, AnalysisList } from '../features/analysis/AnalysisPages';
import { SettingsPage } from '../features/settings/SettingsPage';
import { LoginPage } from '../features/account/LoginPage';

export const reactPagePaths = ['/experiments', '/favorites', '/timeline', '/templates', '/compare', '/analyze', '/settings', '/login'];
export const canRenderPage = (path: string) => reactPagePaths.includes(path) || /^\/(experiments|analysis)\/[^/]+$/.test(path);

function Page({ path }: { path: string }) {
  if (/^\/experiments\/[^/]+$/.test(path)) return <ExperimentDetail expId={decodeURIComponent(path.slice('/experiments/'.length))} />;
  if (/^\/analysis\/[^/]+$/.test(path)) return <AnalysisDetail id={decodeURIComponent(path.slice('/analysis/'.length))} />;
  if (path === '/timeline') return <Timeline />;
  if (path === '/templates') return <TemplateLibrary />;
  if (path === '/compare') return <Comparison />;
  if (path === '/analyze') return <AnalysisList />;
  if (path === '/settings') return <SettingsPage />;
  if (path === '/login') return <LoginPage />;
  return <ExperimentList path={path} />;
}

export function PageHost() {
  const [page, setPage] = useState<{ path: string; container: Element; key: number } | null>(null);
  useLayoutEffect(() => {
    let key = 0;
    const pages = {
      canRender: canRenderPage,
      show: (path: string, container: Element) => flushSync(() => setPage({ path, container, key: ++key })),
      clear: () => flushSync(() => setPage(null)),
    };
    Object.assign(services, { ExperMatePages: pages });
    return () => { delete services.ExperMatePages; };
  }, []);
  return page && createPortal(<Page key={page.key} path={page.path} />, page.container);
}
