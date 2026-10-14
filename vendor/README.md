# vendor/ghostty-vt.wasm

ghostty-web 0.4.0 bundles a `ghostty-vt.wasm` that reuses terminal memory without clearing it. This directory holds a fixed build of the same wasm, which `src/ghostty-wasm.ts` loads instead.

## The bug

Ghostty's terminal pages (`src/terminal/PageList.zig`) assume newly allocated page memory is zero-filled. That holds for native builds, where the page allocator gets fresh pages from mmap. On wasm32-freestanding, `std.heap.page_allocator` is Zig's `WasmAllocator`, which hands previously freed memory back without clearing it. Both places that create page buffers (`initPages` and `createPageExt`) clear them only in runtime-safety builds, and ghostty-web is built with `ReleaseSmall`.

Two things go wrong as a result.

- A terminal reopened at the same size as a closed one shows the closed terminal's text.
- Rows that appear as output scrolls can show text from reused memory (upstream report: [coder/ghostty-web#138](https://github.com/coder/ghostty-web/issues/138)).

`ghostty-zero-fill.patch` also clears page buffers on wasm. It changes nothing in native builds. `test/stale-cells.test.ts` checks both cases against this wasm.

## How it was built

| Input | Value |
| --- | --- |
| ghostty-web | tag `v0.4.0`, the same version as the npm dependency |
| Ghostty submodule | `5714ed07a1012573261b7b7e3ed2add9c1504496` |
| Patches, in order | `git show v0.4.0:patches/ghostty-wasm-api.patch`, then `ghostty-zero-fill.patch` |
| Zig | 0.15.2 |
| Build command | `zig build lib-vt -Dtarget=wasm32-freestanding -Doptimize=ReleaseSmall` |
| sha256 | `466b669ea4539dff14988db36d1f7ac59b24ac817d63e364cf308b90934a851a` |

Use the v0.4.0 version of `ghostty-wasm-api.patch`, not the one on ghostty-web's main branch. The exports must match the npm 0.4.0 JS wrapper: 77 exports, identical in name to the bundled wasm.

Zig 0.15.2 could not link its native build runner against the macOS 26 SDK, so the build ran in a Linux container (`debian:stable-slim`) with the official aarch64-linux Zig 0.15.2. Without the zero-fill patch, that build is byte-identical to the npm 0.4.0 wasm.

Rebuild this file whenever the ghostty-web dependency changes, unless upstream has fixed the bug by then.
