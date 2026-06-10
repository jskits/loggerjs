import type { LogEvent, Processor, ProcessorContext } from "@loggerjs/core";

export type SchemaCheckResult = true | false | string | readonly string[] | void;
export type SchemaValidator = (
  data: unknown,
  event: LogEvent,
  context: ProcessorContext,
) => SchemaCheckResult;

export type SchemaDevCheckAction = "report" | "tag" | "drop";

export interface SchemaDevCheckOptions {
  enabled?: boolean;
  action?: SchemaDevCheckAction;
  validators?: Readonly<Record<string, SchemaValidator>>;
  validate?: SchemaValidator;
  select?: (event: LogEvent, context: ProcessorContext) => SchemaValidator | undefined;
  tagKey?: string;
  contextKey?: string;
  onInvalid?: (event: LogEvent, errors: readonly string[]) => void;
}

function resultToErrors(result: SchemaCheckResult): readonly string[] {
  if (result === undefined || result === true) return [];
  if (result === false) return ["schema validation failed"];
  if (typeof result === "string") return [result];
  return result;
}

function validatorFor(
  event: LogEvent,
  context: ProcessorContext,
  options: SchemaDevCheckOptions,
): SchemaValidator | undefined {
  return (
    options.validate ??
    options.select?.(event, context) ??
    (event.type ? options.validators?.[event.type] : undefined)
  );
}

function tagInvalid(
  event: LogEvent,
  options: SchemaDevCheckOptions,
  errors: readonly string[],
): LogEvent {
  return {
    ...event,
    tags: { ...event.tags, [options.tagKey ?? "schemaInvalid"]: true },
    context: { ...event.context, [options.contextKey ?? "schemaErrors"]: [...errors] },
  };
}

function reportInvalid(
  event: LogEvent,
  context: ProcessorContext,
  options: SchemaDevCheckOptions,
  errors: readonly string[],
): void {
  options.onInvalid?.(event, errors);
  context.reportInternalError(
    new Error(`loggerjs schema validation failed: ${errors.join("; ")}`),
    {
      phase: "processor",
      processor: "schema-dev-check",
      eventType: event.type,
      logger: event.logger,
    },
  );
}

export function schemaDevCheckProcessor(options: SchemaDevCheckOptions = {}): Processor {
  const enabled = options.enabled ?? true;
  const action = options.action ?? "report";

  return (event, context) => {
    if (!enabled) return event;

    const validator = validatorFor(event, context, options);
    if (!validator) return event;

    let errors: readonly string[];
    try {
      errors = resultToErrors(validator(event.data, event, context));
    } catch (error) {
      context.reportInternalError(error, {
        phase: "processor",
        processor: "schema-dev-check",
        eventType: event.type,
        logger: event.logger,
      });
      return event;
    }

    if (errors.length === 0) return event;
    if (action === "drop") {
      options.onInvalid?.(event, errors);
      return false;
    }
    if (action === "tag") {
      reportInvalid(event, context, options, errors);
      return tagInvalid(event, options, errors);
    }

    reportInvalid(event, context, options, errors);
    return event;
  };
}
