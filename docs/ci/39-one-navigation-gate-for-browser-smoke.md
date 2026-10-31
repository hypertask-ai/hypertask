## One navigation gate for browser smoke (HYCI-1)

Every required-PR smoke spec takes `test` from
`e2e/smoke/lib/appReady.ts`, which wraps `goto`, `reload`, `goBack` and
`goForward`. After each document load it waits until the page is interactive:
`document.readyState === 'complete'`, React has hydrated the document (a node
carrying `__reactFiber$` or `__reactProps$`), and the document has stopped
changing for 400 ms (`childList`, `subtree` and `characterData` mutations only,
so attribute-driven animation does not count). The wait is capped at 5 s and
then accepts the page, so a view that never goes quiet costs time, never a
false failure.

This replaces per-test guesses about which element proves the app is ready. A
server-rendered element (`#title-input`, a board column, a command dialog) is
visible before the client layer that handles the click exists, which is how the
same six smoke tests kept failing in different places: the click or the
`window` command event arrived before its handler mounted. `browser-smoke`
keeps zero retries, so this gate is the only wait that can hide nothing behind
a green second attempt.

`tests/browser-smoke-workflow.test.cjs` reads the spec list out of the
`browser-smoke` job itself, so a spec added there fails the gate until it is
listed and takes its `test` from `appReady` (HYCI-41: the list used to be a
snapshot, and a new job spec could bypass the gate silently).
