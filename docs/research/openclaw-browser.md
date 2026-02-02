# OpenClaw/Gimli Browser Automation Capabilities Research

> Research conducted: 2026-02-01
> Task: Document browser automation capabilities in the OpenClaw-derived Gimli codebase

---

## Executive Summary

Gimli has a **comprehensive, production-grade browser automation framework** built on Playwright Core. The system supports three connection modes (local Chrome, Chrome extension relay, remote CDP), multiple browser profiles, an element reference system for AI-agent interaction, and full integration with Gimli's agent system.

---

## 1. Core Architecture

### Technology Stack
- **Engine**: Playwright Core v1.58.0 (not Puppeteer)
- **Protocol**: Chrome DevTools Protocol (CDP) via WebSocket
- **Transport**: HTTP Express server (localhost-bound for security)

### File Structure
```
src/browser/
├── pw-session.ts              # Core session management (577 LOC)
├── pw-ai.ts / pw-ai-module.ts # AI integration
├── pw-tools-core.ts           # Main tools orchestrator
├── pw-tools-core.*.ts         # 8 modular tool files:
│   ├── activity.ts            # Activity tracking
│   ├── downloads.ts           # Download handling
│   ├── interactions.ts        # Click, type, hover, drag
│   ├── responses.ts           # Network response handling
│   ├── snapshot.ts            # Page snapshots (AI/ARIA/role)
│   ├── state.ts               # Page/browser state
│   ├── storage.ts             # LocalStorage, cookies
│   └── trace.ts               # HAR recording
├── client-actions-*.ts        # Action types and execution
├── server.ts                  # HTTP control server
├── profiles*.ts               # Browser profile management
├── extension-relay.ts         # Chrome extension support
├── chrome.ts / executables.ts # Chrome discovery
├── cdp*.ts                    # CDP helpers
└── routes/                    # HTTP API endpoints
    ├── agent.ts / agent.act.ts
    ├── tabs.ts
    ├── basic.ts
    └── ...
```

---

## 2. Connection Modes

### 2.1 Local Chrome (Default)
- Gimli-managed isolated Chrome instance
- Dedicated user data directory per profile
- Connects via `chromium.connectOverCDP()`
- Full control over browser lifecycle

### 2.2 Chrome Extension Relay
- Control existing Chrome browser tabs
- Extension relay server at `extension-relay.ts`
- Useful when user wants agent to control their actual browser
- Fallback URL matching when CDP sessions blocked

### 2.3 Remote Browser
- Connect to remote browser via CDP WebSocket URL
- Supports Node host proxy for cross-machine control
- Authentication headers supported via `cdp.helpers.ts`

---

## 3. Browser Actions (Complete List)

### Core Actions (`client-actions-core.ts`)
| Action | Description | Options |
|--------|-------------|---------|
| `click` | Click element | button, modifiers, doubleClick, timeoutMs |
| `type` | Type text into field | submit, slowly, timeoutMs |
| `press` | Press keyboard key | delayMs |
| `hover` | Hover over element | timeoutMs |
| `scrollIntoView` | Scroll element into viewport | timeoutMs |
| `drag` | Drag from one element to another | startRef, endRef, timeoutMs |
| `select` | Select option in dropdown | values[], timeoutMs |
| `fill` | Fill multiple form fields | fields[], timeoutMs |
| `resize` | Resize viewport | width, height |
| `wait` | Wait for condition | timeMs, text, textGone, selector, url, loadState, fn |
| `evaluate` | Execute JavaScript | fn, ref |
| `close` | Close tab | targetId |

### Navigation & Tab Management
| Function | Description |
|----------|-------------|
| `browserNavigate()` | Navigate to URL |
| `browserTabsList()` | List all open tabs |
| `browserTabsOpen()` | Open new tab |
| `browserTabsClose()` | Close tab by targetId |
| `browserTabsFocus()` | Focus tab by targetId |
| `createPageViaPlaywright()` | Create new page |
| `focusPageByTargetIdViaPlaywright()` | Focus specific tab |

### Screenshots & Snapshots
| Function | Description |
|----------|-------------|
| `browserScreenshot()` | Capture visual screenshot |
| `browserSnapshot()` | Capture AI-optimized snapshot |
| `browserPdf()` | Generate PDF |
| `snapshotAiViaPlaywright()` | AI snapshot mode |
| `snapshotAriaViaPlaywright()` | ARIA accessibility snapshot |
| `snapshotRoleViaPlaywright()` | Role-based refs for AI agents |

### Storage & Cookies
| Function | Description |
|----------|-------------|
| `storageClearViaPlaywright()` | Clear localStorage/sessionStorage |
| `storageGetViaPlaywright()` | Get storage data |
| `storageSetViaPlaywright()` | Set storage data |
| `cookiesGetViaPlaywright()` | Get all cookies |
| `cookiesSetViaPlaywright()` | Set cookies |
| `cookiesClearViaPlaywright()` | Clear all cookies |

### File & Download Handling
| Function | Description |
|----------|-------------|
| `waitForDownloadViaPlaywright()` | Wait for download |
| `downloadViaPlaywright()` | Trigger and track download |
| `armFileUploadViaPlaywright()` | Prepare file upload handler |
| `setInputFilesViaPlaywright()` | Set file input |

### Device & Environment Emulation
| Function | Description |
|----------|-------------|
| `setDeviceViaPlaywright()` | Emulate specific device |
| `setLocaleViaPlaywright()` | Set browser locale |
| `setTimezoneViaPlaywright()` | Set timezone |
| `setGeolocationViaPlaywright()` | Set geolocation |
| `setOfflineViaPlaywright()` | Simulate offline |
| `emulateMediaViaPlaywright()` | Emulate media features |

### Network & Authentication
| Function | Description |
|----------|-------------|
| `setHttpCredentialsViaPlaywright()` | Set HTTP basic auth |
| `setExtraHTTPHeadersViaPlaywright()` | Add custom headers |
| `traceStartViaPlaywright()` | Start HAR recording |
| `traceStopViaPlaywright()` | Stop and save HAR trace |

---

## 4. Element Reference System

### Overview
The system uses role-based element references (e.g., `e1`, `e2`) to allow AI agents to interact with page elements without fragile CSS selectors.

### Reference Modes
1. **Role Mode** (`roleRefsMode: "role"`)
   - Refs generated from ARIA snapshot
   - Resolved via Playwright's `getByRole()`

2. **ARIA Mode** (`roleRefsMode: "aria"`)
   - Refs are Playwright aria-ref IDs
   - Resolved via `aria-ref=...` locator

### Reference Resolution (`refLocator()`)
```typescript
// Converts element references to Playwright locators
// Supports:
// - @ref format
// - ref= format
// - ARIA ref for native Playwright locators
// - Frame selector support for iframes
```

### Caching Strategy
- `roleRefsByTarget` Map caches refs by CDP target ID
- Max 50 cached targets (`MAX_ROLE_REFS_CACHE`)
- Ensures stability across Playwright Page object changes

---

## 5. Page State Tracking

### Per-Page State (`PageState`)
| Property | Description | Max Size |
|----------|-------------|----------|
| `console` | Console messages | 500 messages |
| `errors` | Page errors with stack traces | 200 errors |
| `requests` | Network requests | 500 requests |
| `requestIds` | WeakMap for request tracking | - |
| `roleRefs` | Current role-based refs | - |
| `armIdUpload/Dialog/Download` | Handler IDs | - |

### Context State (`ContextState`)
- `traceActive`: Whether HAR trace is recording

### Event Listeners (Auto-Attached)
- Console message events (with location info)
- Page error events (with stack traces)
- Network request lifecycle (start, response, failure)
- Dialog handlers
- Download handlers
- File chooser handlers

---

## 6. CLI Commands

Based on OpenClaw documentation, these browser commands are available:

```bash
# Lifecycle
gimli browser start|stop|status

# Navigation & Tabs
gimli browser open <url>
gimli browser navigate <url>
gimli browser tabs

# Interactions
gimli browser click <ref>
gimli browser type <ref> "text"
gimli browser fill <ref> "value"

# Capture
gimli browser screenshot [--path <file>]
gimli browser snapshot [--mode ai|aria|role]
gimli browser pdf [--path <file>]

# Advanced
gimli browser evaluate "js code"
```

---

## 7. HTTP API Endpoints

### Tab Management
- `GET /browser/tabs` - List open tabs
- `POST /browser/tabs/open` - Open new tab
- `POST /browser/tabs/close` - Close tab
- `POST /browser/tabs/focus` - Focus tab

### Agent Endpoints
- `POST /browser/agent/snapshot` - Get page snapshot
- `POST /browser/agent/act` - Execute action
- `GET /browser/agent/debug` - Debug information

### Storage Endpoints
- `GET /browser/agent/storage` - Get storage
- `POST /browser/agent/storage` - Set storage
- `DELETE /browser/agent/storage` - Clear storage

### Basic Control
- `POST /navigate` - Navigate to URL
- `POST /hooks/dialog` - Handle dialog
- `POST /hooks/file` - Handle file chooser

---

## 8. Security Features

### Network Security
- Server binds to localhost only (`127.0.0.1`)
- No external network exposure by default
- CDP URLs can include authentication headers

### Profile Isolation
- Separate user data directories per profile
- Independent cookie/storage per profile
- Named profiles supported

### Extension Relay Safety
- Sandboxed control of existing tabs
- Requires explicit extension installation
- Fallback mechanisms for blocked CDP

---

## 9. AI Agent Integration

### Snapshot Modes for AI
1. **AI Snapshot** - Optimized for AI vision/understanding
2. **ARIA Snapshot** - Accessibility tree representation
3. **Role Snapshot** - Element refs with role, name, nth info

### Agent Route Endpoints
- `/browser/agent/snapshot` - Get snapshot for AI analysis
- `/browser/agent/act` - Execute action from AI decision
- `/browser/agent/debug` - Debug current state

### Integration Points
- Pi agent RPC mode with tool streaming
- Tool definitions for browser actions
- Session management integration

---

## 10. Test Coverage

Extensive test suite covering:
- `pw-session.test.ts` - Session management
- `pw-session.browserless.live.test.ts` - Live tests
- `pw-ai.test.ts` - AI integration
- `client.test.ts` - Client actions
- `browser-tool-integration.test.ts` - Tool integration
- Multiple specialized test files for specific features

---

## 11. Comparison with OpenClaw Documentation

### Feature Parity (Confirmed)
| Feature | OpenClaw | Gimli |
|---------|----------|-------|
| Local Chrome mode | ✅ | ✅ |
| Chrome Extension relay | ✅ | ✅ |
| Remote browser | ✅ | ✅ |
| Profile management | ✅ | ✅ |
| Role-based refs | ✅ | ✅ |
| Screenshot/PDF | ✅ | ✅ |
| HAR trace recording | ✅ | ✅ |
| Cookie/storage control | ✅ | ✅ |

### CLI Command Mapping
| OpenClaw Command | Gimli Equivalent |
|------------------|------------------|
| `openclaw browser start` | `gimli browser start` |
| `openclaw browser stop` | `gimli browser stop` |
| `openclaw browser open` | `gimli browser open` |
| `openclaw browser click` | `gimli browser click` |
| `openclaw browser snapshot` | `gimli browser snapshot` |

---

## 12. Key Implementation Details

### Session Connection Flow
```typescript
// pw-session.ts
1. Get Chrome WebSocket URL (getChromeWebSocketUrl)
2. Connect via chromium.connectOverCDP()
3. Set up page listeners (console, errors, network)
4. Track page state in WeakMaps
5. Cache role refs by target ID
```

### Action Execution Flow
```typescript
// client-actions-core.ts
1. Build action request (BrowserActRequest)
2. POST to appropriate endpoint
3. Server resolves element ref to locator
4. Execute Playwright action
5. Return result with targetId
```

### Snapshot Generation
```typescript
// pw-tools-core.snapshot.ts
1. Capture accessibility tree or DOM
2. Generate element refs (e1, e2, ...)
3. Store refs in page state
4. Return formatted snapshot for AI
```

---

## 13. Recommendations for Future Work

### Immediate Enhancements
1. Document CLI browser commands in user docs
2. Add browser profile configuration guide
3. Create browser automation tutorial

### Medium-Term
1. Add recording/replay functionality
2. Implement browser extension for easier relay setup
3. Add visual debugging tools

### Long-Term
1. Multi-browser support (Firefox, Safari via Playwright)
2. Cloud browser service integration (Browserless, etc.)
3. Browser action macro system

---

## Sources

- `/home/gimli/github/gimli/src/browser/` - Source code analysis
- `/home/gimli/github/gimli/docs/OPENCLAW_SKILLS_RESEARCH.md` - OpenClaw ecosystem research
- Playwright Core documentation
- OpenClaw official documentation (referenced in research doc)
