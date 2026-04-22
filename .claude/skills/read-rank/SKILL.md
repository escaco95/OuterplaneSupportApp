---
name: read-rank
description: 정밀 제작 화면의 우측 "변경 서브 옵션(To-Be)" 패널에서 4개 옵션 각각의 강함 등급(0~4)을 읽어옴. 각 옵션의 progress bar 4세그먼트 중 채워진(노랑) 개수로 판정. LDPlayer 단일 인스턴스 + 정밀 제작 화면 검증을 선행. Use whenever the user asks about the strength/rank of current preview sub options — examples "rank 확인해줘", "지금 뭐가 떴어", "옵션 강함 확인", "read rank".
---

# read-rank

## Purpose

아우터플레인 "정밀 제작" 화면의 **변경 서브 옵션(To-Be) 패널** 에 표시되는 4개 옵션 각각의 강함 등급을 읽어냄. 각 옵션은 4구간 progress bar 를 가지고, 채워진 세그먼트 수(0~4)가 곧 해당 옵션의 rank. OCR 없이 순수 **색상(노랑 채움) 판정**으로 동작.

안전 가드 (reroll-option 과 동일):
- LDPlayer **정확히 1개**만 실행 중
- 현재 화면이 **정밀 제작 서브 옵션 선택 중** (ROI 히스토그램 검증 PASS)

## Procedure

### 1. 스크립트 실행

```powershell
& "d:\Personal Projects\HTML\OuterplaneApp\.claude\skills\read-rank\read-rank.ps1"
```

### 2. 출력 해석

**성공 출력**:
```
Option 1: ##.. (2/4)
  debug: seg1 RGB(254,206,71)*  seg2 RGB(254,206,71)*  seg3 RGB(125,126,128)  seg4 RGB(125,126,128)
Option 2: ###. (3/4)
  debug: ...
Option 3: #### (4/4)  MAX
  debug: ...
Option 4: #... (1/4)
  debug: ...

Total: 10/16
```

- `#` = 채워진 세그먼트 (노랑, RGB ≈ 254/206/71)
- `.` = 빈 세그먼트 (회색, RGB ≈ 125/126/128)
- `*` (debug) = 개별 세그먼트가 "채워짐" 으로 판정된 표시
- 4/4 옵션은 ` MAX` 꼬리표

**실패**:
- `FAIL: No LDPlayer window` / `FAIL: Multiple LDPlayer windows (N)` / `FAIL: No RenderWindow child`
- `FAIL: Not on 정밀 제작 screen`

### 3. 결과 보고

표 형태로 정리 추천:

| 옵션 | rank |
|---|---|
| Option 1 | 2/4 |
| Option 2 | 3/4 |
| Option 3 | 4/4 MAX |
| Option 4 | 1/4 |
| Total | 10/16 |

필요 시 debug 라인은 생략하고 rank 만 전달해도 충분함.

## Known pitfalls

- **ASCII 마커만 사용**: PowerShell 5.1 은 BOM 없는 UTF-8 을 CP949 로 읽음. `●/○` 같은 유니코드 기호는 parse 실패. 스크립트는 `#/.` 로 유지.
- **채움 임계값**: 현재 `R ≥ 150 AND R - B ≥ 40`. 실측상 채움/빈 세그먼트의 R-B 차이가 +183 vs -3 로 마진이 매우 커 안정적. 게임 UI 팔레트가 바뀌면 재조정 필요.
- **세그먼트 높이 4px**: 매우 얇음. 캡처 타이밍에 따라 bar 가 블링크/애니메이션 중이면 순간적으로 오판 가능. 통상적으론 정적.
- **`$screenProfile` 이름**: PowerShell 내장 `$profile` 자동 변수와 충돌 방지. 유지할 것.
- **변수 이름**: `$renderLeft/$renderTop/$renderWidth/$renderHeight` — foreach ROI 루프의 `$rw/$rh` 와 case-insensitive 충돌 방지. 유지할 것.

## When NOT to use this skill

- **정밀 제작 외 화면** — 히스토그램 검증에서 FAIL. 먼저 사용자를 정밀 제작 화면으로 안내.
- **좌측 "현재 서브 옵션" 패널** 판독이 필요할 때 — 이 스킬은 우측 To-Be 만 읽음. 별도 ROI 세트로 새 스킬 필요.
- **LDPlayer 외 에뮬레이터** — 클래스명 `LDPlayerMainFrame` 의존.
- **세그먼트 수가 4 가 아닌 경우** (UI 업데이트로 단계 수 변경) — ROI 정의 재작성 필요.
