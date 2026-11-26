"""Read-only UI/API smoke test for the HPC portal.

Usage:
  python tests/ui_smoke.py [base_url]
Requires Playwright + Edge/Chromium. Logs in via Dex if redirected.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://192.168.112.230:8080/"
USER = "linya"
PASSWORD = "Admin@12345"

ROUTES = [
    "entrance", "dashboard", "catalog", "jobs", "monitor", "gpus",
    "alerts", "rules", "usage", "users", "audit", "system",
]

GENERIC = "该操作尚未接入当前集群，未执行"


def login(page) -> None:
    page.goto(BASE, wait_until="domcontentloaded")
    page.wait_for_timeout(500)
    if "/dex/auth" in page.url or page.locator('input[name="login"]').count():
        page.fill('input[name="login"]', USER)
        page.fill('input[name="password"]', PASSWORD)
        page.locator('button[type="submit"]').first.click()
        page.wait_for_timeout(2000)
        if "/approval" in page.url:
            page.locator('button[type="submit"]').first.click()
            page.wait_for_timeout(1500)
    page.wait_for_timeout(800)


def main() -> int:
    report = {"routes": {}, "api": {}, "errors": []}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="msedge", headless=True)
        context = browser.new_context(viewport={"width": 1600, "height": 1000})
        page = context.new_page()
        console_errors: list[str] = []
        page.on("pageerror", lambda e: console_errors.append(str(e)))
        login(page)
        report["logged_in_url"] = page.url

        for route in ROUTES:
            console_errors.clear()
            page.goto(f"{BASE.rstrip('/')}/#/{route}", wait_until="domcontentloaded")
            page.wait_for_timeout(900)
            body = page.locator("body").inner_text()
            actions = page.eval_on_selector_all(
                "[data-action]", "els => els.map(e => ({action:e.dataset.action,text:(e.innerText||'').trim().slice(0,40),id:e.dataset.id||''}))"
            )
            links = page.eval_on_selector_all(
                "[data-goto]", "els => els.map(e => (e.dataset.goto||'').slice(0,80))"
            )
            report["routes"][route] = {
                "url": page.url,
                "actions": actions,
                "goto": sorted(set(links)),
                "console_errors": list(console_errors),
                "generic_toast": GENERIC in body,
                "loading_stuck": body.strip() == "Loading",
            }

        # Safe action checks: open/close drawers and modals.
        checks = [
            ("settings", BASE + "#/dashboard", "#userMenu", '[data-action="settings"]', "#drawer"),
            ("token-info", BASE + "#/dashboard", "#userMenu", '[data-action="token-info"]', "#drawer"),
            ("shortcuts", BASE + "#/dashboard", "#userMenu", '[data-action="shortcuts"]', "#modalOverlay"),
            ("runbook", BASE + "#/system", None, '[data-action="runbook"]', "#drawer"),
        ]
        for name, url, menu, selector, overlay in checks:
            page.goto(url, wait_until="domcontentloaded")
            page.wait_for_timeout(600)
            try:
                if menu:
                    page.locator(menu).click()
                    page.wait_for_timeout(150)
                page.locator(selector).first.click()
                page.wait_for_timeout(500)
                report["routes"].setdefault("_safe_actions", {})[name] = {
                    "visible": page.locator(overlay).first.is_visible(),
                    "generic_toast": GENERIC in page.locator("body").inner_text(),
                }
                page.keyboard.press("Escape")
                page.wait_for_timeout(150)
            except Exception as exc:  # noqa: BLE001
                report["errors"].append(f"{name}: {exc}")

        # API smoke inside the authenticated browser session.
        endpoints = [
            "/api/v1/me", "/api/v1/cluster", "/api/v1/catalog", "/api/v1/nodes",
            "/api/v1/gpus", "/api/v1/jobs", "/api/v1/alerts", "/api/v1/usage",
            "/api/v1/users", "/api/v1/audit", "/api/v1/audit/verify",
            "/api/v1/system/status", "/api/v1/system/ip-status", "/api/v1/sync/status",
            "/api/v1/rules", "/api/v1/trend?range=24h",
        ]
        for endpoint in endpoints:
            result = page.evaluate(
                """async (u) => {
                    const r = await fetch(u, {cache:'no-store', credentials:'same-origin'});
                    let body = null; try { body = await r.json(); } catch (e) {}
                    return {status:r.status, code:body && body.code, keys:body && body.data ? Object.keys(body.data) : []};
                }""",
                endpoint,
            )
            report["api"][endpoint] = result

        report["errors"].extend(console_errors)
        browser.close()

    out = Path("tests") / "ui_smoke_report.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: report[k] for k in ("logged_in_url", "api", "errors")}, ensure_ascii=False, indent=2))
    for route, data in report["routes"].items():
        print(route, "generic_toast=", data.get("generic_toast"), "console=", data.get("console_errors"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
