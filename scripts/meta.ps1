<#
  Helper para la Graph API de Meta (Brami3D).
  Lee el token de acceso desde ../.env (META_ACCESS_TOKEN) — nunca lo imprime.
  El .env esta en .gitignore: las credenciales no se suben al repo publico.

  Uso:
    powershell -File scripts/meta.ps1 <endpoint> [querystring] [-Method GET|POST] [-Body '{...}']

  Ejemplos:
    powershell -File scripts/meta.ps1 me "fields=id,name"
    powershell -File scripts/meta.ps1 me/adaccounts "fields=name,account_id,currency,account_status"
    powershell -File scripts/meta.ps1 act_365965302/campaigns "fields=name,status,objective"
#>
param(
  [Parameter(Mandatory=$true)][string]$Endpoint,
  [string]$Query = '',
  [ValidateSet('GET','POST','DELETE')][string]$Method = 'GET',
  [string]$Body = ''
)
$ErrorActionPreference = 'Stop'
$apiVersion = 'v25.0'

$envPath = Join-Path $PSScriptRoot '..\.env'
if (-not (Test-Path $envPath)) { Write-Error "No existe .env en $envPath"; exit 1 }
$tok = ((Get-Content $envPath | Where-Object { $_ -match '^META_ACCESS_TOKEN=' }) -replace '^META_ACCESS_TOKEN=','').Trim()
if (-not $tok) { Write-Error 'META_ACCESS_TOKEN esta vacio en .env'; exit 1 }

$sep = if ($Query) { "$Query&" } else { '' }
$url = "https://graph.facebook.com/$apiVersion/$Endpoint`?${sep}access_token=$tok"

try {
  if ($Method -eq 'GET') {
    $res = Invoke-RestMethod -Method GET -Uri $url
  } else {
    $res = Invoke-RestMethod -Method $Method -Uri $url -ContentType 'application/json' -Body $Body
  }
  $res | ConvertTo-Json -Depth 10
} catch {
  Write-Output "ERROR Graph API:"
  if ($_.ErrorDetails.Message) { Write-Output $_.ErrorDetails.Message } else { Write-Output $_.Exception.Message }
  exit 1
}
