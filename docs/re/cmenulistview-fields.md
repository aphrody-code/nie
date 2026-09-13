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
