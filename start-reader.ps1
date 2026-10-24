$ErrorActionPreference = 'Stop'
$readerWorkspace = Split-Path -Parent $MyInvocation.MyCommand.Path
$readerUrl = 'http://127.0.0.1:4567'
$readerSettings = Join-Path $readerWorkspace 'backend\data\online-settings.json'
if (Test-Path -LiteralPath $readerSettings) {
    try { $readerUrl = (Get-Content -LiteralPath $readerSettings -Raw | ConvertFrom-Json).serverUrl }
    catch { return }
}
elseif ($env:PANEL_CROPPER_SUWAYOMI_URL) { $readerUrl = $env:PANEL_CROPPER_SUWAYOMI_URL }

$readerAddress = $null
if (-not [Uri]::TryCreate($readerUrl, [UriKind]::Absolute, [ref]$readerAddress)) { return }
if ($readerAddress.Host -notin @('127.0.0.1', 'localhost', '::1') -or $readerAddress.Scheme -ne 'http') { return }

$readerPort = $readerAddress.Port
$readerSocket = [Net.Sockets.TcpClient]::new()
try {
    $readerSocket.Connect($readerAddress.Host, $readerPort)
    return
}
catch [Net.Sockets.SocketException] { }
finally { $readerSocket.Dispose() }

$readerFolder = if ($env:PANEL_CROPPER_SUWAYOMI_DIR) { $env:PANEL_CROPPER_SUWAYOMI_DIR }
    else { Join-Path (Split-Path -Parent $readerWorkspace) 'Suwayomi-Server' }
$readerBuild = Join-Path $readerFolder 'server\build'
if (-not (Test-Path -LiteralPath $readerBuild)) { return }
$readerJar = Get-ChildItem -LiteralPath $readerBuild -Filter 'Suwayomi-Server-*.jar' -File |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
$readerJava = Get-Command java -ErrorAction SilentlyContinue
if (-not $readerJar -or -not $readerJava) { return }

$readerLogs = Join-Path $readerWorkspace '.work\launcher-logs'
New-Item -ItemType Directory -Force -Path $readerLogs | Out-Null
$readerStart = @{
    FilePath = $readerJava.Source
    ArgumentList = @('-Dsuwayomi.tachidesk.config.server.initialOpenInBrowserEnabled=false',
        "-Dsuwayomi.tachidesk.config.server.port=$readerPort", '-jar', ('"{0}"' -f $readerJar.FullName))
    WorkingDirectory = $readerFolder
    WindowStyle = 'Hidden'
    RedirectStandardOutput = Join-Path $readerLogs 'reader.log'
    RedirectStandardError = Join-Path $readerLogs 'reader-error.log'
    PassThru = $true
}
try {
    $readerEngineProcess = Start-Process @readerStart
    Write-Output 'Chapter source service started in the background.'
    for ($readerAttempt = 0; $readerAttempt -lt 100; $readerAttempt++) {
        if ($readerEngineProcess.HasExited) { throw 'The chapter source service stopped during startup. Check .work\launcher-logs\reader-error.log.' }
        $readerReadySocket = [Net.Sockets.TcpClient]::new()
        try {
            $readerReadySocket.Connect($readerAddress.Host, $readerPort)
            return
        }
        catch [Net.Sockets.SocketException] { }
        finally { $readerReadySocket.Dispose() }
        Start-Sleep -Milliseconds 250
    }
    Write-Warning 'The chapter source service is still starting. Reconnect from Online library if needed.'
}
catch { Write-Warning "Could not start the chapter source service. Start your Suwayomi server manually. $($_.Exception.Message)" }
