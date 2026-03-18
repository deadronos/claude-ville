# Integration Troubleshooting

### macOS 메뉴바 위젯 WKWebView WebSocket 연결 불가 [#1]

- **Symptom**: NSPopover 안의 WKWebView에서 widget.html 로드 후 `ws://localhost:4000` WebSocket 연결 시도하면 연결 안 됨. 같은 앱의 NSWindow WKWebView에서 `http://localhost:4000` 로드는 정상 동작. 메뉴바 뱃지가 `● 3` → `● 0`으로 깜빡임.
- **Cause**:
  1. WKWebView는 out-of-process 렌더링이라 `com.apple.security.network.client` entitlement 필요
  2. `swiftc` 단일 파일 빌드는 Xcode entitlement 시스템 사용 불가
  3. `loadFileURL` → `file://`에서 `ws://` 보안 차단, `loadHTMLString(baseURL: localhost)` → 여전히 차단
  4. Info.plist `NSAllowsLocalNetworking` / `NSAllowsArbitraryLoadsInWebContent` 추가해도 효과 없음
  5. JS→Swift bridge(`webkit.messageHandlers.badge`)가 WebSocket 실패 시 badge를 0으로 덮어써서 Swift 폴링 결과와 충돌
- **Fix**: WKWebView를 순수 렌더링용으로만 사용, WebSocket 완전 제거:
  1. Swift `Timer`로 3초마다 `/api/sessions` REST API 직접 호출 (`URLSession`)
  2. 응답 JSON으로 Swift에서 HTML 문자열 동적 생성 (`buildHTML()`)
  3. `webView.loadHTMLString(html, baseURL: nil)` → 네트워크 연결 불필요
  4. 뱃지 업데이트는 Swift에서만 처리 (JS→Swift badge 통신 완전 제거)
  5. `Open Dashboard` 버튼만 `webkit.messageHandlers.openDashboard`로 처리
- **Files**: `widget/Sources/main.swift`, `widget/Info.plist`
- **Date**: 2026-02-23
- **Tags**: macOS, WKWebView, NSPopover, NSStatusItem, WebSocket, swiftc, entitlement, menubar, widget

---

### fnm 임시 경로로 인한 서버 자동 시작 실패 [#2]

- **Symptom**: 메뉴바 위젯에서 서버 자동 시작 기능이 동작 안 함. 빌드 시점에 기록된 node 경로가 앱 재실행 시 존재하지 않음.
- **Cause**: `which node`가 fnm 임시 multishell 경로 반환 (`~/.local/state/fnm_multishells/{PID}_{TIMESTAMP}/bin/node`). 이 경로는 쉘 세션마다 바뀌므로 앱 번들에 기록해도 다음 실행 시 파일이 없음.
- **Fix**: `build.sh`에서 `readlink -f "$(which node)"`로 심볼릭 링크를 해제한 실제 영구 경로를 기록. 영구 경로 예시: `~/.local/share/fnm/node-versions/v20.20.0/installation/bin/node`. Swift 코드에서도 fallback으로 fnm 영구 경로 직접 탐색: `~/.local/share/fnm/node-versions/*/installation/bin/node`.
- **Files**: `widget/build.sh`, `widget/Sources/main.swift`
- **Date**: 2026-02-23
- **Tags**: fnm, node, readlink, symlink, macOS, 자동시작, build.sh

---

### macOS 앱 내 Process()로 lsof 실행 시 무한 대기 [#3]

- **Symptom**: 위젯 앱 `applicationDidFinishLaunching`에서 `Process()`로 `/usr/bin/lsof -ti :4000` 실행 후 `waitUntilExit()` 호출하면 영원히 반환 안 됨. 로그에 "서버 시작 체크..." 한 줄만 찍히고 이후 진행 없음.
- **Cause**: LSUIElement 메뉴바 앱 환경에서 `lsof` 프로세스가 행(hang). Finder/Spotlight에서 실행된 앱은 터미널과 다른 보안 컨텍스트에서 동작하며, `lsof`가 네트워크 소켓 정보 접근 시 권한 문제로 무한 대기할 수 있음.
- **Fix**: 포트 체크 로직 자체를 제거. 서버 중복 실행 시 `server.js`가 `EADDRINUSE` 에러를 내므로, 그냥 항상 서버 시작을 시도하고 실패하면 무시. `try? proc.run()` 패턴 사용.
- **Files**: `widget/Sources/main.swift`
- **Date**: 2026-02-23
- **Tags**: macOS, Process, lsof, waitUntilExit, hang, LSUIElement, 메뉴바앱
