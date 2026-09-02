"use client";

import { useState } from "react";
import { Check, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
	Button,
	Input,
	Textarea,
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
	Badge,
} from "@rosegriffon/ui";
import { createClient } from "@/lib/supabase/client";

interface VerificationClientProps {
	initialCharacters: any[];
	initialSkills: any[];
	initialTeams: any[];
	initialItems: any[];
}

type TableType = "characters" | "skills" | "teams" | "items";

export function VerificationClient({
	initialCharacters,
	initialSkills,
	initialTeams,
	initialItems,
}: VerificationClientProps) {
	const [activeTab, setActiveTab] = useState<TableType>("characters");
	const [loading, setLoading] = useState<Record<string, boolean>>({});
	const [savingAll, setSavingAll] = useState(false);

	// Maintain local state for modified fields
	const [data, setData] = useState({
		characters: initialCharacters,
		skills: initialSkills,
		teams: initialTeams,
		items: initialItems,
	});

	const supabase = createClient();

	const handleFieldChange = (table: TableType, id: string, field: string, value: string) => {
		setData((prev) => ({
			...prev,
			[table]: prev[table].map((row) =>
				row.id === id ? { ...row, [field]: value, _dirty: true } : row
			),
		}));
	};

	const saveRow = async (table: TableType, id: string) => {
		const row = data[table].find((r) => r.id === id);
		if (!row) return;

		setLoading((prev) => ({ ...prev, [id]: true }));

		let tableName = "inagle_characters";
		if (table === "skills") tableName = "inagle_skills";
		if (table === "teams") tableName = "inagle_teams";
		if (table === "items") tableName = "inagle_items";

		try {
			const payload: Record<string, any> = {
				name_fr: row.name_fr,
				description_fr: row.description_fr,
				updated_at: new Date().toISOString(),
			};

			const { error } = await supabase
				.from(tableName as any)
				.update(payload)
				.eq("id", id);

			if (error) throw error;

			setData((prev) => ({
				...prev,
				[table]: prev[table].map((r) => (r.id === id ? { ...r, _dirty: false } : r)),
			}));

			toast.success(`Enregistrement ${row.name_ja || row.name_en || id} mis à jour !`);
		} catch (err: any) {
			console.error(err);
			toast.error(`Erreur de sauvegarde : ${err.message}`);
		} finally {
			setLoading((prev) => ({ ...prev, [id]: false }));
		}
	};

	const saveAllDirty = async () => {
		const dirtyRows = data[activeTab].filter((row) => row._dirty);
		if (dirtyRows.length === 0) {
			toast.info("Aucune modification en attente.");
			return;
		}

		setSavingAll(true);
		let successCount = 0;

		let tableName = "inagle_characters";
		if (activeTab === "skills") tableName = "inagle_skills";
		if (activeTab === "teams") tableName = "inagle_teams";
		if (activeTab === "items") tableName = "inagle_items";

		for (const row of dirtyRows) {
			try {
				const payload: Record<string, any> = {
					name_fr: row.name_fr,
					description_fr: row.description_fr,
					updated_at: new Date().toISOString(),
				};

				const { error } = await supabase
					.from(tableName as any)
					.update(payload)
					.eq("id", row.id);

				if (error) throw error;
				successCount++;
			} catch (err) {
				console.error(`Error saving ${row.id}:`, err);
			}
		}

		// Refresh state
		setData((prev) => ({
			...prev,
			[activeTab]: prev[activeTab].map((row) =>
				row._dirty && dirtyRows.some((dr) => dr.id === row.id) ? { ...row, _dirty: false } : row
			),
		}));

		setSavingAll(false);
		toast.success(`${successCount} modification(s) enregistrée(s) avec succès !`);
	};

	const currentList = data[activeTab];
	const dirtyCount = currentList.filter((r) => r._dirty).length;

	const tabConfigs: Array<{ id: TableType; label: string; count: number }> = [
		{ id: "characters", label: "Joueurs", count: data.characters.length },
		{ id: "skills", label: "Techniques", count: data.skills.length },
		{ id: "teams", label: "Équipes", count: data.teams.length },
		{ id: "items", label: "Objets", count: data.items.length },
	];

	return (
		<div className="space-y-6">
			{/* Tabs selectors */}
			<div className="flex flex-wrap gap-2 border-b border-outline-variant/20 pb-4">
				{tabConfigs.map((tab) => (
					<Button
						key={tab.id}
						variant={activeTab === tab.id ? "default" : "outline"}
						className="rounded-full"
						onClick={() => setActiveTab(tab.id)}
					>
						{tab.label}
						{tab.count > 0 && (
							<Badge
								variant={activeTab === tab.id ? "secondary" : "outline"}
								className="ml-2 rounded-full font-bold px-2 py-0.5 text-[10px]"
							>
								{tab.count}
							</Badge>
						)}
					</Button>
				))}

				{dirtyCount > 0 && (
					<Button
						onClick={saveAllDirty}
						disabled={savingAll}
						className="ml-auto rounded-full bg-primary text-on-primary hover:bg-primary/95 shadow-md flex items-center gap-2"
					>
						{savingAll ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
						Enregistrer les {dirtyCount} modifications
					</Button>
				)}
			</div>

			{currentList.length === 0 ? (
				<div className="rounded-[32px] border border-outline-variant/10 p-12 bg-surface-container-lowest text-center">
					<div className="size-16 rounded-full bg-tertiary-container/30 text-tertiary flex items-center justify-center mx-auto mb-4">
						<Check size={28} />
					</div>
					<h3 className="text-lg font-bold text-on-surface">Tout est en ordre !</h3>
					<p className="text-sm text-on-surface-variant max-w-md mx-auto mt-2">
						Aucune anomalie de traduction ou de données manquantes n&apos;a été détectée dans cette
						catégorie.
					</p>
				</div>
			) : (
				<div className="rounded-[32px] border border-outline-variant/30 overflow-hidden bg-surface-container-lowest shadow-sm">
					<div className="overflow-x-auto">
						<Table>
							<TableHeader className="bg-surface-container-low/50">
								<TableRow className="border-outline-variant/10 hover:bg-transparent">
									<TableHead className="w-[100px] px-6 h-14 text-[10px] font-black uppercase tracking-widest text-on-surface-variant whitespace-nowrap">
										ID
									</TableHead>
									<TableHead className="w-[200px] h-14 text-[10px] font-black uppercase tracking-widest text-on-surface-variant whitespace-nowrap">
										Nom (JA / EN)
									</TableHead>
									<TableHead className="w-[250px] h-14 text-[10px] font-black uppercase tracking-widest text-on-surface-variant whitespace-nowrap">
										Nom Français (Traduction)
									</TableHead>
									<TableHead className="h-14 text-[10px] font-black uppercase tracking-widest text-on-surface-variant whitespace-nowrap">
										Description Française
									</TableHead>
									<TableHead className="text-right px-6 w-[100px] h-14 text-[10px] font-black uppercase tracking-widest text-on-surface-variant whitespace-nowrap">
										Actions
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{currentList.map((row) => (
									<TableRow
										key={row.id}
										className={`border-outline-variant/5 hover:bg-surface-container-low/30 transition-all duration-300 ${
											row._dirty ? "bg-primary/5 hover:bg-primary/10" : ""
										}`}
									>
										<TableCell className="px-6 py-4 font-mono text-xs text-on-surface-variant">
											{row.internal_code || row.id}
										</TableCell>
										<TableCell>
											<div className="flex flex-col">
												<span className="font-bold text-on-surface text-sm">
													{row.name_ja || "—"}
												</span>
												<span className="text-xs text-on-surface-variant">
													{row.name_en || "—"}
												</span>
											</div>
										</TableCell>
										<TableCell className="py-2">
											<Input
												value={row.name_fr || ""}
												onChange={(e) =>
													handleFieldChange(activeTab, row.id, "name_fr", e.target.value)
												}
												placeholder="Traduction du nom..."
												className="h-10 text-sm rounded-xl border-outline/30 focus:border-primary"
											/>
										</TableCell>
										<TableCell className="py-2">
											<Textarea
												value={row.description_fr || ""}
												onChange={(e) =>
													handleFieldChange(activeTab, row.id, "description_fr", e.target.value)
												}
												placeholder="Traduction de la description..."
												className="min-h-[40px] h-10 py-2 text-xs rounded-xl border-outline/30 focus:border-primary resize-y font-sans"
											/>
										</TableCell>
										<TableCell className="text-right px-6 py-2">
											<div className="flex items-center justify-end gap-2">
												{row._dirty && (
													<Button
														size="icon"
														variant="ghost"
														className="text-primary hover:bg-primary/10 size-10 rounded-full"
														onClick={() => saveRow(activeTab, row.id)}
														disabled={loading[row.id]}
													>
														{loading[row.id] ? (
															<Loader2 size={16} className="animate-spin" />
														) : (
															<Save size={16} />
														)}
													</Button>
												)}
												{row._dirty ? (
													<Badge
														variant="outline"
														className="border-primary/30 text-primary bg-primary/5 rounded-full font-bold text-[9px] uppercase tracking-wider"
													>
														Modifié
													</Badge>
												) : (
													<Badge
														variant="outline"
														className="border-outline-variant/30 text-on-surface-variant/60 rounded-full font-bold text-[9px] uppercase tracking-wider"
													>
														À jour
													</Badge>
												)}
											</div>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				</div>
			)}
		</div>
	);
}
