"use client";

import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { History, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge, Button } from "@rosegriffon/ui";

interface Version {
	id: string;
	version_number: number;
	title: string;
	status: string | null;
	created_at: string;
}

interface VersionsListProps {
	versions: Version[];
	articleId: string;
	restoreAction: (
		articleId: string,
		versionId: string
	) => Promise<{ success: boolean; error?: string }>;
}

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
	archived: { className: "bg-stone-500/10 text-stone-600", label: "Archivé" },
	draft: { className: "bg-amber-500/10 text-amber-600", label: "Brouillon" },
	published: { className: "bg-green-500/10 text-green-600", label: "Publié" },
	scheduled: { className: "bg-blue-500/10 text-blue-600", label: "Programmé" },
};

export function VersionsList({ versions, articleId, restoreAction }: VersionsListProps) {
	const [restoringId, setRestoringId] = useState<string | null>(null);
	const router = useRouter();

	const handleRestore = async (versionId: string, versionNumber: number) => {
		if (
			!window.confirm(
				`Restaurer la version ${versionNumber} ? La version actuelle sera sauvegardée automatiquement.`
			)
		) {
			return;
		}

		setRestoringId(versionId);
		try {
			const result = await restoreAction(articleId, versionId);
			if (result.success) {
				toast.success(`Version ${versionNumber} restaurée`);
				router.push(`/dashboard/news/${articleId}`);
				router.refresh();
			} else {
				toast.error(result.error || "Erreur lors de la restauration");
			}
		} catch {
			toast.error("Erreur lors de la restauration");
		} finally {
			setRestoringId(null);
		}
	};

	return (
		<div className="rounded-2xl border border-outline-variant/20 overflow-hidden bg-surface-container-lowest divide-y divide-outline-variant/10">
			{versions.map((version, i) => {
				const statusInfo = STATUS_LABELS[version.status || "draft"] || STATUS_LABELS.draft;
				const isLatest = i === 0;

				return (
					<div
						key={version.id}
						className="flex items-center gap-4 p-4 sm:p-5 hover:bg-surface-container-low/30 transition-colors"
					>
						<div className="size-10 rounded-xl bg-surface-container-high flex items-center justify-center shrink-0">
							<History className="size-4 text-on-surface-variant" />
						</div>
						<div className="flex-1 min-w-0">
							<div className="flex items-center gap-2">
								<span className="text-sm font-bold text-on-surface">
									Version {version.version_number}
								</span>
								{isLatest && (
									<Badge className="bg-primary/10 text-primary border-none text-[10px] rounded-lg">
										Dernière
									</Badge>
								)}
								<Badge className={`${statusInfo.className} border-none text-[10px] rounded-lg`}>
									{statusInfo.label}
								</Badge>
							</div>
							<p className="text-xs text-on-surface-variant mt-0.5 truncate">{version.title}</p>
							<p className="text-[10px] text-on-surface-variant/60 mt-0.5">
								{format(new Date(version.created_at), "d MMMM yyyy 'à' HH:mm", { locale: fr })}
							</p>
						</div>
						{!isLatest && (
							<Button
								variant="outline"
								size="sm"
								disabled={restoringId === version.id}
								onClick={() => handleRestore(version.id, version.version_number)}
								className="shrink-0 rounded-full text-xs"
							>
								<RotateCcw className="size-3.5 mr-1.5" />
								{restoringId === version.id ? "Restauration..." : "Restaurer"}
							</Button>
						)}
					</div>
				);
			})}
		</div>
	);
}
