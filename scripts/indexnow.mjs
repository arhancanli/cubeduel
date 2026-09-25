// Tells Bing, Yandex, Seznam, Naver and Yep that the site's pages have changed,
// in one request — IndexNow shares every submission between them. Google does
// not take part; it reads the sitemap.
//
// Run after a deploy:  npm run indexnow
// The key is the one file in public/ named <32 hex>.txt, holding its own name;
// the engines fetch it from the live site to confirm the request is ours, so the
// script checks it is live before sending anything.
import { readdirSync, readFileSync } from "node:fs";

const SITE = process.env.SITE ?? "https://cubeduel.vercel.app";
const keys = readdirSync("public").filter((f) => /^[0-9a-f]{32}\.txt$/.test(f));
if (keys.length !== 1) throw new Error(`expected one IndexNow key file in public/, found ${keys.length}`);
const key = keys[0].slice(0, -4);
if (readFileSync(`public/${keys[0]}`, "utf8").trim() !== key) throw new Error("the key file must hold its own name");

const keyLocation = `${SITE}/${key}.txt`;
const live = await fetch(keyLocation);
if (!live.ok || (await live.text()).trim() !== key) {
  throw new Error(`${keyLocation} is not live yet — deploy first`);
}

const sitemap = await (await fetch(`${SITE}/sitemap.xml`)).text();
const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
if (urlList.length === 0) throw new Error("the sitemap listed no pages");

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: new URL(SITE).host, key, keyLocation, urlList }),
});
// 200 = accepted, 202 = accepted and the key is still being checked.
console.log(`IndexNow: ${res.status} ${res.statusText} for ${urlList.length} pages`);
if (res.status !== 200 && res.status !== 202) {
  console.error(await res.text());
  process.exit(1);
}
