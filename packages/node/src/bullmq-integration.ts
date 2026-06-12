import {
  queueIntegration,
  type QueueClientLike,
  type QueueIntegrationOptions,
} from "./queue-integration";

export interface BullMqIntegrationOptions extends Omit<
  QueueIntegrationOptions,
  "client" | "system" | "methods" | "getQueueName"
> {
  client: QueueClientLike & { name?: string };
  methods?: readonly string[];
}

const bullMqMethods = ["add", "addBulk", "process"] as const;

function queueName(args: readonly unknown[], fallback: string | undefined) {
  const first = args[0];
  return typeof first === "string" ? first : fallback;
}

export function bullMqIntegration(options: BullMqIntegrationOptions) {
  return queueIntegration({
    ...options,
    name: options.name ?? "bullmq",
    system: "bullmq",
    methods: options.methods ?? bullMqMethods,
    queueName: options.queueName ?? options.client.name,
    getQueueName: (args) => queueName(args, options.queueName ?? options.client.name),
  });
}
