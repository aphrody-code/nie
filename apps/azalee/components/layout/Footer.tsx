import Link from "next/link";

const socialLinkClass =
	"group relative p-2.5 rounded-full bg-surface-container-high hover:scale-110 hover:shadow-lg transition-all duration-300 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 active:scale-95";
const socialIconClass =
	"size-[18px] text-on-surface-variant group-hover:text-white transition-colors duration-300";

export function Footer() {
	return (
		<footer className="bg-surface-container border-t border-outline-variant/5 w-full mt-auto">
			<div className="mx-auto w-full max-w-[1800px] px-4 md:px-8 lg:px-12 py-6 lg:py-12">
				{/* Liens - grille 2 colonnes sur mobile, 4 sur desktop */}
				<div className="grid grid-cols-2 lg:grid-cols-4 gap-6 md:gap-12 text-left">
					{/* L'ASSOCIATION */}
					<div className="flex flex-col gap-2">
						<h3 className="text-xs font-bold text-on-surface uppercase tracking-wider mb-1">
							L&apos;association
						</h3>
						<Link
							href="/charte"
							className="text-sm text-on-surface-variant hover:text-primary hover:underline transition-colors rounded-sm"
						>
							Charte et engagements
						</Link>
						<Link
							href="https://www.journal-officiel.gouv.fr/pages/associations-detail-annonce/?q.id=id:202400200922"
							target="_blank"
							rel="noopener noreferrer"
							className="text-sm text-on-surface-variant hover:text-primary hover:underline transition-colors rounded-sm"
						>
							Numéro RNA
						</Link>
					</div>

					{/* CONTACT */}
					<div className="flex flex-col gap-2">
						<h3 className="text-xs font-bold text-on-surface uppercase tracking-wider mb-1">
							Contact
						</h3>
						<Link
							href="/contact"
							className="text-sm text-on-surface-variant hover:text-primary hover:underline transition-colors rounded-sm"
						>
							Nous contacter
						</Link>
						<Link
							href="/soutenir"
							className="text-sm text-on-surface-variant hover:text-primary hover:underline transition-colors rounded-sm"
						>
							Nous soutenir
						</Link>
					</div>

					{/* INFOS LEGALES */}
					<div className="flex flex-col gap-2">
						<h3 className="text-xs font-bold text-on-surface uppercase tracking-wider mb-1">
							Infos légales
						</h3>
						<Link
							href="/legal/mentions-legales"
							className="text-sm text-on-surface-variant hover:text-primary hover:underline transition-colors rounded-sm"
						>
							Mentions légales
						</Link>
						<Link
							href="/legal/cgu"
							className="text-sm text-on-surface-variant hover:text-primary hover:underline transition-colors rounded-sm"
						>
							CGU
						</Link>
						<Link
							href="/legal/confidentialite"
							className="text-sm text-on-surface-variant hover:text-primary hover:underline transition-colors rounded-sm"
						>
							Confidentialité
						</Link>
					</div>

					{/* SUIVEZ-NOUS */}
					<div className="flex flex-col gap-3">
						<h3 className="text-xs font-bold text-on-surface uppercase tracking-wider">
							Suivez-nous
						</h3>

						{/* Azalée */}
						<div className="space-y-1.5">
							<p className="text-[10px] font-black text-primary uppercase tracking-[0.15em]">
								Azalée
							</p>
							<div className="flex flex-wrap gap-2">
								<Link
									href="https://x.com/Azalee_IE"
									target="_blank"
									rel="noopener noreferrer"
									className={`${socialLinkClass} hover:bg-black`}
									aria-label="X (Twitter) Azalée"
								>
									<svg viewBox="0 0 24 24" className={socialIconClass} fill="currentColor">
										<path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
									</svg>
								</Link>
								<Link
									href="https://www.instagram.com/azaleefr"
									target="_blank"
									rel="noopener noreferrer"
									className={`${socialLinkClass} hover:bg-linear-to-tr hover:from-[#FD5949] hover:via-[#D6249F] hover:to-[#285AEB]`}
									aria-label="Instagram Azalée"
								>
									<svg viewBox="0 0 24 24" className={socialIconClass} fill="currentColor">
										<path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
									</svg>
								</Link>
							</div>
						</div>

						{/* Association */}
						<div className="space-y-1.5">
							<p className="text-[10px] font-black text-on-surface-variant uppercase tracking-[0.15em]">
								Association
							</p>
							<div className="flex flex-wrap gap-2">
								<Link
									href="https://x.com/rose_griffon"
									target="_blank"
									rel="noopener noreferrer"
									className={`${socialLinkClass} hover:bg-black`}
									aria-label="X (Twitter) Rose Griffon"
								>
									<svg viewBox="0 0 24 24" className={socialIconClass} fill="currentColor">
										<path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
									</svg>
								</Link>
								<Link
									href="https://discord.com/servers/rose-griffon-inazuma-eleven-fr-1072991720268111892"
									target="_blank"
									rel="noopener noreferrer"
									className={`${socialLinkClass} hover:bg-[#5865F2]`}
									aria-label="Discord"
								>
									<svg viewBox="0 0 24 24" className={socialIconClass} fill="currentColor">
										<path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
									</svg>
								</Link>
								<Link
									href="https://twitch.tv/rose_griffontv"
									target="_blank"
									rel="noopener noreferrer"
									className={`${socialLinkClass} hover:bg-[#9146FF]`}
									aria-label="Twitch RoseGriffonTV"
								>
									<svg viewBox="0 0 24 24" className={socialIconClass} fill="currentColor">
										<path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
									</svg>
								</Link>
								<Link
									href="https://www.youtube.com/@RoseGriffon"
									target="_blank"
									rel="noopener noreferrer"
									className={`${socialLinkClass} hover:bg-[#FF0000]`}
									aria-label="YouTube Rose Griffon"
								>
									<svg viewBox="0 0 24 24" className={socialIconClass} fill="currentColor">
										<path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z" />
									</svg>
								</Link>
								<Link
									href="https://www.instagram.com/rose_griffonfr"
									target="_blank"
									rel="noopener noreferrer"
									className={`${socialLinkClass} hover:bg-linear-to-tr hover:from-[#FD5949] hover:via-[#D6249F] hover:to-[#285AEB]`}
									aria-label="Instagram Rose Griffon France"
								>
									<svg viewBox="0 0 24 24" className={socialIconClass} fill="currentColor">
										<path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
									</svg>
								</Link>
							</div>
						</div>
					</div>
				</div>

				<div className="mt-6 pt-6 border-t border-outline-variant/10 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-on-surface-variant">
					<p>Rose Griffon © 2026 - Association loi 1901. Tous droits réservés.</p>
					<a
						href="https://x.com/yoyo__goat"
						target="_blank"
						rel="author me noopener noreferrer"
						className="opacity-60 hover:opacity-100 transition-opacity hover:text-primary inline-flex items-center gap-1"
						title="Conçu et développé par yoyo"
					>
						<span>Conçu et développé par yoyo</span>
					</a>
				</div>
			</div>
		</footer>
	);
}
