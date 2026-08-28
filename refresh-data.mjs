import { writeFile } from "node:fs/promises";

async function fetchSp500() {
  const start = Math.floor(Date.UTC(2000, 0, 1) / 1000);
  const end = Math.floor(Date.now() / 1000) + 86400;
  const url = new URL("https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC");
  url.searchParams.set("period1", String(start));
  url.searchParams.set("period2", String(end));
  url.searchParams.set("interval", "1d");
  url.searchParams.set("events", "history");
  const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "Ticker-GitHub-Pages/1.0" } });
  if (!response.ok) throw new Error(`S&P 500 request returned HTTP ${response.status}`);
  const payload = await response.json();
  const result = payload?.chart?.result?.[0];
  const timestamps = result?.timestamp;
  const closes = result?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(timestamps) || !Array.isArray(closes)) throw new Error("S&P 500 history is missing");
  return timestamps.flatMap((timestamp, index) => {
    const close = closes[index];
    return Number.isFinite(close)
      ? [[new Date(timestamp * 1000).toISOString().slice(0, 10), Number(close.toFixed(4))]]
      : [];
  });
}

async function fetchFred(seriesId) {
  const url = new URL("https://fred.stlouisfed.org/graph/fredgraph.csv");
  url.searchParams.set("id", seriesId);
  const response = await fetch(url, { headers: { accept: "text/csv", "user-agent": "Ticker-GitHub-Pages/1.0" } });
  if (!response.ok) throw new Error(`${seriesId} request returned HTTP ${response.status}`);
  return (await response.text()).trim().split(/\r?\n/).slice(1).flatMap((row) => {
    const [period, rawValue] = row.split(",");
    const value = Number(rawValue);
    return /^\d{4}-\d{2}-\d{2}$/.test(period) && Number.isFinite(value) ? [[period, value]] : [];
  });
}

const [sp500, unemployment, gdp, treasury10y] = await Promise.all([
  fetchSp500(), fetchFred("UNRATE"), fetchFred("GDP"), fetchFred("DGS10"),
]);
for (const [name, observations] of Object.entries({ sp500, unemployment, gdp, treasury10y })) {
  if (observations.length < 2) throw new Error(`${name} did not contain enough observations`);
}
await writeFile("data/sp500.json", JSON.stringify({
  retrievedAt: new Date().toISOString(),
  series: { sp500, unemployment, gdp, treasury10y },
}));
