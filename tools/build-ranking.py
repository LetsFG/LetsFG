"""Bundle letsfg.co's ranking engine into a QML-loadable JavaScript file.

Why this exists: the plugin was showing offers in the order /api/search happened
to return them, which is NOT the order letsfg.co shows. The site ranks
client-side with rankOffers() -- 9 scored dimensions with weights that shift by
trip context -- and the same algorithm ships publicly as
`LetsFG/sdk/js/src/ranking.ts` ("Open-source implementation of the scoring
algorithm that powers letsfg.co"). Reimplementing it would guarantee drift, so
the plugin compiles that source instead.

The three TypeScript modules are concatenated in dependency order with their
import/export statements stripped -- QML's JS engine has no module system -- and
compiled to plain JS with the SDK's own tsc.

    python tools/build-ranking.py [path-to-LetsFG-repo]

Re-run when the SDK's ranking changes. The output is committed so the plugin
builds with no dependency on the repo.
"""
import io
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "assets", "ranking.js")
# The plugin ships from the same repository as the SDK it compiles, so the
# default is a sibling directory rather than somebody's home folder.
DEFAULT_SDK = os.path.normpath(os.path.join(HERE, "..", "sdk", "js"))

# Dependency order: ranking imports from both of the others.
MODULES = ["trip-purpose.ts", "offer-details.ts", "ranking.ts"]

# What QML needs to reach. Everything else stays internal to the bundle.
EXPORTS = [
    "rankOffers",
    # The context builder is part of the contract, not an internal: the plugin
    # must derive its RankingContext exactly as the site does (trip-purpose
    # persona, prefer_direct, max_stops, min_layover_hours...). Passing a
    # hand-made { travelerCount } context made 6 of 8 orderings disagree with
    # letsfg.co, diverging as early as position 4.
    "rankingContextFromParsed",
    "deduplicateOffers",
    "getOfferInstanceKey",
    "parsedWantsDirect",
    "normalizeTripPurposes",
    "getPrimaryTripPurpose",
    "extractOfferDetailSignals",
]


def strip_module_syntax(src):
    """Remove import/export statements, keeping the declarations they wrap."""
    # Whole-line imports, including multi-line ones.
    src = re.sub(r"^import\s+[\s\S]*?from\s+['\"][^'\"]+['\"];?\s*$", "", src, flags=re.M)
    src = re.sub(r"^import\s+['\"][^'\"]+['\"];?\s*$", "", src, flags=re.M)
    # `export { ... }` / `export * from ...` blocks carry no declaration.
    src = re.sub(r"^export\s+\{[\s\S]*?\}\s*(from\s+['\"][^'\"]+['\"])?;?\s*$", "", src, flags=re.M)
    src = re.sub(r"^export\s+\*\s+from\s+['\"][^'\"]+['\"];?\s*$", "", src, flags=re.M)
    # `export const X` -> `const X`, and the same for the other declaration forms.
    src = re.sub(r"^export\s+(declare\s+)?(const|let|var|function|class|interface|type|enum|abstract)\b",
                 r"\2", src, flags=re.M)
    src = re.sub(r"^export\s+default\s+", "", src, flags=re.M)
    return src


def main():
    sdk = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SDK
    if os.path.basename(sdk) != "js":
        sdk = os.path.join(sdk, "sdk", "js")
    src_dir = os.path.join(sdk, "src")

    parts = []
    for name in MODULES:
        path = os.path.join(src_dir, name)
        if not os.path.exists(path):
            print("  ! missing %s" % path)
            return 1
        text = io.open(path, encoding="utf-8").read()
        parts.append("// ---- from sdk/js/src/%s %s\n%s" % (name, "-" * (44 - len(name)),
                                                            strip_module_syntax(text)))
        print("  %-22s %5d lines" % (name, text.count("\n") + 1))

    combined = "\n\n".join(parts)

    tmp_dir = os.path.join(HERE, "_ranking_build")
    os.makedirs(tmp_dir, exist_ok=True)
    tmp_ts = os.path.join(tmp_dir, "bundle.ts")
    io.open(tmp_ts, "w", encoding="utf-8", newline="\n").write(combined)

    tsc = os.path.join(sdk, "node_modules", ".bin", "tsc")
    if os.name == "nt" and os.path.exists(tsc + ".cmd"):
        tsc = tsc + ".cmd"
    # ES5, not something newer: QML's JavaScript engine rejects the object
    # spread operator ("Unexpected token `...'"), so tsc has to compile it --
    # and every other post-ES5 form -- away rather than pass it through.
    cmd = [tsc, tmp_ts, "--target", "ES5", "--module", "none", "--downlevelIteration",
           "--removeComments", "false", "--skipLibCheck", "--noEmitOnError", "false",
           "--outDir", tmp_dir]
    proc = subprocess.run(cmd, capture_output=True, text=True, shell=(os.name == "nt"))
    tmp_js = os.path.join(tmp_dir, "bundle.js")
    if not os.path.exists(tmp_js):
        print("  ! tsc produced no output")
        print(proc.stdout[-3000:])
        print(proc.stderr[-2000:])
        return 1
    if proc.returncode != 0:
        # Type errors are expected: the sources were cut out of their module
        # graph. What matters is that JS was emitted.
        print("  (tsc reported %d diagnostic line(s); JS was still emitted)"
              % len([l for l in proc.stdout.splitlines() if ": error" in l]))

    js = io.open(tmp_js, encoding="utf-8").read()

    header = (
        "// GENERATED -- do not edit. Rebuild with: python tools/build-ranking.py\n"
        "//\n"
        "// letsfg.co's ranking engine, compiled from LetsFG/sdk/js/src/\n"
        "// (trip-purpose.ts + offer-details.ts + ranking.ts) so the plugin orders\n"
        "// offers exactly as the website does. Showing them in the order\n"
        "// /api/search returns is NOT the same thing and was visibly wrong.\n"
        "//\n"
        "// Loaded from QML as:  import \"assets/ranking.js\" as Ranking\n\n"
    )

    footer = [
        "",
        "// QML has no module system, so the entry points are attached the same way",
        "// Model.js does it -- guarded so the file stays valid in both engines.",
        "function ranking_exports_shim() {",
        "  if (typeof module === \"undefined\" || !module || typeof module.exports !== \"object\") return",
        "  module.exports = {",
    ]
    for name in EXPORTS:
        footer.append("    %s: (typeof %s !== \"undefined\") ? %s : undefined," % (name, name, name))
    footer += ["  }", "}", "ranking_exports_shim()", ""]

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    io.open(OUT, "w", encoding="utf-8", newline="\n").write(header + js + "\n".join(footer))
    print("wrote %s (%.0f KB)" % (os.path.relpath(OUT), os.path.getsize(OUT) / 1024.0))
    return 0


if __name__ == "__main__":
    sys.exit(main())
