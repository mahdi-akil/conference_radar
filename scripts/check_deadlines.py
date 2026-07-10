#!/usr/bin/env python3
"""Check conference pages and write one human-readable review report.

The checker never edits conference data. It remembers the last deadline-related
content seen on each page, reports credible new dates, and distinguishes likely
same-edition extensions from likely new conference editions.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable, Optional


REPO_ROOT = Path(__file__).resolve().parent.parent
STATE_SCHEMA_VERSION = 4
REVIEW_GRACE_DAYS = 14
FAILURE_NOTIFY_AFTER = 2


KEYWORDS = (
    "submission deadline",
    "paper submission",
    "full paper",
    "abstract deadline",
    "abstract submission",
    "important dates",
    "deadline",
    "due",
)

MONTHS = {
    "jan": 1,
    "january": 1,
    "feb": 2,
    "february": 2,
    "mar": 3,
    "march": 3,
    "apr": 4,
    "april": 4,
    "may": 5,
    "jun": 6,
    "june": 6,
    "jul": 7,
    "july": 7,
    "aug": 8,
    "august": 8,
    "sep": 9,
    "sept": 9,
    "september": 9,
    "oct": 10,
    "october": 10,
    "nov": 11,
    "november": 11,
    "dec": 12,
    "december": 12,
}

MONTH_PATTERN = (
    r"Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
    r"Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?|tember)?|Oct(?:ober)?|"
    r"Nov(?:ember)?|Dec(?:ember)?"
)

DATE_PATTERNS = (
    re.compile(r"\b(?P<year>20\d{2})[-/.](?P<month>0?[1-9]|1[0-2])[-/.](?P<day>0?[1-9]|[12]\d|3[01])\b"),
    re.compile(
        rf"\b(?P<month>{MONTH_PATTERN})\.?\s+(?P<day>0?[1-9]|[12]\d|3[01])"
        rf"(?:st|nd|rd|th)?(?:,)?\s+(?P<year>20\d{{2}})\b",
        re.IGNORECASE,
    ),
    re.compile(
        rf"\b(?P<day>0?[1-9]|[12]\d|3[01])(?:st|nd|rd|th)?\s+"
        rf"(?P<month>{MONTH_PATTERN})\.?(?:,)?\s+(?P<year>20\d{{2}})\b",
        re.IGNORECASE,
    ),
)


@dataclass(frozen=True)
class Candidate:
    conference_id: str
    acronym: str
    name: str
    conference_dates: str
    current_deadline: str
    current_deadlines: list[str]
    candidate_deadline: str
    source_url: str
    snippet: str
    confidence: str


@dataclass(frozen=True)
class PageChange:
    conference_id: str
    label: str
    source_url: str
    previous_dates: list[str]
    observed_dates: list[str]
    source_changed: bool
    text_changed: bool


class TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        tag = tag.lower()
        if tag in {"script", "style", "svg", "noscript"}:
            self.skip_depth += 1
            return
        if tag in {"br", "p", "li", "tr", "h1", "h2", "h3", "h4", "div"}:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in {"script", "style", "svg", "noscript"} and self.skip_depth:
            self.skip_depth -= 1

    def handle_data(self, data: str) -> None:
        if not self.skip_depth and data.strip():
            self.parts.append(data)

    def text(self) -> str:
        return html.unescape(" ".join(self.parts))


def main() -> int:
    parser = argparse.ArgumentParser(description="Scan conference pages for deadline changes.")
    parser.add_argument("--data", default=str(REPO_ROOT / "data/conferences.json"))
    parser.add_argument("--state", default=str(REPO_ROOT / ".cache/deadline-page-state.json"))
    parser.add_argument("--report", default=str(REPO_ROOT / "deadline-report.md"))
    parser.add_argument("--github-output", default=os.environ.get("GITHUB_OUTPUT"))
    args = parser.parse_args()

    conferences = load_json(Path(args.data)).get("conferences", [])
    previous_state = load_state(Path(args.state))
    previous_pages = previous_state.get("conferences", {})

    candidates: list[Candidate] = []
    alert_candidates: list[Candidate] = []
    page_changes: list[PageChange] = []
    errors: list[str] = []
    persistent_errors: list[str] = []
    configuration_errors: list[str] = []
    next_pages: dict[str, dict] = {}
    checked = 0
    skipped = 0

    for conference in conferences:
        conference_id = conference.get("id", "")
        previous = previous_pages.get(conference_id, {})

        # All conferences are checked by default. Set auto_check=false to opt out.
        if conference.get("auto_check") is False:
            skipped += 1
            continue

        urls = source_urls(conference)
        if not urls:
            message = f"{label(conference)} has no CFP or website URL."
            errors.append(message)
            if previous.get("error") != message:
                configuration_errors.append(message)
            next_pages[conference_id] = state_entry(source_url="", error=message, error_count=1)
            continue

        checked += 1
        source_url = ""
        page_text = ""
        fetch_failures = []
        for candidate_url in urls:
            try:
                page_text = fetch_text(candidate_url)
                source_url = candidate_url
                break
            except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
                fetch_failures.append(f"{candidate_url}: {compact_error(exc)}")

        if not source_url:
            message = f"{label(conference)} could not be fetched: {'; '.join(fetch_failures)}"
            errors.append(message)
            error_count = int(previous.get("error_count", 0)) + 1
            if error_count == FAILURE_NOTIFY_AFTER:
                persistent_errors.append(message)
            next_pages[conference_id] = state_entry(
                source_url=urls[0],
                relevant_hash=previous.get("relevant_hash", ""),
                observed_dates=previous.get("observed_dates", []),
                error=message,
                error_count=error_count,
            )
            continue

        snippets = relevant_snippets(page_text)
        page_candidates = find_candidates(conference, source_url, snippets)
        candidates.extend(page_candidates)

        observed_dates = sorted(
            {
                candidate.candidate_deadline
                for candidate in page_candidates
                if candidate.confidence != "low"
            }
        )
        relevant_hash = fingerprint(snippets)
        source_changed = bool(previous) and previous.get("source_url") != source_url
        dates_changed = bool(previous) and previous.get("observed_dates", []) != observed_dates
        meaningful_change = source_changed or dates_changed

        if meaningful_change:
            page_changes.append(
                PageChange(
                    conference_id=conference_id,
                    label=label(conference),
                    source_url=source_url,
                    previous_dates=previous.get("observed_dates", []),
                    observed_dates=observed_dates,
                    source_changed=source_changed,
                    text_changed=previous.get("relevant_hash") != relevant_hash,
                )
            )

        different = [candidate for candidate in page_candidates if is_reviewable_candidate(candidate)]
        if not previous or meaningful_change:
            alert_candidates.extend(different)

        next_pages[conference_id] = state_entry(
            source_url=source_url,
            relevant_hash=relevant_hash,
            observed_dates=observed_dates,
        )

    write_json(
        Path(args.state),
        {
            "schema_version": STATE_SCHEMA_VERSION,
            "updated_at": now_iso(),
            "conferences": next_pages,
        },
    )
    write_report(
        Path(args.report),
        checked=checked,
        skipped=skipped,
        candidates=candidates,
        alert_candidates=alert_candidates,
        page_changes=page_changes,
        errors=errors,
        persistent_errors=persistent_errors,
        configuration_errors=configuration_errors,
        first_run=not bool(previous_pages),
    )

    has_notifications = bool(
        alert_candidates or page_changes or persistent_errors or configuration_errors
    )
    write_github_output(
        args.github_output,
        checked=checked,
        candidate_count=len(candidates),
        notification_count=(
            len(alert_candidates)
            + len(page_changes)
            + len(persistent_errors)
            + len(configuration_errors)
        ),
        has_notifications=has_notifications,
    )

    print(f"Checked {checked} conference pages; skipped {skipped}.")
    review_count = sum(is_reviewable_candidate(item) for item in candidates)
    print(
        f"Extracted {len(candidates)} dated references; "
        f"{review_count} require review; {len(page_changes)} deadline pages changed."
    )
    if errors:
        print(
            f"Encountered {len(errors)} fetch or configuration issue(s); "
            f"{len(persistent_errors) + len(configuration_errors)} require attention.",
            file=sys.stderr,
        )
    return 0


def fetch_text(url: str) -> str:
    repository = os.environ.get("GITHUB_REPOSITORY", "conference-radar")
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": f"ConferenceRadar/2.0 (+https://github.com/{repository})",
            "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
        },
    )
    with urllib.request.urlopen(request, timeout=25) as response:
        content_type = response.headers.get("content-type", "").lower()
        allowed = ("text/html", "text/plain", "application/xhtml+xml", "")
        if not any(kind in content_type for kind in allowed):
            raise ValueError(f"unsupported content type: {content_type}")
        raw = response.read(1_500_000)

    text = raw.decode("utf-8", errors="replace")
    if "<" in text and ">" in text:
        extractor = TextExtractor()
        extractor.feed(text)
        text = extractor.text()
    return normalize_document(text)


def find_candidates(conference: dict, source_url: str, snippets: list[str]) -> list[Candidate]:
    known = known_deadlines(conference)
    by_date: dict[str, Candidate] = {}

    for snippet in snippets:
        for found_date, context in extract_dated_contexts(snippet):
            iso_date = found_date.isoformat()
            candidate = Candidate(
                conference_id=conference.get("id", ""),
                acronym=conference.get("acronym", ""),
                name=conference.get("name", ""),
                conference_dates=conference.get("conference_dates") or "",
                current_deadline=conference.get("submission_deadline") or "",
                current_deadlines=known,
                candidate_deadline=iso_date,
                source_url=source_url,
                snippet=context[:500],
                confidence=classify_confidence(context, iso_date, known),
            )
            existing = by_date.get(iso_date)
            if not existing or score_snippet(candidate.snippet) > score_snippet(existing.snippet):
                by_date[iso_date] = candidate

    ranked = sorted(
        by_date.values(),
        key=lambda item: (score_snippet(item.snippet), item.candidate_deadline),
        reverse=True,
    )
    return ranked[:4]


def known_deadlines(conference: dict) -> list[str]:
    values = []
    if conference.get("submission_deadline"):
        values.append(conference["submission_deadline"])
    for entry in conference.get("deadline_entries") or []:
        if isinstance(entry, dict) and entry.get("date"):
            values.append(entry["date"])
    return sorted(set(values))


def relevant_snippets(text: str) -> list[str]:
    chunks = split_chunks(text)
    relevant = []
    seen = set()
    for index, chunk in enumerate(chunks):
        if not any(keyword in chunk.lower() for keyword in KEYWORDS):
            continue
        window = normalize_space(" | ".join(chunks[max(0, index - 1) : min(len(chunks), index + 3)]))
        if window and window not in seen:
            seen.add(window)
            relevant.append(window)
    return relevant


def split_chunks(text: str) -> list[str]:
    chunks = re.split(r"(?:\n+|(?<=[.!?])\s+)", text)
    return [normalize_space(chunk) for chunk in chunks if len(normalize_space(chunk)) > 10]


def extract_dates(text: str) -> Iterable[date]:
    for value, _context in extract_dated_contexts(text):
        yield value


def extract_dated_contexts(text: str) -> Iterable[tuple[date, str]]:
    matches = []
    for pattern in DATE_PATTERNS:
        for match in pattern.finditer(text):
            try:
                value = make_date(match.groupdict())
            except ValueError:
                continue
            matches.append((match.start(), match.end(), value))

    unique_matches = []
    seen = set()
    for start, end, value in sorted(matches):
        key = (start, end, value)
        if key in seen:
            continue
        seen.add(key)
        unique_matches.append((start, end, value))

    for index, (start, end, value) in enumerate(unique_matches):
        previous_end = unique_matches[index - 1][1] if index else 0
        next_start = unique_matches[index + 1][0] if index + 1 < len(unique_matches) else len(text)
        yield value, date_context(text, start, end, previous_end, next_start)


def date_context(text: str, start: int, end: int, previous_end: int, next_start: int) -> str:
    boundaries = ".!?;|\n"
    left = max((text.rfind(mark, previous_end, start) for mark in boundaries), default=-1)
    left = previous_end if left == -1 else left + 1
    right_values = [
        position
        for mark in boundaries
        if (position := text.find(mark, end, next_start)) != -1
    ]
    right = min(right_values) + 1 if right_values else min(next_start, end + 120)
    context = normalize_space(text[left:right])
    if len(context) < 20:
        context = normalize_space(text[max(0, start - 100) : min(len(text), end + 100)])
    return context


def make_date(parts: dict[str, str]) -> date:
    month_value = parts["month"]
    month = int(month_value) if month_value.isdigit() else MONTHS[month_value.rstrip(".").lower()]
    return date(int(parts["year"]), month, int(parts["day"]))


def classify_confidence(snippet: str, candidate: str, known: list[str]) -> str:
    lower = snippet.lower()
    if candidate in known:
        return "same-as-current"
    if any(
        phrase in lower
        for phrase in (
            "notification",
            "camera",
            "rebuttal",
            "author response",
            "conference date",
            "registration deadline",
            "paper registration",
            "abstract registration",
            "revision deadline",
            "final paper due",
            "final revised paper",
            "resubmission",
            "organizer submission",
        )
    ) or ("revised" in lower and "paper" in lower and "due" in lower):
        return "low"
    if "submission deadline" in lower or "paper submission" in lower:
        return "high"
    if "deadline" in lower or "due" in lower:
        return "medium"
    return "low"


def score_snippet(snippet: str) -> int:
    lower = snippet.lower()
    score = 0
    score += 8 if "submission deadline" in lower else 0
    score += 5 if "paper submission" in lower or "submit" in lower else 0
    score += 4 if "full paper" in lower else 0
    score += 3 if "extended" in lower else 0
    score += 2 if "deadline" in lower or "due" in lower else 0
    score += 1 if "abstract" in lower else 0
    score -= 4 if "notification" in lower else 0
    score -= 5 if "camera" in lower else 0
    score -= 5 if "conference date" in lower or "conference dates" in lower else 0
    return score


def is_reviewable_candidate(candidate: Candidate) -> bool:
    if candidate.confidence in {"same-as-current", "low"}:
        return False
    cutoff = date.today() - timedelta(days=REVIEW_GRACE_DAYS)
    return date.fromisoformat(candidate.candidate_deadline) >= cutoff


def classify_finding(candidate: Candidate) -> tuple[str, str]:
    """Return a human-facing finding type and recommended action."""
    candidate_date = date.fromisoformat(candidate.candidate_deadline)
    bounds = conference_date_bounds(candidate.conference_dates)
    current = parse_iso_date(candidate.current_deadline)

    if bounds and candidate_date > bounds[1]:
        next_year = bounds[1].year + 1
        return (
            "Likely new edition",
            f"Add a new {next_year} conference record; do not overwrite the current edition.",
        )
    if bounds and current and current < candidate_date <= bounds[0]:
        return (
            "Likely deadline extension",
            "After verifying the source, update the existing submission deadline.",
        )
    return (
        "Manual review",
        "Check the official page and decide whether this belongs to the current edition, another track, or a new edition.",
    )


def conference_date_bounds(value: str) -> Optional[tuple[date, date]]:
    dates = []
    for match in re.finditer(r"\b20\d{2}-\d{2}-\d{2}\b", value or ""):
        parsed = parse_iso_date(match.group(0))
        if parsed:
            dates.append(parsed)
    return (min(dates), max(dates)) if dates else None


def parse_iso_date(value: str) -> Optional[date]:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def fingerprint(snippets: list[str]) -> str:
    normalized = "\n".join(sorted(normalize_space(item).lower() for item in snippets))
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def state_entry(
    *,
    source_url: str,
    relevant_hash: str = "",
    observed_dates: Optional[list[str]] = None,
    error: str = "",
    error_count: int = 0,
) -> dict:
    return {
        "source_url": source_url,
        "relevant_hash": relevant_hash,
        "observed_dates": observed_dates or [],
        "checked_at": now_iso(),
        "error": error,
        "error_count": error_count,
    }


def write_report(
    path: Path,
    *,
    checked: int,
    skipped: int,
    candidates: list[Candidate],
    alert_candidates: list[Candidate],
    page_changes: list[PageChange],
    errors: list[str],
    persistent_errors: list[str],
    configuration_errors: list[str],
    first_run: bool,
) -> None:
    review_candidate_count = sum(is_reviewable_candidate(item) for item in candidates)
    lines = [
        "# Conference Deadline Check",
        "",
        f"- Checked pages: {checked}",
        f"- Explicitly skipped: {skipped}",
        f"- Dated references extracted: {len(candidates)}",
        f"- Reviewable dates observed: {review_candidate_count}",
        f"- New findings requiring review: {len(alert_candidates)}",
        f"- Deadline-related page changes: {len(page_changes)}",
        f"- Pages currently unreachable: {len(errors)}",
        "",
    ]
    if first_run:
        lines.extend(
            [
                "> This was the first stateful scan. It established the page baseline and reports any",
                "> deadline candidates that differ from the database.",
                "",
            ]
        )

    lines.extend(["## Deadline-related page changes", ""])
    if page_changes:
        for change in page_changes[:30]:
            details = []
            if change.source_changed:
                details.append("source URL changed")
            if change.text_changed:
                details.append("deadline-related text changed")
            if change.previous_dates != change.observed_dates:
                details.append("observed dates changed")
            lines.extend(
                [
                    f"### {change.label}",
                    "",
                    f"- Change: {', '.join(details)}",
                    f"- Previously observed dates: `{', '.join(change.previous_dates) or 'none'}`",
                    f"- Currently observed dates: `{', '.join(change.observed_dates) or 'none'}`",
                    f"- Source: {change.source_url}",
                    "",
                ]
            )
        if len(page_changes) > 30:
            lines.extend([f"_Another {len(page_changes) - 30} page changes are available in the artifacts._", ""])
    else:
        lines.extend(["None found.", ""])

    lines.extend(["## Findings requiring review", ""])
    if alert_candidates:
        for candidate in alert_candidates[:40]:
            finding_type, action = classify_finding(candidate)
            lines.extend(
                [
                    f"### {candidate.acronym or candidate.name}",
                    "",
                    f"- Type: **{finding_type}**",
                    f"- Stored deadline(s): `{', '.join(candidate.current_deadlines) or 'TBA'}`",
                    f"- Candidate: `{candidate.candidate_deadline}`",
                    f"- Conference dates: `{candidate.conference_dates or 'TBA'}`",
                    f"- Confidence: `{candidate.confidence}`",
                    f"- Source: {candidate.source_url}",
                    f"- Snippet: {candidate.snippet}",
                    f"- Recommended action: {action}",
                    "",
                ]
            )
        if len(alert_candidates) > 40:
            lines.extend(
                [
                    f"_Another {len(alert_candidates) - 40} findings were omitted from this summary._",
                    "",
                ]
            )
    else:
        lines.extend(["None found.", ""])

    attention_errors = configuration_errors + persistent_errors
    if attention_errors:
        lines.extend(["## Pages requiring attention", ""])
        lines.extend(f"- {error}" for error in attention_errors)
        lines.append("")

    if alert_candidates or page_changes or attention_errors:
        lines.extend(
            [
                "## What to do",
                "",
                "1. Open each source link above and verify the date.",
                "2. Edit `data/conferences.json` directly on GitHub.",
                "3. Commit the verified change and close this issue with a short note.",
                "",
            ]
        )
    else:
        lines.extend(["## Result", "", "No action needed.", ""])

    lines.extend(
        [
            "Transient fetch failures are shown in the Actions summary but only appear here after",
            f"{FAILURE_NOTIFY_AFTER} consecutive failed scans.",
            "",
        ]
    )
    path.write_text("\n".join(lines), encoding="utf-8")


def write_github_output(
    output_path: Optional[str],
    *,
    checked: int,
    candidate_count: int,
    notification_count: int,
    has_notifications: bool,
) -> None:
    if not output_path:
        return
    with open(output_path, "a", encoding="utf-8") as output:
        output.write(f"checked={checked}\n")
        output.write(f"candidate_count={candidate_count}\n")
        output.write(f"notification_count={notification_count}\n")
        output.write(f"has_notifications={'true' if has_notifications else 'false'}\n")


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def load_state(path: Path) -> dict:
    if not path.exists():
        return {"schema_version": STATE_SCHEMA_VERSION, "conferences": {}}
    try:
        payload = load_json(path)
    except (json.JSONDecodeError, OSError) as exc:
        print(f"Ignoring unreadable state file {path}: {exc}", file=sys.stderr)
        return {"schema_version": STATE_SCHEMA_VERSION, "conferences": {}}
    if payload.get("schema_version") != STATE_SCHEMA_VERSION:
        return {"schema_version": STATE_SCHEMA_VERSION, "conferences": {}}
    return (
        payload
        if isinstance(payload.get("conferences"), dict)
        else {"schema_version": STATE_SCHEMA_VERSION, "conferences": {}}
    )


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def normalize_document(value: str) -> str:
    lines = [normalize_space(line) for line in value.splitlines()]
    return "\n".join(line for line in lines if line)


def compact_error(error: BaseException) -> str:
    return normalize_space(str(error))[:240]


def label(conference: dict) -> str:
    return conference.get("acronym") or conference.get("name") or conference.get("id") or "conference"


def source_urls(conference: dict) -> list[str]:
    return list(dict.fromkeys(url for url in (conference.get("cfp_url"), conference.get("website_url")) if url))


if __name__ == "__main__":
    raise SystemExit(main())
