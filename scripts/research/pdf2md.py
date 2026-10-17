#!/usr/bin/env python3
"""Hermes — Camada 1: PDF → Markdown econômico em tokens.

Usa MarkItDown (MIT, Microsoft) para converter PDF (e DOCX/PPTX/XLSX/HTML/EML)
em Markdown limpo, eliminando o ruído de layout/fonte/espaçamento que infla o
custo de tokens quando se manda um PDF bruto a um LLM.

Saída: JSON único em stdout (UTF-8).
  {"ok":true,"md":"...","chars":N,"tokensEstimate":N,"source":"..."}
"""
import argparse
import json
import os
import re
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def estimate_tokens(text: str) -> int:
    """Heurística ~1 token por 4 chars (inglês) / ~2.5 chars (pt com acentos)."""
    return max(1, int(len(text) / 3.7))


def convert(path: str) -> str:
    from markitdown import MarkItDown  # import tardio: só se realmente usar

    md = MarkItDown(enable_plugins=False)
    result = md.convert(path)
    if result is None or not getattr(result, "text_content", None):
        raise RuntimeError("MarkItDown retornou conteúdo vazio")
    return result.text_content


def convert_url(url: str, timeout: int) -> str:
    from markitdown import MarkItDown

    md = MarkItDown(enable_plugins=False)
    result = md.convert(url, timeout=timeout)
    if result is None or not getattr(result, "text_content", None):
        raise RuntimeError("MarkItDown retornou conteúdo vazio (URL)")
    return result.text_content


def clean_md(md: str) -> str:
    """Remove artefatos típicos de PDF→MD que desperdiçam tokens."""
    md = re.sub(r"\n{3,}", "\n\n", md)        # colapsa linhas em branco extras
    md = re.sub(r"[ \t]{2,}", " ", md)         # espaços duplos
    md = re.sub(r"^\s*\d+\s*$", "", md, flags=re.M)  # números de página soltos
    return md.strip()


def main() -> int:
    ap = argparse.ArgumentParser(description="Hermes PDF→Markdown (MarkItDown)")
    ap.add_argument("--file", help="caminho local do documento")
    ap.add_argument("--url", help="URL do documento")
    ap.add_argument("--max-chars", type=int, default=200_000,
                    help="teto de caracteres no markdown de saída")
    ap.add_argument("--timeout", type=int, default=45)
    args = ap.parse_args()

    if not args.file and not args.url:
        print(json.dumps({"ok": False, "error": "--file ou --url obrigatório"}))
        return 2

    try:
        if args.file:
            if not os.path.isfile(args.file):
                print(json.dumps({"ok": False, "error": f"arquivo não encontrado: {args.file}"}))
                return 2
            raw = convert(args.file)
            source = args.file
        else:
            if not re.match(r"^https?://", args.url, re.I):
                print(json.dumps({"ok": False, "error": "URL deve começar com http(s)://"}))
                return 2
            raw = convert_url(args.url, args.timeout)
            source = args.url

        md = clean_md(raw)
        truncated = len(md) > args.max_chars
        md = md[: args.max_chars]

        print(json.dumps({
            "ok": True,
            "source": source,
            "chars": len(md),
            "tokensEstimate": estimate_tokens(md),
            "truncated": truncated,
            "md": md,
        }, ensure_ascii=False))
        return 0
    except Exception as e:  # noqa: BLE001 — worker: qualquer erro vira JSON
        print(json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"},
                         ensure_ascii=False))
        return 1


if __name__ == "__main__":
    sys.exit(main())
