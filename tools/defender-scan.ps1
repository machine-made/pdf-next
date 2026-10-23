# Scan the Windows bundles with Microsoft Defender and fail on any detection.
# 0.15.0 was published and then flagged on the first machine that downloaded it.
$ErrorActionPreference = 'Stop'
$mp = "$env:ProgramFiles\Windows Defender\MpCmdRun.exe"
& $mp -SignatureUpdate | Out-Host
$files = Get-ChildItem src-tauri/target/release/bundle -Recurse -Include *.exe, *.msi
if (-not $files) { throw 'no Windows bundle to scan' }
foreach ($file in $files) {
  $out = & $mp -Scan -ScanType 3 -File $file.FullName -DisableRemediation | Out-String
  Write-Host $out
  if ($out -notmatch 'found no threats') { throw "Defender flagged $($file.Name)" }
}
