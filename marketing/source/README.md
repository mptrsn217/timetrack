# Build scripts

Run from a folder that has `puppeteer-core`, `sharp`, `pg`, `@resvg/resvg-js`, `@fontsource/inter` and `@fontsource-variable/inter` installed.
Paths at the top of each script point at this machine.

- `build-logo.mjs <public dir>`: draws `public/icon.svg` (app icon) and `public/logo.svg` (transparent logo)
- `demo-seed.mjs`: fills a local test database with the demo account used for screenshots
- `screenshots.mjs <out dir>`: phone screenshots of the demo account (needs the app running on :3999)
- `build-marketing.mjs`: builds this marketing folder (logos, fonts, swatches, Instagram posts)
