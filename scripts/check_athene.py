#!/usr/bin/env python3
"""Compare ATHENE's public conference radar with local conference data.

ATHENE is treated as a discovery source, not as an authority. This script
produces review candidates for humans instead of changing conference data.
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
from dataclasses import asdict, dataclass
from datetime import date, datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Optional


ATHENE_URL = "https://www.athene-center.de/en/research/cfp"
RELEVANT_TERMS = (
    "security",
    "privacy",
    "cryptography",
    "crypto",
    "network",
    "distributed",
    "dependable",
    "cyber",
    "trust",
    "access control",
    "smart grid",
    "energy",
    "iot",
    "wireless",
    "mobile",
)
MATCH_STOP_WORDS = {
    "acm",
    "and",
    "annual",
    "conference",
    "conferences",
    "for",
    "computer",
    "computing",
    "ieee",
    "ifip",
    "of",
    "on",
    "international",
    "network",
    "networks",
    "privacy",
    "proceedings",
    "security",
    "symposium",
    "systems",
    "technologies",
    "the",
    "with",
    "workshop",
}
DATE_PATTERN = re.compile(
    r"\b(?P<month>January|February|March|April|May|June|July|August|September|October|November|December)\s+"
    r"(?P<day>0?[1-9]|[12]\d|3[01]),\s+(?P<year>20\d{2})\b",
    re.IGNORECASE,
)
MONTHS = {
    "january": 1,
    "february": 2,
    "march": 3,
    "april": 4,
    "may": 5,
    "june": 6,
    "july": 7,
    "august": 8,
    "september": 9,
    "october": 10,
    "november": 11,
    "december": 12,
}


@dataclass(frozen=True)
class AtheneEntry:
    name: str
    event_line: str
    deadline_line: str
    deadlines: list[str]
    rank: str


@dataclass(frozen=True)
class Finding:
    kind: str
    athene_name: str
    local_match: str
    athene_deadlines: list[str]
    local_deadlines: list[str]
    rank: str
    note: str


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
    parser = argparse.ArgumentParser(description="Compare ATHENE conference radar with local data.")
    parser.add_argument("--data", default="data/conferences.json", help="Path to local conference data.")
    parser.add_argument("--url", default=ATHENE_URL, help="ATHENE conference radar URL.")
    parser.add_argument("--candidates", default="data/athene-candidates.json", help="Candidate JSON output path.")
    parser.add_argument("--report", default="athene-report.md", help="Markdown report output path.")
    parser.add_argument("--github-output", default=os.environ.get("GITHUB_OUTPUT"), help="GitHub Actions output path.")
    args = parser.parse_args()

    payload = json.loads(Path(args.data).read_text(encoding="utf-8"))
    local = payload.get("conferences", [])

    try:
        page = fetch_text(args.url)
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        write_report(Path(args.report), args.url, [], [f"Could not fetch ATHENE page: {exc}"])
        write_candidates(Path(args.candidates), [])
        write_github_output(args.github_output, 0, 1)
        print(f"Could not fetch ATHENE page: {exc}", file=sys.stderr)
        return 0

    entries = parse_entries(page)
    findings = compare_entries(entries, local)

    write_candidates(Path(args.candidates), findings)
    write_report(Path(args.report), args.url, findings, [])
    write_github_output(args.github_output, len(findings), 0)

    print(f"Parsed {len(entries)} ATHENE entries.")
    print(f"Found {len(findings)} review candidate(s).")
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
        raw = response.read(2_000_000)
    text = raw.decode("utf-8", errors="replace")
    parser = TextExtractor()
    parser.feed(text)
    return parser.text()


def parse_entries(text: str) -> list[AtheneEntry]:
    lines = [normalize_space(line) for line in text.splitlines()]
    lines = [line for line in lines if line]
    entries: list[AtheneEntry] = []

    for index, line in enumerate(lines):
        if not line.lower().startswith("submission deadline:"):
            continue

        name = previous_name(lines, index)
        if not name:
            continue

        event_line = lines[index - 1] if index > 0 else ""
        rank = next_rank(lines, index)
        deadlines = [found.isoformat() for found in extract_dates(line)]
        entries.append(
            AtheneEntry(
                name=name,
                event_line=event_line,
                deadline_line=line,
                deadlines=deadlines,
                rank=rank,
            )
        )

    return entries


def previous_name(lines: list[str], index: int) -> str:
    for offset in range(index - 1, max(-1, index - 5), -1):
        line = lines[offset]
        lower = line.lower()
        if "website" in lower or "|" in line or lower.startswith("submission deadline"):
            continue
        if line in {"A+", "A", "B", "C", "not classified in CORE"}:
            continue
        return line
    return ""


def next_rank(lines: list[str], index: int) -> str:
    for offset in range(index + 1, min(len(lines), index + 4)):
        line = lines[offset]
        if line in {"A+", "A", "B", "C", "not classified in CORE"}:
            return line
    return ""


def compare_entries(entries: list[AtheneEntry], local: list[dict]) -> list[Finding]:
    findings: list[Finding] = []
    for entry in entries:
        if not is_relevant(entry):
            continue
        if is_past_only(entry):
            continue

        match = find_local_match(entry, local)
        if not match:
            findings.append(
                Finding(
                    kind="possible-new-conference",
                    athene_name=entry.name,
                    local_match="",
                    athene_deadlines=entry.deadlines,
                    local_deadlines=[],
                    rank=entry.rank,
                    note="ATHENE lists this relevant-looking conference, but no close local match was found.",
                )
            )
            continue

        local_deadlines = collect_local_deadlines(match)
        new_deadlines = [deadline for deadline in entry.deadlines if deadline not in local_deadlines]
        if new_deadlines:
            findings.append(
                Finding(
                    kind="possible-deadline-difference",
                    athene_name=entry.name,
                    local_match=match.get("acronym") or match.get("name") or match.get("id", ""),
                    athene_deadlines=entry.deadlines,
                    local_deadlines=local_deadlines,
                    rank=entry.rank,
                    note="ATHENE lists deadline dates that are not present in the local record. Review against the official CFP before updating.",
                )
            )

    return findings[:50]


def is_past_only(entry: AtheneEntry) -> bool:
    if not entry.deadlines:
        return False
    return all(parse_iso_date(deadline) < date.today() for deadline in entry.deadlines)


def parse_iso_date(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()


def is_relevant(entry: AtheneEntry) -> bool:
    source = " ".join([entry.name, entry.event_line, entry.deadline_line]).lower()
    return any(term in source for term in RELEVANT_TERMS)


def find_local_match(entry: AtheneEntry, local: list[dict]) -> Optional[dict]:
    entry_key = normalize_key(entry.name)
    entry_tokens = token_set(entry.name)
    best: tuple[float, Optional[dict]] = (0, None)

    for conference in local:
        name = conference.get("name", "")
        acronym = normalize_key(conference.get("acronym", ""))
        name_key = normalize_key(name)
        name_tokens = token_set(name)

        score = 0.0
        if acronym and len(acronym) >= 4 and acronym in entry_key:
            score = max(score, 1.0)
        if name_key and len(name_key) >= 12 and (name_key in entry_key or entry_key in name_key):
            score = max(score, 1.0)

        overlap = len(entry_tokens & name_tokens)
        denominator = max(min(len(entry_tokens), len(name_tokens)), 1)
        ratio = overlap / denominator
        if overlap >= 3 and ratio >= 0.5:
            score = max(score, ratio)

        if score > best[0]:
            best = (score, conference)

    return best[1] if best[0] >= 0.5 else None


def collect_local_deadlines(conference: dict) -> list[str]:
    deadlines = []
    if conference.get("submission_deadline"):
        deadlines.append(conference["submission_deadline"])
    for entry in conference.get("deadline_entries", []) or []:
        if entry.get("date"):
            deadlines.append(entry["date"])
    return sorted(set(deadlines))


def extract_dates(text: str) -> list[date]:
    dates = []
    for match in DATE_PATTERN.finditer(text):
        parts = match.groupdict()
        dates.append(date(int(parts["year"]), MONTHS[parts["month"].lower()], int(parts["day"])))
    return dates


def write_candidates(path: Path, findings: list[Finding]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": ATHENE_URL,
        "findings": [asdict(finding) for finding in findings],
    }
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def write_report(path: Path, source_url: str, findings: list[Finding], errors: list[str]) -> None:
    lines = [
        "# ATHENE Conference Radar Review",
        "",
        f"Source: {source_url}",
        f"Review candidates: {len(findings)}",
        "",
        "ATHENE is used as a discovery source only. Confirm every candidate against the official conference CFP before changing local data.",
        "",
    ]

    if findings:
        lines.extend(["## Candidates", ""])
        for finding in findings:
            lines.extend(
                [
                    f"### {finding.athene_name}",
                    "",
                    f"- Kind: `{finding.kind}`",
                    f"- Local match: `{finding.local_match or 'none'}`",
                    f"- ATHENE deadlines: `{', '.join(finding.athene_deadlines) or 'TBA'}`",
                    f"- Local deadlines: `{', '.join(finding.local_deadlines) or 'none'}`",
                    f"- Rank: `{finding.rank or 'not listed'}`",
                    f"- Note: {finding.note}",
                    "",
                ]
            )
    else:
        lines.extend(["## Candidates", "", "None found.", ""])

    if errors:
        lines.extend(["## Issues", ""])
        lines.extend(f"- {error}" for error in errors)
        lines.append("")

    path.write_text("\n".join(lines), encoding="utf-8")


def write_github_output(output_path: Optional[str], candidate_count: int, issue_count: int) -> None:
    if not output_path:
        return
    with open(output_path, "a", encoding="utf-8") as output:
        output.write(f"candidate_count={candidate_count}\n")
        output.write(f"issue_count={issue_count}\n")
        output.write(f"has_candidates={'true' if candidate_count or issue_count else 'false'}\n")


def token_set(value: str) -> set[str]:
    return {
        token
        for token in re.findall(r"[a-z0-9]+", value.lower())
        if len(token) > 2 and token not in MATCH_STOP_WORDS and not re.fullmatch(r"\d+(st|nd|rd|th)?", token)
    }


def normalize_key(value: str) -> str:
    return "".join(re.findall(r"[a-z0-9]+", value.lower()))


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


if __name__ == "__main__":
    raise SystemExit(main())
