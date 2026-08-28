import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { extractHouseholdCreditSeries, latestHouseholdCreditWorkbookUrl } from "./lib/ny-fed-xlsx.mjs";

async function fetchYahoo(symbol, label, startYear) {
  const start = Math.floor(Date.UTC(startYear, 0, 1) / 1000);
  const end = Math.floor(Date.now() / 1000) + 86400;
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set("period1", String(start));
  url.searchParams.set("period2", String(end));
  url.searchParams.set("interval", "1d");
  url.searchParams.set("events", "history");

  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "Ticker-GitHub-Pages/1.0" },
  });
  if (!response.ok) throw new Error(`${label} request returned HTTP ${response.status}`);

  const payload = await response.json();
  const result = payload?.chart?.result?.[0];
  const timestamps = result?.timestamp;
  const closes = result?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(timestamps) || !Array.isArray(closes)) throw new Error(`${label} history is missing`);

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

  const rows = (await response.text()).trim().split(/\r?\n/).slice(1);
  return rows.flatMap((row) => {
    const [period, rawValue] = row.split(",");
    const value = Number(rawValue);
    return /^\d{4}-\d{2}-\d{2}$/.test(period) && Number.isFinite(value)
      ? [[period, value]]
      : [];
  });
}

async function fetchHouseholdCredit() {
  const databankResponse = await fetch("https://www.newyorkfed.org/microeconomics/databank", {
    headers: { accept: "text/html", "user-agent": "Ticker-GitHub-Pages/1.0" },
  });
  if (!databankResponse.ok) throw new Error(`New York Fed databank request returned HTTP ${databankResponse.status}`);
  const workbookUrl = latestHouseholdCreditWorkbookUrl(await databankResponse.text());
  const workbookResponse = await fetch(workbookUrl, {
    headers: { accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "user-agent": "Ticker-GitHub-Pages/1.0" },
  });
  if (!workbookResponse.ok) throw new Error(`New York Fed workbook request returned HTTP ${workbookResponse.status}`);
  return extractHouseholdCreditSeries(await workbookResponse.arrayBuffer());
}

const [sp500, unemployment, gdp, treasury10y, pce, bitcoin, householdCredit] = await Promise.all([
  fetchYahoo("^GSPC", "S&P 500", 2000),
  fetchFred("UNRATE"),
  fetchFred("GDPC1"),
  fetchFred("DGS10"),
  fetchFred("PCEPI"),
  fetchYahoo("BTC-USD", "Bitcoin", 2010),
  fetchHouseholdCredit(),
]);

const { mortgageOriginations, mortgageBalance, autoOriginations, autoBalance } = householdCredit;

for (const [name, observations] of Object.entries({ sp500, unemployment, gdp, treasury10y, pce, bitcoin, mortgageOriginations, mortgageBalance, autoOriginations, autoBalance })) {
  if (observations.length < 2) throw new Error(`${name} did not contain enough observations`);
}

const destination = resolve("data", "sp500.json");
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, JSON.stringify({
  retrievedAt: new Date().toISOString(),
  series: { sp500, unemployment, gdp, treasury10y, pce, bitcoin, mortgageOriginations, mortgageBalance, autoOriginations, autoBalance },
}));
console.log(`Prepared ten Ticker series for GitHub Pages`);
