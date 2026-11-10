import { expect, test } from "@playwright/test"

test("self-host store Install lands on setup step 1 with zero 4xx", async ({ page }) => {
  const failures: string[] = []
  page.on("response", (res) => {
    const url = res.url()
    if (url.includes("favicon") || url.includes("/_next/")) return
    if (res.status() >= 400) failures.push(`${res.status()} ${url}`)
  })

  await page.goto("/api/auth/test-session?redirect=/store/twitter-growth-machine")
  await page.waitForURL("**/store/twitter-growth-machine")

  const search = await page.request.get("/api/marketplace/templates?search=twitter")
  const searchText = await search.text()
  expect(search.status(), searchText).toBe(200)
  expect(searchText.toLowerCase()).toContain("twitter-growth-machine")

  const install = page.getByTestId("self-host-install")
  try {
    await install.click({ timeout: 20_000 })
  } catch (err) {
    const text = (await page.locator("body").innerText()).slice(0, 1800)
    throw new Error(`${(err as Error).message}\nPAGE:\n${text}\n4xx:\n${failures.join("\n")}`)
  }

  await page.waitForURL(/\/setup\/[^/]+\/step\/1/)
  expect(failures).toEqual([])
})
