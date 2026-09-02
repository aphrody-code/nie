"use client";

import { Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { LoginForm } from "@/components/auth/login-form";
import { useAuth } from "@/components/providers/AuthProvider";

function LoginContent() {
	const searchParams = useSearchParams();
	const { user, loading } = useAuth();
	const returnTo = searchParams.get("returnTo") || undefined;
	const [redirecting, setRedirecting] = useState(false);
	const [timedOut, setTimedOut] = useState(false);

	// Safety timeout: if loading takes more than 5s, show the form anyway
	useEffect(() => {
		const timer = setTimeout(() => setTimedOut(true), 5000);
		return () => clearTimeout(timer);
	}, []);

	useEffect(() => {
		if (!loading && user && !redirecting) {
			setRedirecting(true);
			// Le résolveur serveur décide /dashboard (admin) vs returnTo selon le rôle
			// réel en base — pas de race sur un isAdmin client pas encore chargé.
			const dest = returnTo
				? `/auth/post-login?returnTo=${encodeURIComponent(returnTo)}`
				: "/auth/post-login";
			// Full navigation to ensure cookies are sent properly.
			window.location.href = dest;
		}
	}, [user, loading, returnTo, redirecting]);

	if ((loading && !timedOut) || (user && redirecting)) {
		return (
			<div className="flex min-h-screen w-full items-center justify-center bg-surface-container-low p-4">
				<Loader2 className="size-8 animate-spin text-primary" />
			</div>
		);
	}

	return (
		<div className="flex min-h-screen w-full items-center justify-center bg-surface-container-low p-4">
			<div className="w-full max-w-[440px] overflow-hidden">
				{/* Card */}
				<div className="bg-surface-container-lowest rounded-[28px] elevation-2 overflow-hidden">
					{/* Header */}
					<div className="relative px-8 pt-10 pb-8 text-center overflow-hidden">
						{/* Background accent */}
						<div className="absolute inset-0 bg-linear-to-b from-primary/5 to-transparent" />

						<div className="relative">
							{/* Logo */}
							<div className="mb-5 flex justify-center">
								<div className="relative">
									<h1 className="type-display-small font-black italic tracking-tighter text-on-surface">
										AZALÉE
									</h1>
									<div className="absolute -bottom-1 left-0 right-0 h-1 bg-linear-to-r from-primary via-secondary to-primary rounded-full" />
								</div>
							</div>

							{/* Title */}
							<h2 className="type-headline-small text-on-surface mb-1">Connexion</h2>
							<p className="type-body-medium text-on-surface-variant">Accède à ton compte Azalée</p>
						</div>
					</div>

					{/* Form */}
					<div className="px-8 pb-8">
						<LoginForm returnTo={returnTo} />
					</div>
				</div>

				{/* External footer */}
				<p className="type-body-small text-center text-on-surface-variant/60 mt-6">
					Azalée &mdash; Rose Griffon
				</p>
			</div>
		</div>
	);
}

export default function LoginPage() {
	return (
		<Suspense>
			<LoginContent />
		</Suspense>
	);
}
