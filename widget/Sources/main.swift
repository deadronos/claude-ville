import Cocoa
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    private let defaultHubHTTPURL = "http://localhost:3030"
    private let petWindowWidth: CGFloat = 224
    private let petWindowHeight: CGFloat = 256

    var statusItem: NSStatusItem!
    var popover: NSPopover!
    var popoverWebView: WKWebView!
    var petWindow: NSPanel!
    var petWebView: WKWebView!
    var dashboardWindow: NSWindow?
    var dashboardWebView: WKWebView?
    var runtimeConfig: [String: String] = [:]

    func applicationDidFinishLaunching(_ notification: Notification) {
        runtimeConfig = resolveRuntimeConfig()
        setupStatusItem()
        setupPopover()
        setupPetWindow()
        showPetWindow()
    }

    func applicationWillTerminate(_ notification: Notification) {
        savePetFrame()
    }

    func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        guard let button = statusItem.button else { return }
        button.title = "* 0"
        button.font = NSFont.systemFont(ofSize: 13)
        button.action = #selector(statusItemClicked(_:))
        button.target = self
        button.sendAction(on: [.leftMouseUp, .rightMouseUp])
    }

    @objc func statusItemClicked(_ sender: NSStatusBarButton) {
        guard let event = NSApp.currentEvent else { return }
        if event.type == .rightMouseUp {
            showMenu()
        } else {
            togglePopover()
        }
    }

    func setupPopover() {
        popoverWebView = makeWebView(handlerNames: [
            "badge",
            "petState",
            "openDashboard",
            "togglePet",
            "quit",
        ])
        popoverWebView.frame = NSRect(x: 0, y: 0, width: 320, height: 360)
        loadResource("popover", extensionName: "html", into: popoverWebView)

        let viewController = NSViewController()
        viewController.view = popoverWebView

        popover = NSPopover()
        popover.contentSize = NSSize(width: 320, height: 360)
        popover.behavior = .transient
        popover.contentViewController = viewController
        popover.animates = true
    }

    func setupPetWindow() {
        let frame = loadPetFrame()
        petWindow = NSPanel(
            contentRect: frame,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        petWindow.isOpaque = false
        petWindow.backgroundColor = .clear
        petWindow.hasShadow = false
        petWindow.level = .floating
        petWindow.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        petWindow.isMovableByWindowBackground = true
        petWindow.isReleasedWhenClosed = false

        petWebView = makeWebView(handlerNames: [
            "badge",
            "petState",
            "petDrag",
            "openDashboard",
            "togglePet",
            "quit",
            "openPopover",
        ])
        petWebView.frame = NSRect(x: 0, y: 0, width: frame.width, height: frame.height)
        petWebView.autoresizingMask = [.width, .height]

        let contentView = DraggableContentView(frame: petWebView.frame) { [weak self] in
            self?.savePetFrame()
        }
        contentView.autoresizingMask = [.width, .height]
        contentView.addSubview(petWebView)
        petWindow.contentView = contentView

        loadResource("pet", extensionName: "html", into: petWebView)
    }

    func makeWebView(handlerNames: [String]) -> WKWebView {
        let config = WKWebViewConfiguration()
        let controller = WKUserContentController()
        for name in handlerNames + ["diagnostic"] {
            controller.add(MessageHandler(delegate: self, name: name), name: name)
        }
        controller.addUserScript(WKUserScript(
            source: injectedBootstrapScript(),
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        config.userContentController = controller
        config.preferences.javaScriptCanOpenWindowsAutomatically = true
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        config.setValue(true, forKey: "allowUniversalAccessFromFileURLs")

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.setValue(false, forKey: "drawsBackground")
        webView.allowsBackForwardNavigationGestures = false
        webView.navigationDelegate = self
        return webView
    }

    func injectedBootstrapScript() -> String {
        let data = try? JSONSerialization.data(withJSONObject: runtimeConfig, options: [])
        let json = data.flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        return """
        window.__CLAUDEVILLE_WIDGET_CONFIG__ = \(json);
        (function () {
          function send(level, args) {
            try {
              var text = Array.prototype.map.call(args, function (value) {
                if (value instanceof Error) return value.stack || value.message;
                if (typeof value === 'string') return value;
                try { return JSON.stringify(value); } catch (_) { return String(value); }
              }).join(' ');
              window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.diagnostic &&
                window.webkit.messageHandlers.diagnostic.postMessage({ level: level, text: text });
            } catch (_) {}
          }
          ['log', 'warn', 'error'].forEach(function (level) {
            var original = console[level];
            console[level] = function () {
              send(level, arguments);
              if (original) original.apply(console, arguments);
            };
          });
          window.addEventListener('error', function (event) {
            send('error', [event.message || 'script error', event.filename || '', event.lineno || 0]);
          });
          window.addEventListener('unhandledrejection', function (event) {
            send('error', ['unhandled rejection', event.reason]);
          });
        }());
        """
    }

    func receiveDiagnostic(_ payload: Any) {
        guard let dict = payload as? [String: Any] else { return }
        let level = dict["level"] as? String ?? "log"
        let text = dict["text"] as? String ?? String(describing: payload)
        NSLog("ClaudeVilleWidget JS [\(level)]: \(text)")
    }

    func loadResource(_ name: String, extensionName: String, into webView: WKWebView) {
        guard let url = Bundle.main.url(forResource: name, withExtension: extensionName) else {
            NSLog("ClaudeVilleWidget: missing resource \(name).\(extensionName)")
            return
        }
        let readAccessURL = Bundle.main.resourceURL ?? url.deletingLastPathComponent()
        webView.loadFileURL(url, allowingReadAccessTo: readAccessURL)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let script = """
        JSON.stringify({
          href: location.href,
          readyState: document.readyState,
          bodyText: document.body ? document.body.innerText : '',
          scripts: Array.prototype.map.call(document.scripts, function (script) { return { type: script.type, src: script.src }; }),
          hasConfig: !!window.__CLAUDEVILLE_WIDGET_CONFIG__,
          hasWebSocket: typeof WebSocket
        })
        """
        webView.evaluateJavaScript(script) { result, error in
            if let error = error {
                NSLog("ClaudeVilleWidget: webview diagnostic failed: \(error)")
                return
            }
            NSLog("ClaudeVilleWidget: webview loaded \(String(describing: result))")
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        NSLog("ClaudeVilleWidget: webview navigation failed: \(error)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        NSLog("ClaudeVilleWidget: webview provisional navigation failed: \(error)")
    }

    func togglePopover() {
        if popover.isShown {
            popover.performClose(nil)
        } else {
            openPopover()
        }
    }

    @objc func openPopover() {
        guard let button = statusItem.button else { return }
        if popover.isShown {
            popover.contentViewController?.view.window?.makeKey()
            return
        }
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        popover.contentViewController?.view.window?.makeKey()
        NSApp.activate(ignoringOtherApps: true)
    }

    func showMenu() {
        let menu = NSMenu()
        let petTitle = petWindow?.isVisible == true ? "Hide Pet" : "Show Pet"
        menu.addItem(makeMenuItem(title: petTitle, action: #selector(togglePetFromMenu), keyEquivalent: "p"))
        menu.addItem(makeMenuItem(title: "Open Dashboard", action: #selector(openDashboard), keyEquivalent: "d"))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(makeMenuItem(title: "Quit", action: #selector(quitApp), keyEquivalent: "q"))
        statusItem.menu = menu
        statusItem.button?.performClick(nil)
        statusItem.menu = nil
    }

    func makeMenuItem(title: String, action: Selector, keyEquivalent: String) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: keyEquivalent)
        item.target = self
        return item
    }

    @objc func showPetWindow() {
        petWindow.orderFrontRegardless()
    }

    func hidePetWindow() {
        savePetFrame()
        petWindow.orderOut(nil)
    }

    @objc func togglePetFromMenu() {
        setPetVisible(!(petWindow?.isVisible ?? false))
    }

    func setPetVisible(_ visible: Bool) {
        if visible {
            showPetWindow()
        } else {
            hidePetWindow()
        }
    }

    func updateBadge(_ payload: Any) {
        guard let dict = payload as? [String: Any] else { return }
        let working = intValue(dict["working"])
        let waiting = intValue(dict["waiting"])
        if waiting > 0 {
            statusItem.button?.title = "* \(working) !"
        } else {
            statusItem.button?.title = "* \(working)"
        }
    }

    func receivePetState(_ payload: Any) {
        guard let dict = payload as? [String: Any], let line = dict["line"] as? String, !line.isEmpty else {
            return
        }
        petWindow?.setAccessibilityLabel("ClaudeVille pet: \(line)")
    }

    func receivePetDrag(_ payload: Any) {
        guard let dict = payload as? [String: Any], let phase = dict["phase"] as? String else {
            return
        }

        if phase == "move" {
            let dx = CGFloat(doubleValue(dict["dx"]))
            let dy = CGFloat(doubleValue(dict["dy"]))
            guard let window = petWindow, dx != 0 || dy != 0 else { return }
            let origin = window.frame.origin
            window.setFrameOrigin(NSPoint(x: origin.x + dx, y: origin.y - dy))
        } else if phase == "end" {
            savePetFrame()
        }
    }

    @objc func openDashboard() {
        let dashboardURL = runtimeConfig["HUB_HTTP_URL"] ?? runtimeConfig["HUB_URL"] ?? defaultHubHTTPURL
        guard let url = URL(string: dashboardURL) else { return }

        if let window = dashboardWindow, window.isVisible {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }

        let screen = NSScreen.main ?? NSScreen.screens[0]
        let width: CGFloat = 1200
        let height: CGFloat = 800
        let frame = NSRect(
            x: screen.visibleFrame.midX - width / 2,
            y: screen.visibleFrame.midY - height / 2,
            width: width,
            height: height
        )
        let window = NSWindow(
            contentRect: frame,
            styleMask: [.titled, .closable, .resizable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = "ClaudeVille Dashboard"
        window.minSize = NSSize(width: 800, height: 600)
        window.isReleasedWhenClosed = false

        let webView = WKWebView(frame: window.contentView?.bounds ?? .zero)
        webView.autoresizingMask = [.width, .height]
        webView.load(URLRequest(url: url))
        window.contentView?.addSubview(webView)

        dashboardWebView = webView
        dashboardWindow = window
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc func quitApp() {
        savePetFrame()
        NSApp.terminate(nil)
    }

    func loadPetFrame() -> NSRect {
        let defaults = UserDefaults.standard
        if defaults.object(forKey: "petWindowX") != nil && defaults.object(forKey: "petWindowY") != nil {
            return NSRect(
                x: defaults.double(forKey: "petWindowX"),
                y: defaults.double(forKey: "petWindowY"),
                width: petWindowWidth,
                height: petWindowHeight
            )
        }

        let screen = NSScreen.main ?? NSScreen.screens[0]
        return NSRect(
            x: screen.visibleFrame.maxX - petWindowWidth - 32,
            y: screen.visibleFrame.minY + 64,
            width: petWindowWidth,
            height: petWindowHeight
        )
    }

    func savePetFrame() {
        guard let frame = petWindow?.frame else { return }
        UserDefaults.standard.set(frame.origin.x, forKey: "petWindowX")
        UserDefaults.standard.set(frame.origin.y, forKey: "petWindowY")
    }

    func resolveRuntimeConfig() -> [String: String] {
        guard let projectPath = readProjectPath() else {
            return ["HUB_HTTP_URL": defaultHubHTTPURL]
        }

        var env = readEnvFile(projectPath: projectPath)
        if env["HUB_HTTP_URL"] == nil {
            env["HUB_HTTP_URL"] = env["HUB_URL"] ?? defaultHubHTTPURL
        }
        return env
    }

    func readProjectPath() -> String? {
        guard let resourceURL = Bundle.main.resourceURL else { return nil }
        let fileURL = resourceURL.appendingPathComponent("project_path")
        guard let path = try? String(contentsOf: fileURL, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines) else {
            return nil
        }
        return path.isEmpty ? nil : path
    }

    func readEnvFile(projectPath: String) -> [String: String] {
        let envPath = (projectPath as NSString).appendingPathComponent(".env.local")
        guard let content = try? String(contentsOfFile: envPath, encoding: .utf8) else { return [:] }

        var env: [String: String] = [:]
        for line in content.components(separatedBy: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty, !trimmed.hasPrefix("#"), let separator = trimmed.firstIndex(of: "=") else {
                continue
            }

            var key = String(trimmed[..<separator]).trimmingCharacters(in: .whitespacesAndNewlines)
            if key.hasPrefix("export ") {
                key = String(key.dropFirst("export ".count)).trimmingCharacters(in: .whitespacesAndNewlines)
            }
            let rawValue = String(trimmed[trimmed.index(after: separator)...]).trimmingCharacters(in: .whitespacesAndNewlines)
            if !key.isEmpty {
                env[key] = unquote(rawValue)
            }
        }
        return env
    }

    func unquote(_ value: String) -> String {
        guard value.count >= 2 else { return value }
        let first = value.first
        let last = value.last
        if (first == "\"" && last == "\"") || (first == "'" && last == "'") {
            return String(value.dropFirst().dropLast())
        }
        return value
    }

    func intValue(_ value: Any?) -> Int {
        if let int = value as? Int { return int }
        if let double = value as? Double { return Int(double) }
        if let string = value as? String, let int = Int(string) { return int }
        return 0
    }

    func doubleValue(_ value: Any?) -> Double {
        if let double = value as? Double { return double }
        if let int = value as? Int { return Double(int) }
        if let string = value as? String, let double = Double(string) { return double }
        return 0
    }
}

final class DraggableContentView: NSView {
    private let onMoveEnded: () -> Void

    init(frame frameRect: NSRect, onMoveEnded: @escaping () -> Void) {
        self.onMoveEnded = onMoveEnded
        super.init(frame: frameRect)
    }

    required init?(coder: NSCoder) {
        self.onMoveEnded = {}
        super.init(coder: coder)
    }

    override var isFlipped: Bool {
        true
    }

    override func mouseDragged(with event: NSEvent) {
        guard let window = self.window else { return }
        let origin = window.frame.origin
        window.setFrameOrigin(NSPoint(x: origin.x + event.deltaX, y: origin.y - event.deltaY))
    }

    override func mouseUp(with event: NSEvent) {
        onMoveEnded()
    }
}

final class MessageHandler: NSObject, WKScriptMessageHandler {
    weak var delegate: AppDelegate?
    let name: String

    init(delegate: AppDelegate, name: String) {
        self.delegate = delegate
        self.name = name
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        switch name {
        case "badge":
            delegate?.updateBadge(message.body)
        case "petState":
            delegate?.receivePetState(message.body)
        case "petDrag":
            delegate?.receivePetDrag(message.body)
        case "openDashboard":
            delegate?.openDashboard()
        case "togglePet":
            let visible = (message.body as? [String: Any])?["visible"] as? Bool ?? true
            delegate?.setPetVisible(visible)
        case "quit":
            delegate?.quitApp()
        case "openPopover":
            delegate?.openPopover()
        case "diagnostic":
            delegate?.receiveDiagnostic(message.body)
        default:
            break
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
