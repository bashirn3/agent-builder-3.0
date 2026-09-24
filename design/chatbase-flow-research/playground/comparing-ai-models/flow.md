# Comparing AI models

Source: https://mobbin.com/flows/7eb8b73f-350a-40fb-9527-8b16fedd97c8  
4 recorded steps. All downloaded and visually inspected.

Separate from “Setting up an agent” (settings/save) and “Recording a prompt” (waveform). Shared frames are reused captures, not proof they are one session.

---

## 01 — Playground idle (shared)

- **Position / screen ID:** 1 / `6ae9a069-07ff-4407-9148-384cd2e3ee8a`
- **What is visible:** Historical playground idle. GPT-5, 1 Action Enabled, Design Concierge instructions, opening message, Compare control in the settings column.
- **What changed:** First frame.
- **What the user appears to be doing:** About to enter Compare. Click not yet visible.
- **Known vs inferred:** Same capture as playground 10: **Observed in Mobbin**.
- **Wasup relevance:** Shows where Compare sits in the historical IA (settings column). Live IA has no Compare control.
- **Unanswered:** Is Compare still reachable from current playground?

---

## 02 — Dual GPT-5.1 compare (shared)

- **Position / screen ID:** 2 / `78548a27-8ee6-48cc-92cb-886a5824d6fb`
- **What is visible:** Compare, two GPT-5.1 panes, Sync on. Same as Setting up an agent 01.
- **What changed:** Left settings column replaced by Compare canvas.
- **What the user appears to be doing:** Entered Compare. Click **inferred**.
- **Known vs inferred:** Navigation result: **Observed in Mobbin**. Animation: **cannot be established**.
- **Wasup relevance:** Entry pattern only, if we ever need multi-model.
- **Unanswered:** Does Sync mean shared composer input?

---

## 03 — Split models, same question in both composers

- **Position / screen ID:** 3 / `218e17de-51f8-4ba2-94e8-8c790c9e5162`
- **What is visible:** Left GPT-5, right Claude 4.5 Haiku. Both composers: “How do I make long onboarding feel less boring?” Send filled black on both.
- **What changed:** Models diverged. Composers filled. Openers still visible.
- **What the user appears to be doing:** Prepared a side-by-side send. Whether Sync copied the text: **Inferred**.
- **Known vs inferred:** Dual filled composers: **Observed in Mobbin**. Shared with Recording a prompt 03.
- **Wasup relevance:** Parallel send is Compare-only.
- **Unanswered:** One send control or two? Both Sends look enabled.

---

## 04 — Side-by-side replies

- **Position / screen ID:** 4 / `fa79d27e-f521-4410-a6a0-87aa921b6319`
- **What is visible:** Both panes have replies. Left answers in design-concierge style. Right refuses (outside Next.js / Supabase kit expertise). “Just now” on both. Openers gone in the visible thread.
- **What changed:** Replies present. Composers cleared. Waiting state not recorded between 03 and 04.
- **What the user appears to be doing:** Comparing answers.
- **Known vs inferred:** Divergent replies: **Observed in Mobbin**. Simultaneous send: **Inferred**.
- **Wasup relevance:** Shows why Compare exists (model disagreement). Out of scope for one-agent Wasup unless we later want A/B.
- **Unanswered:** Can the user rate each pane independently? Thumbs not visible in this crop.
