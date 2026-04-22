---
name: auto-reroll-until-valuable
description: 정밀 제작 화면에서 "확정 옵션 변경" 을 자동 반복 리롤하며, 매 iteration 에서 (1) 미등록 스탯(UNKNOWN) 감지 (2) 가치 있는 결과 패턴(A/B) 감지 (3) 최대 50회 중 하나를 만족하면 즉시 종료. 재화 소모를 최소화하기 위한 조기 종료 보증 포함. Use when the user wants the agent to mechanically reroll until something happens — examples "계속 돌려봐", "UNKNOWN 나올 때까지 굴려", "자동 리롤", "auto reroll", "돌리다가 좋은 거 뜨면 멈춰".
---

# auto-reroll-until-valuable

## Purpose

"확정 옵션 변경" 을 반복 클릭하며, 다음 조건 중 하나를 만족하면 즉시 종료:

1. **UNKNOWN 탐지**: 스캔한 스탯 중 하나라도 완전하게 식별되지 않으면 종료 → 호출자(에이전트)가 `last-scan.png` 확인 후 register-stat 로 row 커버리지 확장.
2. **VALUABLE 패턴 A/B 감지**: 재화 성과 확보 → 즉시 정지 (현재 프리뷰를 사용자가 확정하면 됨).
3. **MAX_ITER (50) 도달**: 안전 상한. 무한 루프 방지.

## 가치 패턴 정의

**valuable 스탯 집합** = `{치명 피해%, 치명 확률%, 속도, 효과 적중%}`

rank 는 0~4, `rank ≥ 3` 을 "rank 3" 으로 관대 해석 (rank 4 는 rank 3 보다 항상 좋으므로 동일 취급).

### Pattern A — "3 rank-3 stats are valuable" (완화형)
- 4 행 중 `rank ≥ 3` 이면서 valuable 인 행이 **≥ 3 개** → 매치.
- 4 번째 행은 don't-care (어떤 스탯이든 어떤 rank 든 허용).
- 예: `[3,3,3,1]` 스탯 [치명피해%, 속도, 효과적중%, 체력] → A 매치.
- 예: `[3,3,3,3]` 스탯 [치명피해%, 속도, 효과적중%, 공격력] → A 매치 (4번째가 valuable 아니지만 앞 3개만 보면 됨).

### Pattern B — "3,3,2,2 all-valuable" (엄격형)
- `rank ≥ 3` 행 수 `>= 2` AND `rank ≥ 2` 행 수 `== 4` AND **4개 스탯 모두 valuable**.
- 예: `[3,3,2,2]` 모두 valuable → B 매치.
- 예: `[4,3,2,2]` 모두 valuable → B 매치 (rank 4 관대 해석).
- 예: `[3,3,2,2]` 중 3개만 valuable → 매치 안 됨 → 계속 리롤.

## Procedure

### 1. 실행

```powershell
& ".\.claude\skills\auto-reroll-until-valuable\auto-reroll-until-valuable.ps1"
```

(에이전트의 cwd 가 repo root 인 경우. 다른 위치라면 해당 `.ps1` 절대/상대 경로로 호출.)

### 2. 출력 해석

**iteration 로그** (매 회):
```
[12/50] ranks=[3,2,3,1] stats=[공격력 | 방어력% | 속도 | 체력]
```

**종료 메시지** (아래 중 정확히 하나):
- `STOP: UNKNOWN at iteration N` — 그 iteration 의 stats 로그를 보면 어느 행이 UNKNOWN 인지 확인 가능. `last-scan.png` 를 보고 register-stat 실행.
- `STOP: VALUABLE pattern A at iteration N` 또는 `pattern B` — 재화 성과. 사용자에게 통지 후 스킬 종료. **추가 리롤 금지**.
- `STOP: LIMIT (50 iterations) reached with no valuable pattern` — 50회 소진. 다음 동작은 사용자 판단.
- `FAIL: ...` — LDPlayer 단일 인스턴스 가드 / 정밀 제작 화면 검증 실패. 계속 진행 불가.

### 3. 에이전트 측 처리

스킬이 종료되면:
- **UNKNOWN** → `last-scan-tobe.png` crop 생성 → Read → 사용자에게 스탯 4개 확인 요청 → `register-stat` 스킬로 row 커버리지 업데이트 → (선택) 재호출.
- **VALUABLE** → 축하/요약 후 정지. 실제 재화 성과이므로 추가 동작 하지 말 것.
- **LIMIT** → 단순 리포트.
- **FAIL** → 원인 안내.

## Known pitfalls

- **재화 부족/쿨다운**: 스크립트는 클릭 성공 여부만 책임짐. 게임이 클릭을 무시해 실제로 리롤이 안 되는 경우, 스탯/랭크가 매 iteration 동일하게 나오며 50회까지 소진. 필요 시 사용자가 중단.
- **적응형 settle**: fixed 3s sleep 이 아니라 `Wait-ForSettle` 이 click 후 1200ms 대기 → 200ms 간격 폴링 → (pre-click 대비 변화 AND 직전 poll 과 동일) 2연속 감지 시 확정. 최대 3500ms safety cap. 평균 iter 시간 ~2s. `rank 합=0` 은 burst 애니메이션 상태로 간주해 stable 후보에서 배제 (false UNKNOWN 방지).
- **누적 상태 추적**: `.temp/auto-reroll-state.json` 에 총 attempts / hits / current streak / longest streak 지속. 매 iter 당 1회 카운트 (UNKNOWN 은 카운트 안 함 — 판정 불가). VALUABLE 시 streak=0 리셋.
- **운 percentile**: config.json 의 `assumedHitRate` (default 0.02 = 2%) 를 true rate 로 가정, 기하분포 survival 로 `P(streak >= N) = (1-p)^N` 계산. "하위 X% 운" 형태 출력 (낮을수록 불운). `assumedHitRate` 는 감각적 추정치로, 실제 명중률과 다를 수 있음. 충분한 hit 샘플 누적 후 재조정 권장.
- **valuable 집합 하드코딩**: 스크립트 상단 `$VALUABLE` 에 정의. 변경하려면 스크립트 수정. 패턴 정의 자체를 바꾸려면 `Check-Patterns` 수정.
- **Pattern B 엄격성**: `3,3,2,2` 는 모두 valuable 일 때만 매치. "3개만 valuable" 은 의도적으로 거름 (재화 아깝지 않은 한도).
- **`$screenProfile` / `$renderWidth` 명명**: PowerShell 자동변수 `$profile`, case-insensitive 충돌 `$rw/$rW` 를 피하기 위한 관례. 유지.
- **MaskSim 중복 로드 경고**: 동일 PS 세션에서 반복 실행 시 `MaskSim` 이미 정의됨 → `if (-not PSTypeName)` 가드로 스킵. 무해.

## When NOT to use this skill

- **단순 1회 리롤** — `reroll-option` 스킬 사용. 이 스킬은 최소 1회 클릭 + 조건 매치될 때까지 반복.
- **rank 만 읽고 싶을 때** — `read-rank` 스킬.
- **정밀 제작 외 화면** — 화면 검증에서 즉시 실패. 먼저 사용자를 정밀 제작 화면으로 안내.
- **valuable 패턴이 다른 경우** (다른 빌드/스탯 우선순위) — 스크립트 내 `$VALUABLE` 및 `Check-Patterns` 수정 후 사용하거나, 별도 스킬로 복제.
- **재화가 거의 없을 때** — 안전 상한 50 이지만 그 전에 소진 가능. 사용자에게 확인 권장.
