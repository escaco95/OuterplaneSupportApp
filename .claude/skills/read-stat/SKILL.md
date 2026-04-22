---
name: read-stat
description: 정밀 제작 화면의 우측 "변경 서브 옵션(To-Be)" 패널에서 4개 행의 **스탯 이름과 % 여부**를 읽어옴. 등록된 row-keyed binary mask 에 대한 IoU 매칭 + margin 판정. LDPlayer 단일 인스턴스 + 정밀 제작 화면 가드 포함. Use whenever the user wants to identify current preview stat names — examples "지금 뭐 떴어", "스탯 읽어줘", "스탯 확인", "read stats", "현재 프리뷰 뭐야".
---

# read-stat

## Purpose

아우터플레인 "정밀 제작" 우측 To-Be 패널의 **4개 행 스탯 이름** 을 식별. 각 행에 대해:

1. **Name ROI** 픽셀 → binary mask → `stat-references.json` 의 동일 row 참조 마스크들과 IoU 비교
2. **Pct ROI** 픽셀 → "%" 기호 존재 여부 판정 (yes/no)
3. 결합: `이름 + "%"` 또는 `이름` 을 canonical 결과로 반환

판정 정책:
- **name**: IoU margin 기반 (best >= 0.85 AND best-second >= 0.15)
- **pct**: "yes" 는 절대 신뢰도 >= 0.6 요구, 아니면 기본 "no" 로 폴백 (% 기호가 명확하지 않을 때 실제 체력/공격력/방어력 등을 체력%/공격력%/방어력% 로 잘못 잡지 않게 함)

안전 가드 (다른 스킬과 동일):
- LDPlayer **정확히 1개** 실행 중
- 현재 화면이 **정밀 제작 서브 옵션 선택 중** (화면 프로파일 histogram 통과)

## Procedure

### 1. 스크립트 실행

```powershell
& ".\.claude\skills\read-stat\read-stat.ps1"
```

(에이전트의 cwd 가 repo root 인 경우. 다른 위치라면 해당 `.ps1` 절대/상대 경로로 호출.)

### 2. 출력 해석

**성공 출력** (각 행 당 1 줄):

```
Option 1: 체력%  (name=체력/0.988, pct=yes/0.951)
  all name scores: 체력=0.9877, 공격력=0.4613, ...
Option 2: 속도  (name=속도/0.985, pct=no/0.3)
  all name scores: ...
Option 3: 방어력%  (name=방어력/0.997, pct=yes/1)
  ...
Option 4: 공격력  (name=공격력/0.997, pct=no/0.3)
  ...
```

- `Option N: <label>  (name=<이름>/<score>, pct=<type>/<score>)`
- **label 종류**:
  - `{이름}%` — name 과 pct=yes 둘 다 확신. 정상 케이스.
  - `{이름}` — name 은 확신, pct 는 "no" 판정 (%가 아님).
  - `{이름} (% UNKNOWN)` — name 확신, pct 판정 자체가 비어있음 (참조 부재). 드묾.
  - `UNKNOWN (% <type>)` — name 확신 부족, pct 만 판정됨.
  - `UNKNOWN` — 둘 다 부족. **이 행은 등록 누락 또는 신규 스탯**.
- `all name scores` — 디버그용 전체 후보 IoU. 2위와의 margin 이 작으면 오인식 위험 신호.

**실패** (조기 종료):
- `FAIL: No LDPlayer window` — LDPlayer 미실행
- `FAIL: Multiple LDPlayer windows (N)` — 다중 인스턴스
- `FAIL: No RenderWindow child` — LDPlayer 창 구조 이상
- `FAIL: Not on precision-craft screen (ROI <id> score=<n>)` — 화면 히스토그램 미통과

**참조 비어있을 때**:
```
[note] stat-references.json is empty or missing. Use register-stat skill to seed.
```

### 3. 결과 보고

표 형태 권장:

| 옵션 | 스탯 | pct | name score | pct score |
|---|---|---|---|---|
| 1 | 체력 | yes | 0.988 | 0.951 |
| 2 | 속도 | no | 0.985 | 0.30 |
| 3 | 방어력 | yes | 0.997 | 1.00 |
| 4 | 공격력 | no | 0.997 | 0.29 |

UNKNOWN 이 있으면 **어느 행인지 + pct 가 yes 인지 no 인지** 를 사용자에게 명시. 이후 register-stat 로 해당 행 보강 권장.

## Known pitfalls

- **row-keyed 레퍼런스 필요**: `stat-references.json.stats[].row` 없이는 모든 행이 UNKNOWN. 초기 seed 는 register-stat 로.
- **pct "no" 마스크는 불안정**: "no" 는 숫자 글리프(6, 120 등) 로 캡처되어 일반화 약함. 그래서 판정 정책이 "yes 절대 임계값만 보고, 아니면 no" 로 비대칭. pct score 가 낮다고 해서 실패로 보지 말 것.
- **MIN_CONF=0.75, MIN_MARGIN=0.10, MIN_PCT_YES_CONF=0.6 은 app 쪽 포팅에서 동일 수치로 유지**. 변경 시 `src/detect/types.ts` 의 `DEFAULT_THRESHOLDS` 와 `auto-reroll-until-valuable.ps1` 양쪽 동기화 필요. 현 값은 창 크기 변경 시 nearest-neighbor resize 로 인한 IoU drift (~0.12) 까지 흡수하도록 튜닝됨.
- **`$screenProfile` / `$renderWidth` 명명 관례 유지** (PS 자동변수 충돌 · case-insensitive 충돌 방지).

## When NOT to use this skill

- **스탯 이름 대신 위력(rank)** 만 필요 — `read-rank` 스킬.
- **스탯을 등록** 하고 싶을 때 — `register-stat`.
- **정밀 제작 외 화면** — 화면 가드에서 즉시 FAIL. 먼저 정밀 제작 진입.
- **LDPlayer 외 에뮬레이터** — 창 클래스명 의존.
