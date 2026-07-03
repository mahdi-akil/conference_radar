# Conference Radar

Conference Radar helps the #PEPSys group keep track of interesting conferences, workshops, symposiums, and summer schools where we may want to publish.

The focus is on venues related to privacy, security, cryptography, energy systems...

## What We Track

Each conference entry can include:

- name and acronym
- research areas
- submission deadline
- conference dates
- location
- website and CFP links

## Research Areas

Use one or more of these broad areas for filtering:

- `privacy`
- `security`
- `crypto`
- `energy`
- `iot`

## Adding Or Updating Conferences

Conference data lives in:

```text
data/conferences.json
```

Anyone with repository access can update that file directly. The app also has an `Add conference` helper that generates a JSON entry you can copy into the file.

For venues with multiple deadlines, such as PETS/PoPETs issues or multi-cycle security conferences, use `deadline_entries`. The app shows the next upcoming deadline automatically. :)

## Automated Deadline Checks

The `Deadline check` GitHub Actions workflow runs every Monday and can also be
started manually from the Actions tab. It checks every conference that has a
`cfp_url` or `website_url`. To exclude a specific entry, add:

```json
"auto_check": false
```

The checker extracts deadline-related text and dates, compares them with
`data/conferences.json`, and remembers a fingerprint of the previous scan. When
the relevant page content, observed dates, or source URL changes, it opens a
GitHub issue with the source URL and snippets for review. New fetch failures are
also reported. Unchanged findings do not create a new issue every week.

The workflow never changes conference data automatically. Each run uploads a
`deadline-review-artifacts` bundle containing:

- `deadline-report.md`
- `data/deadline-candidates.json`
- `data/deadline-proposals.json`

After confirming a proposal against the official CFP, set its `apply` field to
`true` and run:

```bash
python3 scripts/update_dates.py
```

The update helper changes only approved proposals and checks that the stored
deadline has not changed since the proposal was generated. Conference pages that
render dates only with JavaScript, publish only a PDF, or block automated requests
may still require manual checking.

The checker can be run locally from either the repository root or the `scripts`
directory:

```bash
python3 scripts/check_deadlines.py  # from the repository root
python3 check_deadlines.py          # from scripts/
```

## Calendar Reminders

Conference cards with an exact deadline include an `Add to calendar` button. It downloads a calendar event with reminders 30 days, 14 days, and 3 days before the deadline.

## TODO

- Review and confirm deadlines that are marked as expected rather than official.
- Add more conferences.
- Keep CFP links up to date, especially when a conference moves to a new yearly website.
