import { Geist, Geist_Mono } from "next/font/google";

const geistSans = Geist({
	subsets: ["latin"],
	variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
	subsets: ["latin"],
	variable: "--font-geist-mono",
});

export default function MaintenancePage() {
	return (
		<div
			className={`${geistSans.variable} ${geistMono.variable} flex min-h-screen flex-col items-center justify-center bg-[#1a120d] text-[#ede0db] p-4 text-center font-sans`}
		>
			<h1 className="mb-4 text-4xl font-extrabold tracking-tight lg:text-5xl text-[#ffc66c]">
				Azalée en maintenance
			</h1>
			<p className="max-w-[600px] text-lg text-[#d7c3b7] sm:text-xl">
				Le Wiki Azalée est actuellement en cours de mise à jour. Nous revenons très vite avec de
				nouvelles données sur Victory Road !
			</p>
			<div className="mt-8 h-1 w-24 bg-[#ffc66c] rounded-full animate-pulse" />
		</div>
	);
}
