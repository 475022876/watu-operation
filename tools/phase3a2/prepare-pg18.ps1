param([string]$CacheRoot=(Join-Path $env:USERPROFILE '.cache/vfib-phase3a2'))
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root=[IO.Path]::GetFullPath($CacheRoot)
if(Test-Path -LiteralPath $root){if((Get-Item -LiteralPath $root -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Cache reparse points are forbidden'}}
New-Item -ItemType Directory -Force -Path $root | Out-Null
$url='https://get.enterprisedb.com/postgresql/postgresql-18.6-1-windows-x64-binaries.zip'
$archive=Join-Path $root 'postgresql-18.6-1-windows-x64-binaries.zip'
$expected='FBE23DA234EE31547BF8A36D29DFD81E82B849DF2D2B78D2EECB43D360252F8C'
if(-not (Test-Path -LiteralPath $archive)){Invoke-WebRequest -Uri $url -OutFile $archive}
if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expected){throw 'Pinned PostgreSQL archive digest mismatch'}
$zip=[IO.Compression.ZipFile]::OpenRead($archive)
try{foreach($entry in $zip.Entries){
 if($entry.FullName -notmatch '^pgsql/(bin|lib|share)/' -or $entry.FullName.EndsWith('/')){continue}
 $target=[IO.Path]::GetFullPath((Join-Path $root $entry.FullName))
 if(-not $target.StartsWith($root.TrimEnd('\')+'\')){throw 'Archive path escapes cache'}
 $parent=[IO.Path]::GetDirectoryName($target);$check=$parent
 while($check.StartsWith($root)){if((Test-Path -LiteralPath $check) -and ((Get-Item -LiteralPath $check -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Archive target traverses reparse point'};$next=[IO.Path]::GetDirectoryName($check);if($next -eq $check -or -not $next){break};$check=$next}
 New-Item -ItemType Directory -Force -Path $parent | Out-Null
 [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$target,$true)
}}finally{$zip.Dispose()}
Write-Output ('Prepared isolated PG18 binaries at '+(Join-Path $root 'pgsql/bin')+'; no Windows service installed')
