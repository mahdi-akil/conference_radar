#!/usr/bin/env python3
"""Apply manually approved deadline proposals to conference data."""

from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    parser = argparse.ArgumentParser(description="Apply approved deadline proposals.")
    parser.add_argument("--data", default=str(REPO_ROOT / "data/conferences.json"))
    parser.add_argument("--proposals", default=str(REPO_ROOT / "data/deadline-proposals.json"))
    parser.add_argument("--keep-proposals", action="store_true")
    args = parser.parse_args()

    data_path = Path(args.data)
    proposals_path = Path(args.proposals)
    if not proposals_path.exists():
        raise SystemExit(f"No proposal file found at {proposals_path}")

    payload = json.loads(data_path.read_text(encoding="utf-8"))
    proposal_payload = json.loads(proposals_path.read_text(encoding="utf-8"))
    proposals = [item for item in proposal_payload.get("proposals", []) if item.get("apply") is True]
    if not proposals:
        print("No proposals with apply=true. Nothing changed.")
        return 0

    by_id = {item.get("id"): item for item in payload.get("conferences", [])}
    applied = []
    for proposal in proposals:
        conference_id = proposal.get("conference_id")
        conference = by_id.get(conference_id)
        if not conference:
            print(f"Skipping unknown conference id: {conference_id}")
            continue
        if proposal.get("field") != "submission_deadline":
            print(f"Skipping unsupported field for {conference_id}: {proposal.get('field')}")
            continue

        expected = proposal.get("current_value") or ""
        proposed = proposal.get("proposed_value") or ""
        current = conference.get("submission_deadline") or ""
        if not proposed:
            print(f"Skipping empty proposed deadline for {conference_id}")
            continue
        if current and expected and current != expected:
            print(f"Skipping {conference_id}: data has {current}, proposal expected {expected}")
            continue

        conference["submission_deadline"] = proposed
        update_matching_deadline_entry(conference, current, proposed)
        conference["last_checked"] = date.today().isoformat()
        conference["deadline_confidence"] = "manual"
        applied.append(f"{conference.get('acronym') or conference_id}: {current or 'TBA'} -> {proposed}")

    if not applied:
        print("No proposals were applied.")
        return 0

    payload["updated_at"] = date.today().isoformat()
    data_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    if not args.keep_proposals:
        proposals_path.unlink()

    print("Applied deadline updates:")
    for item in applied:
        print(f"- {item}")
    return 0


def update_matching_deadline_entry(conference: dict, current: str, proposed: str) -> None:
    entries = conference.get("deadline_entries")
    if not isinstance(entries, list):
        return
    for entry in entries:
        if isinstance(entry, dict) and current and entry.get("date") == current:
            entry["date"] = proposed
            return


if __name__ == "__main__":
    raise SystemExit(main())
