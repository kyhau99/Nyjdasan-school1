// 금성초등학교 홈페이지 '학교행사' 달력을 읽어 kumsung.json으로 저장합니다.
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const BASE = "https://www.kumsung.net/bbs/board.php?bo_table=2_6";
const PLACEHOLDER = "해당메뉴를 클릭시 메뉴사진을 볼 수 있습니다.";

const strip = h => h.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

export function parseMonth(html, ym) {
  const out = {};
  for (const td of html.split(/<td\b/i).slice(1)) {
    const chunk = td.split(/<\/td>/i)[0];
    const links = [...chunk.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map(m => ({ attrs: m[1], text: strip(m[2]) }));
    if (!links.length || !/^\d{1,2}$/.test(links[0].text)) continue;
    const ymd = ym + links[0].text.padStart(2, "0");
    for (const l of links.slice(1)) {
      if (!l.text || l.text === PLACEHOLDER) continue;
      const id = (l.attrs.match(/wr_id=(\d+)/) || [])[1];
      (out[ymd] ||= []).push({ n: l.text, u: id ? `${BASE}&wr_id=${id}` : BASE });
    }
  }
  return out;
}

async function main() {
  const kst = new Date(Date.now() + 9 * 3600e3);
  const months = [];
  for (let i = -1; i <= 4; i++) {
    const d = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() + i, 1));
    months.push(d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, "0"));
  }
  const events = {};
  let okMonths = 0;
  for (const ym of months) {
    try {
      const res = await fetch(`${BASE}&schedule_ym=${ym}`, { headers: { "User-Agent": "Mozilla/5.0 (compatible; school-calendar-sync)" } });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const found = parseMonth(await res.text(), ym);
      Object.assign(events, found);
      okMonths++;
      console.log(ym, "일정이 있는 날:", Object.keys(found).length);
    } catch (e) {
      console.log(ym, "실패:", e.message);
    }
    await new Promise(r => setTimeout(r, 700));
  }
  if (!okMonths) { console.log("모든 달 조회에 실패했어요."); process.exitCode = 1; return; }
  writeFileSync("kumsung.json", JSON.stringify({ updated: new Date().toISOString(), events }, null, 1));
  console.log("저장 완료:", Object.keys(events).length, "일");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error("오류:", e.message); process.exitCode = 1; });
}
