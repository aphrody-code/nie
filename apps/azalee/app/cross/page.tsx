import type { Metadata } from "next";
import Image from "next/image";
import { Play, ExternalLink } from "lucide-react";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@rosegriffon/ui";
import { crossData } from "./data";
import { Reveal, RevealGroup, RevealChild, StampPop, KenBurns, Float, Carousel } from "./motion";
import { CrossGallery } from "./CrossGallery";

const GOOGLE_PLAY = "https://play.google.com/store/apps/details?id=jp.co.level5.inazumacross";
const APP_STORE = "https://apps.apple.com/jp/app/id6756994116";
const OFFICIAL_SITE = "https://www.inazuma-cross.jp/";
const X_ACCOUNT = "https://x.com/inazuma_cross";
const YT_PLAYLIST = "https://www.youtube.com/playlist?list=PLlapDTT9GR4TwdLT5pbq88rfeuKXe3XLv";

export const metadata: Metadata = {
	alternates: { canonical: "/cross" },
	title: "Inazuma Eleven Cross — le nouveau jeu mobile | Azalée",
	description:
		"Inazuma Eleven Cross (イナズマイレブン クロス), le jeu mobile Level-5 × Aiming, lancement le 9 juin 2026. Traduction factuelle du site officiel inazuma-cross.jp + tweets récents @inazuma_cross. Jeu distinct d'Inazuma Eleven: Victory Road.",
	// Favicon de la page = la VRAIE icône du jeu Cross (protagoniste Yo Shiosawa), pas
	// celle d'azalée — la page reproduit le site officiel d'un jeu distinct.
	icons: {
		icon: [{ url: "/inazuma-cross/appicon.webp", type: "image/webp" }],
		shortcut: "/inazuma-cross/appicon.webp",
		apple: "/inazuma-cross/appicon.webp",
	},
	openGraph: {
		title: "Inazuma Eleven Cross — le nouveau jeu mobile",
		description:
			"Traduction factuelle du site officiel + tweets récents. Lancement le 9 juin 2026, nouveau protagoniste Yo Shiosawa, histoire originale après le FFI.",
		images: ["/inazuma-cross/ogp.jpg"],
	},
};

// Bleu « Inazuma » (cyan électrique du site officiel inazuma-cross.jp) — utilisé en
// surcouche du hero pour rapprocher la DA du vrai site, tout en gardant les tokens
// azalée pour le reste de la page. #00aeef (cyan) + #0c1730 (marine RG).
const INAZUMA_CYAN = "#00aeef";
const INAZUMA_NAVY = "#0c1730";

function formatFrDate(iso: string): string {
	const d = new Date(`${iso}T00:00:00Z`);
	return d.toLocaleDateString("fr-FR", {
		day: "numeric",
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	});
}

export default function CrossPage() {
	const {
		status,
		spec,
		introduction,
		protagonist,
		system,
		news,
		rewards,
		samuraiBlue2026,
		cbtReport,
		movies,
		tweets,
		tweetsNote,
		disclaimerFr,
		localImages,
	} = crossData;

	return (
		<div className="w-full pb-12">
			{/* Bandeau d'avertissement — jeu distinct d'IEVR */}
			<div className="mb-6 rounded-xl border border-tertiary/30 bg-tertiary-container/40 px-4 py-3">
				<p className="type-body-medium text-on-tertiary-container">
					<span className="font-bold">À noter :</span> Inazuma Eleven Cross est un jeu mobile
					<span className="font-bold"> distinct</span> d&apos;Inazuma Eleven: Victory Road (le jeu
					console/PC couvert par le reste du wiki). Il est actuellement{" "}
					<span className="font-bold">en pré-enregistrement</span>. Cette page est une{" "}
					<span className="font-bold">traduction factuelle</span> du site officiel{" "}
					<a
						href={OFFICIAL_SITE}
						target="_blank"
						rel="noopener noreferrer"
						className="underline underline-offset-2"
					>
						inazuma-cross.jp
					</a>{" "}
					et des tweets de{" "}
					<a
						href={X_ACCOUNT}
						target="_blank"
						rel="noopener noreferrer"
						className="underline underline-offset-2"
					>
						@inazuma_cross
					</a>
					.
				</p>
			</div>

			{/* ===================== HERO ===================== */}
			{/* Reproduit le firstview du site officiel : key visual vertical plein-hauteur,
			    identité cyan/marine « Inazuma », logo + CTA « 6/9 サービス開始 » + badges store. */}
			<section
				className="relative mb-12 flex min-h-[68vh] flex-col items-center justify-end overflow-hidden rounded-3xl border-2 shadow-level-2 sm:min-h-[78vh]"
				style={{ borderColor: `${INAZUMA_CYAN}80`, backgroundColor: INAZUMA_NAVY }}
			>
				{/* Key visual vertical animé (Ken Burns / bgLoop) — VISIBLE (pas d'opacity faible). */}
				<div className="absolute inset-0">
					<KenBurns className="absolute inset-0">
						<Image
							src={localImages.keyVisual}
							alt="Inazuma Eleven Cross — visuel principal"
							fill
							priority
							sizes="100vw"
							className="object-cover object-top"
						/>
					</KenBurns>
					{/* dégradé marine pour la lisibilité du logo + CTA en bas (comme le site). */}
					<div
						className="absolute inset-0"
						style={{
							background: `linear-gradient(to top, ${INAZUMA_NAVY} 18%, ${INAZUMA_NAVY}e6 34%, ${INAZUMA_NAVY}66 58%, transparent 82%)`,
						}}
					/>
					{/* liseré cyan latéral, signature Inazuma. */}
					<div
						className="pointer-events-none absolute inset-y-0 left-0 w-1.5"
						style={{ backgroundColor: INAZUMA_CYAN }}
					/>
					<div
						className="pointer-events-none absolute inset-y-0 right-0 w-1.5"
						style={{ backgroundColor: INAZUMA_CYAN }}
					/>
				</div>

				<div className="relative z-10 flex w-full flex-col items-center px-6 pb-24 pt-10 text-center sm:pb-16">
					<Reveal blur>
						<Image
							src={localImages.logo}
							alt="Logo Inazuma Eleven Cross"
							width={460}
							height={176}
							priority
							className="mb-5 h-auto w-[min(440px,82vw)] drop-shadow-[0_4px_0_rgba(0,0,0,0.55)]"
						/>
					</Reveal>
					<Reveal delay={0.08}>
						<h1 className="type-display-small mb-1 font-bold text-white drop-shadow-[0_2px_0_rgba(0,0,0,0.5)] sm:type-display-medium">
							Inazuma Eleven Cross
						</h1>
						<p className="type-title-small mb-6 text-white/80 sm:type-title-medium">
							{crossData.site.title} — {crossData.site.subtitleFr}
						</p>
					</Reveal>

					{/* CTA proéminent « 6/9 サービス開始 / pré-enregistrement » */}
					<Reveal delay={0.16} className="flex flex-col items-center gap-3">
						<div className="flex flex-wrap items-center justify-center gap-3">
							<span
								className="rounded-full px-5 py-2 type-title-medium font-extrabold text-white shadow-[0_4px_0_0_rgba(0,0,0,0.4)]"
								style={{ backgroundColor: INAZUMA_CYAN }}
							>
								6/9 サービス開始
							</span>
							<span className="rounded-full bg-white/15 px-4 py-2 type-label-large font-bold text-white backdrop-blur">
								{status.phaseLabelFr}
							</span>
						</div>
						<p className="type-body-medium text-white/90">
							Lancement le {formatFrDate(status.serviceStart)} — pré-enregistrement ouvert
						</p>
					</Reveal>

					{/* Badges officiels App Store + Google Play (lien store). */}
					<Reveal delay={0.24} className="mt-6 flex flex-wrap items-center justify-center gap-3">
						<a
							href={APP_STORE}
							target="_blank"
							rel="noopener noreferrer"
							aria-label="Télécharger dans l'App Store"
							className="transition-transform hover:scale-105"
						>
							{/* badge Apple = SVG officiel, rendu en <img> (Next/Image n'optimise pas le SVG). */}
							{/* eslint-disable-next-line @next/next/no-img-element */}
							<img
								src={localImages.badgeAppStore}
								alt="Télécharger dans l'App Store"
								className="h-[52px] w-auto"
							/>
						</a>
						<a
							href={GOOGLE_PLAY}
							target="_blank"
							rel="noopener noreferrer"
							aria-label="Disponible sur Google Play"
							className="transition-transform hover:scale-105"
						>
							<Image
								src={localImages.badgeGooglePlay}
								alt="Disponible sur Google Play"
								width={172}
								height={52}
								unoptimized
								className="h-[52px] w-auto"
							/>
						</a>
					</Reveal>

					<Reveal delay={0.3} className="mt-4">
						<a
							href={OFFICIAL_SITE}
							target="_blank"
							rel="noopener noreferrer"
							className="rounded-full border border-white/40 px-5 py-2 type-label-large font-medium text-white transition-colors hover:bg-white/10"
						>
							Site officiel inazuma-cross.jp
						</a>
					</Reveal>
				</div>
			</section>

			{/* ===================== BANNIÈRE COLLAB SAMURAI BLUE ===================== */}
			<Reveal className="mb-12" as="section">
				<a
					href={samuraiBlue2026.url}
					target="_blank"
					rel="noopener noreferrer"
					className="group block overflow-hidden rounded-2xl border border-secondary/30 shadow-level-1 transition-transform hover:scale-[1.01]"
				>
					<div className="relative aspect-[1200/360]">
						<Image
							src={localImages.samuraiBlueBanner}
							alt="Projet Équipe Nationale du Japon 2026 — collaboration"
							fill
							sizes="100vw"
							className="object-cover transition-transform duration-500 group-hover:scale-105"
						/>
					</div>
				</a>
			</Reveal>

			{/* ===================== INTRODUCTION / HISTOIRE ===================== */}
			<section className="relative mb-12 overflow-hidden rounded-3xl">
				{/* fond décoratif intro (parallaxe légère via Ken Burns lent) */}
				<div className="absolute inset-0 -z-10">
					<KenBurns className="absolute inset-0">
						<Image
							src={localImages.introBg}
							alt=""
							fill
							sizes="100vw"
							className="object-cover opacity-[0.08]"
						/>
					</KenBurns>
				</div>
				<div className="p-1 sm:p-4">
					<Reveal>
						<h2 className="type-headline-medium mb-1 font-bold text-primary">
							{introduction.headingFr}
						</h2>
						<p className="mb-6 type-body-small text-on-surface-variant/60">
							D&apos;après la section « INTRODUCTION » d&apos;inazuma-cross.jp
						</p>
					</Reveal>
					<div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_320px]">
						<RevealGroup className="prose prose-lg max-w-none dark:prose-invert">
							{introduction.storyFr.split("Mais ").map((chunk, i) => (
								<RevealChild key={i}>
									<p className="type-body-large text-on-surface-variant">
										{i === 0 ? chunk : `Mais ${chunk}`}
									</p>
								</RevealChild>
							))}
						</RevealGroup>
						<Reveal blur amount={0.2}>
							<Float distance={6} duration={5}>
								<Card className="self-start overflow-hidden border-l-8 border-l-secondary bg-surface-container-low shadow-sm">
									<div className="relative aspect-[3/4] bg-surface-container-high">
										<Image
											src={protagonist.image ?? localImages.protagonist}
											alt={`${protagonist.nameRomaji} — protagoniste`}
											fill
											sizes="320px"
											className="object-contain"
										/>
									</div>
									<CardHeader>
										<CardTitle className="type-title-large">
											{protagonist.nameRomaji}
											<span className="ml-2 type-body-medium text-on-surface-variant">
												{protagonist.nameJa}
											</span>
										</CardTitle>
									</CardHeader>
									<CardContent>
										<Badge className="mb-3 bg-secondary-container text-on-secondary-container">
											Protagoniste
										</Badge>
										<p className="type-body-medium text-on-surface-variant">
											{protagonist.descriptionFr}
										</p>
									</CardContent>
								</Card>
							</Float>
						</Reveal>
					</div>
				</div>
			</section>

			{/* ===================== VIDÉOS (carousel comme le site) ===================== */}
			<section className="mb-12">
				<Reveal>
					<h2 className="type-headline-medium mb-1 font-bold text-primary">{movies.headingFr}</h2>
					<p className="mb-6 type-body-small text-on-surface-variant/60">
						D&apos;après la section « MOVIE » d&apos;inazuma-cross.jp — slider de vidéos officielles
					</p>
				</Reveal>
				<Reveal amount={0.15}>
					<Carousel
						count={movies.youtube.length}
						ariaLabel="Vidéos officielles Inazuma Eleven Cross"
						itemClassName="w-[280px] sm:w-[360px]"
					>
						{movies.youtube.map((m) => (
							<a
								key={m.id}
								href={`https://www.youtube.com/watch?v=${m.id}`}
								target="_blank"
								rel="noopener noreferrer"
								className="group block overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-low shadow-sm"
							>
								<div className="relative aspect-video bg-surface-container-high">
									<Image
										src={localImages.youtubeThumbs[m.id] ?? localImages.keyVisual}
										alt={m.labelFr}
										fill
										sizes="360px"
										className="object-cover transition-transform duration-500 group-hover:scale-105"
									/>
									<span className="absolute inset-0 flex items-center justify-center">
										<span className="flex size-14 items-center justify-center rounded-full bg-error/90 text-on-error shadow-level-2 transition-transform group-hover:scale-110">
											<Play className="size-6" fill="currentColor" />
										</span>
									</span>
								</div>
								<div className="px-4 py-3">
									<span className="type-body-large text-on-surface group-hover:text-primary">
										{m.labelFr}
									</span>
								</div>
							</a>
						))}
					</Carousel>
				</Reveal>
			</section>

			{/* ===================== SYSTÈME DE JEU ===================== */}
			<section className="mb-12">
				<Reveal>
					<h2 className="type-headline-medium mb-1 font-bold text-primary">{system.headingFr}</h2>
					<p className="mb-6 type-body-small text-on-surface-variant/60">{system.noteFr}</p>
				</Reveal>
				<RevealGroup className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
					{system.pillars.map((p, i) => (
						<RevealChild key={p.ja}>
							<Card className="h-full border-t-4 border-t-primary bg-surface-container-low shadow-sm transition-transform hover:-translate-y-1 hover:shadow-level-2">
								<CardContent className="p-5">
									<span className="mb-2 inline-block rounded-full bg-primary-container px-3 py-1 type-label-medium text-on-primary-container">
										{i + 1}
									</span>
									<p className="type-title-medium font-bold text-on-surface">{p.fr}</p>
									<p className="mt-1 type-body-small text-on-surface-variant/70">{p.ja}</p>
								</CardContent>
							</Card>
						</RevealChild>
					))}
				</RevealGroup>
				<div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
					<Reveal>
						<Card className="border-l-8 border-l-primary bg-surface-container-low shadow-sm">
							<CardHeader>
								<CardTitle className="flex items-center gap-3 type-title-large">
									<Image
										src={localImages.appicon}
										alt=""
										width={40}
										height={40}
										className="size-10 rounded-lg"
									/>
									Fiche technique
								</CardTitle>
							</CardHeader>
							<CardContent>
								<dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3">
									<dt className="type-label-large text-on-surface-variant">Titre</dt>
									<dd className="type-body-large text-on-surface">{spec.title}</dd>
									<dt className="type-label-large text-on-surface-variant">Genre</dt>
									<dd className="type-body-large text-on-surface">{spec.genreFr}</dd>
									<dt className="type-label-large text-on-surface-variant">Plateformes</dt>
									<dd className="type-body-large text-on-surface">{spec.platforms}</dd>
									<dt className="type-label-large text-on-surface-variant">Modèle</dt>
									<dd className="type-body-large text-on-surface">{spec.pricingFr}</dd>
									<dt className="type-label-large text-on-surface-variant">Sortie</dt>
									<dd className="type-body-large text-on-surface">
										{formatFrDate(status.serviceStart)}
									</dd>
									<dt className="type-label-large text-on-surface-variant">Studios</dt>
									<dd className="type-body-large text-on-surface">{spec.developers.join(" × ")}</dd>
								</dl>
								<p className="mt-4 type-body-small text-on-surface-variant/70">{status.noteFr}</p>
							</CardContent>
						</Card>
					</Reveal>
					<RevealGroup className="grid grid-cols-2 gap-3" stagger={0.12}>
						{localImages.systemScreenshots.map((src, i) => (
							<RevealChild key={src} blur>
								<div className="relative aspect-[9/16] overflow-hidden rounded-xl border border-outline-variant/30 bg-surface-container-high">
									<Image
										src={src}
										alt={`Capture d'écran ${i + 1}`}
										fill
										sizes="(max-width: 1024px) 45vw, 22vw"
										className="object-cover"
									/>
								</div>
							</RevealChild>
						))}
					</RevealGroup>
				</div>
				{/* Bandeaux texte system (assets du site) */}
				<RevealGroup className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3" stagger={0.1}>
					{localImages.systemText.map((src, i) => (
						<RevealChild key={src}>
							<div className="relative aspect-[16/6] overflow-hidden rounded-xl bg-surface-container-low">
								<Image
									src={src}
									alt={`Présentation système ${i + 1}`}
									fill
									sizes="(max-width: 640px) 100vw, 30vw"
									className="object-contain p-2"
								/>
							</div>
						</RevealChild>
					))}
				</RevealGroup>
			</section>

			{/* ===================== RÉCOMPENSES PRÉ-ENREGISTREMENT (stamp-pop) ===================== */}
			<section className="mb-12">
				<Reveal>
					<h2 className="type-headline-medium mb-2 font-bold text-primary">{rewards.headingFr}</h2>
					<p className="mb-6 type-body-large text-on-surface-variant">{rewards.noteFr}</p>
				</Reveal>
				<RevealGroup className="grid grid-cols-2 gap-4 md:grid-cols-4" stagger={0.12}>
					{localImages.rewardImages.map((src, i) => (
						<RevealChild key={src}>
							<div className="relative aspect-square overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-low shadow-sm">
								<Image
									src={src}
									alt={`Récompense de pré-enregistrement ${i + 1}`}
									fill
									sizes="(max-width: 768px) 45vw, 22vw"
									className="object-cover"
								/>
								{/* tampon « 達成 » (objectif atteint) — animé en stamp-pop, staggered */}
								<StampPop
									src={localImages.rewardBadge}
									alt="Objectif atteint"
									delay={0.4 + i * 0.15}
									className="absolute top-1/2 left-1/2 w-[55%] -translate-x-1/2 -translate-y-1/2"
								/>
							</div>
						</RevealChild>
					))}
				</RevealGroup>
				<div className="mt-6 flex flex-wrap gap-3">
					<a
						href={GOOGLE_PLAY}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex min-h-11 items-center gap-2 rounded-full bg-tertiary px-6 py-3 type-label-large font-medium text-on-tertiary shadow-level-1 transition-transform hover:scale-105"
					>
						S&apos;inscrire sur Google Play
					</a>
					<a
						href={APP_STORE}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex min-h-11 items-center gap-2 rounded-full border border-outline px-6 py-3 type-label-large font-medium text-on-surface transition-colors hover:bg-surface-container-high"
					>
						Réserver sur l&apos;App Store
					</a>
				</div>
			</section>

			{/* ===================== ACTUALITÉS / TWEETS RÉCENTS ===================== */}
			<section className="mb-12">
				<Reveal>
					<h2 className="type-headline-medium mb-1 font-bold text-primary">
						Actualités / Tweets récents
					</h2>
					<p className="mb-6 type-body-small text-on-surface-variant/60">{tweetsNote}</p>
				</Reveal>
				<RevealGroup className="grid grid-cols-1 gap-4 md:grid-cols-2" stagger={0.08}>
					{tweets.map((t) => (
						<RevealChild key={t.id}>
							<a
								href={t.url}
								target="_blank"
								rel="noopener noreferrer"
								className="group flex h-full flex-col gap-2 rounded-2xl border border-outline-variant/30 bg-surface-container-low p-5 transition-colors hover:bg-surface-container-high"
							>
								<div className="flex items-center justify-between gap-3">
									<span className="flex items-center gap-2 type-label-large text-primary">
										<span className="font-bold">@inazuma_cross</span>
									</span>
									<time className="type-label-medium text-on-surface-variant">
										{formatFrDate(t.date)}
									</time>
								</div>
								<p className="type-body-medium text-on-surface">{t.textFr}</p>
								<span className="mt-1 inline-flex items-center gap-1 type-label-medium text-on-surface-variant group-hover:text-primary">
									Voir le tweet <ExternalLink className="size-3.5" />
								</span>
							</a>
						</RevealChild>
					))}
				</RevealGroup>
			</section>

			{/* ===================== NEWS officielles du site ===================== */}
			<section className="mb-12">
				<Reveal>
					<h2 className="type-headline-medium mb-1 font-bold text-primary">Annonces officielles</h2>
					<p className="mb-6 type-body-small text-on-surface-variant/60">
						D&apos;après la section « お知らせ » d&apos;inazuma-cross.jp
					</p>
				</Reveal>
				<Reveal>
					<Card className="bg-surface-container-low shadow-sm">
						<CardContent className="divide-y divide-outline-variant/20 p-0">
							{news.map((item) => (
								<a
									key={`${item.date}-${item.titleJa}`}
									href={item.url}
									target="_blank"
									rel="noopener noreferrer"
									className="flex flex-col gap-1 px-5 py-4 transition-colors hover:bg-surface-container-high sm:flex-row sm:items-center sm:gap-4"
								>
									<time className="type-label-large shrink-0 text-primary">
										{formatFrDate(item.date)}
									</time>
									<span className="type-body-large text-on-surface">{item.titleFr}</span>
								</a>
							))}
						</CardContent>
					</Card>
				</Reveal>
			</section>

			{/* ===================== COLLABORATION SAMURAI BLUE 2026 ===================== */}
			<section className="mb-12">
				{/* Key visual de la page spéciale */}
				<Reveal blur className="mb-6 overflow-hidden rounded-3xl border-2 border-secondary/30 shadow-level-2">
					<div className="relative aspect-[16/9] bg-[#0c1730]">
						<Image
							src={localImages.samuraiBlueKeyVisual}
							alt="Projet Équipe Nationale du Japon 2026 — visuel principal"
							fill
							sizes="100vw"
							className="object-cover"
						/>
					</div>
				</Reveal>
				<Reveal>
					<h2 className="type-headline-medium mb-1 font-bold text-primary">
						{samuraiBlue2026.titleFr}
					</h2>
					<p className="mb-6 type-body-small text-on-surface-variant/60">
						D&apos;après{" "}
						<a
							href={samuraiBlue2026.url}
							target="_blank"
							rel="noopener noreferrer"
							className="underline underline-offset-2"
						>
							la page spéciale samuraiblue2026
						</a>{" "}
						d&apos;inazuma-cross.jp
					</p>
				</Reveal>
				<div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
					<div>
						<Reveal>
							<p className="mb-4 type-body-large text-on-surface-variant">
								{samuraiBlue2026.leadFr}
							</p>
							<p className="mb-4 type-body-medium text-on-surface-variant/80">
								Période : {samuraiBlue2026.eventPeriodFr}
							</p>
							<h3 className="mb-3 type-title-medium font-bold text-on-surface">
								{samuraiBlue2026.limitedCharactersHeadingFr}
							</h3>
						</Reveal>
						<RevealGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2" stagger={0.12}>
							{samuraiBlue2026.limitedCharacters.map((c) => (
								<RevealChild key={c.nameJa} blur>
									<Card className="h-full overflow-hidden border-l-8 border-l-secondary bg-surface-container-low shadow-sm transition-transform hover:-translate-y-1 hover:shadow-level-2">
										{c.image ? (
											<div className="relative aspect-[4/3] bg-[#0c1730]">
												<Image
													src={c.image}
													alt={c.nameFr}
													fill
													sizes="(max-width: 640px) 100vw, 320px"
													className="object-contain"
												/>
											</div>
										) : null}
										<CardHeader>
											<CardTitle className="flex items-center gap-2 type-title-medium">
												{c.icon ? (
													<Image
														src={c.icon}
														alt=""
														width={28}
														height={28}
														className="size-7 rounded-full"
													/>
												) : null}
												<Badge className="bg-primary text-on-primary">{c.position}</Badge>
												{c.nameFr}
											</CardTitle>
										</CardHeader>
										<CardContent>
											<p className="mb-2 type-label-large text-on-surface-variant">{c.tagFr}</p>
											{c.hissatsuImages && c.hissatsuImages.length > 0 ? (
												<div className="mb-3 grid grid-cols-2 gap-2">
													{c.hissatsuImages.map((img, j) => (
														<div
															key={img}
															className="relative aspect-video overflow-hidden rounded-lg border border-outline-variant/30 bg-surface-container-high"
														>
															<Image
																src={img}
																alt={`${c.skillsFr[j] ?? "Technique spéciale"} — ${c.nameFr}`}
																fill
																sizes="160px"
																className="object-cover"
															/>
														</div>
													))}
												</div>
											) : null}
											<ul className="list-inside list-disc type-body-medium text-on-surface-variant">
												{c.skillsFr.map((s) => (
													<li key={s}>{s}</li>
												))}
											</ul>
										</CardContent>
									</Card>
								</RevealChild>
							))}
						</RevealGroup>
						<Reveal>
							<p className="mt-4 type-body-medium text-on-surface-variant">
								{samuraiBlue2026.designNoteFr}
							</p>
							<p className="mt-1 type-body-small italic text-on-surface-variant/70">
								{samuraiBlue2026.catchFr}
							</p>
						</Reveal>
					</div>
					<Reveal blur amount={0.2}>
						<Float distance={8} duration={6}>
							<div className="self-start overflow-hidden rounded-2xl border border-outline-variant/30 bg-[#0c1730]">
								<div className="relative aspect-square">
									<Image
										src={localImages.samuraiBlueCharacter}
										alt="Mark Evans et Jude Sharp en uniforme de l'équipe nationale du Japon"
										fill
										sizes="360px"
										className="object-contain"
									/>
								</div>
							</div>
						</Float>
					</Reveal>
				</div>

				{/* Slider des uniformes (wear item) — carousel comme le site */}
				<Reveal className="mt-8">
					<h3 className="mb-3 type-title-medium font-bold text-on-surface">
						{samuraiBlue2026.wearItem.headingFr}
					</h3>
					<p className="mb-4 type-body-medium text-on-surface-variant">
						{samuraiBlue2026.wearItem.descriptionFr}
					</p>
				</Reveal>
				<Reveal amount={0.15}>
					<Carousel
						count={localImages.samuraiBlueSlides.length}
						ariaLabel="Uniformes de l'équipe nationale du Japon"
						itemClassName="w-[240px] sm:w-[300px]"
					>
						{localImages.samuraiBlueSlides.map((src, i) => (
							<div
								key={src}
								className="relative aspect-[3/4] overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-high"
							>
								<Image
									src={src}
									alt={`Uniforme ${i + 1}`}
									fill
									sizes="300px"
									className="object-cover"
								/>
							</div>
						))}
					</Carousel>
				</Reveal>

				{/* Détails collab : login bonus + objet lounge + pub */}
				<RevealGroup className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3" stagger={0.1}>
					<RevealChild>
						<Card className="h-full overflow-hidden bg-surface-container-low shadow-sm">
							<div className="relative aspect-video bg-surface-container-high">
								<Image
									src={localImages.samuraiBlueItems}
									alt="Objet du Cross Lounge offert (bonus de connexion)"
									fill
									sizes="(max-width: 768px) 100vw, 33vw"
									className="object-cover"
								/>
							</div>
							<CardHeader>
								<CardTitle className="type-title-small">
									{samuraiBlue2026.loginBonus.headingFr}
								</CardTitle>
							</CardHeader>
							<CardContent>
								<p className="type-body-medium text-on-surface-variant">
									{samuraiBlue2026.loginBonus.descriptionFr}
								</p>
								<p className="mt-2 type-body-small text-on-surface-variant/70">
									{samuraiBlue2026.loginBonus.periodFr}
								</p>
							</CardContent>
						</Card>
					</RevealChild>
					<RevealChild>
						<Card className="h-full bg-surface-container-low shadow-sm">
							<CardHeader>
								<CardTitle className="type-title-small">
									{samuraiBlue2026.advertisement.headingFr}
								</CardTitle>
							</CardHeader>
							<CardContent>
								<p className="type-body-medium text-on-surface-variant">
									{samuraiBlue2026.advertisement.outdoorFr}
								</p>
								<p className="mt-2 type-body-medium text-on-surface-variant">
									{samuraiBlue2026.advertisement.adTruckFr}
								</p>
							</CardContent>
						</Card>
					</RevealChild>
					<RevealChild>
						<Card className="h-full overflow-hidden bg-surface-container-low shadow-sm">
							<div className="grid grid-cols-2 gap-px">
								{localImages.samuraiBlueAds.map((src, i) => (
									<div key={src} className="relative aspect-[4/3] bg-surface-container-high">
										<Image
											src={src}
											alt={`Visuel publicitaire ${i + 1}`}
											fill
											sizes="(max-width: 768px) 50vw, 16vw"
											className="object-cover"
										/>
									</div>
								))}
							</div>
							<CardHeader>
								<CardTitle className="type-title-small">Affichage urbain</CardTitle>
							</CardHeader>
							<CardContent>
								<p className="type-body-medium text-on-surface-variant">
									{samuraiBlue2026.advertisement.outdoorFr}
								</p>
							</CardContent>
						</Card>
					</RevealChild>
				</RevealGroup>
			</section>

			{/* ===================== RAPPORT BÊTA FERMÉE (CBT) ===================== */}
			<section className="mb-12">
				<Reveal blur className="mb-6 overflow-hidden rounded-3xl border border-tertiary/30 shadow-level-1">
					<div className="relative aspect-[16/7] bg-surface-container-high">
						<Image
							src={localImages.cbtBanner}
							alt="Rapport d'enquête de la bêta fermée"
							fill
							sizes="100vw"
							className="object-cover"
						/>
					</div>
				</Reveal>
				<Reveal>
					<h2 className="type-headline-medium mb-1 font-bold text-primary">
						{cbtReport.headingFr}
					</h2>
					<p className="mb-6 type-body-small text-on-surface-variant/60">
						D&apos;après{" "}
						<a
							href={cbtReport.url}
							target="_blank"
							rel="noopener noreferrer"
							className="underline underline-offset-2"
						>
							la page « cbt-report »
						</a>{" "}
						d&apos;inazuma-cross.jp
					</p>
					<p className="mb-6 type-body-large text-on-surface-variant">{cbtReport.introFr}</p>
				</Reveal>

				<Reveal>
					<h3 className="mb-3 type-title-medium font-bold text-on-surface">
						Contenus testés (modes de jeu)
					</h3>
				</Reveal>
				<RevealGroup className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2" stagger={0.1}>
					{cbtReport.modes.map((m, i) => (
						<RevealChild key={m.nameJa}>
							<Card className="h-full overflow-hidden border-l-4 border-l-tertiary bg-surface-container-low shadow-sm">
								{localImages.cbtScreenshots[i * 2] ? (
									<div className="grid grid-cols-2 gap-px">
										{[localImages.cbtScreenshots[i * 2], localImages.cbtScreenshots[i * 2 + 1]]
											.filter(Boolean)
											.map((src) => (
												<div
													key={src}
													className="relative aspect-[16/9] bg-surface-container-high"
												>
													<Image
														src={src as string}
														alt={`Capture — ${m.nameFr}`}
														fill
														sizes="(max-width: 640px) 50vw, 25vw"
														className="object-cover"
													/>
												</div>
											))}
									</div>
								) : null}
								<CardHeader>
									<CardTitle className="type-title-small">
										{m.nameFr}
										<span className="ml-2 type-body-small text-on-surface-variant">{m.nameJa}</span>
									</CardTitle>
								</CardHeader>
								<CardContent>
									<p className="type-body-medium text-on-surface-variant">{m.descFr}</p>
								</CardContent>
							</Card>
						</RevealChild>
					))}
				</RevealGroup>

				<Reveal>
					<h3 className="mb-3 type-title-medium font-bold text-on-surface">
						Principaux ajustements prévus avant le lancement
					</h3>
				</Reveal>
				<Reveal>
					<Card className="bg-surface-container-low shadow-sm">
						<CardContent className="p-5">
							<ul className="list-inside list-disc space-y-2 type-body-medium text-on-surface-variant">
								{cbtReport.plannedAdjustmentsFr.map((a) => (
									<li key={a}>{a}</li>
								))}
							</ul>
						</CardContent>
					</Card>
				</Reveal>

				{/* Bilan / classement de progression */}
				<RevealGroup className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2" stagger={0.12}>
					<RevealChild>
						<div className="relative aspect-video overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-high">
							<Image
								src={localImages.cbtResults}
								alt="Bilan des résultats de la bêta fermée"
								fill
								sizes="(max-width: 768px) 100vw, 45vw"
								className="object-contain"
							/>
						</div>
					</RevealChild>
					<RevealChild>
						<div className="relative aspect-video overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-high">
							<Image
								src={localImages.cbtProgressRanking}
								alt="Classement de progression de la bêta fermée"
								fill
								sizes="(max-width: 768px) 100vw, 45vw"
								className="object-contain"
							/>
						</div>
					</RevealChild>
				</RevealGroup>
			</section>

			{/* ===================== DEMONSTRATION DES ASSETS VERIFIES (POC) ===================== */}
			<section className="mb-12">
				<Reveal>
					<h2 className="type-headline-medium mb-1 font-bold text-primary">
						Démonstrateur d'Assets & Preuve de Concept
					</h2>
					<p className="mb-6 type-body-small text-on-surface-variant/60">
						Visualisation des ressources (images, rendus, structures 3D) extraites directement du client de jeu Inazuma Eleven Cross
					</p>
				</Reveal>
				<Reveal>
					<CrossGallery />
				</Reveal>
			</section>

			{/* ===================== LIENS OFFICIELS + bannières footer ===================== */}
			<section>
				<Reveal>
					<h2 className="type-headline-medium mb-6 font-bold text-primary">Liens officiels</h2>
				</Reveal>
				{/* Bannières du footer du site officiel */}
				<RevealGroup
					className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
					stagger={0.08}
				>
					{[
						{ src: localImages.footerBanners.youtube, href: "https://www.youtube.com/playlist?list=PLlapDTT9GR4Q7HVHLMn_-wUB-cZM3TLpB", label: "YouTube anime" },
						{ src: localImages.footerBanners.x, href: X_ACCOUNT, label: "X officiel" },
						{ src: localImages.footerBanners.report, href: cbtReport.url, label: "Rapport CBT" },
						{ src: localImages.footerBanners.inazuma, href: "https://www.inazuma.jp/", label: "Inazuma.jp" },
						{ src: localImages.footerBanners.victoryRoad, href: "https://www.inazuma.jp/victory-road/", label: "Victory Road" },
					].map((b) => (
						<RevealChild key={b.href}>
							<a
								href={b.href}
								target="_blank"
								rel="noopener noreferrer"
								className="group block overflow-hidden rounded-xl border border-outline-variant/30 bg-surface-container-low shadow-sm transition-transform hover:scale-[1.03]"
							>
								<div className="relative aspect-[3/1]">
									<Image
										src={b.src}
										alt={b.label}
										fill
										sizes="(max-width: 640px) 45vw, 20vw"
										className="object-cover"
									/>
								</div>
							</a>
						</RevealChild>
					))}
				</RevealGroup>
				<Reveal className="flex flex-wrap gap-3">
					<a
						href={OFFICIAL_SITE}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex min-h-11 items-center rounded-full border border-outline px-5 py-2.5 type-label-large text-on-surface transition-colors hover:bg-surface-container-high sm:min-h-0"
					>
						Site officiel
					</a>
					<a
						href={X_ACCOUNT}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex min-h-11 items-center rounded-full border border-outline px-5 py-2.5 type-label-large text-on-surface transition-colors hover:bg-surface-container-high sm:min-h-0"
					>
						X @inazuma_cross
					</a>
					<a
						href={YT_PLAYLIST}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex min-h-11 items-center rounded-full border border-outline px-5 py-2.5 type-label-large text-on-surface transition-colors hover:bg-surface-container-high sm:min-h-0"
					>
						Playlist YouTube
					</a>
					<a
						href={GOOGLE_PLAY}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex min-h-11 items-center rounded-full border border-outline px-5 py-2.5 type-label-large text-on-surface transition-colors hover:bg-surface-container-high sm:min-h-0"
					>
						Google Play (pré-enregistrement)
					</a>
					<a
						href={APP_STORE}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex min-h-11 items-center rounded-full border border-outline px-5 py-2.5 type-label-large text-on-surface transition-colors hover:bg-surface-container-high sm:min-h-0"
					>
						App Store (réservation)
					</a>
				</Reveal>
				<Reveal className="mt-8 flex items-center gap-6">
					<a href="https://www.level5.co.jp/" target="_blank" rel="noopener noreferrer">
						<Image
							src={localImages.logoLevel5}
							alt="Level-5"
							width={120}
							height={40}
							className="h-8 w-auto opacity-80 transition-opacity hover:opacity-100"
						/>
					</a>
					<a href="https://aiming-inc.com/" target="_blank" rel="noopener noreferrer">
						<Image
							src={localImages.logoAiming}
							alt="Aiming"
							width={120}
							height={40}
							className="h-8 w-auto opacity-80 transition-opacity hover:opacity-100"
						/>
					</a>
				</Reveal>
				<p className="mt-6 type-body-small text-on-surface-variant/60">{disclaimerFr}</p>
				<p className="mt-2 type-body-small text-on-surface-variant/60">{spec.copyright}</p>
				<p className="type-body-small text-on-surface-variant/60">{spec.collabCopyright}</p>
			</section>
		</div>
	);
}
