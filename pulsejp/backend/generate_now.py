#!/usr/bin/env python3
from __future__ import annotations

import datetime as dt
import hashlib
import json
from pathlib import Path

from generate_digest import FEEDS, Item, JST, cluster, parse_rss

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "now.json"

def parse_iso(value: str | None) -> dt.datetime:
    if not value:
        return dt.datetime(1970, 1, 1, tzinfo=dt.timezone.utc)
    try:
        return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return dt.datetime(1970, 1, 1, tzinfo=dt.timezone.utc)

def stable_id(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:14]

def collect_items() -> list[dict]:
    candidates: list[dict] = []

    for category, queries in FEEDS.items():
        seen: set[str] = set()
        items: list[Item] = []

        for query in queries:
            try:
                for item in parse_rss(category, query):
                    key = item.link or item.title
                    if key in seen:
                        continue
                    seen.add(key)
                    items.append(item)
            except Exception as exc:
                print(f"warning: {category}/{query}: {exc}")

        for group in cluster(items)[:8]:
            group = sorted(group, key=lambda x: parse_iso(x.published_at), reverse=True)
            if not group:
                continue

            sources = []
            for index, item in enumerate(group[:6]):
                sources.append({
                    "id": stable_id(f"{item.link}-{index}"),
                    "name": item.source,
                    "title": item.title,
                    "url": item.link,
                    "publishedAt": item.published_at,
                })

            coverage = len({item.source for item in group})
            latest = max((parse_iso(item.published_at) for item in group), default=dt.datetime(1970,1,1,tzinfo=dt.timezone.utc))
            first = group[0]

            candidates.append({
                "id": stable_id(first.link or first.title),
                "category": category,
                "title": first.title,
                "sourceCount": max(1, coverage),
                "latestPublishedAt": latest.isoformat().replace("+00:00", "Z"),
                "sources": sources,
            })

    candidates.sort(
        key=lambda x: (x["sourceCount"], parse_iso(x["latestPublishedAt"])),
        reverse=True,
    )
    return candidates[:24]

def main() -> None:
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    payload = {
        "generatedAt": now.isoformat().replace("+00:00", "Z"),
        "label": "NOW",
        "note": "複数媒体の見出し掲載状況と更新時刻をもとに並べています。内容の評価や政治的な順位付けではありません。",
        "items": collect_items(),
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT} ({len(payload['items'])} items)")

if __name__ == "__main__":
    main()
