# Chatbase flow research (Playground + Auth)

Research-only pack. No frontend implementation, no wireframes, no Clerk configuration, no backend changes, no new visual direction, and no live Chatbase interaction in this phase.

**Date:** 2026-09-23  
**Source:** Mobbin MCP `search_flows` (Chatbase, web)  
**Comparison:** [design/chatbase-audit/report.md](../chatbase-audit/report.md) (live audit, same day)

**Build-ready handoff (video + mobile, 2026-09-23):** [handoff/README.md](handoff/README.md)

Stop here for review. Activity, Contacts/Leads, Settings, and Deploy are inventoried only. They are not fully processed.

---

## What this pack is

Mobbin records named Chatbase flows as ordered screenshots. This pack:

1. Maps the named flows found for authentication, Playground, Activity, Contacts, Settings, and Deploy.
2. Downloads and visually inspects **every recorded frame** in the selected Playground and Auth flows.
3. Documents each frame with analyst titles, known vs inferred language, and Wasup relevance.
4. Keeps historical Mobbin screens separate from the live 2026-09-23 Chatbase audit.

It does **not** enumerate the entire Mobbin Chatbase collection. There is no catalog-wide total count.

---

## Evidence labels

Use these labels as written. Do not silently mix them.

| Label | Meaning |
| --- | --- |
| **Observed in Mobbin** | Visible in a downloaded frame from a named flow. |
| **Previously observed live** | Confirmed in the 2026-09-23 live audit. |
| **Inferred** | Reasonable reading of a static frame or a missing click between frames. Not a verified fact. |
| **Unverified** | Not in the recorded flow and not live-tested. |
| **Recommendation** | A later-design suggestion, not a requirement. |

The tool does not provide interaction annotations. Write “Frame 6 shows the menu open.” The triggering click is **inferred**.

Static screenshots cannot establish animation timing or motion quality.

---

## Pack layout

```
design/chatbase-flow-research/
  README.md
  flow-inventory.md
  coverage.md
  playground/
    setting-up-a-playground/
    setting-up-an-agent/
    comparing-ai-models/
    recording-a-prompt/
    adding-an-instance/
    moving-instances/
    deleting-an-instance/
  auth/
    logging-in/
    logging-out/
    reset-password/
    setting-up-two-factor-authentication/
    onboarding/
```

Each inspected flow folder contains:

- `manifest.json` — name, ID, app, platform, stable `mobbin_url`, screen IDs, local paths, inspection status
- `images/01.png` … — original 1920×1320 PNG conversions (no upscale)
- `contact-sheet-01.png` … — numbered review sheets (6 frames each)
- `flow.md` — step-by-step walkthrough

Cite the stable `mobbin_url` in `https://mobbin.com/flows/{id}` form. Do not use expiring `image_url` values as review links. The tool did not return per-screen page URLs.

---

## Image facts

- Every Mobbin step returned an `image_url`.
- Downloaded originals are **1920×1320 WebP VP8**, then converted to PNG with `sips` (format change only, no upscale).
- That canvas includes Mobbin footer chrome (“Chatbase” + “curated by Mobbin”). The product viewport is smaller than 1920×1320.
- Platform is **web**. These frames are desktop captures. Web does not automatically mean responsive mobile coverage. No phone-layout frames appear in the selected Playground or Auth flows.
- Inline Mobbin previews show only a subset of steps. This pack inspected **all** returned steps, including those not shown inline.

---

## Sensitive capture material

Some Auth frames contain capture-time secrets (TOTP secret, recovery codes, a revealed password). Those values are **not** transcribed here.

Do not publish the Auth image folder externally. Treat those PNGs as local research evidence, not documentation to share.

Capture-account emails visible in Mobbin frames are not repeated as committed auth material.

---

## How to read Playground vs Auth

Playground and Auth are separate recorded journeys. Shared `screen_id` values appear across flows. That means Mobbin reused a capture, not that the journeys are one sequence.

“Setting up an agent” is a **Compare-models** branch (`Back to Playground`), not first-agent creation. First-agent creation is Onboarding frames 09–20 and is likely out of scope for Wasup; the full recorded sequence is retained.

The historical Mobbin playground (settings column + dotted chat pane + “Powered by Chatbase”) is **not** the live 2026 playground (Overview / Display / Voice / Actions + contained widget). Both are documented. They are not one exact journey.

---

## Next after review

- Fully process Activity and Contacts/Leads if this pack is accepted.
- Live-inspect the unanswered questions listed in `coverage.md`.
- Do not start implementation from this pack alone.
