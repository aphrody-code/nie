#!/usr/bin/env python3
"""Generate the OC dialogue event `ev98_99010` in the game's `data/common/text` layout.

The scene is transcribed from the three comic pages under
`data/oc/astro-lor/source/comic/` (author @Karumina_san) and anchored on the lore facts
already normalized in `scripts/donnees/astro-lor-oc.py` — Astro's three-year coma, the
amputated right leg and its cane, and Shawn Froste as the childhood friend who calls them
"Shiro".

Measured format (real files under `data/common/text/`, build 2026-09):

    <lang>/event/<eventId>.cfg.bin.json
        entries[0]                       TEXT_INFO_BEGIN_0, variables = [Int line_count]
        entries[0].children[i]           TEXT_INFO_<i>,     variables = [
                                             Int  crc32(label)   signed,
                                             Int  0,
                                             Str  localized text,
                                             Int  0,
                                         ]

    event/<eventId>_map.cfg.bin.json
        entries[0]                       TEXT_WASHA_MAP_BEGIN_0, variables = [Int line_count]
        entries[0].children[i]           TEXT_WASHA_MAP_<i>, 17 variables, var[0] = the same
                                         hash, var[15] = the canonical label
                                         `<eventId>_<block>_<line>`.

The hash is the standard CRC-32 of the washa label, verified against the shipped pair
`ev02_00800_010_010` -> -1714101475 and `ev02_00800_010_020` -> -1292259106.

`ev98` is a prefix no shipped event uses on this build (checked across `data/`), so the OC
event cannot collide with a game event — the same reasoning as the `c99019010` character
codes.

Line breaks inside a line are the literal two-character sequence `\\n`, exactly as the
shipped French files store them.

Run:  uv run scripts/donnees/astro-lor-dialogue.py [--out <dir>]
"""

from __future__ import annotations

import argparse
import json
import zlib
from pathlib import Path

EVENT_ID = "ev98_99010"
OUT_DEFAULT = Path("data/oc/astro-lor/game/text")

# (block, line, speaker, {lang: text}) — `speaker` documents the panel, it is NOT written to
# the files: the game stores no speaker name in a TEXT_INFO row.
SCENE: list[tuple[str, str, str, dict[str, str]]] = [
    # --- Block 010 — the stairs, and the message (comic page 1) ---------------
    ("010", "010", "Shawn Froste", {
        "fr": "Tout ceci...\\nn'est qu'une blague ?",
        "en": "All of this...\\nis it just a joke?",
    }),
    ("010", "020", "Shawn Froste", {
        "fr": "Et ce message.\\nDevrais-je y croire ?",
        "en": "And this message.\\nShould I believe it?",
    }),
    ("010", "030", "Astro Lor (message)", {
        "fr": "Salut Fubuki, comment vas-tu ?\\nDésolé de ne pas avoir pris de nouvelles.",
        "en": "Hey Fubuki, how have you been?\\nSorry for going quiet for so long.",
    }),
    ("010", "040", "Astro Lor (message)", {
        "fr": "Ça te dit qu'on se voit dans la soirée\\nsur le terrain de Raimon ?",
        "en": "Feel like meeting up tonight\\non the Raimon pitch?",
    }),
    ("010", "050", "Shawn Froste", {
        "fr": "Ils m'ont déjà fait un coup\\ndont je ne suis pas prêt d'oublier.",
        "en": "They already pulled something on me\\nI am nowhere near ready to forget.",
    }),
    ("010", "060", "Shawn Froste", {
        "fr": "Je ne me ferais pas avoir deux fois...",
        "en": "I will not fall for it twice...",
    }),
    # --- Block 020 — the night before (comic page 2) --------------------------
    ("020", "010", "Shawn Froste", {
        "fr": "C'est un cauchemar !!",
        "en": "This is a nightmare!!",
    }),
    ("020", "020", "Shawn Froste", {
        "fr": "Mais je ne peux pas craquer,\\npas maintenant !",
        "en": "But I cannot break down,\\nnot now!",
    }),
    ("020", "030", "Astro Lor", {
        "fr": "On dirait que je suis venue\\nau mauvais moment...",
        "en": "Looks like I showed up\\nat the worst possible time...",
    }),
    # --- Block 030 — the pitch, three years later (comic page 3) --------------
    ("030", "010", "Astro Lor", {
        "fr": "Ça faisait longtemps, Shiro.",
        "en": "It has been a long time, Shiro.",
    }),
    ("030", "020", "Shawn Froste", {
        "fr": "As-\\nTro... ?",
        "en": "As-\\nTro...?",
    }),
    ("030", "030", "Astro Lor", {
        "fr": "É- Écoute...\\nje suis... déso-",
        "en": "L- Listen...\\nI am... sor-",
    }),
    ("030", "040", "Shawn Froste", {
        "fr": "Tu es incorrigible !!",
        "en": "You are impossible!!",
    }),
    ("030", "050", "Shawn Froste", {
        "fr": "Toi, alors !!",
        "en": "You, honestly!!",
    }),
    ("030", "060", "Astro Lor", {
        "fr": "Je suis désolé...\\nde t'avoir fait attendre aussi longtemps.",
        "en": "I am sorry...\\nfor making you wait this long.",
    }),
]

LANGS = ("fr", "en")


def signed_crc32(label: str) -> int:
    """CRC-32 of the washa label, as the signed 32-bit integer the dumps store."""
    value = zlib.crc32(label.encode("ascii")) & 0xFFFF_FFFF
    return value - (1 << 32) if value >= (1 << 31) else value


def label(block: str, line: str) -> str:
    return f"{EVENT_ID}_{block}_{line}"


def int_var(value: int) -> dict[str, str]:
    return {"type": "Int", "value": str(value)}


def str_var(value: str) -> dict[str, str]:
    return {"type": "String", "value": value}


def text_file(lang: str) -> dict:
    children = []
    for index, (block, line, _speaker, texts) in enumerate(SCENE):
        children.append({
            "children": [],
            "name": f"TEXT_INFO_{index}",
            "variables": [
                int_var(signed_crc32(label(block, line))),
                int_var(0),
                str_var(texts[lang]),
                int_var(0),
            ],
        })
    return {"entries": [{
        "children": children,
        "name": "TEXT_INFO_BEGIN_0",
        "variables": [int_var(len(children))],
    }]}


def washa_file() -> dict:
    """Washa map: the language-invariant join table between hash and canonical label.

    The 17 variables mirror a shipped row (`ev02_00800_map`): only var[0] (hash), var[10]
    (constant 1 on every shipped row of that file) and var[15] (label) carry a value here.
    var[5] is the lip-sync flag and stays empty — no voice bank exists for an OC.
    """
    children = []
    for index, (block, line, _speaker, _texts) in enumerate(SCENE):
        variables = [int_var(0) for _ in range(17)]
        variables[0] = int_var(signed_crc32(label(block, line)))
        variables[3] = int_var(-1)
        variables[5] = str_var("")
        variables[7] = str_var("")
        variables[10] = int_var(1)
        variables[15] = str_var(label(block, line))
        children.append({
            "children": [],
            "name": f"TEXT_WASHA_MAP_{index}",
            "variables": variables,
        })
    return {"entries": [{
        "children": children,
        "name": "TEXT_WASHA_MAP_BEGIN_0",
        "variables": [int_var(len(children))],
    }]}


def write(path: Path, payload: dict) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    # Compact separators, exactly like the shipped dumps (no spaces, no trailing newline).
    blob = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    path.write_text(blob, encoding="utf-8")
    return len(blob.encode("utf-8"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=OUT_DEFAULT)
    args = parser.parse_args()

    written = []
    for lang in LANGS:
        target = args.out / lang / "event" / f"{EVENT_ID}.cfg.bin.json"
        written.append((target, write(target, text_file(lang))))
    target = args.out / "event" / f"{EVENT_ID}_map.cfg.bin.json"
    written.append((target, write(target, washa_file())))

    for path, size in written:
        print(f"{size:>8}  {path.as_posix()}")
    print(f"{len(SCENE)} lignes, {len(LANGS)} locales, event {EVENT_ID}")


if __name__ == "__main__":
    main()
