--[[
    boost_stats.lua — Exemple de script Lua pour le modding IEVR.

    Ce script charge un fichier cfg.bin contenant les donnees de
    joueurs et augmente toutes les statistiques d'un multiplicateur
    donne.

    Usage (depuis le menu Lua de iecode_gui):
        - Selectionner le cfg.bin source
        - Ajuster le multiplicateur
        - Executer le script
--]]

-- Multiplicateur de stats (ajuster selon les besoins)
local MULTIPLIER = 1.5

-- Noms des stats pour l'affichage
local STAT_NAMES = {
    "Kick", "Guard", "Catch", "Body",
    "Control", "Speed", "Stamina", "Luck"
}

-- Valeur maximale autorisee pour une stat
local MAX_STAT = 9999

---@param player table Donnees du joueur
---@param multiplier number Multiplicateur a appliquer
---@return table Joueur avec stats modifiees
local function boost_player(player, multiplier)
    if not player or not player.stats then
        return player
    end

    for i, stat_name in ipairs(STAT_NAMES) do
        local original = player.stats[i] or 0
        local boosted = math.floor(original * multiplier)
        if boosted > MAX_STAT then
            boosted = MAX_STAT
        end
        player.stats[i] = boosted
        print(string.format("  %s: %d -> %d", stat_name, original, boosted))
    end

    return player
end

-- Point d'entree
local function main()
    print("=== Boost Stats v1.0 ===")
    print(string.format("Multiplicateur: x%.1f", MULTIPLIER))
    print("")

    -- TODO: charger les donnees depuis cfg.bin via l'API iecode
    -- local players = iecode.load_cfgbin("path/to/cfg.bin")

    -- Exemple avec des donnees fictives pour tester
    local test_player = {
        name = "Endou Mamoru",
        stats = {80, 65, 95, 70, 75, 60, 85, 50}
    }

    print("Joueur: " .. test_player.name)
    boost_player(test_player, MULTIPLIER)
    print("")
    print("Boost termine.")
end

main()
