# Mobbin reference pack

## Capability check

- Mobbin MCP can inspect actual screen images, not just metadata. The `search_screens` results rendered visible screen previews in-chat.
- Mobbin MCP also returned per-screen `image_url` download endpoints. I verified export/save support by downloading the selected images as JPG files into this folder.
- There does not appear to be a separate named “export” tool in the MCP schema; the permitted export path used here is the returned `image_url`.

## Visual direction

Use the OpenAI/ChatGPT direction as the coherent baseline: white and very light gray surfaces, restrained typography, rounded controls, black primary actions, minimal chrome, and clear separation between editing and testing states.

The provided Chatbase web collection was inspected and has useful playground/compare references, but the final four stay mostly in the OpenAI/ChatGPT family for stronger visual consistency. The starting web collections did not provide true phone-viewport mobile settings or chat screens, so the mobile references come from ChatGPT iOS.

## Implementation addendum: best of both worlds

After the second design pass, the UI should no longer copy OpenAI Platform's broad sidebar shell. The product only needs one existing-agent workspace, so the revised direction keeps OpenAI's restraint and prompt-work density while borrowing Chatbase's focused setup-plus-preview composition.

Chatbase screens used for the current implementation:

- Chat widget content with live preview: https://mobbin.com/screens/ddc14749-d551-4ff6-92fe-7bc7c0e9ec4d
- Chat widget style settings with sticky unsaved-change actions: https://mobbin.com/screens/d0f6e7fa-2b68-4c36-9475-fc19cd8a700e
- Chat widget AI instructions beside dark preview: https://mobbin.com/screens/1865cdcc-0cb0-4b20-8d21-56c8eeef8d2b
- Help page settings beside browser-like preview: https://mobbin.com/screens/21fdda06-9dc1-4d6d-bd96-35679c8e5ee8

Borrow:

- A focused settings panel with local section tabs instead of a product-wide sidebar.
- A live tester preview placed on a faint dotted canvas.
- A contained chat surface that reads as a test widget, not a whole inbox.
- Sticky save/discard/lock decisions tied to the configuration panel.

Exclude:

- Chatbase's broad left navigation, deployment menus, analytics, data-source sections, and embed setup.
- Branding/theme controls that are not part of this agent builder.
- Any "create chatbot" or workflow-building path; this app edits and tests one connected agent.

## Selected references

### 1. Minimal login

- Local image: `01-minimal-login-openai-platform.jpg`
- Source: https://mobbin.com/screens/26266e32-a8d0-447c-ba71-8b71499729c6
- App/platform: OpenAI Platform / web

Why this was selected:
- It is the cleanest starting-collection login pattern: centered form, sparse brand mark, single dominant Continue action, and optional social login below.
- It matches this product’s limited scope: login should feel like a quiet entry point into one existing-agent workspace, not an onboarding or product-selection flow.

Borrow:
- Centered narrow auth column with generous whitespace.
- One black primary action.
- Minimal brand/navigation chrome.
- Secondary auth options visually quieter than the primary email path.

Exclude:
- Account creation emphasis if the product is invite-only or workspace-bound.
- Extra marketing panels, feature cards, or animated previews on the login page.
- Any onboarding language implying users are creating agents or workflows.

### 2. Desktop configuration beside test chat

- Local image: `02-desktop-prompt-playground-openai-platform.jpg`
- Source: https://mobbin.com/screens/373024f7-22f1-4030-a0be-172589392c4c
- App/platform: OpenAI Platform / web

Why this was selected:
- It directly maps to the main journey: edit the system/master prompt on the left, test the connected agent in a chat pane on the right.
- It keeps configuration, variables, tools, save state, and test input visible without switching contexts.
- The layout is close to the current builder screenshot while being cleaner and more scalable.

Borrow:
- Two-pane desktop composition: configuration/editor left, playground/chat right.
- Clear draft/save state in the header.
- Compact top-level actions for version history, save state, and lock/unlock state.
- Empty chat state that tells users where test output will appear.

Exclude:
- Full model/tool playground complexity that suggests users are building arbitrary AI systems.
- Side navigation sections unrelated to the product, such as API keys, logs, fine-tuning, media generation, or broad usage dashboards.
- “Create new agent” affordances; this product configures an existing agent only.

### 3. Mobile settings/editing

- Local image: `03-mobile-instructions-chatgpt-ios.jpg`
- Source: https://mobbin.com/screens/e38ce839-20a6-479d-ba6c-b128f39fb3ff
- App/platform: ChatGPT / iOS

Why this was selected:
- The bottom-sheet “Instructions” editor is a compact mobile pattern for editing prompt-like settings while preserving context behind it.
- It fits mobile editing of the master prompt, opening message, or lightweight configuration fields without exposing a desktop-style sidebar.
- It keeps the Save action prominent and spatially tied to the editable instruction content.

Borrow:
- Single-purpose editor sheet for prompt/instruction changes.
- Short helper copy under the text area explaining scope and impact.
- Large tappable Save control and clear close/back affordance.
- Context-preserving overlay for mobile configuration.

Exclude:
- Personal/group-chat concepts that do not apply to an existing-agent builder.
- General “Customize ChatGPT” language.
- Any account-personalization settings, memory settings, or social/project features unrelated to the configured agent.

### 4. Mobile chat/testing

- Local image: `04-mobile-chat-testing-chatgpt-ios.jpg`
- Source: https://mobbin.com/screens/10f190d9-afcf-456a-b86b-ceadedcc14ab
- App/platform: ChatGPT / iOS

Why this was selected:
- It is a focused mobile chat/testing reference: assistant responses, user messages, inline response actions, and a persistent bottom input.
- It supports the locked tester state: users can continue testing the finalized agent without seeing editing controls.

Borrow:
- Full-height conversation canvas with minimal top chrome.
- Persistent bottom composer with attachment/voice-style affordance positions adapted to product needs.
- Lightweight message actions for inspecting or copying responses.
- Clear separation between user bubbles and assistant text blocks.

Exclude:
- Voice/image/group-chat controls unless the product actually supports them.
- Consumer ChatGPT account/profile concepts.
- Broad conversation history/navigation if the tester is only for the selected existing agent.

## Notes for implementation later

- Keep the product scope explicit: configure and test an existing n8n-connected agent.
- Favor the desktop split view from reference 2 for the builder/playground.
- Favor the mobile sheet from reference 3 for editing and the full-screen chat from reference 4 for testing.
- Keep the header focused on the single selected agent, version status, history, lock/save, and sign out.
