param(
  [Parameter(Mandatory)]
  [ValidatePattern('^[A-Za-z0-9_.@-]+$')]
  [string]$HostAlias
)

$ErrorActionPreference = 'Stop'
$sshDirectory = Join-Path $env:USERPROFILE '.ssh'
$sshConfig = Join-Path $sshDirectory 'config'
$markerStart = "# >>> BongoCat relay: $HostAlias >>>"
$markerEnd = "# <<< BongoCat relay: $HostAlias <<<"
$relayBlock = @"
$markerStart
Host $HostAlias
  RemoteForward 39284 127.0.0.1:39284
  ExitOnForwardFailure yes
$markerEnd
"@

New-Item -ItemType Directory -Force -Path $sshDirectory | Out-Null
if (-not (Test-Path -LiteralPath $sshConfig)) {
  New-Item -ItemType File -Path $sshConfig | Out-Null
}

$configText = [IO.File]::ReadAllText($sshConfig)
if (-not $configText.Contains($markerStart)) {
  Copy-Item -LiteralPath $sshConfig -Destination "$sshConfig.bak"
  $separator = if ([string]::IsNullOrWhiteSpace($configText)) { '' } else { "`r`n" }
  [IO.File]::AppendAllText(
    $sshConfig,
    "$separator$relayBlock`r`n",
    [Text.UTF8Encoding]::new($false)
  )
}

$integrationDirectory = $PSScriptRoot
$notifier = Join-Path $integrationDirectory 'bongocat-notify.sh'
$installer = Join-Path $integrationDirectory 'install-remote.sh'

& ssh $HostAlias 'mkdir -p ~/.local/bin'
if ($LASTEXITCODE -ne 0) {
  throw "Could not connect to SSH host '$HostAlias'."
}

& scp $notifier "${HostAlias}:~/.local/bin/bongocat-notify"
if ($LASTEXITCODE -ne 0) {
  throw 'Could not copy the BongoCat notifier.'
}

& scp $installer "${HostAlias}:~/.local/bin/install-bongocat-notify"
if ($LASTEXITCODE -ne 0) {
  throw 'Could not copy the BongoCat installer.'
}

& ssh $HostAlias 'chmod +x ~/.local/bin/install-bongocat-notify && ~/.local/bin/install-bongocat-notify'
if ($LASTEXITCODE -ne 0) {
  throw 'The remote BongoCat hook installation failed.'
}

Write-Host ''
Write-Host 'Setup complete. Reconnect SSH so RemoteForward becomes active.'
Write-Host "  ssh $HostAlias"
