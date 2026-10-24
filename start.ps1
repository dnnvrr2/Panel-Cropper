$ErrorActionPreference = "Stop"
$workspace = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $workspace 'start-reader.ps1')

$portCheck = [System.Net.Sockets.TcpClient]::new()
$backendIsRunning = $false
try {
    $portCheck.Connect("127.0.0.1", 8000)
    $backendIsRunning = $true
}
catch [System.Net.Sockets.SocketException] {
    # No backend is listening yet.
}
finally {
    $portCheck.Dispose()
}

if ($backendIsRunning) {
    try {
        $apiSpec = Invoke-RestMethod -Uri "http://127.0.0.1:8000/openapi.json" -TimeoutSec 3
    }
    catch {
        throw "Port 8000 is in use by another service. Close it before starting Panel Cropper."
    }
    if ($apiSpec.paths.PSObject.Properties.Name -notcontains "/api/projects/{project_id}/images/{image_id}/thumbnail" -or
        $apiSpec.paths.PSObject.Properties.Name -notcontains "/api/projects/{project_id}/source-groups/cbz" -or
        $apiSpec.paths.PSObject.Properties.Name -notcontains "/api/online/connection" -or
        $apiSpec.paths.PSObject.Properties.Name -notcontains "/api/projects/{project_id}/source-groups/online-chapter" -or
        $apiSpec.components.schemas.CropRequest.properties.PSObject.Properties.Name -notcontains "rotation" -or
        $apiSpec.components.schemas.CropRequest.properties.PSObject.Properties.Name -notcontains "mode") {
        throw "An older Panel Cropper backend is running on port 8000. Close it before starting the app again."
    }
}

$backendJob = $null

try {
    if (-not $backendIsRunning) {
        $backendJob = Start-Process python -ArgumentList "-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", "8000" -WorkingDirectory $workspace -WindowStyle Hidden -PassThru
        $backendReady = $false
        for ($attempt = 0; $attempt -lt 40; $attempt++) {
            Start-Sleep -Milliseconds 250
            if ($backendJob.HasExited) {
                throw "The Panel Cropper backend stopped during startup."
            }
            try {
                $response = Invoke-WebRequest -Uri "http://127.0.0.1:8000/api/health" -TimeoutSec 1
                if ($response.StatusCode -eq 200) {
                    $backendReady = $true
                    break
                }
            }
            catch {
                # Keep waiting while the backend starts.
            }
        }
        if (-not $backendReady) {
            throw "The Panel Cropper backend did not become ready on port 8000."
        }
    }

    Set-Location (Join-Path $workspace "frontend")
    npm run dev
}
finally {
    if ($backendJob -and !$backendJob.HasExited) {
        Stop-Process -Id $backendJob.Id
    }
}
