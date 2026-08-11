#pragma once

/// @file allocator.h
/// Interfaces d'allocation memoire du moteur Level-5.
/// DAT_142043520 + 0x40 = pointeur vers le heap manager global.
// iecode abstraction — no RTTI counterpart in nie.exe

#include <cstddef>
#include <cstdint>

namespace lives {

/// Interface d'allocateur (IAllocator).
/// Le moteur utilise un systeme de pools avec vtable a +0x0.
struct IAllocator {
    virtual ~IAllocator() = default;

    /// Alloue size octets avec l'alignement donne.
    virtual void* allocate(std::size_t size, std::size_t alignment = alignof(std::max_align_t)) = 0;

    /// Libere un bloc precedemment alloue.
    virtual void  deallocate(void* ptr) = 0;

    /// Retourne la taille du bloc alloue (0 si inconnu).
    [[nodiscard]] virtual std::size_t get_size(const void* ptr) const { return 0; }
};

/// Allocateur template avec politique de taille (TAllocator<N>).
/// Le moteur Level-5 utilise des pools de taille fixe pour les petits objets.
template <std::size_t BlockSize>
struct TAllocator : IAllocator {
    static constexpr std::size_t BLOCK_SIZE = BlockSize;

    // Stub — l'implementation reelle est dans nie.exe.
    void* allocate(std::size_t size, std::size_t /*alignment*/) override { return nullptr; }
    void  deallocate(void* /*ptr*/) override {}
};

/// Gestionnaire de noeuds memoire (CMemNodeManagerBase).
/// Utilise en interne par le moteur pour les listes chainees d'allocations.
struct CMemNodeManagerBase {
    struct Node {
        Node*    next  = nullptr;
        Node*    prev  = nullptr;
        void*    data  = nullptr;
        uint32_t size  = 0;
        uint32_t flags = 0;
    };

    Node*    head_       = nullptr;
    Node*    tail_       = nullptr;
    uint32_t node_count_ = 0;
    uint32_t capacity_   = 0;

    [[nodiscard]] bool is_empty() const { return node_count_ == 0; }
};

} // namespace lives
