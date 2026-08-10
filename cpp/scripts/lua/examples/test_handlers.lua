-- Test des handlers Lua iecode (funcLua* bridges)
-- Reproduit les patterns de scripts nie.exe : appel par hash CRC32 ou par
-- nom (ici on utilise le nom — le runtime hash en interne).

-- helpers : enveloppe les bridges pour passer le nom de commande
-- (le runtime calculera le CRC32). Utilisation : menuCommand("SET_VISIBLE", ...).
local function hash32(s)
    -- Implementation minimaliste CRC32 IEEE 802.3 (poly 0xEDB88320).
    local crc = 0xFFFFFFFF
    for i = 1, #s do
        crc = crc ~ string.byte(s, i)
        for _ = 1, 8 do
            local mask = -(crc & 1)
            crc = (crc >> 1) ~ (0xEDB88320 & mask)
        end
    end
    return (~crc) & 0xFFFFFFFF
end

local function menuCommand(name, ...)
    return funcLuaMenuCommand(hash32(name), ...)
end

local function menuMapCommand(name, ...)
    return funcLuaMenuMapCommand(hash32(name), ...)
end

-- ─── Tests ────────────────────────────────────────────────────────

-- Le hash CRC32 du nom d'acteur "test_actor" sert d'actor_id stable.
local actor_id = hash32("test_actor")

print("Test handlers Lua — actor_id = " .. tostring(actor_id))

menuCommand("SET_VISIBLE", actor_id, true)
menuCommand("SET_POSITION", actor_id, 0.0, 1.0, 0.0)
menuCommand("PLAY_ANIMATION", actor_id, "walk_forward")

local hp = menuCommand("GET_PLAYER_STAT", 1001, "kick")
print("Stat 'kick' joueur 1001 : " .. tostring(hp))

menuCommand("SET_PLAYER_STAT", 1001, "kick", 99)

menuCommand("PLAY_SOUND", 0xDEADBEEF)
menuCommand("STOP_SOUND", 0xDEADBEEF)

menuCommand("LOAD_SCENE", "TitleScene")

-- Map
menuMapCommand("MAP_SET_MARKER", 100.0, 200.0, 5)
local pos = menuMapCommand("MAP_GET_PLAYER_POS")
if pos then
    print(string.format("Player pos : (%.1f, %.1f, %.1f)", pos.x, pos.y, pos.z))
end
menuMapCommand("MAP_CLEAR_MARKERS")

print("Test handlers Lua : OK")
