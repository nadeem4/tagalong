/** Vite's URL import for a file it emits as its own asset (never inlined as a data: URL). */
declare module '*?url&no-inline' {
  const url: string;
  export default url;
}
