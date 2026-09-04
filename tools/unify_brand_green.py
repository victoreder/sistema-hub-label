#!/usr/bin/env python3
"""Substitui verdes 'Tailwind/emerald' por #25d366 / rgba(37,211,102) nos HTML.
Linhas que parecem sucesso explícito, switch/toggle ativo ou feedback de
'deu certo' (senha forte, cópia, KPI success) são ignoradas."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

SKIP_SUBSTRINGS = (
    "theme-switch",
    "toast-notification.success",
    "toast-notification.success::before",
    "message.success",
    "modal .message.success",
    "config-message.success",
    "success-message",
    "actions-item.success",
    "kpi-card-icon.success",
    "kpi-card-number.success",
    "integ-pag-teste-dot.verde",
    "fa-check-circle",
    "accent-color:",
    "clientes-checkbox:checked",
    "editar-status-dot",
    "criar-status-dot",
    "status-dot",
    "dot.style.background",
    "dotEd.style",
    "sync-groups-message.success",
    "slider-switch",
    "stat-change.positive",
    "strength-strong",
    "strengthColor",
    "modal-webhook-btn-copy.copied",
    "pill-enviado",
    "previsao-finaliz",
    "is-finalizado",
    "success::before",
    "success::after",
)


def should_skip(line: str) -> bool:
    if "json.success" in line or "evolutionJson.success" in line:
        return False
    for s in SKIP_SUBSTRINGS:
        if s in line:
            return True
    return False


def transform_line(line: str) -> str:
    if should_skip(line):
        return line
    out = line
    out = re.sub(
        r"rgba\(\s*34\s*,\s*197\s*,\s*94\s*,",
        "rgba(37, 211, 102,",
        out,
        flags=re.IGNORECASE,
    )
    out = re.sub(
        r"rgba\(\s*52\s*,\s*211\s*,\s*153\s*,",
        "rgba(37, 211, 102,",
        out,
        flags=re.IGNORECASE,
    )
    for old, new in (
        ("#22c55e", "#25d366"),
        ("#1da851", "#25d366"),
        ("#15803d", "#25d366"),
        ("#16a34a", "#25d366"),
        ("#4ade80", "#25d366"),
        ("#6ee7b7", "#25d366"),
        ("#34d399", "#25d366"),
        ("#10b981", "#25d366"),
        ("#86efac", "#25d366"),
    ):
        out = out.replace(old, new)
    return out


def main() -> None:
    html_files = sorted(
        p for p in ROOT.glob("*.html") if p.is_file() and "node_modules" not in str(p)
    )
    changed = 0
    for path in html_files:
        text = path.read_text(encoding="utf-8")
        lines = text.splitlines(keepends=True)
        new_lines = [transform_line(line) for line in lines]
        new_text = "".join(new_lines)
        if new_text != text:
            path.write_text(new_text, encoding="utf-8")
            changed += 1
            print(path.name)
    print(f"OK: {changed} arquivo(s) alterado(s).")


if __name__ == "__main__":
    main()
