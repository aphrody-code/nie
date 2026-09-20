# Character Bank visual analysis

Measured on 2026-09-20 from two sources:

- `data/menu/bank_character_detail.png` (2,560 × 1,440), the repository's documented-family
  `chara_bank_menu` / `character_detail` game capture in `data/menu/manifest.json`;
- `/tmp/niers-candidate-byron-settled.png` (1,440 × 900), the pre-fix browser diagnostic;
- `/tmp/niers-candidate-byron-fixed.png` (1,440 × 900), the rebuilt candidate after the
  geometry, catalogue-loading and duplicate-detail fixes.

The game capture is the geometry reference. It is still a screenshot rather than a lossless VFS
frame, and its character/state differs from Byron, so no pixel-perfect claim follows from it.

The rendered 1,280 × 720 game canvas fills the screenshot width at scale 1.125 and is vertically
centred with a 45 px outer offset. Coordinates below are therefore compared in native canvas
space using `screen_x / 1.125` and `(screen_y - 45) / 1.125`.

| Decision | Screenshot measurement / source |
| --- | --- |
| Set the roster grid to native x=24, y=136, width=464 | The game capture is exactly 2× native size: the roster panel spans approximately x=48..976 and starts near y=272. The old browser grid extended to native x=620, roughly 132 px into the detail column. |
| Set the detail to native x=512, y=73, width=762, height=452 | The game capture's rounded white character panel spans screen x≈1,024..2,548 and y≈146..1,050. The old x=644 position discarded 132 native pixels of available detail width. |
| Give owned DOM surfaces explicit stacking layers | The native composition remains visible through transparent DOM from roughly screen x=803 to the right edge and y=168..856, intersecting the entire detail area. The DOM now has explicit title/grid/count/hint/filter/detail layers; the compositor is not reordered or rewritten. |
| Make the detail readable with measured game tokens | The native reference uses a white detail panel with grey labels. The detail now uses generated `--screen-row-white` and `--screen-row-label`; no new colours were introduced. |
| Clip duplicate base/detail output | The screenshot shows the local roster profile and its 1,592-total radar before the exact BASARA wiki card. Once the exact card resolves, direct fallback children are hidden and only the source-owned card remains. |
| Preserve pressure=211 and physical=210 | The production mirror row `0x12B74634` stores `stats.lv99.pressure=211` and `physical=210`; `StatBlock::from_json` preserves both. The visible 210/211 reversal came from the duplicate local fallback radar, so no canonical fields were swapped. |
| Keep native composition marked unresolved | The giant mutually exclusive cyan rectangles are emitted by current layout/Lua visibility composition. This pass masks them only below host-owned content surfaces; it does not invent replacement native geometry. |

The rebuilt Chromium gate now shows nine filtered catalogue rows without waiting for the two
6,101-row profile exports, one exact BASARA detail, six official variant controls, total 1,592,
pressure 211 and physical 210. The measured detail box is x=576, y=127.125, width=857.25 and
height=508.5 in the 1,440 × 900 browser frame, which maps back exactly to native x=512, y=73,
width=762 and height=452 at the 1.125 canvas scale and 45 px vertical offset. Back navigation
restores `chara=0x12B74634` after selecting `0x09532D9F`; the full filter panel is captured in
`/tmp/niers-candidate-bank-filters.png`.

This is a functional and geometry pass, not a native-fidelity pass. The title glyph remains
incorrect and mutually exclusive native cyan layout objects remain visible outside host-owned
surfaces. SSIM is not reported because the reference depicts another character/state and these
native-composition defects are still measurable.
