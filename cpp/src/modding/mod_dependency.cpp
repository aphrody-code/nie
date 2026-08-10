/// @file mod_dependency.cpp
/// Implementation de la resolution de dependances et tri topologique.

#include "iecode/modding/mod_dependency.h"

#include <fmt/format.h>
#include <fmt/ranges.h>
#include <spdlog/spdlog.h>

#include <algorithm>
#include <charconv>
#include <queue>
#include <string_view>
#include <unordered_map>
#include <unordered_set>

namespace iecode::modding {

// ── SemVer ────────────────────────────────────────────────────────────

SemVer SemVer::parse(const std::string& str) {
    SemVer ver;
    if (str.empty()) return ver;

    // Nettoyer le prefixe 'v' ou 'V' eventuel
    std::string_view sv = str;
    if (!sv.empty() && (sv.front() == 'v' || sv.front() == 'V')) {
        sv.remove_prefix(1);
    }

    // Parser les 3 composants separes par '.'
    auto parse_int = [](std::string_view s) -> int {
        int val = 0;
        auto [ptr, ec] = std::from_chars(s.data(), s.data() + s.size(), val);
        if (ec != std::errc{}) return 0;
        return val;
    };

    auto dot1 = sv.find('.');
    if (dot1 == std::string_view::npos) {
        ver.major = parse_int(sv);
        return ver;
    }
    ver.major = parse_int(sv.substr(0, dot1));

    auto rest = sv.substr(dot1 + 1);
    auto dot2 = rest.find('.');
    if (dot2 == std::string_view::npos) {
        ver.minor = parse_int(rest);
        return ver;
    }
    ver.minor = parse_int(rest.substr(0, dot2));

    auto rest2 = rest.substr(dot2 + 1);
    // Arreter au premier caractere non-numerique (ex: "1.2.3-beta")
    auto end = rest2.find_first_not_of("0123456789");
    ver.patch = parse_int(rest2.substr(0, end));

    return ver;
}

// ── Helpers ───────────────────────────────────────────────────────────

bool version_in_range(const std::string& version,
                      const std::string& min_version,
                      const std::string& max_version) {
    if (min_version.empty() && max_version.empty()) return true;

    const auto ver = SemVer::parse(version);

    if (!min_version.empty()) {
        const auto min_ver = SemVer::parse(min_version);
        if (ver < min_ver) return false;
    }
    if (!max_version.empty()) {
        const auto max_ver = SemVer::parse(max_version);
        if (ver > max_ver) return false;
    }
    return true;
}

// ── Tri topologique (Kahn) ────────────────────────────────────────────

/// Structure interne pour le graphe de dependances.
struct DepGraph {
    std::unordered_map<std::string, std::vector<std::string>> adj;  // mod -> ses dependances
    std::unordered_map<std::string, int> in_degree;                 // degre entrant

    void add_node(const std::string& name) {
        if (!adj.contains(name)) {
            adj[name] = {};
        }
        if (!in_degree.contains(name)) {
            in_degree[name] = 0;
        }
    }

    void add_edge(const std::string& from, const std::string& to) {
        // from depend de to => to doit etre installe avant from
        // Arc : to -> from (to doit venir avant)
        add_node(from);
        add_node(to);
        adj[to].push_back(from);
        in_degree[from]++;
    }
};

/// Tri topologique de Kahn. Retourne l'ordre d'installation et les cycles detectes.
static std::pair<std::vector<std::string>, std::vector<std::string>>
topological_sort(const DepGraph& graph) {
    auto in_deg = graph.in_degree;
    std::queue<std::string> ready;

    // Noeuds sans dependances entrantes
    for (const auto& [name, deg] : in_deg) {
        if (deg == 0) {
            ready.push(name);
        }
    }

    std::vector<std::string> order;
    order.reserve(in_deg.size());

    while (!ready.empty()) {
        auto node = ready.front();
        ready.pop();
        order.push_back(node);

        if (auto it = graph.adj.find(node); it != graph.adj.end()) {
            for (const auto& neighbor : it->second) {
                if (--in_deg[neighbor] == 0) {
                    ready.push(neighbor);
                }
            }
        }
    }

    // Detecter les cycles (noeuds restants avec in_degree > 0)
    std::vector<std::string> cycles;
    for (const auto& [name, deg] : in_deg) {
        if (deg > 0) {
            cycles.push_back(name);
        }
    }

    return {order, cycles};
}

// ── API publique ──────────────────────────────────────────────────────

DependencyCheckResult check_dependencies(const std::vector<ModInfo>& mods) {
    DependencyCheckResult result;

    // Index des mods actifs par nom (case-sensitive)
    std::unordered_map<std::string, const ModInfo*> mod_index;
    for (const auto& mod : mods) {
        if (!mod.enabled) continue;
        mod_index[mod.name] = &mod;
    }

    // Construire le graphe de dependances
    DepGraph graph;
    for (const auto& mod : mods) {
        if (!mod.enabled) continue;
        graph.add_node(mod.name);
    }

    // Verifier chaque dependance
    for (const auto& mod : mods) {
        if (!mod.enabled) continue;

        for (const auto& dep : mod.metadata.dependencies) {
            auto it = mod_index.find(dep.mod_name);

            if (it == mod_index.end()) {
                // Dependance non trouvee
                if (dep.optional) {
                    result.optional_missing.push_back(
                        fmt::format("{} -> {} (optionnel)", mod.name, dep.mod_name));
                } else {
                    result.missing.push_back(
                        fmt::format("{} -> {} (requis)", mod.name, dep.mod_name));
                    result.satisfied = false;
                }
                continue;
            }

            // Dependance trouvee — verifier la version
            const auto& dep_mod = *it->second;
            if (!dep_mod.metadata.mod_version.empty() &&
                !version_in_range(dep_mod.metadata.mod_version,
                                  dep.min_version, dep.max_version)) {
                const auto msg = fmt::format(
                    "{} -> {} (version {} hors plage [{}, {}])",
                    mod.name, dep.mod_name,
                    dep_mod.metadata.mod_version,
                    dep.min_version.empty() ? "*" : dep.min_version,
                    dep.max_version.empty() ? "*" : dep.max_version);

                if (dep.optional) {
                    result.optional_missing.push_back(msg);
                } else {
                    result.version_mismatch.push_back(msg);
                    result.satisfied = false;
                }
                continue;
            }

            // Ajouter l'arc dans le graphe
            graph.add_edge(mod.name, dep.mod_name);
        }
    }

    // Tri topologique
    auto [order, cycles] = topological_sort(graph);
    result.install_order = std::move(order);
    result.circular_dependencies = std::move(cycles);

    if (!result.circular_dependencies.empty()) {
        result.satisfied = false;
        spdlog::warn("mod_dependency: dependances circulaires detectees : {}",
                     fmt::join(result.circular_dependencies, ", "));
    }

    return result;
}

std::vector<ModInfo> resolve_install_order(const std::vector<ModInfo>& mods) {
    auto check = check_dependencies(mods);

    if (!check.circular_dependencies.empty()) {
        spdlog::error("mod_dependency: impossible de resoudre l'ordre — cycles detectes");
        return {};
    }

    // Reconstuire la liste triee
    std::unordered_map<std::string, const ModInfo*> mod_index;
    for (const auto& mod : mods) {
        if (mod.enabled) {
            mod_index[mod.name] = &mod;
        }
    }

    std::vector<ModInfo> ordered;
    ordered.reserve(check.install_order.size());
    for (const auto& name : check.install_order) {
        if (auto it = mod_index.find(name); it != mod_index.end()) {
            ordered.push_back(*it->second);
        }
    }

    return ordered;
}

} // namespace iecode::modding
