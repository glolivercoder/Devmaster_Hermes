#!/usr/bin/env python3
"""Hermes Researcher — worker de scraping anti-detecção.

Tools suportadas (instale via pip conforme necessário):
  curl_cffi      (padrão, já presente) — falsifica TLS/JA3/HTTP2 fingerprint
                 de navegadores reais (Chrome/Firefox/Safari) sem abrir browser.
                 Passa por Cloudflare/Akamai em many cases; ideal para LinkedIn,
                 GitHub e APIs internas que barram Python/Node com 403.
  seleniumbase  (opcional) — UC Mode (Undetected-Chromium) para páginas que
                 exigem login/cliques/rolagem real. Requer: pip install seleniumbase
  botasaurus    (opcional) — framework all-in-one anti-bot. Requer: pip install botasaurus

Saída: JSON único em stdout.
"""
import argparse
import json
import re
import sys
from html.parser import HTMLParser

# Windows: stdout do worker usa cp1252 por padrão — força UTF-8 para o JSON
# conter acentos/símbolos (→, ç, etc.) sem UnicodeEncodeError.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


class TextExtractor(HTMLParser):
    """Extrai título, texto legível e links — stdlib, sem dependências."""

    SKIP = {"script", "style", "noscript", "svg", "iframe", "canvas", "template"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.title = ""
        self.links: list[str] = []
        self._skip = 0
        self._intitle = False

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self._skip += 1
        if tag == "title":
            self._intitle = True
        if tag == "a":
            href = dict(attrs).get("href")
            if href:
                self.links.append(href)
        if tag in ("p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4",
                   "section", "article", "header", "footer"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self.SKIP and self._skip > 0:
            self._skip -= 1
        if tag == "title":
            self._intitle = False

    def handle_data(self, data):
        if self._intitle:
            self.title += data.strip()
        if self._skip == 0 and data.strip():
            self.parts.append(data)


def extract(html: str) -> tuple[str, str, list[str]]:
    p = TextExtractor()
    try:
        p.feed(html)
    except Exception:
        pass
    text = re.sub(r"[ \t]+", " ", "".join(p.parts))
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return p.title.strip(), text, p.links[:30]


def fetch_curl_cffi(url: str, impersonate: str, timeout: int) -> str:
    from curl_cffi import requests as cffi_requests

    r = cffi_requests.get(
        url,
        impersonate=impersonate,  # ex.: "chrome131", "firefox133", "safari17_0"
        timeout=timeout,
        allow_redirects=True,
        headers={
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9,pt-BR;q=0.8",
        },
    )
    if r.status_code >= 400:
        raise RuntimeError(f"HTTP {r.status_code} vindo de {url}")
    return r.text


def fetch_seleniumbase(url: str, timeout: int) -> str:
    try:
        from seleniumbase import SB  # type: ignore
    except ImportError as e:
        raise RuntimeError(
            "seleniumbase não instalado — `pip install seleniumbase` "
            "(requer Chrome no host). Use --tool curl_cffi como alternativa leve."
        ) from e
    with SB(uc=True, test=True, headless=True) as sb:
        sb.uc_open_with_reconnect(url, reconnect_time=min(timeout, 15))
        try:
            sb.sleep(2)
        except Exception:
            pass
        return sb.get_page_source()


def fetch_botasaurus(url: str, timeout: int) -> str:
    try:
        from botasaurus import headless_visit  # type: ignore
    except ImportError as e:
        raise RuntimeError(
            "botasaurus não instalado — `pip install botasaurus`. "
            "Alternativa já funcional: --tool seleniumbase."
        ) from e
    result = headless_visit(url)
    if isinstance(result, str):
        return result
    if isinstance(result, dict):
        return str(result.get("page_source") or result.get("html") or result)
    return str(result)


def main() -> int:
    ap = argparse.ArgumentParser(description="Hermes Researcher scraper")
    ap.add_argument("--url", required=True)
    ap.add_argument("--tool", default="curl_cffi",
                    choices=["curl_cffi", "seleniumbase", "botasaurus"])
    ap.add_argument("--impersonate", default="chrome131",
                    help="perfil de fingerprint TLS (curl_cffi): chrome131, firefox133, safari17_0...")
    ap.add_argument("--max-chars", type=int, default=24000)
    ap.add_argument("--timeout", type=int, default=30)
    args = ap.parse_args()

    if not re.match(r"^https?://", args.url, re.I):
        print(json.dumps({"ok": False, "error": "URL deve começar com http:// ou https://"}))
        return 2

    try:
        if args.tool == "curl_cffi":
            html = fetch_curl_cffi(args.url, args.impersonate, args.timeout)
        elif args.tool == "seleniumbase":
            html = fetch_seleniumbase(args.url, args.timeout)
        else:
            html = fetch_botasaurus(args.url, args.timeout)
        title, text, links = extract(html)
        print(json.dumps({
            "ok": True,
            "tool": args.tool,
            "url": args.url,
            "title": title[:300],
            "chars": len(text),
            "truncated": len(text) > args.max_chars,
            "text": text[: args.max_chars],
            "links": links,
        }, ensure_ascii=False))
        return 0
    except Exception as e:  # noqa: BLE001 — worker: qualquer erro vira JSON
        print(json.dumps({"ok": False, "tool": args.tool, "url": args.url,
                          "error": f"{type(e).__name__}: {e}"}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    sys.exit(main())
