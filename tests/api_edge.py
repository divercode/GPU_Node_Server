"""API boundary/security tests for the HPC portal.

Requires a logged-in admin via Playwright (Dex credentials).
"""
from __future__ import annotations

import json
import sys

from playwright.sync_api import sync_playwright

BASE = "http://192.168.112.230:8080/"
ADMIN = ("linya", "Admin@12345")
NORMAL = ("hpcuser", "Admin@12345")


def login(page, username, password):
    page.goto(BASE, wait_until="domcontentloaded")
    page.wait_for_timeout(400)
    if "/dex/auth" in page.url:
        page.fill('input[name="login"]', username)
        page.fill('input[name="password"]', password)
        page.locator('button[type="submit"]').first.click()
        page.wait_for_timeout(1800)


def call(page, method, path, body=None, csrf=True):
    return page.evaluate(
        """async ({method, path, body, csrf}) => {
            const headers = {'X-Requested-With':'XMLHttpRequest'};
            if (body !== null) headers['Content-Type'] = 'application/json';
            if (csrf) headers['X-CSRF-Token'] = window.__CSRF || '';
            const r = await fetch(path, {
                method, headers, credentials: 'same-origin',
                body: body === null ? undefined : JSON.stringify(body)
            });
            return {status:r.status, text:await r.text(), ct:r.headers.get('content-type')};
        }""",
        {"method": method, "path": path, "body": body, "csrf": csrf},
    )


def main() -> int:
    failures = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="msedge", headless=True)
        page = browser.new_page()
        login(page, *ADMIN)

        checks = []
        checks.append(("trend_bad_range", call(page, "GET", "/api/v1/trend?range=bad"), 400, "INVALID_RANGE"))
        checks.append(("unknown_api", call(page, "GET", "/api/v1/not-exist"), 404, "NOT_FOUND"))
        checks.append(("job_without_csrf", call(page, "POST", "/api/v1/jobs",
                     {"name": "x", "partition": "gpu", "gpus": 1, "time": "1h", "command": "sleep 1"}, csrf=False), 403, "FORBIDDEN"))
        checks.append(("job_gpus_zero", call(page, "POST", "/api/v1/jobs",
                     {"name": "x", "partition": "gpu", "gpus": 0, "time": "1h", "command": "sleep 1"}), 400, "INVALID_GPU_COUNT"))
        checks.append(("job_gpus_nine", call(page, "POST", "/api/v1/jobs",
                     {"name": "x", "partition": "gpu", "gpus": 9, "time": "1h", "command": "sleep 1"}), 400, "INVALID_GPU_COUNT"))
        checks.append(("cancel_missing", call(page, "POST", "/api/v1/jobs/999999/cancel"), 404, "NOT_FOUND"))
        trend = call(page, "GET", "/api/v1/trend?range=24h")
        checks.append(("trend_24h", trend, 200, "OK"))

        for name, response, expected_status, expected_code in checks:
            ok = response["status"] == expected_status and expected_code in response["text"]
            if not ok:
                failures.append(f"{name}: status={response['status']} body={response['text'][:160]}")
            print(("PASS " if ok else "FAIL ") + name + f" -> {response['status']}")

        # Normal user must be denied admin endpoints.
        page2 = browser.new_page()
        login(page2, *NORMAL)
        for endpoint in ("/api/v1/users", "/api/v1/rules", "/api/v1/system/status"):
            response = call(page2, "GET", endpoint)
            ok = response["status"] == 403
            if not ok:
                failures.append(f"rbac {endpoint}: status={response['status']}")
            print(("PASS " if ok else "FAIL ") + f"rbac {endpoint} -> {response['status']}")
        browser.close()

    print(json.dumps({"failures": failures}, ensure_ascii=False, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
