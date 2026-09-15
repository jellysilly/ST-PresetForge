# Browser tests

These drive the real UI in Chromium. They need Playwright and a static server
that exposes the extension root, because the fixture imports `/index.js` and
`/style.css` from the web root.

```sh
# from the repository root
npx http-server -p 8899 -s .                 # serve the extension
cp test/browser/fixture.html ./fixture.html  # fixture must sit at the web root
node test/browser/ui.mjs                     # layout, drag, tabs, i18n
node test/browser/flow.mjs                   # forge -> edit -> selective rewrite
```

`PF_PLAYWRIGHT` overrides how Playwright is resolved, `PF_URL` the fixture URL
and `PF_SHOT` where the screenshot is written.

The fixture stubs `SillyTavern.getContext()`, so no SillyTavern install is
needed; `globalThis.__responses` queues the replies the mocked API hands back.
