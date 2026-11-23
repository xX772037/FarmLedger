# FarmLedger

One stop shop for all farming and ranching records.

FarmLedger is at the very start: the site is a placeholder home page, and the testing and publishing setup is in place so features can be added safely.

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
| `Farm-working` | Farming (crops and fields) work in progress |
| `Ranch-working` | Ranching (livestock) work in progress |

Work on `Farm-working` or `Ranch-working`, open a pull request into `main`, and merge it once `unit` and `e2e` are green.

## Publishing

Every push to `main` publishes the site to GitHub Pages (`.github/workflows/static.yml`). The site is the repository root, with `index.html` at the top level and no build step. The workflow can also be run by hand from the Actions tab.

## Updates and security

- Dependabot checks npm packages and GitHub Actions weekly (`.github/dependabot.yml`). It stays on `actions/upload-artifact` v4.
- To report a security problem, see [SECURITY.md](SECURITY.md).
- Don't put real farm or ranch records (names, locations, animal IDs, prices) in issues, pull requests, tests or screenshots.
