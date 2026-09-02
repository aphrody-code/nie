"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@rosegriffon/ui";

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
	login: { color: "bg-blue-500/10 text-blue-700", label: "Connexion" },
	logout: { color: "bg-gray-500/10 text-gray-700", label: "Déconnexion" },
	profile_update: { color: "bg-yellow-500/10 text-yellow-700", label: "Profil modifié" },
	role_change: { color: "bg-purple-500/10 text-purple-700", label: "Rôle modifié" },
	session_revoke: { color: "bg-red-500/10 text-red-700", label: "Session révoquée" },
	signup: { color: "bg-green-500/10 text-green-700", label: "Inscription" },
};

const ALL_ACTIONS = Object.keys(ACTION_LABELS);

interface AuditTableProps {
	logs: any[];
	currentPage: number;
	totalPages: number;
	currentAction: string;
}

function formatDate(date: string): string {
	return new Date(date).toLocaleDateString("fr-FR", {
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		month: "short",
		second: "2-digit",
		year: "numeric",
	});
}

export function AuditTable({ logs, currentPage, totalPages, currentAction }: AuditTableProps) {
	return (
		<div className="space-y-4">
			{/* Filters */}
			<div className="flex flex-wrap gap-2">
				<Link href="/dashboard/audit">
					<Button
						variant={!currentAction ? "default" : "outline"}
						size="sm"
						className="rounded-full text-xs font-bold"
					>
						Tous
					</Button>
				</Link>
				{ALL_ACTIONS.map((action) => (
					<Link key={action} href={`/dashboard/audit?action=${action}`}>
						<Button
							variant={currentAction === action ? "default" : "outline"}
							size="sm"
							className="rounded-full text-xs font-bold"
						>
							{ACTION_LABELS[action]?.label || action}
						</Button>
					</Link>
				))}
			</div>

			{/* Table */}
			<div className="rounded-[24px] bg-surface-container-lowest overflow-hidden shadow-sm">
				<div className="overflow-x-auto">
					<table className="w-full">
						<thead>
							<tr className="bg-surface-container-low/50 text-left">
								<th className="px-3 sm:px-6 py-3 sm:py-4 text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
									Date
								</th>
								<th className="px-3 sm:px-6 py-3 sm:py-4 text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
									Utilisateur
								</th>
								<th className="px-3 sm:px-6 py-3 sm:py-4 text-[10px] font-black uppercase tracking-widest text-on-surface-variant">
									Action
								</th>
								<th className="px-3 sm:px-6 py-3 sm:py-4 text-[10px] font-black uppercase tracking-widest text-on-surface-variant hidden md:table-cell">
									Détails
								</th>
								<th className="px-3 sm:px-6 py-3 sm:py-4 text-[10px] font-black uppercase tracking-widest text-on-surface-variant hidden lg:table-cell">
									IP
								</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-outline-variant/10">
							{logs.map((log: any) => {
								const actionInfo = ACTION_LABELS[log.action] || {
									color: "bg-surface-container-high text-on-surface",
									label: log.action,
								};
								return (
									<tr key={log.id} className="hover:bg-surface-container-low/30 transition-colors">
										<td className="px-3 sm:px-6 py-3 sm:py-4 text-xs text-on-surface-variant whitespace-nowrap">
											{formatDate(log.created_at)}
										</td>
										<td className="px-3 sm:px-6 py-3 sm:py-4">
											<span className="text-sm font-bold text-on-surface">
												{log.profiles?.username || log.user_id.slice(0, 8)}
											</span>
										</td>
										<td className="px-3 sm:px-6 py-3 sm:py-4">
											<span
												className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${actionInfo.color}`}
											>
												{actionInfo.label}
											</span>
										</td>
										<td className="px-3 sm:px-6 py-3 sm:py-4 text-xs text-on-surface-variant max-w-[300px] truncate hidden md:table-cell">
											{log.details && Object.keys(log.details).length > 0
												? JSON.stringify(log.details).slice(0, 100)
												: "—"}
										</td>
										<td className="px-3 sm:px-6 py-3 sm:py-4 text-xs text-on-surface-variant font-mono whitespace-nowrap hidden lg:table-cell">
											{log.ip_address || "—"}
										</td>
									</tr>
								);
							})}
							{logs.length === 0 && (
								<tr>
									<td
										colSpan={5}
										className="px-3 sm:px-6 py-12 text-center text-on-surface-variant text-sm"
									>
										Aucun événement trouvé
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			</div>

			{/* Pagination */}
			{totalPages > 1 && (
				<div className="flex items-center justify-between px-2">
					<p className="text-xs text-on-surface-variant">
						Page {currentPage} sur {totalPages}
					</p>
					<div className="flex gap-2">
						{currentPage > 1 && (
							<Link
								href={`/dashboard/audit?page=${currentPage - 1}${currentAction ? `&action=${currentAction}` : ""}`}
							>
								<Button
									variant="outline"
									size="sm"
									aria-label="Page précédente"
									className="rounded-full"
								>
									<ChevronLeft className="size-4" />
								</Button>
							</Link>
						)}
						{currentPage < totalPages && (
							<Link
								href={`/dashboard/audit?page=${currentPage + 1}${currentAction ? `&action=${currentAction}` : ""}`}
							>
								<Button
									variant="outline"
									size="sm"
									aria-label="Page suivante"
									className="rounded-full"
								>
									<ChevronRight className="size-4" />
								</Button>
							</Link>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
