import type { Codec, EncodeContext, LogRecord, PreparedRecordEncoder } from "../types";

type TagsKey = object | null;

function tagsKey(record: LogRecord): TagsKey {
  return record.tags === null ? null : record.tags;
}

/**
 * Creates a record encoder that lets codecs prepare stable logger/category
 * fragments without moving serialization into the logger. Transports keep
 * owning codecs; this helper only memoizes the codec-owned prepared encoder for
 * the current record category and tags object identity.
 */
export function createPreparedRecordEncoder<TPayload = string | Uint8Array>(
  codec: Codec<TPayload>,
): (record: LogRecord, context?: EncodeContext) => TPayload {
  const prepare = codec.prepareRecordEncoder;
  if (!prepare) return (record, context) => codec.encode(record, context);

  let lastCategory: readonly string[] | undefined;
  let lastTags: TagsKey | undefined;
  let lastEncoder: PreparedRecordEncoder<TPayload> | undefined;

  return (record, context) => {
    const currentTags = tagsKey(record);
    if (record.category !== lastCategory || currentTags !== lastTags || lastEncoder === undefined) {
      try {
        lastEncoder = prepare({
          category: record.category,
          tags: record.tags,
        });
        lastCategory = record.category;
        lastTags = currentTags;
      } catch {
        return codec.encode(record, context);
      }
    }
    return lastEncoder.encode(record, context);
  };
}
