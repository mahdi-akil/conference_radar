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

The `Deadline check` GitHub Actions workflow runs every Monday. It can also be
started manually from the Actions tab. It checks each conference's CFP page, or
falls back to its main website. To exclude an entry, add:

```json
"auto_check": false
```

The checker remembers the deadline dates seen during its previous run. It reports
new credible dates and classifies them as a likely deadline extension, likely new
conference edition, or something requiring manual review.

Every run writes its report directly to the GitHub Actions summary. When review is
needed, the workflow creates or updates one issue labeled `deadline-review`. It
does not create ZIP artifacts and never changes `data/conferences.json`
automatically.

To handle a finding:

1. Open the source link in the review issue and verify the date.
2. Edit `data/conferences.json` directly on GitHub.
3. Commit the verified change and close the review issue with a short note.

Temporary website failures stay visible in the Actions summary and logs. A failure
is added to the review issue only after two consecutive failed scans. Conference
pages that render dates only with JavaScript, publish only a PDF, or block
automated requests may still require manual checking.

The checker can be run locally from either the repository root or the `scripts`
directory:

```bash
python3 scripts/check_deadlines.py  # from the repository root
python3 check_deadlines.py          # from scripts/
```

The local report is written to `deadline-report.md`, which is ignored by Git.

## Calendar Reminders

Conference cards with an exact deadline include an `Add to calendar` button. It downloads a calendar event with reminders 30 days, 14 days, and 3 days before the deadline.

## TODO

- Review and confirm deadlines that are marked as expected rather than official.
- Add more conferences.
- Keep CFP links up to date, especially when a conference moves to a new yearly website.
