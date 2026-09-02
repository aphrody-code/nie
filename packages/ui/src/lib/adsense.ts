// Identifiants Google AdSense — module PUR, sans « use client ».
//
// Ils vivent à part des composants pour une raison de frontière serveur/client :
// dans un module marqué « use client », chaque export devient une référence
// client. Un composant serveur qui y lit une constante n'obtient pas la chaîne
// mais un mandataire, et Next échoue avec « Cannot access ADSENSE_CLIENT on the
// server ». Les layouts en ont besoin côté serveur, pour la balise
// `<meta name="google-adsense-account">` de `metadata.other` : la valeur doit
// donc venir d'ici, jamais de `components/adsense.tsx`.

/**
 * Identifiant éditeur AdSense. Public par conception — il apparaît en clair dans
 * le HTML servi. Surchargeable par `NEXT_PUBLIC_ADSENSE_CLIENT` ; la valeur par
 * défaut est celle du compte Rose Griffon, pour qu'un déploiement sans variable
 * d'environnement continue de servir les annonces (une variable oubliée
 * n'annulerait pas silencieusement la monétisation).
 */
export const ADSENSE_CLIENT =
	process.env.NEXT_PUBLIC_ADSENSE_CLIENT?.trim() || "ca-pub-9468354003771276";

/** Même identifiant sans le préfixe `ca-` : la forme attendue dans `ads.txt`. */
export const ADSENSE_PUBLISHER = ADSENSE_CLIENT.replace(/^ca-/, "");
