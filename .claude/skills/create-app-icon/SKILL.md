---
name: create-app-icon
description: Google Play Store 앱 페이지에서 공식 아이콘 이미지를 다운로드하고, 둥근 사각형으로 clip 하여 Windows exe 용 multi-size `.ico` 로 변환. 앱 패키지 ID 또는 아이콘 URL 직접 지정 가능. Android 13 / iOS 스타일 22% corner radius 기본. **Idempotent** — 생성된 바이트가 기존 `assets/icon.ico` 와 동일하면 파일을 건드리지 않고 `[RESULT] unchanged` 를 출력. Use when the user wants to refresh the app's Windows icon from the official Play Store listing — examples "아이콘 새로 받아줘", "아이콘 갱신", "refresh app icon", "make rounded icon".
---

# create-app-icon

## Purpose

배포용 exe 파일 아이콘을 Play Store 공식 이미지에서 자동 생성. 직접 디자인 대신 퍼블리셔 아이콘을 재사용할 때 (fan-made / companion 앱 관례) 빠르게 반영.

단계:

1. Play Store app-details 페이지에서 아이콘 URL regex 로 추출 (또는 제공된 URL 사용)
2. 소스 크기(기본 512×512) PNG 다운로드 — Google image CDN `=s<n>` 파라미터 활용
3. 타겟 사이즈 (16/24/32/48/64/128/256) 각각에 대해:
   - 투명 배경 Bitmap 생성
   - 4개 corner arc 로 rounded-rect `GraphicsPath` 만들고 clip 설정
   - HighQualityBicubic 으로 downscale + 클립된 DrawImage
   - PNG 로 in-memory 인코딩
4. ICO 파일 수동 어셈블 (header + entry table + PNG blob 연결) — 다중 해상도 embed

## Procedure

### 1. Play Store 앱 ID 확인

대상 앱의 Play Store URL 끝 `?id=` 뒷부분. 예시:
- `https://play.google.com/store/apps/details?id=com.smilegate.outerplane.stove.google`
- → AppId = `com.smilegate.outerplane.stove.google`

### 2. 스크립트 실행 (앱 ID 모드)

```powershell
& ".\.claude\skills\create-app-icon\create-app-icon.ps1" -AppId "com.smilegate.outerplane.stove.google"
```

(에이전트의 cwd 가 repo root 인 경우. 다른 위치라면 해당 `.ps1` 절대/상대 경로로 호출.)

기본 출력 경로: `assets\icon.ico` (프로젝트 루트 기준).

### 3. 대체 호출 (URL 직접 지정)

Play Store HTML 구조 변경으로 regex 가 실패하거나, 다른 CDN 을 쓰고 싶을 때:

```powershell
& "...\create-app-icon.ps1" -IconUrl "https://play-lh.googleusercontent.com/<token>"
```

`-IconUrl` 값은 쿼리 파라미터 없어도 됨 — 스크립트가 `=s<SourceSize>` 를 부착함.

### 4. 파라미터 커스터마이즈

```powershell
-OutputPath "assets\icons\app.ico"   # 출력 경로 변경
-CornerRadiusRatio 0.15              # 더 직선에 가까운 corner
-CornerRadiusRatio 0.5               # 원형
-SourceSize 1024                     # 고해상도 소스 (CDN 지원하면)
```

### 5. 성공 출력

아이콘이 바뀐 경우 (`updated` 또는 `created`):

```
[1] Resolved icon URL: https://play-lh.googleusercontent.com/<token>
[2] Downloaded 358123 bytes -> C:\Users\...\AppData\Local\Temp\<rand>.png
[3] Source bitmap: 512x512
[4] Wrote d:\...\assets\icon.ico (7 sizes, 300012 bytes)
[DONE] Corner radius: 22% per side
[RESULT] updated
```

Play Store 소스가 그대로라면 (`unchanged`) — 파일 mtime 도 건드리지 않음:

```
[4] Kept d:\...\assets\icon.ico — identical 300012 bytes, skipped write
[DONE] Corner radius: 22% per side
[RESULT] unchanged
```

마지막 `[RESULT]` 줄로 호출자가 커밋 필요 여부를 분기할 수 있음.

### 6. 적용

`package.json` `build.win.icon` 이 이미 `assets/icon.ico` 를 가리키고 있으면, 다음 `npm run dist` 에서 새 아이콘이 반영된 exe 생성.

## Known pitfalls

- **Play Store HTML 구조 의존**: 페이지 레이아웃이 바뀌면 regex (`play-lh.googleusercontent.com/<token>`) 가 엉뚱한 매치 (아이콘 대신 스크린샷) 를 잡을 수 있음. 정상 동작 확인되면 URL 을 로컬 보관해뒀다가 `-IconUrl` 모드로 재사용 권장.
- **CDN 경로 고정 아님**: Google 이 언제든 `play-lh.googleusercontent.com` 호스트 이름을 바꿀 수 있음. 그때는 regex 업데이트.
- **TLS 1.2 강제 주입**: PS 5.1 기본값이 구 TLS 라 Play Store 와 handshake 실패. 스크립트 상단에서 `SecurityProtocol` 설정. 유지.
- **22% corner radius**: Android 13 adaptive-icon + iOS 스타일 중간 값. 앱 특성에 맞춰 조정 (원형은 0.5, 밀착 각진 느낌은 0.1 근처).
- **ICO 수동 어셈블**: `System.Drawing.Icon.FromHandle` 은 단일 크기만 지원하므로 header 를 직접 쓴다. ICO 스펙 변경 없으므로 안정적이지만 디버깅은 hex editor 필요할 수 있음.
- **Fan-made licensing**: 퍼블리셔 아이콘 재사용은 법적으로 회색. 상업적 배포 전 라이선스 검토 또는 자체 제작 아이콘 전환 권장.

## When NOT to use this skill

- **자체 디자인 아이콘 사용**: 직접 그린 PNG 가 있으면 `png-to-ico` 로 직접 변환.
- **비 Windows 타깃**: Linux `.png`, macOS `.icns` 는 별도 도구 필요.
- **오프라인 환경**: Play Store 접근 불가 시 `-IconUrl` 에 다른 CDN 사용하거나 로컬 PNG 기반 별도 스크립트 작성.
