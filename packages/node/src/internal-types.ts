export interface WritableLike {
  write: (chunk: string | Uint8Array, callback?: (error?: Error | null) => void) => unknown;
  once?: (event: "drain", listener: () => void) => unknown;
  end?: (callback?: (error?: Error | null) => void) => unknown;
}
