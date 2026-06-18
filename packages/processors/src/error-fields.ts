const NATIVE_ERROR_FIELDS = ["cause", "errors"] as const;

type NativeErrorField = (typeof NATIVE_ERROR_FIELDS)[number];

export function hiddenErrorFields(value: Error): NativeErrorField[] {
  const fields: NativeErrorField[] = [];
  for (const field of NATIVE_ERROR_FIELDS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (descriptor && !descriptor.enumerable) fields.push(field);
  }
  return fields;
}

export function defineHidden(target: Record<string, unknown>, field: string, value: unknown): void {
  Object.defineProperty(target, field, {
    value,
    writable: true,
    enumerable: false,
    configurable: true,
  });
}

export function dotPath(path: string, field: string): string {
  return path ? `${path}.${field}` : field;
}
