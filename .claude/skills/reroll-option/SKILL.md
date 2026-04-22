---
name: reroll-option
description: 정밀 제작 화면에서 "확정 옵션 변경" 버튼을 1회 클릭해 서브 옵션을 재굴림. 사용자 마우스 커서를 움직이지 않는 PostMessage 방식. 자동 안전 가드(LDPlayer 단일 인스턴스 + 정밀 제작 화면 여부 히스토그램 검증) 통과해야 클릭이 나감. Use whenever the user asks to reroll precision-craft sub options — examples "옵션 굴려줘", "리롤해", "다시 굴려", "reroll", "한 번 더 굴려봐".
---

# reroll-option

## Purpose

아우터플레인 "정밀 제작" 화면에서 **확정 옵션 변경** 버튼을 1회 클릭하여 서브 옵션 재굴림을 수행. 안전 보증:

- LDPlayer 가 **정확히 1개**만 실행 중이어야 진행 (다중 인스턴스면 대상 모호 → 실패)
- 현재 화면이 **정밀 제작 서브 옵션 선택 중**이어야 진행 (ROI 히스토그램 correlation ≥ 0.9 전부 통과)
- 클릭은 **PostMessage WM_LBUTTONDOWN/UP** 으로 RenderWindow 에 전송 → 사용자 마우스 커서 미개입

**1회 호출 = 1회 클릭**. 연속 리롤이 필요하면 상위 로직에서 반복 호출.

## Procedure

### 1. 스크립트 실행

```powershell
& "d:\Personal Projects\HTML\OuterplaneApp\.claude\skills\reroll-option\reroll-option.ps1"
```

### 2. 출력 해석

**성공 플로우**:
```
[1] LDPlayer main HWND: <hwnd>
[2] Render rect: (x, y) WxH
  ROI [island-explore]    score=0.xxxx PASS
  ROI [continuous-change] score=0.xxxx PASS
  ROI [confirm-change]    score=0.xxxx PASS
  ROI [step-sub-option]   score=0.xxxx PASS
[3] OK: On ... screen
[4] Click target (client): (x, y)
[5] Click sent; waiting for reroll animation to settle...
[6] DONE: reroll settled
```

클릭 후 약 1.5초 대기 포함 — 게임의 네트워크 응답 + 옵션 변경 애니메이션이 완료된 후 스크립트가 반환. 따라서 이 스킬 직후 스캔해도 post-reroll 상태를 보게 됨.

**실패 케이스** (조기 종료):
- `FAIL: No LDPlayer window` — LDPlayer 미실행
- `FAIL: Multiple LDPlayer windows (N)` — 다중 인스턴스 (종료 후 1개만 남기거나, 이 스킬은 쓰지 말 것)
- `FAIL: No RenderWindow child` — LDPlayer 내부 창 구조 이상 (버전 차이 · 비정상 상태)
- ROI 중 하나라도 `FAIL` → `[3] FAIL: Not on 정밀 제작 screen`

### 3. 결과 보고

- 성공 시: "1회 리롤 실행됨" 통지
- 실패 시: 어느 단계에서 실패했는지와 원인 설명 (예: "LDPlayer 가 다중 실행 중입니다 (2개)")

## Known pitfalls

- **LDPlayer 최소화 중**: RenderWindow HWND 는 유효하지만 캡처가 블랭크거나 이전 프레임일 수 있음 → 히스토그램 실패. 사용자에게 LDPlayer 복원 안내.
- **버튼 cooldown/비활성 상태**: 클릭은 전송되지만 게임이 무시. 이 스킬은 "클릭 도달 여부" 만 책임짐. 실제 리롤 성공은 게임 상태 (재화·기회 남음) 에 달림.
- **변수 이름 규칙**: 스크립트 내부에서 render rect 변수는 `$renderLeft/$renderTop/$renderWidth/$renderHeight` (foreach ROI 루프의 `$rw/$rh` 와 case-insensitive 충돌 방지). 수정 시 유지할 것.
- **`$profile` 금지**: PowerShell 내장 자동 변수. 스크립트에서는 `$screenProfile` 사용.

## When NOT to use this skill

- **반복 자동화 요청** ("목표 옵션 나올 때까지 계속 굴려") — 이 스킬은 1회만 담당. 상위 반복 로직 필요.
- **다른 버튼 클릭** 필요 시 (연속 옵션 변경, 정밀 제작 최종 실행 등) — ROI 가 다르므로 별도 스킬 생성 필요.
- **LDPlayer 외 에뮬레이터** (녹스, BlueStacks 등) — 창 클래스명이 `LDPlayerMainFrame` 이 아니라 동작 안 함.
- **정밀 제작 외 화면** — 히스토그램 검증에서 FAIL 반환하므로 스킬 호출 자체가 무의미. 먼저 사용자를 정밀 제작 화면으로 안내.
