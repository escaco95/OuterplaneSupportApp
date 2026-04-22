---
name: powershell-poc
description: Prototype a feature via PowerShell before porting to the Electron app. Use whenever the user wants to validate Win32/GDI behavior, test an image-processing pipeline, probe window/coordinate/DPI math, or any other dev-time exploration that's faster in PowerShell than in the app's TypeScript — examples "POC 해봐", "PowerShell 로 먼저 돌려봐", "잘 되는지 스크립트로 확인해보자". All output artifacts go to .temp/. Do NOT port to the Electron app in the same turn — porting is a separate step the user will request.
---

# powershell-poc

## Purpose

이 프로젝트의 후속 기능은 **PowerShell 스크립트 POC → Electron 앱(koffi + TypeScript) 포팅** 2단계로 진행합니다. 이 스킬은 **1단계(POC)** 만 담당합니다.

POC 목적:
- Win32 API · GDI · COM 의 실제 동작 · 한계 · 엣지 케이스를 빠르게 확인
- 좌표 · DPI · 해상도 변환 등 구체 수치를 실측
- 시각 산출물(이미지, 오버레이)을 만들어 기획 방향을 빠르게 검증

## Procedure

### 1. 목표 확정

요청이 모호하면 한 줄로 확인. 예: "RenderWindow 에 클릭을 합성하면 게임이 반응하는지", "특정 ROI 픽셀 패턴이 고정인지 프레임마다 바뀌는지".

### 2. PowerShell 스크립트 작성 · 실행

- `PowerShell` 도구로 즉시 실행 (파일 저장은 반복 실행이 필요할 때만)
- Win32 API 는 `Add-Type -Namespace W -Name U -MemberDefinition @'...'@` 로 P/Invoke
- 좌표 · rect · 캡처를 다루면 **반드시 `SetProcessDPIAware()` 를 먼저 호출**

```powershell
Add-Type -Namespace W -Name U -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool SetProcessDPIAware();
// ... 필요한 시그니처
'@ -ReferencedAssemblies System.Drawing
[W.U]::SetProcessDPIAware() | Out-Null
```

### 3. 모든 산출물은 `.temp/` 아래로

- 캡처 PNG · ROI 오버레이 · crop · 디버그 이미지 등 **dev-time 파일은 전부 `.temp/`**
- `assets/` 는 런타임 리소스 전용 (아이콘, 프로파일 JSON 등)
- `.temp/` 가 없으면 `mkdir -p .temp` 로 먼저 생성
- 예: `.temp/poc-capture.png`, `.temp/roi-overlay.png`

### 4. 결과 확인

- 이미지 산출물은 `Read` 도구로 사용자에게 시각 확인 제공
- 로그 · 수치는 스크립트 표준 출력으로 수집
- 수치 단위(물리 픽셀 vs DIP) 가 헷갈릴 여지가 있으면 로그에 명시

### 5. 반복

사용자 피드백에 따라 스크립트 조정 후 재실행. POC 단계에서는 완성도보다 **빠른 검증 루프** 가 우선.

### 6. POC 종료 보고

- **"POC 성공, 포팅 준비됨"** 을 명시
- 포팅 시 필요한 Win32 함수 목록 · struct · 매개변수를 간단히 정리해 전달
- **같은 턴에 앱으로 포팅하지 말 것** — 사용자가 별도로 지시하면 그때 진행

## Known pitfalls

- **DPI-unaware PowerShell**: 기본 PS 프로세스는 DPI-unaware. `GetWindowRect` 가 가상화(축소) 좌표를 반환해 이미지가 작거나 좌표가 어긋남. `SetProcessDPIAware()` 누락 금물.
- **배열 언랩**: `$stack.Push(@($x, $y))` 방식은 PowerShell 이 단일 요소 배열을 풀어 실패. 타입 지정 스택(`System.Collections.Generic.Stack[int]`) 2개 또는 `[PSCustomObject]` 사용.
- **변수 대소문자 충돌**: PowerShell 은 case-insensitive — `$W` 와 `$w` 가 동일 변수. 루프 변수와 상수 명이 겹치면 사일런트 덮어쓰기.
- **문자열 P/Invoke 마샬링**: `FindWindowEx` 등에 `$null` 을 넘기면 마샬링이 실패할 수 있음. 이미 알려진 HWND 가 있다면 직접 사용하거나 `EnumChildWindows` 콜백 루프로 우회.
- **출력 과다**: 이미지 전체 픽셀을 `Write-Output` 하면 2MB+ 터미널 덤프. 수치는 간결히, 이미지는 파일로 저장 후 `Read` 로 확인.
- **GUI 프로세스 spawn**: POC 가 Electron/GUI 앱을 띄워야 하면 `Start-Process` · `run_in_background` 대신 WMI `Invoke-CimMethod` 사용.

## When NOT to use this skill

- 사용자가 POC 없이 **바로 앱에 반영**을 요청 ("바로 구현해줘", "앱에 추가해줘" 등)
- 순수 TypeScript 로직 · UI · CSS 변경 — Win32 검증 불필요
- 이미 koffi 로 앱에 구현되어 있고 동작 확인만 필요 → 앱을 실행해서 확인
- 읽기 전용 정보 조회(PID 확인, 파일 존재 여부 등) — 스킬 오버헤드 불필요, 단일 PS 호출로 충분
