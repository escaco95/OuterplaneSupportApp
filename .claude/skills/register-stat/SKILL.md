---
name: register-stat
description: 현재 정밀 제작 화면을 캡처해 4개 행의 **스탯 이름 + % 여부**를 사용자가 알려준 ground truth 로 stat-references.json 에 저장(또는 기존 엔트리 업데이트). binary mask keyed by (name, row) + pct marker keyed by (row, type). read-stat 스킬이 UNKNOWN 을 낼 때 row 커버리지를 확장하는 교정 도구. Use when the user confirms what's currently on screen and wants to record it — examples "스탯 등록해줘", "지금 화면 체력%, 속도, 방어력%, 공격력 이야 등록해", "register stat".
---

# register-stat

## Purpose

사용자가 **현재 프리뷰 4개 행의 스탯 이름을 확정적으로 알려주면**, 지금 화면을 캡처하여 그 ground truth 와 짝지어 binary mask 레퍼런스를 저장. 이후 read-stat 가 같은 row 에서 유사 패턴을 만나면 IoU 로 식별 가능.

동작:

1. LDPlayer 캡처 → 1280×720 canonical
2. 현재 화면이 정밀 제작 화면인지 histogram 가드
3. 각 행의 Name ROI / Pct ROI 를 binary mask (max(R,G,B) > 128) 로 추출
4. `assets/profiles/stat-references.json` 로드 → (name, row) 키가 이미 있으면 **UPDATE** (마스크 덮어쓰기), 없으면 **NEW** (추가)
5. (row, type) 키 pct 마커도 UPDATE/NEW 로 병합
6. UTF-8 (BOM 없음) 으로 저장

**순서 주의**: 인자 이름 4개는 **Option 1 → Option 2 → Option 3 → Option 4** 순서. `%` 접미사로 pct 여부 전달.

## Procedure

### 1. 현재 화면 스탯 확인

사용자에게 4개 행 스탯을 정확히 물어보거나, read-stat 결과로부터 확실한 라벨만 취합. 확신 없이 호출 금지 (잘못 등록하면 이후 오인식 전파).

### 2. 스크립트 실행

```powershell
& "d:\Personal Projects\HTML\OuterplaneApp\.claude\skills\register-stat\register-stat.ps1" -Names "체력%, 속도, 방어력%, 공격력"
```

- `-Names` 는 쉼표-구분 4개 문자열. 공백은 trim 됨.
- 각 항목 끝의 `%` 는 pct=yes 로 해석. 아니면 pct=no.
- **정확히 4개** 필요 (아니면 FAIL).

### 3. 출력 해석

**성공 출력**:
```
Registered 4 options to d:\...\stat-references.json
  [1] 체력% -> stat UPDATED (체력@row1)
  [2] 속도 -> stat NEW (속도@row2)
  [3] 방어력% -> stat UPDATED (방어력@row3)
  [4] 공격력 -> stat NEW (공격력@row4)
  pct row1/yes UPDATED
  pct row2/no UPDATED
  pct row3/yes UPDATED
  pct row4/no UPDATED
  total stat entries: 42 (11 unique names)
  total percent markers: 8
  file size: 475.3 KB
```

- `NEW` vs `UPDATED` — 이전 (name, row) 조합 유무 차이. 자연스러운 커버리지 확장일 때 NEW 가 나옴.
- `unique names` 증가는 신규 스탯 발견 신호. 13 (전체 카탈로그) 에 근접해야 item 전환 대비 안전.

**실패**:
- `FAIL: Expected 4 names (comma-separated), got N` — 인자 수 오류
- `FAIL: No LDPlayer window` / `FAIL: Multiple LDPlayer windows` / `FAIL: No RenderWindow child`
- `FAIL: Not on precision-craft screen (ROI <id> score=<n>)` — 화면 가드 실패

### 4. 후속 검증

등록 직후 read-stat 한 번 돌려 **방금 등록한 스탯이 이제 정상 인식** 되는지 확인하는 게 안전. 특히 NEW 엔트리는 첫 검증 필수.

## Known pitfalls

- **ground truth 정확도가 생명**: 잘못된 라벨로 등록하면 이후 read-stat/auto-reroll 에서 체계적 오인식. "UPDATE" 시 기존 좋은 마스크도 덮어쓰므로 특히 주의.
- **Pct marker shared across stats**: (row, type) 키라서 하나의 "yes"/"no" 마스크가 그 행의 모든 스탯에 공유됨. 첫 yes 등록 때 캡처된 % 글리프가 해당 행의 "yes" 기준이 됨.
- **"no" 마스크는 불안정 by design**: 숫자 글리프(146, 120, 6 등) 에서 캡처되므로 일반화 약함. read-stat 가 "no" 의 IoU 를 직접 쓰지 않고 "yes 절대 임계값 미달 시 no" 로 폴백하는 이유.
- **JSON 덮어쓰기는 단일 write**: 중간에 프로세스가 죽으면 파일이 truncate 될 수 있음. ~500ms 이하 연산이라 실제 드물지만, 원본을 바꾸기 전에 커버리지 스냅샷이 중요하면 수동 백업 권장.
- **row-keyed 저장의 의의**: 같은 스탯이 행별로 ROI y 위치가 미세 다름 → 단일 마스크는 alignment noise. row 당 저장이 IoU 를 0.88 → 0.98+ 로 끌어올림.

## When NOT to use this skill

- **사용자 확신 없는 라벨** — 물어봐서 확정받은 후 호출.
- **지금 화면이 정밀 제작이 아닐 때** — 화면 가드에서 즉시 FAIL 하므로 실행 자체가 무의미.
- **기존 잘 인식되는 스탯** — 굳이 재등록할 필요 없음. read-stat 에서 UNKNOWN 이 난 행만 커버리지 확장.
- **Item 을 여러 번 전환하면서 한 번에 등록** — 매 item 의 rank/stat 조합이 다르므로 한 세션당 최대 4개씩 신중히. 대량 자동화는 금지.
