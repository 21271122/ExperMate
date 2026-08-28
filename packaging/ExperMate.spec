# -*- mode: python ; coding: utf-8 -*-
"""ExperMate 桌面版 PyInstaller 配置（onedir 便携模式）。

产物：dist/ExperMate/（ExperMate.exe + _internal\）
运行数据（config.yaml、data\）由程序在 exe 同目录首次启动时自动创建，
不打包进 _internal，保证“应用文件夹 = 数据文件夹”的便携语义，
与源码运行时的数据布局（项目根/data）保持一致。

资源收集策略（核对过运行时路径逻辑）：
- templates/、static/、ai-shell/：Flask 模板/静态与前端音频，发布后位于
  _internal（Flask root_path 基于 app.py 所在目录），send_from_directory
  与 render_template 均按 root_path 相对定位 → 必须收进 datas；
- experiment_templates/：不收集。TemplateService 在 BASE_DIR（exe 旁）
  读取，目录不存在时按内置模板 seed，与“源码仓库首次运行”行为一致，
  且不会覆盖用户自定义模板；
- tzdata：zoneinfo("Asia/Shanghai") 在打包环境依赖该数据包，
  必须列入 hiddenimports（见 requirements.txt）。
"""

from pathlib import Path

PROJECT_ROOT = Path(SPECPATH).resolve().parent  # packaging/ 的上一级

_datas = [
    (str(PROJECT_ROOT / "templates"), "templates"),
    (str(PROJECT_ROOT / "static"), "static"),
    (str(PROJECT_ROOT / "ai-shell"), "ai-shell"),
]

_hiddenimports = [
    # 第三方依赖（含视图/服务里的函数内导入，防“运行到才崩”）
    "pydantic",
    "yaml",
    "bcrypt",
    "jwt",
    "cryptography",
    "argon2_cffi",
    "requests",
    "openpyxl",
    "pypdf",
    "PIL",
    "pytesseract",
    "webview",
    "openai",
    "tzdata",
    # e2ee 链多为函数内导入，逐一保底
    "lib.e2ee.crypto",
    "lib.e2ee.keystore",
    "lib.e2ee.grants",
    "lib.e2ee.kms",
    "lib.e2ee.blobstore",
    "lib.e2ee.journal",
    "lib.e2ee.recovery",
    "lib.e2ee.policy",
    "lib.e2ee.service",
    "lib.e2ee.credstore",
    "lib.e2ee.syncengine",
    "lib.e2ee.sync_router",
    "lib.e2ee.real_relay",
    "lib.e2ee.app_glue",
    "lib.e2ee.flask_setup",
    "lib.e2ee.watch",
]

a = Analysis(
    [str(PROJECT_ROOT / "app.py")],
    pathex=[str(PROJECT_ROOT)],
    binaries=[],
    datas=_datas,
    hiddenimports=_hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # 仅排除确定无用的标准库；不排除 tkinter（pywebview 会探测 tk 后端）。
    excludes=["unittest"],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="ExperMate",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="ExperMate",
)