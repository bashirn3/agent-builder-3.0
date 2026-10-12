# v8 baseline and why each version lost something

Status, 12 Oct 2026: the live v8 run could not be done yet. This VM has no n8n API key, no Supabase or Muster access and no
LLM key, and none can be added from inside the run. Everything that works without them is done and committed: the rule
catalog, the judge, the golden chats, the gate and the battery script. Section 3 explains how to run the live baseline in one
command once the secrets are added. Sections 1 and 2 use the result files already in the repo (v4 to v7).

## 1. What each patch broke, measured

`tools/k1-gate.py` compared each version with the previous one on the scenarios both ran, using the flags stored at the
time. Every regression below was checked against the transcript. Flags caused only by a check that got stricter later are
left out.

| Step | Shared scenarios | Gate | What was lost (transcript) |
|---|---|---|---|
| v4 to v5 | 261 | fail | `devil.x.date.past_hour_today`: "Book me today at 07:00." v4 offered three listed times. v5: "07:00 has already passed today. Did you mean 19:00, or another day?" It invented a time that no tool returned. |
| v5 to v6 | 113 | fail | `voice.greet.*`: v5 "Hi! Want me to find a time for your inspection?" v6 "Hi! I can help find an inspection time whenever you're ready." Greetings lost their question in English and Finnish, 3 of 8 greeting scenarios. |
| v6 to v7 | 139 | fail | `voice.mine.move_none.en`: v6 checked and offered a new booking. v7 "I can't check your booking right now, so I can't move it here. Please call K1 on 0306 100 100." |

Each of these regressions went live because a version was promoted once the failures someone was working on had been
fixed. Nobody compared each rule with the version before. The gate now does exactly that, and `promote` refuses to run
without a passing gate.

All three regressions are the same kind of mistake: a patch changed one thing, and a rule nobody touched lost attention.
v6 was about times right after consent, the three-message booking and a single sign-off (commit `99b0e05`). It never
touched greetings, yet greetings lost their question. That is the "one huge prompt" effect, measured.

## 2. Why the prompt keeps doing this

- **Three prompt sources, not two.** Besides the workflow `business_prompt` and the platform `masterPrompt` (sent with
  every turn as `[BUILDER PROMPT]`), the n8n agent's system message has its own "HOW YOU MUST BEHAVE (channel rules)".
  They contradict each other between the main agent and the follow-up agent in the live workflow: the main agent's rules
  say "Give the substance and the single question together; never add an acknowledgement bubble", while the follow-up
  agent's say "Split like a person does: acknowledgement, then substance, then the question."
- **The eval sent the v7 platform prompt to every candidate.** `k1-v2-eval.py` defaulted to `k1-platform-v7.json`.
  The default now follows the prompt being tested: `k1-platform-v9.json` from the catalog, or v8 with
  `K1_PROMPT_SOURCE=legacy`.
- **Duplicated and conflicting rules.** The language rules appeared three times. "No apologies unless something failed"
  competed with "a frustrated customer first gets a brief apology". The catalog keeps one copy of each rule and states
  which one wins (`voice.apology` overrides `voice.no_apology` only when the customer is frustrated, angry or rude).
- **The checks could not see tone.** The offline rubric scores v5, v6 and v7 the same (4.64, 4.63, 4.63 on the 113
  shared scenarios), even though v6 is clearly colder in the greetings above. Hearing that difference needs the LLM judge and
  pairwise A/B, which are now in `tests/v2_judge.py`.

## 3. The live v8 baseline, once the secrets exist

Add these as Cloud Agent secrets (Cursor Dashboard, Cloud Agents, Secrets): `N8N_RAPID_API_KEY` and `N8N_RAPID_BASE_URL`,
and `OPENAI_API_KEY` (or `ANTHROPIC_API_KEY` with `K1_JUDGE_PROVIDER=anthropic`). Supabase and Muster are reached through
n8n's own credentials, so no separate keys are needed for the battery.

```bash
cd design/k1-fresh
K1_PROMPT_SOURCE=legacy tools/k1-battery.sh v8 live              # live workflows, v8 platform prompt in every turn
tools/k1-agent-v2-build.py build                                  # v9 candidate rendered from prompts/k1-guidelines.yaml
K1_BASE_RUN=runs/v8 tools/k1-battery.sh v9 candidate
python3 tools/k1-gate.py check --base runs/v8/all.json --cand runs/v9/all.json \
  --judge-base runs/v8/judge.json --judge-cand runs/v9/judge.json --pairs runs/v9/pairs-v8.json --golden runs/v9/golden.json
```

The battery covers all 835 scenarios, including hyper chaos (`hyper.chaos`), the Maria replay (`pilot.v8.maria_kouvola`),
the opt-out replay (`pilot.v8.optout_inspected`) and rename (`pilot.v8.rename`). The 85 conversational scenario groups
(language, booking flow, voice) run three times in total, so a single outage does not decide pass or fail. Fallback
replies and HTTP errors are left out of the rule rates on both sides.

The bar for every later version is then `runs/v8/all.json` with its judge scores. Record the numbers in this file when
the run is done.

## 4. Not done, and why

- The other developer's rules suite (`v2_rules.py`, `v2_rule_checks.py`, `k1-rules-eval.py`, `k1-rules-audit.py`) was
  never shared; only `tests/RULES-conversational.md` is in the repo. The catalog and the judge cover the same ground (one
  rule, one test; how the agent talks). If his 159 scenarios arrive, add them to `v2_scenarios.py` and list their ids
  under the catalog rules they prove.
- [PR #35](https://github.com/bashirn3/agent-builder-3.0/pull/35), [PR #36](https://github.com/bashirn3/agent-builder-3.0/pull/36) and [PR #37](https://github.com/bashirn3/agent-builder-3.0/pull/37) are still open. This branch starts from the v8 branch, so the catalog starts from what is live.
