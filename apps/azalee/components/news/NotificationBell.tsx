"use client";

import { Bell, CheckCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getNotifications, getUnreadCount, markAllAsRead } from "@/app/actions/notifications";
import { NotificationItem } from "@/components/news/NotificationItem";
import { useAuth } from "@/components/providers/AuthProvider";
import { Popover, PopoverContent, PopoverTrigger } from "@rosegriffon/ui";
import { cn } from "@/lib/utils";

export function NotificationBell({ className }: { className?: string }) {
	const { user } = useAuth();
	const [unreadCount, setUnreadCount] = useState(0);
	const [notifications, setNotifications] = useState<Awaited<ReturnType<typeof getNotifications>>>(
		[]
	);
	const [open, setOpen] = useState(false);
	const mountedRef = useRef(false);

	const fetchUnread = useCallback(async () => {
		if (!user) {
			return;
		}
		const count = await getUnreadCount();
		setUnreadCount(count);
	}, [user]);

	useEffect(() => {
		// Skip initial render to avoid lint warning about setState in effect
		if (!mountedRef.current) {
			mountedRef.current = true;
			fetchUnread();
		}
		const interval = setInterval(fetchUnread, 60_000);
		return () => clearInterval(interval);
	}, [fetchUnread]);

	const handleOpen = async (isOpen: boolean) => {
		setOpen(isOpen);
		if (isOpen && user) {
			const data = await getNotifications(15);
			setNotifications(data);
		}
	};

	const handleMarkAllRead = async () => {
		await markAllAsRead();
		setUnreadCount(0);
		setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
	};

	if (!user) {
		return null;
	}

	return (
		<Popover open={open} onOpenChange={handleOpen}>
			<PopoverTrigger asChild>
				<button
					className={cn(
						"relative size-12 md:size-10 rounded-full flex items-center justify-center hover:bg-surface-container-high transition-colors",
						className
					)}
					aria-label="Notifications"
				>
					<Bell className="size-6 md:size-5 text-on-surface-variant" />
					{unreadCount > 0 && (
						<span className="absolute top-0.5 right-0.5 size-4 rounded-full bg-error text-on-error text-[10px] font-bold flex items-center justify-center">
							{unreadCount > 9 ? "9+" : unreadCount}
						</span>
					)}
				</button>
			</PopoverTrigger>
			<PopoverContent
				className="w-80 p-0 rounded-2xl bg-surface-container-high border-none shadow-xl"
				align="end"
			>
				<div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant/10">
					<h3 className="text-sm font-bold text-on-surface">Notifications</h3>
					{unreadCount > 0 && (
						<button
							onClick={handleMarkAllRead}
							className="text-[10px] text-primary font-medium hover:underline inline-flex items-center gap-1"
						>
							<CheckCheck className="size-3" />
							Tout marquer comme lu
						</button>
					)}
				</div>
				<div className="max-h-80 overflow-y-auto p-1.5">
					{notifications.length === 0 ? (
						<div className="py-8 text-center">
							<Bell className="size-8 text-on-surface-variant/20 mx-auto mb-2" />
							<p className="text-sm text-on-surface-variant/50">Aucune notification</p>
						</div>
					) : (
						notifications.map((n) => (
							<NotificationItem key={n.id} notification={n} onRead={fetchUnread} />
						))
					)}
				</div>
			</PopoverContent>
		</Popover>
	);
}
