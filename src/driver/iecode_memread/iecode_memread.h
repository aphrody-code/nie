// Header partage entre le driver kernel et le client user-mode.
// Definit le nom du device, les codes IOCTL et les structures de requete.
//
// IMPORTANT : ce fichier est inclus depuis du code kernel (C pur) ET
// depuis du code user-mode (C++). Il doit rester compatible C.

#ifndef IECODE_MEMREAD_H
#define IECODE_MEMREAD_H

#ifdef _KERNEL_MODE
#  include <ntddk.h>
#else
#  include <windows.h>
#  include <winioctl.h>
#  include <stdint.h>
#endif

// Noms du device. Le path DOS est utilise cote user-mode pour CreateFile().
#define IECODE_MEMREAD_DEVICE_NAME  L"\\\\.\\IecodeMemRead"
#define IECODE_MEMREAD_DEVICE_NT    L"\\Device\\IecodeMemRead"
#define IECODE_MEMREAD_DEVICE_DOS   L"\\DosDevices\\IecodeMemRead"

// Codes IOCTL.
// METHOD_BUFFERED : le manager recopie input/output entre buffers system et user.
// FILE_ANY_ACCESS : n'importe quel handle ouvert en SYNCHRONIZE peut envoyer l'IOCTL.
#define IOCTL_MEMREAD_READ_MEMORY \
    CTL_CODE(FILE_DEVICE_UNKNOWN, 0x800, METHOD_BUFFERED, FILE_ANY_ACCESS)

#define IOCTL_MEMREAD_GET_MODULE_BASE \
    CTL_CODE(FILE_DEVICE_UNKNOWN, 0x801, METHOD_BUFFERED, FILE_ANY_ACCESS)

// Taille max d'une lecture en une seule requete (contrainte METHOD_BUFFERED).
#define MEMREAD_MAX_SIZE 4096

#pragma pack(push, 1)

// Requete de lecture memoire.
typedef struct _MEMREAD_REQUEST {
    unsigned long      pid;       // PID du process cible
    unsigned long long address;   // adresse virtuelle a lire dans le process cible
    unsigned long      size;      // nombre de bytes (<= MEMREAD_MAX_SIZE)
} MEMREAD_REQUEST;

// Reponse de lecture memoire.
typedef struct _MEMREAD_RESPONSE {
    long               status;              // NTSTATUS (LONG / signed 32 bits)
    unsigned long long bytes_read;          // bytes effectivement lus
    unsigned char      data[MEMREAD_MAX_SIZE];
} MEMREAD_RESPONSE;

// Requete de resolution module_name -> base.
typedef struct _MODULE_BASE_REQUEST {
    unsigned long pid;
    wchar_t       module_name[64]; // ex. L"nie.exe" (case-insensitive)
} MODULE_BASE_REQUEST;

// Reponse.
typedef struct _MODULE_BASE_RESPONSE {
    long               status;  // NTSTATUS
    unsigned long long base;    // adresse de base du module dans le process cible
    unsigned long long size;    // taille du module en memoire
} MODULE_BASE_RESPONSE;

#pragma pack(pop)

#endif // IECODE_MEMREAD_H
