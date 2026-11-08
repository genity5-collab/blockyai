import { scrubSecrets, textRisk } from "../functions/_shared/screenguard.js";

// ---- scrubSecrets: what the MODEL reads off a page ----
{
  let p2 = 0, f2 = 0; const ok2 = (c, m) => { if (c) p2++; else { f2++; console.log("FAIL", m); } };
  const sec = { ghp: "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8", sk: "sk-" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4", aws: "AKIA" + "ABCDEFGHIJKLMNOP", jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW", pw: "password: hunter22secret", conn: "postgresql://admin:s3cretpw@db.example.com:5432/app", slack: "xoxb-1234567890-abcdefghij", card: "4111 1111 1111 1111" };
  for (const [k, v] of Object.entries(sec)) { const o = scrubSecrets("before " + v + " after"); ok2(!o.includes(v.replace(/^password: /, "")) && o.includes("[hidden]") && o.startsWith("before ") && o.endsWith(" after"), "scrubbed but surrounding text kept: " + k + " -> " + o.slice(0, 60)); }
  ok2(scrubSecrets("two: " + sec.ghp + " and " + sec.sk).split("[hidden]").length === 3, "several secrets in one text are all replaced");
  for (const t of ["TweenService animates the properties of an Instance.", "Order 4111 1111 1111 1112 shipped", "Version 0.742.1.7420710", "color #00A2FF width 512px", "api key rotation guide", "function getApiKey() return nil end"]) ok2(scrubSecrets(t) === t, "ordinary text is left exactly as it was: " + t.slice(0, 40));
  ok2(scrubSecrets(null) === "" && scrubSecrets(undefined) === "" && scrubSecrets({ toString() { throw 1; } }) === "" && scrubSecrets(Object.create(null)) === "", "odd input becomes empty, never a throw");
  const g = scrubSecrets(sec.ghp); ok2(scrubSecrets(g) === g, "scrubbing twice changes nothing more");
  ok2(!textRisk(scrubSecrets("x " + sec.ghp + " y " + sec.aws + " z")).risky, "after scrubbing, the detector finds nothing left");
  const t0 = Date.now(); scrubSecrets("a ".repeat(100000) + sec.ghp); ok2(Date.now() - t0 < 2000, "big text is scrubbed fast");
  console.log(`scrubSecrets: ${p2} passed, ${f2} failed`); if (f2) process.exit(1);
}
