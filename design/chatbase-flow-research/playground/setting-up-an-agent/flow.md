# Setting up an agent

Source: https://mobbin.com/flows/89e31288-80cb-4002-ad32-19c09202befd  
7 recorded steps. All downloaded and visually inspected.

**Name warning:** This is a Compare-models branch (`Back to Playground`), not first-agent creation. First-agent creation is Onboarding 09–20.

Keep this flow separate from “Setting up a playground” and “Comparing AI models.”

---

## 01 — Dual GPT-5.1 compare panes

- **Position / screen ID:** 1 / `78548a27-8ee6-48cc-92cb-886a5824d6fb`
- **What is visible:** Compare view. Two GPT-5.1 panes. Sync on. Header: Clear all chats / Reset / Add an instance. Back to Playground. Each pane has opening “Hi! What can I help you with?”
- **What changed:** First frame of this flow.
- **What the user appears to be doing:** Viewing Compare after entering from playground. Entry click **inferred** (shown as playground → Compare in the Comparing AI models flow).
- **Known vs inferred:** Dual-pane chrome: **Observed in Mobbin**. Live 2026 playground did not show Compare (**Previously observed live** — absent).
- **Wasup relevance:** Multi-model compare is likely out of scope for a one-agent builder. Recorded because it is the named “Setting up an agent” flow.
- **Unanswered:** Does current Chatbase still ship Compare?

Shared with Comparing AI models 2 and Recording a prompt 1.

---

## 02 — Left pane settings popover

- **Position / screen ID:** 2 / `1a90d4fb-5a39-44bd-bea2-699a6c9c3efa`
- **What is visible:** Left-pane settings popover: Model GPT-5.1, Temperature 0 Reserved, 1 Action Enabled, Base Instructions, Business Context.
- **What changed:** Popover open over the left pane.
- **What the user appears to be doing:** Opened instance settings. Click **inferred**.
- **Known vs inferred:** Popover fields: **Observed in Mobbin**.
- **Wasup relevance:** Per-instance model + temperature + instructions. Temperature is not in the historical single-pane playground column.
- **Unanswered:** What “Reserved” on temperature 0 means.

---

## 03 — Left pane now Claude 4.5 Haiku, temperature 0.5

- **Position / screen ID:** 3 / `45ff559f-e281-4657-9646-e4ce4c86e5b6`
- **What is visible:** Same popover. Model Claude 4.5 Haiku. Temperature 0.5.
- **What changed:** Model and temperature values.
- **What the user appears to be doing:** Edited instance settings. Clicks **inferred**.
- **Known vs inferred:** Values: **Observed in Mobbin**.
- **Wasup relevance:** Instance settings can diverge from the other pane before a global save.
- **Unanswered:** Is this local-only until frame 06?

---

## 04 — Instructions popover

- **Position / screen ID:** 4 / `e2dc63aa-3369-4afd-ba10-82a502114afa`
- **What is visible:** Instructions popover: Mobbin Design Concierge Role / Voice & Tone / Core Knowledge.
- **What changed:** Settings popover replaced by instructions popover (or stacked — the frame shows instructions).
- **What the user appears to be doing:** Reading or editing instance instructions. Click **inferred**.
- **Known vs inferred:** Text structure: **Observed in Mobbin**. Whether this is the expanded editor missing from the 15-step flow: **Inferred**, not the same live Global instructions dialog.
- **Wasup relevance:** Compare-only editor. Do not treat as the live expand-instructions dialog.
- **Unanswered:** Can this popover save independently of “Save settings”?

---

## 05 — Popovers closed; models still split

- **Position / screen ID:** 5 / `5ac07838-b2fc-4025-afb6-45c0012ab7a1`
- **What is visible:** Popovers closed. Left remains Claude 4.5 Haiku. Right remains GPT-5.1.
- **What changed:** Overlays gone. Split models persist on the panes.
- **What the user appears to be doing:** Closed the popover. Click **inferred**.
- **Known vs inferred:** Split models: **Observed in Mobbin**.
- **Wasup relevance:** Unsaved-looking instance state without the playground unsaved bar.
- **Unanswered:** Is there a dirty indicator on Compare besides the later modal?

Shared with Adding an instance 1 and Moving instances 1.

---

## 06 — Save settings confirm modal

- **Position / screen ID:** 6 / `21e14714-f1e3-42ef-bc75-fec771a0e208`
- **What is visible:** Modal: “Save settings / Are you sure you want to save the settings? This will be saved to the main agent settings.” Cancel / Save.
- **What changed:** Confirm modal over Compare.
- **What the user appears to be doing:** Attempting to save Compare settings back to the main agent. Triggering click **inferred**.
- **Known vs inferred:** Modal copy: **Observed in Mobbin**. That Compare settings write to the main agent: **stated in the modal**, not independently verified.
- **Wasup relevance:** Compare → main-agent save is Chatbase-specific. Wasup has one agent; this confirm may be unnecessary.
- **Unanswered:** Which control opens this modal?

---

## 07 — Success toast; dual panes remain

- **Position / screen ID:** 7 / `36bae7e5-535b-453d-b9df-b2bed6c7f07b`
- **What is visible:** Toast “Success Your changes are saved.” Dual panes still shown (Claude left / GPT-5.1 right in the prior state — confirm against the frame: panes remain).
- **What changed:** Modal gone. Toast present.
- **What the user appears to be doing:** Confirmed save. Click **inferred**.
- **Known vs inferred:** Toast: **Observed in Mobbin**. Main-agent persistence: **Unverified**.
- **Wasup relevance:** Same success-toast language as playground frame 09.
- **Unanswered:** After save, does leaving Compare update the single-pane playground model?
