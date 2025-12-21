// extension/jd_orders_scraper.js (REPLACE WHOLE FILE)
// Robust JD order history scraper for https://order.jd.com/center/list.action
// Key fix: keep aicJob across pagination using sessionStorage (so results always post back).
// Behavior:
// - On each page: wait orders -> scroll -> extract -> append to sessionStorage
// - If next page exists and pageCount < maxPages and items < maxItems: navigate to next page with aicJob attached
// - Else: send JD_ORDERS_RESULT with all accumulated items and clear sessionStorage

(() => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const SS_JOB = "aic_orders_job";
    const SS_ACC = "aic_orders_acc";
    const SS_PAGE = "aic_orders_page";
    const SS_LIMITS = "aic_orders_limits";

    function getParam(name) {
        try {
            return new URL(location.href).searchParams.get(name);
        } catch (_) {
            return null;
        }
    }

    function getJobId() {
        // Prefer URL param; otherwise sessionStorage; otherwise window.name
        const fromUrl = getParam("aicJob");
        if (fromUrl) return fromUrl;

        const fromSS = sessionStorage.getItem(SS_JOB);
        if (fromSS) return fromSS;

        const m = String(window.name || "").match(/aicJob=([a-zA-Z0-9_\-]+)/);
        return m ? m[1] : "";
    }

    function setJobId(jobId) {
        try { sessionStorage.setItem(SS_JOB, jobId); } catch (_) { }
        try { window.name = `aicJob=${jobId}`; } catch (_) { }
    }

    function getLimits() {
        // URL -> sessionStorage -> defaults
        let maxPages = Number(getParam("aicMaxPages") || 0);
        let maxItems = Number(getParam("aicMaxItems") || 0);

        try {
            const saved = sessionStorage.getItem(SS_LIMITS);
            if (saved) {
                const j = JSON.parse(saved);
                if (!maxPages && j?.maxPages) maxPages = Number(j.maxPages);
                if (!maxItems && j?.maxItems) maxItems = Number(j.maxItems);
            }
        } catch (_) { }

        if (!maxPages || !Number.isFinite(maxPages)) maxPages = 10;
        if (!maxItems || !Number.isFinite(maxItems)) maxItems = 400;

        maxPages = Math.max(1, Math.min(50, maxPages));
        maxItems = Math.max(50, Math.min(2000, maxItems));

        try { sessionStorage.setItem(SS_LIMITS, JSON.stringify({ maxPages, maxItems })); } catch (_) { }
        return { maxPages, maxItems };
    }

    function clearSession() {
        try { sessionStorage.removeItem(SS_ACC); } catch (_) { }
        try { sessionStorage.removeItem(SS_PAGE); } catch (_) { }
        try { sessionStorage.removeItem(SS_LIMITS); } catch (_) { }
        // keep SS_JOB is ok; but clear to avoid confusion
        try { sessionStorage.removeItem(SS_JOB); } catch (_) { }
    }

    function send(jobId, payload) {
        try {
            chrome.runtime.sendMessage({ type: "JD_ORDERS_RESULT", jobId, payload });
        } catch (_) { }
    }

    async function waitForOrders(timeoutMs = 20000) {
        const t0 = Date.now();
        while (Date.now() - t0 < timeoutMs) {
            if (document.querySelector('tbody[id^="tb-"]') || document.querySelector("table.order-tb")) return true;
            await sleep(300);
        }
        return false;
    }

    async function scrollToBottomStable(rounds = 6) {
        let last = 0;
        for (let i = 0; i < rounds; i++) {
            window.scrollTo(0, document.body.scrollHeight);
            await sleep(700);
            const h = document.body.scrollHeight || 0;
            if (h === last) break;
            last = h;
        }
        window.scrollTo(0, 0);
        await sleep(150);
    }

    function textOf(el) {
        return String(el?.textContent || "").replace(/\s+/g, " ").trim();
    }

    function parseMoney(s) {
        const m = String(s || "").match(/¥\s*([0-9]+(?:\.[0-9]+)?)/);
        return m ? `¥${m[1]}` : "";
    }

    function parseTimeAndOrderIdFromSepRow(sepText) {
        const t = String(sepText || "");
        const time = (t.match(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/) || [])[0] || "";
        const orderId =
            (t.match(/订单号[:：]?\s*([0-9]+)/) || [])[1] ||
            (t.match(/Order\s*No\.?[:：]?\s*([0-9]+)/i) || [])[1] ||
            "";
        return { time, orderId };
    }

    function extractSkuFromClass(el) {
        const cls = el?.className || "";
        const m = String(cls).match(/\bp-([0-9]{6,})\b/);
        return m ? m[1] : "";
    }

    function collectFromDom() {
        const out = [];
        const tbodies = Array.from(document.querySelectorAll('tbody[id^="tb-"]'));

        for (const tbody of tbodies) {
            const tbodyId = String(tbody.id || "");
            const orderIdFromTbody = tbodyId.replace(/^tb-/, "").trim();

            const sepRow = tbody.querySelector("tr.sep-row") || tbody.querySelector("tr[class*='sep']");
            const sepText = textOf(sepRow);
            const { time, orderId: orderIdFromSep } = parseTimeAndOrderIdFromSepRow(sepText);
            const orderId = orderIdFromSep || orderIdFromTbody;

            const amountText =
                textOf(tbody.querySelector("td.amount")) ||
                textOf(tbody.querySelector("td[class*='amount']")) ||
                "";
            const amount = parseMoney(amountText);

            const statusText =
                textOf(tbody.querySelector("td.status")) ||
                textOf(tbody.querySelector("td[class*='status']")) ||
                "";

            const goodsItems = Array.from(tbody.querySelectorAll(".goods-item"));
            if (!goodsItems.length) {
                const titleEl = tbody.querySelector(".p-name a, .p-name");
                const title = titleEl?.getAttribute?.("title") || textOf(titleEl);
                if (title) {
                    out.push({ orderId, time, title, sku: "", qty: "", amount, status: statusText });
                }
                continue;
            }

            for (const g of goodsItems) {
                const titleA = g.querySelector(".p-name a") || g.querySelector("a");
                const title = titleA?.getAttribute?.("title") || textOf(titleA);
                const sku = extractSkuFromClass(g);

                const qtyEl =
                    tbody.querySelector(".goods-number") ||
                    g.closest("tr")?.querySelector(".goods-number") ||
                    null;
                const qty = textOf(qtyEl); // e.g. "x1"

                if (title) {
                    out.push({ orderId, time, title, sku, qty, amount, status: statusText });
                }
            }
        }

        return out;
    }

    function loadAccum() {
        try {
            const s = sessionStorage.getItem(SS_ACC);
            if (!s) return [];
            const j = JSON.parse(s);
            return Array.isArray(j) ? j : [];
        } catch (_) {
            return [];
        }
    }

    function saveAccum(arr) {
        try {
            sessionStorage.setItem(SS_ACC, JSON.stringify(arr));
        } catch (_) { }
    }

    function getPageIndex() {
        const v = Number(sessionStorage.getItem(SS_PAGE) || "1");
        return Number.isFinite(v) && v >= 1 ? v : 1;
    }

    function setPageIndex(v) {
        try { sessionStorage.setItem(SS_PAGE, String(v)); } catch (_) { }
    }

    function findNextLink() {
        // robust find for "下一页"
        const links = Array.from(document.querySelectorAll("a"));
        const next = links.find(a => /下一页/.test(textOf(a)));
        if (!next) return null;

        const cls = String(next.className || "");
        if (/disabled|pn\-dis|no\-next/i.test(cls) || next.getAttribute("disabled") != null) return null;

        const href = next.getAttribute("href") || "";
        if (!href || href === "javascript:void(0);" || href === "#") {
            // some sites use onclick; still try returning element
            return next;
        }
        return next;
    }

    function buildNextUrl(nextEl, jobId, limits) {
        // If href exists, use it; otherwise click fallback (not recommended)
        const href = nextEl.getAttribute("href") || "";
        if (!href || href.startsWith("javascript")) return null;

        const u = new URL(href, location.href);
        u.searchParams.set("aicJob", jobId);
        // keep limits too (not required, but helpful)
        u.searchParams.set("aicMaxPages", String(limits.maxPages));
        u.searchParams.set("aicMaxItems", String(limits.maxItems));
        return u.toString();
    }

    async function main() {
        const jobId = getJobId();
        if (!jobId) return; // called without job -> do nothing

        setJobId(jobId);
        const limits = getLimits();

        // sanity: must be on order.jd.com
        if (!location.hostname.includes("order.jd.com")) {
            send(jobId, { ok: false, needLogin: true, reason: "not_order_host", items: [] });
            clearSession();
            return;
        }

        const ok = await waitForOrders(25000);
        if (!ok) {
            send(jobId, { ok: false, timeout: true, reason: "orders_not_loaded", items: [] });
            clearSession();
            return;
        }

        await scrollToBottomStable(6);

        const acc = loadAccum();
        const seen = new Set(acc.map(it => `${it?.orderId || ""}__${it?.sku || ""}__${it?.title || ""}`));

        const items = collectFromDom();
        for (const it of items) {
            const key = `${it?.orderId || ""}__${it?.sku || ""}__${it?.title || ""}`;
            if (!key.trim() || seen.has(key)) continue;
            seen.add(key);
            acc.push(it);
            if (acc.length >= limits.maxItems) break;
        }
        saveAccum(acc);

        const page = getPageIndex();

        // stop conditions
        if (acc.length >= limits.maxItems || page >= limits.maxPages) {
            send(jobId, { ok: true, items: acc, count: acc.length, pages: page });
            clearSession();
            return;
        }

        const nextEl = findNextLink();
        if (!nextEl) {
            send(jobId, { ok: true, items: acc, count: acc.length, pages: page });
            clearSession();
            return;
        }

        const nextUrl = buildNextUrl(nextEl, jobId, limits);
        setPageIndex(page + 1);

        if (nextUrl) {
            location.href = nextUrl;
            return;
        }

        // fallback: if no href, try clicking (may lose aicJob -> but we still have SS_JOB; however next page script must run on order.jd.com)
        try {
            nextEl.click();
        } catch (_) {
            // if click fails, finish now
            send(jobId, { ok: true, items: acc, count: acc.length, pages: page });
            clearSession();
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => main().catch(() => { }));
    } else {
        main().catch(() => { });
    }
})();
