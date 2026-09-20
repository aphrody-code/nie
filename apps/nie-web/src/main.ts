// A deployment replaces every hashed chunk under `static/`. A tab that loaded the previous
// `index.html` then fails its next lazy import with a 404. One reload per session repairs the
// stale document without creating an infinite reload loop.
window.addEventListener("vite:preloadError", (event) => {
	const key = "nie:reload-after-preload-error";
	if (sessionStorage.getItem(key)) return;
	sessionStorage.setItem(key, "1");
	event.preventDefault();
	window.location.reload();
});

const root = document.getElementById("racine");
if (!root) throw new Error("#racine absent de index.html");

const loadHost = async () => {
	const { mountHost } = await import("./host-mount");
	mountHost(root);
};

if (import.meta.env.MODE === "desktop") {
	void loadHost();
} else {
	void import("./public-bootstrap").then(({ mountPublicBootstrap }) => {
		mountPublicBootstrap(root, loadHost);
	});
}
