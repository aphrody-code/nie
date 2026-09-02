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
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
	Textarea,
} from "@rosegriffon/ui";
import { importCsv, importGoogleSheet } from "./actions";

export function ImportSheetForm() {
	const router = useRouter();
	const [loading, setLoading] = useState(false);

	// Sheet State
	const [sheetId, setSheetId] = useState("");

	// CSV State
	const [csvContent, setCsvContent] = useState("");
	const [csvTitle, setCsvTitle] = useState("");

	const handleSheetImport = async () => {
		if (!sheetId) {
			toast.error("Veuillez entrer un ID de Google Sheet");
			return;
		}

		setLoading(true);
		try {
			const result = await importGoogleSheet(sheetId);
			if (result.success && result.data) {
				toast.success("Tableau importé avec succès !");
				router.push(`/dashboard/news/${result.data.id}`);
			} else {
				toast.error(`Erreur : ${result.error}`);
			}
		} catch {
			toast.error("Une erreur inattendue est survenue");
		} finally {
			setLoading(false);
		}
	};

	const handleCsvImport = async () => {
		if (!csvContent || !csvTitle) {
			toast.error("Veuillez remplir le titre et le contenu CSV");
			return;
		}

		setLoading(true);
		try {
			const result = await importCsv(csvTitle, csvContent);
			if (result.success && result.data) {
				toast.success("CSV importé avec succès !");
				router.push(`/dashboard/news/${result.data.id}`);
			} else {
				toast.error(`Erreur : ${result.error}`);
			}
		} catch {
			toast.error("Une erreur inattendue est survenue");
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="max-w-2xl">
			<Card className="rounded-[24px] border border-outline-variant/20 bg-surface-container-lowest shadow-sm">
				<CardHeader>
					<CardTitle>Importer un Tableau</CardTitle>
					<CardDescription>Transformez un tableur en article de données.</CardDescription>
				</CardHeader>
				<CardContent>
					<Tabs defaultValue="sheet" className="w-full">
						<TabsList className="grid w-full grid-cols-2 mb-6">
							<TabsTrigger value="sheet">Google Sheet</TabsTrigger>
							<TabsTrigger value="csv">CSV / Texte</TabsTrigger>
						</TabsList>

						<TabsContent value="sheet" className="space-y-4">
							<div className="space-y-2">
								<Label htmlFor="sheetId">ID du Google Sheet</Label>
								<Input
									id="sheetId"
									placeholder="1BxiMvs0XRA5nFMdKbBdB_..."
									value={sheetId}
									onChange={(e) => setSheetId(e.target.value)}
								/>
								<p className="text-sm text-on-surface-variant">
									Le document doit être <strong>public</strong> (ou accessible par la clé API).
								</p>
							</div>
							<Button
								onClick={handleSheetImport}
								disabled={loading}
								className="w-full rounded-full"
							>
								{loading ? "Importation..." : "Importer le Sheet"}
							</Button>
						</TabsContent>

						<TabsContent value="csv" className="space-y-4">
							<div className="space-y-2">
								<Label htmlFor="csvTitle">Titre du Tableau</Label>
								<Input
									id="csvTitle"
									placeholder="Ex: Statistiques des joueurs"
									value={csvTitle}
									onChange={(e) => setCsvTitle(e.target.value)}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="csvContent">Contenu CSV</Label>
								<Textarea
									id="csvContent"
									placeholder="Nom,Position,Élément&#10;Evans,GK,Terre&#10;Axel,FW,Feu"
									className="min-h-[200px] font-mono text-xs"
									value={csvContent}
									onChange={(e) => setCsvContent(e.target.value)}
								/>
							</div>
							<Button onClick={handleCsvImport} disabled={loading} className="w-full rounded-full">
								{loading ? "Importation..." : "Convertir le CSV"}
							</Button>
						</TabsContent>
					</Tabs>
				</CardContent>
			</Card>
		</div>
	);
}
