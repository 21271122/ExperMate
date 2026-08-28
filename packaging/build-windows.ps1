<#
.SYNOPSIS
  构建 ExperMate 便携版：PyInstaller onedir + 关键资源校验 + 打包 zip。

.DESCRIPTION
  产物：build\dist\ExperMate\（ExperMate.exe + _internal\）与
       build\dist\ExperMate-<Version>-portable.zip。
  构建产物目录已被 .gitignore 忽略，不会进入版本库。

  数据（config.yaml、data\）不随包内预置，由程序在 exe 同目录首次启动时
  自动创建——应用文件夹即数据文件夹，升级只替换 exe 与 _internal。

.PARAMETER Python
  用于构建的 Python 解释器路径。缺省时依次尝试：
  $env:EXPERMATE_BUILD_PYTHON → D:\conda_envs\exdiary\python.exe → PATH 中的 python。
  建议使用与开发一致的 conda 环境，避免依赖版本漂移。

.PARAMETER Version
  便携包文件名中的版本号，缺省 0.1.0。

.PARAMETER SkipDepCheck
  跳过 PyInstaller 依赖检查/安装。

.EXAMPLE
  .\packaging\build-windows.ps1
  .\packaging\build-windows.ps1 -Version 0.2.0 -Python "D:\venv_exp\python.exe"
#>

[CmdletBinding()]
param(
    [string]$Python = "",
    [string]$Version = "0.1.0",
    [switch]$SkipDepCheck
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot        # packaging/ 的上一级 = 项目根
$Spec = Join-Path $PSScriptRoot "ExperMate.spec"
# 构建产物统一输出到 build\dist\（已在 .gitignore 忽略，永不入库）
$Dist = Join-Path $Root "build\dist"
$AppDir = Join-Path $Dist "ExperMate"
$Exe = Join-Path $AppDir "ExperMate.exe"

# ---- 1. 定位 Python ----
if (-not $Python) { $Python = $env:EXPERMATE_BUILD_PYTHON }
if (-not $Python) {
    $condaPy = "D:\conda_envs\exdiary\python.exe"
    if (Test-Path $condaPy) { $Python = $condaPy } else { $Python = "python" }
}
& $Python --version
if ($LASTEXITCODE -ne 0) { throw "无法执行 Python: $Python" }

# ---- 2. PyInstaller 依赖 ----
if (-not $SkipDepCheck) {
    & $Python -m pip show pyinstaller *> $null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "==> 安装 PyInstaller ..."
        & $Python -m pip install pyinstaller
        if ($LASTEXITCODE -ne 0) { throw "PyInstaller 安装失败" }
    }
}

# ---- 3. 构建（onedir）----
Write-Host "==> PyInstaller 构建（onedir：dist\ExperMate\）..."
Push-Location $Root
try {
    & $Python -m PyInstaller --noconfirm --clean $Spec
    if ($LASTEXITCODE -ne 0) { throw "PyInstaller 构建失败" }
} finally {
    Pop-Location
}

# ---- 4. 校验关键产物 ----
if (-not (Test-Path $Exe)) { throw "未生成可执行文件: $Exe" }
foreach ($rel in @("_internal\templates", "_internal\static", "_internal\ai-shell", "_internal\tzdata")) {
    $p = Join-Path $AppDir $rel
    if (-not (Test-Path $p)) { Write-Warning "缺少资源目录: $rel（请检查 spec 的 datas/hiddenimports）" }
}
$exeSizeMb = [math]::Round((Get-Item $Exe).Length / 1MB, 1)
Write-Host "==> 可执行文件: $Exe（$exeSizeMb MB）"

# ---- 5. 打包便携 zip ----
$ZipName = "ExperMate-$Version-portable.zip"
$ZipPath = Join-Path $Dist $ZipName
if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
Write-Host "==> 压缩便携包 $ZipName ..."
Compress-Archive -Path $AppDir -DestinationPath $ZipPath -CompressionLevel Optimal

Write-Host ""
Write-Host "构建完成："
Write-Host "  应用目录: $AppDir"
Write-Host "  便携包:   $ZipPath"
Write-Host ""
Write-Host "下一步（关键）：在未安装 Python/Git 的干净 Windows 10/11 虚拟机中解压并运行"
Write-Host "ExperMate.exe，按 docs/operations/windows-desktop-release.md 第八章验收清单验证："
Write-Host "  启动/聊天/实验记录/附件/登录/设置/音乐/离线数据导入/多用户隔离/升级保留数据。"