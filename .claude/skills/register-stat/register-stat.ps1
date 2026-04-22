param([Parameter(Mandatory=$true)][string]$Names)

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

$SCREEN_PROFILE = "d:\Personal Projects\HTML\OuterplaneApp\assets\profiles\precision-craft.json"
$STATS_PATH     = "d:\Personal Projects\HTML\OuterplaneApp\assets\profiles\stat-references.json"

$NAME_NX = 0.7356; $NAME_NW = 0.1191; $NAME_NH = 0.0534
$NAME_NY = @(0.2791, 0.3680, 0.4569, 0.5458)
$PCT_NX  = 0.9254; $PCT_NW  = 0.0161; $PCT_NH  = 0.0260
$PCT_NY  = @(0.2969, 0.3858, 0.4747, 0.5636)
$BINS = 16
$THRESHOLD = 0.9

# --- Histogram (for screen validation) ---
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

# --- Binary mask extraction (extreme contrast: max(R,G,B) > threshold -> 1 else 0) ---
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
  return @($mask)
}

function Invoke-Register {
  $list = $Names.Split(',') | ForEach-Object { $_.Trim() }
  if ($list.Count -ne 4) { "FAIL: Expected 4 names (comma-separated), got $($list.Count)"; return }
  $parsed = @()
  foreach ($n in $list) {
    $hasPct = $false; $base = $n
    if ($n.EndsWith('%')) { $hasPct = $true; $base = $n.Substring(0, $n.Length - 1).TrimEnd() }
    $parsed += [PSCustomObject]@{ base = $base; hasPct = $hasPct; original = $n }
  }

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
  if ($mains.Count -eq 0) { "FAIL: No LDPlayer window"; return }
  if ($mains.Count -gt 1) { "FAIL: Multiple LDPlayer windows ($($mains.Count))"; return }
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
  if ($script:render -eq [IntPtr]::Zero) { "FAIL: No RenderWindow child"; return }

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
  $resized.Save("d:\Personal Projects\HTML\OuterplaneApp\.temp\last-scan.png", [System.Drawing.Imaging.ImageFormat]::Png)
  $resized.Dispose()

  # Screen validation
  $screenJson = [System.IO.File]::ReadAllText($SCREEN_PROFILE, [System.Text.Encoding]::UTF8)
  $screenProfile = $screenJson | ConvertFrom-Json
  $sBins = $screenProfile.histogramFormat.binsPerChannel
  $sThr  = $screenProfile.matching.threshold
  foreach ($roi in $screenProfile.rois) {
    $rx = [int][math]::Round($roi.bbox[0] * $CW)
    $ry = [int][math]::Round($roi.bbox[1] * $CH)
    $rw = [int][math]::Round($roi.bbox[2] * $CW)
    $rh = [int][math]::Round($roi.bbox[3] * $CH)
    $h = Get-Histogram $bytes $stride $rx $ry $rw $rh $sBins
    $s = Compare-Hist $h $roi.histogram
    if ($s -lt $sThr) { "FAIL: Not on precision-craft screen (ROI $($roi.id) score=$([math]::Round($s,4)))"; return }
  }

  # Extract pixel data per option
  $perOpt = @()
  foreach ($i in 0..3) {
    $nrx = [int][math]::Round($NAME_NX * $CW)
    $nry = [int][math]::Round($NAME_NY[$i] * $CH)
    $nrw = [int][math]::Round($NAME_NW * $CW)
    $nrh = [int][math]::Round($NAME_NH * $CH)
    $namePix = Get-RoiBinary $bytes $stride $nrx $nry $nrw $nrh

    $prx = [int][math]::Round($PCT_NX * $CW)
    $pry = [int][math]::Round($PCT_NY[$i] * $CH)
    $prw = [math]::Max(1, [int][math]::Round($PCT_NW * $CW))
    $prh = [math]::Max(1, [int][math]::Round($PCT_NH * $CH))
    $pctPix = Get-RoiBinary $bytes $stride $prx $pry $prw $prh

    $perOpt += [PSCustomObject]@{
      idx = $i + 1
      base = $parsed[$i].base
      hasPct = $parsed[$i].hasPct
      original = $parsed[$i].original
      namePixels = $namePix
      pctPixels = $pctPix
    }
  }

  # Load existing (only row-keyed entries; old format entries ignored)
  $existingStats = @()
  $existingMarkers = @()
  if (Test-Path $STATS_PATH) {
    $txt = [System.IO.File]::ReadAllText($STATS_PATH, [System.Text.Encoding]::UTF8)
    $old = $txt | ConvertFrom-Json
    if ($old.stats) {
      foreach ($s in @($old.stats)) {
        if ($s.mask -and $s.row) { $existingStats += $s }
      }
    }
    if ($old.percentMarkers) {
      foreach ($m in @($old.percentMarkers)) {
        if ($m.mask -and $m.row -and $m.type) { $existingMarkers += $m }
      }
    }
  }

  # Merge stats (keyed by name + row)
  $stats = New-Object System.Collections.Generic.List[object]
  foreach ($s in $existingStats) { $stats.Add($s) | Out-Null }
  $summary = @()
  foreach ($opt in $perOpt) {
    $found = $false
    for ($i = 0; $i -lt $stats.Count; $i++) {
      if ($stats[$i].name -eq $opt.base -and [int]$stats[$i].row -eq $opt.idx) {
        $stats[$i] = [PSCustomObject]@{ name = $opt.base; row = $opt.idx; mask = $opt.namePixels }
        $summary += "  [$($opt.idx)] $($opt.original) -> stat UPDATED ($($opt.base)@row$($opt.idx))"
        $found = $true
        break
      }
    }
    if (-not $found) {
      $stats.Add([PSCustomObject]@{ name = $opt.base; row = $opt.idx; mask = $opt.namePixels }) | Out-Null
      $summary += "  [$($opt.idx)] $($opt.original) -> stat NEW ($($opt.base)@row$($opt.idx))"
    }
  }

  # Merge percent markers (keyed by row + type)
  $markers = New-Object System.Collections.Generic.List[object]
  foreach ($m in $existingMarkers) { $markers.Add($m) | Out-Null }
  $markerSummary = @()
  foreach ($opt in $perOpt) {
    $type = if ($opt.hasPct) { "yes" } else { "no" }
    $found = $false
    for ($i = 0; $i -lt $markers.Count; $i++) {
      if ([int]$markers[$i].row -eq $opt.idx -and $markers[$i].type -eq $type) {
        $markers[$i] = [PSCustomObject]@{ row = $opt.idx; type = $type; mask = $opt.pctPixels }
        $markerSummary += "  pct row$($opt.idx)/$type UPDATED"
        $found = $true
        break
      }
    }
    if (-not $found) {
      $markers.Add([PSCustomObject]@{ row = $opt.idx; type = $type; mask = $opt.pctPixels }) | Out-Null
      $markerSummary += "  pct row$($opt.idx)/$type NEW"
    }
  }

  $out = [ordered]@{
    name = "stat-references"
    canonicalSize = [ordered]@{ width = $CW; height = $CH }
    rois = [ordered]@{
      name    = [ordered]@{ nx = $NAME_NX; nw = $NAME_NW; nh = $NAME_NH; ny = $NAME_NY }
      percent = [ordered]@{ nx = $PCT_NX;  nw = $PCT_NW;  nh = $PCT_NH;  ny = $PCT_NY }
    }
    storage = [ordered]@{ type = "binary-mask"; threshold = 128; keyedBy = "row" }
    matching = [ordered]@{ metric = "iou"; threshold = $THRESHOLD }
    stats = @($stats.ToArray())
    percentMarkers = @($markers.ToArray())
  }

  $json = $out | ConvertTo-Json -Depth 20 -Compress
  [System.IO.File]::WriteAllText($STATS_PATH, $json, [System.Text.UTF8Encoding]::new($false))

  "Registered 4 options to $STATS_PATH"
  $summary | ForEach-Object { $_ }
  $markerSummary | ForEach-Object { $_ }
  $uniqueNames = ($stats.ToArray() | ForEach-Object { $_.name } | Sort-Object -Unique).Count
  "  total stat entries: $($stats.Count) ($uniqueNames unique names)"
  "  total percent markers: $($markers.Count)"
  "  file size: $([math]::Round((Get-Item $STATS_PATH).Length / 1024, 1)) KB"
}

Invoke-Register
