import { useEffect } from 'react';
import { ChatProvider } from '../features/chat/ChatContext';
import { AccountProvider } from '../features/account/AccountContext';
import { ShellFrame } from '../layouts/ShellFrame';
import { ShellDialogs } from '../layouts/ShellDialogs';
import { startShell } from '../runtime/start';
import { PageHost } from './PageHost';
import { PreviewHost } from '../features/preview/PreviewHost';
import { services } from '../runtime/services';

export function App() {
  useEffect(() => {
    try { return startShell(); }
    catch (error) { services.ChatUI?.updateStatus((error as Error).message); }
  }, []);

  return <AccountProvider><ChatProvider><ShellFrame /><ShellDialogs /><PageHost /><PreviewHost /></ChatProvider></AccountProvider>;
}
