# @loggerjs/codecs

Additional serialization codecs for transports.

```ts
import { fastEventJsonCodec, msgpackrCodec, projectorCodec } from "@loggerjs/codecs";

const json = fastEventJsonCodec();
const msgpack = msgpackrCodec();

const projected = projectorCodec({
  name: "ids-only",
  contentType: "application/json",
  project: (events) => events,
  serialize: JSON.stringify,
});
```

Codecs are transport-owned. Middleware should keep raw values and let the chosen transport serialize.
