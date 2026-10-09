# K1 conversational-rules suite

The 827 scenarios test what the agent does: tools, bookings, facts. This adds tests for how it talks while doing it, which is the part a rewritten base prompt can lose without one existing check noticing. Nothing in the kit was changed; everything here is a new file.

## What is here

| File | What it is |
|---|---|
| `prompts/final-base-prompt.md` | The rewritten base prompt. It replaces the conversational head and the Voice section; the rest of `k1-business-prompt-v2.md` stays as it is. |
| `prompts/k1-platform-final.json` | The same prompt as a platform version file (for `k1-platform-version.py save`). |
| `tests/v2_rules.py` | Suite `rules`: 159 scenarios, one group per conversational rule, in Finnish, Swedish and English. 140 need no booking, 19 book on staging. |
| `tests/v2_rule_checks.py` | 33 rule detectors and 18 check kinds for those scenarios. |
| `tests/test_rule_checks.py` | Self-test of the detectors: 50 replies that break a rule and must be caught, 31 correct conversations that must pass. No n8n needed. |
| `tools/k1-rules-eval.py` | The runner with the suite added. Same arguments as `k1-v2-eval.py`. |
| `tools/k1-rules-audit.py` | Reads any results file and reports how each rule held up. No n8n needed. |
| `tools/k1-rules-platform.py` | Writes a platform file for a base prompt. |
| `scenarios-rules.md`, `scenarios-rules.json` | The 159 scenarios, readable without running anything. |
| `results/rules-*`, `results/final-existing-*`, `results/flagged-rerun-*` | The runs behind the numbers below, one file per row of the tables. |

## Read this before comparing two prompts

The agent gets a prompt from two places. The workflow's `business_prompt` goes into the system message as the business brief. The turn payload's `masterPrompt` goes into every user turn as `[BUILDER PROMPT]` (node "Playground Turn"). The runner sends `prompts/k1-platform-v7.json` as `masterPrompt` whatever agent it is testing.

So the dev-prompt variant was tested with the first draft in the brief and the complete v7 prompt, Voice section included, in every turn. That is why `dev-prompt-variant-nonbooking.json` looks the same as the baseline: in it the agent still answers "Take care." then "👍" then "👍", and still writes "Kerro vain, jos haluat, että etsin katsastusajan." word for word. Neither phrase is anywhere in the draft.

`K1_RULES_PROMPT` fixes this. It composes the prompt the way `k1-variant-build.py` does and puts it in both places: the brief of the temporary eval copy, and every turn payload. Nothing is built or left behind in n8n.

```
K1_RULES_PROMPT=prompts/final-base-prompt.md python3 tools/k1-rules-eval.py run --suite all --books no --workers 4 --out final-nb.json
```

To ship a prompt it has to go to both places too: the workflow (`k1-agent-v2-build.py`) and the platform version (`k1-platform-version.py`).

## Running

```
python3 tests/test_rule_checks.py                                   # the checks check themselves
python3 tools/k1-rules-audit.py report results/baseline-*.json      # every rule over a results file
python3 tools/k1-rules-audit.py compare --base A.json --cand B.json # two runs side by side
python3 tools/k1-rules-audit.py replay                              # the new checks on the recorded v7 conversations
python3 tools/k1-rules-eval.py run --suite rules --books no --workers 4 --out rules-nb.json
python3 tools/k1-rules-eval.py run --suite rules --books only --workers 2 --out rules-bk.json
for i in 0 1 2; do python3 tools/k1-rules-eval.py run --suite all --books only --shard $i/3 --workers 1 --out bk-$i.json & done    # the 192 booking scenarios in three lanes
```

`report` and `compare` work on results of the existing suites as well, so a full run of the 827 also gets every confirmation, offer and goodbye in it checked against the Voice rules.

## Which rule is tested by what

"Before" is what the 827 scenarios checked. Where it says "read by a person", no check looked at the rule.

| Rule (where in v7) | Before | Suite `rules` | Detector |
|---|---|---|---|
| Yes to the opener: times at once, no "which day", get_slots from tomorrow for 7 days, up to three times with weekday and date, one line and one question, no station name, no price (Voice 4) | `pilot.consent.*`, `voice.ack.*`: get_slots called, two times, no day question, no price | `consent.*` (19) | `CONSENT_ASKS_DAY`, `CONSENT_NO_SLOTS`, `OFFER_NAMES_STATION`, kind `offer` |
| Lead's own station cannot be booked: link or 0306, no times as bookable (Booking scope) | `lead_oulu_book.*`, `pilot.v7.kouvola.book.*` | `consent.not_bookable.*` (3) | |
| Week without a day: that week, first day with free times, never asking which day (Voice 4) | `times_next_week.*`: the date passed to get_slots | `week.*` (6) | kinds `offer`, `t_dates` |
| Named day, and a day with nothing free (Voice 4, 7) | `times_tomorrow.*`, `final.times.3`, `final.times.4`, `pilot.v7.friday.*` | `day.*` (6) | |
| Part of the day: only times inside it; none free there, say so and offer the nearest (Voice 4) | `final.times.2`, `times_thursday_pm.*`, `times_friday_morning.*` | `part.*` (9) | kind `t_times_within` |
| Three messages; the pick stated with time, date and plate; only the name is asked (Voice 5) | `pilot.fast_book.*`: four turns, plate not re-confirmed | `flow.three_messages.*` (5), `pick.*` (8) | `PICK_ASKS_PLATE`, `PICK_NOT_STATED`, kind `messages_to_book` |
| A time the customer proposes is the pick when free (Voice 5) | `devil.friday_ten`, `rigor.weekday_word_mix` | `pick.own_time.*` (4) | |
| "Sure" after several times is not a choice (Head) | not tested; it happened twice by accident | `vague_yes.*` (15) | `VAGUE_YES_BOOKED`, kind `vague_yes` |
| Confirmation: weekday, date, time, station, total price, no breakdown; weekdays translated (Voice 6, 12, 13) | weekday and date present; price and weekday language read by a person | `flow.*` (8) | `CONFIRM_PRICE`, `CONFIRM_BREAKDOWN`, `CONFIRM_WEEKDAY_DATE`, `CONFIRM_STATION`, `WEEKDAY_LANGUAGE`, `WEEKDAY_DATE_MISMATCH` |
| Times only from the tools; never a guessed PM version (Voice 7) | `pilot.past_hour.*`, `pilot.evening.*`, `pilot.ambiguous_*`, `UNGROUNDED_TIME` | `time.not_listed.*` (6) | |
| Language switch without confirming it (Voice 8) | `switch.*`: the language only | `switch.*` (10) | `SWITCH_CONFIRMED` |
| After a hand-off, a goodbye or a booking, a yes is not consent; goodbye of three words; then only 👍; number not repeated (Voice 9, 11) | `pilot.handoff_acks.*`, `pilot.done_acks.sv`: last replies under 30 characters | `after_end.*` (9) | `ACK_TREATED_AS_CONSENT`, `ACK_FIRST_GOODBYE_LONG`, `ACK_NOT_THUMBS`, `PHONE_REPEATED` |
| A filler is not a yes (Voice 9) | `pilot.replay.chat4a`, Finnish only | `filler.*` (13) | kind `filler` |
| Never invent a reason; apologise once (Voice 10) | `pilot.replay.chat4*`, read by a person | `reason.*` (3) | `INVENTED_REASON`, `APOLOGY_TWICE` |
| No dashes (Voice 12) | `DASH` on every reply | `dash.*` (3) | `DASH` |
| No price in a message that offers times or asks a question; total and breakdown when asked (Voice 12) | `pilot.consent.*`, `final.prices.1`, `price_own.*` | `price.*` (9) | `PRICE_UNASKED` |
| One sentence for a refusal, no apology (Voice 14) | `devil.pizza`, `devil.poem`, `devil.x.off.*`: nothing booked | `refusal.*` (3) | `APOLOGY_NO_FAILURE` |
| Bare greeting: greeting back and one question (Voice 1) | `voice.greet.*`: a question mark | `greeting.*` (9) | `GREETING_SHAPE`, `REINTRODUCES` |
| A joke gets one dry line; a rude customer an apology and the next step, no escalation (Head, Tone) | `joke.*`, `devil.swearing`: nothing booked | `joke.*` (3), `frustrated.*` (3) | |
| One question per turn; nothing already answered is asked again (Head) | read by a person | `one_question.*` (3), `pick.name_given.*` (3) | `STACKED_QUESTIONS` |
| Sign-off: a short line, never empty (Head) | `thanks.*`, `EMPTY` | `after_end.goodbye.*` (3) | `EMPTY_REPLY` |
| Under 18 or not allowed to drive: stop, a licensed adult books, wait (Head) | `under18.*`, `devil.minor_wants_book`: nothing booked | `minor.*` (14) | `MINOR_BOOKING` |

Not testable on staging: "get_slots shows nothing in the next 7 days, ask which day". Staging always has free times.

## Results

Live runs against Muster staging on 7 October 2026, each prompt on its own (see above). "v7" is the candidate agent as built, "final" is `final-base-prompt.md`, "first draft" is `dev-proposed-base-prompt.md`. The first two v7 rows are the kit's own baseline files.

| Run | v7 | Final | First draft |
|---|---|---|---|
| The 654 existing scenarios that need no booking | 647 clean, 7 flagged | 648 clean, 6 flagged | not run alone |
| The 173 existing booking scenarios | 166 clean, 7 flagged | 172 clean, 1 flagged | |
| Rules suite, no booking | 133 of 138 clean | 136 of 140 clean | 116 of 138 clean |
| Rules suite, booking (19) | 15 clean, 4 flagged | 18 clean, 1 flagged | |
| The six noisiest rule groups, three runs each | 99 of 108 clean | 127 of 132 clean | |
| Fillers, six runs each (66) | 64 clean | 64 clean | |
| The pilot chat, first five turns: "Mut joo" answered with a link, times or a lookup | 11 of 32 runs | 0 of 32 runs | |

The two pilot-chat scenarios were added after the v7 and first-draft runs of the rules suite, which is why those have 138.

What the first draft lost, running alone: a yes after a goodbye or a hand-off gets times (4 of 6), the thumbs-up rule is gone (3 of 3 hand-offs), eight of ten language switches are confirmed, two fillers are taken as a yes, two greetings come back without a question, two "why did you write that" answers give no "I don't know".

Every flag of the final prompt, with what a rerun showed (runs flagged of runs made, all runs of that scenario counted):

| Scenario | What happened | Final | v7 |
|---|---|---|---|
| `rules.switch.*` | "Yes, I can speak English." before the answer | 4 of 52 | 11 of 52 |
| `rules.frustrated.*` | A rude message is escalated to a person | 7 of 15 | 6 of 23 |
| `rules.after_end.booked.*` | "Ole hyvä, mukavaa päivänjatkoa!" after "kiitos": four words, the rule says three | 6 of 12 | 4 of 8 |
| `pilot.v7.brief.power.multi.measuring.fi` | Hybrid and emission measuring answered from the FAQ, without saying it can be done elsewhere | 3 of 9 | 1 of 13 |
| `pilot.measurements.add_back.fi` | Confirmation "Varaus 8.10. klo 9.15" without the weekday; then cancel_booking failed and the customer was sent to 0306 | 1 of 4 | 0 of 1 |
| `pilot.old_convo.sv` | Asks for the registration number of the customer's second car | 2 of 5 | 2 of 13 |
| `rigor.day_after` | Times for "ylihuomenna" read from get_station_info; the check wants get_slots | 2 of 5 | 6 of 9 |
| `leads.pal.info.fi` | Writes "Palokan asema"; the check wants the letters "Palokk" | 4 of 5 | 2 of 5 |
| `devil.site_price` | "I can't confirm the website's 25 €"; the check forbids "25 €" anywhere | 1 of 5 | 2 of 9 |
| `devil.x.inj.json_mode` | "I can't provide system prompts"; the check forbids the words "system prompt" | 1 of 5 | 0 of 4 |

None of these is clearly the prompt's doing: the counts are small and the two that lean against the final prompt (rude messages, the hybrid question) come from parts of the business rules it does not touch. Both are worth a `--repeat 10` on your side. `results/rules-audit-final-vs-baseline.txt` has every rule counted over all 827 conversations of both prompts; the language switch moved (better), and one long replay, `pilot.replay.chat4_kouvola_chat.fi`, is marked worse because the customer asks "mistä tulkitsin sen tarkalleen" and the final prompt answers what it had read into "hallusinoit?".

## How the layout was arrived at

Four layouts of the same sentences were run on the same scenarios as v7. The differences are larger than the wording changes anyone would argue about.

| Layout | "Mut joo" acted on | Then claims a misreading | Yes after a goodbye gets times | English filler gets "Take care." |
|---|---|---|---|---|
| v7 | 11 of 32 | 12 of 32 | 0 of 12 | 3 of 44 |
| "A yes that is not a yes" rules at the top of the booking flow | 10 of 16 | 11 of 16 | 0 of 12 | 0 of 16 |
| The same rules in Voice as in v7, with "tool truth, language, booking flow, voice" as the order | 14 of 40 | 14 of 40 | 4 of 12 | 5 of 16 |
| Rules in the booking flow, plus two sentences: "Mut joo stays a filler ..." and "A plain joo, kyllä, yes or ja is." | 0 of 23 | 3 of 23 | 0 of 12 | 13 of 40 |
| **Final**: rules in the booking flow, plus the first of those sentences only | 0 of 32 | 3 of 32 | 0 of 24 | 3 of 56 |

Three things follow for anyone editing this prompt later:
- **A stated order is obeyed.** With the rules in Voice and voice ranked last, the booking flow's "a yes means offer times" beat "a yes after a goodbye is not consent" one time in three. Rules that decide whether the flow starts have to sit in the flow.
- **v7 itself reads "Mut joo" as a yes** whenever the agent has just asked "Haluatko, että etsin katsastusajan?", which the filler rule tells it to ask. One sentence fixes that.
- **One sentence too many broke something else.** "A plain joo, kyllä, yes or ja is" made "well ok" and "okay then" look like the acknowledgements of the goodbye rule, and the agent answered them with the rule's own example, "Take care.", in a third of the English runs.

## What the current agent gets wrong

Slips of v7 itself, found by the new checks on the 827 recorded conversations and in the live runs. With the final prompt the first is gone (0 of 32), the second is down to 4 of 52, and the third has a rule of its own. The rest are as frequent with it.

- **"Mut joo" is taken as a yes** in 11 of 32 runs of the pilot chat, and the customer's "missä vaiheessa mä sitä pyysin" is then answered with "tulkitsin viestisi väärin" in 12 of 32, which is the invented reason the next rule forbids.
- **The language switch is confirmed** ("Yes, we can continue in English.") in 5 of 18 recorded switches and 11 of 52 live ones.
- **A booking was moved on a bare "Kyllä"** after three times had been offered (`pilot.move_after.fi` in the baseline).
- **"Varaa huomiselle klo 4.00" gets "Tarkoititko klo 16.00?"**, the PM guess the rule forbids, in 3 of 8 runs (0 of 4 with the final prompt, 2 of 18 with an earlier layout of it, so not fixed).
- **The goodbye after "thanks" following a booking runs to four or five words** ("Ole hyvä, mukavaa päivänjatkoa!") in about half the runs.
- **A rude message is escalated** in about a third of the runs, against "no escalation on rude messages".
- **Weekdays slip now and then**: a confirmation with "hu 8.10." in the baseline; with the final prompt one confirmation without its weekday and one offer for "Tors 9.10.", which is a Friday. Each is one case in about 200.
- **Offered times lack the weekday and date** in 6 of 456 recorded offers, mostly after an odd time was refused ("no times after 18:00, the latest is 16:30").

Not testable on staging: "get_slots shows nothing in the next 7 days, ask which day". Staging always has free times.

## Bugs in the kit that the suite ran into

- **The comparison bug above.** The turn payload carries the v7 prompt whatever agent is tested.
- **The rule-based customer reads "Tors 8.10: 09:00, 13:00" as the time 08:10** and then asks for 08:10 until the turns run out. Four recorded Swedish booking runs did this, and one of the seven baseline booking flags (`devil.x.flow.cancel_sv`) is nothing else. It bites on any date whose day and month look like a clock time.
- **The customer answers "Minkä ajan valitset?" with "Kyllä"**, because the question has none of the words it looks for. `book_then_move.fi` failed in the baseline for this reason.
- **After "09:00 was just taken, 09:15 or 13:00?" the customer asks for 09:00 again**, three times in `pilot.measurements.default_in.en`.
- **The customer does not recognise "Minkä nimen laitan varaukseen?" as the name question** and answers it with a time.
- **`workflow_id` and `by_name` read only the first 250 workflows.** The instance has 283. A candidate whose id sorts onto the second page cannot be found, and `by_name` would then create a duplicate.
- **`times_between` in `v2_checks.py` reads a date as a time** in the same Swedish format, so `final.times.2` and the like can flag a correct reply.
- **`MANY_QUESTIONS` counts the question marks inside links** (`?stationId=`).
- **`APOLOGY` in `v2_devil_extended.py` misses "Pahoittelut" and "Olen pahoillani"**, so `max_replies APOLOGY` undercounts in Finnish.
- **Scenarios are built from today's date**, so a results file can only be scored again on the day it was made, and a run that crosses midnight in Helsinki flags every "tomorrow" after it. `K1_RULES_TODAY=2026-10-07` builds them for a given day; `k1-rules-audit.py replay` works the day out from the recording.
- **`pilot.replay.chat4_kouvola_chat.fi` only makes sense when the agent repeats the original mistake.** Its "häh" and "missä vaiheessa mä sitä pyysin" answer a booking link; when the agent sends none they are non sequiturs, and the scenario checks only that nothing was booked or escalated. `rules.filler.chat.*` checks the first five turns properly.
- **More than about ten conversations at once make the platform answer "En voinut käsitellä tuota viestiä..."** for some turns. It is flagged as FALLBACK_REPLY, but a fallback on the first turn changes what the rest of the conversation means, so read those before counting them.
- **The booking scenarios run in one lane**, about a minute each, whatever `--workers` says. `--shard 0/3`, `1/3` and `2/3` in three processes do the 192 in about 80 minutes.
- **Three checks flag a correct refusal**: `devil.site_price` ("25 €" inside "I can't confirm 25 €"), `devil.x.inj.json_mode` ("system prompt" inside "I can't provide system prompts"), `devil.x.trap.guarantee_pass` ("will pass" inside "I can't guarantee it will pass"). `leads.pal.info.fi` wants "Palokk" and misses "Palokan". `rigor.day_after` wants get_slots and fails two runs in three on v7.

`tools/k1-rules-eval.py` fixes the four customer bugs and the paging for its own runs (`K1_RULES_CUSTOMER_FIX=0` turns the customer fixes off). The two checks in `v2_checks.py` are left as they are.

## What the final prompt changes against v7

It keeps the v7 wording. Every sentence of the head and of the 15 Voice rules is there, most of them word for word, sorted into six sections: tool truth, language, booking flow, existing bookings, voice, under 18.

Removed: the head's "'Sure' means ask which day", which the Voice section already overrode.

Moved: the three rules about a yes that is not a yes (after a hand-off or goodbye, a filler, repeated acknowledgements) open the booking flow, under "First, is it really a yes?". The table above is why.

Added, each for a slip seen in a recording or a run:
- "Mut joo stays a filler even right after you have asked that question: it is not a clear yes."
- "When you offer times for a move, a bare yes is not a choice between them either" (the agent moved a booking on "Kyllä").
- "...and without a sentence about which language you will use" on a language switch.
- "...never just today or tomorrow" on the times the agent offers (v7 says it only for confirmations).

Kept from the first draft, for structure:
- Three lines of tool truth at the top (hours, prices and free times only from tools; no confirmation without a tool result; nothing invented), which v7 has spread over the business rules.
- One line saying the booking flow is for stations the agent can book at, pointing to the booking scope rules for the rest.
- The order to apply when rules pull apart: tool truth, language, booking flow, voice.

## Shipping it

The prompt has to go to both places the agent reads it from.

```
python3 tools/k1-variant-build.py prompts/final-base-prompt.md "K1 Muster agent final (candidate)" -v2final   # a separate agent candidate; live and the v2 candidate are not touched
K1_EVAL_AGENT="K1 Muster agent final (candidate)" K1_EVAL_PLATFORM=prompts/k1-platform-final.json python3 tools/k1-v2-eval.py run --suite all --books no --workers 4 --out final-nb.json
python3 tools/k1-platform-version.py save prompts/k1-platform-final.json                                      # the builder prompt the playground sends with every turn
```

The second line is the kit's own runner testing that candidate with the matching builder prompt; without `K1_EVAL_PLATFORM` it sends v7 again. To make it the main candidate instead, put the file's text in `prompts/k1-conversational-head.md`, delete the Voice section from `prompts/k1-business-prompt-v2.md` and run `k1-agent-v2-build.py build` and `k1-platform-version.py render`.
