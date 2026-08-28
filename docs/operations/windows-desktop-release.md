# Windows 桌面版发布方案

> 状态：未来实施方案，尚未打包发布。
>
> 目标：让没有编程基础的用户只需安装并点击“小同门”，不需要安装 Python、Anaconda、Git，也不需要接触命令行、`.venv` 或源码目录。

## 一、发布形态

正式面向普通用户时，发布 **`ExperMate-Setup.exe`** 安装包，而不是要求用户克隆仓库后运行 `run.bat`。

- 安装包名称：`ExperMate-Setup-版本号.exe`；
- 应用显示名称：`ExperMate`；中文名：`小同门`；
- 安装完成后提供桌面与开始菜单快捷方式；
- 双击快捷方式直接打开桌面窗口，不显示命令行窗口；
- Python 运行时、第三方依赖、网页资源和内置音乐资源均随安装包提供；
- `run.bat` 仅保留给从源码运行的开发者，普通用户不使用它。

推荐技术组合：**PyInstaller `--onedir` + Inno Setup**。

`--onedir` 会生成一个应用目录，启动速度和排障都比单文件解压模式稳定；Inno Setup 负责安装、卸载、快捷方式和版本升级。未来若确有便携版需求，可额外提供 ZIP，但不应替代安装包。

## 二、目录与数据边界

程序文件和用户数据必须分开。安装目录可被覆盖、权限通常受限，不能存放用户实验、附件或密钥。

```text
安装目录（安装器管理，升级时可替换）
C:\Program Files\ExperMate\
├─ ExperMate.exe
├─ _internal\                 # Python、依赖、templates、static、内置音频
└─ ...

用户数据目录（应用首次启动自动创建，安装器默认不删除）
%LOCALAPPDATA%\ExperMate\
├─ config.yaml                 # 本机设置与模型配置，可能含 API Key
├─ data\
│  ├─ data.db                  # 已登录账号的数据
│  ├─ offline.db               # 未登录时的本地数据
│  ├─ _e2ee_accounts.db        # 账号安全数据
│  ├─ _e2ee_kms.key            # 本机密钥材料
│  ├─ uploads\                # 旧附件路径兼容文件
│  ├─ _history\
│  └─ _logs\
├─ backups\
└─ logs\
```

其中 `%LOCALAPPDATA%` 通常为 `C:\Users\用户名\AppData\Local`。每个 Windows 用户都有自己的目录；同一台电脑上的不同登录用户不会混用数据。

## 三、首次启动体验

1. 用户双击“小同门”；
2. 程序检查并创建 `%LOCALAPPDATA%\ExperMate\`；
3. 若不存在配置，创建默认 `config.yaml`；
4. 启动本地服务和桌面窗口；
5. 首次进入设置，引导用户填写模型服务商、API Key 与模型名称；
6. 用户之后只需要点击快捷方式。

不在首次启动时下载 Python 或 `pip install` 依赖。安装包必须已经携带运行所需内容；这样离线安装也能启动，失败点更少。

## 四、需要修改的运行时路径逻辑

当前源码版默认将数据保存到项目根目录的 `data/`，并支持用 `EXPERMATE_DATA_DIR` 覆盖。桌面版需要在此基础上区分“应用目录”和“用户数据目录”。

实施时按以下顺序调整：

1. 在 `lib/runtime_paths.py` 增加“桌面版默认用户数据目录”的解析：
   - 优先保留显式环境变量 `EXPERMATE_DATA_DIR`；
   - 打包状态（`sys.frozen` 为真）且未显式覆盖时，使用 `Path(os.environ["LOCALAPPDATA"]) / "ExperMate"`；
   - 源码运行时继续使用项目根目录 `data/`，不改变开发体验。
2. 将配置文件默认路径和数据目录放到同一用户数据根目录：桌面版使用 `%LOCALAPPDATA%\ExperMate\config.yaml`，源码版仍使用项目根目录 `config.yaml`。
3. 保留 `EXDIARY_SETTINGS`、`EXPERMATE_DATA_DIR`、`EXDIARY_DB` 等显式覆盖，用于测试、便携版与服务器部署。
4. 将现有 `prepare_runtime_data()` 的安全迁移逻辑扩展为：仅在目标文件不存在时迁移，不覆盖目标；SQLite 主文件与 `-wal`、`-shm` 必须成组迁移。
5. 启动前创建 `backups/`、`logs/` 等目录，文件系统错误应以用户可读的弹窗说明，而不是只输出终端错误。

`app.py` 当前会先确定 `SETTINGS_PATH`、再加载配置、再确定 `DATA_DIR`。实施第 2 点时应先解析“默认用户数据根目录”，再计算桌面版的配置路径；不能继续把安装目录作为 `config.yaml` 的默认位置。

## 五、打包步骤

建议新增以下发布文件，但不要直接修改业务代码以迁就打包：

```text
packaging\
├─ ExperMate.spec              # PyInstaller 资源、hidden imports、入口设置
├─ installer.iss               # Inno Setup 安装与卸载脚本
└─ build-windows.ps1           # 本地构建、校验、生成安装包
```

构建流程：

1. 在干净的 Windows 构建环境创建 Python 3.12 虚拟环境；
2. 安装 `requirements.txt`、PyInstaller 和 Inno Setup；
3. 用 PyInstaller 打包 `app.py` 的桌面入口，收集 `templates/`、`static/`、内置音频及动态导入依赖；
4. 在未安装 Python 的干净 Windows 虚拟机运行生成的目录，验证桌面窗口、网页模式、附件、登录、设置与音乐；
5. 使用 Inno Setup 生成 `ExperMate-Setup-版本号.exe`；
6. 用安装包在另一台干净虚拟机完成安装、升级、卸载和数据保留验证；
7. 将安装包及校验值上传到 GitHub Releases，不把用户数据库、附件或 `.env` 放入发布包。

PyInstaller 资源路径必须兼容冻结模式。当前 `app.py` 已识别 `sys.frozen` 并区分可执行文件目录；实施时仍须实际验证模板、静态资源、音频以及 `pywebview` 在 `_internal` 下的定位。

## 六、安装、升级与卸载规则

### 安装

- 默认安装到 `C:\Program Files\ExperMate`；若普通用户没有管理员权限，可改为 `%LOCALAPPDATA%\Programs\ExperMate`；
- 创建“ExperMate｜小同门”桌面和开始菜单快捷方式；
- 可选安装“开机启动”不应默认勾选；
- 安装器不能写入或预置真实 API Key、账号数据、数据库或用户附件。

### 升级

- 新版本只更新安装目录；
- 永远不覆盖 `%LOCALAPPDATA%\ExperMate\` 内的 `config.yaml`、数据库、密钥、附件和备份；
- 启动时执行版本化数据迁移，先创建可恢复备份，再修改数据库结构；
- 升级失败时应保留旧数据，并给出恢复路径。

### 卸载

- 默认只移除应用和快捷方式，**保留用户数据目录**；
- 卸载器可提供额外复选框“同时删除本机所有数据”，默认不选；
- 只有用户明确勾选时，才删除 `%LOCALAPPDATA%\ExperMate\`；删除前再次显示其包含实验、聊天记录、附件与密钥。

## 七、备份、恢复与迁移

用户数据根目录是完整备份的单位。推荐在设置页提供两个明显入口：

- **创建备份**：提示先关闭其他 ExperMate 窗口，打包 `data/`、`config.yaml` 与必要密钥材料；
- **打开数据文件夹**：打开 `%LOCALAPPDATA%\ExperMate\`，便于用户手动备份或交给技术支持。

恢复前必须先退出应用并备份当前用户数据目录。数据库运行时可能有 WAL/SHM 文件；不能只复制 `data.db` 而忽略相关文件。具体原则沿用[数据、备份与恢复](data-and-backup.md)。

从源码版迁移到安装版时，首次启动可检测旧项目目录的 `data/`，让用户选择“导入副本”或“暂不导入”。不能静默移动或覆盖数据；用户可能仍在使用源码版。

## 八、发布验收清单

- [ ] 干净 Windows 10/11、未安装 Python/Anaconda/Git 的环境可安装并启动；
- [ ] 首次启动创建用户数据目录，不在安装目录写入数据库或配置；
- [ ] 配置 API Key 后能正常聊天、记录实验、上传和读取附件；
- [ ] 升级安装后历史实验、聊天、附件、音乐和设置仍在；
- [ ] 卸载默认保留数据；勾选删除数据后才清理；
- [ ] 不同 Windows 用户的数据彼此隔离；
- [ ] 桌面窗口与网页模式可同时使用；
- [ ] 从旧源码版导入数据时不覆盖已有安装版数据；
- [ ] GitHub Release 不包含数据库、密钥、用户附件、`.env` 或 `config.yaml`；
- [ ] 安装器与应用程序标注版本号、构建日期和校验值。

## 九、暂不采用的方案

- **要求用户安装 Anaconda 或 Python，再运行 `run.bat`**：适合开发者，不适合目标用户；
- **首次运行自动下载 Python 和依赖**：网络、权限、镜像和安全软件会造成大量不可控失败；
- **把数据写进安装目录**：升级、卸载和权限问题会威胁用户数据；
- **只提供 GitHub 源码仓库**：依赖 Git、命令行与环境配置，不能作为普通用户入口。
