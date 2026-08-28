import { writeFile } from "node:fs/promises";

const start = Math.floor(Date.UTC(2000, 0, 1) / 1000);
const end = Math.floor(Date.now() / 1000) + 86400;
const url = new URL("https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC");
url.searchParams.set("period1", String(start));
url.searchParams.set("period2", String(end));
url.searchParams.set("interval", "1d");
url.searchParams.set("events", "history");

const response = await fetch(url, {
  headers: { accept: "application/json", "user-agent": "Market-Lens-GitHub-Pages/1.0" },
});
if (!response.ok) throw new Error(`Market data request returned HTTP ${response.status}`);

const payload = await response.json();
const result = payload?.chart?.result?.[0];
const timestamps = result?.timestamp;
const closes = result?.indicators?.quote?.[0]?.close;
if (!Array.isArray(timestamps) || !Array.isArray(closes)) throw new Error("Price history is missing");

const observations = timestamps.flatMap((timestamp, index) => {
  const close = closes[index];
  return Number.isFinite(close)
    ? [[new Date(timestamp * 1000).toISOString().slice(0, 10), Number(close.toFixed(4))]]
    : [];
});
if (observations.length < 2) throw new Error("Price history is incomplete");

await writeFile("data/sp500.json", JSON.stringify({
  retrievedAt: new Date().toISOString(),
  observations,
}));
