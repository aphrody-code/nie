"use client";

import { Bell, BellOff } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { subscribeToPush, unsubscribeFromPush } from "@/app/actions/notifications";
import { useAuth } from "@/components/providers/AuthProvider";

export function PushOptIn() {
	const { user } = useAuth();
	const [subscribed, setSubscribed] = useState(false);
	const [supported, setSupported] = useState(false);
	const [isPending, startTransition] = useTransition();

	useEffect(() => {
		if (!user) {
			return;
		}
		const check = async () => {
			if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
				return;
			}
			setSupported(true);

			const reg = await navigator.serviceWorker.getRegistration("/sw.js");
			if (reg) {
				const sub = await reg.pushManager.getSubscription();
				setSubscribed(Boolean(sub));
			}
		};
		check();
	}, [user]);

	if (!user || !supported) {
		return null;
	}

	const handleToggle = () => {
		startTransition(async () => {
			try {
				if (subscribed) {
					const reg = await navigator.serviceWorker.getRegistration("/sw.js");
					const sub = await reg?.pushManager.getSubscription();
					if (sub) {
						await sub.unsubscribe();
						await unsubscribeFromPush(sub.endpoint);
					}
					setSubscribed(false);
					toast.success("Notifications désactivées");
				} else {
					const reg = await navigator.serviceWorker.register("/sw.js");
					const sub = await reg.pushManager.subscribe({
						applicationServerKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
						userVisibleOnly: true,
					});
					const json = sub.toJSON();
					await subscribeToPush({
						endpoint: sub.endpoint,
						keys: {
							auth: json.keys?.auth || "",
							p256dh: json.keys?.p256dh || "",
						},
					});
					setSubscribed(true);
					toast.success("Notifications activées !");
				}
			} catch {
				toast.error("Erreur lors de la gestion des notifications");
			}
		});
	};

	return (
		<button
			onClick={handleToggle}
			disabled={isPending}
			className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium transition-all bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest"
		>
			{subscribed ? (
				<>
					<BellOff className="size-4" />
					Notifications activées
				</>
			) : (
				<>
					<Bell className="size-4" />
					Recevoir les notifications
				</>
			)}
		</button>
	);
}
