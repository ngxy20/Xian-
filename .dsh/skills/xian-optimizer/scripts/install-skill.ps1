<#
.SYNOPSIS
  Install Xian优化器 into the user-level DSH skills directory.

.DESCRIPTION
  Copies (or junctions) this skill bundle to $DSH_HOME\skills\xian-optimizer so
  every DSH project can invoke /xian-optimizer. The skill is read-only at
  runtime; this script only manages the installation directory.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\install-skill.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\install-skill.ps1 -Link -Force

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\install-skill.ps1 -Uninstall
#>
[CmdletBinding()]
param(
  [switch]$Link,
  [switch]$Uninstall,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$SkillDir = (Resolve-Path (Split-Path -Parent $PSScriptRoot)).Path
$DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$SkillsRoot = Join-Path $DshHome 'skills'
$Dest = Join-Path $SkillsRoot 'xian-optimizer'

function Write-Step([string]$Message) { Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Warn([string]$Message) { Write-Host "!!  $Message" -ForegroundColor Yellow }

if (-not (Test-Path -LiteralPath (Join-Path $SkillDir 'SKILL.md'))) {
  throw "找不到 SKILL.md：$SkillDir"
}

if ($Uninstall) {
  if (-not (Test-Path -LiteralPath $Dest)) {
    Write-Host "未安装：$Dest"
    exit 0
  }
  $resolved = (Resolve-Path -LiteralPath $Dest).Path
  if (-not $resolved.StartsWith($SkillsRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "拒绝删除不在 skills 根目录下的路径：$resolved"
  }
  Write-Step "删除 $Dest"
  # A junction is removed with Remove-Item; a real directory is removed recursively.
  $item = Get-Item -LiteralPath $Dest -Force
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    cmd /c rmdir "$Dest"
  } else {
    Remove-Item -LiteralPath $Dest -Recurse -Force
  }
  Write-Host "已卸载。DSH 下一次启动将不再发现该 skill。"
  exit 0
}

if ((Test-Path -LiteralPath $Dest) -and -not $Force) {
  throw "目标已存在：$Dest。加 -Force 覆盖，或先运行 -Uninstall。"
}

Write-Step "安装到 $Dest"
New-Item -ItemType Directory -Force -Path $SkillsRoot | Out-Null
if (Test-Path -LiteralPath $Dest) {
  $backup = "$Dest.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
  Write-Warn "已有目录，备份到 $backup"
  Move-Item -LiteralPath $Dest -Destination $backup
}

$linked = $false
if ($Link) {
  try {
    New-Item -ItemType Junction -Path $Dest -Target $SkillDir | Out-Null
    $linked = $true
    Write-Host "已创建目录联接（源更新即时生效）：$Dest -> $SkillDir"
  } catch {
    Write-Warn "目录联接失败（$($_.Exception.Message)），改为复制。"
  }
}
if (-not $linked) {
  Copy-Item -LiteralPath $SkillDir -Destination $Dest -Recurse -Force
  Write-Host "已复制 skill 文件。"
}

$skillMd = Join-Path $Dest 'SKILL.md'
if (-not (Test-Path -LiteralPath $skillMd)) { throw "安装后缺少 SKILL.md：$skillMd" }
Write-Host ""
Write-Host "完成。重启 DSH 后，在输入框输入 / 应能看到 xian-optimizer。" -ForegroundColor Green
Write-Host "如果没出现：确认 DSH_HOME=$DshHome，并检查 $skillMd 的 frontmatter。"
