/**
 * @file compat.h
 * Aliases de types Ghidra/IDA pour compiler le pseudo-C decompile.
 *
 * Ce header rend compilable le code genere par Ghidra sans modification.
 * Les typedefs correspondent aux conventions Ghidra (undefined, byte, etc.)
 * et IDA (BYTE, WORD, DWORD, QWORD).
 */

#ifndef IECODE_DECOMP_COMPAT_H
#define IECODE_DECOMP_COMPAT_H

#include <stdint.h>

/* ── Types Ghidra ─────────────────────────────────────────────── */

typedef unsigned char       undefined;
typedef unsigned char       undefined1;
typedef unsigned short      undefined2;
typedef unsigned int        undefined4;
typedef unsigned long long  undefined8;
typedef unsigned char       byte;
typedef unsigned short      ushort;
typedef unsigned int        uint;
typedef unsigned long long  ulong;
typedef long long           longlong;
typedef unsigned long long  ulonglong;
typedef int                 bool4;

/* ── Types IDA / Windows ──────────────────────────────────────── */

#ifndef _WINDEF_
typedef unsigned char       BYTE;
typedef unsigned short      WORD;
typedef unsigned int        DWORD;
typedef unsigned long long  QWORD;
typedef int                 BOOL;
#endif

/* ── Macros de concatenation Ghidra ───────────────────────────── */

#define CONCAT11(a,b)   ((unsigned short)(unsigned char)(a) << 8 | (unsigned char)(b))
#define CONCAT22(a,b)   ((unsigned int)(unsigned short)(a) << 16 | (unsigned short)(b))
#define CONCAT44(a,b)   ((unsigned long long)(unsigned int)(a) << 32 | (unsigned int)(b))

/* ── Macros d'extraction de sous-parties ──────────────────────── */

#define SUB41(x,n)      ((unsigned char)((x) >> ((n)*8)))
#define SUB42(x,n)      ((unsigned short)((x) >> ((n)*8)))
#define SUB81(x,n)      ((unsigned char)((x) >> ((n)*8)))
#define SUB82(x,n)      ((unsigned short)((x) >> ((n)*8)))
#define SUB84(x,n)      ((unsigned int)((x) >> ((n)*8)))

/* ── Macros d'extension de signe / zero ───────────────────────── */

#define SEXT14(x)       ((int)(char)(x))
#define SEXT24(x)       ((int)(short)(x))
#define SEXT48(x)       ((long long)(int)(x))
#define ZEXT14(x)       ((unsigned int)(unsigned char)(x))
#define ZEXT24(x)       ((unsigned int)(unsigned short)(x))
#define ZEXT48(x)       ((unsigned long long)(unsigned int)(x))

/* ── Macros de carry / borrow (analyse arithmetique) ──────────── */

#define CARRY4(a,b)     ((unsigned int)(a) > (unsigned int)((unsigned int)(a) + (unsigned int)(b)))
#define BORROW4(a,b)    ((unsigned int)(a) < (unsigned int)(b))

#endif /* IECODE_DECOMP_COMPAT_H */
