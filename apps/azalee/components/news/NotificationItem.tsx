"use client";

import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { Bell, FileText, type LucideIcon, Megaphone } from "lucide-react";
import Link from "next/link";
import { markAsRead } from "@/app/actions/notifications";
import { cn } from "@/lib/utils";

const TYPE_ICONS: Record<string, LucideIcon> = {
	announcement: Megaphone,
	article: FileText,
	default: Bell,
};

interface NotificationItemProps {
	notification: {
		id: string;
		type: string;
		title: string;
		body: string | null;
		data: Record<string, unknown>;
		read: boolean;
		created_at: string;
	};
	onRead?: () => void;
}

export function NotificationItem({ notification, onRead }: NotificationItemProps) {
	const Icon = TYPE_ICONS[notification.type] || TYPE_ICONS.default;
	const url = (notification.data?.url as string) || "/news";

	const handleClick = async () => {
		if (!notification.read) {
			await markAsRead(notification.id);
			onRead?.();
		}
	};

	return (
		<Link
			href={url}
			onClick={handleClick}
			className={cn(
				"flex items-start gap-3 px-3 py-2.5 rounded-xl transition-colors hover:bg-surface-container-highest",
				!notification.read && "bg-primary/5"
			)}
		>
			<div
				className={cn(
					"size-8 rounded-full flex items-center justify-center shrink-0",
					!notification.read
						? "bg-primary/10 text-primary"
						: "bg-surface-container-high text-on-surface-variant/50"
				)}
			>
				<Icon className="size-4" />
			</div>
			<div className="min-w-0 flex-1">
				<p
					className={cn(
						"text-sm line-clamp-2",
						!notification.read ? "font-semibold text-on-surface" : "text-on-surface-variant"
					)}
				>
					{notification.title}
				</p>
				{notification.body && (
					<p className="text-xs text-on-surface-variant/60 line-clamp-1 mt-0.5">
						{notification.body}
					</p>
				)}
				<span className="text-[10px] text-on-surface-variant/40 mt-1 block">
					{formatDistanceToNow(new Date(notification.created_at), { addSuffix: true, locale: fr })}
				</span>
			</div>
			{!notification.read && <div className="size-2 rounded-full bg-primary shrink-0 mt-2" />}
		</Link>
	);
}
