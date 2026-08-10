// iecode_memread.sys
//
// Driver kernel WDM minimal qui expose deux IOCTL :
//   - IOCTL_MEMREAD_READ_MEMORY     : lit N bytes dans un process cible
//   - IOCTL_MEMREAD_GET_MODULE_BASE : resout module_name -> base/taille
//
// Usage prevu : extraire la cle AES-128 des saves IEVR depuis .rdata de nie.exe
// sans etre bloque par EasyAntiCheat en user-mode.
//
// Build : WDK 10 + Visual Studio 2022, cible Windows 10/11 x64.
//
// ATTENTION : ce driver n'a AUCUNE verification d'acces (pas d'ACL sur le device).
// Il doit etre charge uniquement sur une machine de dev en mode test signing.
// NE PAS DEPLOYER EN PRODUCTION.

#include <ntifs.h>
#include "iecode_memread.h"

// ──────────────────────────────────────────────────────────────────────────────
// Prototypes NT non exportees par ntddk.h
// ──────────────────────────────────────────────────────────────────────────────

// MmCopyVirtualMemory : copie memoire inter-process, non documentee mais stable
// depuis Windows XP. Implementee dans ntoskrnl.exe. On la declare extern et le
// linker la resoudra contre ntoskrnl.lib du WDK.
NTSTATUS NTAPI MmCopyVirtualMemory(
    PEPROCESS        SourceProcess,
    PVOID            SourceAddress,
    PEPROCESS        TargetProcess,
    PVOID            TargetAddress,
    SIZE_T           BufferSize,
    KPROCESSOR_MODE  PreviousMode,
    PSIZE_T          NumberOfBytesCopied
);

// PsGetProcessPeb : retourne le PEB d'un process. Exportee mais pas dans ntddk.h.
PPEB NTAPI PsGetProcessPeb(PEPROCESS Process);

// ──────────────────────────────────────────────────────────────────────────────
// Structures PEB / LDR (copie simplifiee, offsets stables sur x64)
// ──────────────────────────────────────────────────────────────────────────────
//
// On redefinit localement car les definitions publiques dans ntddk.h sont
// incompletes pour PEB_LDR_DATA / LDR_DATA_TABLE_ENTRY.

typedef struct _PEB_LDR_DATA_LOCAL {
    ULONG      Length;
    UCHAR      Initialized;
    PVOID      SsHandle;
    LIST_ENTRY InLoadOrderModuleList;
    LIST_ENTRY InMemoryOrderModuleList;
    LIST_ENTRY InInitializationOrderModuleList;
} PEB_LDR_DATA_LOCAL, *PPEB_LDR_DATA_LOCAL;

typedef struct _LDR_DATA_TABLE_ENTRY_LOCAL {
    LIST_ENTRY     InLoadOrderLinks;
    LIST_ENTRY     InMemoryOrderLinks;
    LIST_ENTRY     InInitializationOrderLinks;
    PVOID          DllBase;
    PVOID          EntryPoint;
    ULONG          SizeOfImage;
    UNICODE_STRING FullDllName;
    UNICODE_STRING BaseDllName;
    // suite non utilisee
} LDR_DATA_TABLE_ENTRY_LOCAL, *PLDR_DATA_TABLE_ENTRY_LOCAL;

// PEB (offset du champ Ldr = 0x18 sur x64 Windows 10/11).
// On reutilise PPEB de ntddk.h et on accede a Ldr via offset connu.
#define PEB_LDR_OFFSET 0x18

// ──────────────────────────────────────────────────────────────────────────────
// Globals
// ──────────────────────────────────────────────────────────────────────────────

static PDEVICE_OBJECT g_device_object = NULL;

// ──────────────────────────────────────────────────────────────────────────────
// Utilitaires
// ──────────────────────────────────────────────────────────────────────────────

// Comparaison case-insensitive d'une UNICODE_STRING avec une chaine C wide.
// Retourne TRUE si egales.
static BOOLEAN unicode_equals_ci(const UNICODE_STRING* us, PCWSTR zstr)
{
    UNICODE_STRING other;
    RtlInitUnicodeString(&other, zstr);
    return RtlEqualUnicodeString(us, &other, TRUE);
}

// ──────────────────────────────────────────────────────────────────────────────
// Handler IOCTL_MEMREAD_READ_MEMORY
// ──────────────────────────────────────────────────────────────────────────────

static NTSTATUS handle_read_memory(PIRP irp, PIO_STACK_LOCATION stack, ULONG_PTR* info_out)
{
    *info_out = 0;

    const ULONG in_len  = stack->Parameters.DeviceIoControl.InputBufferLength;
    const ULONG out_len = stack->Parameters.DeviceIoControl.OutputBufferLength;

    if (in_len < sizeof(MEMREAD_REQUEST) || out_len < sizeof(MEMREAD_RESPONSE)) {
        return STATUS_BUFFER_TOO_SMALL;
    }

    // METHOD_BUFFERED : le manager recopie les deux buffers dans SystemBuffer.
    // On doit copier la requete avant d'ecrire la reponse (meme zone).
    MEMREAD_REQUEST  req;
    RtlCopyMemory(&req, irp->AssociatedIrp.SystemBuffer, sizeof(req));

    MEMREAD_RESPONSE* resp = (MEMREAD_RESPONSE*)irp->AssociatedIrp.SystemBuffer;
    RtlZeroMemory(resp, sizeof(*resp));

    if (req.size == 0 || req.size > MEMREAD_MAX_SIZE) {
        resp->status = STATUS_INVALID_PARAMETER;
        *info_out = sizeof(MEMREAD_RESPONSE);
        return STATUS_SUCCESS;
    }

    // Resoudre le PID en PEPROCESS.
    PEPROCESS target_proc = NULL;
    NTSTATUS st = PsLookupProcessByProcessId((HANDLE)(ULONG_PTR)req.pid, &target_proc);
    if (!NT_SUCCESS(st)) {
        resp->status = st;
        *info_out = sizeof(MEMREAD_RESPONSE);
        return STATUS_SUCCESS;
    }

    SIZE_T copied = 0;
    st = MmCopyVirtualMemory(
        target_proc,            // source process (nie.exe)
        (PVOID)(ULONG_PTR)req.address,
        PsGetCurrentProcess(),  // target process (system / notre driver)
        resp->data,
        (SIZE_T)req.size,
        KernelMode,
        &copied
    );

    // IMPORTANT : toujours dereferencer apres PsLookupProcessByProcessId.
    ObDereferenceObject(target_proc);

    resp->status     = st;
    resp->bytes_read = (unsigned long long)copied;
    *info_out        = sizeof(MEMREAD_RESPONSE);
    return STATUS_SUCCESS;
}

// ──────────────────────────────────────────────────────────────────────────────
// Handler IOCTL_MEMREAD_GET_MODULE_BASE
// ──────────────────────────────────────────────────────────────────────────────
//
// Attache le thread courant a l'address space du process cible, lit son PEB,
// parcourt InLoadOrderModuleList a la recherche du module par nom, retourne
// DllBase et SizeOfImage.
//
// ATTENTION : accedes au PEB doivent etre proteges par __try/__except car
// le layout peut etre corrompu. Ici on fait confiance au layout standard.

static NTSTATUS handle_get_module_base(PIRP irp, PIO_STACK_LOCATION stack, ULONG_PTR* info_out)
{
    *info_out = 0;

    const ULONG in_len  = stack->Parameters.DeviceIoControl.InputBufferLength;
    const ULONG out_len = stack->Parameters.DeviceIoControl.OutputBufferLength;

    if (in_len < sizeof(MODULE_BASE_REQUEST) || out_len < sizeof(MODULE_BASE_RESPONSE)) {
        return STATUS_BUFFER_TOO_SMALL;
    }

    MODULE_BASE_REQUEST req;
    RtlCopyMemory(&req, irp->AssociatedIrp.SystemBuffer, sizeof(req));
    // Garantit la terminaison de la chaine.
    req.module_name[RTL_NUMBER_OF(req.module_name) - 1] = L'\0';

    MODULE_BASE_RESPONSE* resp = (MODULE_BASE_RESPONSE*)irp->AssociatedIrp.SystemBuffer;
    RtlZeroMemory(resp, sizeof(*resp));

    PEPROCESS target_proc = NULL;
    NTSTATUS st = PsLookupProcessByProcessId((HANDLE)(ULONG_PTR)req.pid, &target_proc);
    if (!NT_SUCCESS(st)) {
        resp->status = st;
        *info_out = sizeof(MODULE_BASE_RESPONSE);
        return STATUS_SUCCESS;
    }

    // On doit etre attache au process pour deref son PEB en toute securite.
    KAPC_STATE apc_state;
    KeStackAttachProcess(target_proc, &apc_state);

    NTSTATUS inner_status = STATUS_NOT_FOUND;
    ULONG_PTR found_base  = 0;
    ULONG     found_size  = 0;

    __try {
        PPEB peb = PsGetProcessPeb(target_proc);
        if (peb == NULL) {
            inner_status = STATUS_NOT_FOUND;
        } else {
            // PEB.Ldr est a l'offset 0x18 sur x64.
            PPEB_LDR_DATA_LOCAL ldr =
                *(PPEB_LDR_DATA_LOCAL*)((PUCHAR)peb + PEB_LDR_OFFSET);

            if (ldr == NULL) {
                inner_status = STATUS_NOT_FOUND;
            } else {
                PLIST_ENTRY head = &ldr->InLoadOrderModuleList;
                PLIST_ENTRY cur  = head->Flink;

                // Garde-fou contre une liste corrompue : max 1024 iterations.
                for (int i = 0; i < 1024 && cur != head && cur != NULL; ++i) {
                    PLDR_DATA_TABLE_ENTRY_LOCAL entry = CONTAINING_RECORD(
                        cur, LDR_DATA_TABLE_ENTRY_LOCAL, InLoadOrderLinks);

                    if (entry->BaseDllName.Buffer != NULL &&
                        entry->BaseDllName.Length > 0 &&
                        unicode_equals_ci(&entry->BaseDllName, req.module_name))
                    {
                        found_base   = (ULONG_PTR)entry->DllBase;
                        found_size   = entry->SizeOfImage;
                        inner_status = STATUS_SUCCESS;
                        break;
                    }

                    cur = cur->Flink;
                }
            }
        }
    }
    __except (EXCEPTION_EXECUTE_HANDLER) {
        inner_status = STATUS_ACCESS_VIOLATION;
    }

    KeUnstackDetachProcess(&apc_state);
    ObDereferenceObject(target_proc);

    resp->status = inner_status;
    resp->base   = (unsigned long long)found_base;
    resp->size   = (unsigned long long)found_size;
    *info_out    = sizeof(MODULE_BASE_RESPONSE);
    return STATUS_SUCCESS;
}

// ──────────────────────────────────────────────────────────────────────────────
// IRP dispatchers
// ──────────────────────────────────────────────────────────────────────────────

static NTSTATUS dispatch_create_close(PDEVICE_OBJECT device, PIRP irp)
{
    UNREFERENCED_PARAMETER(device);
    irp->IoStatus.Status      = STATUS_SUCCESS;
    irp->IoStatus.Information = 0;
    IoCompleteRequest(irp, IO_NO_INCREMENT);
    return STATUS_SUCCESS;
}

static NTSTATUS dispatch_device_control(PDEVICE_OBJECT device, PIRP irp)
{
    UNREFERENCED_PARAMETER(device);

    PIO_STACK_LOCATION stack = IoGetCurrentIrpStackLocation(irp);
    NTSTATUS  status = STATUS_INVALID_DEVICE_REQUEST;
    ULONG_PTR info   = 0;

    switch (stack->Parameters.DeviceIoControl.IoControlCode) {
    case IOCTL_MEMREAD_READ_MEMORY:
        status = handle_read_memory(irp, stack, &info);
        break;
    case IOCTL_MEMREAD_GET_MODULE_BASE:
        status = handle_get_module_base(irp, stack, &info);
        break;
    default:
        break;
    }

    irp->IoStatus.Status      = status;
    irp->IoStatus.Information = info;
    IoCompleteRequest(irp, IO_NO_INCREMENT);
    return status;
}

// ──────────────────────────────────────────────────────────────────────────────
// DriverUnload : detruit le device et le symlink.
// ──────────────────────────────────────────────────────────────────────────────

static VOID driver_unload(PDRIVER_OBJECT driver)
{
    UNREFERENCED_PARAMETER(driver);

    UNICODE_STRING dos_name;
    RtlInitUnicodeString(&dos_name, IECODE_MEMREAD_DEVICE_DOS);
    IoDeleteSymbolicLink(&dos_name);

    if (g_device_object != NULL) {
        IoDeleteDevice(g_device_object);
        g_device_object = NULL;
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// DriverEntry : cree device + symlink, enregistre les dispatchers.
// ──────────────────────────────────────────────────────────────────────────────

NTSTATUS DriverEntry(PDRIVER_OBJECT driver, PUNICODE_STRING registry_path)
{
    UNREFERENCED_PARAMETER(registry_path);

    UNICODE_STRING nt_name;
    RtlInitUnicodeString(&nt_name, IECODE_MEMREAD_DEVICE_NT);

    // Device non-exclusif, pas de SDDL (acces libre). NE PAS SHIPPER.
    NTSTATUS st = IoCreateDevice(
        driver,
        0,
        &nt_name,
        FILE_DEVICE_UNKNOWN,
        FILE_DEVICE_SECURE_OPEN,
        FALSE,
        &g_device_object
    );
    if (!NT_SUCCESS(st)) {
        return st;
    }

    UNICODE_STRING dos_name;
    RtlInitUnicodeString(&dos_name, IECODE_MEMREAD_DEVICE_DOS);
    st = IoCreateSymbolicLink(&dos_name, &nt_name);
    if (!NT_SUCCESS(st)) {
        IoDeleteDevice(g_device_object);
        g_device_object = NULL;
        return st;
    }

    driver->MajorFunction[IRP_MJ_CREATE]         = dispatch_create_close;
    driver->MajorFunction[IRP_MJ_CLOSE]          = dispatch_create_close;
    driver->MajorFunction[IRP_MJ_DEVICE_CONTROL] = dispatch_device_control;
    driver->DriverUnload                         = driver_unload;

    // METHOD_BUFFERED => on veut I/O bufferisee.
    g_device_object->Flags |= DO_BUFFERED_IO;
    g_device_object->Flags &= ~DO_DEVICE_INITIALIZING;

    return STATUS_SUCCESS;
}
