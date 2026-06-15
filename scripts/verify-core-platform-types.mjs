import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tempRoot = join(repoRoot, ".tmp", "verify-core-platform-types");
const tscBin = require.resolve("typescript/bin/tsc");
const failures = [];

function runTsc(label, args, cwd = repoRoot) {
  console.log(`Verifying ${label}...`);
  const result = spawnSync(process.execPath, [tscBin, ...args], {
    cwd,
    stdio: "inherit",
  });
  if (result.status !== 0) failures.push(label);
}

runTsc("core source without DOM libs", [
  "-p",
  join(repoRoot, "packages", "core", "tsconfig.no-dom.json"),
]);

if (!existsSync(join(repoRoot, "packages", "core", "dist", "index.d.ts"))) {
  failures.push("core public types without DOM libs");
  console.error("Missing packages/core/dist/index.d.ts. Run pnpm build before this check.");
} else {
  const typeTestSource = `
import {
  batchTransport,
  consoleTransport,
  createLogger,
  defineEvent,
  encodedPayloadToUint8Array,
  fallbackTransport,
  jsonCodec,
  retryTransport,
  testTransport,
  type LogEvent,
  type TestTransportAbortSignal,
  type TestTransportWaitOptions,
  type Transport,
} from "@loggerjs/core";
import { createMiddleware } from "@loggerjs/core/middleware";
import { safeJsonCodec } from "@loggerjs/core/codec-json";
import { traceContextFromHeaders } from "@loggerjs/core/trace-propagation";

const loginEvent = defineEvent<{ userId: string }>({
  type: "auth.login",
  message: (payload) => payload.userId,
});

const events: LogEvent[] = [];
const test = testTransport();
const signal: TestTransportAbortSignal = {
  aborted: false,
  addEventListener() {},
  removeEventListener() {},
};
const waitOptions: TestTransportWaitOptions = { signal, timeoutMs: 1 };
const transport: Transport = batchTransport(retryTransport(fallbackTransport(test, test)), {
  maxRecords: 10,
});
const logger = createLogger({ transports: [transport, consoleTransport({ pretty: false })] });

logger.event(loginEvent, { userId: "u1" });
void test.waitFor((event) => event.levelName === "info", waitOptions).catch(() => {});
events.push({
  id: "evt",
  time: 1,
  seq: 1,
  level: 30,
  levelName: "info",
  logger: "app",
  message: "hello",
});
createMiddleware("identity", (record) => record);
jsonCodec().encode(events);
safeJsonCodec().encode(events);
encodedPayloadToUint8Array("hello");
traceContextFromHeaders({ traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" });
`;

  const tsconfigSource = {
    compilerOptions: {
      exactOptionalPropertyTypes: false,
      lib: ["ES2022"],
      module: "NodeNext",
      moduleResolution: "NodeNext",
      noEmit: true,
      preserveSymlinks: true,
      skipLibCheck: false,
      strict: true,
      target: "ES2022",
      types: [],
    },
    include: ["index.ts"],
  };

  rmSync(tempRoot, { force: true, recursive: true });
  mkdirSync(join(tempRoot, "node_modules", "@loggerjs"), { recursive: true });
  symlinkSync(
    join(repoRoot, "packages", "core"),
    join(tempRoot, "node_modules", "@loggerjs", "core"),
    "dir",
  );
  writeFileSync(join(tempRoot, "package.json"), `${JSON.stringify({ type: "module" }, null, 2)}\n`);
  writeFileSync(join(tempRoot, "index.ts"), typeTestSource);
  writeFileSync(join(tempRoot, "tsconfig.json"), `${JSON.stringify(tsconfigSource, null, 2)}\n`);

  runTsc("core public types without DOM libs", ["-p", join(tempRoot, "tsconfig.json")], tempRoot);
  rmSync(tempRoot, { force: true, recursive: true });
}

if (failures.length > 0) {
  console.error("Core platform type checks failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Verified core source and public types without DOM libs.");
}
