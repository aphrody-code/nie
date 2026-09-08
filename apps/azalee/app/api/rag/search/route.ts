// Le store RAG local a été retiré de la production le 2026-09-08. Garder une
// réponse déterministe évite qu'une requête résiduelle recrée silencieusement
// un SQLite vide dans le répertoire actif.
const retired = () =>
	Response.json({ status: "retired", service: "azalee-rag" }, { status: 410 });

export const POST = retired;
export const GET = retired;
