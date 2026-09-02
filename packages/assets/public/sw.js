const CACHE_NAME = "azalee-shell-v7-20260517";
const SHELL_URLS = ["/manifest.webmanifest", "/icon.webp", "/logo.webp"];
// Origin du CDN VPS — quand NEXT_PUBLIC_CDN_URL est actif, les chunks
// _next/static sont chargés depuis cdn.rosegriffon.fr et non self.location.
// Sans ce match, le SW devient no-op en prod CDN.
const CDN_ORIGIN = "https://cdn.rosegriffon.fr";

// Install: precache shell assets (versioned static only — pas de navigations)
self.addEventListener("install", (event) => {
	event.waitUntil(
		caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)),
	);
	self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
				),
			),
	);
	self.clients.claim();
});

// Fetch handler
self.addEventListener("fetch", (event) => {
	const { request } = event;

	// Skip non-GET requests
	if (request.method !== "GET") return;

	// Navigation requests: NETWORK-ONLY (jamais en cache — évite stale HTML)
	if (request.mode === "navigate") {
		event.respondWith(fetch(request));
		return;
	}

	const url = new URL(request.url);

	// Cache UNIQUEMENT les ressources versionnées /_next/static/ (immutables),
	// que ce soit servi par l'origin Next OU par le CDN VPS (assetPrefix).
	const isStaticPath =
		url.pathname.startsWith("/_next/static/") ||
		url.pathname.includes("/_next/static/");
	const isAllowedOrigin =
		url.origin === self.location.origin || url.origin === CDN_ORIGIN;
	if (isAllowedOrigin && isStaticPath) {
		event.respondWith(
			caches.match(request).then(
				(cached) =>
					cached ||
					fetch(request).then((response) => {
						if (response.ok) {
							const clone = response.clone();
							caches
								.open(CACHE_NAME)
								.then((cache) => cache.put(request, clone));
						}
						return response;
					}),
			),
		);
		return;
	}

	// Tout le reste : passe-plat réseau (pas de cache SW)
});

// Push notifications (existing)
self.addEventListener("push", (event) => {
	const data = event.data ? event.data.json() : {};
	const title = data.title || "Azalee";
	const options = {
		body: data.body || "",
		icon: "/icon.webp",
		badge: "/icon.webp",
		data: data.data || {},
		tag: data.tag || "default",
	};
	event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	const url = event.notification.data?.url || "/news";
	event.waitUntil(
		clients
			.matchAll({ type: "window", includeUncontrolled: true })
			.then((clientList) => {
				for (const client of clientList) {
					if (client.url.includes(url) && "focus" in client) {
						return client.focus();
					}
				}
				return clients.openWindow(url);
			}),
	);
});
