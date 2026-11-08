<#
.SYNOPSIS
  Install or uninstall the Xian优化器 composer button in the current DSH profile.

.DESCRIPTION
  The UI is a normal DSH package: a host Cordis plugin plus a browser client
  bundle. Installation copies this package into the profile's node_modules,
  adds a file: dependency, and appends an insert row to cordis.patch.yml. A DSH restart
  is required because the client entry graph is composed at startup.

  All edits are backed up next to the edited file. Use -DryRun to inspect the
  actions without changing anything.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\install-ui.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\install-ui.ps1 -DryRun

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\install-ui.ps1 -Uninstall
#>
[CmdletBinding()]
param(
  [string]$ProfileDir,
  [switch]$Uninstall,
  [switch]$Force,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$SkillDir = (Resolve-Path (Split-Path -Parent $PSScriptRoot)).Path
$PackageName = '@xian/optimizer'
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

function Write-Step([string]$Message) { Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Warn([string]$Message) { Write-Host "!!  $Message" -ForegroundColor Yellow }
function Write-Utf8([string]$Path, [string]$Text) {
  [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}
function Backup-File([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $backup = "$Path.bak-$Stamp"
  Copy-Item -LiteralPath $Path -Destination $backup -Force
  Write-Host "    备份：$backup"
}
function Remove-XianPatchBlock([string]$Text) {
  $lines = $Text -split "`r?`n"
  $out = New-Object System.Collections.Generic.List[string]
  $removed = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]
    if ($line -match '^- insert:\s*$') {
      $block = New-Object System.Collections.Generic.List[string]
      $block.Add($line)
      $j = $i + 1
      while ($j -lt $lines.Count -and ($lines[$j] -match '^\s' -or $lines[$j] -eq '')) {
        $block.Add($lines[$j])
        $j++
      }
      if (($block -join "`n") -match 'xian-optimizer|@xian/optimizer') {
        $removed = $true
        $i = $j - 1
        continue
      }
      foreach ($entry in $block) { $out.Add($entry) }
      $i = $j - 1
      continue
    }
    if ($line -match '^\s*-\s*id:\s*xian-optimizer\s*$') {
      $removed = $true
      $j = $i + 1
      while ($j -lt $lines.Count -and $lines[$j] -match '^\s') { $j++ }
      $i = $j - 1
      continue
    }
    $out.Add($line)
  }
  return [pscustomobject]@{ Text = ($out -join "`r`n"); Removed = $removed }
}

if (-not $ProfileDir) {
  if ($env:DSH_PROFILE_DIR) {
    $ProfileDir = $env:DSH_PROFILE_DIR
  } elseif ($env:DSH_HOME) {
    $ProfileDir = Join-Path $env:DSH_HOME 'profiles\desktop'
  } else {
    $ProfileDir = Join-Path $env:USERPROFILE '.dsh\profiles\desktop'
  }
}
$ProfileDir = (Resolve-Path -LiteralPath $ProfileDir).Path
$PkgJsonPath = Join-Path $ProfileDir 'package.json'
$PatchPath = Join-Path $ProfileDir 'cordis.patch.yml'
$Dest = Join-Path $ProfileDir "node_modules\@xian\optimizer"

if (-not (Test-Path -LiteralPath $PkgJsonPath)) { throw "找不到 profile package.json：$PkgJsonPath" }
if (-not (Test-Path -LiteralPath (Join-Path $SkillDir 'package.json'))) { throw "找不到技能包 package.json：$SkillDir" }

Write-Step "DSH profile：$ProfileDir"
Write-Step "技能源目录：$SkillDir"

$running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like '*DeepSeek*' -or $_.ProcessName -like '*dsh*' })
if ($running.Count -gt 0) {
  Write-Warn "检测到 DSH 可能正在运行（$($running[0].ProcessName)）。配置会在下次启动生效；建议先完全退出 DSH。"
}

if ($Uninstall) {
  Write-Step "卸载 $PackageName"
  if (Test-Path -LiteralPath $Dest) {
    $backup = "$Dest.removed-$Stamp"
    if ($DryRun) {
      Write-Host "    [dry-run] 移动 $Dest -> $backup"
    } else {
      Move-Item -LiteralPath $Dest -Destination $backup
      Write-Host "    已移除包目录（保留备份）：$backup"
    }
  } else {
    Write-Host "    包目录不存在，跳过。"
  }

  $jsonText = [System.IO.File]::ReadAllText($PkgJsonPath)
  $json = $jsonText | ConvertFrom-Json
  if ($json.PSObject.Properties['dependencies'] -and $json.dependencies.PSObject.Properties[$PackageName]) {
    if ($DryRun) {
      Write-Host "    [dry-run] 从 package.json 移除 dependencies.$PackageName"
    } else {
      Backup-File $PkgJsonPath
      $json.dependencies.PSObject.Properties.Remove($PackageName)
      Write-Utf8 $PkgJsonPath (($json | ConvertTo-Json -Depth 30) + "`r`n")
      Write-Host "    已移除 package.json 依赖。"
    }
  }

  if (Test-Path -LiteralPath $PatchPath) {
    $patchText = [System.IO.File]::ReadAllText($PatchPath)
    $clean = Remove-XianPatchBlock $patchText
    if ($clean.Removed) {
      if ($DryRun) {
        Write-Host "    [dry-run] 从 cordis.patch.yml 移除 xian-optimizer 条目"
      } else {
        Backup-File $PatchPath
        Write-Utf8 $PatchPath ($clean.Text.TrimEnd() + "`r`n")
        Write-Host "    已移除 cordis.patch.yml 条目。"
      }
    } else {
      Write-Host "    cordis.patch.yml 中没有该条目，跳过。"
    }
  }

  Write-Host ""
  Write-Host "卸载完成。重启 DSH 后按钮消失。" -ForegroundColor Green
  exit 0
}

# ---- Install ----
Write-Step "安装 $PackageName"
if ((Test-Path -LiteralPath $Dest) -and -not $Force -and -not $DryRun) {
  throw "目标已存在：$Dest。加 -Force 覆盖，或先运行 -Uninstall。"
}

$sourceSpec = "file:$($SkillDir -replace '\\', '/')"
$json = [System.IO.File]::ReadAllText($PkgJsonPath) | ConvertFrom-Json
if (-not $json.PSObject.Properties['dependencies'] -or $null -eq $json.dependencies) {
  $json | Add-Member -MemberType NoteProperty -Name dependencies -Value ([pscustomobject]@{}) -Force
}
$json.dependencies | Add-Member -NotePropertyName $PackageName -NotePropertyValue $sourceSpec -Force

$patchText = if (Test-Path -LiteralPath $PatchPath) { [System.IO.File]::ReadAllText($PatchPath) } else { '' }
$clean = Remove-XianPatchBlock $patchText
$patchText = $clean.Text
$already = $patchText.Contains('@xian/optimizer')
$patchBlock = '- insert:' + "`r`n" + '    - id: xian-optimizer' + "`r`n" + '      name: "@xian/optimizer"'
if (-not $already) {
  $patchText = if ($patchText.Trim().Length -eq 0) { $patchBlock } else { $patchText.TrimEnd() + "`r`n`r`n" + $patchBlock }
}

if ($DryRun) {
  Write-Host "    [dry-run] 复制 $SkillDir -> $Dest"
  Write-Host "    [dry-run] package.json dependencies.$PackageName = $sourceSpec"
  if ($clean.Removed) { Write-Host "    [dry-run] 移除旧的 xian-optimizer patch 条目" }
  if ($already) { Write-Host "    [dry-run] cordis.patch.yml 已有 insert 条目，跳过" }
  else { Write-Host "    [dry-run] 追加 cordis.patch.yml insert 条目：`n$patchBlock" }
  Write-Host ""
  Write-Host "Dry run 完成，未修改任何文件。" -ForegroundColor Yellow
  exit 0
}

Backup-File $PkgJsonPath
Write-Utf8 $PkgJsonPath (($json | ConvertTo-Json -Depth 30) + "`r`n")
Write-Host "    已登记 package.json 依赖：$sourceSpec"

if (Test-Path -LiteralPath $Dest) {
  $backup = "$Dest.bak-$Stamp"
  Move-Item -LiteralPath $Dest -Destination $backup
  Write-Host "    已有包目录，备份到：$backup"
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Dest) | Out-Null
Copy-Item -LiteralPath $SkillDir -Destination $Dest -Recurse -Force
Write-Host "    已复制包文件到：$Dest"

if ($clean.Removed -or -not $already) {
  Backup-File $PatchPath
  Write-Utf8 $PatchPath ($patchText.TrimEnd() + "`r`n")
  if ($clean.Removed) { Write-Host "    已移除旧的 xian-optimizer patch 条目。" }
  if (-not $already) { Write-Host "    已追加 cordis.patch.yml insert 条目。" }
} else {
  Write-Host "    cordis.patch.yml 已有 insert 条目，跳过。"
}

Write-Host ""
Write-Host "安装完成。" -ForegroundColor Green
Write-Host "下一步：完全退出并重新启动 DSH，然后打开任意项目会话，在输入框右侧点击「✦ Xian优化」。"
Write-Host "自检：浏览器访问 http://127.0.0.1:65108/api/xian/health（端口以实际 GUI 为准）。"
