#!/usr/bin/env python3
from __future__ import annotations

import datetime as dt
import email.utils
import hashlib
import html
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass, asdict
from pathlib import Path

JST = dt.timezone(dt.timedelta(hours=9))
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "digest.json"
MODEL = os.getenv("OPENAI_MODEL", "gpt-5.6-luna")

FEEDS = {
    "entertainment": ["芸能", "音楽 話題", "映画 話題"],
    "politics": ["政治 日本", "国会", "政府 政策"],
    "economy": ["経済 日本", "企業 決算", "円相場 株価"],
    "internet": ["SNS 話題", "ネット 話題", "X トレンド 日本"],
}

@dataclass
class Item:
    category: str
    title: str
    link: str
    source: str
    published_at: str | None

def google_news_rss(query: str) -> str:
    q = urllib.parse.quote(query)
    return f"https://news.google.com/rss/search?q={q}&hl=ja&gl=JP&ceid=JP:ja"

def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "PulseJP/0.1 (+RSS digest)"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()

def parse_rss(category: str, query: str) -> list[Item]:
    root = ET.fromstring(fetch(google_news_rss(query)))
    items: list[Item] = []
    for node in root.findall("./channel/item")[:15]:
        title = html.unescape((node.findtext("title") or "").strip())
        link = (node.findtext("link") or "").strip()
        pub = (node.findtext("pubDate") or "").strip()
        source_node = node.find("source")
        source = (source_node.text or "Google News").strip() if source_node is not None else "Google News"
        if not title or not link:
            continue
        published_at = None
        if pub:
            try:
                parsed = email.utils.parsedate_to_datetime(pub)
                published_at = parsed.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")
            except Exception:
                pass
        items.append(Item(category, title, link, source, published_at))
    return items

def shingles(text: str, n: int = 2) -> set[str]:
    s = re.sub(r"[\s\W_]+", "", text.lower())
    return {s[i:i+n] for i in range(max(0, len(s)-n+1))}

def similarity(a: str, b: str) -> float:
    sa, sb = shingles(a), shingles(b)
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)

def cluster(items: list[Item]) -> list[list[Item]]:
    groups: list[list[Item]] = []
    for item in items:
        for group in groups:
            if max(similarity(item.title, x.title) for x in group) >= 0.28:
                group.append(item)
                break
        else:
            groups.append([item])
    return sorted(groups, key=lambda g: (len({x.source for x in g}), len(g)), reverse=True)

def collect() -> dict[str, list[list[Item]]]:
    result: dict[str, list[list[Item]]] = {}
    for category, queries in FEEDS.items():
        seen: set[str] = set()
        items: list[Item] = []
        for query in queries:
            try:
                for item in parse_rss(category, query):
                    key = item.link or item.title
                    if key not in seen:
                        seen.add(key)
                        items.append(item)
            except Exception as exc:
                print(f"warning: {category}/{query}: {exc}", file=sys.stderr)
        result[category] = cluster(items)[:8]
    return result

def source_payload(groups: dict[str, list[list[Item]]]) -> dict:
    payload: dict = {}
    for cat, clusters in groups.items():
        payload[cat] = []
        for idx, group in enumerate(clusters):
            payload[cat].append({
                "cluster_id": f"{cat}-{idx+1}",
                "coverage_count": len({x.source for x in group}),
                "headlines": [asdict(x) for x in group[:8]],
            })
    return payload

def build_prompt(raw: dict, edition: str) -> str:
    return f"""
あなたは日本向けニュースダイジェスト「Pulse JP」の編集者です。
以下はRSSで取得した見出し・媒体名・リンクです。記事全文を読んだ前提にせず、入力から確認できる範囲だけで慎重に要約してください。

目的: {edition}として、いま広く報じられている話題を約3分で把握できるJSONを作る。

厳守:
- 見出しから確認できない具体的事実を補完しない。
- 断定できない内容は「〜と報じられている」「詳細は未確認」と明示。
- 芸能の疑惑やゴシップは事実認定せず、報道内容と確認済み事実を分ける。
- 政治は中立・事実中心。政治家、政党、政策、候補者を評価・採点・順位付けしない。支持や投票を勧めない。選挙結果を予測しない。
- 政治上の対立では、確認できる事実と各当事者の主張を分ける。
- sourceCountは入力のcoverage_countを使い、盛らない。
- 1カテゴリ最大3件。
- 出典は入力に存在するURLのみ使う。
- 日本語で簡潔に。

次のJSONだけを返す。Markdownは禁止。
{{
  "headline": "3分で今日を把握",
  "overview": "全体を2文以内で",
  "topics": [
    {{
      "id": "英数字とハイフンの一意ID",
      "category": "entertainment|politics|economy|internet",
      "title": "話題の見出し",
      "whatHappened": "2〜4文",
      "whyTrending": "なぜ話題か。入力だけで不明ならその旨を書く",
      "context": "背景。推測しない",
      "points": ["最大3点"],
      "sourceCount": 1,
      "sources": [{{"name":"媒体名","title":"元見出し","url":"URL","publishedAt":"ISO8601またはnull"}}],
      "caution": "未確認情報や注意点。なければ空文字"
    }}
  ]
}}

入力:
{json.dumps(raw, ensure_ascii=False)}
""".strip()

def call_openai(prompt: str) -> dict:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set")
    from openai import OpenAI
    client = OpenAI(api_key=api_key)
    response = client.responses.create(model=MODEL, input=prompt)
    text = response.output_text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.S)
    return json.loads(text)

def stable_id(url: str, index: int) -> str:
    return hashlib.sha1(f"{url}-{index}".encode()).hexdigest()[:12]

def normalize(result: dict, edition: str) -> dict:
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    topics = []
    for t_index, topic in enumerate(result.get("topics", [])):
        sources = []
        for s_index, source in enumerate(topic.get("sources", [])):
            url = str(source.get("url", ""))
            if not url.startswith("http"):
                continue
            sources.append({
                "id": stable_id(url, s_index),
                "name": str(source.get("name", "情報源"))[:80],
                "title": str(source.get("title", "元記事"))[:240],
                "url": url,
                "publishedAt": source.get("publishedAt"),
            })
        category = topic.get("category")
        if category not in FEEDS:
            continue
        topics.append({
            "id": re.sub(r"[^a-zA-Z0-9-]", "-", str(topic.get("id") or f"topic-{t_index}"))[:80],
            "category": category,
            "title": str(topic.get("title", ""))[:180],
            "whatHappened": str(topic.get("whatHappened", ""))[:1000],
            "whyTrending": str(topic.get("whyTrending", ""))[:700],
            "context": str(topic.get("context", ""))[:1000],
            "points": [str(x)[:300] for x in topic.get("points", [])[:3]],
            "sourceCount": max(1, int(topic.get("sourceCount") or len({s["name"] for s in sources}) or 1)),
            "sources": sources[:8],
            "caution": str(topic.get("caution", ""))[:500] or None,
        })
    return {
        "generatedAt": now.isoformat().replace("+00:00", "Z"),
        "edition": edition,
        "headline": str(result.get("headline") or "3分で今日を把握")[:80],
        "overview": str(result.get("overview") or "")[:700],
        "isSample": False,
        "topics": topics,
    }

def main() -> None:
    now_jst = dt.datetime.now(JST)
    edition = "朝刊" if now_jst.hour < 12 else "夜刊"
    raw = source_payload(collect())
    result = call_openai(build_prompt(raw, edition))
    digest = normalize(result, edition)
    OUT.write_text(json.dumps(digest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT} ({len(digest['topics'])} topics)")

if __name__ == "__main__":
    main()
