import { Ghostty } from "ghostty-web";
import wasm from "../vendor/ghostty-vt.wasm";

let loaded: Promise<Ghostty> | undefined;

/**
 * vendor/ にある修正版の ghostty-vt.wasm を読み込む。プラグイン内の全ターミナルで 1 つを共有する。
 * Why not ghostty-web の init(): 同梱の wasm は解放した端末のメモリを消さずに再利用するため、
 * 開き直したターミナルやスクロールで増えた行に前の内容が残る。詳しくは vendor/README.md。
 */
export function loadGhostty(): Promise<Ghostty> {
  loaded ??= WebAssembly.instantiate(wasm, { env: { log: () => {} } }).then(({ instance }) => new Ghostty(instance));
  return loaded;
}
