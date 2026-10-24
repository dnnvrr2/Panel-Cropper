$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $MyInvocation.MyCommand.Path
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Panel Cropper.lnk'
$startMenuPath = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Chrome Apps\Panel Cropper.lnk'
$iconPath = Join-Path $workspace 'frontend\public\app-icon.ico'
$launcherPath = Join-Path $workspace 'launch-app.ps1'
$powershellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$backupDir = Join-Path $workspace '.work\shortcut-backup'
$backupPath = Join-Path $backupDir 'Panel Cropper.lnk'
$chromeBackupPath = Join-Path $backupDir 'Panel Cropper Chrome app.lnk'

if (-not (Test-Path -LiteralPath $iconPath)) { throw "Missing icon: $iconPath" }
if (-not (Test-Path -LiteralPath $launcherPath)) { throw "Missing launcher: $launcherPath" }
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$shell = New-Object -ComObject WScript.Shell
if ((Test-Path -LiteralPath $shortcutPath) -and -not (Test-Path -LiteralPath $backupPath)) {
    Copy-Item -LiteralPath $shortcutPath -Destination $backupPath
}
if (Test-Path -LiteralPath $startMenuPath) {
    $installed = $shell.CreateShortcut($startMenuPath)
    if ($installed.TargetPath -like '*chrome_proxy.exe') {
        Copy-Item -LiteralPath $startMenuPath -Destination $chromeBackupPath -Force
    }
}

foreach ($path in @($shortcutPath, $startMenuPath)) {
    if ($path -eq $startMenuPath -and -not (Test-Path -LiteralPath $chromeBackupPath)) { continue }
    $shortcut = $shell.CreateShortcut($path)
    $shortcut.TargetPath = $powershellPath
    $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcherPath`""
    $shortcut.WorkingDirectory = $workspace
    $shortcut.IconLocation = "$iconPath,0"
    $shortcut.Description = 'Start Panel Cropper servers and open the app'
    $shortcut.Save()
    Write-Output $path
}
