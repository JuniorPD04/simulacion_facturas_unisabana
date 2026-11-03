$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$destination = Join-Path $projectRoot 'papel-y-luna-django-postgresql18.zip'
$relativePaths = @('index.html', 'js', 'css', 'assets', 'README.md', 'apps-script.gs', 'tests', 'scripts', 'backend', 'facturacion', 'sql', 'postman', 'docs', 'requirements.txt', 'requirements.lock.txt', 'run.py', 'manage.py', '.env.example')
$staging = Join-Path ([IO.Path]::GetTempPath()) ('papel-luna-package-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $staging | Out-Null
try {
    foreach ($relative in $relativePaths) {
        $source = Join-Path $projectRoot $relative
        if (Test-Path -LiteralPath $source -PathType Container) {
            $target = Join-Path $staging $relative
            New-Item -ItemType Directory -Path $target -Force | Out-Null
            Get-ChildItem -LiteralPath $source -File -Recurse | Where-Object {
                $_.FullName -notmatch '[\\/]__pycache__[\\/]' -and $_.Extension -notin @('.pyc', '.pyo')
            } | ForEach-Object {
                $tail = $_.FullName.Substring($source.Length).TrimStart([char[]]'\/')
                $copyTarget = Join-Path $target $tail
                New-Item -ItemType Directory -Path (Split-Path -Parent $copyTarget) -Force | Out-Null
                Copy-Item -LiteralPath $_.FullName -Destination $copyTarget
            }
        } else { Copy-Item -LiteralPath $source -Destination (Join-Path $staging $relative) }
    }
    # CreateFromDirectory también incluye .env.example sin abrir dos veces el ZIP.
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Force }
    [IO.Compression.ZipFile]::CreateFromDirectory($staging, $destination)
} finally {
    $resolvedStaging = [IO.Path]::GetFullPath($staging)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if ($resolvedStaging.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolvedStaging).StartsWith('papel-luna-package-')) {
        Remove-Item -LiteralPath $resolvedStaging -Recurse -Force
    }
}
$file = Get-Item -LiteralPath $destination
Write-Output ("ZIP generado: {0} ({1} KB)" -f $file.FullName, [math]::Round($file.Length / 1KB, 1))
