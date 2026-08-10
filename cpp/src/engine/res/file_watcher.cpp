/// @file file_watcher.cpp
/// Implementation du FileWatcher polling — voir file_watcher.h.

#include <iecode/engine/res/file_watcher.h>

#include <spdlog/spdlog.h>

#include <system_error>
#include <utility>

namespace iecode {

void FileWatcher::watch(const std::filesystem::path& dir, Callback cb) {
    std::error_code ec;
    if (!std::filesystem::exists(dir, ec) || !std::filesystem::is_directory(dir, ec)) {
        spdlog::warn("FileWatcher: dossier introuvable '{}'", dir.string());
        return;
    }

    Entry entry;
    entry.dir = dir;
    entry.cb  = std::move(cb);

    // Scan initial : populate sans notifier (etat de reference).
    scan_entry(entry, /*notify=*/false);

    entries_.push_back(std::move(entry));
    running_ = true;

    spdlog::info("FileWatcher: surveillance de '{}' ({} fichiers initiaux)",
                 dir.string(), entries_.back().timestamps.size());
}

void FileWatcher::stop() {
    entries_.clear();
    running_ = false;
}

void FileWatcher::tick() {
    if (!running_) return;
    for (auto& entry : entries_) {
        scan_entry(entry, /*notify=*/true);
    }
}

void FileWatcher::scan_entry(Entry& entry, bool notify) {
    std::error_code ec;
    auto it = std::filesystem::recursive_directory_iterator(
        entry.dir, std::filesystem::directory_options::skip_permission_denied, ec);
    if (ec) {
        spdlog::debug("FileWatcher: scan echec '{}': {}", entry.dir.string(), ec.message());
        return;
    }

    const auto end = std::filesystem::recursive_directory_iterator{};
    for (; it != end; it.increment(ec)) {
        if (ec) {
            // Continue malgre les erreurs ponctuelles d'iteration.
            ec.clear();
            continue;
        }
        const auto& dirent = *it;
        if (!dirent.is_regular_file(ec)) continue;

        const auto path = dirent.path();
        const auto key  = path.generic_string();

        const auto current = std::filesystem::last_write_time(path, ec);
        if (ec) {
            ec.clear();
            continue;
        }

        auto found = entry.timestamps.find(key);
        if (found == entry.timestamps.end()) {
            entry.timestamps.emplace(key, current);
            if (notify && entry.cb) {
                entry.cb(path);
            }
            continue;
        }

        if (current > found->second) {
            found->second = current;
            if (notify && entry.cb) {
                entry.cb(path);
            }
        }
    }
}

} // namespace iecode
