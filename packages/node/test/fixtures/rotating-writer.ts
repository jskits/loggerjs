import { createLogger, rotatingFileTransport } from "../../src";

const nodeProcess = (globalThis as typeof globalThis & { process: { argv: string[] } }).process;
const path = nodeProcess.argv[2];
if (!path) throw new Error("Missing output path");

// Writes numbered events as fast as possible until the parent kills it.
const logger = createLogger({
  category: ["rotating-writer"],
  transports: [rotatingFileTransport({ path, maxBytes: 4096, maxFiles: 200 })],
});

let n = 0;
const writeBurst = () => {
  for (let index = 0; index < 50; index += 1) {
    logger.info("tick", { n });
    n += 1;
  }
  setImmediate(writeBurst);
};
writeBurst();
