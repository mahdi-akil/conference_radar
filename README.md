# Conference Radar

Conference Radar helps the #PEPSys group keep track of interesting conferences, workshops, symposiums, and summer schools where we may want to publish.

The focus is on venues related to privacy, security, cryptography, energy systems, IoT, smart grids, and adjacent research areas.

## What We Track

Each conference entry can include:

- name and acronym
- research areas
- detailed topics and keywords
- submission deadline
- notification date
- conference dates
- location
- website and CFP links
- notes about why the venue is relevant

## Research Areas

Use one or more of these broad areas for filtering:

- `privacy`
- `security`
- `crypto`
- `energy`
- `iot`

Use `topics` and `keywords` for more specific terms such as `smart grids`, `usable privacy`, `privacy engineering`, `blockchain`, or `cyber-physical systems`.

## Adding Or Updating Conferences

Conference data lives in:

```text
data/conferences.json
```

Anyone with repository access can update that file directly. The app also has an `Add conference` helper that generates a JSON entry you can copy into the file.

Use ISO dates (`YYYY-MM-DD`) for deadlines and other sortable date fields.

For venues with multiple deadlines, such as PETS/PoPETs issues or multi-cycle security conferences, use `deadline_entries`. The app shows the next upcoming deadline automatically.

## Deadline Checks

Entries with:

```json
"auto_check": true
```

are checked against their CFP or website URL. Automated deadline checks are implemented and working through the repository workflow.

The checker reports possible deadline changes for review; it does not overwrite deadlines automatically.

### How The Checker Works

The deadline checker is a conservative helper. Its job is to notice possible deadline changes and create something for a human to review.

For each conference with `auto_check: true`, the checker:

- opens the conference `cfp_url`, or falls back to `website_url` if no CFP URL is available
- downloads the page content
- extracts readable text from the page
- looks for deadline-related phrases such as `submission deadline`, `paper submission`, `important dates`, `deadline`, and `due`
- searches nearby text for dates such as `2026-09-15`, `September 15, 2026`, or `15 September 2026`
- compares the dates it found with the deadline stored in `data/conferences.json`
- writes a review report with the current deadline, possible new deadline, source URL, confidence level, and a short source snippet
- writes a reviewable proposal file to `data/deadline-proposals.json`

If the stored deadline is already found on the page, the checker treats that as confirmation and avoids reporting unrelated dates like notification, camera-ready, registration, or conference dates.

If the checker finds a possible different deadline, or if a page cannot be checked, the repository workflow opens a GitHub issue so someone can review it.

### Applying Reviewed Deadline Changes

The checker does not overwrite `data/conferences.json` directly. When it finds possible changes, it writes proposals like this:

```json
{
  "conference_id": "example-2026",
  "field": "submission_deadline",
  "current_value": "2026-04-01",
  "proposed_value": "2026-04-15",
  "apply": false
}
```

To approve a change, review it against the official CFP and change only the correct proposals to:

```json
"apply": true
```

Then run:

```bash
python3 scripts/update_dates.py
```

The update script applies approved proposals to `data/conferences.json`, updates matching `deadline_entries` when possible, and removes `data/deadline-proposals.json` after a successful update.

The checker is useful for catching changes, but it is not meant to be a fully automatic source of truth. Some conference pages are difficult to parse, especially pages that use PDFs, JavaScript-rendered dates, old CFP archives, missing years, or multiple submission rounds.

## Calendar Reminders

Conference cards with an exact deadline include an `Add deadline` button. It downloads a calendar event with reminders 30 days, 14 days, and 3 days before the deadline.

## TODO

- Review and confirm deadlines that are marked as expected rather than official.
- Add more conferences.
- Keep CFP links up to date, especially when a conference moves to a new yearly website.
- Add missing notification dates and conference dates where possible.
- Periodically review automated deadline-check issues and update `data/conferences.json` when needed.
