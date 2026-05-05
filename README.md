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

## Manual Deadline Review

Conference deadlines are reviewed manually.

A simple workflow for the group is:

1. Open the official conference website or CFP page.
2. Check the current submission deadline and conference dates.
3. Update `data/conferences.json` if something changed.
4. Commit and push the updated file.

This is more manual, but it keeps the radar easier to trust and easier to understand.

## Calendar Reminders

Conference cards with an exact deadline include an `Add to calendar` button. It downloads a calendar event with reminders 30 days, 14 days, and 3 days before the deadline.

## TODO

- Review and confirm deadlines that are marked as expected rather than official.
- Add more conferences.
- Keep CFP links up to date, especially when a conference moves to a new yearly website.
- Add missing notification dates and conference dates where possible.
- Periodically review official CFP pages and update `data/conferences.json` when needed.
