$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$pidPath = Join-Path $projectRoot 'data/local-server/server.pid'
if (-not (Test-Path -LiteralPath $pidPath)) { Write-Output '没有本地服务 PID 记录。'; return }
$serverProcessId = [int](Get-Content -LiteralPath $pidPath)
$serverProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$serverProcessId"
if ($serverProcess) {
    $expectedPython = (Resolve-Path (Join-Path $projectRoot '.venv/Scripts/python.exe')).Path
    if ($serverProcess.CommandLine -notlike '*-m waitress*app:create_app*' -or $serverProcess.ExecutablePath -ne $expectedPython) {
        throw 'PID 与本项目 Waitress 进程不匹配，拒绝停止。'
    }
    Stop-Process -Id $serverProcessId
}
Remove-Item -LiteralPath $pidPath
Write-Output '本地服务已停止，数据保留。'
