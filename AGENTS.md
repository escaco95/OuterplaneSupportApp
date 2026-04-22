# AGENTS.md

이 프로젝트는 모바일 게임 `아우터플레인` 을 보다 편리하게 즐길 수 있도록 도와주는 애플리케이션입니다.

이 문서에 작성되는 내용은 명확하고, 간결하게 작성되어야 합니다.

## 기술 스택

- Windows 전용 (Win32 API 사용)
- Electron 30 · TypeScript · koffi
- 실행: `npm start` (tsc 빌드 후 electron 구동)
- 테스트: `npm test` (detect 파이프라인 회귀 + craft 로직 unit test, Node 내장 `node:test`)
- 배포: `npm run dist` (electron-builder 로 `release/OuterplaneApp-<ver>-win-x64.zip` 생성)

## 디자인 철학

- modern, simple, clean
- symbol rather than text
- hover tooltip rather than text

## 프로젝트 컨벤션

### 폴더 구조

```text
.claude/          AI agent 설정 + skills (read-stat · register-stat · read-rank · reroll-option · auto-reroll-until-valuable)
.temp/            dev 산출물 (캡처·ROI·crop·상태 스냅샷), gitignored
.vscode/          IDE 설정
assets/           런타임 리소스 (아이콘, 프로파일 JSON)
dist/             tsc 출력, gitignored
release/          electron-builder 출력 (zip), gitignored
node_modules/     의존성, gitignored
src/              TypeScript 소스
  craft/          자동 리롤 루프 컨트롤러·상태 지속·settle·match
  detect/          캡처 정규화·화면 검증·스탯/랭크 스캔 (binary mask + IoU)
```

### Versioning

- App Version:
  - YYYY.MM.DD(-PRERELEASE) 형식. 예: 2024.06.01, 2024.06.01-beta.1
- Release Tag:
  - release/YYYY-MM-DD(-PRERELEASE) 형식. 예: release/2024-06-01, release/2024-06-01-beta-1

### Release / Packaging

- do only when user explicitly requests a release or packaging
- fetch latest icon (see `create-app-icon` skill)
- perform version bump
- commit changes
- tag release
- build package (`npm run dist`)

### commit message

1. use english for commit messages
2. split changes into small, focused commits
3. use present tense ("add feature" not "added feature")

- feat: {feature}
  - describe a new feature added to the app
- fix: {bug fix}
  - describe a bug fix and the issue it addresses
- refactor: {code refactor}
  - describe a code change that neither fixes a bug nor adds a feature (e.g., code cleanup, performance improvement)
- docs: {documentation}
  - describe changes to documentation (e.g., README updates)
- chore: {maintenance}
  - describe routine tasks and maintenance work (e.g., dependency updates, build scripts)
- ci: {ci changes}
  - describe changes to continuous integration configuration and scripts

### .gitignore

카테고리별 주석 헤더로 구분합니다.

```text
### Node Modules ###
node_modules/
dist/

### AI Agents ###
.claude/settings.local.json
.temp/

### Release Artifacts ###
release/
```

## 기능

### 홈(커뮤니티로 이동)

- 게임과 연관된 다양한 커뮤니티로 이동할 수 있는 버튼 목록 제공
  - [아우터플레인 위키](https://kr.outerpedia.com/)
  - [아우터플레인 채널](https://arca.live/b/outerplane)
- 설정 페이지에서 버튼 추가·수정·삭제 및 순서 변경
- 설정 초기화 시 기본 커뮤니티 버튼으로 복원

### 정밀 제작 도우미

- **아우터플레인 앱 찾기**
  - LDPlayer 창 탐색
  - 여러 개면 반투명 선택 오버레이("이 창으로 결정" 라벨), backdrop 클릭으로 취소
- **선택된 창 시각 추적**
  - 게임 렌더 영역에 외곽 glow 유지
  - 창 이동·리사이즈·모니터 전환 자동 추적
  - 최소화 시 일시 숨김, 닫기 시 자동 해제, 재탐색 시 이전 glow 정리
- **실시간 조건 검증 (glow 색상으로 표시)**
  - 통과: 청색, 위반: 적색 + 중앙 사유 텍스트
  - 판정 조건
    - 해상도 1280×720 ~ 1305×734 (1280×720 +2%)
    - 화면비 16:9 (±1.5%)
    - 현재 화면이 정밀 제작 서브 옵션 선택 중 (~3s 연속 실패 시 경고; 단발 애니메이션 blip 은 무시)
- **자동 리롤**
  - 원하는 스탯(valuable) 다중 선택 (카탈로그 13종)
  - 4-슬롯 위력 템플릿 (0 = 무관, 1-4 = 해당 위력 이상 1개 필요; 위치 무시, multiset 매칭)
  - 두 번째 위력 템플릿 세트 토글 (OR 매칭: 둘 중 하나라도 만족 시 완성) — 예: `3,3,3,0` **또는** `3,3,2,2`
  - 최대 시도 설정, 누적 시도/성공/streak 표시
  - 실행 중: 실시간 iter 로그 (100줄 cap, 토글 가능) + live 프리뷰 + 진행바 + 중단 버튼
  - 종료 상태
    - HIT: 조건 일치 프리뷰 표시 → 사용자가 수동 확정
    - LIMIT: 최대 시도 도달
    - 인식 실패: 스탯 인식 실패 시 프로덕션 종료 (개발자 문의 유도)
    - FAIL: 창 소실 · 화면 가드 실패 · 사용자 중단 등
  - 클릭 주입: `PostMessage(WM_LBUTTONDOWN/UP)` 로 사용자 커서 미개입

### 설정

- 테마 설정
- 앱 확대 배율 설정
- 홈 화면 커뮤니티 버튼 (추가·수정·삭제·순서 변경·기본값 복원)
- Danger Zone
  - 앱 데이터 초기화 (설정 초기화)

## 배포

`npm run dist` 실행 시 `release/OuterplaneApp-<version>-win-x64.zip` 생성. 사용자는 zip 압축 해제 후 `OuterplaneApp.exe` 실행.

주의:

- 서명되지 않은 바이너리 — Windows SmartScreen 경고 나올 수 있음 ("추가 정보" → "실행")
- Windows x64 전용
- 처음 실행 시 `%APPDATA%\OuterplaneApp\` 에 사용자 데이터 (favicon 캐시, auto-reroll 누적 상태) 생성
