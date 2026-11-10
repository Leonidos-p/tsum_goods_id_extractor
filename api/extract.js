const ITEM_ID_RE = /"item_id"\s*:\s*(\d+)/g;

function isAllowedHost(hostname) {
  const host = hostname.toLowerCase();
  return host === "tsum.ru" || host === "www.tsum.ru" || host.endsWith(".tsum.ru");
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Используйте POST-запрос." });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const rawUrl = body && body.url;

    if (typeof rawUrl !== "string" || !rawUrl.trim()) {
      return res.status(400).json({ error: "Вставьте ссылку на страницу." });
    }

    let target;
    try {
      target = new URL(rawUrl.trim());
    } catch {
      return res.status(400).json({ error: "Некорректная ссылка." });
    }

    if (target.protocol !== "https:" || !isAllowedHost(target.hostname) || target.username || target.password) {
      return res.status(400).json({ error: "Разрешены только HTTPS-ссылки на tsum.ru." });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    let upstream;
    try {
      upstream = await fetch(target.toString(), {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml",
          "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8"
        }
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!upstream.ok) {
      return res.status(502).json({ error: `Сайт ЦУМ вернул HTTP ${upstream.status}. Возможно, запрос заблокирован.` });
    }

    const contentType = upstream.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      return res.status(502).json({ error: "По ссылке получен не HTML-документ." });
    }

    const html = await upstream.text();
    if (html.length > 15_000_000) {
      return res.status(413).json({ error: "Страница слишком большая для обработки." });
    }

    const all = [...html.matchAll(ITEM_ID_RE)].map(match => match[1]);
    const ids = [...new Set(all)];

    return res.status(200).json({ ids, occurrences: all.length });
  } catch (error) {
    const message = error && error.name === "AbortError"
      ? "Сайт не ответил за отведённое время."
      : "Не удалось загрузить страницу. Проверьте ссылку или попробуйте позже.";
    return res.status(500).json({ error: message });
  }
};
