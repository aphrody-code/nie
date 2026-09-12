#!/usr/bin/env python3
"""Wrap the hand-written labels the game also writes in `<GameText>`.

`ui-text-map.ts` says WHICH labels the game writes and under which `(family, hash)`. This
codemod is what makes that map visible on screen: every JSX text node whose whole content is a
mapped label becomes `<GameText>Label</GameText>`, so the interface shows the line the game
itself ships in the chosen language — « Retour » stays « Retour » in French and becomes
« Back », « 戻る », « Zurück » elsewhere, without a single translation written here.

Deliberately narrow, because a wrong rewrite is worse than no rewrite:

- Only `.tsx` files, never tests.
- Only a text node that is ALONE between two tags on one line (`>Retour<`). A label split over
  several lines, or mixed with an expression, is left alone: it is not worth guessing.
- Only labels present in `UI_TEXT_MAP` / `UI_TEXT_VARIANTS`, which means only labels a route
  actually returned.

    python3 scripts/validation/apply-game-text.py --check   # count, change nothing
    python3 scripts/validation/apply-game-text.py           # rewrite
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
MAP = REPO / "packages/inacord-ui/src/lib/ui-text-map.ts"
ROOTS = [REPO / "apps/nie-web/src", REPO / "packages/inacord-ui/src"]
SKIP_DIRS = ("/wasm/", "/vendor/", "/node_modules/")
PACKAGE = REPO / "packages/inacord-ui/src"

LABEL = re.compile(r'^\t\tlabel: (".*?"),$', re.MULTILINE)
# A text node alone between two tags: `>Retour<`. `{`/`}` would mean an expression is involved.
TEXT_NODE = re.compile(r">([^<>{}\n]+)<")


def mapped_labels() -> set[str]:
    """The labels of the two tables — NOT `UI_TEXT_NOT_FOUND`, which the game does not write."""
    source = MAP.read_text(encoding="utf-8")
    end = source.index("export const UI_TEXT_NOT_FOUND")
    import json

    return {json.loads(match.group(1)) for match in LABEL.finditer(source[:end])}


def import_line(path: Path) -> str:
    if PACKAGE in path.parents:
        relative = Path("../" * len(path.relative_to(PACKAGE).parts[:-1]) or "./")
        return f'import {{ GameText }} from "{relative.as_posix().rstrip("/")}/lib/game-text-context";\n'
    return 'import { GameText } from "@niers/inacord-ui";\n'


def ensure_import(source: str, path: Path) -> str:
    if re.search(r"\bGameText\b", source.split("\n\n")[0]) or "GameText," in source:
        return source
    # Next to the last import of the file, so the block stays one block.
    imports = list(re.finditer(r"^import .*?;\n", source, re.MULTILINE | re.DOTALL))
    if not imports:
        return import_line(path) + source
    at = imports[-1].end()
    return source[:at] + import_line(path) + source[at:]


def rewrite(source: str, labels: set[str], path: Path) -> tuple[str, int]:
    count = 0
    lines = source.split("\n")
    for index, line in enumerate(lines):
        stripped = line.lstrip()
        if stripped.startswith(("//", "*", "/*")) or "GameText" in line:
            continue

        def substitute(match: re.Match[str]) -> str:
            nonlocal count
            inner = match.group(1)
            if inner.strip() not in labels or inner.strip() != inner:
                return match.group(0)
            count += 1
            return f"><GameText>{inner}</GameText><"

        lines[index] = TEXT_NODE.sub(substitute, line)
    if count == 0:
        return source, 0
    return ensure_import("\n".join(lines), path), count


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="count the rewrites, change nothing")
    args = parser.parse_args()

    labels = mapped_labels()
    print(f"{len(labels)} mapped labels", file=sys.stderr)
    total, touched = 0, 0
    for root in ROOTS:
        for path in sorted(root.rglob("*.tsx")):
            if any(part in str(path) + "/" for part in SKIP_DIRS) or ".test." in path.name:
                continue
            source = path.read_text(encoding="utf-8")
            rewritten, count = rewrite(source, labels, path)
            if count == 0:
                continue
            total += count
            touched += 1
            print(f"  {count:3d}  {path.relative_to(REPO)}", file=sys.stderr)
            if not args.check:
                path.write_text(rewritten, encoding="utf-8")
    print(f"{total} text nodes in {touched} files", file=sys.stderr)


if __name__ == "__main__":
    main()
