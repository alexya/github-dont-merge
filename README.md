# GitHub Don't Merge

A browser extension that highlights GitHub pull request merge controls when
selected labels warn against merging.

## Label warnings

When an applied sidebar label matches a configured trigger, the merge action
area gets a red frame with matching label badges at its upper-left edge.
Each badge uses the sidebar label's background, text, and border colors.
Matching labels stay on one line. When they would exceed the frame width,
trailing badges are replaced with a `...` badge; hover it to see the hidden
names. A single oversized badge is also replaced rather than overflowing.
The row recalculates when the merge area or window resizes.
Removing the labels removes the warning without reloading the page.

By default the warning is visual only and does not disable buttons.
Disabled buttons remain disabled. The warning appears
only on the PR conversation page when GitHub renders merge controls, including
supported merge-confirmation, auto-merge, and "Bypass rules and merge" controls.

Enable **Block merging while monitored labels are present** in the popup to
disable merge (including bypass), merge-confirmation, and enable-auto-merge buttons while any
matching label remains. A stop sign and the red reminder "Remove all monitored
do-not-merge labels from this PR before merging." appear above the merge
button. Removing all matching labels, disabling this
setting, or removing the site restores controls without overriding GitHub's
own disabled state. Canceling or disabling auto-merge remains available.
This setting defaults to off, syncs with the other settings, and applies to
already active tabs.

**Only affects this browser.** Merging is blocked only in this browser, with
this extension on. Other people, other browsers, the GitHub CLI or API, and
auto-merge that was turned on earlier can still merge.

Open the extension from the browser toolbar to manage **Highlight labels**.
The default labels are `do not merge` and `do-not-merge`. Add custom labels
(for example, `Not Ready To Merge`), remove individual labels, or choose
**Restore defaults**. An empty list turns off highlighting.

Changes are saved automatically in browser sync storage and apply to open
GitHub tabs without reloading. They persist across browser restarts and sync
between browsers using the same extension identity and browser account when
extension/settings sync is enabled. Chrome, Edge, and Firefox use separate
sync services; settings do not sync across browser vendors. Unpacked builds
with different extension IDs also have separate settings.

A status badge in the popup's top-right corner shows **Loading...**,
**Saving...**, **Saved** (for 3 seconds), or **Error** only while relevant.
Error details appear next to the affected setting; failed saves do not discard your
input. If sync storage is unavailable after updating an unpacked build, reload
the extension in your browser's extensions page to apply its permissions.
Browser sync storage quotas apply to large lists.

Matching is exact after trimming surrounding whitespace and ignoring case.
Only applied sidebar labels count; labels mentioned in comments or offered
in the label picker do not.

## GitHub sites

The **GitHub sites** list defaults to `https://github.com`. Add an HTTPS
hostname or origin (for example, `github.company.com`) to use the extension
on a GitHub Enterprise Server instance. These sites must use supported GitHub
markup; this does not add support for unrelated hosting services.
Origins match exactly, including ports. Subdomains must be added separately.
HTTP sites, wildcards, credentials, paths, queries, and fragments are rejected.

Adding a site saves it and asks for browser access to that host. Click
**Allow** in the browser prompt. If access is denied, the site stays in the list
but inactive until you click **Allow access**. Sites sync between browsers, but permissions do not:
use **Allow access** next to a synced site on each browser. Every setting
change, including adding or authorizing a site, applies to already open tabs
without reloading them. Installing or reloading the extension also refreshes
open tabs on configured sites. An empty site list turns warnings off.
Removing a site stops warnings and future script registration; previously
granted permissions can be revoked in the browser's extension settings.

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
merge-control replacement, overflow boundaries, optional blocking and cleanup,
synced popup settings, origin validation, permissions, and script registration.
`npm run check` runs both commands.

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

- `config/trigger-labels.ts`: the default trigger-label list.
- `utils/label-settings.ts`: validation and browser sync storage.
- `utils/site-settings.ts`: exact HTTPS origin validation and synced site settings.
- `entrypoints/background.ts`: register scripts only for configured, authorized hosts.
- `entrypoints/github.content/`: the GitHub content script and warning styles.
- `utils/merge-warning.ts`: label detection and merge-area decoration.
- `entrypoints/popup/`: the highlight-label management popup.
- `assets/icon.svg`: the source artwork for the extension icons.
- `public/icon/`: the PNG icons included in extension builds.
- `wxt.config.ts`: shared extension configuration and manifest metadata.
- `tests/`: build smoke tests.

The PNG icons are checked in and used by WXT. When changing the artwork, export
matching 16, 32, 48, and 128-pixel PNGs from `assets/icon.svg`.

The extension requests `storage` to sync settings, `scripting` to register
content scripts, and required host access only to `https://github.com/*`.
The optional `https://*/*` permission lets users authorize individual enterprise
hosts; it is not granted automatically. Browser host permissions cover all ports
of a host, but the content script activates only on configured exact origins.
It starts on configured GitHub pages so client-side navigation from a PR list to a PR works
without a reload, but decorates only PR conversation pages. It reads the visible
page DOM, makes no GitHub API requests, and does not require a GitHub token.
Only your configured settings are stored; PR content is not collected.
WXT development builds additionally use `tabs`, `scripting`, and access to
`http://localhost/*` for hot reloading.

GitHub's DOM is not a public API. The extension supports the classic
`.merge-message` area and the current `[data-testid="mergebox-partial"]` layout;
future GitHub layout changes may require updating the selectors.
