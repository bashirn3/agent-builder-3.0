# Logging out

Source: https://mobbin.com/flows/2684ff45-1eb1-4cc9-a1b0-bb63a21a57f4  
2 recorded steps. All downloaded and visually inspected.

No confirm dialog is recorded.

---

## 01 — Account menu open on playground

- **Position / screen ID:** 1 / `c0638095-87a3-4588-bbea-f8f4c1563af1`
- **What is visible:** Historical playground. Account menu open at the top right: capture email, Dashboard, Account settings, Create or join workspace, Sign out (red). Agent shows 2 Actions Enabled. Last trained 5 minutes ago + 70 KB.
- **What changed:** First frame.
- **What the user appears to be doing:** Opened the account menu. Avatar click **inferred**.
- **Known vs inferred:** Menu items: **Observed in Mobbin**. Live account menu **not fully documented** in the audit.
- **Wasup relevance:** Sign out lives in an account menu, not a Settings page. Settings page is not required for sign-out.
- **Unanswered:** Is the same menu on the Agents list?

Shared with Account settings 02 (inventory only).

---

## 02 — Marketing home

- **Position / screen ID:** 2 / `cf69146f-f96f-41ce-ac78-dba5aac058f0`
- **What is visible:** Same marketing home as Logging in 01.
- **What changed:** App chrome gone. Public site.
- **What the user appears to be doing:** Signed out. Click **inferred**. No confirm frame.
- **Known vs inferred:** Result: **Observed in Mobbin**. Immediate sign-out: **Inferred**. Session cleared: **Unverified**.
- **Wasup relevance:** Destination after sign-out is marketing home, not the login form.
- **Unanswered:** Does current Chatbase return to `/auth/signin` instead?
