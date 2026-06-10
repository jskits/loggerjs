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
  exit: (code?: number) => never;
};

declare module "fs" {
  export interface WriteStream extends LoggerjsWritableLike {}
  export function createWriteStream(path: string, options?: { flags?: string }): WriteStream;
  export function openSync(path: string, flags: string): number;
  export function writeSync(fd: number, buffer: string | Uint8Array): number;
  export function closeSync(fd: number): void;
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): string | undefined;
  export function mkdtempSync(prefix: string): string;
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
}

declare module "os" {
  export function tmpdir(): string;
}

declare module "path" {
  export function join(...parts: string[]): string;
}
