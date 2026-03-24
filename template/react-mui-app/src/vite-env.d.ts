/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PERF_ENDPOINT?: string;
  readonly VITE_PERF_SAMPLE_RATE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
