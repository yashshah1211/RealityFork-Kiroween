#!/usr/bin/env bash
# End-to-end demo: baseline → fork two alternatives → change one → run → export/import →
# compare (with one-at-a-time sensitivity) → reproduce → tamper detection.
# Usage (from repo root): bash examples/demo-branching.sh
set -euo pipefail
OUT=examples/demo-out
rm -rf "$OUT" && mkdir -p "$OUT"
STORE="$OUT/store.json"
rf() { echo; echo "\$ rf $*"; npx tsx packages/cli/src/rf.ts "$STORE" "$@"; }

echo "== 1. Create a baseline (2 staff, 1.6 arrivals/h, 30 replications, seed 1)"
rf baseline "Baseline" servers=2 arrivalRatePerHour=1.6 --seed 1 --reps 30 --warmup 1000 --horizon 11000

echo "== 2. Fork two alternatives"
rf fork baseline "Add one staff member" servers=3
rf fork baseline "Busier day" arrivalRatePerHour=1.8

echo "== 3. Change one branch (still a draft): the busy day also gets a third staff member"
rf set busier-day servers=3
rf list

echo "== 4. Run all scenarios independently"
rf run all

echo "== 5. Export and re-import (validated)"
rf export "$OUT/exported.json"
cp "$OUT/exported.json" "$OUT/reimport-source.json"
rf import "$OUT/reimport-source.json"
rf list

echo "== 6. Compare"
rf compare baseline add-one-staff-member
rf compare baseline busier-day

echo "== 7. Reproduce the original results"
rf reproduce all

echo "== 8. Negative checks"
echo "-- try to edit a completed scenario"
rf set baseline servers=4 || echo "(rejected as expected)"
echo "-- tamper with an assumption in the exported file"
sed 's/"arrivalRatePerHour": 1.8/"arrivalRatePerHour": 1.7/' "$OUT/exported.json" > "$OUT/tampered.json"
rf import "$OUT/tampered.json" || echo "(rejected as expected)"
