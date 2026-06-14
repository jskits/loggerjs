# Pretty Output Demo

This example demonstrates the `@loggerjs/pretty` developer UX without a dev
server.

## Browser

Open the local HTML file directly:

```bash
open examples/pretty-output/browser.html
```

The page writes pretty log lines into the page and also mirrors them to the
browser DevTools console. It loads `browser.bundle.js`, which is already built
from `browser-demo.js`.

To rebuild the browser bundle:

```bash
./node_modules/.bin/rolldown examples/pretty-output/browser-demo.js \
  --file examples/pretty-output/browser.bundle.js \
  --format iife \
  --name LoggerJSPrettyOutputDemo \
  --platform browser
```

## Node

Run the terminal demo directly:

```bash
node examples/pretty-output/node.mjs
```

It uses the built local `packages/core/dist` and `packages/pretty/dist` outputs.
If those folders are missing, build the packages first.
