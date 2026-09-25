# `lives::CMenuListView` — carte des champs

Extraite le 2026-09-13 de la TABLE DE DESCRIPTEURS que `0x1400AB120` construit dans
`dist/nie.exe` : chaque propriété y déclare son nom, son offset et sa taille. Ce ne sont
donc pas des noms devinés — ce sont ceux du moteur.

```
0x080  mMatrixLocaterRootBaseName
0x0C0  mViewStart
0x0C4  mViewNum
0x0C8  mLineNum
0x0CC  mViewLineStart
0x0D0  mViewLineNum
0x0E0  mMoveTime
0x0E4  mLocatorStartName
0x0E8  mLocatorNum
0x0EC  mFocusBoneName
0x0F0  mListBoneName
0x0F4  mListItemName
0x0F8  mCsrMeshName
0x0FC  mScrollLocatorPoseName
0x100  mScrollLocatorMeshName
0x104  mScrollLocatorBgMeshName
0x108  mScrollLocatorGaijiTextBoneName
0x10C  mListItemNumTextName
0x110  mListItemAllNumTextName
0x114  mListItemNumSepTextName
0x118  mListItemAllNumParam
0x160  mNewIconObjName
0x168  mNewIconName
0x170  mNewIconBoneName
0x180  mIsAutoOffNewIcon
0x188  mAttachLocName
0x190  mNewIconMeshName
0x198  mLockFocusIdx
0x1A4  mMatrixLocaterRootBaseDigitNum
0x1A5  mMatrixLocaterRootBaseDigitInitNum
0x1A8  mMoveVert
0x1A9  mScrollVert
0x1AB  mLineOver
0x1B1  mIsScissorCheck
0x1B3  mIsListMoveForce
0x1B4  mIsListPageMoveForce
0x1B5  mIsMoveLoop
0x1B7  mIsEmptyDraw
0x1B8  mIsScrollFullDraw
0x1BA  mIsSendMenuEventEnable
0x1BE  mIsSeamlessMoveLoop
0x1BF  mItemMoveType
0x1C4  mEnableMoveLine
0x1C5  mIsItemDrawInherit
```

## Methods and traps — measured 2026-09-13

Moved from the archived plan
([`PLAN-2026-09-08-to-25.md`](../archive/plans/2026-09-25/PLAN-2026-09-08-to-25.md), section
"Distance to the three pillars"). Addresses are in `dist/nie.exe` (`b1fa04ea…`). "Read" means
disassembled; "proven" means a uemu validator under `scripts/` passes. Use `scripts/re/extent.py`
before reading any body: every method below spans several chained `.pdata` chunks.

**Vtable.** Complete Object Locator slot `0x141A5FFB8`, methods from `0x141A5FFC0` (read by
scanning the target with `scripts/re/vtable.py`). **79 slots** — slot 79 already belongs to the
next class — of which **38 are the `ret` stub**. Slots 56–61 are six siblings sharing one
prologue: the same guards on **`[this+1B6h]`, `[this+1AFh]`, `[this+1ACh]`**, each taking a byte
parameter. `[+0x1B6]` is the "animation in flight" flag: slot 9 (`0x1405410D0`, the per-frame
update) skips the whole easing block when it is 0, which is why
`scripts/validate_listview_scroll.py` pins it to 0 — a settled screen is the state a single-frame
composer can reproduce.

| Slot | Address | What it is | Status |
| ---: | --- | --- | --- |
| 58 | `0x140542840` (812 B over chained chunks) | page step by the visible extent, clamps, no wrap | proven — `step_page`, `validate_listview_page.py` 18 ✓ |
| 59 | `0x140542B80` (87 B in its own entry, 580 B over 3 chunks) | row step by exactly ±1 on `[+0x12C]`, clamps, no wrap | proven — `step_row`, `validate_listview_scroll.py` 26 ✓ |
| 56 | `0x140542080` (1 971 B, 7 chunks) | third, animated scroll path; **clamps** the selection, never steps it | read |
| 60 | `0x140543760` (587 B, 5 chunks) | re-indexer: loops over visible cells and writes each cell's `+0x154` | read |
| 73 | `0x140544BD0` | cell position = `base + translation[index]` from a table of 48-byte 4×3 affine matrices | proven — `cell_position`, `validate_listview_cell_position.py` 5 ✓ |

The view clamps and never wraps (`step_row`/`step_page`), but the **cell** index wraps modulo
`[cell+0x150]` (`cell_index`); the view does not hold a selected item, the cells hold their
indices. On a settled screen slot 9 passes a zeroed base, so a cell's position **is** its table
translation. The table hangs off `[obj+0x198]` — a 64-bit pointer on another object reached
through a multiple-inheritance adjustment — and is built lazily by `0x140509BF0`: **985 bytes,
13 calls, zero float instructions**, so the per-cell transforms are file data, not computed.

**The `OnEnter` notifier** is `0x1410C74C0..0x1410C77F9` (825 bytes), the only user of the two
`"OnEnter"` literals (`0x14190D2D8`, `0x14190D350` — `grep -c` finds 0 in the binary, `strings -a`
finds 2). It is called from **28** sites in the `game::` screen classes (`scripts/re/xref.py
--calls`), passes 2 arguments, and reads its index with **`movsx ebx, word [rax+154h]`** on the
object returned by `0x140533940` — the cell, not the list view. It is the notifier, not the
mover.

**Traps met on the way, each of which produced a confident wrong result:**

- **A write count is not a semantics.** Slot 56 was first recorded as the "item" step because it
  writes `[+0x138]` twice and `[+0x12C]` 14 times; both `[+0x138]` writes are
  `selected = remainder - 1`, a clamp.
- **A text filter on `198h]` matched a global.** `mov [rel 1422D3198h],r14` ends in the same
  digits. The 32-bit field `+0x198` (`mLockFocusIdx` in the table above) is read once
  (`0x1405438CD`) and never written by the class's 19 `.pdata`-rooted methods, and the 27
  functions behind the 28 `OnEnter` call sites only read it; `+0x198` carries 340 writes across
  `.text`, i.e. a common offset, not this subsystem's field. A negative needs a disassembler and
  an operand check, not a byte or text grep.
- **Reading one `.pdata` entry truncates the body** — slots 58 and 59 open their second chunk
  with `mov [rsp+58h],rbp` and no prologue, exactly where the arithmetic starts.

**Declared parameters.** `nie_formats::objbin::list_view_params` reads a list view's layout from
its `.objbin`: `team14_01_chara_bank_list.objbin` gives `CMenuListViewCharaBank {mViewStart 1,
mViewNum 7, mLineNum 6, mLocatorNum 54}`, and `gallery_menu` gives `CMenuListView {mViewStart=1,
mViewNum=4, mLineNum=5, mLocatorNum=30}`. Their mapping onto the fields read from code is **not**
established: on `chara_bank_menu` the 19 card instances sit on 4 distinct x and 8 distinct y, which
is no 6-column grid. The item step that moves the selection is still unlocated.
