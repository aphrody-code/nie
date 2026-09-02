"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
	Button,
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
	Input,
	Label,
} from "@rosegriffon/ui";
import { importDriveFolder, importGoogleDoc } from "./actions";

export function ImportDocForm() {
	const [docId, setDocId] = useState("");
	const [loading, setLoading] = useState(false);
	const router = useRouter();

	const extractDocId = (input: string) => {
		const match = input.match(/\/d\/([a-zA-Z0-9-_]+)/);
		return match ? match[1] : input;
	};

	const handleImport = async () => {
		if (!docId) {
			toast.error("Veuillez entrer une URL ou un ID de Google Doc");
			return;
		}

		const realId = extractDocId(docId);
		if (realId.length < 20) {
			toast.error("ID invalide détecté");
			return;
		}

		setLoading(true);
		try {
			const result = await importGoogleDoc(realId);
			if (result.success && result.data) {
				toast.success("Google Doc importé avec succès !");
				router.push(`/dashboard/news/${result.data.id}`);
			} else {
				toast.error(`Erreur lors de l'import : ${result.error}`);
			}
		} catch {
			toast.error("Une erreur inattendue est survenue");
		} finally {
			setLoading(false);
		}
	};

	const handleFolderImport = async () => {
		if (!confirm("Voulez-vous importer tous les documents du dossier Drive configuré ?")) {
			return;
		}

		setLoading(true);
		try {
			const result = await importDriveFolder();
			if (result.success) {
				toast.success(result.message);
				router.refresh();
			} else {
				toast.error(result.error);
			}
		} catch {
			toast.error("Erreur lors de l'importation du dossier");
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="space-y-6 max-w-2xl">
			<Card className="rounded-[24px] border border-outline-variant/20 bg-surface-container-lowest shadow-sm">
				<CardHeader>
					<CardTitle>Importer un Google Doc</CardTitle>
					<CardDescription>
						Collez l&apos;URL complète ou l&apos;ID de votre Google Doc pour l&apos;importer comme
						brouillon d&apos;article. Assurez-vous que le document est partagé avec le compte de
						service ou qu&apos;il est public.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="docId">URL ou ID du Google Doc</Label>
						<Input
							id="docId"
							placeholder="https://docs.google.com/document/d/..."
							value={docId}
							onChange={(e) => setDocId(e.target.value)}
						/>
						<p className="text-sm text-on-surface-variant">
							Exemple : https://docs.google.com/document/d/<strong>1A2B3C...</strong>/edit
						</p>
					</div>
					<Button onClick={handleImport} disabled={loading} className="w-full rounded-full">
						{loading ? "Importation en cours..." : "Importer le document"}
					</Button>
				</CardContent>
			</Card>

			<Card className="rounded-[24px] border border-outline-variant/20 bg-surface-container-lowest shadow-sm">
				<CardHeader>
					<CardTitle>Importation en masse</CardTitle>
					<CardDescription>
						Importer automatiquement tous les nouveaux Google Docs présents dans le dossier Drive
						partagé.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Button
						onClick={handleFolderImport}
						disabled={loading}
						variant="outline"
						className="w-full rounded-full"
					>
						{loading ? "Scan en cours..." : "Importer depuis le dossier Drive"}
					</Button>
				</CardContent>
			</Card>
		</div>
	);
}
