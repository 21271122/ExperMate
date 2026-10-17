import type { createPanelManager } from './panel';
import type { createCanvasEngine } from './canvas-engine';
import type { initializeMotion } from './motion';
import type { initializeTheme } from './theme';
import type { initializeSound } from './sound';
import type { Connection } from '../features/chat/ChatContext';
import type { Attachment } from '../features/experiments/detail-model';
import type { downloadAttachment } from '../features/preview/AttachmentPreview';

// React owns each service's lifetime. Modules import this contract rather than
// publishing properties on window or resolving method names from strings.
interface Services {
  Canvas: ReturnType<typeof createCanvasEngine>;
  PanelManager: ReturnType<typeof createPanelManager>;
  ExMotion: ReturnType<typeof initializeMotion>;
  ExdiaryTheme: ReturnType<typeof initializeTheme>;
  ExdiarySound: ReturnType<typeof initializeSound>;
  AgentClient: Connection['client'];
  ChatUI: Connection['ui'];
  ExperMateAccount: { verifySession: () => Promise<{ valid: boolean } | void>; clearLogin: () => void };
  ExperMatePages: { canRender: (path: string) => boolean; show: (path: string, container: Element) => void; clear: () => void };
  ExperMateList: { openPanelPopup: (name: string) => void; openSearchPopup: () => void; getViewState: () => object };
  AttachmentViewer: { open: (item: Attachment) => void; download: typeof downloadAttachment };
  showAuthModal: () => void;
  showAccountModal: () => void;
  showSupportModal: () => void;
  closeSupportModal: () => void;
  openExperimentPrint: (id: string) => void;
  openAnalysisPrint: (id: string) => void;
  closePagePreviews: () => void;
  startColorDivider: () => void;
  stopColorDivider: () => void;
  enterCompareMode: () => void;
  _isEditing: boolean;
}

export const services: Partial<Services> = {};
