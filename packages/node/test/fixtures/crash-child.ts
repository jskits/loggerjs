import { captureProcessIntegration, createLogger, fileTransport } from "../../src";

const nodeProcess = (globalThis as typeof globalThis & { process: { argv: string[] } }).process;
const path = nodeProcess.argv[2];
if (!path) throw new Error("Missing output path");

createLogger({
  category: ["crash-fixture"],
  transports: [fileTransport({ path, mkdir: true, sync: true })],
  integrations: [
    captureProcessIntegration({
      flushTimeoutMs: 1000,
      warning: false,
      unhandledRejection: false,
      beforeExitFlush: false,
      exitFlush: false,
      signalFlush: false,
    }),
  ],
});

setTimeout(() => {
  throw new Error("fixture fatal crash");
}, 0);
