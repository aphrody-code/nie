import fs from "node:fs";
import * as cheerio from "cheerio";

const html = fs.readFileSync("/home/ubuntu/rg/packages/inagle/data/zukan/skill/page-1.html", "utf-8");
const $ = cheerio.load(html);

console.log("Pager HTML:");
console.log($(".pager").html() || $(".pagination").html() || "No pager found");

// Check how many pages or links there are
$("a").each((_, a) => {
    const href = $(a).attr("href");
    if (href && href.includes("page=")) {
        console.log("Found page link:", href);
    }
});
