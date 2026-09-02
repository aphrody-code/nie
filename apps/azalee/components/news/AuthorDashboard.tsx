"use client";

import { BookOpen, Eye, MessageCircle, Star, ThumbsUp, Trophy } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getAuthorDashboard } from "@/app/actions/stats-export";
import { Skeleton } from "@rosegriffon/ui";
import { cn } from "@/lib/utils";

type DashboardData = Awaited<ReturnType<typeof getAuthorDashboard>>;

function timeAgo(date: string): string {
	const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
	if (seconds < 60) {
		return "à l'instant";
	}
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) {
		return `il y a ${minutes} min`;
	}
	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		return `il y a ${hours}h`;
	}
	const days = Math.floor(hours / 24);
	if (days < 7) {
		return `il y a ${days}j`;
	}
	return new Date(date).toLocaleDateString("fr-FR", {
		day: "numeric",
		month: "short",
		year: "numeric",
	});
}

function formatCount(n: number): string {
	if (n >= 1_000_000) {
		return `${(n / 1_000_000).toFixed(1)}M`;
	}
	if (n >= 1000) {
		return `${(n / 1_000).toFixed(1)}k`;
	}
	return String(n);
}

// ─── Squelette de chargement ──────────────────────────────────────────────────

function DashboardSkeleton() {
	return (
		<div className="space-y-6">
			{/* Stat cards */}
			<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
				{Array.from({ length: 4 }).map((_, i) => (
					<div
						key={i}
						className="bg-surface-container-low border border-outline-variant/10 rounded-2xl p-4 space-y-2"
					>
						<Skeleton className="h-3 w-16 rounded-lg" />
						<Skeleton className="h-7 w-20 rounded-lg" />
					</div>
				))}
			</div>
			{/* Chart */}
			<div className="bg-surface-container-low border border-outline-variant/10 rounded-2xl p-4 space-y-3">
				<Skeleton className="h-3 w-24 rounded-lg" />
				<div className="flex items-end gap-2 h-24">
					{Array.from({ length: 6 }).map((_, i) => (
						<Skeleton
							key={i}
							className="flex-1 rounded-t-lg"
							style={{ height: `${30 + (i % 4) * 20}%` }}
						/>
					))}
				</div>
			</div>
			{/* Commentaires */}
			<div className="space-y-2">
				{Array.from({ length: 3 }).map((_, i) => (
					<Skeleton key={i} className="h-14 w-full rounded-2xl" />
				))}
			</div>
		</div>
	);
}

// ─── Carte statistique ────────────────────────────────────────────────────────

interface StatCardProps {
	label: string;
	value: number | string;
	icon: React.ReactNode;
	accent?: boolean;
}

function StatCard({ label, value, icon, accent }: StatCardProps) {
	return (
		<div
			className={cn(
				"rounded-2xl p-4 border transition-colors",
				accent
					? "bg-primary/8 border-primary/20"
					: "bg-surface-container-low border-outline-variant/10"
			)}
		>
			<div className="flex items-center gap-2 mb-2">
				<span className={cn("size-4", accent ? "text-primary" : "text-on-surface-variant/60")}>
					{icon}
				</span>
				<span className="text-xs text-on-surface-variant/60 uppercase tracking-wider font-semibold">
					{label}
				</span>
			</div>
			<p
				className={cn(
					"text-2xl font-black tabular-nums",
					accent ? "text-primary" : "text-on-surface"
				)}
			>
				{typeof value === "number" ? formatCount(value) : value}
			</p>
		</div>
	);
}

// ─── Composant principal ──────────────────────────────────────────────────────

export function AuthorDashboard() {
	const [data, setData] = useState<DashboardData | null | undefined>();

	useEffect(() => {
		let cancelled = false;
		getAuthorDashboard()
			.then((result) => {
				if (!cancelled) {
					setData(result);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setData(null);
				}
			});
		return () => {
			cancelled = true;
		};
	}, []);

	// Chargement
	if (data === undefined) {
		return <DashboardSkeleton />;
	}

	// Non authentifié ou erreur
	if (data === null) {
		return (
			<div className="rounded-2xl border border-outline-variant/10 bg-surface-container-low p-8 text-center">
				<p className="text-sm text-on-surface-variant/60">
					Impossible de charger le tableau de bord.
				</p>
			</div>
		);
	}

	// Aucun article
	if (data.articles.length === 0) {
		return (
			<div className="rounded-2xl border border-outline-variant/10 bg-surface-container-low p-10 text-center space-y-2">
				<BookOpen className="size-10 mx-auto text-on-surface-variant/20" />
				<p className="text-sm font-medium text-on-surface-variant/70">
					Aucun article publié pour le moment
				</p>
				<p className="text-xs text-on-surface-variant/50">
					Commencez à rédiger pour voir vos statistiques apparaître ici.
				</p>
			</div>
		);
	}

	const publishedArticles = data.articles.filter((a) => a.status === "published");
	const totalReactions = data.articles.reduce((s, a) => s + a.reaction_count, 0);
	const totalComments = data.articles.reduce((s, a) => s + a.comment_count, 0);

	// Données pour le graphique : vues par article (top 10 par vues)
	const chartArticles = [...data.articles]
		.toSorted((a, b) => b.view_count - a.view_count)
		.slice(0, 10);
	const maxViews = Math.max(...chartArticles.map((a) => a.view_count), 1);

	return (
		<div className="space-y-6">
			{/* Cartes statistiques */}
			<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
				<StatCard
					label="Articles publiés"
					value={publishedArticles.length}
					icon={<BookOpen className="size-4" />}
				/>
				<StatCard
					label="Vues totales"
					value={data.total_views}
					icon={<Eye className="size-4" />}
					accent
				/>
				<StatCard label="Réactions" value={totalReactions} icon={<ThumbsUp className="size-4" />} />
				<StatCard
					label="Commentaires"
					value={totalComments}
					icon={<MessageCircle className="size-4" />}
				/>
			</div>

			{/* Article le plus populaire */}
			{data.most_popular && (
				<div className="flex items-start gap-3 rounded-2xl border border-outline-variant/10 bg-surface-container-low p-4">
					<span className="size-8 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0 mt-0.5">
						<Trophy className="size-4 text-amber-500" />
					</span>
					<div className="min-w-0">
						<p className="text-xs font-bold uppercase tracking-wider text-on-surface-variant/50 mb-0.5">
							Article le plus populaire
						</p>
						<Link
							href={`/news/${data.most_popular.slug}`}
							className="text-sm font-semibold text-on-surface hover:text-primary transition-colors truncate block"
						>
							{data.most_popular.title}
						</Link>
						<p className="text-xs text-on-surface-variant/50 mt-0.5">
							<Eye className="size-3 inline mr-1" />
							{formatCount(data.most_popular.view_count)} vues
						</p>
					</div>
				</div>
			)}

			{/* Graphique vues par article */}
			{chartArticles.length > 0 && (
				<div className="rounded-2xl border border-outline-variant/10 bg-surface-container-low p-4">
					<div className="flex items-center gap-2 mb-4">
						<Star className="size-4 text-on-surface-variant/50" />
						<h3 className="text-sm font-bold text-on-surface">Vues par article</h3>
					</div>

					<div className="space-y-2.5">
						{chartArticles.map((article) => {
							const pct = Math.max((article.view_count / maxViews) * 100, 2);
							return (
								<div key={article.id} className="space-y-1">
									<div className="flex items-center justify-between gap-2">
										<Link
											href={`/news/${article.slug}`}
											className="text-xs text-on-surface/80 hover:text-primary transition-colors truncate max-w-[70%]"
											title={article.title}
										>
											{article.title}
										</Link>
										<span className="text-xs font-semibold tabular-nums text-on-surface-variant/60 shrink-0">
											{formatCount(article.view_count)}
										</span>
									</div>
									<div className="h-1.5 w-full bg-surface-container-high rounded-full overflow-hidden">
										<div
											className="h-full rounded-full bg-primary/70 transition-all duration-500"
											style={{ width: `${pct}%` }}
										/>
									</div>
								</div>
							);
						})}
					</div>
				</div>
			)}

			{/* Derniers commentaires */}
			{data.latest_comments.length > 0 && (
				<div className="space-y-2">
					<h3 className="text-sm font-bold text-on-surface flex items-center gap-2">
						<MessageCircle className="size-4 text-on-surface-variant/50" />
						Derniers commentaires sur vos articles
					</h3>

					<ul className="space-y-2">
						{data.latest_comments.map((comment) => (
							<li
								key={comment.id}
								className="rounded-2xl border border-outline-variant/10 bg-surface-container-low px-4 py-3"
							>
								<div className="flex items-start justify-between gap-2">
									<div className="min-w-0">
										<Link
											href={`/news/${data.articles.find((a) => a.id === comment.article_id)?.slug ?? "#"}`}
											className="text-xs font-semibold text-primary/80 hover:text-primary transition-colors truncate block"
										>
											{comment.article_title}
										</Link>
										<p className="text-sm text-on-surface mt-0.5 line-clamp-2 leading-snug">
											{comment.content}
										</p>
									</div>
									<time
										className="text-xs text-on-surface-variant/50 shrink-0 mt-0.5"
										dateTime={comment.created_at}
									>
										{timeAgo(comment.created_at)}
									</time>
								</div>
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}
