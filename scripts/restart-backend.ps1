$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$pythonPath = Join-Path $projectRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) { throw 'Project Python environment is missing.' }

# Identify only this checkout's uvicorn processes, including the Windows venv launcher.
$pythonProcesses = @(Get-CimInstance Win32_Process -Filter "Name = 'python.exe'")
$roots = @($pythonProcesses | Where-Object {
    $_.ExecutablePath -eq $pythonPath -and
    $_.CommandLine -like '*uvicorn src.db_sql.main:app*' -and
    $_.CommandLine -match '\s--port\s+8000(?:\s|$)'
})
$ownedIds = [System.Collections.Generic.HashSet[int]]::new()
foreach ($process in $roots) { [void]$ownedIds.Add([int]$process.ProcessId) }
do {
    $found = $false
    foreach ($process in $pythonProcesses) {
        if ($ownedIds.Contains([int]$process.ParentProcessId)) {
            if ($ownedIds.Add([int]$process.ProcessId)) { $found = $true }
        }
    }
} while ($found)

$listeners = @(Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue)
foreach ($listener in $listeners) {
    if (-not $ownedIds.Contains([int]$listener.OwningProcess)) {
        throw 'Port 8000 belongs to another application. No processes were stopped.'
    }
}

# Stop reload supervisors before workers, so they cannot spawn replacements.
$owned = @($pythonProcesses | Where-Object { $ownedIds.Contains([int]$_.ProcessId) })
$controllers = @($owned | Where-Object { $_.CommandLine -like '*uvicorn src.db_sql.main:app*' })
$workers = @($owned | Where-Object { $_.CommandLine -notlike '*uvicorn src.db_sql.main:app*' })
foreach ($process in @($controllers) + @($workers)) {
    Stop-Process -Id $process.ProcessId -ErrorAction SilentlyContinue
}

$runtime = Join-Path $projectRoot '.dev-services'
[void][System.IO.Directory]::CreateDirectory($runtime)
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stdout = Join-Path $runtime "backend-$stamp.stdout.log"
$stderr = Join-Path $runtime "backend-$stamp.stderr.log"
$backend = Start-Process -FilePath $pythonPath -ArgumentList @(
    '-m', 'uvicorn', 'src.db_sql.main:app', '--host', '127.0.0.1', '--port', '8000', '--reload'
) -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru

$statePath = Join-Path $runtime 'state.json'
if (Test-Path -LiteralPath $statePath) {
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    if ($state.rootDir -eq $projectRoot) {
        $state.backend = [PSCustomObject]@{ reused = $false; pid = $backend.Id; url = 'http://127.0.0.1:8000'; log = $stderr }
        [System.IO.File]::WriteAllText($statePath, ($state | ConvertTo-Json -Depth 8), [System.Text.UTF8Encoding]::new($false))
    }
}

$healthCheck = @'
import time
import urllib.request
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
for _ in range(30):
    try:
        with opener.open('http://127.0.0.1:8000/health', timeout=2) as response:
            if response.status == 200:
                print('Backend restarted. Health check: OK.')
                break
    except OSError:
        pass
    time.sleep(0.5)
else:
    raise SystemExit('Backend startup failed; inspect .dev-services backend logs.')
'@
$healthCheck | & $pythonPath -
if ($LASTEXITCODE -ne 0) { throw 'Backend health check failed.' }
