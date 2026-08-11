#!/usr/bin/env python3
"""Validation byte-exact de FUN_14075c030 (assembleur de primitives immédiat, type glVertex).

FUN_14075c030(param_1 = batcher state, param_2 = vec3 entrant) :
  1. transforme param_2 par la matrice 4x4 à param_1+0x24 (w=1) via FUN_14075df00 (mat*vec SSE),
     écrit les 3 premières composantes dans param_2 ;
  2. selon param_1[0] (mode 0..4 = POINTS/LINES/LINE_STRIP/TRIANGLES/TRIANGLE_STRIP) émet une
     primitive (point / ligne / triangle) dans un des 3 tableaux dynamiques du conteneur *(param_1+0x1a),
     en accumulant l'état (compteur param_1[8], point courant param_1[2..4], point précédent param_1[5..7]) ;
  3. met à jour cur/prev/compteur.

Chemin validé = capacité suffisante (count < cap) → écriture directe (pas de realloc).
Les helpers de croissance FUN_140721750/660/900 = std::vector emplace+realloc (append identique),
hors périmètre de CETTE fonction.

Lancer : uv run scripts/validate_imm_batcher.py
"""
import struct
import sys as _sys
from pathlib import Path as _Path
_sys.path.insert(0, str(_Path(__file__).resolve().parent))
from uemu import Emu, SCRATCH

VA = 0x14075C030

# ---- agencement mémoire (tout dans la page SCRATCH 1 MiB) ----
P1   = SCRATCH + 0x00000   # batcher state (0x70 octets utiles)
CONT = SCRATCH + 0x00100   # conteneur (0x38 octets) : 3 sous-tableaux {ptr,count,cap}
PTS  = SCRATCH + 0x10000   # buffer points  (stride 0x10)
LIN  = SCRATCH + 0x20000   # buffer lignes  (stride 0x20)
TRI  = SCRATCH + 0x30000   # buffer triangles (stride 0x30)
P2   = SCRATCH + 0x40000   # vec3 entrant (16 octets)
CAP  = 200                 # capacité (count toujours < cap → fast path)


def f32(x):
    return struct.unpack("<f", struct.pack("<f", x))[0]


def fmul(a, b):
    return f32(a * b)


def fadd(a, b):
    return f32(a + b)


def mat_vec(m, v):
    """FUN_14075df00 : O[col] = somme_ligne V[ligne]*M[ligne*4+col], ordre d'accumulation exact.
    m = 16 f32 (row-major), v = (x,y,z,w). Renvoie (O0,O1,O2,O3)."""
    x, y, z, w = v
    o0 = fadd(fadd(fmul(x, m[0]), fmul(z, m[8])),  fadd(fmul(y, m[4]),  fmul(w, m[12])))
    o1 = fadd(fadd(fmul(z, m[9]), fmul(w, m[13])), fadd(fmul(x, m[1]),  fmul(y, m[5])))
    o2 = fadd(fadd(fmul(z, m[10]), fmul(w, m[14])), fadd(fmul(x, m[2]), fmul(y, m[6])))
    o3 = fadd(fadd(fmul(z, m[11]), fmul(w, m[15])), fadd(fmul(x, m[3]), fmul(y, m[7])))
    return (o0, o1, o2, o3)


# ---- PRNG LCG déterministe ----
class Lcg:
    def __init__(self, seed):
        self.s = seed & 0xFFFFFFFFFFFFFFFF

    def next(self):
        self.s = (self.s * 6364136223846793005 + 1442695040888963407) & 0xFFFFFFFFFFFFFFFF
        return (self.s >> 16) & 0xFFFFFFFF

    def u32(self):
        return self.next()

    def rangei(self, lo, hi):
        return lo + self.next() % (hi - lo + 1)

    def f(self, lo, hi):
        return lo + (self.next() / 0xFFFFFFFF) * (hi - lo)


def bits(f):
    return struct.unpack("<I", struct.pack("<f", f))[0]


def build_case(rng):
    mode = rng.rangei(0, 4)
    count = rng.rangei(0, 6)          # param_1[8] avant l'appel
    color = rng.u32()                 # param_1[1] (brut, écrit en .w)
    cur = [bits(rng.f(-1000, 1000)) for _ in range(3)]   # param_1[2..4]
    p1v = [bits(rng.f(-1000, 1000)) for _ in range(3)]   # param_1[5..7]
    mat = [f32(rng.f(-4, 4)) for _ in range(16)]         # param_1[9..24] (stockée f32)
    inp = [f32(rng.f(-1000, 1000)) for _ in range(3)]    # param_2 (stockée f32)
    pcnt = rng.rangei(0, 20)          # count points conteneur
    lcnt = rng.rangei(0, 20)
    tcnt = rng.rangei(0, 20)
    return dict(mode=mode, count=count, color=color, cur=cur, p1=p1v, mat=mat,
                inp=inp, pcnt=pcnt, lcnt=lcnt, tcnt=tcnt)


def pack_state(c):
    b = bytearray(0x70)
    struct.pack_into("<I", b, 0x00, c["mode"])
    struct.pack_into("<I", b, 0x04, c["color"])
    for i in range(3):
        struct.pack_into("<I", b, 0x08 + 4 * i, c["cur"][i])
        struct.pack_into("<I", b, 0x14 + 4 * i, c["p1"][i])
    struct.pack_into("<I", b, 0x20, c["count"])
    for i in range(16):
        struct.pack_into("<f", b, 0x24 + 4 * i, c["mat"][i])
    struct.pack_into("<Q", b, 0x68, CONT)   # *(param_1+0x1a) -> conteneur
    return bytes(b)


def pack_container(c):
    b = bytearray(0x38)
    struct.pack_into("<Q", b, 0x08, PTS)
    struct.pack_into("<I", b, 0x10, c["pcnt"])
    struct.pack_into("<I", b, 0x14, CAP)
    struct.pack_into("<Q", b, 0x18, LIN)
    struct.pack_into("<I", b, 0x20, c["lcnt"])
    struct.pack_into("<I", b, 0x24, CAP)
    struct.pack_into("<Q", b, 0x28, TRI)
    struct.pack_into("<I", b, 0x30, c["tcnt"])
    struct.pack_into("<I", b, 0x34, CAP)
    return bytes(b)


def model(c):
    """Miroir Python. Renvoie (param2_bits[4], state_out(0x70), cont_out(0x38),
    pts(bytes), lin(bytes), tri(bytes)) attendus."""
    m = c["mat"]
    # entrée homogène : x,y,z,1.0
    x, y, z = c["inp"]
    o = mat_vec(m, (f32(x), f32(y), f32(z), 1.0))
    new = [bits(o[0]), bits(o[1]), bits(o[2])]   # param_2 transformé (3 comp)

    # buffers (zéro-init, CAP éléments)
    pts = bytearray(CAP * 0x10)
    lin = bytearray(CAP * 0x20)
    tri = bytearray(CAP * 0x30)
    pcnt, lcnt, tcnt = c["pcnt"], c["lcnt"], c["tcnt"]

    color = c["color"]
    cur = list(c["cur"])
    p1 = list(c["p1"])
    mode = c["mode"]
    count = (c["count"] + 1) & 0xFFFFFFFF   # uVar9 = ++param_1[8]
    state_count = count

    def w4(buf, base, vals):
        for i, v in enumerate(vals):
            struct.pack_into("<I", buf, base + 4 * i, v & 0xFFFFFFFF)

    if mode == 0:
        w4(pts, pcnt * 0x10, [new[0], new[1], new[2], color])
        pcnt += 1
    elif mode == 1:
        if count == 2:
            base = lcnt * 0x20
            w4(lin, base, [cur[0], cur[1], cur[2], color])
            w4(lin, base + 0x10, [new[0], new[1], new[2], color])
            lcnt += 1
            state_count = 0
    elif mode == 2:
        if 1 < count:
            base = lcnt * 0x20
            w4(lin, base, [cur[0], cur[1], cur[2], color])
            w4(lin, base + 0x10, [new[0], new[1], new[2], color])
            lcnt += 1
    elif mode == 3:
        if count == 3:
            base = tcnt * 0x30
            w4(tri, base + 0x00, [p1[0], p1[1], p1[2], color])
            w4(tri, base + 0x10, [cur[0], cur[1], cur[2], color])
            w4(tri, base + 0x20, [new[0], new[1], new[2], color])
            tcnt += 1
            state_count = 0
    elif mode == 4:
        if 2 < count:
            # winding alterné : uVar9 pair -> V0=p1,V1=cur ; impair -> V0=cur,V1=p1
            if (count & 1) == 0:
                v0, v1 = p1, cur
            else:
                v0, v1 = cur, p1
            base = tcnt * 0x30
            w4(tri, base + 0x00, [v0[0], v0[1], v0[2], color])
            w4(tri, base + 0x10, [v1[0], v1[1], v1[2], color])
            w4(tri, base + 0x20, [new[0], new[1], new[2], color])
            tcnt += 1

    # bloc final
    if 1 < state_count:
        p1 = list(cur)
    cur = list(new)

    # state out
    so = bytearray(0x70)
    struct.pack_into("<I", so, 0x00, mode)
    struct.pack_into("<I", so, 0x04, color)
    for i in range(3):
        struct.pack_into("<I", so, 0x08 + 4 * i, cur[i] & 0xFFFFFFFF)
        struct.pack_into("<I", so, 0x14 + 4 * i, p1[i] & 0xFFFFFFFF)
    struct.pack_into("<I", so, 0x20, state_count & 0xFFFFFFFF)
    for i in range(16):
        struct.pack_into("<f", so, 0x24 + 4 * i, m[i])
    struct.pack_into("<Q", so, 0x68, CONT)

    co = bytearray(pack_container(c))
    struct.pack_into("<I", co, 0x10, pcnt)
    struct.pack_into("<I", co, 0x20, lcnt)
    struct.pack_into("<I", co, 0x30, tcnt)

    p2 = bytearray(16)
    for i in range(3):
        struct.pack_into("<I", p2, 4 * i, new[i] & 0xFFFFFFFF)
    # param_2[3] (.w) non écrit par la fonction -> reste 0x3f800000 (mis par le harness)
    struct.pack_into("<I", p2, 12, 0x3F800000)
    return bytes(p2), bytes(so), bytes(co), bytes(pts), bytes(lin), bytes(tri)


def run():
    e = Emu()
    rng = Lcg(0xC030_1407_5DF0_0001)
    N = 800
    mismatches = 0
    first_fail = None
    for it in range(N):
        c = build_case(rng)
        state = pack_state(c)
        cont = pack_container(c)
        pts0 = bytes(CAP * 0x10)
        lin0 = bytes(CAP * 0x20)
        tri0 = bytes(CAP * 0x30)
        # param_2 : 3 floats + un 4e mot quelconque (la fonction ne le lit pas)
        p2_in = struct.pack("<fff", *c["inp"]) + struct.pack("<I", 0x3F800000)
        mem = {P1: state, CONT: cont, PTS: pts0, LIN: lin0, TRI: tri0, P2: p2_in}
        read = {P1: 0x70, CONT: 0x38, PTS: CAP * 0x10, LIN: CAP * 0x20,
                TRI: CAP * 0x30, P2: 16}
        out = e.call(VA, rcx=P1, rdx=P2, mem=mem, read=read)
        if out.get("error"):
            print(f"[{it}] ERREUR uemu: {out['error']}  mode={c['mode']}")
            mismatches += 1
            if first_fail is None:
                first_fail = (it, c, out)
            continue
        exp_p2, exp_so, exp_co, exp_pts, exp_lin, exp_tri = model(c)
        got_p2 = bytes(out["mem"][P2])
        got_so = bytes(out["mem"][P1])
        got_co = bytes(out["mem"][CONT])
        got_pts = bytes(out["mem"][PTS])
        got_lin = bytes(out["mem"][LIN])
        got_tri = bytes(out["mem"][TRI])
        ok = (got_p2 == exp_p2 and got_so == exp_so and got_co == exp_co and
              got_pts == exp_pts and got_lin == exp_lin and got_tri == exp_tri
              and out["rax"] == P1)
        if not ok:
            mismatches += 1
            if first_fail is None:
                first_fail = (it, c, out, exp_p2, got_p2, exp_so, got_so,
                              exp_co, got_co, exp_pts, got_pts, exp_lin, got_lin,
                              exp_tri, got_tri)
    # rapport
    counts = {}
    rng2 = Lcg(0xC030_1407_5DF0_0001)
    for _ in range(N):
        cc = build_case(rng2)
        counts[cc["mode"]] = counts.get(cc["mode"], 0) + 1
    print(f"modes couverts: {counts}")
    if mismatches == 0:
        print(f"BYTE-EXACT — {N}/{N} cas concordent (param_2, state, conteneur, buffers, rax).")
        return 0
    print(f"ECHEC — {mismatches}/{N} divergences.")
    if first_fail:
        it = first_fail[0]
        c = first_fail[1]
        print(f"  premier échec cas {it}: mode={c['mode']} count={c['count']} "
              f"pcnt={c['pcnt']} lcnt={c['lcnt']} tcnt={c['tcnt']}")
        if len(first_fail) > 3:
            (_, _, _, ep2, gp2, eso, gso, eco, gco, ept, gpt, eli, gli, etr, gtr) = first_fail
            def diff(name, e, g):
                if e != g:
                    for off in range(0, len(e), 4):
                        ew = e[off:off+4]; gw = g[off:off+4]
                        if ew != gw:
                            print(f"    {name} +0x{off:03x}: exp={ew.hex()} got={gw.hex()}")
            diff("param2", ep2, gp2)
            diff("state", eso, gso)
            diff("cont", eco, gco)
            diff("pts", ept, gpt)
            diff("lin", eli, gli)
            diff("tri", etr, gtr)
    return 1


if __name__ == "__main__":
    import sys
    sys.exit(run())
