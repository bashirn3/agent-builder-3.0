# Setting up two-factor authentication

Source: https://mobbin.com/flows/4f646851-8420-4ab1-b51a-59e94fba6136  
5 recorded steps. All downloaded and visually inspected.

This is **setup** from Account settings. Login-time 2FA challenge is Logging in 06–07.

**Do not publish frames 02–04.** They contain a TOTP secret and recovery codes. Those values are not transcribed here.

---

## 01 — Account settings, 2FA not set up

- **Position / screen ID:** 1 / `22d98409-6111-44bc-af05-8df237cab0a8`
- **What is visible:** Account page. Name field. Email field. Two-step verification: Authenticator App + Setup. Danger zone: Delete account.
- **What changed:** First frame.
- **What the user appears to be doing:** Viewing account settings. Arrival from the account menu is **inferred** (see Logging out 01 / Account settings inventory).
- **Known vs inferred:** Settings sections: **Observed in Mobbin**.
- **Wasup relevance:** 2FA setup lives under Account, not under agent Settings. Do not assume Wasup needs a Settings page for this.
- **Unanswered:** Is Authenticator App the only method?

---

## 02 — Setup modal, QR + empty code

- **Position / screen ID:** 2 / `dbbdd1d7-207a-465c-998a-29a609b24a9c`
- **What is visible:** Modal “Two-factor authentication.” QR code. Manual secret (visible in the PNG, **omitted**). Six empty digit boxes. Confirm gray.
- **What changed:** Modal over settings.
- **What the user appears to be doing:** Started setup. Setup click **inferred**.
- **Known vs inferred:** Modal structure: **Observed in Mobbin**. Secret value: present in the file, not documented.
- **Wasup relevance:** Standard authenticator enroll. Not a Wasup decision yet.
- **Unanswered:** Can the user close without enrolling? Close X is visible.

---

## 03 — Code filled, Confirm enabled

- **Position / screen ID:** 3 / `50896e7e-1c87-4ea8-b2cb-cdd6e92c53d4`
- **What is visible:** Same modal. Six digits filled. Confirm black. Secret still visible (omitted).
- **What changed:** Digits entered. Confirm enabled.
- **What the user appears to be doing:** Entered the authenticator code.
- **Known vs inferred:** Enabled Confirm: **Observed in Mobbin**.
- **Wasup relevance:** Confirm stays disabled until six digits.
- **Unanswered:** Wrong-code error? **Not recorded.**

---

## 04 — Recovery codes

- **Position / screen ID:** 4 / `52635aa2-273b-4255-bf2c-7a8614b06430`
- **What is visible:** Modal “Two-Factor Recovery Codes.” Eight codes visible in the PNG (**omitted**). One-time-use warning. Cancel / Download. No copy-all button observed.
- **What changed:** Enroll modal replaced by recovery-code modal.
- **What the user appears to be doing:** After confirm, shown backup codes. Confirm click **inferred**.
- **Known vs inferred:** Download + eight codes: **Observed in Mobbin**. That Cancel abandons enrollment: **Unverified**.
- **Wasup relevance:** Recovery-code step exists. Login 06 links “Use a recovery code” but that path is not recorded.
- **Unanswered:** Must the user Download to finish?

---

## 05 — Settings, 2FA now has overflow

- **Position / screen ID:** 5 / `0ab936a1-6fe8-4fe4-979f-aff8b1b2f61c`
- **What is visible:** Same settings page. Setup replaced by an overflow “…” on Authenticator App. Email field shows a **different** capture account than frame 01 — capture seam.
- **What changed:** Setup button gone. Overflow present.
- **What the user appears to be doing:** Finished setup. Download click **inferred**.
- **Known vs inferred:** Overflow instead of Setup: **Observed in Mobbin**. Email mismatch: **Observed in Mobbin** (seam). Overflow contents (disable / regenerate): **not recorded**.
- **Wasup relevance:** Enrolled state is a quiet overflow, not a green “enabled” badge.
- **Unanswered:** How does the user disable 2FA?
