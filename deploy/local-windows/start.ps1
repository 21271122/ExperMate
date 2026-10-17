param([int]$Port = 8765)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$runtimeDir = Join-Path $projectRoot 'data/local-server'
$pythonPath = Join-Path $projectRoot '.venv/Scripts/python.exe'
$pidPath = Join-Path $runtimeDir 'server.pid'
if (-not (Test-Path -LiteralPath $pythonPath)) { throw '请先创建 .venv 并安装服务端依赖。' }
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
if (Test-Path -LiteralPath $pidPath) {
    $savedProcess = Get-Process -Id ([int](Get-Content -LiteralPath $pidPath)) -ErrorAction SilentlyContinue
    if ($savedProcess) { throw '本地服务进程仍在运行；请先执行 stop.ps1。' }
}
$oldDataDir = $env:EXPERMATE_DATA_DIR
$oldSettings = $env:EXDIARY_SETTINGS
$oldPreferredDataDir = $env:DATA_DIR
$oldDb = $env:EXDIARY_DB
try {
    $portProbe = [System.Net.Sockets.TcpClient]::new()
    try { $portProbe.Connect('127.0.0.1', $Port) } catch [System.Net.Sockets.SocketException] { }
    if ($portProbe.Connected) { $portProbe.Dispose(); throw "端口 $Port 已被占用。" }
    $portProbe.Dispose()
    $env:EXPERMATE_DATA_DIR = $runtimeDir
    $env:DATA_DIR = $runtimeDir
    $env:EXDIARY_DB = Join-Path $runtimeDir 'data.db'
    $env:EXDIARY_SETTINGS = Join-Path $runtimeDir 'config.yaml'
    $arguments = @('-m', 'waitress', '--host=127.0.0.1', "--port=$Port", '--threads=16', '--channel-timeout=1800', '--call', 'app:create_app')
    $serverProcess = Start-Process -FilePath $pythonPath -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeDir 'stdout.log') -RedirectStandardError (Join-Path $runtimeDir 'stderr.log')
    Set-Content -LiteralPath $pidPath -Value $serverProcess.Id
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        $serverProcess.Refresh()
        if ($serverProcess.HasExited) { throw '服务启动失败，请检查 data/local-server/stderr.log。' }
        try {
            $health = Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
            if ($health.ok) { Write-Output "ExperMate 已启动：http://localhost:$Port（PID $($serverProcess.Id)）"; return }
        } catch { Start-Sleep -Milliseconds 500 }
    }
    throw '健康检查超时，请检查 data/local-server/stderr.log。'
} finally {
    $env:EXPERMATE_DATA_DIR = $oldDataDir
    $env:EXDIARY_SETTINGS = $oldSettings
    $env:DATA_DIR = $oldPreferredDataDir
    $env:EXDIARY_DB = $oldDb
}
