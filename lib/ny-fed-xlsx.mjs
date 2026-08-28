import { strFromU8, unzipSync } from "fflate";

const QUARTER_PATTERN = /^(\d{2}):Q([1-4])$/;

function decodeXml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function attributesFrom(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w:]+)="([^"]*)"/g)].map((match) => [match[1], decodeXml(match[2])]));
}

function xmlText(fragment) {
  return decodeXml([...fragment.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((match) => match[1]).join(""));
}

function workbookFiles(buffer) {
  return unzipSync(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer));
}

function fileText(files, path) {
  const file = files[path];
  if (!file) throw new Error(`New York Fed workbook is missing ${path}`);
  return strFromU8(file);
}

function sharedStrings(files) {
  const file = files["xl/sharedStrings.xml"];
  if (!file) return [];
  return [...strFromU8(file).matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((match) => xmlText(match[1]));
}

function sheetPath(files, requestedName) {
  const workbook = fileText(files, "xl/workbook.xml");
  const relationships = fileText(files, "xl/_rels/workbook.xml.rels");
  const sheet = [...workbook.matchAll(/<sheet\s[^>]*\/>/g)]
    .map((match) => attributesFrom(match[0]))
    .find((attributes) => attributes.name === requestedName);
  if (!sheet?.["r:id"]) throw new Error(`New York Fed workbook is missing ${requestedName}`);

  const relationship = [...relationships.matchAll(/<Relationship\s[^>]*\/>/g)]
    .map((match) => attributesFrom(match[0]))
    .find((attributes) => attributes.Id === sheet["r:id"]);
  if (!relationship?.Target) throw new Error(`New York Fed workbook cannot resolve ${requestedName}`);
  return relationship.Target.startsWith("/") ? relationship.Target.slice(1) : `xl/${relationship.Target}`;
}

function columnFromReference(reference) {
  return reference.match(/^[A-Z]+/)?.[0] ?? "";
}

function cellValue(cellTag, body, strings) {
  const attributes = attributesFrom(cellTag);
  if (attributes.t === "inlineStr") return xmlText(body);
  const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
  if (raw === undefined) return null;
  if (attributes.t === "s") return strings[Number(raw)] ?? null;
  if (attributes.t === "str") return decodeXml(raw);
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : decodeXml(raw);
}

function readSheet(files, requestedName, strings) {
  const xml = fileText(files, sheetPath(files, requestedName));
  return [...xml.matchAll(/<row\s[^>]*>([\s\S]*?)<\/row>/g)].map((rowMatch) => {
    const cells = new Map();
    for (const cellMatch of rowMatch[1].matchAll(/(<c\s[^>]*\/>)|(<c\s[^>]*>)([\s\S]*?)<\/c>/g)) {
      const cellTag = cellMatch[1] ?? cellMatch[2];
      const reference = attributesFrom(cellTag).r;
      if (reference && cellMatch[2]) cells.set(columnFromReference(reference), cellValue(cellTag, cellMatch[3], strings));
    }
    return cells;
  });
}

function quarterDate(label) {
  const match = QUARTER_PATTERN.exec(label);
  if (!match) return null;
  const year = 2000 + Number(match[1]);
  const month = (Number(match[2]) - 1) * 3 + 1;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

function numberAt(row, column) {
  const value = row.get(column);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function round(value) {
  return Number(value.toFixed(4));
}

export function extractHouseholdCreditSeries(buffer) {
  const files = workbookFiles(buffer);
  const strings = sharedStrings(files);
  const balances = readSheet(files, "Page 3 Data", strings);
  const mortgageFlows = readSheet(files, "Page 6 Data", strings);
  const autoFlows = readSheet(files, "Page 8 Data", strings);

  const mortgageBalance = [];
  const autoBalance = [];
  for (const row of balances) {
    const period = typeof row.get("A") === "string" ? quarterDate(row.get("A")) : null;
    const mortgage = numberAt(row, "B");
    const auto = numberAt(row, "D");
    if (period && mortgage !== null) mortgageBalance.push([period, round(mortgage * 1000)]);
    if (period && auto !== null) autoBalance.push([period, round(auto * 1000)]);
  }

  const readOriginations = (rows) => rows.flatMap((row) => {
    const period = typeof row.get("A") === "string" ? quarterDate(row.get("A")) : null;
    const total = numberAt(row, "H");
    return period && total !== null ? [[period, round(total)]] : [];
  });

  const result = {
    mortgageOriginations: readOriginations(mortgageFlows),
    mortgageBalance,
    autoOriginations: readOriginations(autoFlows),
    autoBalance,
  };
  for (const [name, observations] of Object.entries(result)) {
    if (observations.length < 2) throw new Error(`New York Fed ${name} history is missing`);
  }
  return result;
}

export function latestHouseholdCreditWorkbookUrl(databankHtml) {
  const urls = [...databankHtml.matchAll(/(?:https:\/\/www\.newyorkfed\.org)?(\/medialibrary\/[^"'\s>]*?hhd_c_report_(\d{4})q([1-4])\.xlsx)/gi)]
    .map((match) => ({ path: match[1], key: Number(match[2]) * 10 + Number(match[3]) }))
    .sort((left, right) => right.key - left.key);
  if (!urls.length) throw new Error("New York Fed household credit workbook link was not found");
  return new URL(urls[0].path, "https://www.newyorkfed.org").href;
}
