import { Loader2 } from "lucide-react";

export default function CharaLoading() {
	return (
		<div className="flex items-center justify-center py-32">
			<div className="flex items-center gap-2 px-4 py-2 rounded-full bg-surface-container-high shadow-level-2">
				<Loader2 size={16} className="animate-spin text-primary" />
				<span className="text-xs font-medium text-on-surface-variant">Chargement...</span>
			</div>
		</div>
	);
}
