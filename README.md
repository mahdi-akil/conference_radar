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

## Calendar Reminders

Conference cards with an exact deadline include an `Add to calendar` button. It downloads a calendar event with reminders 30 days, 14 days, and 3 days before the deadline.

## TODO

- Review and confirm deadlines that are marked as expected rather than official.
- Add more conferences.
- Keep CFP links up to date, especially when a conference moves to a new yearly website.
