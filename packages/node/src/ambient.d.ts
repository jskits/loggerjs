type LoggerjsWritableLike = {
  write: (chunk: string | Uint8Array, callback?: (error?: Error | null) => void) => unknown;
  end?: (callback?: (error?: Error | null) => void) => unknown;
};

declare const process: {
  stdout: LoggerjsWritableLike;
  stderr: LoggerjsWritableLike;
  env: Record<string, string | undefined>;
  on: (event: string, listener: (...args: any[]) => void) => void;
  off: (event: string, listener: (...args: any[]) => void) => void;
};

declare module "fs" {
  export interface WriteStream extends LoggerjsWritableLike {}
  export function createWriteStream(path: string, options?: { flags?: string }): WriteStream;
}
