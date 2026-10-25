# Parlant pilot: status and recommendation

Status, 12 Oct 2026: Parlant ran live on gpt-6-luna (Azure) against the shared n8n booking workflow, on a sample of
147 conversational runs and 60 booking runs. It is worse than v8 and slower, so the decision is to keep n8n with the
catalog-rendered prompt (rule 3 below).

## Measured

| | v8 (n8n) | v9 final (n8n) | Parlant |
|---|---|---|---|
| Conversational real flags | 3 of 908 | 4 of 1063 | 3 of 144 |
| Booking real flags | 2 of 172 | 1 of 180 | 14 of 56 |
| Judge average (1 to 5) | 4.500 | 4.502 | 4.378 |
| Median turn, bookings | 14.5 s | 11 s | 40 s |
| Input tokens per turn | about 65k in 1 to 3 calls | about 19k, about half cached | about 53k in about 11 calls |

Most of Parlant's booking failures (9 of 14) are moves and cancels, and they come from the pilot's wiring, not from
Parlant: right after a successful booking, `get_my_bookings` returns no bookings, so there is nothing to move or cancel.
The bookings Parlant makes are not recorded under the customer's phone the way the n8n agent records them. Its booking
row is therefore not a fair measure until that is fixed. The conversational numbers are: its judge scores are lowest
on `one_question` (4.54 against v8's 4.73) and `brief` (4.56 against 4.71), and per-turn rule matching did not make it
follow the voice rules better than the full prompt does. Latency is about 2.5 times n8n's on the same workflow.

## What exists

- `parlant/k1_agent.py` builds the agent from the same `prompts/k1-guidelines.yaml` as the n8n v9 prompt, so both are
  tested on the same rules:
  - 29 core rules always apply.
  - 46 conditional rules are matched per turn.
  - 10 override and dependency links.
  - A booking journey: find times, offer, pick, name, book, confirm, with branches for a time that was just taken and
    for a rejected name.
  - 10 glossary terms (stations, products, measuring, 0306).
  - Canned opt-out replies in Finnish, English and Swedish.
- Its tools call the existing n8n booking workflow (`get_station_info`, `get_slots`, `book_inspection_invite`,
  `get_my_bookings`, `cancel_booking`, `reschedule_booking`, `faq_lookup`), so no booking logic is duplicated.
  - `opt_out` and `escalate_to_human` record locally, as the n8n Code-node versions do.
  - Cancel and move only accept event ids from this phone's own bookings, the same check the n8n agent path applies.
- `K1_EVAL_TARGET=parlant tools/k1-v2-eval.py run ...` runs the same 835 scenarios and the same checks against it.
  `tools/k1-battery.sh parlant parlant` runs the full battery, the judge and the golden chats.
- Offline checks, all passing:
  - `parlant/check_build.py`: the whole agent builds on Parlant 3.3.2.
  - `tests/test_parlant_adapter.py`: the eval adapter's session, opener, turn, tool-step and error handling.

## Latency and cost: measured for n8n, estimated for Parlant

The n8n agent makes one agent call per turn, with tool round trips inside it. Measured per turn in the committed runs:

| Run | Turns | Median | p90 | With tools, median / p90 |
|---|---|---|---|---|
| v5 full | 1280 | 9.1 s | 15.3 s | 11.9 / 17.4 s |
| v7 pilot | 83 | 10.3 s | 15.5 s | 12.0 / 16.5 s |
| v7 voice | 86 | 14.2 s | 30.6 s | 14.7 / 38.5 s |

Parlant, read from its 3.3.2 engine (`optimization_policy.py`, `engine.py`):

- **Matching.** The 46 conditional guidelines are matched in batches of 5, which is about 10 matching calls. They run in
  parallel, so they cost about one call's time. Core rules skip matching.
- **Journey.** Choosing the next state of the booking journey takes one more call.
- **Tools.** When a tool fires, one call decides the tool arguments, and the engine then runs another round, up to 3.
- **Reply.** One call writes the reply, plus one more when a canned opt-out reply can fit.
- **Per turn.** About 12 to 15 LLM calls on a turn without tools, about 25 to 30 on a turn with a tool, in 3 to 5
  sequential stages. The n8n agent's own calls are 1 to 3.

Expect each turn to cost several times more in tokens. Latency depends on how fast the model is per stage. With the
same Azure gpt-5 deployment, each stage takes several seconds, so Parlant will very likely be slower than n8n's 10 to 14
second median. The main lever is a faster model for matching: Parlant picks the model per task, and its OpenAI
adapter already uses smaller models for some steps.

These are estimates from the code, not measurements. The pilot run measures them: the adapter records the latency of
every turn, as for n8n.

## The decision rule

Run the battery on v8 (live), on v9 (the catalog prompt in n8n) and on Parlant, then gate each candidate against v8.

1. **Ship v9** if it passes the gate. This takes Parlant's main idea (one rule, one place, one test, no
   contradictions) without a new service. It is the default path.
2. **Plan a move to Parlant** only if all of these hold:
   - it passes the gate against v8;
   - pairwise against v9, Parlant wins more than 1.2 times v9's wins plus 2 (the gate's pairwise margin, applied the
     other way round);
   - its p90 latency is at most the v8 p90 plus 5 seconds;
   - the cost per conversation is acceptable to K1.

   The move would be: n8n keeps the WhatsApp webhook and the booking workflow, and forwards each message to the Parlant
   session, the way the eval adapter does.
3. **Otherwise** keep n8n with the catalog-rendered prompt. Parlant stays useful as a reference: when v9 gets a rule
   wrong, check whether Parlant, which only sees the matching rules, gets it right. If it does, that rule is being
   drowned out in the full prompt, and the fix is a shorter or higher-priority rule, not another paragraph.

## Recommendation

Keep n8n. Even leaving the bookings aside, Parlant fails rule 2 on the judge and on latency.

- v9 already fixes the measured causes of the regressions:
  - duplicated and conflicting rules;
  - the stale v7 platform prompt in the eval;
  - the missing per-rule gate (it catches all three regressions that shipped between v4 and v7).
- Parlant adds a second service and several times the LLM calls per turn, on a channel where the n8n agent is already
  10 to 14 seconds per reply.

Revisit if v9 fails the gate on voice or language rules and no catalog change fixes it. That is the case Parlant's
per-turn matching exists for.

## To run it

```bash
pip install -r design/k1-fresh/parlant/requirements.txt
export K1_PARLANT_NLP=azure AZURE_API_KEY=... AZURE_ENDPOINT=... AZURE_GENERATIVE_MODEL_NAME=gpt-5 AZURE_EMBEDDING_MODEL_NAME=text-embedding-3-large
python3 design/k1-fresh/parlant/k1_agent.py &          # first start evaluates the 75 guidelines (cached afterwards)
cd design/k1-fresh && K1_BASE_RUN=runs/v8 tools/k1-battery.sh parlant parlant
python3 tools/k1-gate.py check --base runs/v8/all.json --cand runs/parlant/all.json --judge-base runs/v8/judge.json \
  --judge-cand runs/parlant/judge.json --pairs runs/parlant/pairs-v8.json --golden runs/parlant/golden.json --out runs/parlant/gate.json
```

Then fill in the table above with the Parlant row and the gate results.
