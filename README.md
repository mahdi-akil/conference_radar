# Conference Radar

A small website for keeping track of conferences, workshops, and summer schools that may be interesting for the PEPSys group. Most of the current venues are related to privacy, security, energy systems, software engineering, and AI.

## Running It Locally

Start a local server from the project folder:

```bash
python3 -m http.server 8000
```

The site will be available at `http://localhost:8000`.

## Conference Data

All conference information is stored in `data/conferences.json`. You can edit the file directly or use the `Add conference` form on the website to prepare a new entry.

For conferences with several submission rounds, add them under `deadline_entries`. The website will show the next relevant deadline.

## Deadline Checks

The deadline checker runs on GitHub every Monday. When it notices something worth reviewing, it opens or updates an issue labeled `deadline-review`. It never changes the conference data automatically, so dates should still be confirmed on the official conference page.

For a quick local check:

```bash
python3 scripts/check_deadlines.py
```

Some conference websites block automated requests or hide dates behind JavaScript, so an occasional manual check is still useful.

## Abstract Matcher

Abstract matching runs locally in the browser using `Xenova/bge-small-en-v1.5`. The abstract is not uploaded anywhere.

If the descriptions or CFP topics in `data/conferences.json` change, rebuild the venue embeddings with:

```bash
npm install
npm run build:embeddings
```

## Notes

- Deadlines marked as expected still need confirmation.
- CFP links should be updated when a conference launches a new yearly website.
- Exact deadlines can be added to a calendar from the conference cards.
