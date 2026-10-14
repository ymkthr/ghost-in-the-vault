/** esbuild の binary ローダーで .wasm をバイト列として埋め込む。 */
declare module "*.wasm" {
  const bytes: Uint8Array<ArrayBuffer>;
  export default bytes;
}
