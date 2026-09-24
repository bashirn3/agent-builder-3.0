# Build-ready handoff (video + mobile check)

**Date:** 2026-09-23  
**Scope:** Last short check before frontend implementation. Not a new audit.

**Sources**

| Source | What it is |
| --- | --- |
| Mobbin MCP `search_flows` / `search_screens` / `search_sections` | Stills + metadata only |
| Browser (logged out) | Public Mobbin flow page |
| [design/chatbase-audit/report.md](../../chatbase-audit/report.md) | Live 2026-09-23 DOM/CDP audit |
| [design/chatbase-flow-research/](../README.md) | Downloaded Playground + Auth stills |

Do not treat expiring Mobbin `image_url` values as review links. Do not publish 2FA / onboarding secret frames.

---

## VIDEO

| Question | Answer |
| --- | --- |
| Exposed by MCP | **No.** Video is not exposed through the verified MCP interface. |
| Accessible through another approved method | **No.** Public flow page showed stills only. |
| Actually visually inspected | **No.** |
| Evidence | This file + `evidence/mobbin-playground-01.png` (same stills already in the research pack) |

**MCP (verified)**

- Tools present: `search_flows`, `search_screens`, `search_sections`, `mcp_auth`.
- No video/recording tool, parameter, or documented media capability.
- Rediscovered “Setting up a playground” (`52947e76-b30a-4f91-8832-f424a32b744b`).
- Returned fields: `id`, `name`, `actions`, `screen_count`, `mobbin_url`, `app_name`, `platform`, `screens[{screen_id, image_url, position}]`.
- No video URL, recording identifier, or media field.

**Recording status**

| State | Result |
| --- | --- |
| Recording found | **No** as video. Ordered screenshots exist (already downloaded). |
| Recording accessible | **No** |
| Recording actually inspected | **No** |

**Browser fallback (not MCP video support)**

Opened `https://mobbin.com/flows/52947e76-b30a-4f91-8832-f424a32b744b` (redirected to `/explore/flows/…`). Session was logged out (`Log in` / `Join for free` in the header). Page title: “Chatbase Web Setting up a playground Flow”. UI: 15 still frames, Previous/Next. No Play, Video, or Recording control in the snapshot.

A logged-in Mobbin session might expose a player this check did not see. Not required for tonight. Motion from Mobbin remains **Unverified**.

Ordered screenshots are not a video.

---

## MOBILE

| Item | Result |
| --- | --- |
| Genuine responsive-web Mobbin references | **None.** |
| Genuine Chatbase iOS Mobbin references | **None** on the pages searched. Hits were other apps (Blue Apron, Mimo, Gemini, Claude, etc.). Not substituted. |
| Live Chatbase mobile (authoritative) | CDP `390×844` emulation, 2026-09-23. **Not a real device.** |
| Screenshot fidelity | `08-mobile-playground.png` is **stale** (1024 layout). `08b` / `01d` captures are **3840×2160 letterboxed**, not phone-pixel frames. |

**Relevant states**

| State | Coverage | Source |
| --- | --- | --- |
| Sign-in stacked (aside hidden) | CDP-verified; screenshot letterboxed | Live `01d` → `evidence/live-login-390-may-be-wide.png` |
| Playground: Open sidebar + 5 local tabs including Preview | CDP-verified | Live report §F |
| Preview: full-width widget ~390×690 | CDP-verified | Live report §F |
| Config column as default mobile view | CDP-verified; letterboxed still | `evidence/live-mobile-390-letterboxed.png` |
| Expanded editor / chat testing on phone | **Gap** | — |
| Real-device keyboard / safe-area / 44px targets | **Unverified** | Live report §I |

`platform:web` on Mobbin is desktop 1920×1320. `platform:ios` is not the responsive web app.

---

## 1. Motion patterns

Mobbin recording motion: **Unverified.**

Live patterns below are **Previously observed live** (DOM/CDP). Timing is **estimated** unless noted. Do not claim Chatbase uses Motion.dev. Easing / CSS duration / library: **not measured**.

| Interaction | Trigger | Start → end | Visible movement | Reflow | Open / close | Timestamp | Timing confidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Instructions expand | Expand control | Inline editor → overlay dialog 896×734 “Global instructions” | Fade + `zoom-in-95` | Overlay; canvas stays | Close / Escape **flaky** | Live session | Class observed; duration unmeasured |
| Accordion (Display → Content) | Click Content | Collapsed → open in column | Height (`animate-accordion-down`) | Column grows | Collapse accordion | Live session | Class observed; duration unmeasured |
| Local tabs | Overview / Display / … | Panel swap; widget stays | Instant (**est.**) | Config column only | Other tab | Live session | Estimated |
| Sources dialog | Show sources after reply | Button `loading…` → modal 768×972, `bg-black/50` | Fade + zoom | Overlay | Close / Escape flaky | Live session | Class observed; duration unmeasured |
| Chat waiting | Send | Chips hide; Send/Reset/dictation disable | Waiting / disabled; streaming **not** confirmed | Thread grows after reply | Reply re-enables Reset | Live session | Snapshot jumped to finished reply |
| Playground load | Route enter | Skeleton bars on dotted canvas → Overview + widget | Skeleton, not spinner | Canvas fills | — | Live session | **Est. 3–8s** |
| Sidebar collapse (desktop/1024) | Collapse | Width 256 → 48 icon rail | Width change | Config shifts to x=48 | Expand | Live session | Unmeasured |
| Mobile Open sidebar | Open sidebar | Hidden nav → full nav overlay | Overlay (unmeasured) | — | Close sidebar | Live CDP | Unmeasured |
| Mobile Preview tab | Preview | Config → full-width widget 390×690 | Tab swap | Config hidden | Overview | Live CDP | Estimated instant |
| Save feedback | — | — | — | — | — | — | **Not tested** |
| Unsaved bar | Always in DOM | Disabled when clean; enabled when dirty | Instant enable | Save bar often below fold | Discard: instant, no confirm | Live session | Instant (**est.**) |

---

## 2. Mobile reference images

**Chatbase phone-layout Mobbin:** none.

**Live (use as layout notes, not pixel-perfect phone frames)**

- `evidence/live-mobile-390-letterboxed.png` — config stacked; 3840×2160 letterbox. Identical file to `06-menu-or-drawer-open.png`.
- `evidence/live-login-390-may-be-wide.png` — single-column sign-in; aside hidden; wide capture.

**Proposed adaptation (not an observed Chatbase screen)**

- `evidence/proposed-wasup-test-refine-mobile.png` — existing Wasup **Test → Refine** sheet.

---

## 3. Desktop reference to build against

**Primary (live, current IA):** `evidence/live-desktop-playground.png`  
Sidebar + Overview config (model, sources, instructions, visibility) + dotted canvas + contained widget.

Supporting live:

- `evidence/live-playground-skeleton.png`
- `evidence/live-instructions-dialog.png`
- `evidence/live-chat-reply.png`
- `evidence/live-sources-dialog.png`
- `evidence/live-sidebar-collapsed-1024.png`
- `evidence/live-login-desktop.png`

**Historical Mobbin (still valid for split playground, not current tab IA):**  
`evidence/mobbin-playground-01.png` and `evidence/mobbin-playground-contact-sheet-01.png`  
Full flow: [../playground/setting-up-a-playground/](../playground/setting-up-a-playground/)  
Auth stills: [../auth/](../auth/)

Live IA now includes Overview / Display / Voice / Actions (+ Preview on mobile). Historical Mobbin is settings-column + dotted pane.

---

## 4. Adapt vs copy

**Copy (observed)**

- Contained chat preview on a quiet dotted field, not a full-window tester.
- Local tabs that swap the config column and leave the widget in place.
- Expand-to-dialog for the master prompt; accordion height for nested config.
- Explicit dirty state (Discard / Save). Unsaved chrome is always mounted.
- Chat waiting: disable send/reset; hide suggestion chips after first send.

**Adapt (proposed, not observed Chatbase mobile)**

- Keep **Test → Refine** as the mobile pattern. Do not copy Preview-as-fifth-tab plus Deploy / trial / crowded platform nav.
- Touch targets ≥44px. Chatbase often 36–40px.
- Do not wait for an exact Chatbase phone screenshot.

**Do not copy**

- Purple trial banner.
- Black widget skin as product chrome.
- Platform nav (Activity, Channels, Helpdesk, Outbound, …).
- Historical Mobbin instance grid / compare-models as the default one-agent screen.

---

## 5. First implementation milestone

Ship the **desktop playground** against the live reference: config column + contained preview + Overview-style instructions + expand dialog + dirty Discard/Save + skeleton on load.

Reuse existing shared motion (fade+zoom dialog, accordion height, instant tabs). Implement with Motion.dev later if useful; that is a Wasup choice.

On narrow viewports, stack to **Test → Refine**. Do not block on Mobbin video or a missing Chatbase phone pack.

Auth can follow the existing Mobbin + live login stills (desktop split; stacked form when the aside hides). No Clerk or backend work in this milestone.
