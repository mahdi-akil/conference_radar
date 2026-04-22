#!/usr/bin/env python3
"""Find reviewable deadline candidates from conference CFP pages.

The script is intentionally conservative. It does not rewrite the current
conference deadline, but rather records candidate dates with source snippets so we
can approve changes in Git.
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, asdict
from datetime import date, datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable, Optional


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
    re.compile(rf"\b(?P<month>{MONTH_PATTERN})\.?\s+(?P<day>0?[1-9]|[12]\d|3[01])(?:st|nd|rd|th)?(?:,)?\s+(?P<year>20\d{{2}})\b", re.IGNORECASE),
    re.compile(rf"\b(?P<day>0?[1-9]|[12]\d|3[01])(?:st|nd|rd|th)?\s+(?P<month>{MONTH_PATTERN})\.?(?:,)?\s+(?P<year>20\d{{2}})\b", re.IGNORECASE),
)


@dataclass(frozen=True)
class Candidate:
    conference_id: str
    acronym: str
    name: str
    current_deadline: str
    candidate_deadline: str
    source_url: str
    snippet: str
    confidence: str


class TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        if tag.lower() in {"script", "style", "svg", "noscript"}:
            self.skip_depth += 1
            return
        if tag.lower() in {"br", "p", "li", "tr", "h1", "h2", "h3", "h4", "div"}:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in {"script", "style", "svg", "noscript"} and self.skip_depth:
            self.skip_depth -= 1

    def handle_data(self, data: str) -> None:
        if self.skip_depth:
            return
        if data.strip():
            self.parts.append(data)

    def text(self) -> str:
        return html.unescape(" ".join(self.parts))


def main() -> int:
    parser = argparse.ArgumentParser(description="Scan conference pages for deadline candidates.")
    parser.add_argument("--data", default="data/conferences.json", help="Path to conference JSON data.")
    parser.add_argument("--candidates", default="data/deadline-candidates.json", help="Path for candidate JSON output.")
    parser.add_argument("--proposals", default="data/deadline-proposals.json", help="Path for reviewable deadline proposals.")
    parser.add_argument("--report", default="deadline-report.md", help="Path for Markdown report output.")
    parser.add_argument("--github-output", default=os.environ.get("GITHUB_OUTPUT"), help="GitHub Actions output path.")
    args = parser.parse_args()

    data_path = Path(args.data)
    payload = json.loads(data_path.read_text(encoding="utf-8"))
    conferences = payload.get("conferences", [])

    candidates: list[Candidate] = []
    errors: list[str] = []
    checked = 0

    for conference in conferences:
        if not conference.get("auto_check"):
            continue

        source_url = conference.get("cfp_url") or conference.get("website_url")
        if not source_url:
            errors.append(f"{label(conference)} has auto_check=true but no URL.")
            continue

        checked += 1
        try:
            page_text = fetch_text(source_url)
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            errors.append(f"{label(conference)} could not be fetched: {exc}")
            continue

        candidates.extend(find_candidates(conference, source_url, page_text))

    write_candidates(Path(args.candidates), candidates)
    write_proposals(Path(args.proposals), candidates)
    write_report(Path(args.report), checked, candidates, errors)
    write_github_output(args.github_output, checked, candidates, errors)

    print(f"Checked {checked} conference pages.")
    print(f"Found {len(candidates)} candidate deadline entries.")
    if errors:
        print(f"Encountered {len(errors)} fetch or configuration issue(s).", file=sys.stderr)
    return 0


def fetch_text(url: str) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "ConferenceRadar/1.0 (+https://github.com/)",
            "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
        },
    )
    with urllib.request.urlopen(request, timeout=25) as response:
        content_type = response.headers.get("content-type", "")
        if not any(kind in content_type for kind in ("text/html", "text/plain", "application/xhtml+xml", "")):
            raise ValueError(f"unsupported content type: {content_type}")
        raw = response.read(1_500_000)

    text = raw.decode("utf-8", errors="replace")
    if "<" in text and ">" in text:
        parser = TextExtractor()
        parser.feed(text)
        text = parser.text()
    return normalize_space(text)


def find_candidates(conference: dict, source_url: str, text: str) -> list[Candidate]:
    current_deadline = conference.get("submission_deadline") or ""
    snippets = relevant_snippets(text)
    by_date: dict[str, Candidate] = {}

    for snippet in snippets:
        for found_date in extract_dates(snippet):
            iso_date = found_date.isoformat()
            existing = by_date.get(iso_date)
            if existing and score_snippet(existing.snippet) >= score_snippet(snippet):
                continue

            confidence = classify_confidence(snippet, found_date.isoformat(), current_deadline)
            by_date[iso_date] = (
                Candidate(
                    conference_id=conference.get("id", ""),
                    acronym=conference.get("acronym", ""),
                    name=conference.get("name", ""),
                    current_deadline=current_deadline,
                    candidate_deadline=iso_date,
                    source_url=source_url,
                    snippet=snippet[:500],
                    confidence=confidence,
                )
            )

    candidates = list(by_date.values())
    if current_deadline and any(candidate.candidate_deadline == current_deadline for candidate in candidates):
        return [candidate for candidate in candidates if candidate.candidate_deadline == current_deadline][:1]

    candidates.sort(key=lambda candidate: score_snippet(candidate.snippet), reverse=True)
    return candidates[:3]


def relevant_snippets(text: str) -> list[str]:
    chunks = split_chunks(text)
    relevant = []
    for index, chunk in enumerate(chunks):
        lower = chunk.lower()
        if any(keyword in lower for keyword in KEYWORDS):
            window = " ".join(chunks[max(0, index - 1) : min(len(chunks), index + 3)])
            relevant.append(normalize_space(window))
    return relevant


def split_chunks(text: str) -> list[str]:
    chunks = re.split(r"(?:\n+|(?<=[.!?])\s+)", text)
    return [normalize_space(chunk) for chunk in chunks if len(normalize_space(chunk)) > 10]


def extract_dates(text: str) -> Iterable[date]:
    for pattern in DATE_PATTERNS:
        for match in pattern.finditer(text):
            yield make_date(match.groupdict())


def make_date(parts: dict[str, str]) -> date:
    year = int(parts["year"])
    month_value = parts["month"]
    if month_value.isdigit():
        month = int(month_value)
    else:
        month = MONTHS[month_value.rstrip(".").lower()]
    day = int(parts["day"])
    return date(year, month, day)


def classify_confidence(snippet: str, candidate: str, current: str) -> str:
    lower = snippet.lower()
    if candidate == current:
        return "same-as-current"
    if "submission deadline" in lower or "paper submission" in lower:
        return "high"
    if "deadline" in lower or "due" in lower:
        return "medium"
    return "low"


def score_snippet(snippet: str) -> int:
    lower = snippet.lower()
    score = 0
    if "submission deadline" in lower:
        score += 8
    if "paper submission" in lower or "submit" in lower:
        score += 5
    if "full paper" in lower:
        score += 4
    if "extended" in lower:
        score += 3
    if "abstract" in lower:
        score += 1
    if "deadline" in lower or "due" in lower:
        score += 2
    if "notification" in lower:
        score -= 4
    if "camera" in lower:
        score -= 5
    if "conference date" in lower or "conference dates" in lower:
        score -= 5
    return score


def write_candidates(path: Path, candidates: list[Candidate]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "candidates": [asdict(candidate) for candidate in candidates],
    }
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def write_proposals(path: Path, candidates: list[Candidate]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    proposals = [
        {
            "conference_id": candidate.conference_id,
            "acronym": candidate.acronym,
            "name": candidate.name,
            "field": "submission_deadline",
            "current_value": candidate.current_deadline,
            "proposed_value": candidate.candidate_deadline,
            "confidence": candidate.confidence,
            "source_url": candidate.source_url,
            "snippet": candidate.snippet,
            "apply": False,
        }
        for candidate in candidates
        if candidate.confidence != "same-as-current"
    ]
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "instructions": "Review each proposal against the official CFP. Set apply=true only for proposals that should update data/conferences.json, then run scripts/update_dates.py.",
        "proposals": proposals,
    }
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def write_report(path: Path, checked: int, candidates: list[Candidate], errors: list[str]) -> None:
    lines = [
        "# Conference Deadline Check",
        "",
        f"Checked pages: {checked}",
        f"Candidate entries: {len(candidates)}",
        "",
    ]

    changed = [candidate for candidate in candidates if candidate.confidence != "same-as-current"]
    if changed:
        lines.extend(
            [
                "## Potential Changes",
                "",
                "A reviewable proposal file was also written to `data/deadline-proposals.json`.",
                "Set `apply` to `true` for correct proposals, then run `python3 scripts/update_dates.py`.",
                "",
            ]
        )
        for candidate in changed:
            lines.extend(
                [
                    f"### {candidate.acronym or candidate.name}",
                    "",
                    f"- Current: `{candidate.current_deadline or 'TBA'}`",
                    f"- Candidate: `{candidate.candidate_deadline}`",
                    f"- Confidence: `{candidate.confidence}`",
                    f"- Source: {candidate.source_url}",
                    f"- Snippet: {candidate.snippet}",
                    "",
                ]
            )
    else:
        lines.extend(["## Potential Changes", "", "None found.", ""])

    if errors:
        lines.extend(["## Issues", ""])
        lines.extend(f"- {error}" for error in errors)
        lines.append("")

    path.write_text("\n".join(lines), encoding="utf-8")


def write_github_output(output_path: Optional[str], checked: int, candidates: list[Candidate], errors: list[str]) -> None:
    if not output_path:
        return
    changed = [candidate for candidate in candidates if candidate.confidence != "same-as-current"]
    with open(output_path, "a", encoding="utf-8") as output:
        output.write(f"checked={checked}\n")
        output.write(f"candidate_count={len(candidates)}\n")
        output.write(f"issue_count={len(errors)}\n")
        output.write(f"has_candidates={'true' if changed or errors else 'false'}\n")


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def label(conference: dict) -> str:
    return conference.get("acronym") or conference.get("name") or conference.get("id") or "conference"


if __name__ == "__main__":
    raise SystemExit(main())
