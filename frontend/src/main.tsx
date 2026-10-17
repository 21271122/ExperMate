import './styles/shell.css';
import './styles/de-stijl.css';
import './styles/components.css';
import './styles/motion.css';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';

// /app 保留为兼容入口；正常页面使用原来的根路径，静态构建资源统一由 /app/assets 提供。
document.documentElement.dataset.expermateBase = location.pathname === '/app' || location.pathname.startsWith('/app/') ? '/app' : '';
createRoot(document.getElementById('root')!).render(<App />);
