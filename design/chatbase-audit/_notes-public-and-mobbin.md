# Scratch notes: public surfaces + Mobbin (not the signed-in playground)

These are supplements. They do **not** replace live playground inspection.

## Public marketing widget (live, 2026-09-23)

- URL: `https://www.chatbase.co/`
- Viewport: 1440×900
- Evidence: `screenshots/03-marketing-widget-open.png`
- Launcher: 59×59 circle, bottom-right (x=1367, y=827)
- Open: click “Open Chatbase AI Agent” → iframe overlay, launcher becomes “Close”
- Iframe: `https://www.chatbase.co/chatbot-iframe/…?theme=dark` titled “Chatbase AI Agent”
- Measured iframe: 406×765 at x=1018, y=50
- Observed chrome (from screenshot + a11y):
  - Dark header with wordmark “Chatbase AI Agent”, overflow `…`, close `×`
  - Opening bubble: “Hey! Ask me anything about Chatbase.”
  - Suggested chips: How can Chatbase help me? / What integrations… / Free plan vs free trial? / Can I book a demo?
  - “Powered by Chatbase”
  - Consent: “By chatting, you agree to our privacy policy” + dismiss
  - Composer: “Ask me anything about Chatbase” + send
- Iframe internals (typing, Enter vs Shift+Enter, streaming): **Not verified** — iframe content is not interactable via the browser tools
- This is a **customer-facing widget**, not the agent-builder playground

## Homepage lifecycle demo (live)

- Tabs: 01 Build / 02 Test / 03 Deploy / 04 Optimize
- Clicking 02 Test expands copy: “Run real customer scenarios before going live…”
- Visible Test panel was a magenta “Analytics” mock (positive 5460), not an editable playground
- 01 Build showed Instructions + Branding cards (marketing illustration)
- 03 Deploy showed channel toggles (Wordpress, Website widget, iframe, Shopify, Email, Slack, WhatsApp, Messenger, Instagram)
- Tabs auto-advance; clicking one replaces the demo panel in place (no full-page navigation)
- **Not** the authenticated Playground

## Mobbin Chatbase “Setting up a playground” flow

Source: https://mobbin.com/flows/52947e76-b30a-4f91-8832-f424a32b744b  
Status: **supplement / historical screenshots**, not live-verified. Fonts in Mobbin previews are garbled.

Observed in that flow (do not treat as current product truth until live-checked):

- Left sidebar: Playground, Activity, Analytics, Data sources, Actions, Contacts, Deploy, Settings
- Header: workspace switcher + agent name
- Playground = two columns: settings left, dotted-canvas chat preview right
- Settings: Trained status, Compare AI models, Model dropdown, AI Actions, Instructions (system prompt) with Base instructions picker + textarea
- Unsaved: black sticky bar “You have unsaved changes. Do you wish to save them?” with Discard + Save to agent
- Chat: agent name + reset icon, opening message, user bubble right, assistant left, “Powered by Chatbase”, composer “Message…”, sources link
- Loading: three-dot ellipsis in assistant position
- Response actions: thumbs + “Show sources”
- Model upgrade upsell appears in the settings column

These match the user-attached Chatbase playground screenshot more than the current marketing homepage.

## Still blocked

- Authenticated workspace, agent switcher, real playground, save/autosave, isolated tester, mobile app chrome
- Cursor browser still has no Chatbase session as of this note
