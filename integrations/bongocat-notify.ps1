param(
  [ValidateSet('claude', 'codex')]
  [string]$Provider = 'codex',
  [string]$NotificationJson
)

$payload = $NotificationJson
if ([string]::IsNullOrWhiteSpace($payload)) {
  $payload = [Console]::In.ReadToEnd()
}
if ([string]::IsNullOrWhiteSpace($payload) -and $args.Count -gt 0) {
  $payload = $args[-1]
}
if ([string]::IsNullOrWhiteSpace($payload)) {
  $payload = '{}'
}

$candidates = @(
  $env:BONGOCAT_PATH,
  (Join-Path $env:LOCALAPPDATA 'BongoCat\BongoCat.exe'),
  (Join-Path $PSScriptRoot '..\src-tauri\target\release\bongo-cat.exe'),
  (Join-Path $PSScriptRoot '..\target\release\bongo-cat.exe'),
  (Join-Path $PSScriptRoot '..\src-tauri\target\debug\bongo-cat.exe'),
  (Join-Path $PSScriptRoot '..\target\debug\bongo-cat.exe')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

if ($candidates.Count -eq 0) {
  try {
    Invoke-WebRequest `
      -UseBasicParsing `
      -Method Post `
      -Uri "http://127.0.0.1:39284/notify/$Provider" `
      -ContentType 'application/json' `
      -Body ([Text.Encoding]::UTF8.GetBytes($payload)) `
      -TimeoutSec 2 | Out-Null
  }
  catch {
    # Hooks must never interrupt the AI agent when the relay is unavailable.
  }
  exit 0
}

$encoded = [BitConverter]::ToString([Text.Encoding]::UTF8.GetBytes($payload)).Replace('-', '')
Start-Process -WindowStyle Hidden -FilePath $candidates[0] -ArgumentList @(
  '--ai-notify-source', $Provider,
  '--ai-notify-payload', $encoded
) | Out-Null
