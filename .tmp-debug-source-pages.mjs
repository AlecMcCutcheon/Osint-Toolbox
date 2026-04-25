import { fetchPageWithPlaywright } from "./src/playwrightWorker.mjs";

const targets = [
  { id: "fastpeoplesearch", url: "https://www.fastpeoplesearch.com/name/kory-drake_maine" },
  { id: "truepeoplesearch", url: "https://www.truepeoplesearch.com/results?name=Kory+Drake&citystatezip=Maine" },
];

for (const target of targets) {
  try {
    const result = await fetchPageWithPlaywright(target.url, { sourceId: target.id, maxTimeout: 45000 });
    const html = String(result.html || "");
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    console.log(JSON.stringify({
      id: target.id,
      status: result.status,
      finalUrl: result.finalUrl,
      challengeReason: result.challengeReason || null,
      htmlBytes: html.length,
      hasEnableJavascript: /enable javascript/.test(text),
      hasPleaseEnableCookies: /please enable cookies/.test(text),
      hasLinkToDetails: /class="[^"]*link-to-details/i.test(html),
      hasFpsDetailHref: /href="\/[^"]+_id_[^"]+"/i.test(html),
      hasTpsPersonLinks: /href="\/find\/person\//i.test(html),
      hasTpsAddressLinks: /href="\/address-lookup/i.test(html),
      firstEnableJavascriptIndex: text.indexOf("enable javascript"),
      textSample: text.slice(0, 500)
    }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({ id: target.id, error: String(error?.message || error) }, null, 2));
  }
}
