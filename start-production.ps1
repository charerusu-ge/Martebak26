param([int]$Port = 8080)

$usedPorts = (netstat -ano | Select-String "LISTENING" | ForEach-Object {
  if ($_.Line -match ":(\d+)\s+") { [int]$matches[1] }
}) | Sort-Object -Unique

while ($usedPorts -contains $Port) {
  $Port++
}

$env:PORT = "$Port"
$env:HOST = "0.0.0.0"
Write-Host "Starting Martebak26 production at http://localhost:$Port"
node server.js
