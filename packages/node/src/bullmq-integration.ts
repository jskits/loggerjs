import {
  queueIntegration,
  type QueueClientLike,
  type QueueIntegrationOptions,
  type QueueOperation,
} from "./queue-integration";

export interface BullMqIntegrationOptions extends Omit<
  QueueIntegrationOptions,
  "client" | "system" | "methods" | "getQueueName"
> {
  /**
   * Queue-like BullMQ object. By default LoggerJS wraps `add`, `addBulk`, and a
   * legacy `process` method when present; it does not hook `Worker` or
   * `QueueEvents` lifecycle events such as `completed`, `failed`, or `stalled`.
   */
  client: QueueClientLike & { name?: string };
  methods?: readonly string[];
}

const bullMqMethods = ["add", "addBulk", "process"] as const;

function queueName(args: readonly unknown[], fallback: string | undefined) {
  const first = args[0];
  return typeof first === "string" ? first : fallback;
}

function operationFor(method: string): QueueOperation {
  if (method === "process") return "consume";
  if (method === "add" || method === "addBulk") return "publish";
  return "other";
}

export function bullMqIntegration(options: BullMqIntegrationOptions) {
  return queueIntegration({
    ...options,
    name: options.name ?? "bullmq",
    system: "bullmq",
    methods: options.methods ?? bullMqMethods,
    getOperation: options.getOperation ?? operationFor,
    queueName: options.queueName ?? options.client.name,
    getQueueName: (args) => queueName(args, options.queueName ?? options.client.name),
  });
}
