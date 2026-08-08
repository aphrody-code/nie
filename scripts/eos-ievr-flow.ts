#!/usr/bin/env bun
// EOS IEVR — flux d'auth + lecture saves cloud (PlayerDataStorage).
// REST api.epicgames.dev (pas le SDK natif). Secrets via .secrets/eos-ievr.env.
// Anti-hallucination : toute valeur de rôle GUID est dérivée du binaire + confirmée par l'API.
// NE COMMIT RIEN. Ne jamais logger les secrets en clair.

const SECRETS = "/home/ubuntu/rg/iecode/.secrets/eos-ievr.env";

function loadEnv(path: string): Record<string, string> {
  const txt = require("fs").readFileSync(path, "utf8");
  const out: Record<string, string> = {};
  for (const line of txt.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
  return out;
}

const e = loadEnv(SECRETS);

// ── Rôles RÉSOLUS (disasm EOS_Platform_Options + confirmés par le champ product_id/sandbox_id/deployment_id de l'API)
const CLIENT_ID = e.EOS_CLIENT_ID; // xyza7891… (struct +0x20)
// Le vrai ClientSecret est la valeur 'cRysRc7n…' (struct +0x28), étiquetée EOS_EXTRA_KEY dans le fichier.
const CLIENT_SECRET = e.EOS_EXTRA_KEY;
const PRODUCT_ID = "da518e53730f4be6acbac5ebf75745e0"; // GUID-A — confirmé product_id par l'API
const SANDBOX_ID = "6eded9b52bc74c84858eb0a82c4d41e7"; // PRIMARY — confirmé sandbox_id par l'API
const DEPLOYMENT_ID = "07447c49594e43399eead68da5e48115"; // GUID-D — déploiement par défaut (build path)
const HOST = "https://api.epicgames.dev";

const mask = (t: string) => (t ? `***(${t.length}c) ${t.slice(0, 6)}…` : "<vide>");

async function clientToken(deployment: string) {
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const r = await fetch(`${HOST}/auth/v1/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials", deployment_id: deployment }),
  });
  return { status: r.status, body: await r.json() };
}

// EOS_Connect_Login (external auth) — échange un ticket Steam contre un ProductUserId + token EOS.
// IMPORTANT : le binaire (SDK natif) utilise un EncryptedAppTicket (STEAM_APP_TICKET), MAIS le endpoint
// REST public n'accepte PAS 'steam_app_ticket' ("Auth method not supported"). Le REST exige
// 'steam_session_ticket' (le ticket parse, seule la longueur est rejetée si invalide) → fournir
// un AuthSessionTicket Steam (GetAuthSessionTicketForWebApi/GetAuthSessionTicket) en hex.
async function connectExternal(deployment: string, steamSessionTicketHex: string) {
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const r = await fetch(`${HOST}/auth/v1/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "external_auth",
      external_auth_type: "steam_session_ticket",
      external_auth_token: steamSessionTicketHex,
      deployment_id: deployment,
      nonce: "ievr-flow",
    }),
  });
  return { status: r.status, body: await r.json() };
}

// PlayerDataStorage REST — liste/lecture des fichiers de save cloud.
async function queryFileList(deployment: string, pdToken: string, productUserId: string) {
  const r = await fetch(
    `${HOST}/playerdatastorage/v1/playerdata/${deployment}/users/${productUserId}/files`,
    { headers: { Authorization: `Bearer ${pdToken}` } },
  );
  return { status: r.status, body: await r.text() };
}

async function main() {
  console.log("# EOS IEVR flow");
  console.log("client_id   =", mask(CLIENT_ID));
  console.log("client_secret=", mask(CLIENT_SECRET));
  console.log("product_id  =", PRODUCT_ID);
  console.log("sandbox_id  =", SANDBOX_ID);
  console.log("deployment  =", DEPLOYMENT_ID);

  // Étape 1 — token client_credentials (valide les creds + le deployment)
  const t = await clientToken(DEPLOYMENT_ID);
  if (t.body.access_token) {
    console.log(`\n[OK] client_credentials → token (${t.body.access_token.length}c)`);
    console.log("     product_id   =", t.body.product_id);
    console.log("     sandbox_id   =", t.body.sandbox_id);
    console.log("     deployment_id=", t.body.deployment_id);
    console.log("     org_id       =", t.body.organization_id);
    console.log("     features     =", (t.body.features || []).join(","));
  } else {
    console.log("\n[ERR] client_credentials:", t.body.errorCode, t.body.errorMessage);
    return;
  }

  // Étape 2 — Steam app ticket (BLOCAGE attendu : exige une session Steam live du compte propriétaire)
  const ticket = process.env.STEAM_APP_TICKET_HEX;
  if (!ticket) {
    console.log("\n[BLOQUÉ] STEAM_APP_TICKET_HEX absent.");
    console.log("  Pour continuer : un EncryptedAppTicket Steam (RequestEncryptedAppTicket) pour app 2799860,");
    console.log("  minté par steam_api64.dll dans une session du compte qui POSSÈDE le jeu (darksasuke).");
    console.log("  nie-steam/steamroom fait le login CM + depots mais NE PEUT PAS minter ce ticket de session.");
    return;
  }

  // Étape 2b — EOS_Connect_Login
  const c = await connectExternal(DEPLOYMENT_ID, ticket);
  if (!c.body.access_token) {
    console.log("\n[ERR] connect external_auth:", c.body.errorCode, c.body.errorMessage);
    return;
  }
  const puid = c.body.product_user_id || c.body.sub;
  console.log(`\n[OK] connect → ProductUserId=${puid} token(${c.body.access_token.length}c)`);

  // Étape 3 — lire les saves cloud
  const fl = await queryFileList(DEPLOYMENT_ID, c.body.access_token, puid);
  console.log(`\n[saves] QueryFileList status=${fl.status}`);
  console.log(fl.body.slice(0, 2000));
}

main();
