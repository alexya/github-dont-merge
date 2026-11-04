# GitHub Don't Merge

A browser extension that highlights GitHub pull request merge controls when
selected labels warn against merging.

## Label warnings

When an applied sidebar label matches a configured trigger, the merge action
area gets a red frame with matching label badges at its upper-left edge.
Each badge uses the sidebar label's background, text, and border colors.
Multiple matching labels are displayed together. Removing the labels removes
the warning without reloading the page.

The warning is visual only: it does not disable buttons, change pull requests,
or enforce a merge policy. Disabled buttons remain disabled. The warning appears
only on the PR conversation page when GitHub renders merge controls, including
supported merge-confirmation and auto-merge controls.

Edit the shared list in `config/trigger-labels.ts` to configure the triggers:

```ts
export const TRIGGER_LABELS: readonly string[] = [
  'do not merge',
  'do-not-merge',
];
```

Matching is exact after trimming surrounding whitespace and ignoring case.
Only applied sidebar labels count; labels mentioned in comments or offered
in the label picker do not.

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
4. Open a GitHub PR with a matching label to see the merge warning.

Run `npm run zip` to create a Chrome extension archive under `.output/`.

## Checks

```sh
npm run typecheck
npm test
```

The test command builds the Chrome extension, checks its manifest and assets,
and runs DOM tests covering matching, colors, dynamic updates, navigation,
merge-control replacement, and cleanup. `npm run check` runs both commands.

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

- `config/trigger-labels.ts`: the configurable trigger-label list.
- `entrypoints/github.content/`: the GitHub content script and warning styles.
- `utils/merge-warning.ts`: label detection and merge-area decoration.
- `entrypoints/popup/`: the extension status popup.
- `assets/icon.svg`: the source artwork for the extension icons.
- `public/icon/`: the PNG icons included in extension builds.
- `wxt.config.ts`: shared extension configuration and manifest metadata.
- `tests/`: build smoke tests.

The PNG icons are checked in and used by WXT. When changing the artwork, export
matching 16, 32, 48, and 128-pixel PNGs from `assets/icon.svg`.

The extension requests content-script access only to `https://github.com/*`.
It starts on GitHub pages so client-side navigation from a PR list to a PR works
without a reload, but decorates only PR conversation pages. It reads the visible
page DOM, makes no API requests, and does not require a GitHub token.
WXT development builds additionally use `tabs`, `scripting`, and access to
`http://localhost/*` for hot reloading.

GitHub's DOM is not a public API. The extension supports the classic
`.merge-message` area and the current `[data-testid="mergebox-partial"]` layout;
future GitHub layout changes may require updating the selectors.
