// Usage:
//   npm i playwright
//   node jd_playwright_smoke.mjs "拉面"

import fs from "node:fs";
import { chromium } from "playwright";

const keyword = process.argv.slice(2).join(" ").trim() || "拉面";
const url = `https://search.jd.com/Search?keyword=${encodeURIComponent(keyword)}&enc=utf-8`;

const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
        userAgent: UA,
        locale: "zh-CN",
        extraHTTPHeaders: {
            "accept-language": "zh-CN,zh;q=0.9,en;q=0.8,ja;q=0.7",
            referer: "https://www.jd.com/",
        },
    });

    console.log("Goto:", url);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

    console.log("Final URL:", page.url());

    // 保存して目視できるように
    const html = await page.content();
    fs.writeFileSync("jd_pw_debug.html", html);
    console.log("Saved: jd_pw_debug.html");

    // 検索結果DOMを待つ（出なければ失敗扱い）
    const ok = await page
        .waitForSelector("#J_goodsList li.gl-item", { timeout: 15000 })
        .then(() => true)
        .catch(() => false);

    if (!ok) {
        console.log("❌ No goods list found. Possibly redirected/blocked/DOM changed.");
        await browser.close();
        process.exit(0);
    }

    const items = await page.$$eval("#J_goodsList li.gl-item", (els) =>
        els.slice(0, 5).map((el) => {
            const sku = el.getAttribute("data-sku") || "";
            const title = (el.querySelector(".p-name em")?.textContent || "")
                .replace(/\s+/g, " ")
                .trim();
            let href = el.querySelector(".p-name a")?.getAttribute("href") || "";
            if (href.startsWith("//")) href = "https:" + href;
            return { sku, title, href };
        })
    );

    console.log("✅ Extracted:", items.length);
    console.log(JSON.stringify(items, null, 2));

    await browser.close();
})();
