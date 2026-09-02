"use client";

import { CloudDownload, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { importDriveFolder } from "@/app/dashboard/import-google-doc/actions";
import { Button } from "@rosegriffon/ui";

export function DriveImportButton() {
	const [loading, setLoading] = useState(false);

	const handleImport = async () => {
		setLoading(true);
		try {
			const result = await importDriveFolder();
			if (result.success) {
				toast.success(result.message || "Importation terminée");
			} else {
				toast.error(`Erreur : ${result.error}`);
			}
		} catch (error) {
			toast.error("Une erreur est survenue lors de l'importation");
			console.error(error);
		} finally {
			setLoading(false);
		}
	};

	return (
		<Button
			variant="outline"
			size="lg"
			onClick={handleImport}
			disabled={loading}
			className="rounded-full h-10 sm:h-12 px-6 sm:px-8 border-outline-variant text-on-surface hover:bg-surface-container-high transition-all"
		>
			{loading ? (
				<Loader2 className="size-4 sm:size-5 mr-2 animate-spin" />
			) : (
				<CloudDownload className="size-4 sm:size-5 mr-2" />
			)}
			<span className="hidden sm:inline">Importer Drive</span>
			<span className="sm:hidden">Import</span>
		</Button>
	);
}
