// extension/jd_scraper.js
(() => {
    try {
        // “content scriptが動いている”目印
        document.documentElement.setAttribute("data-aic-jdcs", "1");
        console.log("[AIC-CS] jd_scraper loaded:", location.href);

        const SEL_NEW =
            '[data-point-id][data-sku], [data-sku].plugin_goodsCardWrapper, [data-sku][class*="plugin_goodsCardWrapper"], [data-sku][class*="goodsCardWrapper"]';
        const SEL_OLD = '#J_goodsList li.gl-item[data-sku], li.gl-item[data-sku]';

        const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
        const normUrl = (u) => {
            const s = clean(u);
            if (!s) return "";
            if (s.startsWith("//")) return `https:${s}`;
            if (s.startsWith("http://") || s.startsWith("https://")) return s;
            return s;
        };

        const params = new URLSearchParams(location.search);
        const jobId = params.get("aicJob") || "";

        const start = Date.now();
        const TIMEOUT_MS = 20000;

        function isBlocked() {
            const txt = (document.body?.innerText || "").slice(0, 2000);
            return /验证|安全验证|captcha|访问过于频繁/i.test(txt);
        }

        function pickTitle(root) {
            const ts = Array.from(root.querySelectorAll("[title]"))
                .map((el) => clean(el.getAttribute("title")))
                .filter(Boolean);
            ts.sort((a, b) => b.length - a.length);
            return ts[0] || clean(root.textContent).slice(0, 90);
        }

        function extract(limit = 6) {
            const cardsNew = Array.from(document.querySelectorAll(SEL_NEW));
            const cardsOld = Array.from(document.querySelectorAll(SEL_OLD));
            const cards = cardsNew.length ? cardsNew : cardsOld;

            const items = [];
            const seen = new Set();

            for (const card of cards) {
                if (items.length >= limit) break;

                const sku = clean(card.getAttribute("data-sku"));
                if (!sku || seen.has(sku)) continue;

                if (card.querySelector('[class*="_ad_"],[class*="ad_"],[class*="广告"]')) continue;

                const title = pickTitle(card);
                if (!title) continue;

                let href =
                    normUrl(card.querySelector('a[href*="item.jd.com"]')?.getAttribute("href")) ||
                    normUrl(card.querySelector('a[href*="item.m.jd.com"]')?.getAttribute("href")) ||
                    normUrl(card.querySelector("a[href]")?.getAttribute("href"));
                if (!href || !href.includes("jd.com")) href = `https://item.jd.com/${sku}.html`;

                const img = card.querySelector("img");
                const image = normUrl(
                    img?.getAttribute("data-src") ||
                    img?.getAttribute("data-lazy-img") ||
                    img?.getAttribute("data-original") ||
                    img?.getAttribute("src")
                );

                const priceText =
                    clean(card.querySelector(".p-price i")?.textContent) ||
                    clean(card.querySelector('[class*="price"]')?.textContent) ||
                    "";
                const price = priceText ? (priceText.includes("￥") ? priceText : `￥${priceText}`) : "";

                items.push({ sku, title, url: href, image, price, source: "JD" });
                seen.add(sku);
            }

            return { items, nNew: cardsNew.length, nOld: cardsOld.length };
        }

        function send(payload) {
            // jobIdが空だとBG側が待っているMapに紐づかないので、ここは必ず付けたい
            const out = { type: "JD_SCRAPE_RESULT", jobId, payload };
            console.log("[AIC-CS] send", { jobId, ok: payload?.ok, n: payload?.items?.length, payload });
            chrome.runtime.sendMessage(out);
        }

        function tick() {
            // もしwww.jd.comへ飛んでたら（searchのはずがトップへ）
            if (location.hostname === "www.jd.com") {
                send({ ok: false, redirected: true, url: location.href });
                return true;
            }

            if (isBlocked()) {
                send({ ok: false, blocked: true, url: location.href });
                return true;
            }

            const { items, nNew, nOld } = extract(6);
            if (items.length > 0) {
                send({ ok: true, items, nNew, nOld, url: location.href });
                return true;
            }

            if (Date.now() - start > TIMEOUT_MS) {
                send({ ok: false, timeout: true, nNew, nOld, url: location.href });
                return true;
            }

            return false;
        }

        // React/遅延描画対策：MutationObserver + interval
        const mo = new MutationObserver(() => {
            tick();
        });
        mo.observe(document.documentElement, { subtree: true, childList: true });

        const it = setInterval(() => {
            const done = tick();
            if (done) clearInterval(it);
        }, 500);

        // first try
        tick();
    } catch (e) {
        console.log("[AIC-CS] fatal error", e);
    }
})();
