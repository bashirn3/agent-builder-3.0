# v8 baseline and why each version lost something

Status, 12 Oct 2026: the live v8 baseline and the v9 candidate have both been run on the shared n8n with gpt-6-luna,
judged with gpt-6-luna on Azure. Section 3 has the numbers. Sections 1 and 2 use the result files already in the repo
(v4 to v7).

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

## 3. The live v8 baseline and v9

Runs of 12 Oct 2026. Conversational means every non-booking scenario once plus the language, flow and voice scenarios twice
more. Outages are runs with a fallback reply, an HTTP error or a tool transport error; they are left out on both sides.
Real flags are flagged runs that are not outages. Latency depends heavily on how loaded the shared n8n was at the time,
so compare it only within one row.

| Version | Conversational runs | Outages | Real flags | Booking runs | Real booking flags | Judge (1 to 5) |
|---|---|---|---|---|---|---|
| v8 (live) | 949 | 41 | 3 | 180 | 2 | 4.500 |
| v9, first render | 949 | 16 | 3 | not run | | 4.525 |
| v9 with the clock moved to each turn | 949 | 0 | 12 | not run | | |
| v9 final (`11b8cf9`) | 1063 | 0 | 4 | 180 | 1 | 4.502 |
| Parlant, sample | 147 | 3 | 3 | 60 | 14 | 4.378 |

- **v9 final against v8, conversational.** The judge average is 4.502 against 4.500, and no criterion moved more than
  0.05. Pairwise on 621 shared scenarios, v8 wins 204, v9 193, tie 217, which is inside the gate's margin. The rule
  gate fails on `pilot.consent.en.sure` (one English reply in Finnish) and `voice.ack.fi.4` (one reply offered times
  without calling `get_slots`). Each failed one of three battery runs. Ten more runs of each, on both versions: v9 0 of
  20 flagged, v8 0 of 20. With those added, the gate still fails, because a single failure is more than the 2-point drop
  on a rule where v8 never failed.
- **The same gate fails v8 against v9.** Run the other way round (v9 as base), v8 fails `scope.bookable_only`
  (`book_other_nonbookable.sv`, a Swedish reply in Finnish), and against the first v9 also `vehicle.products`.
  The per-rule test catches one-off slips in both directions. A failure that does not repeat on rerun is noise, not a
  regression; deciding automatically needs the gate to rerun newly failing scenarios before it fails them.
- **Bookings.** The gate passes v9 against v8: 1 real flag in 180 runs against 2. The v9 flag is
  `pilot.replay.chat3_price.fi`: asked why the price is "suuntaa-antava", it agreed the price is an estimate.
- **What made v9 worse at first, and the fix.** On 36 runs of the 12 hardest scenarios, v8 flagged 2. The first v9
  render flagged 7, because its catalog wording for station referents and part-of-day times was shorter than v8's.
  Moving the clock out of the system message into each turn, for prompt caching, made it 11. With v8's full wording
  restored and only the date (not the minute) in the system message, it flagged 1.

### Vapi-style collection and repair rules (12 Oct 2026, after the table above)

From Vapi's prompt-builder skill and OpenAI's realtime prompting guide, four rules were added to the catalog:
`flow.known_name`, `voice.side_question`, `voice.every_question` and `voice.no_repeat`. Each came with devil tests
(`devil.vapi.*`), plus a `no_repeat_question` check. `devil.slot_taken` now also fails when the name is asked twice.
Clean runs, rechecked with the same checks on both sides:

| Scenario group | v8 | v9 with the new rules |
|---|---|---|
| Name given with the request, booked without asking again (`devil.vapi.name_upfront`) | 8 of 12 | 12 of 12 |
| Asked "why do you need that?", answers and rephrases (`devil.vapi.why_fuel`) | 5 of 9 | 8 of 9 |
| Side question while waiting for the name (`devil.vapi.side_question`) | 6 of 12 | 5 of 12 |
| Time taken after the name was given (`devil.slot_taken`) | 12 of 12 | 12 of 12 |
| Two questions in one message (`devil.vapi.two_questions`, `hours_and_price`) | 18 of 18 | 18 of 18 |
| Rest of the devil suite, one run each | 441 of 441 | 340 of 344 |

- The side question is answered in every run on both versions. What still fails is the follow-up: the name question
  comes back almost word for word.
- The four devil failures were backend outages: the ownership check, `get_my_bookings` and the booking record could not
  reach the database. The agent reported each one truthfully.
- **A regression the devil run found, now fixed.** In 3 of 115 bookings, the first build with the new rules booked the
  slot whose UTC clock matched the customer's time, so 10:15 became 13:15. v8 and v9d made 0 such bookings in 563.
  `tools.reference` now says the clock in a slot_id is UTC and the entry is found by its time field. A new
  `BOOKED_UTC_CLOCK` check flags it. After the fix: 0 in 107 bookings.
- **A harness bug, fixed.** `--repeat` shared one simulated customer, and with it one turn budget, across the repeats
  of a booking scenario. Later repeats were cut short, so the groups above were rerun with the fix on both versions.

### v9 new2: the conversation-design fixes, full battery against v8

Changes, from the chatbot-conversation-design and Agentforce conversation-design skills ("never a dead end",
"business rules in code, not in instructions", "return to the task after an interruption", "three-step fallback"):

- A failed model call is retried once. If it still fails, WhatsApp gets a short apology with 0306 100 100 (before, it
  got no reply, and the run still counted as a success). The playground message no longer asks the customer to
  rephrase.
- slot_id clocks are Helsinki time with the offset (`2026-10-13T10:15+03:00|…`), so the UTC trap is gone in code and its
  prompt warning is deleted. UTC ids still parse.
- New rules `flow.resume_task` (answer the side question, then come back to the offered times) and `voice.unclear`
  (ask, then offer two or three things, then 0306), with devil tests `devil.vapi.resume` and `devil.vapi.unclear`.

Full battery (1,182 runs) plus the devil suite (372 runs), both versions under the current checks:

| | v8 | v9 new2 |
|---|---|---|
| Runs with an outage (fallback reply, HTTP error) | 49 of 1,129 | 7 of 1,182 |
| Real failures, scenarios both ran | 7 | 7 |
| Devil suite, shared scenarios, real failures | 1 of 351 | 1 of 351 |
| `devil.vapi.resume` and `devil.vapi.unclear` | 13 of 18 fail | 0 of 6 fail |
| LLM judge, conversational runs | 4.50 | 4.48 |
| LLM pairwise, 620 shared | 214 wins | 185 wins, 214 ties |

- The outage drop fits the retry, but the two runs were on different days, so part of it can be staging load.
- 6 of v9 new2's booking failures were the staging database save timing out (Muster booked, the record did not
  save); the agent reported each truthfully.
- The pairwise gap is mostly near-identical replies. The one real pattern: after "cancel my booking" found nothing,
  the new resume rule made the agent offer a new booking (7 of 9 versus 2 of 9). Fixed in `bookings.lookup_first`
  (cancel: 0306, no offer; move: times plus 0306 so the customer does not end up with two bookings; only asking:
  offer to book), checked by `voice.mine.cancel_none` and `voice.mine.move_none`, 39 of 39 clean after the fix. The
  judge still prefers v8's shorter cancel and move replies without 0306 (8 to 2 on 13 single pairs).
- A booking confirmation check missed inflected Finnish weekdays ("keskiviikolle"); 12 false flags, fixed.
- Open: `voice.side_question` still re-asks the name or fuel type in near-identical words in about 1 run in 3.

### Re-running it

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
replies, HTTP errors and tool transport errors are left out of the rule rates on both sides. Results from runs made
before a check changed are compared only after `tools/k1-v2-eval.py recheck FILE...` has re-run the current checks on
both sides.

## 4. Not done, and why

- The other developer's rules suite (`v2_rules.py`, `v2_rule_checks.py`, `k1-rules-eval.py`, `k1-rules-audit.py`) was
  never shared; only `tests/RULES-conversational.md` is in the repo. The catalog and the judge cover the same ground (one
  rule, one test; how the agent talks). If his 159 scenarios arrive, add them to `v2_scenarios.py` and list their ids
  under the catalog rules they prove.
- [PR #35](https://github.com/bashirn3/agent-builder-3.0/pull/35), [PR #36](https://github.com/bashirn3/agent-builder-3.0/pull/36) and [PR #37](https://github.com/bashirn3/agent-builder-3.0/pull/37) are still open. This branch starts from the v8 branch, so the catalog starts from what is live.
