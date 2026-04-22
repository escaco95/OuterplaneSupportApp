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

[W.U]::SetProcessDPIAware() | Out-Null

function Invoke-Poc {
  # --- 1. Find exactly one LDPlayer main window ---
  $mains = New-Object System.Collections.Generic.List[IntPtr]
  $cbM = [W.U+EnumWindowsProc]{
    param($h, $l)
    if (-not [W.U]::IsWindowVisible($h)) { return $true }
    $sb = New-Object System.Text.StringBuilder 64
    [W.U]::GetClassName($h, $sb, 64) | Out-Null
    if ($sb.ToString() -eq "LDPlayerMainFrame") { $script:mains.Add($h) }
    return $true
  }
  $script:mains = $mains
  [W.U]::EnumWindows($cbM, [IntPtr]::Zero) | Out-Null

  if ($mains.Count -eq 0) { "FAIL: No LDPlayer window"; return }
  if ($mains.Count -gt 1) { "FAIL: Multiple LDPlayer windows ($($mains.Count)); single instance required"; return }
  $main = $mains[0]
  "[1] LDPlayer main HWND: $main"

  # --- 2. Find RenderWindow child ---
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

  # --- 3. Get render rect (physical pixels, DPI-aware) ---
  $r = New-Object System.Drawing.Rectangle
  [W.U]::GetWindowRect($script:render, [ref]$r) | Out-Null
  $renderLeft = $r.X; $renderTop = $r.Y
  $renderWidth = $r.Width - $r.X; $renderHeight = $r.Height - $r.Y
  "[2] Render rect: ($renderLeft, $renderTop) ${renderWidth}x${renderHeight}"

  # --- 4. Capture render via PrintWindow ---
  $bmp = New-Object System.Drawing.Bitmap $renderWidth, $renderHeight
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $hdc = $g.GetHdc()
  [W.U]::PrintWindow($script:render, $hdc, 2) | Out-Null
  $g.ReleaseHdc($hdc); $g.Dispose()

  # --- 5. Nearest-neighbor resize to 1280x720 (match app algo) ---
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

  # --- 6. Load reference profile (explicit UTF-8 to handle BOM-less Korean) ---
  $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
  $screenProfilePath = Join-Path $repoRoot "assets\profiles\precision-craft.json"
  $jsonText = [System.IO.File]::ReadAllText($screenProfilePath, [System.Text.Encoding]::UTF8)
  $screenProfile = $jsonText | ConvertFrom-Json
  if (-not $screenProfile -or -not $screenProfile.rois) { "FAIL: Could not load profile"; return }
  $bins = $screenProfile.histogramFormat.binsPerChannel
  $threshold = $screenProfile.matching.threshold

  # --- 7. Histogram check per ROI ---
  $allMatch = $true
  foreach ($roi in $screenProfile.rois) {
    $rx = [int][math]::Round($roi.bbox[0] * $CW)
    $ry = [int][math]::Round($roi.bbox[1] * $CH)
    $rw = [int][math]::Round($roi.bbox[2] * $CW)
    $rh = [int][math]::Round($roi.bbox[3] * $CH)
    $hR = New-Object double[] $bins
    $hG = New-Object double[] $bins
    $hB = New-Object double[] $bins
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

    $refR = [double[]]$roi.histogram.r
    $refG = [double[]]$roi.histogram.g
    $refB = [double[]]$roi.histogram.b

    $score = (Corr $hR $refR) + (Corr $hG $refG) + (Corr $hB $refB)
    $score /= 3
    $pass = $score -ge $threshold
    if (-not $pass) { $allMatch = $false }
    "  ROI [$($roi.id)] score=$([math]::Round($score, 4)) $(if ($pass) {'PASS'} else {'FAIL'})"
  }

  if (-not $allMatch) { "[3] FAIL: Not on 정밀 제작 screen"; return }
  "[3] OK: On 정밀 제작 screen"

  # --- 8. Compute reroll ROI center (client coords within RenderWindow) ---
  $cNx = 0.6045; $cNy = 0.9207
  $clickX = [int][math]::Round($cNx * $renderWidth)
  $clickY = [int][math]::Round($cNy * $renderHeight)
  "[4] Click target (client): ($clickX, $clickY)"

  # --- 9. PostMessage WM_LBUTTONDOWN + WM_LBUTTONUP (no cursor movement) ---
  $WM_LBUTTONDOWN = 0x0201
  $WM_LBUTTONUP = 0x0202
  $MK_LBUTTON = [IntPtr]1
  $lparam = [IntPtr][int](($clickY -shl 16) -bor ($clickX -band 0xFFFF))
  [W.U]::PostMessage($script:render, $WM_LBUTTONDOWN, $MK_LBUTTON, $lparam) | Out-Null
  Start-Sleep -Milliseconds 30
  [W.U]::PostMessage($script:render, $WM_LBUTTONUP, [IntPtr]::Zero, $lparam) | Out-Null
  "[5] Click sent; waiting for reroll animation to settle..."
  # Game needs ~3s for network + change animation (fade-in of new preview values)
  # before preview is fully static. Wait here so any subsequent scan sees
  # post-reroll steady state, not mid-animation blur.
  Start-Sleep -Milliseconds 3000
  "[6] DONE: reroll settled"
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
