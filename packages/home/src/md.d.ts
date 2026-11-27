/* Markdown files are bundled as text by scripts/build.mjs (esbuild's text loader). */
declare module '*.md' {
  const text: string;
  export default text;
}
declare module '*.md?raw' {
  const text: string;
  export default text;
}
