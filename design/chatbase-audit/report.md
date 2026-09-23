# Chatbase live UX audit (research only)

**Date:** 2026-09-23  
**Primary source:** live Chatbase in the Cursor browser  
**Comparison:** Wasup / K1 Katsastus workspace (source + local app)  
**Scope:** login, workspace landing, playground, chat test, motion, responsive. No Wasup implementation. No Chatbase save/deploy/trial.

**Inspection tools (verified):** navigate, lock, snapshot, click, fill, CDP `Runtime.evaluate`, `Emulation.setDeviceMetricsOverride`, screenshots.  
**Not supported:** short video recordings. `recordings/` is empty on purpose.

**Screenshot caveat:** captured PNGs often garble Latin text (font subset in the capture pipeline) and sometimes reuse a previous frame after a viewport change. **DOM text and CDP measurements are authoritative.** Treat PNG text as composition-only.

**Redaction:** agent URL id omitted (`…/chatbot/[agent-id]/playground/chat-widget`). Production instruction text is not quoted. Workspace name and agent display name are used only as observed chrome.

---

## A. Executive summary

- Chatbase’s playground polish comes from a **contained chat widget on a dotted canvas**, not from the black widget chrome itself. The black surface is a **selected widget theme**, not app chrome.
- The builder is a **platform**: 256px product sidebar, trial banners, model upsell, data-source quota, Deploy, channels. That chrome is out of Wasup’s one-agent scope.
- The useful borrow is the **split: local config (≈455px) + live preview**, with **local tabs** (Overview / Display / Voice / Actions) and a **sticky Discard / Save** bar that stays in the DOM even when clean.
- Chat testing is **isolated to the widget**. Composer disables Send until there is text; while waiting, Send, Reset, and dictation disable; after the reply, thumbs and **Show sources** appear.
- Opening copy lives under **Display → Content** (initial message, suggested chips, mobile variants). Wasup already has a clearer dedicated opener + sample preview.
- Login is a **50/50 marketing split** (indigo aside) down to ~1024px; at 390px the aside hides. Post-login landing is the **Agents list**, not the playground.
- On a 390px emulation, Chatbase **replaces the sidebar with Open sidebar** and **adds a Preview tab** so config and the widget are not shown together. Screenshot capture of this state was unreliable; CDP/snapshot verified it.
- Limitations: no recordings; no real-device keyboard test; Save-to-agent / Deploy / trial not clicked; Enter vs Shift+Enter not verified; reduced-motion behavior not visually confirmed. One accidental in-dialog bold was **Discarded** (not saved).

---

## B. Observed journey

Login → Workspace → Playground → Edit → Save/test → Leave

| Stage | Observed | Status |
| --- | --- | --- |
| Marketing → Login | Header **Login** leads to `https://www.chatbase.co/auth/signin`. Google + SSO + email/password. Microsoft button **not** on the live page. | Verified |
| Google SSO | Same-tab Google identifier (“continue to chatbase.co”). Password/2FA entered by the user. | Verified (handoff) |
| Post-login landing | `…/dashboard/bashir-sanis-workspace/chatbots` — **Agents** list, not playground. One agent card (Rapidscreen, last synced 21 hours ago). **New AI agent** (black, 40×149, radius 8). Agent options: Duplicate / Delete (not clicked). Workspace sidebar: Agents, Usage, Workspace settings (General, Members, Plans, Billing, API keys). Quota copy: messages 2/50 in 8 days. | Verified |
| Enter playground | Card click was flaky; navigation via playground href. URL: `…/chatbot/[agent-id]/playground/chat-widget`. First paint is a **skeleton** (gray bars on dotted canvas) while sidebar is already live. | Verified |
| Playground default | **Overview** selected. Config column 455px: Model Auto + trial upsell, Data sources Synced 14KB/1MB, Links 2, Instructions + “Sync with global instructions”, Visibility. Widget 408×657, radius 20px, on canvas `rgb(250,250,250)` with `radial-gradient` dots. Header: Chat bubble / Chat as user / Preview / Deploy. | Verified |
| Edit (read-only) | **Expand instructions** → centered dialog “Global instructions”, 896×734, radius 10px, fade+zoom classes. **Display → Content** accordion: agent picture, display name, initial message, mobile-different message, auto pop-up, placeholder, footer, suggested messages (Basic / Nested). | Verified (no save) |
| Accidental dirty → Discard | Closing the expand dialog via the first inner button hit **Bold** and prefixed `****`. Discard/Save enabled. **Discard unsaved changes** reverted the text and disabled both buttons. **No confirm dialog.** | Verified |
| Save to agent | Sticky copy always present: “You have unsaved changes. Do you wish to save them?” Discard 36px / Save 40×202, near-black, radius 8. Both **disabled when clean**. On 1920×1080 the bar sits at y≈1097 (**below the fold**). | Save click **not tested** |
| Chat / test | Sent “Hello, this is a design audit test.” While waiting: Send, Reset, dictation disabled; Show sources appeared disabled. Reply: assistant summary + “Just now” + Good/Bad (16×16) + Show sources (376×36, white, radius 8). User bubble `rgb(0, 89, 255)`, 20px radius, pad 12/16, Inter 14. Sources opens a **768×972** modal (radius 16) listing crawled URLs. Leaving and returning the playground **cleared** the thread. | Verified |
| Leave | Browser back / agents URL works. Conversation not retained across remount. Persistence across refresh **not verified**. | Partial |

---

## C. Visual system

Measured unless marked estimate.

### Typography

- **App UI:** Inter (`Inter, "Inter Fallback", ui-sans-serif, system-ui, …`).
- **Some chrome / save bar / tabs:** Geist (`Geist, "Geist Fallback", …`).
- **Marketing / login aside:** Proza Display referenced; login H1 Inter 28px / 600 / −1.12px tracking / 36.4px line-height.
- **Agents H1:** Inter 24px / 600.
- **Local tabs:** Geist 14px / 500, 28×100, selected tab white fill, radius 8.
- **Widget messages:** Inter 14px / 400. Timestamp 12px muted.
- **Instructions helper:** 14px Geist, muted.

Do not assume Motion.dev. Dialogs use Tailwind `data-[state=open]:fade-in-0` / `zoom-in-95` / `animate-accordion-down` class names.

### Spacing / density

- Sidebar **256px** expanded, **48px** icon rail collapsed.
- Config column **455px** (x=256 when sidebar open, x=48 when collapsed).
- Canvas starts at x=711 on 1920 (1209×950).
- Controls are **40px** tall (login, New AI agent, Save). Fields **40×452** on login, radius **8**.
- Content is denser than Wasup: less padding, smaller type in the widget (14 vs Wasup 15.5).

### Panel proportions (1920×1080)

| Region | Width | Notes |
| --- | --- | --- |
| Product sidebar | 256 | White, full height under a 54px top offset |
| Config | 455 | Light gray `lab(98.26 …)` / near `#f7f7f7` |
| Canvas | 1209 | Dotted; widget centered |
| Widget | 408 × 657 (idle) / 408 × 613 (in-thread) | `max-w-[25.5rem]`, `max-h-[45rem]` |

### Surfaces, radii, shadows

- App: white / near-white. Canvas `rgb(250,250,250)` + dots `rgb(212,212,216)`.
- Login aside: `rgb(44, 65, 179)`.
- Widget theme (this agent): **black** body, white composer pill, blue user bubble. Layered shadow observed on the widget shell in an earlier pass (estimate: soft stacked drop shadow). In-thread wrapper: radius **20px**, 1px hairline.
- App controls: radius **8px**. Dialogs: instructions **10px**, sources **16px**.
- Save: near-black fill, 1.5px inset highlight `lab(0 0 0 / 0.04)`.
- Trial banner: indigo bar; “Start free trial” outline `1px solid rgb(44, 65, 179)`, radius 8.

### Color / action emphasis

- Primary actions: near-black, white 14/500.
- Destructive login error: 13px/500 red; **label** turns red, field border stays gray.
- User bubble: `rgb(0, 89, 255)` — widget theme, not app brand.
- Trial / “Claim your free trial”: persistent purple banner. **Do not copy.**

### Wasup contrast (source)

Wasup: Inter; ink `#1d1d1b`; canvas `#f7f7f4`; tester `min(760)×min(860)`, radius **24**, heavier shadow; auth pills **48–50px**; primary **42px** / radius 10; opener preview dashed card. Same font family, **larger, rounder, more chrome**.

---

## D. Interaction inventory

| Component | Trigger | Observed behavior | Motion / feedback | Closing / reversal | Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Login Google | Click “Login with Google” | Same-tab Google identifier | Full navigation | Back to `/auth/signin` | `_notes-login.md` | Verified |
| Login submit empty password | Click Login with email only | Button → `loading Login` → inline “Please enter your password”; form 236→264px | Brief disabled/loading | Focus to password; email kept | `02-login-empty-password-validation.png` | Verified |
| Password eye | Click Show/Hide | `type` password↔text; `aria-pressed` | None measured | Toggle | Live | Verified |
| Agents card | Click card | Focus only; navigation unreliable | — | Used explicit playground URL | Live | Partial |
| Agent options | Overflow `…` | Menu: Duplicate Agent, Delete agent | Instant popover (est.) | Escape | Snapshot | Verified (not activated) |
| Playground load | Navigate to playground | Sidebar first; skeleton bars on canvas; then Overview+widget | Skeleton, not spinner (est. 3–8s) | — | `04a-playground-loading.png` | Verified |
| Local tabs | Click Overview / Display | In-place panel swap; widget stays | Instant (est.) | Other tab | `04-playground-desktop.png`, Display Content | Verified |
| Expand instructions | Click expand | Overlay dialog 896×734, title “Global instructions” | CSS fade + zoom-in-95 | Close / Escape **flaky**; first inner button was Bold | `05-editor-expanded.png` | Verified |
| Display Content | Click Content accordion | Expands in column (`animate-accordion-down` class) | Height animation (unmeasured) | Collapse accordion | Live | Verified |
| Discard | Click Discard when dirty | Reverts instructions; disables Discard/Save | Instant; **no confirm** | — | Live | Verified |
| Save | — | Not clicked | — | — | — | **Not tested** |
| Composer | Type text | Send enables | Instant | Clear text disables Send | Live | Verified |
| Send | Click Send | User bubble right; chips hide; Send/Reset/dictation disable | Waiting state | Reply re-enables Reset | `08-chat-reply.png` | Verified |
| Show sources | Click after reply | Button → `loading Show sources` → modal 768×972, dimmed `bg-black/50` | Fade + zoom | Close/Escape flaky | `06-sources-drawer.png` | Verified |
| Reset conversation | Button present | Not confirmed in isolation; remount cleared thread | Unknown if confirm | — | Live | Partial |
| Collapse sidebar | Click Collapse | Width 256→48 icon rail; config shifts to x=48 | Width change (unmeasured) | Expand | `04b-playground-sidebar-collapsed-1024.png` | Verified |
| Mobile Open sidebar | Click Open sidebar | `Close sidebar`; full nav returns (drawer) | Overlay (unmeasured) | Close sidebar | Snapshot | Verified |
| Mobile Preview tab | Click Preview | Widget becomes content (390×690); config hidden | Tab swap | Overview | Snapshot / CDP | Verified |
| Chat bubble / Chat as user / Deploy | Present | Not opened (Deploy / identity switch out of scope) | — | — | — | Not tested |

---

## E. Loading, empty, error, and unsaved states

**Observed**

- Login empty-password: inline error, no red field border, slight layout shift.
- Login disabled at 0.5 opacity when both fields empty; enables after email only.
- Playground route: skeleton bars on dotted canvas; sticky unsaved copy already in DOM.
- Unsaved bar copy is **always mounted**. Buttons disabled when clean, enabled when dirty. Discard is immediate and silent.
- Chat waiting: controls disable; Show sources appears early but disabled. Streaming token-by-token **not confirmed** (snapshot jumped to a finished reply).
- Chat empty / opening: “Hi! What can I help you with?” + three chips (one Nested). Chips vanish after the first send.
- Sources loading: button accessible name becomes `loading Show sources`.

**Not tested**

- Invalid login credentials.
- Save success / save failure / conflict.
- Network error / retry in chat.
- Empty Agents workspace.
- Deploy, model change, visibility off, sync toggle.
- Autosave (none observed; explicit Save).
- Reduced-motion equivalents of fade/zoom/accordion.
- Enter vs Shift+Enter in the composer.

---

## F. Desktop / mobile differences

Emulation via CDP (`390×844` mobile, `1024×768`, `1440×900`, `1920×1080`). **Not a real device.** Screenshot tool often stayed on a wide frame; measurements below are from snapshot/CDP.

### Login

| Viewport | Layout |
| --- | --- |
| 1920 / 1440 | 50/50 split; form 452px |
| 1024 | Still 50/50; columns 512; form cramped (~30px inset) |
| 390 | Aside `hidden lg:flex`; form 350px; extra “Don’t have an account?”; 40px targets (below 44px) |

### Playground

| Viewport | Layout |
| --- | --- |
| 1920 | Sidebar 256 + config 455 + dotted canvas + 408 widget. Save bar **below the fold**. |
| 1024 + collapsed sidebar | Icon rail 48 + config 455 + widget 408×590. Split still fits; tight. |
| 390 | Sidebar gone → **Open sidebar**. Header: mark, Search, hamburger. Local tabs become **Overview / Display / Voice / Actions / Preview**. Config is the default. Preview shows a **full-width** widget (390×690), not the 406 desktop phone. Save 40×186 at y≈880 (below 844). Composer remains in the Preview tab. |

**Judgment:** Chatbase mobile is a **stacked, platform-heavy** playground, not a focused refine/test loop. Wasup’s **Test → Refine agent** sheet is already a better one-agent mobile pattern. Do not copy Chatbase’s Preview-as-fifth-tab plus Deploy/trial chrome.

Touch targets: many 36–40px. Thumbs 16×16 (inaccessible). Real-device keyboard overlap **unverified**.

---

## G. Comparison with the K1 interface

Five highest-impact differences only.

### 1. Preview-as-widget on a dotted canvas vs large browser-chrome tester

- **Chatbase:** 406-wide themed widget, centered on a dotted canvas; reads as “this is the thing customers will see.”
- **Wasup:** `playground-content` min(760)×min(860), radius 24, window dots, full conversation column.
- **Type:** useful Chatbase pattern we lack (contained preview) **and** a visual execution difference.
- **Keep:** isolated tester, previous-test retention, no “Powered by Chatbase.”

### 2. Local tabs + always-present Discard/Save vs Additional information + Save & test

- **Chatbase:** Overview / Display / Voice / Actions; dirty bar with Discard + Save to agent.
- **Wasup:** Additional information, opening message, protected master prompt, Save & test, version history, lock.
- **Type:** useful dirty-state pattern; Voice / Actions / model / sources are features we **intentionally do not need**.
- **Keep:** Additional information while locked; explicit unlock; Save & test as the refinement verb.

### 3. Platform sidebar / trial / Deploy vs single-agent topbar

- **Chatbase:** Backstage, Build, Activity, Analytics, Contacts, Channels, Integrations, Outbound, Helpdesk, Settings; 7-day trial banner; 2/50 messages; Deploy.
- **Wasup:** one K1 agent, refine beside tester.
- **Type:** feature we **intentionally do not need**. Omit entirely.

### 4. Opening message buried in Display → Content vs dedicated opener + sample preview

- **Chatbase:** initial message + chips + mobile variants live with branding (picture, footer, A/B, localization).
- **Wasup:** dedicated opener field + dashed sample preview with `{{first_name}}` / `{{registration_number}}`.
- **Type:** Chatbase has more display controls we do not need; Wasup’s dedicated opener is the better information architecture for K1. Optional adapt: suggested-chip editing **only if** we later want starter prompts.

### 5. Control density and chrome weight

- **Chatbase:** 8px radii, 40px controls, 14px type, quieter panels, save bar that is easy to miss (below the fold at 1080).
- **Wasup:** taller pills, 10–14px radii, 24px tester radius, stronger shadows.
- **Type:** visual execution in our interface. Tighten density **without** copying Chatbase brand, indigo, or the black widget theme.

---

## H. Adopt / Adapt / Omit

Recommendations preserve: Additional information → Save & test; base-prompt protection; opening-message editing; version history; isolated testing; mobile refinement.

### Adopt

- **Dotted canvas behind the tester** (Wasup already has a related canvas token; keep it, don’t turn the tester into a marketing widget).
- **Send disabled until the composer has text.**
- **Waiting state that disables Send / reset / extras** so a second send cannot race.
- **Explicit Discard that immediately reverts** (Wasup should keep draft vs saved distinct; Chatbase’s silent discard is the interaction, not the copy).

### Adapt

- **Contained preview** beside refine: smaller than 760×860, still a **tester**, not a themed customer bubble. Do not adopt this agent’s black + `#0059FF` look.
- **Sticky dirty actions** on the refine column: Discard + Save & test, visible **without scrolling** (fix Chatbase’s below-the-fold miss).
- **Local sectioning** (additional info / opener / master prompt) as quiet in-panel tabs or stacked cards — not Chatbase’s Overview/Display/Voice/Actions.
- **Mobile: keep Test → Refine**, not a fifth Preview tab plus hamburger platform nav.
- **Suggested chips** only if we want starter tests; they are display settings in Chatbase, not required for K1.

### Omit

- Agents list, New AI agent, Duplicate/Delete.
- Product sidebar, Backstage, Analytics, Channels, Integrations, Outbound, Helpdesk.
- Model picker, Auto, trial upsell, data-source quota, Links manager.
- Sync with global instructions / channel visibility.
- Deploy, Preview-as-share, Chat as user, dictation.
- Display: picture, footer, A/B, localization, floating bubble, typography theme, “Powered by…”.
- Billing, plans, 7-day trial banners, message-quota pills.
- Show sources / RAG citations (unless we later add retrieval).
- Chatbase wordmark, indigo login aside, Geist-as-brand.

---

## I. Unverified items

- Invalid-credential and SSO/SAML completion.
- Signup and password-reset.
- Save-to-agent success, toast, and persistence after reload.
- Deploy, model change, visibility off, sync toggle (would mutate the production agent).
- Chat streaming frames, Enter vs Shift+Enter, multiline composer growth.
- Reset-conversation confirm (remount cleared the thread; button not isolated).
- Error/retry in chat.
- Reduced-motion: `prefers-reduced-motion: reduce` was emulated; **visual change not confirmed**. Default session was `false`.
- Dialog close: Close and Escape were **flaky** (sources and expand). Not treated as a pattern to copy.
- Real-device keyboard, safe-area, and 44px target compliance.
- Screenshot fidelity of 390px playground (capture stayed wide); rely on CDP.
- Mobbin flow (https://mobbin.com/flows/52947e76-b30a-4f91-8832-f424a32b744b) matches the live split playground but is **historical**; live IA now includes Backstage, Voice, Actions, Helpdesk, Outbound.

---

## Evidence index

| File | What it shows | Viewport (intended) |
| --- | --- | --- |
| `screenshots/01-login-desktop.png` | `/auth/signin` split | 1920×1080 |
| `screenshots/01b-login-1440.png` | Same split | 1440×900 |
| `screenshots/01c-login-1024.png` | Cramped split | 1024×768 |
| `screenshots/01d-login-mobile-390.png` | Aside hidden | 390 (capture may be wide) |
| `screenshots/02-login-empty-password-validation.png` | Empty-password error | 1920 |
| `screenshots/03-marketing-widget-open.png` | Public site widget (not playground) | 1440 |
| `screenshots/03-workspace-agents.png` | Agents list + New AI agent | 1920 |
| `screenshots/03-workspace-navigation.png` | **Stale** (sources dialog). Prefer `03-workspace-agents.png`. | — |
| `screenshots/04-playground-desktop.png` | Overview + widget | 1920 |
| `screenshots/04a-playground-loading.png` | Skeleton | 1920 |
| `screenshots/04b-playground-sidebar-collapsed-1024.png` | Icon rail + split | 1024 |
| `screenshots/05-editor-expanded.png` | Global instructions dialog | 1920 |
| `screenshots/06-display-tab.png` | Display / Content (if valid) | 1920 |
| `screenshots/06-sources-drawer.png` | Sources modal | 1920 |
| `screenshots/06-menu-or-drawer-open.png` | Mobile capture; treat as supplementary | 390 (wide frame) |
| `screenshots/07-chat-loading.png` | **Unreliable** (welcome frame). Loading was confirmed in snapshot. | — |
| `screenshots/08-chat-reply.png` | User + assistant + sources | 1920 |
| `screenshots/08-mobile-playground.png` | **Stale 1024 frame.** Mobile layout is CDP-verified. | — |
| `screenshots/08b-mobile-preview.png` | Narrow stacked chrome (config) | 390 (letterboxed) |

Scratch notes (not the decision doc): `_notes-login.md`, `_notes-public-and-mobbin.md`.

---

## Critique vs observation

Observed facts are in A–F and the inventory. Section G–H is critique for Wasup: copy the **contained preview + dirty-state clarity**, not the **platform** or the **black widget skin**. Chatbase feels polished because the preview is a single object on a quiet field, controls are consistent at 40/8, and the builder never pretends the widget is the whole product. Wasup should stay a control room for one locked/unlocked agent.
