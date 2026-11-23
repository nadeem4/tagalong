# Installs the Tagalong brain on a Windows machine with no screen: uv first, then the brain as a
# uv tool. `tagalong update` upgrades it later. Review this file before piping it to a shell.
$ErrorActionPreference = 'Stop'

$Source = 'git+https://github.com/nadeem4/tagalong#subdirectory=brain'

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Invoke-RestMethod https://astral.sh/uv/install.ps1 | Invoke-Expression
    $env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
}

uv tool install --python 3.13 --force $Source
if ($LASTEXITCODE -ne 0) { throw 'uv could not install the brain' }

Write-Host @'

Installed. Next:
  tagalong key set                     save your Anthropic key
  tagalong serve --install-service     start the brain at logon and print a pairing QR
If `tagalong` is not found, open a new shell or run: uv tool update-shell
'@
