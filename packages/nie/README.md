# `@aphrody/nie`

Bun FFI bindings for the native `nie-ffi` library built by the nie repository.

The package does not redistribute game data or a platform binary. Build `nie-ffi`, then set
`NIE_FFI_PATH` to the resulting dynamic library. Inside a nie checkout, setting `NIE_ROOT`
is sufficient: the binding resolves `target/debug` and `target/release` beneath that directory.

```bash
cargo build --release --locked -p nie-ffi
NIE_ROOT="$PWD" bun -e 'import { version } from "@aphrody/nie"; console.log(version())'
```

Importing the package never opens the library: `iecode` is opened by the first call that needs
a native symbol, and a missing or unloadable library then throws `NativeLibraryError`, which names
the build command. `nativeAvailable()` reports whether it can be opened. Without `NIE_FFI_PATH`,
the search covers `target/{debug,release}/` and then `target/<host-triple>/{debug,release}/`
(e.g. `x86_64-pc-windows-gnu`, where a Windows host without MSVC builds it); `SO_CANDIDATES`
lists every path in order.

Bun 1.3 or newer is required.
