import type {
  EncodedPayload,
  PayloadTransform,
  PayloadTransformContext,
  PayloadTransformOutput,
  PayloadTransformResult,
} from "./types";

export interface ResolvedPayload<TPayload extends EncodedPayload = EncodedPayload> {
  payload: TPayload;
  contentType: string;
  headers: Record<string, string>;
}

export interface EncryptionPayloadTransformOptions {
  encrypt: (
    payload: Uint8Array,
    context: PayloadTransformContext,
  ) => PayloadTransformResult | Promise<PayloadTransformResult>;
  contentType?: string;
  headers?:
    | Record<string, string>
    | ((context: PayloadTransformContext) => Record<string, string> | undefined);
}

const textEncoder = new TextEncoder();

export function encodedPayloadToUint8Array(payload: EncodedPayload): Uint8Array {
  if (typeof payload === "string") return textEncoder.encode(payload);
  return payload;
}

function isPayloadTransformOutput(value: unknown): value is PayloadTransformOutput {
  return typeof value === "object" && value !== null && "payload" in value;
}

function mergeHeaders(
  left: Readonly<Record<string, string>> | undefined,
  right: Record<string, string> | undefined,
): Record<string, string> {
  return {
    ...left,
    ...right,
  };
}

function resolvePayloadTransformResult(
  result: PayloadTransformResult | undefined,
  fallback: ResolvedPayload,
): ResolvedPayload {
  if (result === undefined) return fallback;
  if (!isPayloadTransformOutput(result)) {
    return {
      ...fallback,
      payload: result,
    };
  }
  return {
    payload: result.payload,
    contentType: result.contentType ?? fallback.contentType,
    headers: mergeHeaders(fallback.headers, result.headers),
  };
}

export async function applyPayloadTransforms(
  payload: EncodedPayload,
  context: PayloadTransformContext,
  transforms?: PayloadTransform | readonly PayloadTransform[],
): Promise<ResolvedPayload> {
  const list = transforms ? (Array.isArray(transforms) ? transforms : [transforms]) : [];
  let resolved: ResolvedPayload = {
    payload,
    contentType: context.contentType,
    headers: { ...context.headers },
  };

  for (const transform of list) {
    const nextContext = {
      ...context,
      contentType: resolved.contentType,
      headers: resolved.headers,
    };
    // oxlint-disable-next-line no-await-in-loop -- Payload transforms must preserve user-defined order.
    const result = await transform(resolved.payload, nextContext);
    resolved = resolvePayloadTransformResult(result, resolved);
  }

  return resolved;
}

export function composePayloadTransforms(
  ...transforms: readonly PayloadTransform[]
): PayloadTransform {
  return async (payload, context) => applyPayloadTransforms(payload, context, transforms);
}

export function encryptionPayloadTransform(
  options: EncryptionPayloadTransformOptions,
): PayloadTransform {
  return async (payload, context) => {
    const headers =
      typeof options.headers === "function" ? options.headers(context) : options.headers;
    const encrypted = await options.encrypt(encodedPayloadToUint8Array(payload), context);
    const resolved = await applyPayloadTransforms(payload, context, [() => encrypted]);
    return {
      payload: resolved.payload,
      contentType: options.contentType ?? resolved.contentType,
      headers: mergeHeaders(headers, resolved.headers),
    };
  };
}
