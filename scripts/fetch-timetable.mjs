 // 컴시간알리미(comci.net:4082) 교사 시간표를 가져와 timetable.json으로 저장합니다.
// 비공식 서비스를 역공학한 코드라 사이트가 바뀌면 동작이 달라질 수 있어요.
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ORIGIN = "http://comci.net:4082";
const HEAD = { "User-Agent": "Mozilla/5.0 (compatible; timetable-sync)" };
const eucDec = new TextDecoder("euc-kr");

export function decodeAuto(buf) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); }
  catch { return eucDec.decode(buf); }
}

async function get(path) {
  const res = await fetch(ORIGIN + "/" + path, { headers: HEAD });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
  return decodeAuto(new Uint8Array(await res.arrayBuffer()));
}

export function parseLoose(text) {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("JSON을 찾지 못했어요: " + text.slice(0, 200));
  return JSON.parse(text.slice(a, b + 1));
}

// 한글을 EUC-KR 퍼센트 인코딩으로 바꿉니다 (디코더로 역방향 표를 만듦).
const encMap = new Map();
for (let hi = 0xA1; hi <= 0xFE; hi++)
  for (let lo = 0xA1; lo <= 0xFE; lo++) {
    const ch = eucDec.decode(Uint8Array.of(hi, lo));
    if (ch.length === 1 && ch !== "\uFFFD") encMap.set(ch, [hi, lo]);
  }
export function encodeEucKr(s) {
  let out = "";
  for (const ch of s) {
    if (ch.charCodeAt(0) < 128) { out += encodeURIComponent(ch); continue; }
    const b = encMap.get(ch);
    if (!b) throw new Error("EUC-KR로 바꿀 수 없는 글자: " + ch);
    out += b.map(x => "%" + x.toString(16).toUpperCase()).join("");
  }
  return out;
}

const avg = a => a.reduce((n, x) => n + x.length, 0) / a.length;

export function analyze(data, teacher) {
  const sep = Number(data["분리"]) || 100;
  const match = name => {
    if (!name || !String(name).replace(/\*/g, "")) return false;
    const re = new RegExp("^" + String(name).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
    return re.test(teacher);
  };
  const strs = [], grids = [];
  for (const [k, v] of Object.entries(data)) {
    if (!Array.isArray(v)) continue;
    if (v.length > 2 && v.every(x => typeof x === "string"))
      strs.push({ k, v, stars: v.filter(x => x.includes("*")).length, hits: v.filter(match).length });
    else if (typeof v?.[1]?.[1]?.[1]?.[1] === "number") grids.push({ k, v });
  }
  console.log("키 목록:", Object.keys(data).join(", "));
  console.log("문자열 목록:", strs.map(x => `${x.k}(${x.v.length}개, 마스킹 ${x.stars}, 일치 ${x.hits}) 예: ${x.v.slice(0, 6).join("|")}`));
  console.log("시간표 격자:", grids.map(x => x.k).join(", ") || "없음");

  const tl = [...strs].sort((a, b) => b.hits - a.hits || b.stars - a.stars)[0];
  if (!tl || !tl.hits) return { cells: {}, reason: `교사 이름 '${teacher}'과 일치하는 항목이 없어요.` };
  const subs = strs.filter(x => x !== tl && x.stars === 0 && x.v.length > 5).sort((a, b) => avg(a.v) - avg(b.v))[0];
  const subj = subs ? subs.v : [];
  const tIdx = new Set(tl.v.map((n, i) => (i > 0 && match(n) ? i : -1)).filter(i => i > 0));
  console.log("교사 목록:", tl.k, "| 일치:", [...tIdx].map(i => `${i}:${tl.v[i]}`).join(", "), "| 과목 목록:", subs ? subs.k : "없음", "| 분리:", sep);

  let best = { cells: {}, grid: null };
  for (const { k, v } of grids) {
    const cells = {};
    v.forEach((g, gi) => {
      if (!Array.isArray(g)) return;
      g.forEach((cl, ci) => {
        if (!Array.isArray(cl)) return;
        for (let d = 1; d <= 5; d++) {
          const day = cl[d];
          if (!Array.isArray(day)) continue;
          for (let p = 1; p < day.length; p++) {
            const code = day[p];
            if (typeof code !== "number" || !code) continue;
            if (tIdx.has(code % sep)) cells[`${d}-${p}`] = { s: subj[Math.floor(code / sep)] || "?", c: `${gi}-${ci}` };
          }
        }
      });
    });
    console.log(`격자 ${k}: 내 수업 ${Object.keys(cells).length}칸`);
    if (Object.keys(best.cells).length < Object.keys(cells).length) best = { cells, grid: k };
  }
  return best;
}

function diagnose(name, page) {
  console.log(`\n===== ${name} 페이지 진단 (길이 ${page.length}) =====`);
  console.log("script 태그:", [...page.matchAll(/<script[^>]*>/gi)].map(m => m[0]).slice(0, 10).join(" "));
  for (const kw of ["sc_data", "ajax", "url", "school_ra", "btoa", "XMLHttp", "fetch(", "_T"]) {
    let from = 0;
    for (let n = 0; n < 2; n++) {
      const i = page.indexOf(kw, from);
      if (i < 0) break;
      console.log(`[${kw}] ...${page.slice(Math.max(0, i - 100), i + 160).replace(/\s+/g, " ")}...`);
      from = i + kw.length;
    }
  }
}

async function main() {
  const query = process.env.SCHOOL_QUERY || "남양주다산";
  const teacher = process.env.TEACHER || "금유호";
  const week = process.env.WEEK || "1";

  const page = await get("th");
  const prefix = (page.match(/sc_data\(\s*['"]([^'"]*)['"]/) || [])[1];
  const urls = [...page.matchAll(/url\s*:\s*['"]([^'"]+)['"]/g)].map(m => m[1].replace(/^\.?\//, ""));
  const searchRoute = urls.find(u => /\?\d+l$/.test(u));
  const ttRoute = urls.find(u => /^\w+\?$/.test(u)) || (searchRoute && searchRoute.replace(/\?\d+l$/, "?"));
  console.log("접두어:", prefix, "| 검색 경로:", searchRoute, "| 시간표 경로:", ttRoute, "| 발견한 url:", urls.join(" , "));
  if (!prefix || !searchRoute || !ttRoute) {
    console.log("컴시간 페이지 구조를 읽지 못했어요. 진단 정보를 출력합니다.");
    diagnose("th", page);
    try { diagnose("st", await get("st")); } catch (e) { console.log("st 페이지 오류:", e.message); }
    process.exitCode = 1; return;
  }

  const rows = parseLoose(await get(searchRoute + encodeEucKr(query)))["학교검색"] || [];
  console.log("학교 검색 결과:", JSON.stringify(rows));
  const school = rows.find(r => /경기/.test(r[1]) && String(r[2]).includes(query)) || rows[0];
  if (!school) { console.log("학교를 찾지 못했어요."); process.exitCode = 1; return; }

  const code = Buffer.from(`${prefix}${school[3]}_0_${week}`).toString("base64");
  const data = parseLoose(await get(ttRoute + code));
  const { cells, grid, reason } = analyze(data, teacher);
  if (!Object.keys(cells).length) {
    console.log("시간표를 만들지 못했어요.", reason || "");
    process.exitCode = 1; return;
  }
  writeFileSync("timetable.json", JSON.stringify({ updated: new Date().toISOString(), school: school[2], teacher, week, grid, cells }, null, 1));
  console.log(`저장 완료: ${school[2]} ${teacher} ${Object.keys(cells).length}칸`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error("오류:", e.message); process.exitCode = 1; });
}

