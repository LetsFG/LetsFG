"""Rasterise the Lucide icon set into the tinted PNGs the panel uses.

Why PNG and not SVG at runtime: Qt can render SVG, but only if the shell's Qt
build ships QtSvg -- and a missing optional module would show up as silently
blank icons on someone else's desktop rather than as an error here. Rasterising
at build time removes that dependency entirely.

Colour is baked in for the same reason. Recolouring a monochrome image at
runtime needs QtQuick.Effects (MultiEffect), another optional module, so each
icon is emitted once per colour it is actually drawn in. The combinations are
listed explicitly below rather than generated as a full cross-product, which
would trade 20 useful files for 100 mostly-unused ones.

    python tools/build-icons.py <dir-of-lucide-svgs>

Icons: Lucide (https://lucide.dev), ISC licence -- see assets/icons/LICENSE.
"""
import io
import os
import re
import sys

from PySide6.QtCore import QByteArray, Qt
from PySide6.QtGui import QGuiApplication, QImage, QPainter
from PySide6.QtSvg import QSvgRenderer

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "assets", "icons")

# The palette, matching Model.PALETTE. Alpha-blended against white where the
# source colour is translucent, since these sit on white or near-white cards.
COLORS = {
    "ink": "#0f0f0f",
    "muted": "#5b6f7c",     # rgba(18,44,58,.62) over #f8f9fd
    "faint": "#8b99a3",     # rgba(18,44,58,.42) over #f8f9fd
    "orange": "#ff5b2c",
    "white": "#ffffff",
    "green": "#1a9c5b",
    "amber": "#a86a00",
}

# icon -> the colours it is actually drawn in.
WANTED = {
    "plane": ["orange", "white", "muted", "faint"],
    "hotel": ["faint", "muted", "orange"],
    "search": ["white", "muted"],
    "arrow-left-right": ["muted", "orange"],
    "calendar": ["muted", "ink"],
    "users": ["muted", "ink"],
    "luggage": ["muted", "green"],
    "backpack": ["muted", "green"],
    "triangle-alert": ["amber"],
    "circle-check": ["green"],
    "chevron-down": ["faint", "orange", "muted"],
    "arrow-up-down": ["muted", "orange"],
    "map-pin": ["orange", "muted"],
    "globe": ["muted"],
    "x": ["muted"],
    "plus": ["muted", "faint"],
    "minus": ["muted", "faint"],
    "arrow-right": ["faint", "muted"],
}

SIZE = 48          # 2x the largest on-screen use, so downscaling stays crisp
STROKE = 2.1       # Lucide's default is 2; a touch heavier reads better small


def main():
    src_dir = sys.argv[1] if len(sys.argv) > 1 else "."
    app = QGuiApplication.instance() or QGuiApplication(["build-icons"])
    os.makedirs(OUT, exist_ok=True)
    made = 0

    for name, colours in sorted(WANTED.items()):
        path = os.path.join(src_dir, name + ".svg")
        if not os.path.exists(path):
            print("  ! missing %s.svg" % name)
            continue
        base = io.open(path, encoding="utf-8").read()

        for colour in colours:
            hexv = COLORS[colour]
            # Lucide strokes with currentColor, which Qt does not resolve; bake
            # the value in, and widen the stroke slightly for small sizes.
            svg = base.replace('stroke="currentColor"', 'stroke="%s"' % hexv)
            svg = re.sub(r'stroke-width="[^"]*"', 'stroke-width="%s"' % STROKE, svg)
            svg = svg.replace('fill="none"', 'fill="none"')

            renderer = QSvgRenderer(QByteArray(svg.encode("utf-8")))
            img = QImage(SIZE, SIZE, QImage.Format_ARGB32)
            img.fill(Qt.transparent)
            painter = QPainter(img)
            painter.setRenderHint(QPainter.Antialiasing, True)
            renderer.render(painter)
            painter.end()

            dest = os.path.join(OUT, "%s-%s.png" % (name, colour))
            if not img.save(dest, "PNG"):
                print("  ! failed to write %s" % dest)
                continue
            made += 1

    io.open(os.path.join(OUT, "LICENSE"), "w", encoding="utf-8").write(
        "Icons from Lucide (https://lucide.dev) - ISC License.\n\n"
        "Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022\n"
        "as part of Feather (MIT). All other copyright (c) for Lucide are held\n"
        "by Lucide Contributors 2022.\n\n"
        "Permission to use, copy, modify, and/or distribute this software for any\n"
        "purpose with or without fee is hereby granted, provided that the above\n"
        "copyright notice and this permission notice appear in all copies.\n\n"
        'THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES\n'
        "WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF\n"
        "MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR\n"
        "ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES\n"
        "WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN\n"
        "ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF\n"
        "OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.\n")

    total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
    print("wrote %d icons -> %s (%.0f KB total)" % (made, os.path.relpath(OUT), total / 1024.0))


if __name__ == "__main__":
    main()
