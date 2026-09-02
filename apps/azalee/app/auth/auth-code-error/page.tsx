import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@rosegriffon/ui";

export const metadata: Metadata = {
	robots: { index: false },
	title: "Erreur d'authentification - Azalée",
};

export default function AuthCodeError() {
	return (
		<div className="flex h-screen w-full flex-col items-center justify-center gap-4 text-center bg-surface p-4">
			<h1 className="text-4xl font-bold font-sans text-on-surface">Oups !</h1>
			<p className="text-on-surface-variant max-w-md">
				Une erreur est survenue lors de l&apos;authentification. Le lien a peut-être expiré ou a
				déjà été utilisé.
			</p>
			<Link href="/">
				<Button className="rounded-full">Retour à l&apos;accueil</Button>
			</Link>
		</div>
	);
}
