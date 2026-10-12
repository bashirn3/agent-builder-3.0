#!/usr/bin/env bash
# The full test battery for one version of the agent, written to $K1_RUNS/<name>/.
#
#   tools/k1-battery.sh v8 live         live v8 (the live workflows, with prompts/k1-platform-v8.json in every turn)
#   tools/k1-battery.sh v9 candidate    the candidate workflows built by k1-agent-v2-build.py (prompt from the catalog)
#   tools/k1-battery.sh parlant parlant the Parlant shadow agent (K1_PARLANT_URL)
#
# Runs every scenario once (booking flows in 3 shards, each with its own n8n copies), the conversational scenarios
# (language, booking flow, voice rules) twice more, then the judge on everything and pairwise against the golden chats.
# Then compare two versions:  python3 tools/k1-gate.py check --base runs/v8/all.json --cand runs/v9/all.json \
#   --judge-base runs/v8/judge.json --judge-cand runs/v9/judge.json --pairs runs/v9/pairs-v8.json --golden runs/v9/golden.json
# Needs N8N_RAPID_API_KEY (and N8N_RAPID_BASE_URL), plus OPENAI_API_KEY or ANTHROPIC_API_KEY with K1_JUDGE_PROVIDER.
set -euo pipefail
cd "$(dirname "$0")/.."
name=${1:?version name}; target=${2:?live, candidate or parlant}
out=${K1_RUNS:-runs}/$name
mkdir -p "$out"
export PYTHONUNBUFFERED=1

case "$target" in
  live)
    export K1_EVAL_AGENT='K1 Muster agent (staging copy of WF-2)' K1_EVAL_BOOKING='K1 Muster Booking (staging)'
    export K1_EVAL_PLATFORM=${K1_EVAL_PLATFORM:-prompts/k1-platform-v8.json} ;;
  candidate)
    export K1_EVAL_PLATFORM=${K1_EVAL_PLATFORM:-prompts/k1-platform-v9.json} ;;
  parlant)
    export K1_EVAL_TARGET=parlant ;;
  *) echo "unknown target $target" >&2; exit 2 ;;
esac

conversational=$(python3 tools/k1-gate.py subset --sections language,flow,voice)
pids=()
K1_EVAL_STATE=/tmp/k1eval/$name-nb.json python3 tools/k1-v2-eval.py run --books no --workers 8 --out "$out/nonbooking.json" > "$out/nonbooking.log" 2>&1 & pids+=($!)
for i in 0 1 2; do
  K1_EVAL_STATE=/tmp/k1eval/$name-bk$i.json python3 tools/k1-v2-eval.py run --books only --shard $i/3 --workers 1 --out "$out/booking-$i.json" > "$out/booking-$i.log" 2>&1 & pids+=($!)
done
K1_EVAL_STATE=/tmp/k1eval/$name-rep.json python3 tools/k1-v2-eval.py run --books no --only "$conversational" --repeat 2 --workers 6 --out "$out/repeat.json" > "$out/repeat.log" 2>&1 & pids+=($!)
status=0
for pid in "${pids[@]}"; do wait "$pid" || status=1; done
[ $status = 0 ] || echo "a run failed; see $out/*.log (bookings are released by each run; k1-v2-eval.py cleanup with its K1_EVAL_STATE if one crashed)" >&2

python3 - "$out" <<'EOF'
import json, sys
from pathlib import Path
out = Path(sys.argv[1])
merged = []
for part in ['nonbooking.json', 'booking-0.json', 'booking-1.json', 'booking-2.json', 'repeat.json']:
    path = out / part
    if path.exists():
        data = json.loads(path.read_text())
        merged.extend(data if isinstance(data, list) else data.get('results', []))
(out / 'all.json').write_text(json.dumps(merged, ensure_ascii=False))
print(f'{len(merged)} runs in {out}/all.json, flagged {sum(bool(r["flags"]) for r in merged)}')
EOF

python3 tests/v2_judge.py score "$out/all.json" --out "$out/judge.json"
python3 tests/v2_judge.py golden "$out/all.json" --out "$out/golden.json"
if [ -n "${K1_BASE_RUN:-}" ]; then
  python3 tests/v2_judge.py pair "$K1_BASE_RUN/all.json" "$out/all.json" --out "$out/pairs-$(basename "$K1_BASE_RUN").json"
fi
