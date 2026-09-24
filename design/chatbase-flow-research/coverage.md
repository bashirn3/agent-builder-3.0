# Coverage and evidence

“All frames inspected” means all frames in the **selected recorded flows**, not every possible state in live Chatbase.

Platform **web** does not mean responsive mobile coverage. Every downloaded Playground and Auth original is **1920×1320**. These are desktop captures with Mobbin footer chrome. No phone-layout frames appear in the selected flows.

---

## Search method

- Primary tool: `search_flows`
- Filter after return: `app_name == Chatbase` and `platform == web`
- Deduplicated by flow `id`
- Pagination: `page` 1–20, `limit` 1–10, `has_next_page` boolean
- No catalog-wide total is available
- A query containing “Chatbase” still returns other apps; those were discarded
- There is no open-flow-by-ID tool; rediscovery is always through search

---

## Search pages run (this session)

| Query (paraphrased) | Page | Chatbase hits used | has_next_page |
| --- | --- | --- | --- |
| Setting up a playground / comparing AI models | 1 | Playground family + Onboarding + Activity + Actions + Updating a chat widget | **true** |
| Logging in / out / reset / 2FA | 1 | Logging in, Logging out, Reset password, 2FA, plus Settings-adjacent | **false** |
| Deleting an instance / settings / deploy / contacts / activity | 1 | Deleting an instance, Activity, Settings-adjacent delete flows | **true** |
| Earlier: sign-in / logout / 2FA | 1 | Auth family | false |
| Earlier: activity | 1 | Activity, Chat logs | true |
| Earlier: deploy / settings | 1 | Deploy, Settings family | true |
| Earlier: playground / signup remaining pages | 2+ | Additional Playground-adjacent | true |
| Earlier: contacts / leads | 1 | Contacts | false |
| Earlier: reset-password | 1 | Reset password | false |

Remaining pages exist for playground-adjacent and settings/deploy queries. Those pages were not exhausted. **Do not claim the entire Chatbase collection was enumerated.**

---

## Selected flows — counts

### Playground (fully processed)

| Flow | Reported screens | Screens returned | Positions | Unique screen IDs | PNGs downloaded | Visually inspected |
| --- | --- | --- | --- | --- | --- | --- |
| Setting up a playground | 15 | 15 | 1–15 consecutive | 15 | 15 | 15 |
| Setting up an agent | 7 | 7 | 1–7 consecutive | 7 | 7 | 7 |
| Comparing AI models | 4 | 4 | 1–4 consecutive | 4 | 4 | 4 |
| Recording a prompt | 3 | 3 | 1–3 consecutive | 3 | 3 | 3 |
| Adding an instance | 2 | 2 | 1–2 consecutive | 2 | 2 | 2 |
| Moving instances | 3 | 3 | 1–3 consecutive | 3 | 3 | 3 |
| Deleting an instance | 2 | 2 | 1–2 consecutive | 2 | 2 | 2 |

No missing or duplicate **positions** inside a single flow. Shared `screen_id` values **across** flows are listed in [flow-inventory.md](flow-inventory.md).

Images: 36 Playground PNGs, all 1920×1320, converted from original-resolution WebP (not thumbnails). Contact sheets: 10 files.

### Auth (fully processed)

| Flow | Reported screens | Screens returned | Positions | Unique screen IDs | PNGs downloaded | Visually inspected |
| --- | --- | --- | --- | --- | --- | --- |
| Logging in | 8 | 8 | 1–8 consecutive | 8 | 8 | 8 |
| Logging out | 2 | 2 | 1–2 consecutive | 2 | 2 | 2 |
| Reset password | 7 | 7 | 1–7 consecutive | 7 | 7 | 7 |
| Setting up two-factor authentication | 5 | 5 | 1–5 consecutive | 5 | 5 | 5 |
| Onboarding | 20 | 20 | 1–20 consecutive | 20 | 20 | 20 |

Onboarding frame 12 is a readable loading screen, not a blank.

Images: 42 Auth PNGs, all 1920×1320. Contact sheets: 10 files.

Shared IDs reduce unique captures below 42+36, but each flow kept its own local copies.

### Inventoried only (not fully processed)

| Area | Flows discovered | Recorded steps returned | Images downloaded | Images visually inspected |
| --- | --- | --- | --- | --- |
| Activity | 2 named (+ 1 adjacent delete-all) | 5 + 3 (+ 4) | 0 in this pack | Inline subset only |
| Contacts / Leads | 1 named (+ Leads table inside Activity) | 2 | 0 | Inline subset only |
| Settings | 12+ named | 3–11 each | 0 | Inline subset only |
| Deploy | 5 named | 3–9 each | 0 | Inline subset only |

---

## Known gaps inside selected flows

### Playground — “Setting up a playground”

- Expanded instruction editor: **not recorded**. Live audit has a Global instructions dialog.
- Opening-message settings: **not recorded**. Live audit has Display → Content.
- Reset conversation: **not recorded**. Live audit disables Reset while waiting; remount cleared the thread.
- Compare is **not used** inside this 15-step sequence. It is a separate family of flows.
- Frames 14 and 15 are visually near-identical at inspection resolution. Different `screen_id` values. Do not invent a thumbs-hover as fact.
- Frame 12 hides the opening message; frame 13 shows it again. Observed inconsistency; cause unverified.
- Plan / last-trained / getting-started values jump across frames 01–10. These are **capture-session seams**, not one continuous recording.
- Frame 09: preset dropdown reads “Base Instructions” while the body is still customer-support Role text.
- Save click, Discard click, model-row click, and send click are **inferred**. The frames show resulting UI.
- Action enable (“Add your first action” → “1 Action Enabled”) has no recorded enable step.

### Playground — Compare family

- Add-instance click inferred. After add, three panes show GPT-5 (models reset). Cause unverified.
- Delete-instance has no confirm dialog in the recorded 2 frames.
- Recording a prompt has no transcript-to-text animation. Frame 02 is a waveform; frame 03 is already typed text.
- “Setting up an agent” name is misleading. It is Compare settings, not first-agent creation.

### Auth

- Google / SSO completion: **not recorded**.
- Microsoft button: **not in Mobbin frames**. Live audit also did not show Microsoft on `/auth/signin`.
- Email verification after sign-up: **not recorded**.
- Password-reset inbox and post-update success: **not recorded**.
- Sign-out confirm: **not recorded**.
- No loading frame between 2FA continue and Agents list.
- Login-time 2FA **is** recorded (Logging in 06–07). 2FA *setup* is a different flow.
- Mobbin login is a white split. Live 2026 login is an indigo 50/50 at `/auth/signin`.
- Onboarding marketing hero (Cal booking) differs from Logging-in marketing hero (AI Actions card). Two capture sessions.
- Onboarding 09–19 (first agent, integrations, channels, billing) retained in sequence and marked **likely out of scope for Wasup**.

---

## Historical Mobbin vs live Chatbase (2026-09-23)

From [design/chatbase-audit/report.md](../chatbase-audit/report.md). Do not combine these into one exact journey.

| Topic | Observed in Mobbin | Previously observed live |
| --- | --- | --- |
| Playground IA | Settings column: Compare, Model, AI Actions, Instructions. Dotted chat pane. “Powered by Chatbase.” | Overview / Display / Voice / Actions. Contained themed widget on dotted canvas. No “Powered by Chatbase” in the live widget. |
| Save | Unsaved bar “You have unsaved changes…” Discard / Save to agent. Success toast after save. | Sticky Discard / Save always in DOM; disabled when clean. Save **click not live-tested**. Discard verified (no confirm). |
| Opening message | Shown as chat-pane opener. No settings UI in the 15-step flow. | Display → Content: initial message, chips, mobile variant. |
| Expanded instructions | Not recorded. | Centered “Global instructions” dialog. |
| Chat send | Opening vanishes on send (frame 12), returns (frame 13). Show sources while waiting. Thumbs after reply. | Chips vanish after first send. Waiting disables Send / Reset / dictation. Show sources. Remount cleared thread. |
| Login | White split “Welcome back.” Google + SSO + email/password. | Indigo 50/50 at `/auth/signin`. Google + SSO + email/password. Microsoft absent. |
| Post-login | Agents list. | Agents list. Matches. |
| Invalid credentials | Recorded. | Not live-tested. |
| Signup / reset / 2FA | Recorded in Mobbin only. | Not live-tested. |

---

## Questions requiring later live inspection

1. Does current Chatbase still expose Compare-models (multi-instance) from playground, or was that removed in the Overview/Display IA?
2. Where does opening-message editing live if we follow live IA (Display → Content) rather than the historical chat-pane opener?
3. What happens to the opening message after the first send — gone for good, or restored as in Mobbin frame 13?
4. Does Save to agent show the Mobbin toast, or only the sticky bar returning to disabled?
5. Is login-time 2FA still offered, and is setup still Authenticator-app + recovery codes?
6. Is sign-up still email/password + Google only (no SSO button), vs login which shows SSO?
7. Is email verification required after sign-up? Not in Mobbin.
8. Does password reset still expire in 15 minutes and require the same device/browser?
9. Does sign-out skip a confirm dialog, as the 2-frame Mobbin flow suggests?
10. Does current first-run onboarding still include tech-stack, channel picker, and paid-plan step before playground?
11. Are Activity “Chat logs” and “Leads” still the live names, or has Contacts been renamed?
12. What does Deploy show today, given Wasup will request deploy by email rather than publish automatically?

---

## Downloaded vs inspected

| Status | Meaning |
| --- | --- |
| Downloaded | Original-resolution WebP fetched from `image_url`, converted to 1920×1320 PNG. |
| Visually inspected | PNG opened and described from the image, not from inline Mobbin thumbnails alone. |
| Unreadable | None of the selected 78 frames were unreadable. Frame 12 of Onboarding is a real loading screen. |

OCR on Inter / Mobbin previews is unreliable. Visible structure and clearly readable short labels are used. Exact long-form instruction text is not manufactured from garbled OCR.
