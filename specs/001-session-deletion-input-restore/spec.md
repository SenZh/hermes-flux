# Specification: Session Deletion Input Restore and Full CDP Verification

**Feature Name**: `session-deletion-input-restore`  
**Feature Directory**: `specs/001-session-deletion-input-restore`  
**Created**: 2026-11-01  
**Status**: Ready for Planning / Implementation

---

## 1. Executive Summary & Problem Definition

### 1.1 Context
In Hermes Flux desktop and web client applications, users manage conversations (sessions) via the Left Rail sidebar, interact with bots or human users via the Middle Pod conversation canvas, and dispatch messages using the Input Dock.

### 1.2 Problem Statement
1. **Critical Input Dock Lockout After Session Deletion**: When a user right-clicks on any session in the Left Rail and confirms deletion, the user input box (`#dock-prompt-input`) becomes unresponsive or un-inputtable across all remaining and newly switched sessions. Users can neither type nor submit prompts into the composer dock.
2. **End-to-End Verification Deficit**: Recent features (Agent renaming, group inline rename, tool execution packages, Workspace badges, three-state activity indicators) require physical, real-engine verification via Chrome DevTools Protocol (CDP) to guarantee DOM hierarchy integrity, event binding resilience, and non-blocking layout invariants.

### 1.3 Value Proposition
- Restores 100% input composer reliability across all session lifecycle events (delete, switch, create, archive).
- Provides comprehensive headless browser CDP validation proving that session deletion properly cleans up state, refocuses the active session or fallback agent workspace, and maintains responsive keyboard input.

---

## 2. User Scenarios & Acceptance Test Cases

### 2.1 User Scenario 1: Delete Active Session and Continue Typing
- **Given**: A user has multiple sessions in the Left Rail, with Session A currently selected and the input composer focused.
- **When**: The user right-clicks Session A, selects "Delete" (or clicks the delete action button), and confirms the deletion dialog.
- **Then**:
  1. Session A is removed from the Left Rail without residue.
  2. The application automatically and smoothly transitions focus to the next available session (or to the default Agent Forever Chat if no sessions remain).
  3. The Input Dock (`#dock-prompt-input`) remains completely enabled, focusable, and accepts keyboard input immediately.
  4. The user types a message and presses Enter; the message is dispatched normally.

### 2.2 User Scenario 2: Delete Inactive Session While Composing
- **Given**: The user is currently typing a draft in active Session A.
- **When**: The user right-clicks inactive Session B in the Left Rail, confirms deletion.
- **Then**:
  1. Session B is deleted from the server and local rail.
  2. Session A remains active; the draft text in `#dock-prompt-input` is preserved intact.
  3. The input box continues to receive keydown/input events without losing focus or becoming disabled.

### 2.3 User Scenario 3: Delete the Sole/Last Remaining Session
- **Given**: Only one session exists in the session list.
- **When**: The user deletes this sole session.
- **Then**:
  1. The Left Rail shows the clean empty session placeholder.
  2. The application safely resets the active session identifier without crashing.
  3. The Input Dock remains enabled (`disabled === false`), ready for the user to type a new goal; typing a message and sending automatically creates a brand-new session.

### 2.4 User Scenario 4: CDP End-to-End Headless Browser Physical Audit
- **Given**: An Edge/Chrome headless browser instance driven by Chrome DevTools Protocol.
- **When**: The CDP test runner loads the application harness, generates multiple sessions, triggers right-click deletion, verifies input focusability, types text via `Input.dispatchKeyEvent`, and verifies DOM state transitions.
- **Then**:
  1. All CDP physical interaction assertions pass with zero console errors or unhandled rejections.
  2. Input box value reflects typed characters (`value === "hello world"`).
  3. The active composer bounding box and click targets comply with $\ge 44\text{pt}$ touch/pointer targets.

---

## 3. Functional Requirements

### 3.1 Session Deletion State Transition
- **REQ-DEL-01**: Session deletion MUST explicitly clear `sessionDraftMap` entries and cached message structures associated with the deleted session ID.
- **REQ-DEL-02**: When the currently active session is deleted, the active session pointer MUST cleanly transition to `state.sessions[0].id` if available, or fall back to the default agent profile.
- **REQ-DEL-03**: The input dock disabled state MUST ONLY depend on `!state.gatewayConnected`. It MUST NEVER be permanently latched into a disabled or pointer-events-blocked state due to missing session identifiers.
- **REQ-DEL-04**: Session deletion MUST ensure `state.sessionContextMenu` is dismissed and any modal backdrops or pointer-blocking overlays are completely destroyed in the DOM.

### 3.2 Input Dock Event & Focus Continuity
- **REQ-INP-01**: Subtree isolation updates (`#input-dock-container`) MUST rebind input events (`input`, `keydown`, `compositionstart`, `compositionend`) on every DOM replacement.
- **REQ-INP-02**: Textarea draft preservation logic MUST NOT overwrite live keyboard input with stale deleted session drafts.
- **REQ-INP-03**: The Input Dock textarea MUST always allow focus (`element.focus()`) and accept standard text input following any delete or switch operation.

### 3.3 CDP Automated Verification Suite
- **REQ-CDP-01**: A dedicated CDP integration test suite (`session-deletion-cdp.test.mjs`) MUST run in headless Blink/Edge engine and execute the physical user journey of right-click session deletion and subsequent prompt input.
- **REQ-CDP-02**: CDP tests MUST assert that `document.activeElement` or `#dock-prompt-input` has `disabled === false`, `readOnly === false`, and `style.pointerEvents !== 'none'`.

---

## 4. Non-Functional & Boundary Constraints

- **CONSTR-01 (Monorepo Separation)**: Core business and RPC normalization rules must remain in `packages/core`; pure UI components in `packages/ui`; electron/browser shell logic in `packages/desktop`.
- **CONSTR-02 (Anti-Slop Ratchet)**: Zero `as any` type escapes; zero hardcoded color tokens; zero unlocalized UI strings.
- **CONSTR-03 (Memory & Leak Prevention)**: Deleting sessions must release references in `sessionDraftMap`, `sessionMessagesCache`, and `sessionServerOffset` to avoid memory accumulation over long runtime sessions.

---

## 5. Success Criteria & Quality Metrics

1. **Input Usability Rate**: 100% of session deletion paths (right-click menu delete, hover trash button delete, last-session delete) result in an immediately editable Input Dock.
2. **Automated Verification**: `npm run verify` passes with 0 type errors, 0 gate violations, and 100% green test assertions across all test suites.
3. **CDP Physical Audit**: A real headless browser test boots, deletes sessions via physical clicks, types via simulated hardware key events, and confirms the input value matches with 0 errors.
