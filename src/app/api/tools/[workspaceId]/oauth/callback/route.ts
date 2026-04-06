import { NextRequest, NextResponse } from "next/server"

/**
 * Browser popup lands here after Composio OAuth. Notifies opener and closes.
 */
export async function GET(_request: NextRequest) {
  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Connecting…</title>
  </head>
  <body>
    <p style="font-family:system-ui,sans-serif;font-size:14px;padding:16px;">Connection complete. You can close this window.</p>
    <script>
      (function () {
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage({ type: "composio-oauth-complete" }, window.location.origin);
          }
        } catch (e) {}
        window.close();
      })();
    </script>
  </body>
</html>`

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
}
