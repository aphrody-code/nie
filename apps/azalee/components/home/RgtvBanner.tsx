import Image from "next/image";

import { Button, Card, CardContent } from "@rosegriffon/ui";

export interface RgtvBannerProps {
	title?: string;
	subtitle?: string;
	description?: string;
	image?: string;
	buttonText?: string;
	link?: string;
}

const STRIPE_PATTERN =
	"repeating-linear-gradient(-45deg, #6b3d1b, #6b3d1b 20px, transparent 20px, transparent 40px)";

function RgBadge({ subtitle, className }: { subtitle: string; className?: string }) {
	return (
		<div
			className={`inline-flex items-center gap-2 rounded-full bg-white/10 text-white font-black uppercase tracking-wide ${className}`}
		>
			<Image src="/rg.webp" alt="" width={16} height={16} className="size-4 object-contain" />
			{subtitle}
		</div>
	);
}

function RgTitle({ title }: { title: string }) {
	return (
		<h2
			className="font-black text-white leading-none"
			style={{
				fontFamily: '"Super Cartoon", system-ui',
				textShadow: "2px 2px 0px #000",
			}}
		>
			{title}
		</h2>
	);
}

function RgButton({ link, buttonText }: { link: string; buttonText: string }) {
	return (
		<Button
			asChild
			size="lg"
			className="bg-white text-[#8B5023] hover:bg-white/90 font-black rounded-xl shadow-[4px_4px_0px_0px_#6b3d1b] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_0px_#6b3d1b] transition-all duration-200 border-2 border-white cursor-pointer"
		>
			<a href={link} target="_blank" rel="noopener noreferrer">
				<Image
					src="/rg.webp"
					alt=""
					width={18}
					height={18}
					className="mr-2 w-4.5 h-4.5 object-contain"
				/>
				{buttonText}
			</a>
		</Button>
	);
}

export function RgtvBanner({
	title = "Rose Griffon",
	subtitle = "Hub RG",
	description = "Découvrez l'univers de l'association Rose Griffon : actualités, événements, et notre communauté passionnée d'Inazuma Eleven.",
	image = "/rgtv/twitch-banner.webp",
	buttonText = "VOIR LE SITE WEB",
	link = "https://rosegriffon.fr",
}: RgtvBannerProps) {
	return (
		<div className="w-full">
			{/* ── Mobile: image-as-background, full-bleed ── */}
			<div className="md:hidden -mx-4 relative overflow-hidden">
				<Image src={image} alt={title} fill className="object-cover object-top" sizes="100vw" />
				<div className="absolute inset-0 bg-linear-to-t from-[#8B5023]/90 via-[#8B5023]/60 to-[#8B5023]/30" />
				<div
					className="absolute inset-0 pointer-events-none opacity-10"
					style={{ background: STRIPE_PATTERN }}
				/>

				<div className="relative z-10 p-5 flex flex-col gap-4">
					<RgBadge subtitle={subtitle} className="px-3 py-1 text-[10px] border border-white/20" />
					<div className="text-3xl xs:text-4xl">
						<RgTitle title={title} />
					</div>
					<p className="text-white/90 text-sm leading-relaxed font-bold line-clamp-2 max-w-[min(90vw,400px)]">
						{description}
					</p>
					<div className="w-full">
						<RgButton link={link} buttonText={buttonText} />
					</div>
				</div>
			</div>

			{/* ── Desktop: side-by-side grid ── */}
			<Card className="hidden md:block overflow-hidden border-none shadow-xl bg-[#8B5023] relative group rounded-[32px] p-0">
				<div
					className="absolute inset-0 z-0 pointer-events-none opacity-10"
					style={{ background: STRIPE_PATTERN }}
				/>

				<div className="grid md:grid-cols-2 gap-0 relative z-20">
					<div className="relative h-auto w-full overflow-hidden">
						<div className="absolute inset-0 bg-linear-to-r from-[#8B5023] via-transparent to-transparent z-10" />
						<Image
							src={image}
							alt={title}
							fill
							className="object-cover object-top transition-transform duration-700 group-hover:scale-105"
							sizes="50vw"
						/>
					</div>

					<CardContent className="p-8 md:p-12 flex flex-col justify-center space-y-6 bg-transparent relative">
						<div className="space-y-3">
							<RgBadge
								subtitle={subtitle}
								className="px-4 py-1.5 text-xs border-2 border-white/20 shadow-lg transform -rotate-2"
							/>
							<div className="text-5xl md:text-6xl lg:text-7xl">
								<RgTitle title={title} />
							</div>
						</div>
						<p className="text-white/90 text-lg leading-relaxed max-w-md font-bold">
							{description}
						</p>
						<div className="flex justify-start pt-2">
							<div className="w-full sm:w-auto px-0">
								<RgButton link={link} buttonText={buttonText} />
							</div>
						</div>
					</CardContent>
				</div>
			</Card>
		</div>
	);
}
