#pragma once

/// @file file_watcher.h
/// Watcher de fichiers minimaliste (polling, sans thread).
///
/// Conçu pour le workflow modding/hot-reload de l'editeur :
///   - L'editeur cree un FileWatcher et appelle watch(dir, cb) pour chaque
///     dossier d'assets a surveiller.
///   - tick() est invoque a chaque frame ; les fichiers dont le timestamp
///     a change depuis la derniere visite declenchent le callback.
///   - Aucun thread, aucune API systeme : iteration recursive sur le dossier
///     + comparaison `last_write_time`. Suffisant pour quelques centaines de
///     fichiers d'assets en edition.

#include <filesystem>
#include <functional>
#include <unordered_map>
#include <vector>

namespace iecode {

/// Watcher de fichiers polling — non-thread.
class FileWatcher {
public:
    /// Callback appele quand un fichier change (chemin absolu).
    using Callback = std::function<void(const std::filesystem::path&)>;

    FileWatcher() = default;
    ~FileWatcher() = default;

    FileWatcher(const FileWatcher&)            = delete;
    FileWatcher& operator=(const FileWatcher&) = delete;
    FileWatcher(FileWatcher&&)                 = default;
    FileWatcher& operator=(FileWatcher&&)      = default;

    /// Enregistre un dossier a surveiller (recursif). Le scan initial peuple
    /// la table des timestamps sans declencher le callback.
    void watch(const std::filesystem::path& dir, Callback cb);

    /// Stoppe toute surveillance et libere les tables internes.
    void stop();

    /// Polling : compare les timestamps et invoque le callback pour chaque
    /// fichier modifie (ou nouvellement ajoute) depuis le dernier tick.
    /// A appeler une fois par frame depuis l'editeur.
    void tick();

    /// Nombre de dossiers surveilles.
    [[nodiscard]] std::size_t watched_count() const noexcept { return entries_.size(); }

    /// Indique si le watcher est actif (au moins un dossier enregistre).
    [[nodiscard]] bool running() const noexcept { return running_; }

private:
    struct Entry {
        std::filesystem::path                                                   dir;
        Callback                                                                cb;
        std::unordered_map<std::string, std::filesystem::file_time_type>        timestamps;
    };

    /// Scanne recursivement le dossier et alimente la map des timestamps.
    /// @param notify Si true, appelle cb pour chaque fichier nouveau/modifie.
    void scan_entry(Entry& entry, bool notify);

    std::vector<Entry> entries_;
    bool               running_ = false;
};

} // namespace iecode
