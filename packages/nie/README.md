# `@aphrody/nie`

Bun FFI bindings for the native `nie-ffi` library built by the nie repository.

The package does not redistribute game data or a platform binary. Build `nie-ffi`, then set
`NIE_FFI_PATH` to the resulting dynamic library. Inside a nie checkout, setting `NIE_ROOT`
is sufficient: the binding resolves `target/debug` and `target/release` beneath that directory.

```bash
cargo build --release --locked -p nie-ffi
NIE_ROOT="$PWD" bun -e 'import { version } from "@aphrody/nie"; console.log(version())'
```

Bun 1.3 or newer is required.
