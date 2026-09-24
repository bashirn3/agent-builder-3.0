# K1 Katsastus fresh frontend — mapping and evidence

Branch `feat/k1-fresh-frontend`. New app: `index.html` → `src/k1/`. Previous UI kept at `legacy.html` → `src/main.tsx` (not deleted).

## Reference honesty

- Figma file `eZNu9gnUcR3tO4DJRnkymy` holds **imported Mobbin screenshots** (image fills), not editable layers. No variables, components, or prototype links exist, so every measurement here is a reconstruction from pixels.
- Frames are 1920×1320 with a 120 px Mobbin footer; the app area is the top 1920×1200. Glyph and chrome sizes show they are **1440×900 CSS captured at 4/3**. All comparisons render at 1440×900 @ 4/3 (headless Chromium via `tools/shoot.mjs`), so result and reference are pixel-comparable.
- The Figma MCP hit the Starter-plan call limit during this pass. Full-resolution frames already exported to `design/figma-selected/` were used; Chat-logs states 2–7 exist only in the Figma group strip and are **low-resolution crops** (`reference/*-strip.png`). Playground frames match the same Mobbin captures stored full-size in `design/chatbase-flow-research/playground/setting-up-a-playground/images/`.
- Node `4:25` renders 1×1 and was not usable. No selected frame covers Leads, Deploy, sign-in, or mobile — those are **adaptations** of the selected visual system, labelled below.
- Motion timing uses the project's existing Motion tokens (`src/lib/motion.ts`: 200 ms, `[0.16, 1, 0.3, 1]`). Reference timing is unverifiable from stills and was not invented.

## Frame → page/state → implementation

| Selected frame | Page / state | Implementation |
|---|---|---|
| AUTH `4:4` | Sign up, empty | `#/signup` · `pages/AuthPage.tsx` |
| AUTH `4:6`–`4:9` | Weak / strong password, rule checklist, reveal | typing in Password; eye toggle |
| AUTH `4:10` | Submitting | Sign up → spinner → honest "Clerk not connected" notice |
| — adaptation | Sign in | `#/signin` (same split card) |
| PLAYGROUND `4:33` | Save success toast | Save to agent → toast (`ui/controls.tsx`) |
| PLAYGROUND `4:34`–`4:36` + strip | Idle, composer filled, waiting, reply, feedback | `#/playground` tester → n8n `/chat/test` |
| research 05/07/08 (not in Figma) | Unsaved bar, grouped preset menu | Unsaved bar; version menu (preset list → saved versions) |
| CHAT LOGS `6:50` | List + Chat thread | `#/activity/chats/:id` · `pages/ActivityPage.tsx` |
| CHAT LOGS strip 2–7 | Filter dialog, date-range picker, range, filled filters, chips + Clear all | `FilterDialog`, `ui/DateRange.tsx`, chips |
| — adaptation of Chat logs | Leads list + detail (Details / Chat tabs) | `#/activity/leads/:id` · `pages/LeadsPage.tsx` |
| — adaptation of dialog/row-card | Deploy request | `#/deploy` · `pages/DeployPage.tsx` |
| — adaptation | Mobile ≤900 px | nav drawer, instructions bottom drawer, list↔detail slide |
| COMPARE `6:41` | Model comparison | removed (out of scope) |

Removed from the reference chrome: Analytics, Data sources, Actions, Contacts, Settings, model picker, Compare, AI Actions, "Trained / last trained", plan badge, Getting-started progress, upgrade prompts, header changelog/gift/docs/help icons, mic, and "Show sources".

## Integrations vs fixtures

| Area | Status |
|---|---|
| Playground load / save / test | **Connected** through the existing `src/lib/agentBuilderService.ts` (n8n when `VITE_N8N_BUILDER_BASE_URL` is set, local storage otherwise). Test replies use the prompt-only `/chat/test` workflow — no WhatsApp or booking tools. |
| Versions, lock, additional instructions, opening message | Connected (same service). Locking follows the existing semantics: base prompt read-only, other fields editable. |
| Activity, Leads | **Fixtures** (`src/k1/data/fixtures.ts`), labelled "Sample data" in the UI; invented names, `example.com` emails, placeholder phones. |
| Sign in / sign up | **Deferred** (Clerk). Submitting shows that nothing was created or sent; "Open development preview" starts a session-only preview. |
| Deploy request email | **Deferred**. Requests are prepared, kept in session storage, marked "Prepared · not sent", with copyable text. |

## Files

- `reference/` — Figma app-area crops (footer removed) and research frames.
- `result/` — implementation at 1440×900 @ 4/3; `result/mobile/` at 390×844 @ 2.
- `compare/` — reference (left) vs result (right).
- `tools/shoot.mjs` — reproducible capture + interaction checks.
