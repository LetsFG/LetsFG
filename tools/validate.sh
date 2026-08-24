#!/usr/bin/env bash
# Offline pre-submission check. Mirrors the rules documented for
# `omarchy plugin validate` so they can be checked without an Omarchy box.
#
# This is NOT a substitute for the real thing. Before submitting, still run:
#   omarchy plugin validate "$PLUGIN_DIR"
#   qmllint -I "$OMARCHY_PATH/shell" "$PLUGIN_DIR/BarWidget.qml"
set -uo pipefail

DIR="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
fails=0
pass() { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; fails=$((fails+1)); }

echo "Validating $DIR"

M="$DIR/manifest.json"
[ -f "$M" ] && pass "manifest.json exists" || { fail "manifest.json missing"; exit 1; }

if python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$M" 2>/dev/null; then
  pass "manifest.json is valid JSON"
else
  fail "manifest.json does not parse"; exit 1
fi

get() { python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get(sys.argv[2],''))" "$M" "$1"; }

for field in schemaVersion id name version kinds entryPoints; do
  [ -n "$(get "$field")" ] && pass "$field present" || fail "$field missing"
done

[ "$(get schemaVersion)" = "1" ] && pass "schemaVersion is 1" || fail "schemaVersion must be 1"

ID="$(get id)"
case "$ID" in
  omarchy.*) fail "id '$ID' uses the reserved omarchy.* prefix" ;;
  *.*)       pass "id '$ID' is namespaced and not reserved" ;;
  *)         fail "id '$ID' is not namespaced" ;;
esac

# Every declared entry point must exist, with exactly the case declared.
python3 - "$M" "$DIR" <<'PY'
import json, os, sys
manifest, root = sys.argv[1], sys.argv[2]
eps = json.load(open(manifest)).get("entryPoints", {})
bad = False
for key, name in eps.items():
    path = os.path.join(root, name)
    if not os.path.isfile(path):
        print("  FAIL  entryPoint %s -> %s does not exist" % (key, name)); bad = True
        continue
    if name not in os.listdir(root):
        print("  FAIL  entryPoint %s -> %s differs in case" % (key, name)); bad = True
        continue
    print("  ok    entryPoint %s -> %s exists (exact case)" % (key, name))
sys.exit(1 if bad else 0)
PY
[ $? -eq 0 ] || fails=$((fails+1))

if find "$DIR" -type l -not -path '*/.git/*' | grep -q .; then
  fail "plugin folder contains symlinks"
else
  pass "no symlinks"
fi

grep -q 'omarchy.clonedFrom' "$M" && fail "manifest still has omarchy.clonedFrom" || pass "no omarchy.clonedFrom"

for f in README.md LICENSE; do
  [ -f "$DIR/$f" ] && pass "$f present" || fail "$f missing (submission requirement)"
done

# The invariant the README makes a promise about: a search must only ever start
# from a click or a keypress. Anything else calling beginSearch() breaks it.
if [ -f "$DIR/Panel.qml" ]; then
  # The README promises a search can only start from a click or a key. That is
  # checked by a real parser rather than a grep -- see the script for why.
  python3 "$DIR/tools/check-search-invariant.py" "$DIR/Panel.qml" || fails=$((fails+1))
fi

echo
if [ "$fails" -eq 0 ]; then echo "PASS"; else echo "FAIL — $fails problem(s)"; fi
exit $([ "$fails" -eq 0 ] && echo 0 || echo 1)
