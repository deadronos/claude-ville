# ClaudeVille - 프로젝트 규칙

> 리포지토리 공통 지침은 `../AGENTS.md`를 먼저 확인하세요.
> React/R3F 월드 구조의 기준 문서는 `../docs/architecture/005-react-components.md` 와 `../docs/architecture/006-r3f-components.md` 입니다.

## 레이아웃 구조 (중요)

```text
body (flex column, height 100vh)
  header.topbar            ← 48px 고정 높이, flex-shrink: 0
  div.main                 ← flex: 1, flex-direction: column
    div.main__body         ← flex: 1, display: flex (가로 배치)
      aside.sidebar        ← width: 240px, flex-shrink: 0
      div.content          ← flex: 1 (WORLD / DASHBOARD 모드)
      aside#activityPanel  ← width: 320px (에이전트 선택 시 표시, 기본 숨김)
```

### 주의사항

- **절대 `position: fixed`로 UI 요소를 배치하지 말 것** (모달, 토스트 제외)
- 새 패널 추가 시 반드시 flex 레이아웃 안에서 배치해야 함
- `activityPanel`(320px)은 `width` 애니메이션 대신 `transform` + `opacity`로 열고 닫아야 함
- 대시보드 모드는 `overflow-y: auto`로 스크롤, WORLD 모드는 남은 영역을 R3F 캔버스가 채움

## 기술 스택

- TypeScript + React + React Three Fiber / Drei
- `claudeville/src/**` 는 ES Modules (import/export)
- `claudeville/server.ts`, `claudeville/adapters/*.ts`, `shared/*.js` 는 Node/CommonJS 스타일 모듈
- `npm run dev:server` → `tsx claudeville/server.ts` (서버 포트는 4000)
- split-stack 기본 포트는 hubreceiver 3030, frontend 3001
- WORLD는 Canvas 2D가 아니라 React Three Fiber 기반의 screen-space orthographic scene을 사용
- 어댑터 레지스트리는 `claudeville/adapters/index.ts`

## 데이터 소스 (멀티 프로바이더)

- **Claude Code**: `~/.claude/`
- **Codex CLI**: `~/.codex/sessions/`
- **Gemini CLI**: `~/.gemini/tmp/`
- **OpenClaw**: OpenClaw 전용 로그 디렉토리
- **GitHub Copilot CLI**: Copilot 전용 로그 디렉토리
- **VS Code / VS Code Insiders**: VS Code 전용 세션 소스
- 각 어댑터는 `claudeville/adapters/*.ts` 에 구현
- `claudeville/adapters/index.ts` 가 레지스트리 역할을 하며, 설치되었거나 실제로 사용 가능한 소스만 감지

## 모드

- **WORLD**: React/R3F 아이소메트릭 월드에서 에이전트가 캐릭터로 돌아다님
- **DASHBOARD**: 에이전트별 카드 형태로 도구 사용 / 활동 / 세션 상세를 모니터링

## 주요 기능

- **카메라 팔로우**: `getCameraFocusPosition()` + `ScreenSpaceCamera` manual orthographic camera 조합으로 따라감
- **실시간 활동 패널**: 우측 320px 패널에서 도구 히스토리, 메시지, 토큰 사용량을 폴링
- **토큰 사용량 / 비용**: shared cost helper와 세션 요약 데이터를 여러 UI에서 공유
- **텍스트 처리**: `WorldText`는 Y축을 뒤집어 월드 좌표계에서도 글자가 거꾸로 보이지 않게 함
- **대화 애니메이션**: SendMessage 사용 시 캐릭터가 상대에게 걸어가서 말풍선 표시
- **세션 감지**: provider 로그를 직접 스캔하고, React UI는 정규화된 스냅샷만 사용

## 이벤트 흐름

- `agent:selected` → ActivityPanel 열기 + 카메라 팔로우 시작
- `agent:deselected` → ActivityPanel 닫기 + 카메라 팔로우 해제
- `agent:updated` → 스프라이트 / 패널 실시간 갱신
- `agent:added` / `agent:removed` → 스프라이트 생성 / 제거
