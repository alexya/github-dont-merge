# GitHub Don't Merge

A browser extension project intended to add a do-not-merge action to GitHub
pull requests.

This is an initial scaffold. The extension currently displays a status popup;
it does not add a button, change pull requests, or prevent merges.

## Requirements

- Node.js 22.12 or later and npm
- Google Chrome

## Get started

Install the dependencies and start the WXT development server:

```sh
npm ci
npm run dev
```

WXT starts a development server, builds `.output/chrome-mv3-dev`, and attempts
to open the extension in a separate Chrome profile. Some Chrome installations
do not allow extensions to be loaded from the command line. If the extension
does not appear, leave the development server running and load it manually:

1. Open `chrome://extensions` and enable **Developer mode**.
2. Select **Load unpacked** and choose `.output/chrome-mv3-dev`.
3. Open the extension from the browser toolbar.

WXT reloads the extension while the development server is running. If the server
is restarted, reload the extension in Chrome to reconnect it.

## Load the Chrome build

1. Run `npm run build`.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Select **Load unpacked** and choose `.output/chrome-mv3`.
4. Open the extension from the browser toolbar to see the starter popup.

Run `npm run zip` to create a Chrome extension archive under `.output/`.

## Checks

```sh
npm run typecheck
npm test
```

The test command builds the Chrome extension and checks its generated manifest,
popup, and icons. `npm run check` runs both commands.

## Browser support

Chrome is the initial target. WXT also provides experimental build targets for
future Edge and Firefox support:

```sh
npm run build:edge
npm run build:firefox
```

These commands produce `.output/edge-mv3` and `.output/firefox-mv3`,
respectively. The Firefox build is not ready for distribution: it needs a
stable [extension ID](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings#id)
and, for new extensions, [data collection permissions](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/).
Browser-specific behavior and store publishing have not yet been implemented.

## Project structure

- `entrypoints/popup/`: the extension popup.
- `assets/icon.svg`: the source artwork for the extension icons.
- `public/icon/`: the PNG icons included in extension builds.
- `wxt.config.ts`: shared extension configuration and manifest metadata.
- `tests/`: build smoke tests.

The PNG icons are checked in and used by WXT. When changing the artwork, export
matching 16, 32, 48, and 128-pixel PNGs from `assets/icon.svg`.

Production builds do not request GitHub access or other extension permissions.
WXT development builds add `tabs`, `scripting`, and access to
`http://localhost/*` for hot reloading. Add a narrowly scoped content script
and any required permissions when the pull request integration is implemented.
