# React 前端（保留原样式）

默认 `/` 及原页面深链接由 React 渲染，`/app/` 为兼容别名。迁移完整保留原双栏、HTML 层级、class、字体、配色、尺寸、Canvas、移动端规则和动效，不包含界面改版。

## 已迁移范围

- 外壳、账号弹窗与原登录页：登录/注册、找回/重置、改密、改邮箱，使用 HttpOnly Cookie。
- 聊天：消息、流式回答、工具卡片、附件输入、快捷回复、历史搜索、取消及断线恢复。
- 实验列表与分类：搜索、状态/归档/标签/日期筛选、行/卡片、日期组、置顶、分类维护与最多四条对比，手机菜单与浮层由 React Portal 管理。
- 实验详情：完整字段、富文本/表格编辑、草稿、保存/取消、版本冲突、归档/恢复、附件和实验子对话。
- 分析列表/详情：删除、引用实验、证据快照过期提示、Markdown、打印和独立分析子对话。
- 时间线、模板库、实验对比、管理员模型设置、主题及声音偏好。
- 打印预览、图片/PDF/文本/CSV/Excel 附件预览；Excel 工作表、分页、样式、合并单元格、缩放及表格选择复制。附件直接由浏览器下载，不依赖桌面桥接。

原样式源码统一在 `src/styles/`：公共 CSS 由 `main.tsx` 按原顺序导入，页面 CSS 随对应 React 页面渲染，不再请求旧的静态 CSS 地址。Markdown 使用 npm 锁定的 Marked 15.0.12，共用 `src/shared/markdown.ts`；未使用的 Quill 加载及文件已删除。打印文档的模板、CSS 和脚本集中在 `src/features/print/`：服务端仅负责鉴权、读取账号数据和填充模板；脚本与主应用共用 npm 中的 Marked。两个打印入口由 Vite 同时构建，服务端通过 `dist/.vite/manifest.json` 引用带哈希的 CSS/JS。

公共 JSON 请求位于 `src/shared/api.ts`。流式聊天、账号会话校验和文件下载保留各自的协议处理，不强行通过同一个 JSON 解析器。跨模块调用通过 `src/runtime/services.ts` 的显式接口；服务注册与清理跟随 React 生命周期，不再挂到 `window`，也不再解析字符串函数名。

`runtime/panel.js` 仅管理导航与页面状态，原生 Canvas 算法位于独立的 `runtime/canvas-engine.js`，不导入应用服务或请求接口。`layouts/CanvasSurface.tsx` 管理绘图节点、初始化和卸载；统计请求单独位于 `runtime/canvas-data.js`。分栏拖动、尺寸保存和横竖屏切换位于 `runtime/split-layout.js`。主题、声音不直接写设置页控件，设置页由 React 控制。

工具卡片由 `features/chat/ToolCard.tsx` 按类型渲染，`SelectorCard.tsx` 用 React 状态管理勾选、全选、搜索、确认、取消和更多记录弹窗。原 HTML 字符串生成器已删除；仅 Markdown 正文通过统一解析器生成 HTML，普通字段由 React 按文本渲染。卡片保留原有 class、文案和布局。

旧 Shell、片段路由、15 个旧页面/基础模板和重复脚本已删除，`/ai-shell/` 重定向到 React 首页。测试目录只保留无脚本的原外壳 DOM/CSS 基准。生产模板仅保留前端打印模块内的实验打印和报告打印，旧 E2EE 演示页面已删除；内置图片、音频源码在 `public/img/`、`public/audio/`，构建时复制到 dist，通过 `/app/img/`、`/app/audio/` 提供，旧地址重定向兼容。无调用方的 HTMX 及重复静态 Marked 已删除。回退发布需要一起恢复前端、API 和代码版本。

旧表单接口不再渲染已删除的页面：`POST /settings` 返回与新设置接口一致的 JSON；`POST /api/parse` 返回解析结果 JSON，持久化仍使用 `/api/parse/confirm`。旧片段和已删除脚本返回 404。

## 开发与部署

需要 Node.js 22.12+ 和现有 Python 依赖。首次构建：

```powershell
cd frontend
npm ci
npm run build
cd ..
python app.py --headless
```

访问 `http://127.0.0.1:5000/`。缺少 `frontend/dist/index.html` 时返回 503 及构建提示，避免静默使用旧页面。

开发时先启动后端，再在 `frontend/` 运行 `npm run dev`，访问 `http://127.0.0.1:5173/app/`。Vite 直接提供 public 内的资源，将 API 和服务端打印输出代理到 `http://127.0.0.1:5000`；改变后端端口须同步修改 `vite.config.ts`。

前端部署文件为完整的 `frontend/dist/`（包括 `.vite/manifest.json`、图片、音频、构建资源）、`frontend/src/features/print/templates/` 和 `frontend/licenses/`，随 Python 服务端源码一起发布。不再依赖根目录的 `static/`、`ai-shell/`、`templates/`。打印模板保留 Jinja 数据填充，未改为 React 页面；模板、样式和行为均在同一前端功能目录内维护。Node 只用于构建，生产页面由 Flask 提供；无需另起 Node 服务。JS/CSS 构建资源统一为 `/app/assets/`，根路径与 `/app/` 共用。dist 与 node_modules 不提交到 Git，发布流程必须显式构建和复制 dist；现有打包流程也需包含该目录。

## 数据和会话兼容

React 页面复用原实验、分类、分析、附件与 Agent 服务。新增 `/api/v1/` 提供页面 JSON；完整记录保存携带初始 revision，409 保留草稿，不能自动覆盖新版本。附件操作后先刷新完整记录，失败时锁住编辑，避免旧快照覆盖附件引用。

业务请求必须登录，使用服务端账号作用域。无凭据或失效凭据均返回 401，不回退离线库。主/子会话仅由服务端恢复，不再写浏览器 state 缓存。设置接口只返回字段白名单和掩码，不返回 API 密钥，留空表示保留原密钥。

服务端运行位置与依赖迁移也已实施，包括管理员配置、统一认证、显式旧库导入、集中仓储与附件，以及移除桌面/离线运行依赖。详情见 [服务端迁移说明](../docs/server-runtime-migration.md)。持久任务队列与跨进程事件恢复仍属于后续工作。

## 验证

界面约束集中在 `src/styles/de-stijl.css`，记录页和聊天工具卡共用这些变量：间距使用 `--space-1/2/3/4/6`（4/8/12/16/24px）；外框使用 `--border`（4px），输入框使用 `--border-control`（2px），内部细分隔使用 `--border-fine`（1px）。`--border` 是宽度，不能用作边框颜色。颜色引用现有黑白、蓝黄强调色和语义表面变量，不在业务组件另建独立色板。字号按 caption/body/section/title 四个角色引用 `--type-*`；字体引用 `--font-ui/reading/code`。尺寸与流程图几何可按内容计算，常规内外边距不再逐处取任意值。

```powershell
cd frontend
npm test
npm run build
cd ..
python -m pytest tests/test_react_frontend.py
```

前端测试覆盖原 DOM/样式与资源顺序、分栏拖动与模式切换、工具卡片导航和选择器、账号、流式去重、列表筛选/分类/置顶/对比、详情编辑/409、附件失败、子对话、设置、报告、预览及外壳导航/卸载。后端使用内存 SQLite 验证 Cookie、账号隔离、未登录拒绝访问、分页、设置脱敏、证据快照、附件与版本契约、默认入口和深链接。

框架迁移的隔离验收不读写真实实验库；本地部署另已使用生成的测试记录验证真实模型，见 `docs/operations/local-deployment-acceptance-2026-10-17.md`。桌面/手机关键节点与原版进行位置、尺寸、字体和边框对照；另验证编辑保存、搜索/对比、报告/打印及 CSV 预览。原生系统保存/打印对话框未作端到端验收。

## 静态资源与打印目录

```text
frontend/
  public/img/                       图标、图片
  public/audio/                     内置音乐、音效及来源声明
  licenses/marked/LICENSE.md         Marked 许可证
  src/features/print/
    templates/print.html            实验打印模板
    templates/print_analysis.html   报告打印模板
    experiment.ts / experiment.css 实验打印入口与原版样式
    analysis.ts / analysis.css     报告打印入口与原版样式
    document.ts                   共用 Markdown 与打印按钮行为
```

用户附件和自定义音乐仍归服务端数据目录及账号附件接口管理，不进入 public 或源码仓库。内置资源移动前后逐文件校验 SHA-256，一并保留音频署名。

记录正文保留板块外框、黑色标题带、蓝色强调线和黄色编号；子字段不画闭合边框，使用连续浅底、对齐和细分隔组织内容。边框变量规定需要边框时的规格，不要求每个容器都画框。流程图物质节点的矩形属于内容语义，保留。
