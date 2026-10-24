param([switch]$NoOpen)

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $MyInvocation.MyCommand.Path
$frontend = Join-Path $workspace 'frontend'
$logDir = Join-Path $workspace '.work\launcher-logs'
$url = 'http://127.0.0.1:5173/'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Test-LocalPort([int]$port) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $client.Connect('127.0.0.1', $port)
        return $true
    }
    catch [System.Net.Sockets.SocketException] {
        return $false
    }
    finally {
        $client.Dispose()
    }
}

function Test-Backend {
    try {
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/api/health' -TimeoutSec 2
        if ($health.status -ne 'ok') { return $false }
        $spec = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/openapi.json' -TimeoutSec 2
        return $spec.paths.PSObject.Properties.Name -contains '/api/projects/{project_id}/images/{image_id}/thumbnail' -and
            $spec.paths.PSObject.Properties.Name -contains '/api/projects/{project_id}/source-groups/cbz' -and
            $spec.paths.PSObject.Properties.Name -contains '/api/online/connection' -and
            $spec.paths.PSObject.Properties.Name -contains '/api/projects/{project_id}/source-groups/online-chapter' -and
            $spec.components.schemas.CropRequest.properties.PSObject.Properties.Name -contains 'rotation' -and
            $spec.components.schemas.CropRequest.properties.PSObject.Properties.Name -contains 'mode'
    }
    catch {
        return $false
    }
}

function Test-Frontend {
    try {
        $response = Invoke-WebRequest -Uri $url -TimeoutSec 2 -UseBasicParsing
        return $response.StatusCode -eq 200 -and $response.Content -match '<title>Panel Cropper</title>'
    }
    catch {
        return $false
    }
}

function Wait-ForServer([scriptblock]$ready, [System.Diagnostics.Process]$process, [string]$name, [string]$logPath) {
    for ($attempt = 0; $attempt -lt 100; $attempt++) {
        if (& $ready) { return }
        if ($process.HasExited) { throw "$name stopped during startup. See $logPath" }
        Start-Sleep -Milliseconds 250
    }
    throw "$name did not become ready. See $logPath"
}

try {
    & (Join-Path $workspace 'start-reader.ps1')
    if (Test-LocalPort 8000) {
        if (-not (Test-Backend)) { throw 'Port 8000 is occupied by an incompatible backend.' }
    }
    if (Test-LocalPort 5173) {
        if (-not (Test-Frontend)) { throw 'Port 5173 is occupied by another site.' }
    }

    if (-not (Test-Backend)) {
        $python = (Get-Command python -ErrorAction Stop).Source
        $backendLog = Join-Path $logDir 'backend.log'
        $backendError = Join-Path $logDir 'backend-error.log'
        $backendStart = @{
            FilePath = $python
            ArgumentList = @('-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', '8000')
            WorkingDirectory = $workspace
            WindowStyle = 'Hidden'
            RedirectStandardOutput = $backendLog
            RedirectStandardError = $backendError
            PassThru = $true
        }
        $backend = Start-Process @backendStart
        Wait-ForServer { Test-Backend } $backend 'Backend' $backendError
    }

    if (-not (Test-Frontend)) {
        $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
        $frontendLog = Join-Path $logDir 'frontend.log'
        $frontendError = Join-Path $logDir 'frontend-error.log'
        $viteStart = @{
            FilePath = $npm
            ArgumentList = @('run', 'dev')
            WorkingDirectory = $frontend
            WindowStyle = 'Hidden'
            RedirectStandardOutput = $frontendLog
            RedirectStandardError = $frontendError
            PassThru = $true
        }
        $previousLauncherFlag = $env:PANEL_CROPPER_LAUNCHER
        $env:PANEL_CROPPER_LAUNCHER = '1'
        try {
            $vite = Start-Process @viteStart
        }
        finally {
            $env:PANEL_CROPPER_LAUNCHER = $previousLauncherFlag
        }
        Wait-ForServer { Test-Frontend } $vite 'Frontend' $frontendError
    }

    if (-not $NoOpen) {
        $chromeApp = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Chrome Apps\Panel Cropper.lnk'
        $chromeBackup = Join-Path $workspace '.work\shortcut-backup\Panel Cropper Chrome app.lnk'
        $directApp = $null
        if (Test-Path -LiteralPath $chromeApp) {
            $shell = New-Object -ComObject WScript.Shell
            $shortcut = $shell.CreateShortcut($chromeApp)
            if ($shortcut.TargetPath -like '*chrome_proxy.exe') { $directApp = $chromeApp }
        }
        if (-not $directApp -and (Test-Path -LiteralPath $chromeBackup)) {
            $directApp = $chromeBackup
        }
        if ($directApp) {
            Start-Process -FilePath $directApp
        }
        else {
            Start-Process -FilePath $url
        }
    }
    Write-Output "Panel Cropper ready at $url"
}
catch {
    $message = $_.Exception.Message
    Add-Content -LiteralPath (Join-Path $logDir 'launcher-error.log') -Value "$(Get-Date -Format o) $message"
    if (-not $NoOpen) {
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.MessageBox]::Show($message, 'Panel Cropper',
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
    }
    Write-Error $message
    exit 1
}
