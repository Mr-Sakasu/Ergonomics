/**
 * test.js v4 — JD scraping smoke test (manual verification/login allowed)
 *
 * Fix:
 * - Detect JD "访问频率导致无法搜索" / rate limit block (no cards appear).
 * - Playwright evaluate: only ONE argument allowed -> pass object.
 *
 * Usage:
 *   node test.js "笔记本电脑 2000元以下 轻薄" --headless=0
 *
 * Output:
 * - If blocked by rate limit, prints reason and saves jd_debug.(png|html)
 * - If cards appear, extracts items.
 */

const JD_BLOCK_RE = /验证|安全验证|captcha|访问过于频繁|访问频繁|无法搜索|请稍后再试|点此反馈|购物无忧|risk_handler|请登录|前往登录/i;
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const NEW_CARD_SEL =
    '[data-sku][class*="plugin_goodsCardWrapper"],[data-sku][class*="goodsCardWrapper"]';
const OLD_CARD_SEL = "#J_goodsList li.gl-item";

function argValue(name, def = null) {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    if (!hit) return def;
    return hit.split("=").slice(1).join("=") || def;
}

function buildJdSearchUrl(q) {
    return `https://search.jd.com/Search?keyword=${encodeURIComponent(q)}&enc=utf-8`;
}

function isRiskOrLoginUrl(u = "") {
    const s = String(u || "");
    return (
        s.includes("cfe.m.jd.com/privatedomain/risk_handler") ||
        s.includes("passport.jd.com") ||
        s.includes("plogin") ||
        s.includes("login.jd.com")
    );
}

function parseReturnUrl(u = "") {
    try {
        const url = new URL(u);
        const ret = url.searchParams.get("returnurl") || url.searchParams.get("ReturnUrl");
        if (!ret) return "";
        return decodeURIComponent(ret);
    } catch {
        return "";
    }
}

async function promptEnter(msg) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise((resolve) => rl.question(msg, () => resolve()));
    rl.close();
}

async function saveDebug(page, tag = "jd_debug") {
    const png = path.join(process.cwd(), `${tag}.png`);
    const html = path.join(process.cwd(), `${tag}.html`);
    await page.screenshot({ path: png, fullPage: true }).catch(() => { });
    const content = await page.content().catch(() => "");
    fs.writeFileSync(html, content || "", "utf-8");
    console.log("[test] Saved:", png);
    console.log("[test] Saved:", html);
}

async function waitForResults(page, timeoutMs = 45000) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        const st = await page.evaluate((arg) => {
            const { newSel, oldSel } = arg;

            const url = location.href;
            const bodyText = (document.body?.innerText || "").slice(0, 6000);

            const newCount = document.querySelectorAll(newSel).length;
            const oldCount = document.querySelectorAll(oldSel).length;
            const total = newCount + oldCount;

            // IMPORTANT: JD rate-limit / risk / login messages that show NO product list
            const isRateLimited =
                /访问频率|无法搜索|请稍后再试|点此反馈/i.test(bodyText);

            const isRisk =
                /risk_handler|购物无忧/i.test(url) ||
                /验证一下|购物无忧/i.test(bodyText);

            const isLogin =
                /passport\.jd\.com|plogin|login\.jd\.com/i.test(url) ||
                /前往登录|请登录/i.test(bodyText);

            const blocked = (isRateLimited || isRisk || isLogin) && total === 0;

            return {
                url,
                newCount,
                oldCount,
                blocked,
                reason: isRateLimited ? "rate_limited" : isRisk ? "risk_handler" : isLogin ? "login_required" : "",
                sample: bodyText.slice(0, 260),
            };
        }, { newSel: NEW_CARD_SEL, oldSel: OLD_CARD_SEL });

        if (st.blocked) return { ok: false, blocked: true, ...st };
        if (st.newCount > 0 || st.oldCount > 0) return { ok: true, blocked: false, ...st };

        await page.waitForTimeout(500);
    }

    return { ok: false, blocked: false, url: page.url(), newCount: 0, oldCount: 0, reason: "", sample: "" };
}

async function main() {
    const query = (process.argv[2] || "笔记本电脑 2000元以下 轻薄").trim();
    const limit = Number(argValue("limit", "6")) || 6;
    const headless = String(argValue("headless", "0")) !== "0"; // default: headful
    const timeoutMs = Number(argValue("timeout", "45000")) || 45000;

    let chromium;
    try {
        ({ chromium } = require("playwright"));
    } catch {
        console.error("[test] Playwright not found. Run: npm i playwright && npx playwright install chromium");
        process.exit(1);
    }

    const userDataDir = path.join(process.cwd(), ".pw-jd-profile");
    fs.mkdirSync(userDataDir, { recursive: true });

    const ctx = await chromium.launchPersistentContext(userDataDir, {
        headless,
        locale: "zh-CN",
        viewport: { width: 1280, height: 800 },
        args: ["--no-sandbox"],
    });

    const page = await ctx.newPage();

    const searchUrl = buildJdSearchUrl(query);
    console.log("[test] Open search:", searchUrl);

    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs }).catch((e) => {
        console.error("[test] goto failed:", String(e?.message || e));
    });

    await page.waitForTimeout(1200);

    let cur = page.url();
    console.log("[test] Current URL:", cur);

    if (isRiskOrLoginUrl(cur)) {
        const ret = parseReturnUrl(cur) || searchUrl;
        console.log("[test] Redirected to risk/login page.");
        console.log("[test] Please COMPLETE verification/login manually in the opened browser.");
        console.log("[test] After it is resolved, press Enter here.");
        console.log("[test] Will continue with:", ret);
        await promptEnter("Press Enter after verification/login...");

        await page.goto(ret, { waitUntil: "domcontentloaded", timeout: timeoutMs }).catch(() => { });
        await page.waitForTimeout(1200);
        console.log("[test] After manual step URL:", page.url());
    }

    const st = await waitForResults(page, timeoutMs);
    console.log("[test] After wait:", {
        ok: st.ok,
        blocked: st.blocked,
        reason: st.reason,
        newCount: st.newCount,
        oldCount: st.oldCount,
        url: st.url,
    });

    if (!st.ok) {
        console.log("[test] No product cards found.");
        if (st.blocked) {
            console.log("[test] BLOCKED reason:", st.reason);
            console.log("[test] sample:", st.sample);
            console.log("[test] This means JD did not render results. Scraping cannot proceed now.");
        } else {
            console.log("[test] Not blocked but still 0 cards. DOM may have changed or needs more time.");
        }

        await saveDebug(page, "jd_debug");
        await ctx.close();
        process.exit(2);
    }

    const items = await page.evaluate((arg) => {
        const { LIMIT, newSel, oldSel } = arg;

        const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
        const normUrl = (u) => {
            const s = clean(u);
            if (!s) return "";
            if (s.startsWith("//")) return `https:${s}`;
            if (s.startsWith("http://") || s.startsWith("https://")) return s;
            if (s.startsWith("/")) return `https:${s}`;
            return s;
        };

        const newNodes = Array.from(document.querySelectorAll(newSel));
        const oldNodes = Array.from(document.querySelectorAll(oldSel));
        const useNew = newNodes.length > 0;
        const nodes = useNew ? newNodes : oldNodes;

        const raw = [];
        for (const node of nodes) {
            if (raw.length >= LIMIT * 4) break;

            const sku = clean(node.getAttribute("data-sku"));
            if (!sku) continue;

            let title = "";
            let image = "";
            let url = "";

            if (useNew) {
                title =
                    clean(node.querySelector('[class*="goods_title_container"] span[title]')?.getAttribute("title")) ||
                    clean(node.querySelector('[title]')?.getAttribute("title")) ||
                    "";

                if (!title) {
                    const titles = Array.from(node.querySelectorAll("[title]"))
                        .map((el) => clean(el.getAttribute("title")))
                        .filter(Boolean);
                    titles.sort((a, b) => b.length - a.length);
                    title = titles[0] || "";
                }

                const img = node.querySelector("img");
                image = normUrl(img?.getAttribute("data-src") || img?.getAttribute("src"));

                const a = node.querySelector("a[href]");
                const href = normUrl(a?.getAttribute("href"));
                url = href && href.includes("jd.com") ? href : `https://item.jd.com/${sku}.html`;
            } else {
                title =
                    clean(node.querySelector(".p-name em")?.textContent) ||
                    clean(node.querySelector(".p-name")?.textContent) ||
                    "";

                const a = node.querySelector(".p-name a");
                const href = normUrl(a?.getAttribute("href"));
                url = href || `https://item.jd.com/${sku}.html`;

                const img = node.querySelector(".p-img img");
                image = normUrl(
                    img?.getAttribute("data-lazy-img") ||
                    img?.getAttribute("data-lazy-img-slave") ||
                    img?.getAttribute("src")
                );
            }

            if (!title) continue;
            raw.push({ sku, title, image, url });
        }

        const seen = new Set();
        const out = [];
        for (const it of raw) {
            if (!it.sku || seen.has(it.sku)) continue;
            seen.add(it.sku);
            out.push(it);
            if (out.length >= LIMIT) break;
        }
        return out;
    }, { LIMIT: limit, newSel: NEW_CARD_SEL, oldSel: OLD_CARD_SEL });

    console.log("[test] Extracted:", items.length);
    console.log(JSON.stringify(items, null, 2));

    await ctx.close();
}

main().catch((e) => {
    console.error("[test] fatal:", e);
    process.exit(1);
});
