# Setting up a playground

Source: https://mobbin.com/flows/52947e76-b30a-4f91-8832-f424a32b744b  
15 recorded steps. Positions 1–15 consecutive. All 15 images downloaded and visually inspected.

Titles below are analyst-created. Mobbin did not provide per-screen titles.

This is a **historical** playground: settings column + dotted chat pane + “Powered by Chatbase.” It is not the live 2026 Overview / Display / Voice / Actions playground. See [coverage.md](../../coverage.md).

Capture-session seams: plan, last-trained time, and Getting started progress jump between frames. Treat 01–15 as an ordered Mobbin sequence, not one continuous live session.

---

## 01 — Idle playground, first-run chrome

- **Position / screen ID:** 1 / `b8a8262b-bd97-48ef-9062-8bdbe0775b1b`
- **What is visible:** Desktop playground. Left product nav (Playground selected). Settings column: trained status, Compare AI models, Model (GPT-5.1), AI Actions (“Add your first action”), Instructions (Base Instructions + Business Context). Chat pane on a dotted canvas with opening “Hi! What can I help you with?”, empty composer, “Powered by Chatbase.” Free plan. Last trained Just now. Getting started 1/6. Upgrade upsell near the model.
- **What changed:** First frame.
- **What the user appears to be doing:** Viewing an idle playground after first-agent creation. **Inferred** from shared ID with Onboarding 20.
- **Known vs inferred:** Layout and chrome: **Observed in Mobbin**. Arrival path from onboarding: **Inferred** (shared screen). Live IA difference: **Previously observed live**.
- **Wasup relevance:** Historical reference for config + test-chat split. Do not copy platform nav, upgrade, Getting started, or “Powered by Chatbase.”
- **Unanswered:** Is this still the default first-run playground today?

Shared with Onboarding position 20.

---

## 02 — Hobby plan, instructions scrolled to Role

- **Position / screen ID:** 2 / `d1700c28-1cd6-4b67-a9ff-3499feabb9c5`
- **What is visible:** Same playground. Upgrade banner gone. Hobby plan. Last trained 2 days ago. Instruction body scrolled so Role is visible. Getting started still 1/6.
- **What changed:** Plan, last-trained, upsell, and instruction scroll. Chat opener unchanged.
- **What the user appears to be doing:** Reading instructions. Scroll is **inferred**.
- **Known vs inferred:** Visible chrome changes: **Observed in Mobbin**. Continuity with frame 01 is weak (plan/trained jump): **capture seam**.
- **Wasup relevance:** Instructions are a long scrollable field, not a single line.
- **Unanswered:** Why plan and last-trained jumped. Separate capture.

---

## 03 — Model dropdown open, GPT-5 selected

- **Position / screen ID:** 3 / `684403d5-e539-49c5-b554-e28d382734cc`
- **What is visible:** Model dropdown open. “Search Models.” GPT-5 selected with a check. OpenAI / GPT-5, credit cost 1. Getting started jumped to 4/6. Last trained 3 days ago.
- **What changed:** Dropdown open. Getting started and last-trained jumped again.
- **What the user appears to be doing:** Choosing a model. The click that opened the dropdown is **inferred**.
- **Known vs inferred:** Open menu: **Observed in Mobbin**. Triggering click: **Inferred**. Getting started 4/6: **Observed in Mobbin**, cause **Unverified**.
- **Wasup relevance:** Model picker is a searchable list with provider and credit cost. Wasup may not need credits.
- **Unanswered:** What completed Getting started 2 and 3.

---

## 04 — Model list scrolled to other providers

- **Position / screen ID:** 4 / `f68fb0a4-3309-4cc3-b904-dc9cb724943a`
- **What is visible:** Same dropdown, scrolled. Anthropic / Gemini / Grok groups. Claude 4.6 Opus highlighted. Credit cost 5.
- **What changed:** Scroll position and highlight inside the open menu.
- **What the user appears to be doing:** Browsing models. Scroll **inferred**.
- **Known vs inferred:** Menu contents: **Observed in Mobbin**.
- **Wasup relevance:** Multi-provider catalog. Out of scope if Wasup stays on one model.
- **Unanswered:** Whether highlight is hover or keyboard focus. Static frame cannot say.

---

## 05 — Claude 4.5 Haiku + unsaved bar

- **Position / screen ID:** 5 / `0f247934-8493-4cfd-bf62-c8456895ac60`
- **What is visible:** Dropdown closed. Model now Claude 4.5 Haiku. Bottom bar: “You have unsaved changes. Do you wish to save them?” Discard / Save to agent.
- **What changed:** Model value. Unsaved bar appeared. Dropdown gone.
- **What the user appears to be doing:** After picking a model, facing a save decision. Selection click **inferred**.
- **Known vs inferred:** Bar copy and actions: **Observed in Mobbin**. Live audit has the same copy; buttons stay in the DOM when clean (**Previously observed live**). Whether Mobbin’s bar hides when clean: this frame cannot prove it.
- **Wasup relevance:** Strong reference for dirty-state save/discard.
- **Unanswered:** Does Discard revert the model without a confirm? Live Discard on instructions had no confirm.

---

## 06 — Unsaved bar gone, one action enabled

- **Position / screen ID:** 6 / `9543d80a-ccd3-424b-ad70-4fa089d6ab99`
- **What is visible:** Unsaved bar gone. AI Actions now “1 Action Enabled” (was “Add your first action”). Model still Claude 4.5 Haiku.
- **What changed:** Bar dismissed. Actions row updated. No action-picker frame in between.
- **What the user appears to be doing:** Save is **inferred**. Enabling an action is **not recorded**.
- **Known vs inferred:** Resulting chrome: **Observed in Mobbin**. Save success: **Inferred**. Persistence: **Unverified**.
- **Wasup relevance:** Actions enable is Chatbase-platform. Likely out of scope.
- **Unanswered:** Can save succeed without enabling an action? Sequence implies they happened together or across a seam.

---

## 07 — Instruction preset menu open

- **Position / screen ID:** 7 / `ad5b033b-28a2-49c7-86bf-79db406649a0`
- **What is visible:** Preset dropdown open over an unsaved bar. Options: Base Instructions, Examples, General AI agent, Customer support agent, Sales agent, Custom prompt.
- **What changed:** Preset menu open. Unsaved bar back.
- **What the user appears to be doing:** Opening instruction presets. Click **inferred**.
- **Known vs inferred:** Menu labels: **Observed in Mobbin**. Live “Sync with global instructions” is a different control (**Previously observed live**).
- **Wasup relevance:** Preset list is useful language. Expanded editor is missing here; live has a dialog.
- **Unanswered:** Does Custom prompt open a larger editor? **Unverified.**

---

## 08 — Customer support preset applied, dirty

- **Position / screen ID:** 8 / `c1aaa276-ad9c-4c64-8dab-b5d546186d28`
- **What is visible:** Preset control reads “Customer support agent.” Instruction body is a customer-support Role. Unsaved bar present.
- **What changed:** Preset label and instruction text.
- **What the user appears to be doing:** Applied a preset. Click **inferred**.
- **Known vs inferred:** Text change: **Observed in Mobbin**. Whether the preset overwrites the whole field: **Inferred**.
- **Wasup relevance:** Preset application is a one-step body replace.
- **Unanswered:** Can the user undo without Discard?

---

## 09 — Save toast; preset label vs body mismatch

- **Position / screen ID:** 9 / `164c77bd-f9dc-4f57-b511-cc7107cdc070`
- **What is visible:** Top-right toast “Success Your changes are saved.” Preset control is back to “Base Instructions.” Body still shows customer-support Role. Unsaved bar gone.
- **What changed:** Toast. Bar gone. Preset label reverted; body did not.
- **What the user appears to be doing:** Saved. Click **inferred**.
- **Known vs inferred:** Toast: **Observed in Mobbin**. Live save click **not tested**. Label/body mismatch: **Observed in Mobbin**, cause **Unverified**.
- **Wasup relevance:** Success toast after save. Flag the preset-label mismatch as a possible Chatbase bug or capture seam, not something to copy.
- **Unanswered:** Does a live save restore the preset label like this?

---

## 10 — Idle playground, different agent/session

- **Position / screen ID:** 10 / `6ae9a069-07ff-4407-9148-384cd2e3ee8a`
- **What is visible:** Model back to GPT-5. Instructions are Mobbin Design Concierge Role + Voice & Tone. No unsaved bar. No toast.
- **What changed:** Model, instruction content, and likely agent. This is a **capture-session seam**.
- **What the user appears to be doing:** Viewing a later idle playground. Not a continuation of the customer-support edit.
- **Known vs inferred:** Visual reset: **Observed in Mobbin**. Same continuous user: **not supported**.
- **Wasup relevance:** Shared idle frame used as step 1 of several other flows.
- **Unanswered:** Why Mobbin spliced this capture here.

Shared with Comparing AI models 1, Account settings 1, Activity 1.

---

## 11 — Composer filled, ready to send

- **Position / screen ID:** 11 / `d684d184-9acb-46cd-ac39-8d33c4dd724c`
- **What is visible:** Composer contains “How can I use social proof in a UI to increase trust during a subscription checkout?” Send control is filled black. Opening message still visible above.
- **What changed:** Composer has text. Send looks enabled.
- **What the user appears to be doing:** Typed a test question. Typing **inferred**.
- **Known vs inferred:** Text and Send fill: **Observed in Mobbin**. Live Send disables until there is text (**Previously observed live**).
- **Wasup relevance:** Test-from-playground is the core Wasup loop.
- **Unanswered:** Enter vs click-to-send. **Unverified** here and in the live audit.

---

## 12 — User bubble sent, waiting, opener gone

- **Position / screen ID:** 12 / `a8885312-d9cb-4e12-8a4e-c92dc9ac9bd0`
- **What is visible:** Right-aligned black user bubble with the question. Opening message **gone**. Three-dot typing indicator. “Show sources” already visible while waiting. Composer empty.
- **What changed:** Message committed. Opener removed. Waiting state. Composer cleared.
- **What the user appears to be doing:** Sent. Click or Enter **inferred**.
- **Known vs inferred:** Waiting UI: **Observed in Mobbin**. Live waiting also shows Show sources and disables Send/Reset/dictation (**Previously observed live**). Disable states are not readable as disabled-vs-enabled in this still.
- **Wasup relevance:** Waiting + sources-while-pending is a live-aligned pattern.
- **Unanswered:** Why the opener is gone here and back in 13.

---

## 13 — Reply arrived; opener returned

- **Position / screen ID:** 13 / `d32557c2-eb20-4a80-b63b-ce70d134879f`
- **What is visible:** Opening message **back at the top** of the thread. User bubble + assistant reply with bullets. Show sources still present.
- **What changed:** Reply present. Opener restored. Typing indicator gone.
- **What the user appears to be doing:** Reading the reply.
- **Known vs inferred:** Opener gone-then-back: **Observed in Mobbin**. Cause (scroll, remount, capture splice): **Unverified**. Live chips vanish after first send and do not return in that session (**Previously observed live**).
- **Wasup relevance:** Do not copy the opener-return without live confirmation. Prefer the live “chips gone after send” behavior unless we decide otherwise.
- **Unanswered:** Is Mobbin 13 a different scroll/capture than 12?

---

## 14 — Scrolled to reply end, feedback chrome

- **Position / screen ID:** 14 / `9ae2b438-a596-430c-8130-40d3e9f3abf6`
- **What is visible:** Thread scrolled to the end of the assistant reply. “Just now.” Thumbs up / thumbs down. Show sources.
- **What changed:** Viewport scrolled to feedback chrome.
- **What the user appears to be doing:** Reading the end of the reply. Scroll **inferred**.
- **Known vs inferred:** Thumbs + timestamp: **Observed in Mobbin**. Live Good/Bad 16×16 after reply (**Previously observed live**). No thumb is filled.
- **Wasup relevance:** Response feedback after the reply, not during waiting.
- **Unanswered:** What thumbs do (only local, or logged to Activity)? **Unverified.**

---

## 15 — Near-duplicate of 14

- **Position / screen ID:** 15 / `cb6931d8-f2ee-4618-a75e-db03cae94459`
- **What is visible:** Visually near-identical to 14 at inspection resolution. Thumbs still unfilled. Same reply end, timestamp, Show sources.
- **What changed:** No reliable visual difference observed. Different `screen_id`, so Mobbin treats them as two captures.
- **What the user appears to be doing:** Unknown. Do not invent a hover.
- **Known vs inferred:** Near-identical stills: **Observed in Mobbin**. Interaction: **Unverified**.
- **Wasup relevance:** Do not treat 15 as a confirmed feedback-given state.
- **Unanswered:** Why Mobbin stored two frames.

---

## Not in this 15-step flow

Expanded editor, opening-message settings, reset, Compare. Those appear in other flows or only in the live audit.
