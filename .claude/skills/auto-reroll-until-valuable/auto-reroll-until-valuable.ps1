Add-Type -AssemblyName System.Drawing
Add-Type -Namespace W -Name U -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool SetProcessDPIAware();
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool GetWindowRect(System.IntPtr hWnd, out System.Drawing.Rectangle lpRect);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool PrintWindow(System.IntPtr hwnd, System.IntPtr hdcBlt, uint nFlags);
[System.Runtime.InteropServices.DllImport("user32.dll", CharSet=System.Runtime.InteropServices.CharSet.Unicode)]
public static extern int GetClassName(System.IntPtr hWnd, System.Text.StringBuilder lpClassName, int nMaxCount);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool IsWindowVisible(System.IntPtr hWnd);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool PostMessage(System.IntPtr hWnd, uint Msg, System.IntPtr wParam, System.IntPtr lParam);
public delegate bool EnumWindowsProc(System.IntPtr hWnd, System.IntPtr lParam);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, System.IntPtr lParam);
public delegate bool EnumChildProc(System.IntPtr hWnd, System.IntPtr lParam);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool EnumChildWindows(System.IntPtr hWndParent, EnumChildProc lpEnumFunc, System.IntPtr lParam);
'@ -ReferencedAssemblies System.Drawing

if (-not ([System.Management.Automation.PSTypeName]'MaskSim').Type) {
  Add-Type -TypeDefinition @'
public static class MaskSim {
  public static double IoU(int[] a, int[] b) {
    if (a == null || b == null || a.Length != b.Length || a.Length == 0) return 0.0;
    long inter = 0, uni = 0;
    for (int i = 0; i < a.Length; i++) {
      int av = a[i], bv = b[i];
      bool aOn = av != 0, bOn = bv != 0;
      if (aOn && bOn) inter++;
      if (aOn || bOn) uni++;
    }
    return uni == 0 ? 1.0 : ((double)inter) / ((double)uni);
  }
}
'@
}

[W.U]::SetProcessDPIAware() | Out-Null

# --- Config ---
$MAX_ITER = 100

# Valuable stat set loaded from config.json (external UTF-8 JSON to avoid PS 5.1
# CP949 parse corruption of Korean string literals inside .ps1 source files)
$REPO_ROOT   = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$CONFIG_PATH = Join-Path $PSScriptRoot "config.json"
$configJson = [System.IO.File]::ReadAllText($CONFIG_PATH, [System.Text.Encoding]::UTF8)
$configObj = $configJson | ConvertFrom-Json
$VALUABLE = @($configObj.valuable)
$ASSUMED_HIT_RATE = [double]$configObj.assumedHitRate
if ($ASSUMED_HIT_RATE -le 0 -or $ASSUMED_HIT_RATE -ge 1) { $ASSUMED_HIT_RATE = 0.02 }

# Cumulative state — attempts & hits across all script invocations. Used for
# luck percentile via geometric-distribution survival function P(streak >= N).
$STATE_PATH = Join-Path $REPO_ROOT ".temp\auto-reroll-state.json"

# Reroll click target (normalized within RenderWindow) — from reroll-option.ps1
$CLICK_NX = 0.6045
$CLICK_NY = 0.9207

# Adaptive settle: skip fixed 3s wait. Poll after click for actual stabilization.
#   MIN_MS = don't bother polling before this (game never responds faster)
#   POLL_MS = interval between polls after MIN_MS
#   MAX_MS = safety cap — if no stable state detected, give up and take what we have
$SETTLE_MIN_MS  = 1200
$SETTLE_POLL_MS = 200
$SETTLE_MAX_MS  = 3500

# Click WM_LBUTTONDOWN -> WM_LBUTTONUP gap (ms)
$CLICK_GAP_MS = 10

# Paths
$SCREEN_PROFILE = Join-Path $REPO_ROOT "assets\profiles\precision-craft.json"
$STATS_PATH     = Join-Path $REPO_ROOT "assets\profiles\stat-references.json"
$LAST_SCAN_PATH = Join-Path $REPO_ROOT ".temp\last-scan.png"

# Stat ROI defaults (fallback if stat-references.json is missing/empty)
$DEFAULT_NAME_NX = 0.7356; $DEFAULT_NAME_NW = 0.1191; $DEFAULT_NAME_NH = 0.0534
$DEFAULT_NAME_NY = @(0.2791, 0.3680, 0.4569, 0.5458)
$DEFAULT_PCT_NX  = 0.9254; $DEFAULT_PCT_NW  = 0.0161; $DEFAULT_PCT_NH  = 0.0260
$DEFAULT_PCT_NY  = @(0.2969, 0.3858, 0.4747, 0.5636)

$MIN_CONF = 0.75
$MIN_MARGIN = 0.10

# Pct marker "yes" requires absolute IoU >= this. The % glyph is visually
# distinctive; a real yes gives ~0.95+. Non-% areas (digits like "120", "6")
# score ~0.30 against the yes mask. The "no" mask is captured from arbitrary
# digits and generalizes poorly, so argmax between yes/no produces false
# positives when both scores are low. Default to "no" unless yes evidence
# is strong — losing a rare true yes is survivable; a false yes flips the
# row into a wrong valuable bucket.
$MIN_PCT_YES_CONF = 0.6

# Rank ROI layout (normalized, To-Be panel) — from read-rank.ps1
$RANK_OPTION_NY  = @(0.3365, 0.4254, 0.5144, 0.6033)
$RANK_SEGMENT_NX = @(0.7387, 0.7902, 0.8417, 0.8924)
$RANK_SEGMENT_NW = 0.0453
$RANK_SEGMENT_NH = 0.0055
$RANK_FILL_MIN_R = 150
$RANK_FILL_R_MINUS_B = 40

# Cached refs — populated once by Initialize-Refs at start of main loop
$script:screenProfile = $null
$script:statRefs = $null

# In-memory mirror of $STATE_PATH — loaded at start, mutated per iter, saved at exit.
$script:state = $null

# --- Helpers: histograms / masks ---
function Bhat {
  param([double[]]$a, [double[]]$b)
  $sum = 0.0
  for ($i = 0; $i -lt $a.Length; $i++) {
    $p = $a[$i] * $b[$i]
    if ($p -gt 0) { $sum += [math]::Sqrt($p) }
  }
  if ($sum -gt 1.0) { $sum = 1.0 }
  return $sum
}

function Get-Histogram {
  param($buf, [int]$stride, [int]$rx, [int]$ry, [int]$rw, [int]$rh, [int]$bins)
  $hR = New-Object double[] $bins
  $hG = New-Object double[] $bins
  $hB = New-Object double[] $bins
  $total = $rw * $rh
  for ($y = $ry; $y -lt ($ry + $rh); $y++) {
    $row = $y * $stride
    for ($x = $rx; $x -lt ($rx + $rw); $x++) {
      $i = $row + $x * 4
      $hR[[int]([math]::Floor($buf[$i + 2] * $bins / 256))]++
      $hG[[int]([math]::Floor($buf[$i + 1] * $bins / 256))]++
      $hB[[int]([math]::Floor($buf[$i] * $bins / 256))]++
    }
  }
  for ($k = 0; $k -lt $bins; $k++) { $hR[$k] /= $total; $hG[$k] /= $total; $hB[$k] /= $total }
  return [PSCustomObject]@{ r = @($hR); g = @($hG); b = @($hB) }
}

function Compare-Hist {
  param($h1, $h2)
  return ((Bhat $h1.r ([double[]]$h2.r)) + (Bhat $h1.g ([double[]]$h2.g)) + (Bhat $h1.b ([double[]]$h2.b))) / 3
}

function Get-RoiBinary {
  param($buf, [int]$stride, [int]$rx, [int]$ry, [int]$rw, [int]$rh, [int]$thr = 128)
  $mask = New-Object int[] ($rw * $rh)
  $p = 0
  for ($y = $ry; $y -lt ($ry + $rh); $y++) {
    $row = $y * $stride
    for ($x = $rx; $x -lt ($rx + $rw); $x++) {
      $i = $row + $x * 4
      if ($buf[$i] -gt $thr -or $buf[$i + 1] -gt $thr -or $buf[$i + 2] -gt $thr) { $mask[$p] = 1 }
      $p++
    }
  }
  return $mask
}

# --- Window discovery ---
function Find-RenderWindow {
  $mains = New-Object System.Collections.Generic.List[IntPtr]
  $script:mains = $mains
  $cbM = [W.U+EnumWindowsProc]{
    param($h, $l)
    if (-not [W.U]::IsWindowVisible($h)) { return $true }
    $sb = New-Object System.Text.StringBuilder 64
    [W.U]::GetClassName($h, $sb, 64) | Out-Null
    if ($sb.ToString() -eq "LDPlayerMainFrame") { $script:mains.Add($h) }
    return $true
  }
  [W.U]::EnumWindows($cbM, [IntPtr]::Zero) | Out-Null
  if ($mains.Count -eq 0) { return @{ err = "FAIL: No LDPlayer window" } }
  if ($mains.Count -gt 1) { return @{ err = "FAIL: Multiple LDPlayer windows ($($mains.Count))" } }
  $main = $mains[0]

  $script:render = [IntPtr]::Zero
  $cbC = [W.U+EnumChildProc]{
    param($h, $l)
    $sb = New-Object System.Text.StringBuilder 64
    [W.U]::GetClassName($h, $sb, 64) | Out-Null
    if ($sb.ToString() -eq "RenderWindow") { $script:render = $h; return $false }
    return $true
  }
  [W.U]::EnumChildWindows($main, $cbC, [IntPtr]::Zero) | Out-Null
  if ($script:render -eq [IntPtr]::Zero) { return @{ err = "FAIL: No RenderWindow child" } }
  return @{ render = $script:render }
}

# Load screen profile + stat refs once into script-scope cache.
# Scan-Stats and Get-CanonicalBuffer read from $script:screenProfile / $script:statRefs
# instead of re-parsing JSON each iteration.
function Initialize-Refs {
  $sjson = [System.IO.File]::ReadAllText($SCREEN_PROFILE, [System.Text.Encoding]::UTF8)
  $script:screenProfile = $sjson | ConvertFrom-Json
  if (-not $script:screenProfile -or -not $script:screenProfile.rois) {
    return "FAIL: Could not load screen profile"
  }
  if (Test-Path $STATS_PATH) {
    $tjson = [System.IO.File]::ReadAllText($STATS_PATH, [System.Text.Encoding]::UTF8)
    $script:statRefs = $tjson | ConvertFrom-Json
  }
  return $null
}

# Load persisted attempt/hit state (or initialize a fresh one).
function Initialize-State {
  if (Test-Path $STATE_PATH) {
    $txt = [System.IO.File]::ReadAllText($STATE_PATH, [System.Text.Encoding]::UTF8)
    $obj = $txt | ConvertFrom-Json
    $script:state = [PSCustomObject]@{
      totalAttempts  = [int]$obj.totalAttempts
      totalHits      = [int]$obj.totalHits
      currentStreak  = [int]$obj.currentStreak
      longestStreak  = [int]$obj.longestStreak
      lastHitAt      = $obj.lastHitAt
    }
  } else {
    $script:state = [PSCustomObject]@{
      totalAttempts = 0; totalHits = 0
      currentStreak = 0; longestStreak = 0
      lastHitAt = $null
    }
  }
}

function Save-State {
  $out = [ordered]@{
    totalAttempts = $script:state.totalAttempts
    totalHits     = $script:state.totalHits
    currentStreak = $script:state.currentStreak
    longestStreak = $script:state.longestStreak
    lastHitAt     = $script:state.lastHitAt
  }
  $json = $out | ConvertTo-Json -Depth 4
  [System.IO.File]::WriteAllText($STATE_PATH, $json, [System.Text.UTF8Encoding]::new($false))
}

function Register-Attempt {
  param([bool]$IsHit)
  $script:state.totalAttempts += 1
  if ($IsHit) {
    $script:state.totalHits += 1
    $script:state.currentStreak = 0
    $script:state.lastHitAt = (Get-Date).ToString('o')
  } else {
    $script:state.currentStreak += 1
    if ($script:state.currentStreak -gt $script:state.longestStreak) {
      $script:state.longestStreak = $script:state.currentStreak
    }
  }
}

# Geometric-distribution luck percentile for the current miss-streak.
# Returns P(streak >= N | p) = (1-p)^N, i.e. the fraction of timelines that
# reach this point without a hit. Smaller = unluckier.
# Formatted as "하위 X.X%" : X% of the player pool is at-or-below your luck.
function Format-LuckLine {
  param([int]$streak, [double]$p)
  if ($streak -le 0) { return "[luck] 현재 streak 0 (직전 hit 또는 첫 시도) — 판정 생략" }
  $pNoHit = [math]::Pow(1.0 - $p, $streak)
  $pct = $pNoHit * 100.0
  $hitBy = (1.0 - $pNoHit) * 100.0
  $pctStr  = $pct.ToString('F2')
  $hitStr  = $hitBy.ToString('F1')
  $pStr    = ($p * 100).ToString('F1')
  return "[luck] p=$pStr% 가정, streak ${streak}: P(여태 0-hit)=$pctStr% -> 하위 $pctStr% 운 (평균적으로 $hitStr% 플레이어는 이미 hit)"
}

# --- Capture + validate screen + return canonical 1280x720 buffer ---
# -SkipSave: don't write last-scan.png this call (used during settle polling to
#   avoid ~40ms PNG encode cost; the final post-settle capture re-writes it).
# -SkipValidation: don't run histogram check (used during settle polling — the
#   screen can't navigate away between captures faster than the poll interval).
function Get-CanonicalBuffer {
  param(
    [IntPtr]$render,
    [switch]$SkipSave,
    [switch]$SkipValidation
  )

  $r = New-Object System.Drawing.Rectangle
  [W.U]::GetWindowRect($render, [ref]$r) | Out-Null
  $renderWidth = $r.Width - $r.X; $renderHeight = $r.Height - $r.Y

  $bmp = New-Object System.Drawing.Bitmap $renderWidth, $renderHeight
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $hdc = $g.GetHdc()
  [W.U]::PrintWindow($render, $hdc, 2) | Out-Null
  $g.ReleaseHdc($hdc); $g.Dispose()

  $CW = 1280; $CH = 720
  $resized = New-Object System.Drawing.Bitmap $CW, $CH
  $g2 = [System.Drawing.Graphics]::FromImage($resized)
  $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
  $g2.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
  $g2.DrawImage($bmp, 0, 0, $CW, $CH)
  $g2.Dispose(); $bmp.Dispose()

  $lr = New-Object System.Drawing.Rectangle(0, 0, $CW, $CH)
  $data = $resized.LockBits($lr, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $stride = $data.Stride
  $bytes = New-Object byte[] ($stride * $CH)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
  $resized.UnlockBits($data)
  if (-not $SkipSave) {
    $resized.Save($LAST_SCAN_PATH, [System.Drawing.Imaging.ImageFormat]::Png)
  }
  $resized.Dispose()

  if (-not $SkipValidation) {
    $sThr = $script:screenProfile.matching.threshold
    foreach ($roi in $script:screenProfile.rois) {
      $rx = [int][math]::Round($roi.bbox[0] * $CW)
      $ry = [int][math]::Round($roi.bbox[1] * $CH)
      $rw = [int][math]::Round($roi.bbox[2] * $CW)
      $rh = [int][math]::Round($roi.bbox[3] * $CH)
      $h = Get-Histogram $bytes $stride $rx $ry $rw $rh $script:screenProfile.histogramFormat.binsPerChannel
      $s = Compare-Hist $h $roi.histogram
      if ($s -lt $sThr) {
        return @{ err = "FAIL: Not on precision-craft screen (ROI $($roi.id) score=$([math]::Round($s,4)))" }
      }
    }
  }

  return @{
    bytes = $bytes; stride = $stride; CW = $CW; CH = $CH
    renderWidth = $renderWidth; renderHeight = $renderHeight
  }
}

# --- Scan stat names per row, return array of 4 display strings + completeness flag ---
function Scan-Stats {
  param($buf)

  $refs = $script:statRefs

  $nameNx = $DEFAULT_NAME_NX; $nameNw = $DEFAULT_NAME_NW; $nameNh = $DEFAULT_NAME_NH
  $nameNy = $DEFAULT_NAME_NY
  $pctNx  = $DEFAULT_PCT_NX;  $pctNw  = $DEFAULT_PCT_NW;  $pctNh  = $DEFAULT_PCT_NH
  $pctNy  = $DEFAULT_PCT_NY
  if ($refs -and $refs.rois) {
    $nameNx = $refs.rois.name.nx; $nameNw = $refs.rois.name.nw; $nameNh = $refs.rois.name.nh
    $nameNy = @($refs.rois.name.ny)
    $pctNx  = $refs.rois.percent.nx; $pctNw  = $refs.rois.percent.nw; $pctNh  = $refs.rois.percent.nh
    $pctNy  = @($refs.rois.percent.ny)
  }

  $CW = $buf.CW; $CH = $buf.CH
  $results = @()

  foreach ($i in 0..3) {
    $nrx = [int][math]::Round($nameNx * $CW)
    $nry = [int][math]::Round($nameNy[$i] * $CH)
    $nrw = [int][math]::Round($nameNw * $CW)
    $nrh = [int][math]::Round($nameNh * $CH)
    $namePix = Get-RoiBinary $buf.bytes $buf.stride $nrx $nry $nrw $nrh

    $prx = [int][math]::Round($pctNx * $CW)
    $pry = [int][math]::Round($pctNy[$i] * $CH)
    $prw = [math]::Max(1, [int][math]::Round($pctNw * $CW))
    $prh = [math]::Max(1, [int][math]::Round($pctNh * $CH))
    $pctPix = Get-RoiBinary $buf.bytes $buf.stride $prx $pry $prw $prh

    $rowNum = $i + 1
    $bestName = $null; $bestNameScore = 0.0; $secondScore = 0.0
    if ($refs -and $refs.stats) {
      foreach ($s in $refs.stats) {
        if (-not $s.mask -or -not $s.row) { continue }
        if ([int]$s.row -ne $rowNum) { continue }
        $sc = [MaskSim]::IoU($namePix, ([int[]]@($s.mask)))
        if ($sc -gt $bestNameScore) {
          $secondScore = $bestNameScore
          $bestNameScore = $sc
          $bestName = $s.name
        } elseif ($sc -gt $secondScore) {
          $secondScore = $sc
        }
      }
    }

    $yesScore = 0.0; $noScore = 0.0
    if ($refs -and $refs.percentMarkers) {
      foreach ($m in $refs.percentMarkers) {
        if (-not $m.mask -or -not $m.row -or -not $m.type) { continue }
        if ([int]$m.row -ne $rowNum) { continue }
        $sc = [MaskSim]::IoU($pctPix, ([int[]]@($m.mask)))
        if ($m.type -eq "yes") { $yesScore = $sc }
        elseif ($m.type -eq "no") { $noScore = $sc }
      }
    }
    # Default to "no"; promote to "yes" only on strong evidence.
    $bestPct = "no"; $bestPctScore = $noScore
    if ($yesScore -ge $MIN_PCT_YES_CONF) {
      $bestPct = "yes"; $bestPctScore = $yesScore
    }

    $nameOk = $bestName -and ($bestNameScore -ge $MIN_CONF) -and (($bestNameScore - $secondScore) -ge $MIN_MARGIN)
    $pctOk  = [bool]$bestPct
    $complete = $nameOk -and $pctOk
    $display = ""
    $canonical = $null
    if ($nameOk -and $pctOk) {
      $canonical = if ($bestPct -eq "yes") { "$bestName%" } else { $bestName }
      $display = $canonical
    } elseif ($nameOk) {
      $display = "$bestName (% UNKNOWN)"
    } elseif ($pctOk) {
      $display = "UNKNOWN (% $bestPct)"
    } else {
      $display = "UNKNOWN"
    }

    $results += [PSCustomObject]@{
      row = $rowNum
      display = $display
      canonical = $canonical
      complete = $complete
      nameScore = $bestNameScore
      pctScore = $bestPctScore
    }
  }
  return $results
}

# --- Scan ranks (0-4 per row, based on yellow segment fill) ---
function Scan-Ranks {
  param($buf)
  $CW = $buf.CW; $CH = $buf.CH
  $ranks = @()
  foreach ($optIdx in 0..3) {
    $ny = $RANK_OPTION_NY[$optIdx]
    $filled = 0
    foreach ($segIdx in 0..3) {
      $nx = $RANK_SEGMENT_NX[$segIdx]
      $rx = [int][math]::Round($nx * $CW)
      $ry = [int][math]::Round($ny * $CH)
      $rw = [int][math]::Round($RANK_SEGMENT_NW * $CW)
      $rh = [math]::Max(1, [int][math]::Round($RANK_SEGMENT_NH * $CH))
      $sumR = 0.0; $sumB = 0.0; $cnt = 0
      for ($y = $ry; $y -lt ($ry + $rh); $y++) {
        $row = $y * $buf.stride
        for ($x = $rx; $x -lt ($rx + $rw); $x++) {
          $i = $row + $x * 4
          $sumB += $buf.bytes[$i]
          $sumR += $buf.bytes[$i + 2]
          $cnt++
        }
      }
      $mR = [int]($sumR / $cnt); $mB = [int]($sumB / $cnt)
      if (($mR -ge $RANK_FILL_MIN_R) -and (($mR - $mB) -ge $RANK_FILL_R_MINUS_B)) { $filled++ }
    }
    $ranks += $filled
  }
  return ,$ranks
}

# --- Decide: valuable pattern match ---
# Pattern A: >= 3 rows satisfy (rank >= 3 AND stat in valuable)  [4th slot is don't-care]
# Pattern B: all 4 valuable AND count(rank>=3) >= 2 AND count(rank>=2) == 4
#            [rank 4 is generously treated as satisfying any "rank >= N" bound]
function Check-Patterns {
  param($stats, $ranks)

  $countA = 0
  for ($i = 0; $i -lt 4; $i++) {
    if ($ranks[$i] -ge 3 -and ($VALUABLE -contains $stats[$i].canonical)) { $countA++ }
  }
  if ($countA -ge 3) { return "A" }

  $ge3 = 0; $ge2 = 0; $allValuable = $true
  for ($i = 0; $i -lt 4; $i++) {
    if ($ranks[$i] -ge 3) { $ge3++ }
    if ($ranks[$i] -ge 2) { $ge2++ }
    if (-not ($VALUABLE -contains $stats[$i].canonical)) { $allValuable = $false }
  }
  if ($allValuable -and $ge3 -ge 2 -and $ge2 -eq 4) { return "B" }

  return $null
}

# --- Send reroll click via PostMessage to RenderWindow ---
function Send-Reroll {
  param([IntPtr]$render, [int]$renderWidth, [int]$renderHeight)
  $clickX = [int][math]::Round($CLICK_NX * $renderWidth)
  $clickY = [int][math]::Round($CLICK_NY * $renderHeight)
  $WM_LBUTTONDOWN = 0x0201
  $WM_LBUTTONUP   = 0x0202
  $MK_LBUTTON = [IntPtr]1
  $lparam = [IntPtr][int](($clickY -shl 16) -bor ($clickX -band 0xFFFF))
  [W.U]::PostMessage($render, $WM_LBUTTONDOWN, $MK_LBUTTON, $lparam) | Out-Null
  Start-Sleep -Milliseconds $CLICK_GAP_MS
  [W.U]::PostMessage($render, $WM_LBUTTONUP, [IntPtr]::Zero, $lparam) | Out-Null
}

# Cheap string fingerprint of the scan — two equal fingerprints mean stats+ranks
# are pixel-identical (in terms of what we measure), i.e. the UI has settled.
function Get-Fingerprint {
  param($stats, $ranks)
  $parts = @()
  for ($i = 0; $i -lt 4; $i++) {
    $parts += "$($stats[$i].display)#$($ranks[$i])"
  }
  return ($parts -join '|')
}

# Adaptive settle: wait MIN_MS, then poll until "changed from pre-click AND same
# as previous poll" (confirms animation ended). Cap at MAX_MS. Returns the last
# scan we have (stats, ranks, buf) along with observed settle latency.
function Wait-ForSettle {
  param([IntPtr]$render, [string]$preFingerprint)

  Start-Sleep -Milliseconds $SETTLE_MIN_MS
  $elapsed = $SETTLE_MIN_MS

  $lastFp = $null
  $lastBuf = $null
  $lastStats = $null
  $lastRanks = $null

  while ($elapsed -lt $SETTLE_MAX_MS) {
    $buf = Get-CanonicalBuffer -render $render -SkipSave -SkipValidation
    if (-not $buf.err) {
      $curStats = Scan-Stats $buf
      $curRanks = Scan-Ranks $buf

      # Junk filter: during the reroll burst/flash animation, all rank bars
      # are obscured and read as 0. Two consecutive burst captures can have
      # identical "UNKNOWN + all-zero" fingerprints, which would falsely
      # settle. A real result has at least one segment filled somewhere.
      $rankSum = 0
      foreach ($r in $curRanks) { $rankSum += $r }
      $isJunk = ($rankSum -eq 0)

      if (-not $isJunk) {
        $curFp = Get-Fingerprint $curStats $curRanks
        # Require: changed from pre-click (reroll actually happened) AND
        #          same as previous poll (UI stopped animating).
        if ($curFp -ne $preFingerprint -and $lastFp -eq $curFp) {
          return @{
            buf = $buf; stats = $curStats; ranks = $curRanks
            settleMs = $elapsed; timedOut = $false
          }
        }
        $lastFp = $curFp
        $lastBuf = $buf
        $lastStats = $curStats
        $lastRanks = $curRanks
      }
    }

    Start-Sleep -Milliseconds $SETTLE_POLL_MS
    $elapsed += $SETTLE_POLL_MS
  }

  # Safety cap hit — take whatever we last captured.
  if (-not $lastBuf) {
    # No successful poll; do one final capture to return something.
    $lastBuf = Get-CanonicalBuffer -render $render -SkipSave -SkipValidation
    $lastStats = Scan-Stats $lastBuf
    $lastRanks = Scan-Ranks $lastBuf
  }
  return @{
    buf = $lastBuf; stats = $lastStats; ranks = $lastRanks
    settleMs = $elapsed; timedOut = $true
  }
}

# --- Main loop ---
function Invoke-AutoReroll {
  $initErr = Initialize-Refs
  if ($initErr) { $initErr; return }
  Initialize-State

  $w = Find-RenderWindow
  if ($w.err) { $w.err; return }
  $render = $w.render
  "[start] RenderWindow HWND: $render; max $MAX_ITER iterations"
  "[start] valuable = {$($VALUABLE -join ', ')}"
  "[start] cumulative: $($script:state.totalAttempts) attempts, $($script:state.totalHits) hits, current streak $($script:state.currentStreak) (longest $($script:state.longestStreak))"
  Format-LuckLine -streak $script:state.currentStreak -p $ASSUMED_HIT_RATE

  # First iter: full capture + validate. Subsequent iters use the buf produced
  # by Wait-ForSettle (which already has fresh stats/ranks for us).
  $buf = Get-CanonicalBuffer -render $render
  if ($buf.err) { $buf.err; return }
  $stats = Scan-Stats $buf
  $ranks = Scan-Ranks $buf

  $totalStart = [System.Diagnostics.Stopwatch]::StartNew()
  $settleTotalMs = 0

  for ($iter = 1; $iter -le $MAX_ITER; $iter++) {
    $statsLine = ($stats | ForEach-Object { $_.display }) -join ' | '
    $ranksLine = $ranks -join ','
    "[$iter/$MAX_ITER] ranks=[$ranksLine] stats=[$statsLine]"

    $anyUnknown = $false
    foreach ($s in $stats) { if (-not $s.complete) { $anyUnknown = $true; break } }
    if ($anyUnknown) {
      # UNKNOWN means we can't judge hit/miss on this state — don't count as attempt.
      Get-CanonicalBuffer -render $render -SkipValidation | Out-Null
      "STOP: UNKNOWN at iteration $iter"
      "  last-scan: $LAST_SCAN_PATH"
      "  total elapsed: $([math]::Round($totalStart.Elapsed.TotalSeconds, 1))s"
      "  cumulative: $($script:state.totalAttempts) attempts, $($script:state.totalHits) hits, current streak $($script:state.currentStreak) (longest $($script:state.longestStreak))"
      Format-LuckLine -streak $script:state.currentStreak -p $ASSUMED_HIT_RATE
      Save-State
      return
    }

    $matched = Check-Patterns $stats $ranks
    Register-Attempt -IsHit ([bool]$matched)

    if ($matched) {
      Get-CanonicalBuffer -render $render -SkipValidation | Out-Null
      "STOP: VALUABLE pattern $matched at iteration $iter"
      "  ranks: [$ranksLine]"
      "  stats: [$statsLine]"
      "  last-scan: $LAST_SCAN_PATH"
      "  total elapsed: $([math]::Round($totalStart.Elapsed.TotalSeconds, 1))s"
      "  cumulative: $($script:state.totalAttempts) attempts, $($script:state.totalHits) hits (streak was $($script:state.longestStreak) at longest, reset to 0)"
      Save-State
      return
    }

    if ($iter -lt $MAX_ITER) {
      $preFp = Get-Fingerprint $stats $ranks
      Send-Reroll -render $render -renderWidth $buf.renderWidth -renderHeight $buf.renderHeight
      $settled = Wait-ForSettle -render $render -preFingerprint $preFp
      $settleTotalMs += $settled.settleMs
      $buf = $settled.buf
      $stats = $settled.stats
      $ranks = $settled.ranks
    }
  }

  Get-CanonicalBuffer -render $render -SkipValidation | Out-Null
  "STOP: LIMIT ($MAX_ITER iterations) reached with no valuable pattern"
  "  last-scan: $LAST_SCAN_PATH"
  "  total elapsed: $([math]::Round($totalStart.Elapsed.TotalSeconds, 1))s  avg settle: $([math]::Round($settleTotalMs / [math]::Max(1, $MAX_ITER - 1)))ms"
  "  cumulative: $($script:state.totalAttempts) attempts, $($script:state.totalHits) hits, current streak $($script:state.currentStreak) (longest $($script:state.longestStreak))"
  Format-LuckLine -streak $script:state.currentStreak -p $ASSUMED_HIT_RATE
  Save-State
}

Invoke-AutoReroll
