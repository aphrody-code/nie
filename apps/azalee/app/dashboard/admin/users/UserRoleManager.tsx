"use client";

import { Crown, Search, Shield, ShieldCheck, User as UserIcon } from "lucide-react";
import Image from "next/image";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/AuthProvider";
import { useSupabase } from "@/hooks/use-supabase";
import { isRemoteAvatar } from "@/lib/avatar";
import { cn } from "@/lib/utils";

interface UserProfile {
	id: string;
	username: string | null;
	full_name: string | null;
	avatar_url: string | null;
	role: string | null;
	created_at: string;
}

const ROLES = [
	{ color: "text-on-surface-variant", icon: UserIcon, label: "Membre", value: "member" },
	{ color: "text-blue-500", icon: Shield, label: "Modérateur", value: "moderator" },
	{ color: "text-green-500", icon: ShieldCheck, label: "Éditeur", value: "editor" },
	{ color: "text-amber-500", icon: Crown, label: "Admin", value: "admin" },
] as const;

export function UserRoleManager({ users }: { users: UserProfile[] }) {
	const { user: currentUser } = useAuth();
	const supabase = useSupabase();
	const [search, setSearch] = useState("");
	const [updatingId, setUpdatingId] = useState<string | null>(null);
	const [, startTransition] = useTransition();
	const [localUsers, setLocalUsers] = useState(users);

	const filtered = localUsers.filter((u) => {
		if (!search) {
			return true;
		}
		const q = search.toLowerCase();
		return (
			u.username?.toLowerCase().includes(q) ||
			u.full_name?.toLowerCase().includes(q) ||
			u.id.toLowerCase().includes(q)
		);
	});

	const handleRoleChange = (userId: string, newRole: string) => {
		if (userId === currentUser?.id) {
			toast.error("Tu ne peux pas modifier ton propre rôle");
			return;
		}

		setUpdatingId(userId);
		startTransition(async () => {
			try {
				const { error } = await supabase
					.from("profiles")
					.update({ role: newRole })
					.eq("id", userId);

				if (error) {
					throw error;
				}

				setLocalUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u)));
				toast.success(`Rôle mis à jour : ${newRole}`);
			} catch {
				toast.error("Erreur lors de la mise à jour du rôle");
			} finally {
				setUpdatingId(null);
			}
		});
	};

	return (
		<div className="space-y-4">
			{/* Search */}
			<div className="relative">
				<Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-on-surface-variant/50" />
				<input
					type="text"
					placeholder="Rechercher un utilisateur..."
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-surface-container-low border border-outline-variant/20
            text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:outline-hidden focus:border-primary"
				/>
			</div>

			{/* Count */}
			<p className="text-xs text-on-surface-variant/50">
				{filtered.length} utilisateur{filtered.length !== 1 ? "s" : ""}
			</p>

			{/* User list */}
			<div className="space-y-2">
				{filtered.map((user) => {
					const isSelf = user.id === currentUser?.id;
					const isUpdating = updatingId === user.id;

					return (
						<div
							key={user.id}
							className={cn(
								"flex items-center gap-3 p-3 rounded-2xl border border-outline-variant/10 bg-surface-container-low transition-colors",
								isUpdating && "opacity-60"
							)}
						>
							{/* Avatar */}
							<div className="size-10 rounded-full bg-surface-container-high overflow-hidden relative shrink-0">
								{user.avatar_url ? (
									<Image
										src={user.avatar_url}
										alt={user.full_name || ""}
										fill
										className="object-cover"
										unoptimized={isRemoteAvatar(user.avatar_url)}
									/>
								) : (
									<div className="w-full h-full flex items-center justify-center">
										<UserIcon className="size-5 text-on-surface-variant/40" />
									</div>
								)}
							</div>

							{/* Info */}
							<div className="flex-1 min-w-0">
								<p className="text-sm font-bold text-on-surface truncate">
									{user.full_name || user.username || "Sans nom"}
									{isSelf && (
										<span className="text-xs font-normal text-on-surface-variant/50 ml-1">
											(toi)
										</span>
									)}
								</p>
								<p className="text-xs text-on-surface-variant/50 truncate">
									@{user.username || user.id.slice(0, 8)}
								</p>
							</div>

							{/* Role selector */}
							<div className="flex items-center gap-1">
								{ROLES.map((role) => {
									const RoleIcon = role.icon;
									const isActive = user.role === role.value;
									return (
										<button
											key={role.value}
											onClick={() => handleRoleChange(user.id, role.value)}
											disabled={isSelf || isUpdating}
											title={role.label}
											className={cn(
												"p-2 rounded-xl text-xs font-medium transition-all",
												isActive
													? `${role.color} bg-surface-container-highest`
													: "text-on-surface-variant/30 hover:text-on-surface-variant/60 hover:bg-surface-container",
												(isSelf || isUpdating) && "cursor-not-allowed opacity-40"
											)}
										>
											<RoleIcon className="size-4" />
										</button>
									);
								})}
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
