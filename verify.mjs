const BASE = "https://cubeduel.vercel.app";
const paths = ["/", "/train", "/ranked", "/leaderboard", "/play", "/daily", "/timer", "/progress", "/settings"];
for (const p of paths) {
  const r = await fetch(BASE + p, { redirect: "manual" });
  console.log(String(r.status).padEnd(4), p);
}
const html = await (await fetch(BASE + "/train")).text();
const text = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
console.log("\n--- /train renders ---");
console.log(text.slice(0, 300));
console.log("\nnav has Train:", (await (await fetch(BASE + "/")).text()).includes(">Train<"));
