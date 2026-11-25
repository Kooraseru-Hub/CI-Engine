"use strict";
const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const ORIGIN = "https://devforum.roblox.com";
const PNG = Buffer.from([137,80,78,71,13,10,26,10]);
const reference = /^upload:\/\/[A-Za-z0-9]+\.png$/;

function fingerprint(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 8 || !bytes.subarray(0,8).equals(PNG))
    throw new Error("Expected PNG bytes");
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

// Reuse only an exact content fingerprint whose public image was verified.
function cachedUpload(bytes, previous, verified) {
  const hash = fingerprint(bytes);
  return previous?.digest === hash && reference.test(previous?.url || "") &&
    verified?.[previous.url] === true ? previous.url : null;
}

async function upload(bytes, name, {key, client, confirm = false, request = fetch} = {}) {
  const digest = fingerprint(bytes);
  if (!/^[A-Za-z0-9_-][A-Za-z0-9_.-]*\.png$/i.test(name)) throw new Error("Expected safe PNG filename");
  if (!confirm) return { digest, rehearsal: true };
  if (!key || !client || /[\r\n]/.test(key + client)) throw new Error("Missing DevForum credentials");
  const body = new FormData();
  body.set("type", "composer");
  body.set("synchronous", "true");
  body.set("file", new Blob([bytes], {type:"image/png"}), name);
  const res = await request(ORIGIN + "/uploads.json", {
    method:"POST", headers:{"User-Api-Key":key,"User-Api-Client-Id":client,Accept:"application/json"},
    body, redirect:"error", credentials:"omit", signal:AbortSignal.timeout(60000)
  });
  if (!res.ok) throw new Error("DevForum upload failed (HTTP " + res.status + ")");
  const result = await res.json();
  if (!reference.test(result.short_url || "")) throw new Error("Expected native PNG upload reference");
  return {digest, url:result.short_url, rehearsal:false};
}

module.exports = { fingerprint, cachedUpload, upload };
if (require.main === module) {
  const [file, flag, ...extra] = process.argv.slice(2);
  Promise.resolve().then(async () => {
    if (!file || extra.length || (flag !== undefined && flag !== "--publish")) throw new Error("Usage: upload.cjs <png> [--publish]");
    console.log(JSON.stringify(await upload(fs.readFileSync(file),path.basename(file),{confirm:flag==="--publish",key:process.env.DEVFORUM_UPLOAD_KEY,client:process.env.DEVFORUM_UPLOAD_CLIENT})));
  }).catch(error => { console.error(error.message); process.exitCode=1; });
}
