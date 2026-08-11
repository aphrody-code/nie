/*
 * thunks.c — premières fonctions de nie.exe reproduites depuis du code source.
 *
 * Ce fichier est compilé par `nie-forge cc` avec **MSVC 14.44**, le toolset qui
 * a lié le jeu (`cl.exe` 19.44.35228, options `/O2 /GS- /Gy /Zl`). Chaque
 * fonction annotée `@nie <adresse>` est extraite de l'objet COFF et comparée
 * byte-à-byte à la fonction correspondante du binaire : si le codegen diffère
 * d'un seul octet, elle est rejetée.
 *
 * Pourquoi cette voie compte : l'assembleur `nie-asm` régénère ce qu'il sait
 * encoder, mais reste muet sur le SSE — or `movaps`/`movss`/`xorps` bloquent à
 * eux seuls ~10 Mo de `.text`. Le C, lui, les produit naturellement : un simple
 * `return *p;` sur un `float` donne `movss xmm0, [rcx] ; ret`. Écrire la
 * sémantique et laisser MSVC choisir la forme est donc la route qui monte le
 * plus haut. Cf. `docs/FORGE.md`.
 *
 * Convention : le nom porte l'adresse, faute de symboles d'origine. Quand le
 * reverse identifie la vraie fonction, le nom doit être remplacé par le sien.
 */

/* ------------------------------------------------------------------ SSE --- */
/* Ces deux corps sont hors de portée de nie-asm : c'est ici que le C paie. */

/* @nie 0x14004e9e0 */
float nie_load_f32_14004e9e0(const float *p)
{
    return *p;
}

/* @nie 0x140453d60 */
float nie_zero_f32_140453d60(void)
{
    return 0.0f;
}

/* --------------------------------------------------------------- entiers --- */
/* Également couverts par la source assembleur ; ils servent de témoins que le
 * compilateur reproduit bien les mêmes octets sur les formes déjà conquises. */

/* @nie 0x1411194b0 */
unsigned int nie_type_id_1411194b0(void)
{
    return 0xefec8a0dU;
}

/* @nie 0x14004d750 */
unsigned char nie_true_14004d750(void)
{
    return 1;
}

/* @nie 0x14004d770 */
unsigned int nie_zero_14004d770(void)
{
    return 0;
}

/* @nie 0x140057350 */
void *nie_identity_140057350(void *self)
{
    return self;
}

/* @nie 0x140287b00 */
void *nie_set_ptr_140287b00(void **self, void *value)
{
    *self = value;
    return self;
}
