#!/usr/bin/env python3
"""Apply reviewed deadline proposals to conference data.

Only proposals with "apply": true are used. The proposal file is removed after
successful updates unless --keep-proposals is passed.
"""

from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Apply approved deadline proposals.")
    parser.add_argument("--data", default="data/conferences.json", help="Path to conference JSON data.")
    parser.add_argument("--proposals", default="data/deadline-proposals.json", help="Path to reviewed proposals.")
    parser.add_argument("--keep-proposals", action="store_true", help="Keep the proposal file after applying updates.")
    args = parser.parse_args()

    data_path = Path(args.data)
    proposals_path = Path(args.proposals)

    if not proposals_path.exists():
        raise SystemExit(f"No proposal file found at {proposals_path}")

    payload = json.loads(data_path.read_text(encoding="utf-8"))
    proposal_payload = json.loads(proposals_path.read_text(encoding="utf-8"))
    proposals = [proposal for proposal in proposal_payload.get("proposals", []) if proposal.get("apply") is True]

    if not proposals:
        print("No proposals with apply=true. Nothing changed.")
        return 0

    conferences = payload.get("conferences", [])
    by_id = {conference.get("id"): conference for conference in conferences}
    applied = []

    for proposal in proposals:
        conference_id = proposal.get("conference_id")
        conference = by_id.get(conference_id)
        if not conference:
            print(f"Skipping unknown conference id: {conference_id}")
            continue

        field = proposal.get("field")
        if field != "submission_deadline":
            print(f"Skipping unsupported field for {conference_id}: {field}")
            continue

        current_value = proposal.get("current_value") or ""
        proposed_value = proposal.get("proposed_value") or ""
        if not proposed_value:
            print(f"Skipping empty proposed deadline for {conference_id}")
            continue

        old_value = conference.get("submission_deadline") or ""
        if old_value and current_value and old_value != current_value:
            print(f"Skipping {conference_id}: data has {old_value}, proposal expected {current_value}")
            continue

        conference["submission_deadline"] = proposed_value
        update_matching_deadline_entry(conference, current_value, proposed_value)
        conference["last_checked"] = date.today().isoformat()
        conference["deadline_confidence"] = "manual"
        applied.append(f"{conference.get('acronym') or conference_id}: {old_value or 'TBA'} -> {proposed_value}")

    if not applied:
        print("No proposals were applied.")
        return 0

    payload["updated_at"] = date.today().isoformat()
    data_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    if not args.keep_proposals:
        proposals_path.unlink()

    print("Applied deadline updates:")
    for line in applied:
        print(f"- {line}")
    if args.keep_proposals:
        print(f"Kept proposal file: {proposals_path}")
    else:
        print(f"Removed proposal file: {proposals_path}")
    return 0


def update_matching_deadline_entry(conference: dict, current_value: str, proposed_value: str) -> None:
    entries = conference.get("deadline_entries")
    if not isinstance(entries, list):
        return

    for entry in entries:
        if not isinstance(entry, dict):
            continue
        if current_value and entry.get("date") == current_value:
            entry["date"] = proposed_value
            return


if __name__ == "__main__":
    raise SystemExit(main())
