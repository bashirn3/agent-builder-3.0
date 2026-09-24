# Chatbase parity — live measurements

Captured from the signed-in live dashboard (Rapidscreen workspace) on 24 Sep 2026 via CDP in the Cursor browser, at 1440×900 @1× and 390×844 @2× (`live/`). Nothing was saved or deleted. One test message ("Hi, quick design check") was sent in the Playground to observe reply behaviour.

Source precedence (per request): **Mobbin frames win for layout wherever they show the screen** (see `design/k1-fresh/reference/`). Live Chatbase is used for what Mobbin cannot show: motion, loading, hover/focus, mobile, and exact tokens.

## Tokens (from the page's `:root` and utility CSS)

| Token | Value |
|---|---|
| Chrome font | Geist (sidebar, header, Playground config column) |
| Content font | Inter (page titles, lists, details, chat) |
| Ink / paragraph-3 / muted | `#09090b` / `#52525c` / `#71717b` |
| Border / input / muted bg / surface | `#e4e4e7` / `#e4e4e7` / `#f4f4f5` / `#fafafa` |
| Success (switch on) | `#00a544` |
| Radius | base 10px (`rounded-lg`), controls 8px (`rounded-md`) |
| Button | h-10 (h-9 secondary), px-4, `shadow-inner-sm` = `0 -1.5px 0 0 rgba(0,0,0,.04) inset`, border, `transition-all 200ms` |
| Shadows | xs `0 1px 2px #0000000d`; lg `0 10px 15px -3px #0000001a, 0 4px 6px -4px #0000001a`; input-box `0 4px 16px #0000000a, 0 2px 2px #00000005`; chatbot (5-layer, see CSS) |
| Easing | ease-in-out `cubic-bezier(.4,0,.2,1)`, ease-out `cubic-bezier(0,0,.2,1)`, default duration 150ms |
| Icons | Hugeicons stroke-rounded at 16px / stroke 1.5 for nav and sections; Lucide for search, more, close, chevrons-up-down |

## Motion (sampled per frame or read from classes)

| Element | Behaviour |
|---|---|
| Dialog | overlay `bg-black/50` fade; content fade + zoom from 0.95, 200ms |
| Unsaved bar | slides up from `translate-y-full` + fade, 300ms ease-in-out |
| Sidebar group (Activity) | height + opacity collapse; children behind an 18px-indented left rule |
| Switch | thumb translate, `transition-all` (150ms) |
| List selection | instant (no sliding highlight); row hover `bg-muted` 200ms |
| Chat reply | no entry animation; a "Loading…" placeholder bubble is replaced by streamed text |
| Mobile menu | full-screen panel under the 52px header, appears without a slide; menu icon becomes ✕ |
| Toasts | Sonner (scale 0.8 → 1 fade) |

## Skeletons (`animate-pulse` 2s `cubic-bezier(.4,0,.6,1)`, `bg-accent #f4f4f5`, `rounded-md`)

- **Chat logs list**: per row a 20px circle, title bar h-14px w-1/2, time bar h-12 w-36 at the right, subtitle h-12 w-4/5 indented 28px; row pitch 56px.
- **Chat detail**: title bar 80×24; three 256×96 bubbles, radius 20, alternating end/start, gap 16, padding 16.
- **Leads**: five 48px rows, gap 16, inside the table card.
- **Channels**: 128×36 button placeholders at the card foot.
- **Playground data cards**: bars inside the zinc-50 card.

## Layout facts used where Mobbin is silent

- Mobile header 52px: logo left; search + menu icons right.
- Mobile Playground: underline tabs (+ "Preview" tab showing the widget on the dot canvas), sticky full-width black "Deploy" bar at the bottom.
- Mobile Chat logs: list full width on `#fafafa`; detail replaces it with "‹ Back to Chat logs", title row with a boxed "more" button, underline tabs.
- Details panel: heading `text-sm uppercase tracking-wide semibold #52525c`, rows gap 20px, label `#52525c`, value medium; body padding 24/32.
- Channels card: `rounded-lg border p-5 gap-4`, 48px icon tile (`rounded-lg border`), title Inter 16/500, description Inter 14/500 `#52525c`, footer buttons h-9 aligned right (docs icon button + action).

## What changed in K1 (branch `feat/k1-chatbase-parity`)

- **Type and icons:** Inter and Geist are now actually loaded (`@fontsource-variable/*`). Previously `Inter` was named but never shipped, so most machines fell back to the system font. Hugeicons at stroke 1.5 replace Lucide, except for the glyphs Chatbase itself takes from Lucide (search, more, close, chevrons, check, eye). The Playground nav icon fills when active, as it does live.
- **Tokens and controls:** zinc palette, 10px/8px radii, buttons at 40/36px with an inset bottom shadow and `transition-all 200ms`, a 3px focus ring at `#9f9fa9` 50% opacity, a green 36×20 switch with a CSS thumb, instant (non-sliding) tabs, and an editor toolbar with 32px buttons, italic, and a divider.
- **Skeletons:** Chat logs rows, Leads rows, the Playground inspector and tester, and the Deploy action all use pulsing `#f4f4f5` blocks instead of spinners. Button spinners remain, as on the live site.
- **Motion:**
  - Dialogs fade and zoom from 0.95 over 200ms with CSS `ease`, over a `rgba(0,0,0,.5)` backdrop that fades in over 150ms.
  - Popovers fade, zoom and slide 8px over 150ms.
  - The unsaved bar slides up from 100% over 300ms with ease-in-out.
  - Toasts use Sonner timing (400ms).
  - List items and tab panels swap instantly.
- **Mobile:**
  - A 52px header with the brand and a menu button that turns into ✕.
  - A full-screen menu that appears without sliding. It has a focus trap and Escape returns focus to the button.
  - Playground uses underlined tabs (Overview, Display, Preview) with a sticky Deploy bar.
  - Chat logs detail has a "‹ Back to Chat logs" row.
  - Deploy cards stack in a single column.
- **Deploy:** now in the live Channels style, with a bordered header and a WhatsApp card (48px icon tile, title, description, action at the bottom right). The request flow is unchanged.
- **Mobbin kept for layout:** sidebar, header crumbs, the Playground frame, Chat logs, the Leads table, and Auth. The overlays in `compare/` still line up.

## Verification

Scripted headless runs (`design/k1-fresh/tools/shoot.mjs`):
- **Skeletons:** Playground, Leads (five 48px rows) and Chat logs (eight rows) each show their skeleton while loading.
- **Fonts:** Geist is applied to the chrome and Inter to the content.
- **Dialog motion:** 60ms after opening, the dialog is still mid zoom and fade; it settles at scale 1.
- **Backdrop:** black at 50%.
- **Unsaved bar:** still translating at 80ms, and settled by 580ms.
- **Reduced motion:** skeletons render without pulsing.
- **Mobile flows:** the Display tab shows the initial message. The menu opens, Escape closes it and returns focus, and choosing a link navigates and closes it. "Back to Chat logs" returns to the list.
- **Regressions:** the earlier Playground and Leads behaviour run still passes.

`compare/` holds the Mobbin overlays (Playground, Chat logs, Leads, Auth) and the live-vs-ours sheets (mobile Playground, Preview, menu, Chat logs list and detail, and Deploy).
