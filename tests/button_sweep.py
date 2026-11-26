"""Click every safe action on every route, detecting JS errors and placeholder toasts."""
from __future__ import annotations

import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://192.168.112.230:8080/"
USER = "linya"
PASSWORD = "Admin@12345"
ROUTES = ["entrance", "dashboard", "catalog", "jobs", "monitor", "gpus", "alerts", "rules", "usage", "users", "audit", "system"]
DESTRUCTIVE = {"logout", "cancel-job", "ack-alert", "toggle-rule", "export", "submit-job"}
GENERIC = "该操作尚未接入当前集群，未执行"


def login(page):
    page.goto(BASE, wait_until="domcontentloaded")
    page.wait_for_timeout(400)
    if "/dex/auth" in page.url:
        page.fill('input[name="login"]', USER)
        page.fill('input[name="password"]', PASSWORD)
        page.locator('button[type="submit"]').first.click()
        page.wait_for_timeout(1800)
    page.wait_for_timeout(500)


def main() -> int:
    report = {"checks": [], "errors": []}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="msedge", headless=True)
        context = browser.new_context(viewport={"width": 1600, "height": 1000}, accept_downloads=True)
        page = context.new_page()
        page_errors: list[str] = []
        page.on("pageerror", lambda e: page_errors.append(str(e)))
        login(page)

        for route in ROUTES:
            page.goto(BASE + "#/" + route, wait_until="domcontentloaded")
            page.wait_for_timeout(900)
            actions = page.eval_on_selector_all(
                "[data-action]", "els => [...new Set(els.map(e => e.dataset.action))]"
            )
            for action in actions:
                if action in DESTRUCTIVE:
                    continue
                page_errors.clear()
                page.goto(BASE + "#/" + route, wait_until="domcontentloaded")
                page.wait_for_timeout(700)
                loc = page.locator(f'[data-action="{action}"]').first
                if loc.count() == 0:
                    report["checks"].append({"route": route, "action": action, "result": "missing"})
                    continue
                try:
                    if not loc.is_visible() and action in {"settings", "token-info", "theme", "shortcuts"}:
                        page.locator("#userMenu").click()
                        page.wait_for_timeout(180)
                        loc = page.locator(f'[data-action="{action}"]').first
                    loc.click(timeout=3000)
                    page.wait_for_timeout(600)
                    body = page.locator("body").inner_text()
                    overlay = (
                        page.locator("#drawer.open").count() > 0
                        or page.locator("#modalOverlay:not([hidden])").count() > 0
                        or page.locator("#paletteOverlay:not([hidden])").count() > 0
                    )
                    result = {
                        "route": route,
                        "action": action,
                        "url": page.url,
                        "generic_toast": GENERIC in body,
                        "overlay": overlay,
                        "page_errors": list(page_errors),
                        "toasts": page.locator(".toast").all_inner_texts()[-3:],
                    }
                    report["checks"].append(result)
                    page.keyboard.press("Escape")
                    page.wait_for_timeout(100)
                except Exception as exc:  # noqa: BLE001
                    report["checks"].append({"route": route, "action": action, "result": f"click failed: {exc}"})

        report["errors"] = list(page_errors)
        browser.close()

    Path("tests/button_sweep_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    bad = [c for c in report["checks"] if isinstance(c, dict) and (
        c.get("generic_toast") or c.get("page_errors") or str(c.get("result", "")).startswith("click failed")
    )]
    print("checks", len(report["checks"]), "bad", len(bad))
    for c in bad:
        print(json.dumps(c, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
