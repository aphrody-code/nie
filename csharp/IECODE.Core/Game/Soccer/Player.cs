namespace IECODE.Core.Game.Soccer
{
    /// <summary>
    /// Entité « joueur » en mémoire pendant un match (runtime soccer).
    ///
    /// NON VÉRIFIÉ — le layout mémoire exact de cette structure exige du RE sur le
    /// binaire d'exécution (offsets de champs dans le tableau de joueurs en RAM).
    /// Ce binaire est ABSENT du VPS : <c>/home/ubuntu/niers/data</c> ne contient que le
    /// corpus cfg.bin parsé (données de jeu), pas un dump mémoire ni l'exécutable.
    ///
    /// Aucune des sources de vérité disponibles (parsers inagle, dump cfg.bin, azalee)
    /// ne décrit ce layout RAM : les données joueur côté gameplay (élément, position,
    /// techniques, stats) proviennent de chara_param / growth_table (voir
    /// <see cref="IECODE.Core.GameData.CharacterParam"/>), pas d'une structure mémoire
    /// de match documentée.
    ///
    /// Par conséquent, aucun champ/offset spéculatif n'est déclaré ici (l'ancien
    /// <c>VTable@0x00</c> / <c>StateFlags@0x94</c> / <c>Size=0x540</c> était une
    /// supposition non étayée). Cette structure reste un marqueur de TODO de
    /// reverse-engineering à compléter le jour où un dump mémoire/exécutable sera
    /// disponible. Voir iecode/CLAUDE.md (« stub spéculatif interdit »).
    /// </summary>
    public readonly struct Player
    {
        // Volontairement vide : aucun offset n'est vérifiable contre des octets réels.
        // Ne PAS ajouter de champs sans dump mémoire/exécutable à l'appui.
    }
}
