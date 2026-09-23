"""
Page loads wait for streamed pages to finish arriving.

Pages that fetch from the server stream in over a loading skeleton
(src/app/loading.tsx, marked `aria-busy`). Playwright's "load" can fire while
the skeleton is still what the body holds, and a suite that reads the page at
that moment reads the skeleton and reports a missing feature. Importing this
module makes every `page.goto` and `page.wait_for_url` also wait until no busy
<main> is left.

It waits, and never fails on its own: a page that never settles is caught by
whatever the suite checks next.
"""

from playwright.sync_api import Page

_original_goto = Page.goto


def _goto(self, url, **kwargs):
    response = _original_goto(self, url, **kwargs)
    try:
        self.wait_for_function(
            "() => !document.querySelector('main[aria-busy=\"true\"]')", timeout=15_000
        )
    except Exception:
        pass
    return response


Page.goto = _goto

# In-app navigation (a form that pushes to a new page) is waited on with
# wait_for_url, which returns the moment the address changes — while the
# skeleton is still what the page shows. Same wait, same reason.
_original_wait_for_url = Page.wait_for_url


def _wait_for_url(self, url, **kwargs):
    result = _original_wait_for_url(self, url, **kwargs)
    try:
        self.wait_for_function(
            "() => !document.querySelector('main[aria-busy=\"true\"]')", timeout=15_000
        )
    except Exception:
        pass
    return result


Page.wait_for_url = _wait_for_url
