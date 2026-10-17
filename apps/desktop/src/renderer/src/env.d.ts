/** Vite's glob import, as avatar.tsx uses it for Bean's strips (the app has no vite/client types). */
interface ImportMeta {
  glob<T>(
    pattern: string,
    options: { eager: true; query: string; import: 'default' },
  ): Record<string, T>;
}

/** Vite's URL import for a file it emits as its own asset (never inlined as a data: URL). */
declare module '*?url&no-inline' {
  const url: string;
  export default url;
}
