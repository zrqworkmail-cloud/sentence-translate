param(
	[string]$Version
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = Join-Path $root "src"
$manifest = Get-Content (Join-Path $src "manifest.json") -Raw | ConvertFrom-Json
if (-not $Version) { $Version = $manifest.version }

$outDir = Join-Path $root "build"
New-Item -ItemType Directory -Force $outDir | Out-Null
$out = Join-Path $outDir "sentence-translate-$Version.xpi"
if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("sentence-translate-" + [guid]::NewGuid().ToString("N") + ".zip")
[IO.Compression.ZipFile]::CreateFromDirectory($src, $tmp, [IO.Compression.CompressionLevel]::Optimal, $false)

# .NET on Windows writes entry names with backslashes, which Gecko cannot
# resolve inside a jar:. Re-pack with forward slashes.
$source = [IO.Compression.ZipFile]::OpenRead($tmp)
$dest = [IO.Compression.ZipFile]::Open($out, [IO.Compression.ZipArchiveMode]::Create)
try {
	foreach ($entry in $source.Entries) {
		$name = $entry.FullName -replace "\\", "/"
		if ($name.EndsWith("/")) { continue }
		$copy = $dest.CreateEntry($name, [IO.Compression.CompressionLevel]::Optimal)
		$copy.LastWriteTime = $entry.LastWriteTime
		$input = $entry.Open()
		$output = $copy.Open()
		try { $input.CopyTo($output) }
		finally { $output.Dispose(); $input.Dispose() }
	}
}
finally {
	$dest.Dispose()
	$source.Dispose()
	Remove-Item -LiteralPath $tmp -Force
}

Write-Output $out
