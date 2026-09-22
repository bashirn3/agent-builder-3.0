---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: []
---

## Surface

Primary target: `src/App.tsx`
Mode: Operate

## Direction contract

THESIS: A focused existing-agent control room where editing and testing stay visible together. It refuses the generic AI-platform dashboard and the workflow-builder canvas; the surface is about one agent, one prompt, one tester, and clear state transitions.

OWN-WORLD: A restrained operational workspace using white panels, warm off-white canvas, thin neutral rules, near-black primary actions, subtle green success states, amber draft states, red recovery states, rounded controls, and precise typography. Components should feel quiet, tactile, and deliberate rather than decorative.

STORY: The user signs in, lands on the K1 Katsastus agent workspace, edits the opening message and master prompt, optionally adds helper text into the prompt draft, tests the saved agent in the playground, saves a new version, reviews or restores history, locks the configuration, and continues testing without accidental edits.

FIRST VIEWPORT: Desktop opens as a no-sidebar split workspace below a compact header: app mark, workspace breadcrumb, agent identity, version status, versions, and account controls. The left pane behaves like a focused settings panel with Prompt and Opening tabs, an inline guidance patch control, and a sticky save/lock bar. The right pane is a Chatbase-like live preview: a contained tester card centered on a faint dotted canvas, with a slim header and composer. Mobile opens as a native-feeling single-column shell with an agent header, visible sign-out, Edit/Playground tabs, card-based editing, full-screen field editors, bottom sheets for version history, and a persistent chat composer in Playground.

FORM: User-pinned code-led direction from `design/Wasup Interface.dc.html` plus the Mobbin pack in `design/mobbin-references/`. Seed key: pinned-claude-design-mobbin-operate-2026-09-21.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Unresolved decisions

- Lock state scope: shared between users or local/session-based.
- Whether a future duplicate/preset workflow is needed after the first single-agent version ships.
- Whether an existing conversation stays pinned to the version it started on after a newer version is saved.
- Whether unsaved drafts persist across reloads.
