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
public delegate bool EnumWindowsProc(System.IntPtr hWnd, System.IntPtr lParam);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, System.IntPtr lParam);
public delegate bool EnumChildProc(System.IntPtr hWnd, System.IntPtr lParam);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool EnumChildWindows(System.IntPtr hWndParent, EnumChildProc lpEnumFunc, System.IntPtr lParam);
'@ -ReferencedAssemblies System.Drawing

[W.U]::SetProcessDPIAware() | Out-Null

# Fast binary-mask IoU (intersection over union) — compiled C#.
# Asymmetric-friendly by construction: black-black matches contribute 0
# to both intersection and union; only white-presence drives the score.
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

$REPO_ROOT      = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$SCREEN_PROFILE = Join-Path $REPO_ROOT "assets\profiles\precision-craft.json"
$STATS_PATH     = Join-Path $REPO_ROOT "assets\profiles\stat-references.json"
$LAST_SCAN_PATH = Join-Path $REPO_ROOT ".temp\last-scan.png"

$DEFAULT_NAME_NX = 0.7356; $DEFAULT_NAME_NW = 0.1191; $DEFAULT_NAME_NH = 0.0534
$DEFAULT_NAME_NY = @(0.2791, 0.3680, 0.4569, 0.5458)
$DEFAULT_PCT_NX  = 0.9254; $DEFAULT_PCT_NW  = 0.0161; $DEFAULT_PCT_NH  = 0.0260
$DEFAULT_PCT_NY  = @(0.2969, 0.3858, 0.4747, 0.5636)

# --- Histogram (for screen validation only) ---
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

# --- Binary mask extraction (extreme contrast via threshold) ---
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

function Get-CanonicalBuffer {
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
  if ($mains.Count -eq 0) { "FAIL: No LDPlayer window"; return $null }
  if ($mains.Count -gt 1) { "FAIL: Multiple LDPlayer windows ($($mains.Count))"; return $null }
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
  if ($script:render -eq [IntPtr]::Zero) { "FAIL: No RenderWindow child"; return $null }

  $r = New-Object System.Drawing.Rectangle
  [W.U]::GetWindowRect($script:render, [ref]$r) | Out-Null
  $renderWidth = $r.Width - $r.X; $renderHeight = $r.Height - $r.Y

  $bmp = New-Object System.Drawing.Bitmap $renderWidth, $renderHeight
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $hdc = $g.GetHdc()
  [W.U]::PrintWindow($script:render, $hdc, 2) | Out-Null
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
  # Save canonical capture for visual verification
  $lastScanDir = [System.IO.Path]::GetDirectoryName($LAST_SCAN_PATH)
  if ($lastScanDir -and -not (Test-Path $lastScanDir)) { New-Item -ItemType Directory -Path $lastScanDir -Force | Out-Null }
  $resized.Save($LAST_SCAN_PATH, [System.Drawing.Imaging.ImageFormat]::Png)
  $resized.Dispose()

  $screenJson = [System.IO.File]::ReadAllText($SCREEN_PROFILE, [System.Text.Encoding]::UTF8)
  $screenProfile = $screenJson | ConvertFrom-Json
  if (-not $screenProfile -or -not $screenProfile.rois) { "FAIL: Could not load screen profile"; return $null }
  $sBins = $screenProfile.histogramFormat.binsPerChannel
  $sThr  = $screenProfile.matching.threshold
  foreach ($roi in $screenProfile.rois) {
    $rx = [int][math]::Round($roi.bbox[0] * $CW)
    $ry = [int][math]::Round($roi.bbox[1] * $CH)
    $rw = [int][math]::Round($roi.bbox[2] * $CW)
    $rh = [int][math]::Round($roi.bbox[3] * $CH)
    $h = Get-Histogram $bytes $stride $rx $ry $rw $rh $sBins
    $s = Compare-Hist $h $roi.histogram
    if ($s -lt $sThr) { "FAIL: Not on precision-craft screen (ROI $($roi.id) score=$([math]::Round($s,4)))"; return $null }
  }
  return @{ bytes = $bytes; stride = $stride; CW = $CW; CH = $CH }
}

function Invoke-Poc {
  $buf = Get-CanonicalBuffer
  if (-not $buf) { return }

  $refs = $null
  if (Test-Path $STATS_PATH) {
    $txt = [System.IO.File]::ReadAllText($STATS_PATH, [System.Text.Encoding]::UTF8)
    $refs = $txt | ConvertFrom-Json
  }

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
    $bestName = $null; $bestNameScore = 0.0
    $secondScore = 0.0
    $allScores = @()
    if ($refs -and $refs.stats) {
      foreach ($s in $refs.stats) {
        if (-not $s.mask -or -not $s.row) { continue }
        if ([int]$s.row -ne $rowNum) { continue }
        $ref = [int[]]@($s.mask)
        $sc = [MaskSim]::IoU($namePix, $ref)
        $allScores += "$($s.name)=$([math]::Round($sc,4))"
        if ($sc -gt $bestNameScore) {
          $secondScore = $bestNameScore
          $bestNameScore = $sc
          $bestName = $s.name
        } elseif ($sc -gt $secondScore) {
          $secondScore = $sc
        }
      }
    }

    $bestPct = $null; $bestPctScore = 0.0
    if ($refs -and $refs.percentMarkers) {
      foreach ($m in $refs.percentMarkers) {
        if (-not $m.mask -or -not $m.row -or -not $m.type) { continue }
        if ([int]$m.row -ne $rowNum) { continue }
        $sc = [MaskSim]::IoU($pctPix, [int[]]@($m.mask))
        if ($sc -gt $bestPctScore) { $bestPctScore = $sc; $bestPct = $m.type }
      }
    }

    # Name: margin-based (multi-class), per-row references (no alignment noise)
    #   Accept if best >= MIN_CONF AND (best - second) >= MIN_MARGIN
    # Percent: relative max only (binary yes/no)
    $MIN_CONF = 0.75
    $MIN_MARGIN = 0.10
    $nameOk = $bestName -and ($bestNameScore -ge $MIN_CONF) -and (($bestNameScore - $secondScore) -ge $MIN_MARGIN)
    $pctOk  = [bool]$bestPct
    $final = ""
    if ($nameOk -and $pctOk) {
      $final = if ($bestPct -eq "yes") { "$bestName%" } else { $bestName }
    } elseif ($nameOk) {
      $final = "$bestName (% UNKNOWN)"
    } elseif ($pctOk) {
      $final = "UNKNOWN (% $bestPct)"
    } else {
      $final = "UNKNOWN"
    }

    $nameDbg = if ($bestName) { "$bestName/$([math]::Round($bestNameScore,3))" } else { "n/a" }
    $pctDbg  = if ($bestPct)  { "$bestPct/$([math]::Round($bestPctScore,3))"  } else { "n/a" }
    "Option $($i+1): $final  (name=$nameDbg, pct=$pctDbg)"
    if ($allScores.Count -gt 0) {
      "  all name scores: $($allScores -join ', ')"
    }
  }

  if (-not $refs -or -not $refs.stats -or @($refs.stats).Count -eq 0) {
    ""
    "[note] stat-references.json is empty or missing. Use register-stat skill to seed."
  }
}

Invoke-Poc
