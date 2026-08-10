/// @file allocator.cpp
/// Pool allocator aligne pour le moteur Level-5.
/// Fallback sur ::operator new si la taille depasse le pool.
/// Correspond au heap manager global a DAT_142043520 + 0x40.

#include "iecode/engine/core/allocator.h"

#include <cstdlib>
#include <cstring>
#include <memory>
#include <mutex>
#include <new>
#include <vector>

namespace lives {

namespace {

// Aligne une taille sur le multiple superieur de alignment.
[[nodiscard]] constexpr std::size_t align_up(std::size_t n, std::size_t alignment) noexcept {
    return (n + alignment - 1) & ~(alignment - 1);
}

// Alloue un bloc memoire aligne (portable Windows/Linux).
[[nodiscard]] void* aligned_alloc_portable(std::size_t size, std::size_t alignment) noexcept {
#if defined(_MSC_VER)
    return _aligned_malloc(size, alignment);
#else
    // posix_memalign requiert alignment multiple de sizeof(void*) et puissance de 2.
    if (alignment < sizeof(void*)) alignment = sizeof(void*);
    void* p = nullptr;
    if (posix_memalign(&p, alignment, align_up(size, alignment)) != 0) return nullptr;
    return p;
#endif
}

void aligned_free_portable(void* p) noexcept {
#if defined(_MSC_VER)
    _aligned_free(p);
#else
    std::free(p);
#endif
}

} // namespace

// ── PoolAllocator : allocateur a pools de taille fixe ─────────────

/// Pool allocator minimal. Blocs pre-alloues par chunks, free-list intrusive.
/// Thread-safe (mutex interne). Alignement configurable 16/32/64 bytes.
class PoolAllocator : public IAllocator {
public:
    PoolAllocator(std::size_t block_size, std::size_t alignment, std::size_t blocks_per_chunk)
        : block_size_(align_up(block_size, alignment))
        , alignment_(alignment)
        , blocks_per_chunk_(blocks_per_chunk) {}

    ~PoolAllocator() override {
        std::lock_guard lock(mutex_);
        for (void* chunk : chunks_) {
            aligned_free_portable(chunk);
        }
    }

    PoolAllocator(const PoolAllocator&) = delete;
    PoolAllocator& operator=(const PoolAllocator&) = delete;

    void* allocate(std::size_t size, std::size_t alignment) override {
        // Si la requete depasse notre bloc, fallback heap.
        if (size > block_size_ || alignment > alignment_) {
            return aligned_alloc_portable(size, alignment);
        }
        std::lock_guard lock(mutex_);
        if (free_list_ == nullptr) {
            grow();
            if (free_list_ == nullptr) return nullptr;
        }
        void* p = free_list_;
        free_list_ = *static_cast<void**>(free_list_);
        return p;
    }

    void deallocate(void* ptr) override {
        if (ptr == nullptr) return;
        std::lock_guard lock(mutex_);
        // Verifie si le pointeur appartient a un chunk du pool.
        if (owns(ptr)) {
            *static_cast<void**>(ptr) = free_list_;
            free_list_ = ptr;
        } else {
            aligned_free_portable(ptr);
        }
    }

    [[nodiscard]] std::size_t get_size(const void* /*ptr*/) const override {
        return block_size_;
    }

private:
    void grow() {
        const std::size_t chunk_bytes = block_size_ * blocks_per_chunk_;
        void* chunk = aligned_alloc_portable(chunk_bytes, alignment_);
        if (chunk == nullptr) return;
        chunks_.push_back(chunk);
        // Chaine les blocs dans la free-list.
        auto* base = static_cast<std::uint8_t*>(chunk);
        for (std::size_t i = 0; i < blocks_per_chunk_; ++i) {
            void* block = base + (i * block_size_);
            *static_cast<void**>(block) = free_list_;
            free_list_ = block;
        }
    }

    [[nodiscard]] bool owns(const void* ptr) const noexcept {
        const std::size_t chunk_bytes = block_size_ * blocks_per_chunk_;
        const auto* p = static_cast<const std::uint8_t*>(ptr);
        for (const void* chunk : chunks_) {
            const auto* base = static_cast<const std::uint8_t*>(chunk);
            if (p >= base && p < base + chunk_bytes) return true;
        }
        return false;
    }

    std::size_t       block_size_;
    std::size_t       alignment_;
    std::size_t       blocks_per_chunk_;
    void*             free_list_ = nullptr;
    std::vector<void*> chunks_;
    mutable std::mutex mutex_;
};

// ── Factory/singleton pour exposer un allocateur par defaut ──────

namespace {
std::unique_ptr<PoolAllocator> g_default_allocator;
std::once_flag                 g_default_once;
} // namespace

/// Retourne l'allocateur par defaut (blocs 256 bytes, align 16, 256 blocs/chunk).
[[nodiscard]] IAllocator& default_allocator() {
    std::call_once(g_default_once, [] {
        g_default_allocator = std::make_unique<PoolAllocator>(256, 16, 256);
    });
    return *g_default_allocator;
}

/// Cree un pool allocator personnalise.
[[nodiscard]] std::unique_ptr<IAllocator> make_pool_allocator(
    std::size_t block_size, std::size_t alignment, std::size_t blocks_per_chunk) {
    return std::make_unique<PoolAllocator>(block_size, alignment, blocks_per_chunk);
}

} // namespace lives
