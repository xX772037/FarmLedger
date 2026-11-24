# FarmLedger

One stop shop for all farming and ranching records.

FarmLedger keeps a farm's or ranch's records in one place, for people moving off paper. The shared core is built: set up your farm, add the people on it, and keep everything on your phone or computer, with or without signal. The herd and crop records are next.

## What's in the core

- **Farm setup and profile:** name, owner, state and county, what you run (crops, livestock or both), acres.
- **People and roles:** owner, worker (enters records, doesn't see money), viewer (read only, for a vet, agronomist, lender or landlord). Roles are saved now and take effect once cloud sign-in arrives.
- **Works offline:** records are saved on the device (IndexedDB), and after the first visit the app opens with no signal.
- **Backup file:** download everything in one file and restore it on another device, including straight from the setup screen on a new phone.
- **Ready for cloud accounts:** every record has an id and a version, and every change is logged, so cloud sign-in and backup can plug in (`src/core/account.js`) once a provider is chosen. Until then there is no sign-in and no password.

## How the code is laid out

| Path | What it is |
| --- | --- |
| `src/core/` | Shared by everything: the data layer (`db.js`, `store.js`), farm and people (`farm.js`), backup (`backup.js`), accounts (`account.js`), module slots (`modules.js`) |
| `src/modules/herd/` | Herd management. Built on the `Ranch-working` branch. |
| `src/modules/crops/` | Crop management. Built on the `Farm-working` branch. |
| `src/app.js` | Screens: setup, home ("Today"), Farm, People, Backup, and each module's screen |
| `sw.js` | Offline support. Every file the app loads must be listed here; a test checks it. |

The herd and crop work each stay inside their own folder, so the two branches never edit the same files. A module registers itself with `registerModule()` and gets a menu entry, a card on the home screen, and (optionally) items in the home screen's Today list. Until it has a screen it shows as "coming soon".

## Run it

You need [Node.js](https://nodejs.org) 22 or later.

```sh
npm install
npm start          # serves the site at http://localhost:8080/
```

## Tests

```sh
npm test           # unit tests (Node's built-in test runner, test/*.test.js)
npm run test:e2e   # browser tests (Playwright, test/e2e/)
```

The first time you run the browser tests on a computer, install the browser once with `npx playwright install chromium`.

Every push and pull request, on every branch, runs both on GitHub:

| Check | Workflow | What it runs |
| --- | --- | --- |
| `unit` | `.github/workflows/unit.yml` | `npm test` |
| `e2e` | `.github/workflows/e2e.yml` | `npm run test:e2e`; uploads the Playwright report when a test fails |

Both must pass before a pull request is merged into `main`.

## Branches

| Branch | For |
| --- | --- |
| `main` | What's live. Changed only by merging a pull request. |
| `Farm-working` | Farming (crops and fields) work in progress, in `src/modules/crops/` |
| `Ranch-working` | Ranching (herd) work in progress, in `src/modules/herd/` |

Shared changes (the core in `src/core/`, the screens in `src/app.js`) go on their own short-lived branch and into `main` first, then both working branches are updated from `main`.

Work on `Farm-working` or `Ranch-working`, open a pull request into `main`, and merge it once `unit` and `e2e` are green.

## Publishing

Every push to `main` publishes the site to GitHub Pages (`.github/workflows/static.yml`). The site is the repository root, with `index.html` at the top level and no build step. The workflow can also be run by hand from the Actions tab.

## Updates and security

- Dependabot checks npm packages and GitHub Actions weekly (`.github/dependabot.yml`). It stays on `actions/upload-artifact` v4.
- To report a security problem, see [SECURITY.md](SECURITY.md).
- Don't put real farm or ranch records (names, locations, animal IDs, prices) in issues, pull requests, tests or screenshots.

## License

MIT. See [LICENSE](LICENSE). Anyone may use, copy, change and share the code, including in paid products, as long as the copyright and license notice stay with it. It comes with no warranty.
