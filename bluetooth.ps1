$ErrorActionPreference = 'SilentlyContinue'
$batteryKey = '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2'
$devices = Get-PnpDevice | Where-Object { $_.Status -eq 'OK' -and (
  $_.InstanceId -match '^BTH' -or
  $_.Class -eq 'Bluetooth' -or
  $_.Class -in @('Mouse', 'Keyboard')
) }
$result = @()
foreach ($d in $devices) {
  $name = $d.FriendlyName
  if (-not $name) { continue }
  $prop = Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName $batteryKey
  $battery = $null
  if ($prop -and $prop.Data -ne $null) {
    $m = [regex]::Match("$($prop.Data)", '\d+')
    if ($m.Success) { $battery = [int]$m.Value }
  }
  if ($null -eq $battery) { continue }
  $result += [PSCustomObject]@{ name = $name; battery = $battery }
}
$json = ConvertTo-Json -InputObject $result -Compress -Depth 3
if ($json) { $json } else { Write-Output '[]' }
