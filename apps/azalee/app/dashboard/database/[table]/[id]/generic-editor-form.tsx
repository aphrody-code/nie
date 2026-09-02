"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button, Input, Textarea } from "@rosegriffon/ui";
import { createClient } from "@/lib/supabase/client";

export function GenericEditorForm({ table, initialData }: { table: string; initialData: any }) {
	// We maintain local state for all fields
	const [formData, setFormData] = useState(initialData);
	const [loading, setLoading] = useState(false);
	const router = useRouter();
	const supabase = createClient();

	const handleChange = (key: string, value: any) => {
		setFormData((prev: any) => ({ ...prev, [key]: value }));
	};

	const handleSave = async () => {
		setLoading(true);
		try {
			// Prepare data (parse JSON fields)
			const payload = { ...formData };

			// Try to parse JSON strings back to objects if they were originally objects
			Object.keys(payload).forEach((key) => {
				const original = initialData[key];
				if (typeof original === "object" && original !== null) {
					try {
						payload[key] =
							typeof payload[key] === "string" ? JSON.parse(payload[key]) : payload[key];
					} catch (error) {
						toast.error(`JSON invalide dans le champ ${key}`);
						throw error;
					}
				}
			});

			const { error } = await supabase
				.from(table as any)
				.update(payload)
				.eq("id", initialData.id);

			if (error) {
				throw error;
			}

			toast.success("Enregistré !");
			router.refresh();
		} catch (error: any) {
			console.error(error);
			toast.error(`Erreur: ${error.message}`);
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="space-y-6">
			<div className="grid grid-cols-1 gap-6">
				{Object.keys(initialData).map((key) => {
					const val = initialData[key];
					const isJson = typeof val === "object" && val !== null;
					const isLong = typeof val === "string" && val.length > 50;

					return (
						<div key={key} className="space-y-2">
							<label className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
								{key}
							</label>
							{isJson ? (
								<Textarea
									className="font-mono text-xs min-h-[200px]"
									value={
										typeof formData[key] === "string"
											? formData[key]
											: JSON.stringify(formData[key], null, 2)
									}
									onChange={(e) => handleChange(key, e.target.value)}
								/>
							) : isLong ? (
								<Textarea
									value={formData[key] || ""}
									onChange={(e) => handleChange(key, e.target.value)}
								/>
							) : (
								<Input
									value={formData[key] || ""}
									onChange={(e) => handleChange(key, e.target.value)}
									disabled={key === "id"} // Usually PK is immutable
								/>
							)}
						</div>
					);
				})}
			</div>

			<div className="flex justify-end pt-6 border-t border-outline-variant/10">
				<Button onClick={handleSave} disabled={loading} className="rounded-full px-8">
					{loading ? "Enregistrement..." : "Enregistrer les modifications"}
				</Button>
			</div>
		</div>
	);
}
