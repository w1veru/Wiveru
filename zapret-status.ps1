$w = Get-Process winws -ErrorAction SilentlyContinue
$s = Get-Service zapret -ErrorAction SilentlyContinue
if ($w -or ($s -and $s.Status -eq 'Running')) {
    Write-Output 'ON'
} else {
    Write-Output 'OFF'
}
