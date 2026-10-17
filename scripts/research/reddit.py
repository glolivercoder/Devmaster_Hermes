#!/usr/bin/env python3
"""Hermes — coletor de posts do Reddit via curl_cffi.

O Reddit bloqueia clientes Python/Node padrão (403/429) analisando o
fingerprint TLS. O curl_cffi (já presente) impersona Chrome real e passa.

Saída JSON: {"ok":true,"posts":[{title,subreddit,score,numComments,url,excerpt}]}
"""
import argparse
import json
import sys
from urllib.parse import quote_plus

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def fetch_json(url: str, timeout: int):
    from curl_cffi import requests as cffi_requests

    r = cffi_requests.get(
        url,
        impersonate="chrome131",
        timeout=timeout,
        headers={
            "Accept": "application/json",
            "Accept-Language": "en-US,en;q=0.9,pt-BR;q=0.8",
        },
        allow_redirects=True,
    )
    if r.status_code >= 400:
        raise RuntimeError(f"HTTP {r.status_code}")
    return r.json()


def main() -> int:
    ap = argparse.ArgumentParser(description="Hermes Reddit collector (curl_cffi)")
    ap.add_argument("--query", required=True)
    ap.add_argument("--limit", type=int, default=25)
    ap.add_argument("--subreddit", default=None)
    ap.add_argument("--timeout", type=int, default=30)
    a = ap.parse_args()

    q = quote_plus(a.query)
    if a.subreddit:
        urls = [f"https://www.reddit.com/r/{a.subreddit}/search.json"
                f"?q={q}&restrict_sr=1&sort=relevance&limit={a.limit}&raw_json=1"]
    else:
        urls = [
            f"https://www.reddit.com/search.json?q={q}&sort=relevance&limit={a.limit}&raw_json=1",
            f"https://old.reddit.com/search.json?q={q}&sort=relevance&limit={a.limit}&raw_json=1",
        ]

    posts = []
    last_err = ""
    for u in urls:
        try:
            d = fetch_json(u, a.timeout)
            for child in d.get("data", {}).get("children", []):
                p = child.get("data", {})
                posts.append({
                    "title": p.get("title", ""),
                    "subreddit": p.get("subreddit", ""),
                    "score": p.get("score", 0),
                    "numComments": p.get("num_comments", 0),
                    "url": "https://www.reddit.com" + p.get("permalink", ""),
                    "excerpt": (p.get("selftext", "") or "")[:500],
                    "upvoteRatio": p.get("upvote_ratio"),
                })
            if posts:
                break
        except Exception as e:  # tenta o próximo mirror
            last_err = f"{type(e).__name__}: {e}"

    print(json.dumps({
        "ok": bool(posts),
        "posts": posts[: a.limit],
        "error": None if posts else (last_err or "sem resultados"),
    }, ensure_ascii=False))
    return 0 if posts else 1


if __name__ == "__main__":
    sys.exit(main())
