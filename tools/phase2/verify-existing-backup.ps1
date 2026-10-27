param([string]$Evidence='D:/运营系统/VFIB-Marketing-OS-Phase1-Evidence-20261027')
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.Security.Cryptography.ProtectedData
$manifest=Get-Content -LiteralPath (Join-Path $Evidence 'backup-verification.json') -Raw | ConvertFrom-Json -AsHashtable
$bundle=Join-Path $Evidence 'original-consistent-backup.aesgcm.json'
if((Get-FileHash -LiteralPath $bundle -Algorithm SHA256).Hash -ne $manifest.backupSha256){throw 'Encrypted backup hash mismatch'}
$stored=Get-Content -LiteralPath $bundle -Raw | ConvertFrom-Json
$key=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($stored.protectedKey),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
$cipher=[Convert]::FromBase64String($stored.ciphertext);$plain=[byte[]]::new($cipher.Length)
$aes=[Security.Cryptography.AesGcm]::new($key,16)
try{$aes.Decrypt([Convert]::FromBase64String($stored.nonce),$cipher,[Convert]::FromBase64String($stored.tag),$plain)}finally{$aes.Dispose();[Security.Cryptography.CryptographicOperations]::ZeroMemory($key)}
$memory=[IO.MemoryStream]::new($plain);$zip=[IO.Compression.ZipArchive]::new($memory,[IO.Compression.ZipArchiveMode]::Read)
try{
 if($zip.Entries.Count -ne $manifest.fileManifest.Count){throw 'Backup entry count mismatch'}
 foreach($entry in $zip.Entries){$stream=$entry.Open();$buffer=[IO.MemoryStream]::new();try{$stream.CopyTo($buffer);$bytes=$buffer.ToArray();$hash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant();if($hash -ne $manifest.fileManifest[$entry.FullName].sha256){throw 'Backup entry checksum mismatch'}}finally{$stream.Dispose();$buffer.Dispose();if($bytes){[Array]::Clear($bytes)}}}
}finally{$zip.Dispose();$memory.Dispose();[Array]::Clear($plain)}
@{verified=$true;entries=$manifest.fileManifest.Count;backupSha256=$manifest.backupSha256;atUtc=[DateTime]::UtcNow.ToString('o');recovery='Authenticated memory-only decryption; same Windows DPAPI user/profile required; no production write'} | ConvertTo-Json | Set-Content -Encoding utf8 TEST_EVIDENCE_PHASE2/backup-reverification.json
Write-Output ('Backup reverified: entries='+$manifest.fileManifest.Count)
