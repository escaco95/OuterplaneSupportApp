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

# ---- Segment ROI layout (normalized, right panel "변경 서브 옵션") ----
$OPTION_NY = @(0.3365, 0.4254, 0.5144, 0.6033)
$SEGMENT_NX = @(0.7387, 0.7902, 0.8417, 0.8924)
$SEGMENT_NW = 0.0453
$SEGMENT_NH = 0.0055

# Yellow-fill detection threshold (tune if needed)
$FILL_MIN_R = 150
$FILL_R_MINUS_B = 40

function Invoke-Poc {
  # --- 1. Find exactly one LDPlayer main window ---
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

  # --- 2. Find RenderWindow ---
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

  # --- 3. Get render rect ---
  $r = New-Object System.Drawing.Rectangle
  [W.U]::GetWindowRect($script:render, [ref]$r) | Out-Null
  $renderWidth = $r.Width - $r.X; $renderHeight = $r.Height - $r.Y

  # --- 4. Capture + resize to 1280x720 (nearest) ---
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
  $script:stride = $data.Stride
  $script:bytes = New-Object byte[] ($script:stride * $CH)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $script:bytes, 0, $script:bytes.Length)
  $resized.UnlockBits($data); $resized.Dispose()

  # --- 5. Screen validation (histogram check) ---
  $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
  $profilePath = Join-Path $repoRoot "assets\profiles\precision-craft.json"
  $jsonText = [System.IO.File]::ReadAllText($profilePath, [System.Text.Encoding]::UTF8)
  $screenProfile = $jsonText | ConvertFrom-Json
  if (-not $screenProfile -or -not $screenProfile.rois) { "FAIL: Could not load profile"; return }
  $bins = $screenProfile.histogramFormat.binsPerChannel
  $threshold = $screenProfile.matching.threshold

  $allMatch = $true
  foreach ($roi in $screenProfile.rois) {
    $rx = [int][math]::Round($roi.bbox[0] * $CW)
    $ry = [int][math]::Round($roi.bbox[1] * $CH)
    $rw = [int][math]::Round($roi.bbox[2] * $CW)
    $rh = [int][math]::Round($roi.bbox[3] * $CH)
    $hR = New-Object double[] $bins; $hG = New-Object double[] $bins; $hB = New-Object double[] $bins
    $total = $rw * $rh
    for ($y = $ry; $y -lt ($ry + $rh); $y++) {
      $row = $y * $script:stride
      for ($x = $rx; $x -lt ($rx + $rw); $x++) {
        $i = $row + $x * 4
        $hR[[int]([math]::Floor($script:bytes[$i + 2] * $bins / 256))]++
        $hG[[int]([math]::Floor($script:bytes[$i + 1] * $bins / 256))]++
        $hB[[int]([math]::Floor($script:bytes[$i] * $bins / 256))]++
      }
    }
    for ($k = 0; $k -lt $bins; $k++) { $hR[$k] /= $total; $hG[$k] /= $total; $hB[$k] /= $total }
    $score = ((Corr $hR ([double[]]$roi.histogram.r)) + (Corr $hG ([double[]]$roi.histogram.g)) + (Corr $hB ([double[]]$roi.histogram.b))) / 3
    if ($score -lt $threshold) { $allMatch = $false }
  }
  if (-not $allMatch) { "FAIL: Not on 정밀 제작 screen"; return }

  # --- 6. Read 16 segments, compute fill per option ---
  $totalFilled = 0
  foreach ($optIdx in 0..3) {
    $ny = $OPTION_NY[$optIdx]
    $bits = ""
    $filled = 0
    $debug = @()
    foreach ($segIdx in 0..3) {
      $nx = $SEGMENT_NX[$segIdx]
      $rx = [int][math]::Round($nx * $CW)
      $ry = [int][math]::Round($ny * $CH)
      $rw = [int][math]::Round($SEGMENT_NW * $CW)
      $rh = [math]::Max(1, [int][math]::Round($SEGMENT_NH * $CH))
      $sumR = 0.0; $sumG = 0.0; $sumB = 0.0
      $cnt = 0
      for ($y = $ry; $y -lt ($ry + $rh); $y++) {
        $row = $y * $script:stride
        for ($x = $rx; $x -lt ($rx + $rw); $x++) {
          $i = $row + $x * 4
          $sumB += $script:bytes[$i]
          $sumG += $script:bytes[$i + 1]
          $sumR += $script:bytes[$i + 2]
          $cnt++
        }
      }
      $mR = [int]($sumR / $cnt); $mG = [int]($sumG / $cnt); $mB = [int]($sumB / $cnt)
      $isFilled = ($mR -ge $FILL_MIN_R) -and (($mR - $mB) -ge $FILL_R_MINUS_B)
      if ($isFilled) { $filled++; $bits += "#" } else { $bits += "." }
      $debug += "seg$($segIdx+1) RGB($mR,$mG,$mB)$(if ($isFilled) {'*'} else {''})"
    }
    $totalFilled += $filled
    $maxMark = if ($filled -eq 4) { "  MAX" } else { "" }
    "Option $($optIdx+1): $bits ($filled/4)$maxMark"
    "  debug: $($debug -join '  ')"
  }
  ""
  "Total: $totalFilled/16"
}

function Corr {
  param([double[]]$a, [double[]]$b)
  $n = $a.Length
  $ma = 0.0; $mb = 0.0
  for ($i = 0; $i -lt $n; $i++) { $ma += $a[$i]; $mb += $b[$i] }
  $ma /= $n; $mb /= $n
  $num = 0.0; $da = 0.0; $db = 0.0
  for ($i = 0; $i -lt $n; $i++) {
    $xa = $a[$i] - $ma; $xb = $b[$i] - $mb
    $num += $xa * $xb; $da += $xa * $xa; $db += $xb * $xb
  }
  if ($da -eq 0.0 -and $db -eq 0.0) { return 1.0 }
  if ($da -eq 0.0 -or $db -eq 0.0) { return 0.0 }
  return $num / [math]::Sqrt($da * $db)
}

Invoke-Poc
