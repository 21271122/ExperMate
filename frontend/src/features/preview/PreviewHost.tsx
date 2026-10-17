import { services } from '../../runtime/services';
import { useLayoutEffect, useState } from 'react';
import { AttachmentPreview, downloadAttachment } from './AttachmentPreview';
import { PrintPreview, type PrintRequest } from './PrintPreview';
import type { Attachment } from '../experiments/detail-model';

export function PreviewHost() {
  const [attachment, setAttachment] = useState<Attachment | null>(null), [print, setPrint] = useState<PrintRequest | null>(null);
  useLayoutEffect(() => {
    Object.assign(services, { AttachmentViewer: { open: setAttachment, download: downloadAttachment },
      openExperimentPrint: (id: string) => setPrint({ path: '/experiments/' + encodeURIComponent(id) + '/print', label: '实验' }),
      openAnalysisPrint: (id: string) => setPrint({ path: '/experiments/analysis/' + encodeURIComponent(id) + '/print', label: '分析报告' }),
      closePagePreviews: () => { setAttachment(null); setPrint(null); } });
    return () => { for (const key of ['AttachmentViewer', 'openExperimentPrint', 'openAnalysisPrint', 'closePagePreviews']) Reflect.deleteProperty(services, key); };
  }, []);
  return <>{attachment && <AttachmentPreview key={attachment.sha256} item={attachment} close={() => setAttachment(null)} />}{print && <PrintPreview request={print} close={() => setPrint(null)} />}</>;
}
