[CmdletBinding()]
param(
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 5) {
    throw 'Windows PowerShell 5.1 or PowerShell 7+ is required.'
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$packagePath = Join-Path $repoRoot 'package.json'
$package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
$version = $package.version -replace '\+.*$', ''

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $repoRoot 'dist'
}

Get-Command git -ErrorAction Stop | Out-Null
Get-Command node -ErrorAction Stop | Out-Null
& node (Join-Path $PSScriptRoot 'preflight.mjs') --compact
if ($LASTEXITCODE -ne 0) {
    throw 'HelioTerm preflight failed.'
}

& git -C $repoRoot rev-parse --verify HEAD *> $null
if ($LASTEXITCODE -ne 0) {
    throw 'Create a Git commit before packaging.'
}
$branch = (& git -C $repoRoot rev-parse --abbrev-ref HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $branch -ne 'main') {
    throw "Release packaging must run from main; current branch: $branch"
}
$status = & git -C $repoRoot status --porcelain
if ($status) {
    throw 'The Git working tree must be clean before packaging.'
}

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$archivePath = Join-Path $OutputDirectory "helioterm-$version.zip"
$checksumPath = "$archivePath.sha256"
$extractionDirectory = Join-Path ([IO.Path]::GetTempPath()) ('helioterm-release-' + [guid]::NewGuid().ToString('N'))

if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
}
if (Test-Path -LiteralPath $checksumPath) {
    Remove-Item -LiteralPath $checksumPath -Force
}

& git -C $repoRoot archive --format=zip --output=$archivePath HEAD
if ($LASTEXITCODE -ne 0) {
    throw 'git archive failed.'
}

try {
    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractionDirectory -Force
    $required = @(
        '.codex-plugin\plugin.json',
        '.agents\plugins\marketplace.json',
        '.mcp.json',
        'agents\helioterm.toml',
        'agents\helioterm-mcp.toml',
        'skills\helioterm\SKILL.md',
        'scripts\bootstrap-install.mjs',
        'scripts\install-project.mjs',
        'scripts\package-release.ps1',
        'scripts\preflight.mjs',
        'package.json',
        'README.md',
        'LICENSE'
    )
    foreach ($relativePath in $required) {
        if (-not (Test-Path -LiteralPath (Join-Path $extractionDirectory $relativePath) -PathType Leaf)) {
            throw "Release archive is missing: $relativePath"
        }
    }

    $extractedPackage = Get-Content -LiteralPath (Join-Path $extractionDirectory 'package.json') -Raw | ConvertFrom-Json
    $extractedManifest = Get-Content -LiteralPath (Join-Path $extractionDirectory '.codex-plugin\plugin.json') -Raw | ConvertFrom-Json
    if ($extractedPackage.version -ne $version -or ($extractedManifest.version -replace '\+.*$', '') -ne $version) {
        throw 'Extracted package and plugin versions do not match the release version.'
    }

    & node (Join-Path $extractionDirectory 'scripts\preflight.mjs') --compact
    if ($LASTEXITCODE -ne 0) {
        throw 'Extracted release preflight failed.'
    }
    $consumerProject = Join-Path $extractionDirectory '.release-smoke\project'
    $consumerCodexHome = Join-Path $extractionDirectory '.release-smoke\codex-home'
    & node (Join-Path $extractionDirectory 'scripts\bootstrap-install.mjs') --project $consumerProject --codex-home $consumerCodexHome --skip-codex --write --compact
    if ($LASTEXITCODE -ne 0) {
        throw 'Extracted release bootstrap smoke failed.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $consumerProject '.codex\agents\helioterm.toml') -PathType Leaf)) {
        throw 'Extracted release bootstrap did not install the HelioTerm profile.'
    }
} finally {
    if (Test-Path -LiteralPath $extractionDirectory) {
        $cleanupTarget = [IO.Path]::GetFullPath($extractionDirectory)
        $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([char[]]@('\', '/'))
        if (-not [string]::Equals([IO.Path]::GetDirectoryName($cleanupTarget), $temporaryRoot, [StringComparison]::OrdinalIgnoreCase) -or
            (Split-Path -Leaf $cleanupTarget) -notmatch '^helioterm-release-[a-f0-9]{32}$') {
            throw 'Release cleanup path is outside the intended temporary directory.'
        }
        Remove-Item -LiteralPath $extractionDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
}

$hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $(Split-Path -Leaf $archivePath)" | Set-Content -LiteralPath $checksumPath -Encoding ascii

Write-Output "Created: $archivePath"
Write-Output "SHA256: $hash"
