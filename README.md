# Sakura Browser Runtime

BGI / Ethornell 版『サクラノ詩』の browser/WASM runtime 移植。

## データ

ゲームデータは非同梱。

参照元は正規インストール済みディレクトリ。

- `data0xxxx.arc`
- `sysgrp.arc`
- `sysprg.arc`
- 音声アーカイブ
- 画像アーカイブ
- シナリオアーカイブ

標準のインストール先:

```bash
/home/wakka/sakura/サクラノ詩
```

別パスの場合:

```bash
SAKURA_INSTALL_DIR=/path/to/install
```

## 要件

- Rust 1.86+
- Node.js 24+
- npm
- Linux
- Playwright

## ビルド

```bash
npm install
node tools/build-wasm.mjs
```

## 起動

```bash
npm run serve
```

## テスト

通常:

```bash
cargo fmt --check
cargo test --workspace
npm test
```

ルート確認:

```bash
npm run smoke:full-routes
```

ローカルインストール使用:

```bash
RUST_TEST_THREADS=1 \
SAKURA_INSTALL_DIR='/home/wakka/sakura/サクラノ詩' \
timeout 180s cargo test -p sakura-core --test local_runtime_host_state -- --ignored
```

```bash
RUST_TEST_THREADS=1 \
SAKURA_INSTALL_DIR='/home/wakka/sakura/サクラノ詩' \
timeout 420s cargo test -p sakura-core --test local_system_vm -- --ignored
```

`--nocapture` は単発 probe 用。

## 構成

- `crates/sakura-core` - archive、codec、scenario VM、system host
- `crates/sakura-cli` - install probe、audit、調査用 CLI
- `web` - browser runtime
- `tools` - build、local server、smoke
- `tests` - Node smoke

## 範囲

- Scenario VM: 忠実移植対象
- Asset / codec layer: 忠実 decode 対象
- System `._bp`: host layer 実装対象

System `._bp` は decompiled code、Frida trace、Wine / browser 実測から host layer として実装。命令単位の完全エミュレーションは対象外。

## 最終確認

2026-06-19:

- `cargo fmt --check`
- `cargo test --workspace`
- `node tools/build-wasm.mjs`
- `npm test`
- `npm run smoke:full-routes`
- `local_install --ignored`
- `local_runtime_host_state --ignored`
- `local_system_vm --ignored`
