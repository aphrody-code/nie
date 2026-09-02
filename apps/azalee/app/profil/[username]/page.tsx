export const dynamic = "force-dynamic";

import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { CalendarDays, Edit, Mail, Settings, Share2, Shield, User } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage, Button } from "@rosegriffon/ui";
import { getServerSession } from "@/lib/auth-helpers";
import { getProfileByUsername, getProfileMetaByUsername } from "@/lib/db/profiles";

interface ProfilePageProps {
	params: Promise<{
		username: string;
	}>;
}

export async function generateMetadata({ params }: ProfilePageProps): Promise<Metadata> {
	const { username } = await params;
	const profile = await getProfileMetaByUsername(username);

	if (!profile) {
		return {
			title: "Profil introuvable | Azalée",
		};
	}

	const item = profile as any;
	return {
		description: item.bio || `Profil de ${username} sur le wiki Azalée.`,
		title: `@${username} | Azalée`,
	};
}

export default async function ProfilePage({ params }: ProfilePageProps) {
	const { username } = await params;

	// Fetch target profile
	const profile = await getProfileByUsername(username);

	if (!profile) {
		notFound();
	}

	const userProfile = profile as any;

	// Check if current user is owner
	const currentSession = await getServerSession();
	const currentUser = currentSession?.user ?? null;
	const isOwner = currentUser?.id === userProfile.id;

	// Format date
	// `profiles.created_at` n'existe pas : la page affichait « A rejoint en Date
	// inconnue » pour tout le monde. `claimed_at` est la date de réclamation du
	// profil — et quand elle manque, on n'affiche pas la ligne du tout plutôt
	// que d'écrire une non-information.
	const joinedDate = profile.claimed_at
		? format(new Date(profile.claimed_at), "MMMM yyyy", { locale: fr })
		: null;

	// Role badge config
	const roleConfig: Record<string, { label: string; color: string; icon: any }> = {
		admin: { color: "bg-error text-on-error", icon: Shield, label: "Administrateur" },
		default: {
			color: "bg-surface-container-high text-on-surface-variant",
			icon: User,
			label: "Membre",
		},
		editor: { color: "bg-secondary text-on-secondary", icon: Edit, label: "Rédacteur" },
		moderator: { color: "bg-tertiary text-on-tertiary", icon: Shield, label: "Modérateur" },
		superadmin: { color: "bg-primary text-on-primary", icon: Shield, label: "Fondateur" },
	};

	const role = roleConfig[profile.role ?? ""] || roleConfig.default;
	const RoleIcon = role.icon;

	return (
		<div className="min-h-screen pb-20">
			{/* Cover */}
			<div className="h-44 sm:h-56 bg-linear-to-br from-primary/70 via-secondary/60 to-tertiary/50 relative overflow-hidden">
				<div className="absolute inset-0 bg-[url('/grid-pattern.svg')] opacity-10" />
				<div className="absolute inset-x-0 bottom-0 h-28 bg-linear-to-t from-surface to-transparent" />
			</div>

			<div className="relative -mt-20 sm:-mt-24">
				{/* Profile header card */}
				<div className="bg-surface-container-lowest rounded-[28px] elevation-1 p-6 sm:p-8 mb-8">
					<div className="flex flex-col sm:flex-row items-start gap-5 sm:gap-8">
						{/* Avatar */}
						<div className="relative group shrink-0 -mt-16 sm:-mt-20">
							<Avatar className="size-28 sm:w-36 sm:h-36 border-4 border-surface-container-lowest shadow-xl">
								<AvatarImage
									src={profile.avatar_url || ""}
									alt={profile.username || "Avatar"}
									className="object-cover"
								/>
								<AvatarFallback className="text-3xl sm:text-4xl font-black bg-surface-container-highest text-on-surface-variant">
									{profile.username?.[0]?.toUpperCase() || "M"}
								</AvatarFallback>
							</Avatar>
							{isOwner && (
								<Link href="/dashboard/settings" className="absolute bottom-1 right-1 z-20">
									<Button
										size="icon"
										variant="secondary"
										className="rounded-full shadow-lg size-11 sm:size-9 border-2 border-surface-container-lowest"
									>
										<Edit className="h-3.5 w-3.5" />
									</Button>
								</Link>
							)}
						</div>

						{/* Info */}
						<div className="flex-1 min-w-0 space-y-3 pt-1">
							<div className="flex flex-col sm:flex-row justify-between items-start gap-4">
								<div className="min-w-0">
									<div className="flex items-center gap-3 flex-wrap">
										<h1 className="text-2xl sm:text-3xl font-black tracking-tight text-on-surface truncate">
											{profile.username || "Membre"}
										</h1>
										<span
											className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${role.color}`}
										>
											<RoleIcon className="size-3" />
											{role.label}
										</span>
									</div>
									<p className="type-body-large text-on-surface-variant font-medium mt-0.5">
										@{profile.username || "utilisateur"}
									</p>
								</div>

								<div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
									{isOwner && (
										<Button
											asChild
											variant="outline"
											className="flex-1 sm:flex-none rounded-full border-outline font-bold"
										>
											<Link href="/dashboard/settings">
												<Settings className="size-4 mr-2" />
												Paramètres
											</Link>
										</Button>
									)}
									<Button
										size="icon"
										variant="ghost"
										className="size-11 sm:size-9 rounded-full text-on-surface-variant shrink-0"
									>
										<Share2 className="size-5" />
									</Button>
								</div>
							</div>

							{/* Meta */}
							<div className="flex flex-wrap items-center gap-x-5 gap-y-2 type-body-medium text-on-surface-variant">
								{joinedDate && (
									<div className="flex items-center gap-2">
										<CalendarDays className="size-4" />A rejoint en {joinedDate}
									</div>
								)}
								{/* L'adresse n'est plus lue depuis le profil : seule celle de la
								    session est affichée, et uniquement à son propriétaire. */}
								{isOwner &&
									currentUser?.email && (
											<div className="flex items-center gap-2">
												<Mail className="size-4" />
												<span className="truncate max-w-[200px]">{currentUser.email}</span>
											</div>
										)}
							</div>

							{/* Bio */}
							{profile.bio && (
								<p className="type-body-large text-on-surface-variant leading-relaxed max-w-2xl">
									{profile.bio}
								</p>
							)}
						</div>
					</div>
				</div>

				{/* Activity placeholder */}
				<div className="bg-surface-container-lowest rounded-[28px] elevation-1 p-8 text-center">
					<p className="type-body-large text-on-surface-variant">Aucune activité récente.</p>
				</div>
			</div>
		</div>
	);
}
