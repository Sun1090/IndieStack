import { expect, test } from "@playwright/test";

const publicPages = [
  { path: "/", name: "home" },
  { path: "/features", name: "features" },
  { path: "/pricing", name: "pricing" },
  { path: "/auth/login", name: "login" },
] as const;

test.describe("public page visual baselines", () => {
  for (const pageInfo of publicPages) {
    test(`${pageInfo.name} matches the Linux baseline`, async ({ page }) => {
      const response = await page.goto(pageInfo.path, { waitUntil: "networkidle" });
      expect(response?.status()).toBe(200);

      // Screenshot options temporarily mutate focused elements (for example, the
      // caret color). Wait until React has hydrated before taking that snapshot.
      await page.waitForFunction(() =>
        Object.keys(document.body).some((key) => key.startsWith("__reactFiber$")),
      );
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      await page.addStyleTag({
        content: `
          *, *::before, *::after {
            animation-duration: 0s !important;
            animation-delay: 0s !important;
            transition: none !important;
          }
        `,
      });

      await expect(page).toHaveScreenshot(`${pageInfo.name}.png`, {
        fullPage: true,
        mask: [page.locator("footer p").filter({ hasText: "©" })],
        maskColor: "#ffffff",
      });
    });
  }
});
