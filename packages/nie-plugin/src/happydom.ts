// Préchargement `bun:test` — enregistre les globals DOM (document/window/…) via
// happy-dom avant l'exécution des tests, pour les tests de composants React / DOM.
// Voir https://bun.com/docs/test/dom et bunfig.toml [test] preload.
//
// ⚠ POINT CRITIQUE — happy-dom ne se contente pas d'ajouter le DOM : il REMPLACE
// aussi la pile réseau globale (`fetch`, `Headers`, `Request`, `Response`) par la
// sienne, qui simule un navigateur et applique donc la politique du même
// origine. Conséquences observées dans ce dépôt :
//   • tout `fetch` vers un autre hôte que `http://localhost:3000` (l'URL par
//     défaut de la fenêtre simulée) échoue en `NetworkError: Cross-Origin
//     Request Blocked` — c'est ce qui faisait tomber les tests d'intégration
//     réseau de `packages/cron/src/tasks/ie-crawl/bxc.test.ts` ;
//   • `Bun.serve` refuse la `Response` de happy-dom (« Expected a Response
//     object »), ce qui oblige les tests qui montent un vrai serveur à
//     désenregistrer happy-dom à la main (cf. `packages/azalee/test/remote.test.ts`).
//
// On rend donc à Bun ses primitives réseau natives juste après l'enregistrement
// des globals DOM. Les descripteurs posés par happy-dom sont `configurable: true`
// (cf. `@happy-dom/global-registrator`), la redéfinition est donc légale, et
// `GlobalRegistrator.unregister()` continue de fonctionner : il restaure les
// descripteurs natifs qu'il avait capturés — exactement ceux qu'on remet ici.
//
// Le DOM (document, window, HTMLElement, CustomEvent, localStorage…) reste
// entièrement celui de happy-dom : seul le transport réseau redevient natif.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

/**
 * Primitives réseau à conserver en version Bun native. On garde la famille
 * `fetch` COMPLÈTE et cohérente : `fetch` natif renvoie une `Response` native,
 * un `Response` global resté en version happy-dom casserait alors tout
 * `instanceof`, et un `AbortSignal` happy-dom serait refusé par la `Request`
 * native. À l'inverse on ne touche NI à `FormData`, NI à `Blob`/`File` :
 * happy-dom en a besoin pour ses propres formulaires (`new FormData(form)`).
 */
const PRIMITIVES_RESEAU = [
	"fetch",
	"Headers",
	"Request",
	"Response",
	// `AbortController`/`AbortSignal` font partie de la même famille : happy-dom les remplace
	// aussi, et un signal happy-dom passé au `Request` NATIF est refusé — « Failed to construct
	// 'Request': signal is not of type AbortSignal ». Le symptôme apparaissait loin de sa cause :
	// six tests de `packages/azalee` échouaient sur un appel réseau bouchonné, jamais sur le DOM.
	"AbortController",
	"AbortSignal",
] as const;

const descripteursNatifs = new Map<string, PropertyDescriptor>();
for (const nom of PRIMITIVES_RESEAU) {
	const descripteur = Object.getOwnPropertyDescriptor(globalThis, nom);
	if (descripteur) descripteursNatifs.set(nom, descripteur);
}

/**
 * Réinstalle les primitives réseau natives de Bun par-dessus celles de happy-dom.
 *
 * Exporté parce qu'un test qui refait `GlobalRegistrator.register()` (cf.
 * `packages/azalee/test/remote.test.ts`, qui désenregistre happy-dom pour monter un vrai
 * `Bun.serve` puis le remet) réinstalle du même coup la pile réseau simulée — et TOUS les
 * fichiers de test exécutés ensuite en héritent. Le symptôme se manifeste alors très loin :
 * `Headers` de happy-dom conserve la casse des clés (`User-Agent`), là où celui de Bun les
 * met en minuscules, et quatre tests de `patreon-bun` échouaient sur cette seule différence
 * — en suite complète uniquement, jamais isolément.
 */
export function rendreReseauNatif(): void {
	for (const [nom, descripteur] of descripteursNatifs) {
		Object.defineProperty(globalThis, nom, { ...descripteur, configurable: true });
	}
}

GlobalRegistrator.register();

rendreReseauNatif();
