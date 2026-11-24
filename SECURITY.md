# Security

## Reporting a security problem

Please **don't open a public issue** for a security problem. Email the repository owner instead, at the address on their GitHub profile (github.com/xX772037). Say what you found, how to reproduce it, and what someone could do with it. You'll get a reply as soon as possible, and the problem will be fixed before it's discussed in public.

## Farm and ranch records

FarmLedger is for farm and ranch records: crops, fields, animals and sales. Those can include names, land locations and money, so:

- Don't put real records in issues, pull requests, tests or screenshots. Use made-up examples.
- **Where records are kept:** in the browser on the device that entered them (IndexedDB). There are no accounts and no server yet; records leave the device only when the user downloads a backup file. FarmLedger contacts no outside services.
- Backup files are plain JSON and are not encrypted: keep them somewhere private.
- When cloud accounts are added (`src/core/account.js`), this section will say where records are stored online and who can see them.
