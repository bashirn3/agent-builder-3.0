# Deleting an instance

Source: https://mobbin.com/flows/1e2fa305-bdfd-42ff-a739-959813954ad2  
2 recorded steps. All downloaded and visually inspected.

No confirm dialog is recorded between the menu and the single-pane result.

---

## 01 — Overflow menu (shared)

- **Position / screen ID:** 1 / `4161d47e-955b-4f4c-8567-01e99313c58a`
- **What is visible:** Same overflow as Moving instances 02: Move left / Move right / Clear chat / Delete agent (red).
- **What changed:** First frame.
- **What the user appears to be doing:** About to delete.
- **Known vs inferred:** Menu: **Observed in Mobbin**.
- **Wasup relevance:** Naming collision: “Delete agent” vs workspace-level Deleting an agent flow.
- **Unanswered:** Confirm or immediate delete? Frame 02 suggests no recorded confirm.

---

## 02 — Single GPT-5 pane + model info card

- **Position / screen ID:** 2 / `f7b551e2-9cfb-45f6-821e-183585a02045`
- **What is visible:** One GPT-5 pane. Centered info card: OpenAI / GPT-5, credits cost 1, temperature 0.5, system prompt Custom. Compare header still present (Clear all chats / Reset / Add an instance).
- **What changed:** Second pane gone. Info card appeared. Claude instance gone.
- **What the user appears to be doing:** Deleted the other instance. Click **inferred**.
- **Known vs inferred:** Single pane + card: **Observed in Mobbin**. No confirm frame: **Observed in Mobbin** (absence). That delete is immediate: **Inferred**.
- **Wasup relevance:** Out of scope. The info card is a useful “what is this model” pattern if Wasup ever surfaces model details.
- **Unanswered:** Does the card appear only when one instance remains?
