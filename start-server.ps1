param([int]$Port = 5173)

$usedPorts = (netstat -ano | Select-String "LISTENING" | ForEach-Object {
  if ($_.Line -match ":(\d+)\s+") { [int]$matches[1] }
}) | Sort-Object -Unique

while ($usedPorts -contains $Port) {
  $Port++
}

Write-Host "Starting Martebak26 at http://localhost:$Port"
python -m http.server $Port --bind 127.0.0.1
