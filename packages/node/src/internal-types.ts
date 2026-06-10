export interface WritableLike {
  write: (chunk: string | Uint8Array, callback?: (error?: Error | null) => void) => unknown;
  end?: (callback?: (error?: Error | null) => void) => unknown;
}
