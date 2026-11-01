## Build retry on a Google font miss (YPER4-363, HYCI-63)

`next build` downloads Google fonts at build time, and about 6% of builds lost
that download. Three jobs run that build: the one ci-tests browser build the four
shards share (HYCI-59), the e2e-ai-pilot build and the verify-QA build. Each
retries exactly once, and only
when its own build log names a font failure. The guard matches the lines the
build prints: "An error occurred in
`next/font`.", a "`next/font` error:" heading, and any
`@next/font/dist/google/loader.js` stack frame. The earlier `next/font/google`
needle matched none of them, so the retry never ran.
`tests/browser-smoke-workflow.test.cjs` runs every guard against the failure
log of a real run, `tests/fixtures/next-font-build-failure.log`.
