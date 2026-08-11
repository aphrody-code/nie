// Implementation du client user-mode pour iecode_memread.sys.

#include "memread_client.h"

#include "../iecode_memread/iecode_memread.h"

#include <algorithm>
#include <cwchar>

#include <tlhelp32.h>

namespace iecode::driver {

MemReadClient::~MemReadClient()
{
    close();
}

MemReadClient::MemReadClient(MemReadClient&& other) noexcept
    : device_(other.device_)
{
    other.device_ = INVALID_HANDLE_VALUE;
}

MemReadClient& MemReadClient::operator=(MemReadClient&& other) noexcept
{
    if (this != &other) {
        close();
        device_       = other.device_;
        other.device_ = INVALID_HANDLE_VALUE;
    }
    return *this;
}

bool MemReadClient::open()
{
    if (device_ != INVALID_HANDLE_VALUE) {
        return true;
    }

    device_ = CreateFileW(
        IECODE_MEMREAD_DEVICE_NAME,
        GENERIC_READ | GENERIC_WRITE,
        0,
        nullptr,
        OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL,
        nullptr);

    return device_ != INVALID_HANDLE_VALUE;
}

void MemReadClient::close() noexcept
{
    if (device_ != INVALID_HANDLE_VALUE) {
        CloseHandle(device_);
        device_ = INVALID_HANDLE_VALUE;
    }
}

std::optional<std::vector<uint8_t>>
MemReadClient::read_memory(uint32_t pid, uint64_t address, uint32_t size)
{
    if (!is_open() || size == 0 || size > MEMREAD_MAX_SIZE) {
        return std::nullopt;
    }

    MEMREAD_REQUEST req{};
    req.pid     = pid;
    req.address = address;
    req.size    = size;

    MEMREAD_RESPONSE resp{};
    DWORD returned = 0;

    const BOOL ok = DeviceIoControl(
        device_,
        IOCTL_MEMREAD_READ_MEMORY,
        &req, sizeof(req),
        &resp, sizeof(resp),
        &returned,
        nullptr);

    if (!ok || returned < sizeof(MEMREAD_RESPONSE) || resp.status != 0) {
        return std::nullopt;
    }

    const auto n = static_cast<size_t>(resp.bytes_read);
    if (n == 0 || n > size) {
        return std::nullopt;
    }

    return std::vector<uint8_t>(resp.data, resp.data + n);
}

std::optional<MemReadClient::ModuleInfo>
MemReadClient::get_module_base(uint32_t pid, const std::wstring& module_name)
{
    if (!is_open()) {
        return std::nullopt;
    }

    MODULE_BASE_REQUEST req{};
    req.pid = pid;

    // Copie bornee dans module_name[64].
    const size_t max_chars = (sizeof(req.module_name) / sizeof(req.module_name[0])) - 1;
    const size_t n         = std::min(module_name.size(), max_chars);
    std::copy_n(module_name.begin(), n, req.module_name);
    req.module_name[n] = L'\0';

    MODULE_BASE_RESPONSE resp{};
    DWORD returned = 0;

    const BOOL ok = DeviceIoControl(
        device_,
        IOCTL_MEMREAD_GET_MODULE_BASE,
        &req, sizeof(req),
        &resp, sizeof(resp),
        &returned,
        nullptr);

    if (!ok || returned < sizeof(MODULE_BASE_RESPONSE) || resp.status != 0) {
        return std::nullopt;
    }

    return ModuleInfo{resp.base, resp.size};
}

std::optional<uint32_t> MemReadClient::find_pid(const wchar_t* process_name)
{
    if (process_name == nullptr) {
        return std::nullopt;
    }

    const HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snap == INVALID_HANDLE_VALUE) {
        return std::nullopt;
    }

    PROCESSENTRY32W entry{};
    entry.dwSize = sizeof(entry);

    std::optional<uint32_t> result;

    if (Process32FirstW(snap, &entry)) {
        do {
            if (_wcsicmp(entry.szExeFile, process_name) == 0) {
                result = static_cast<uint32_t>(entry.th32ProcessID);
                break;
            }
        } while (Process32NextW(snap, &entry));
    }

    CloseHandle(snap);
    return result;
}

} // namespace iecode::driver
