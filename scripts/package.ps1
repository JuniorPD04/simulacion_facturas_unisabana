$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$destination = Join-Path $projectRoot 'desarrollo-web-2026-2-parcial2-perez-quispe-zona.zip'
$relativePaths = @('index.html', 'js', 'css', 'assets', 'apps-script.gs', 'README.md', 'tests', 'scripts')
$paths = $relativePaths | ForEach-Object { Join-Path $projectRoot $_ }
Compress-Archive -LiteralPath $paths -DestinationPath $destination -Force
$file = Get-Item -LiteralPath $destination
Write-Output ("ZIP generado: {0} ({1} KB)" -f $file.FullName, [math]::Round($file.Length / 1KB, 1))
if ((Get-Content -LiteralPath (Join-Path $projectRoot 'js/api.js') -Raw).Contains('var API_URL = "";')) {
    Write-Warning 'API_URL sigue vacia. Configurar el servicio y regenerar el ZIP antes de entregar.'
}
