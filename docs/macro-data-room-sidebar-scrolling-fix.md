# AI Capital Intelligence — Macro Intelligence Data Room Sidebar Scrolling Fix
**Document Identifier:** `DOC-DR-SCROLL-20261110-V1`  
**Status:** FULL PRODUCTION VERIFICATION PASSED  
**Execution Authority:** Strictly `none` (`LIVE_TRADING_ENABLED=false`, `DEMO_TRADING_ENABLED=false`)  
**Commit:** `150339e` (`main`)  
**Production Domain:** `https://capital.aiguides.co.uk`  
**Verified Route:** `https://capital.aiguides.co.uk/data-room`  
**Verification Date:** 10 November 2026  

---

## 1. Executive Summary & Defect Overview

In the live Macro Intelligence Data Room (`/data-room`), selecting an infrastructure relationship on the Executive Overview (such as the default selected Loughton Microsoft / Nscale relationship `rel-loughton-msft-r2`, version 2) loads the right-hand **"Immutable Evidence Drawer"**. 

Previously, the Evidence Drawer content expanded vertically to over 942px without independent scrolling constraints:
- On desktop viewports (e.g., 1440×900, 1280×720), the bottom source documents (specifically `reuters-loughton-oct19`) and the Stage 4 Human Review / Outbox promotion controls fell below the fold and were cut off.
- Mouse wheel attempts over the drawer did not scroll the drawer contents, instead bubbling up to scroll the background page.
- Keyboard navigation (PageDown, ArrowDown) could not focus or traverse the drawer.

---

## 2. Root Cause Analysis

An architectural audit of [`app/data-room/data-room.css`](file:///c:/GPT%205%20CODEX/Trading%20app/app/data-room/data-room.css) and [`components/macro-data-room.tsx`](file:///c:/GPT%205%20CODEX/Trading%20app/components/macro-data-room.tsx) revealed the four root causes:

1. **Unconstrained Sticky Container Height:**
   - `.dr-evidence-drawer` had `position: sticky; top: 20px;` but **no height or `max-height` rule**, and **no overflow constraint**.
   - As a result, the drawer expanded to its natural content height (~942px for Loughton v2), spilling beyond standard viewport bounds (860px available at 900px viewport, 680px available at 720px viewport).

2. **Missing Internal Flexbox & Scroll Container:**
   - The drawer contained multiple elements directly inside the outer card: header, metadata definition list, TypeDB relationship projection details, and source cards.
   - None of the child containers had `overflow-y: auto`, `min-height: 0`, or `flex: 1 1 auto`.

3. **Missing Header Pinning:**
   - Without separating the header (`.dr-drawer-header`) from the body, any naive overflow on the outer container would cause the relationship title, version tag, and epistemic classification badge to scroll out of view when reading sources.

4. **Mobile Responsiveness Gap:**
   - On screens $\le 1080\text{px}$, the desktop drawer was hidden via `display: none`, and the mobile drawer backdrop was rendered only conditionally when opened, but lacked a discoverable persistent floating trigger bar and contained no keyboard accessibility region.

---

## 3. Engineering Solution & Implementation

### A. Pinned Header & Scrollable Body Architecture
In [`components/macro-data-room.tsx`](file:///c:/GPT%205%20CODEX/Trading%20app/components/macro-data-room.tsx):
- Refactored `renderEvidenceDrawerContent` into a structured flex layout:
  1. Outer container: `<div data-testid="evidence-drawer-content" className="dr-drawer-inner">`
  2. Fixed header: `<div className="dr-drawer-header">` pinned at the top, displaying:
     - Eyebrow: `IMMUTABLE EVIDENCE DRAWER`
     - Relationship ID and version: `{rel.relationshipId} (v{rel.version})`
     - Epistemic status badge: `{rel.epistemicStatus}` (e.g. `fact`)
     - Contractual status tag: `{rel.contractualStatus}` (e.g. `contractually_binding`)
  3. Independent scroll body: `<div className="dr-drawer-scrollable-body" data-testid="evidence-drawer-scrollable-body" tabIndex={0} role="region" aria-label="Evidence details and source records">`
     - Houses conditions summary, capacity/principal definition list, TypeDB graph metadata, linked source records, and Stage 4 review box.
     - `tabIndex={0}` allows immediate keyboard focus and arrow/page navigation without mouse interactions.

### B. Viewport-Bounded CSS Mathematics
In [`app/data-room/data-room.css`](file:///c:/GPT%205%20CODEX/Trading%20app/app/data-room/data-room.css):
- `.dr-evidence-drawer`:
  - `position: sticky; top: 20px;`
  - `height: calc(100vh - 40px);`
  - `max-height: calc(100vh - 40px);`
  - `display: flex; flex-direction: column; min-height: 0; overflow: hidden;`
- `.dr-drawer-inner`:
  - `display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden;`
- `.dr-drawer-header`:
  - `flex-shrink: 0; padding: 16px 20px 12px; background: #ffffff; border-bottom: 1px solid #e8edf2; z-index: 2;`
- `.dr-drawer-scrollable-body`:
  - `flex: 1 1 auto; overflow-y: auto; overflow-x: hidden; min-height: 0;`
  - `scrollbar-width: thin; scrollbar-color: #cbd5e1 transparent;`
  - `overscroll-behavior: contain; -webkit-overflow-scrolling: touch;`
  - Custom scrollbar tracks and thumbs with hover states.

### C. Mobile Accessible Drawer & Floating Trigger
- Added `.dr-mobile-drawer-trigger-bar` fixed at the bottom with a clear pill showing `View Evidence Drawer [rel-id (v2)]`.
- Refactored `.dr-mobile-drawer-sheet` with `max-height: 88vh; display: flex; flex-direction: column; min-height: 0; overflow: hidden;`.
- Pinned header inside mobile sheet with explicit Close button (`isMobile` scoped).

---

## 4. Production Verification Results

Automated Playwright acceptance tests executed directly against the live production host (`https://capital.aiguides.co.uk/data-room`):

| Viewport | Test Dimension | Metric / Production Observation | Result |
| :--- | :--- | :--- | :--- |
| **Desktop** | 1440×900 | Bounded drawer height: `860px` ($\le 900\text{px}$) | **PASS** |
| | | Content scrollHeight: `942px` vs clientHeight: `762px` | **PASS** |
| | | Independent drawer scroll: `scrollTop` traversed $0\to 180\text{px}$ | **PASS** |
| | | Pinned header remains visible after full scroll (`headerRemainsVisible: true`) | **PASS** |
| | | Final source `reuters-loughton-oct19` reachable (`finalSourceReachable: true`) | **PASS** |
| | | Stage 4 review box & approve button reachable (`reviewBoxReachable: true`) | **PASS** |
| | | Keyboard navigation (`Home`, `PageDown`) works in drawer | **PASS** |
| | | Background main page scrolls independently (`scrollY = 500`) | **PASS** |
| | | Supersession relationship switch (v2 $\to$ v1) updates drawer correctly | **PASS** |
| | | Zero horizontal overflow (`hasHorizontalOverflow: false`) | **PASS** |
| **Laptop** | 1280×720 | Bounded drawer height: `680px` ($\le 720\text{px}$) | **PASS** |
| | | Independent vertical scrolling verified (`canScroll: true`) | **PASS** |
| | | Zero horizontal overflow (`hasHorizontalOverflow: false`) | **PASS** |
| **Mobile** | 390×844 | Desktop drawer hidden (`display: none`) | **PASS** |
| | | Accessible mobile trigger button visible & functional | **PASS** |
| | | Sheet opens with pinned header & scrollable body | **PASS** |
| | | Mobile body scrolls to bottom; Close button functional | **PASS** |
| | | Zero horizontal overflow (`hasHorizontalOverflow: false`) | **PASS** |

### Suite Regression Verification
- Full Vitest suite: **58 test files passed (528 tests passed, 0 failures)**.
- TypeCheck: **0 TypeScript errors**.
- Build: Next.js Turbopack optimized production build compiled cleanly.
- Security constraints: `executionAuthority: "none"` strictly preserved.
