"use client";

import { Ban, MoreVertical, Shield, User } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	Button,
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@rosegriffon/ui";
import { banUser, changeUserRole } from "./actions";

interface UserActionsProps {
	profile: {
		id: string;
		username?: string;
		role?: string;
	};
}

export function UserActions({ profile }: UserActionsProps) {
	const [roleDialogOpen, setRoleDialogOpen] = useState(false);
	const [banDialogOpen, setBanDialogOpen] = useState(false);
	const [selectedRole, setSelectedRole] = useState(profile.role || "member");
	const [loading, setLoading] = useState(false);

	const handleChangeRole = async () => {
		setLoading(true);
		try {
			const result = await changeUserRole(profile.id, selectedRole);
			if (result.success) {
				toast.success("Rôle modifié avec succès");
				setRoleDialogOpen(false);
			} else {
				toast.error(result.error || "Erreur");
			}
		} catch {
			toast.error("Erreur lors de la modification du rôle");
		} finally {
			setLoading(false);
		}
	};

	const handleBan = async () => {
		setLoading(true);
		try {
			const result = await banUser(profile.id);
			if (result.success) {
				toast.success("Utilisateur banni");
				setBanDialogOpen(false);
			} else {
				toast.error(result.error || "Erreur");
			}
		} catch {
			toast.error("Erreur lors du bannissement");
		} finally {
			setLoading(false);
		}
	};

	const isSuperadmin = profile.role === "superadmin";

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						aria-label="Actions utilisateur"
						className="rounded-full hover:bg-surface-container-high size-12"
					>
						<MoreVertical size={20} aria-hidden="true" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent
					align="end"
					className="rounded-2xl border-none shadow-2xl p-2 min-w-[180px]"
				>
					<DropdownMenuLabel className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant px-3 py-2">
						Modération
					</DropdownMenuLabel>
					<DropdownMenuSeparator className="bg-outline-variant/10" />
					<DropdownMenuItem
						className="rounded-xl focus:bg-primary/10 focus:text-primary transition-colors font-bold cursor-pointer"
						disabled={isSuperadmin}
						onClick={() => {
							setSelectedRole(profile.role || "member");
							setRoleDialogOpen(true);
						}}
					>
						<Shield size={16} className="mr-3" aria-hidden="true" /> Modifier le rôle
					</DropdownMenuItem>
					<DropdownMenuItem
						asChild
						className="rounded-xl focus:bg-primary/10 focus:text-primary transition-colors font-bold cursor-pointer"
					>
						<Link href={`/profil/${profile.username || profile.id}`}>
							<User size={16} className="mr-3" aria-hidden="true" /> Voir le profil
						</Link>
					</DropdownMenuItem>
					<DropdownMenuSeparator className="bg-outline-variant/10" />
					<DropdownMenuItem
						className="text-error font-bold rounded-xl focus:bg-error/10 focus:text-error transition-colors cursor-pointer"
						disabled={isSuperadmin || profile.role === "admin"}
						onClick={() => setBanDialogOpen(true)}
					>
						<Ban size={16} className="mr-3" aria-hidden="true" />
						Bannir l&apos;utilisateur
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			{/* Role Change Dialog */}
			<Dialog open={roleDialogOpen} onOpenChange={setRoleDialogOpen}>
				<DialogContent className="sm:max-w-[420px] bg-surface p-6 sm:p-8 rounded-[32px] gap-6 border-none shadow-2xl">
					<DialogHeader className="gap-3 text-center">
						<div className="mx-auto size-14 rounded-2xl bg-primary-container flex items-center justify-center mb-2 shadow-inner">
							<Shield size={28} className="text-primary" fill="currentColor" aria-hidden="true" />
						</div>
						<DialogTitle className="font-sans text-xl font-black tracking-tight text-on-surface">
							Modifier le rôle
						</DialogTitle>
						<p className="text-on-surface-variant text-sm">
							{profile.username || "Utilisateur"} — rôle actuel : <strong>{profile.role}</strong>
						</p>
					</DialogHeader>

					<Select value={selectedRole} onValueChange={setSelectedRole}>
						<SelectTrigger className="w-full rounded-xl h-12 border-outline-variant/30 bg-surface-container-low px-4">
							<SelectValue placeholder="Choisir un rôle" />
						</SelectTrigger>
						<SelectContent className="rounded-xl border-none shadow-2xl">
							<SelectItem value="member">Membre</SelectItem>
							<SelectItem value="editor">Éditeur</SelectItem>
							<SelectItem value="moderator">Modérateur</SelectItem>
							<SelectItem value="admin">Administrateur</SelectItem>
						</SelectContent>
					</Select>

					<DialogFooter className="gap-2 sm:gap-2">
						<Button
							variant="outline"
							onClick={() => setRoleDialogOpen(false)}
							className="rounded-full border-none bg-surface-container-high"
						>
							Annuler
						</Button>
						<Button
							onClick={handleChangeRole}
							disabled={loading || selectedRole === profile.role}
							className="rounded-full bg-primary text-on-primary"
						>
							{loading ? "Modification..." : "Confirmer"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Ban Confirmation AlertDialog */}
			<AlertDialog open={banDialogOpen} onOpenChange={setBanDialogOpen}>
				<AlertDialogContent className="sm:max-w-[420px] bg-surface p-6 sm:p-8 rounded-[32px] border-none shadow-2xl">
					<AlertDialogHeader className="gap-3 text-center sm:text-center">
						<div className="mx-auto size-14 rounded-2xl bg-error/10 flex items-center justify-center mb-2">
							<Ban size={28} className="text-error" fill="currentColor" aria-hidden="true" />
						</div>
						<AlertDialogTitle className="font-sans text-xl font-black tracking-tight text-on-surface">
							Bannir {profile.username || "cet utilisateur"} ?
						</AlertDialogTitle>
						<AlertDialogDescription className="text-on-surface-variant text-sm">
							Cette action changera le rôle de l&apos;utilisateur en &quot;banned&quot;. Il ne
							pourra plus accéder aux fonctionnalités du site.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter className="gap-2 sm:gap-2 justify-center sm:justify-center">
						<AlertDialogCancel className="rounded-full border-none bg-surface-container-high">
							Annuler
						</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleBan}
							disabled={loading}
							className="rounded-full bg-error text-on-error hover:bg-error/90"
						>
							{loading ? "Bannissement..." : "Bannir"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
