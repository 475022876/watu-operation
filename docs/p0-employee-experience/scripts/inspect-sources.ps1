param([string]$CacheRoot=(Join-Path $env:USERPROFILE '.cache/vfib-p0-source-review'))
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$sources=@(
 @{name='LibreChat';repo='LibreChat-AI/LibreChat';ref='main';commit='f4154b649efa37e1345ccc517a4d8d1ed2178c82';prefix='LibreChat-f4154b649efa37e1345ccc517a4d8d1ed2178c82/';archive='librechat-f4154b6.zip';sha256='8CDF45C5730AC6C67DA39C0E981775090D04BCD1DC291FDFA6EE5B69AAD70D70';files=@('LICENSE','package.json','client/package.json','packages/client/package.json','packages/chat/package.json','client/src/components/Chat/ChatView.tsx','client/src/components/Chat/Input/ChatForm.tsx','client/src/hooks/Messages/useMessageActions.tsx','client/src/hooks/Messages/useCopyToClipboard.ts','packages/chat/src/components/pane/ChatPane.tsx','packages/chat/src/components/composer/files/FileUpload.tsx','packages/client/src/components/TextareaAutosize.tsx','client/vite.config.ts')},
 @{name='Plane';repo='makeplane/plane';ref='preview';commit='b98e1defb0e089d4505712d89ee9e137fd0935cd';prefix='plane-b98e1defb0e089d4505712d89ee9e137fd0935cd/';archive='plane-b98e1de.zip';sha256='18FFD54E72BE372FAA4D0641741D1B8D247859FFF833AA741C2A21B0B8B0BB8A';files=@('LICENSE.txt','package.json','apps/web/package.json','pnpm-workspace.yaml','apps/web/components/issues/issue-detail/root.tsx','apps/web/components/issues/issue-detail/main-content.tsx','apps/web/components/issues/issue-detail-widgets/root.tsx','apps/web/components/issues/issue-detail-widgets/attachments/content.tsx','apps/web/components/issues/issue-layouts/list/roots/project-root.tsx')}
)
$results=@()
foreach($source in $sources){
 $archive=Join-Path $CacheRoot $source.archive
 if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $source.sha256){throw ('Source archive digest mismatch: '+$source.name)}
 $zip=[IO.Compression.ZipFile]::OpenRead($archive)
 $files=@()
 try{foreach($relative in $source.files){
  $entry=$zip.GetEntry($source.prefix+$relative)
  if(-not $entry -or $entry.Length -gt 4194304){throw ('Missing or oversized selected source: '+$relative)}
  $stream=$entry.Open();$memory=[IO.MemoryStream]::new()
  try{$stream.CopyTo($memory);$bytes=$memory.ToArray()}finally{$stream.Dispose();$memory.Dispose()}
  $text=[Text.Encoding]::UTF8.GetString($bytes)
  $hasher=[Security.Cryptography.SHA256]::Create()
  try{$digest=([BitConverter]::ToString($hasher.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$hasher.Dispose()}
  $imports=@([regex]::Matches($text,'(?:from\s+|import\s*)["'']([^"'']+)["'']') | ForEach-Object {$_.Groups[1].Value} | Sort-Object -Unique)
  $row=[ordered]@{path=$relative;bytes=$bytes.Length;lines=($text -split "`n").Length;sha256=$digest;sourceUrl=('https://github.com/'+$source.repo+'/blob/'+$source.commit+'/'+$relative);imports=$imports}
  if($relative.EndsWith('package.json')){$j=$text|ConvertFrom-Json;$row.package=[ordered]@{name=$j.name;version=$j.version;license=$j.license;dependencies=$j.dependencies;devDependencies=$j.devDependencies}}
  if($relative -match 'LICENSE'){$row.declaredLicense=if($text -match '^MIT License'){'MIT'}elseif($text -match 'GNU AFFERO GENERAL PUBLIC LICENSE'){'AGPL-3.0; inspect individual SPDX declarations'}else{'REQUIRES_REVIEW'}}
  $files+=$row
 }}finally{$zip.Dispose()}
 $results += [ordered]@{name=$source.name;repository=('https://github.com/'+$source.repo);observedRef=$source.ref;commit=$source.commit;archiveUrl=('https://codeload.github.com/'+$source.repo+'/zip/'+$source.commit);archiveBytes=(Get-Item -LiteralPath $archive).Length;archiveSha256=$source.sha256.ToLowerInvariant();files=$files}
}
$report=[ordered]@{reviewDate='2026-11-02';generatedAtUtc=[DateTime]::UtcNow.ToString('o');method='git ls-remote for ref locking, official codeload archives, local selected-file read and SHA256; no upstream code execution or dependency installation';verificationLimit='Archive SHA256 is a locally captured integrity digest, not a vendor signature. Import analysis is direct only, not a complete dependency or security audit.';projects=$results}
$target=Join-Path $PSScriptRoot '../LOCKED_SOURCE_MANIFEST.json'
$report | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $target -Encoding utf8
Write-Output ('Reviewed '+$results.Count+' fixed source snapshots; selected files='+($results.files.Count)+'; evidence='+[IO.Path]::GetFullPath($target))
