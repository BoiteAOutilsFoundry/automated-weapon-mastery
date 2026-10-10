# Construit le ZIP installable de Automated Weapon Mastery pour les releases GitHub.
# Windows PowerShell 5.1+ : .\Tools\package.ps1
# Le ZIP contient module.json a sa racine (sans dossier parent).

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$archiveName = 'automated-weapon-mastery.zip'
$archivePath = Join-Path $projectRoot $archiveName
$manifestPath = Join-Path $projectRoot 'module.json'

# 1. Validation du manifeste, pour eviter de publier un ZIP inutilisable.
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw 'module.json introuvable a la racine du projet.'
}
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.id -ne 'automated-weapon-mastery') {
    throw "Identifiant inattendu dans module.json : $($manifest.id)"
}
if (-not $manifest.version) {
    throw 'La version est absente de module.json.'
}
$expectedDownload = "/releases/download/v$($manifest.version)/$archiveName"
if (-not [string]$manifest.download -or -not $manifest.download.EndsWith($expectedDownload, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "L'URL download doit se terminer par $expectedDownload (module.json)."
}

# 2. Validation optionnelle du code (si Node.js est disponible).
# Le packaging reste possible sur une machine Windows sans Node.js.
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) {
    & node (Join-Path $PSScriptRoot 'check.mjs')
    if ($LASTEXITCODE -ne 0) {
        throw 'Verification du code echouee : archive non creee.'
    }
} else {
    Write-Warning 'Node.js absent : verification statique JavaScript ignoree.'
}

# 3. Liste blanche : pas de .git, Tools, tests, fichiers de developpement.
$files = @('module.json')
foreach ($fileName in @('README.md', 'LICENSE', 'LICENSE.md', 'CHANGELOG.md', 'changelog.md')) {
    if (Test-Path -LiteralPath (Join-Path $projectRoot $fileName) -PathType Leaf) {
        $files += $fileName
    }
}
# Ces dossiers sont inclus en entier s'ils existent, y compris leurs ressources.
$distributionFolders = @('scripts', 'styles', 'assets', 'icons', 'images', 'templates', 'lang', 'packs', 'audio', 'sounds', 'fonts')
foreach ($folder in $distributionFolders) {
    $folderPath = Join-Path $projectRoot $folder
    if (-not (Test-Path -LiteralPath $folderPath -PathType Container)) { continue }
    $files += @(Get-ChildItem -LiteralPath $folderPath -Recurse -File |
        Where-Object { $_.Name -ne '.DS_Store' -and $_.Name -ne 'Thumbs.db' } |
        ForEach-Object { $_.FullName.Substring($projectRoot.Length + 1).Replace('\', '/') })
}
$files = @($files | Sort-Object -Unique)

# Tout asset declare par Foundry doit etre dans l'archive.
foreach ($asset in @($manifest.esmodules) + @($manifest.scripts) + @($manifest.styles)) {
    if (-not $asset) { continue }
    $entry = ([string]$asset).Replace('\', '/')
    if ($files -notcontains $entry) {
        throw "Fichier declare dans module.json mais absent du ZIP : $entry"
    }
}

# 4. Construction dans un fichier temporaire : l'ancien ZIP est conserve
#    tant que le nouveau n'est pas cree et verifie.
$temporaryArchive = Join-Path $projectRoot ('.package-' + [guid]::NewGuid().ToString('N') + '.tmp')
try {
    $archive = [System.IO.Compression.ZipFile]::Open($temporaryArchive, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($entry in $files) {
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $archive,
                (Join-Path $projectRoot $entry.Replace('/', [System.IO.Path]::DirectorySeparatorChar)),
                $entry,
                [System.IO.Compression.CompressionLevel]::Optimal
            ) | Out-Null
        }
    } finally {
        $archive.Dispose()
    }

    # Verification des entrees, notamment module.json a la racine.
    $verification = [System.IO.Compression.ZipFile]::OpenRead($temporaryArchive)
    try {
        $names = @($verification.Entries | ForEach-Object { $_.FullName })
        if ($names -notcontains 'module.json' -or $names.Count -ne $files.Count) {
            throw 'Verification du contenu du ZIP echouee.'
        }
        foreach ($entry in $files) {
            if ($names -notcontains $entry) { throw "Entree absente du ZIP : $entry" }
        }
    } finally {
        $verification.Dispose()
    }

    Move-Item -LiteralPath $temporaryArchive -Destination $archivePath -Force
} finally {
    if (Test-Path -LiteralPath $temporaryArchive) {
        Remove-Item -LiteralPath $temporaryArchive -Force
    }
}

Write-Host "Archive creee : $archivePath"
Write-Host "Version du module : $($manifest.version)"
Write-Host 'A joindre a la release GitHub avec le fichier module.json.'
