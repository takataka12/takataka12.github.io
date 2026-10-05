# ZASU AUDIO UI regression

Run `node --test zasu-master/tests/copy.test.cjs` from the repository root.

The browser suite requires Playwright and an installed Chromium browser. Run
`node zasu-master/tests/browser.cjs` with those modules on the Node search path.
`ZASU_CHROME` optionally selects the Chromium executable. The suite starts its
own static server at 127.0.0.1:8000 and closes it afterwards.

The suite checks desktop (1440px) and iPhone-sized (390px) pages, horizontal
overflow, navigation, upload controls, MIX/full purchases, both MASTER profiles,
payment-return unlock and downloads, WAV/FLAC/ALAC conversion settings and
Japanese failure recovery. All remote API and payment responses are mocked;
no actual Square charge or production job is created by this suite.

Screenshots go to the temporary `zasu-audio-ui-checks` directory, or to
`ZASU_SCREENSHOT_DIR`. Japanese font files can optionally be made available in
`tests/fontsource` from `@fontsource/noto-sans-jp` for Linux screenshots.

`render-ogp.cjs` produces the 1200×630 Japanese OGP PNG using Playwright and
`@fontsource/noto-sans-jp`. `ZASU_FONT_DIR` optionally selects that package's path.
