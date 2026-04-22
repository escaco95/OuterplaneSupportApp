param(
  # Either of these two must be provided:
  [string]$AppId,                           # e.g. "com.smilegate.outerplane.stove.google"
  [string]$IconUrl,                         # e.g. "https://play-lh.googleusercontent.com/<token>"

  [string]$OutputPath = "d:\Personal Projects\HTML\OuterplaneApp\assets\icon.ico",
  [double]$CornerRadiusRatio = 0.22,        # 22% of side — matches Android 13/iOS-ish corner
  [int]$SourceSize = 512                    # Play CDN serves on-demand at requested size
)

# ICO target sizes. Multi-entry ICO so Explorer/taskbar/Start picks the right
# resolution — downscales below 24px end up mushy if we only ship large sizes.
$TARGET_SIZES = @(16, 24, 32, 48, 64, 128, 256)

Add-Type -AssemblyName System.Drawing
# Note: Drawing2D types (GraphicsPath etc.) live in System.Drawing.dll — no
# separate assembly to load. PS 5.1 errors if we try.

if (-not $AppId -and -not $IconUrl) {
  "FAIL: Supply -AppId <play-store-package> or -IconUrl <direct-url>"
  exit 1
}

function Resolve-IconUrl {
  param([string]$AppId)
  $url = "https://play.google.com/store/apps/details?id=$AppId&hl=en_US"
  # Older TLS defaults cause Play Store handshake failure on stock PS 5.1.
  [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
  try {
    $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 20
  } catch {
    "FAIL: Fetch app page failed: $($_.Exception.Message)"
    exit 1
  }
  # First play-lh image is the app icon in every Play Store layout we've seen.
  # Different app-detail tabs stitch screenshots in later, but the page-header
  # icon is always first in DOM order.
  $m = [regex]::Match($resp.Content, 'https://play-lh\.googleusercontent\.com/[A-Za-z0-9_\-]+')
  if (-not $m.Success) {
    "FAIL: Could not locate app icon URL on the Play Store page"
    exit 1
  }
  return $m.Value
}

# 1. Resolve icon URL
if (-not $IconUrl) {
  $IconUrl = Resolve-IconUrl -AppId $AppId
  "[1] Resolved icon URL: $IconUrl"
} else {
  "[1] Using provided icon URL: $IconUrl"
}

# 2. Download at requested source size (Google's image CDN honors =s<n>)
$sep = if ($IconUrl.Contains('=')) { "-" } else { "=" }
$pngUrl = "$IconUrl${sep}s$SourceSize"
# Some URLs already have =w*-h* suffix; replace with plain =s<size>.
if ($IconUrl -match '=') {
  $pngUrl = ($IconUrl -replace '=.*$', '') + "=s$SourceSize"
}
$tmpPng = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), ([System.IO.Path]::GetRandomFileName() + ".png"))
try {
  Invoke-WebRequest -Uri $pngUrl -OutFile $tmpPng -UseBasicParsing -TimeoutSec 20
} catch {
  "FAIL: Download failed: $($_.Exception.Message)"
  exit 1
}
"[2] Downloaded $(([System.IO.FileInfo]$tmpPng).Length) bytes -> $tmpPng"

# 3. Load source, build per-size rounded-rect-clipped PNGs in memory
$src = [System.Drawing.Bitmap]::new($tmpPng)
"[3] Source bitmap: $($src.Width)x$($src.Height)"

$pngBufs = New-Object 'System.Collections.Generic.List[byte[]]'
foreach ($sz in $TARGET_SIZES) {
  $bmp = New-Object System.Drawing.Bitmap $sz, $sz
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  # Rounded-rect path. Four 90-deg arcs at the corners + auto-closed edges.
  $r = [int]([math]::Max(1, [math]::Round($sz * $CornerRadiusRatio)))
  $d = $r * 2
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc(0, 0, $d, $d, 180, 90)
  $path.AddArc($sz - $d, 0, $d, $d, 270, 90)
  $path.AddArc($sz - $d, $sz - $d, $d, $d, 0, 90)
  $path.AddArc(0, $sz - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  $g.SetClip($path)
  $g.DrawImage($src, (New-Object System.Drawing.Rectangle 0, 0, $sz, $sz))
  $g.Dispose()
  $path.Dispose()

  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngBufs.Add($ms.ToArray()) | Out-Null
  $bmp.Dispose()
  $ms.Dispose()
}
$src.Dispose()
Remove-Item $tmpPng -ErrorAction SilentlyContinue

# 4. Assemble ICO file (header + per-image entries + PNG blobs)
# Per Wikipedia "ICO file format": entries are 16B each, width/height stored
# as 1 byte (0 means 256). PNG payloads embedded as-is (supported Vista+).
$n = $TARGET_SIZES.Count
$stream = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($stream)
$bw.Write([uint16]0)    # Reserved
$bw.Write([uint16]1)    # Type = ICO
$bw.Write([uint16]$n)   # Image count

# Data starts after header (6B) + entry table (16B * n)
$offset = 6 + 16 * $n
for ($i = 0; $i -lt $n; $i++) {
  $sz = $TARGET_SIZES[$i]
  $data = $pngBufs[$i]
  $dim = if ($sz -ge 256) { 0 } else { $sz }  # 0 == 256 per spec
  $bw.Write([byte]$dim)                        # Width
  $bw.Write([byte]$dim)                        # Height
  $bw.Write([byte]0)                           # Palette entries (0 = none)
  $bw.Write([byte]0)                           # Reserved
  $bw.Write([uint16]1)                         # Color planes
  $bw.Write([uint16]32)                        # Bits per pixel
  $bw.Write([uint32]$data.Length)              # Data size
  $bw.Write([uint32]$offset)                   # Data offset from file start
  $offset += $data.Length
}
for ($i = 0; $i -lt $n; $i++) {
  $bw.Write($pngBufs[$i])
}
$bw.Flush()

# Ensure output directory exists.
$outDir = [System.IO.Path]::GetDirectoryName($OutputPath)
if ($outDir -and -not (Test-Path $outDir)) {
  New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}
[System.IO.File]::WriteAllBytes($OutputPath, $stream.ToArray())
$bw.Dispose()
$stream.Dispose()

"[4] Wrote $OutputPath ($n sizes, $offset bytes)"
"[DONE] Corner radius: $([math]::Round($CornerRadiusRatio * 100))% per side"
