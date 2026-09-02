"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Truck } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "../button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "../form";
import { Input } from "../input";
import type { AccountActionResult, AccountAddressValues } from "./types";

const schema = z.object({
	address_line1: z.string().optional(),
	address_line2: z.string().optional(),
	city: z.string().optional(),
	country: z.string().optional(),
	postal_code: z.string().optional(),
});

interface AccountAddressFormProps {
	values: AccountAddressValues;
	onSubmit: (values: AccountAddressValues) => Promise<AccountActionResult>;
}

/**
 * Adresse d'expédition.
 *
 * Le formulaire ne poste QUE ses propres champs : l'action serveur doit faire
 * une mise à jour partielle. La version précédente réinjectait `username`,
 * `full_name`, `bio`… lus côté client pour « préserver » le reste du profil —
 * un aller-retour qui écrasait ces colonnes par une chaîne vide dès que la
 * lecture initiale était partielle.
 */
export function AccountAddressForm({ values, onSubmit }: AccountAddressFormProps) {
	const form = useForm({ defaultValues: values, resolver: zodResolver(schema) });

	const submit = async (next: z.infer<typeof schema>) => {
		const t = toast.loading("Enregistrement de l'adresse…");
		try {
			const res = await onSubmit({
				address_line1: next.address_line1 ?? "",
				address_line2: next.address_line2 ?? "",
				city: next.city ?? "",
				country: next.country ?? "",
				postal_code: next.postal_code ?? "",
			});
			if (res?.error) {
				toast.error(res.error, { id: t });
				return;
			}
			toast.success("Adresse enregistrée.", { id: t });
			form.reset(next);
		} catch (error) {
			console.error("[compte] échec de l'enregistrement de l'adresse", error);
			toast.error("Erreur lors de l'enregistrement.", { id: t });
		}
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<Truck className="size-5 shrink-0 text-muted-foreground" aria-hidden />
					Adresse de livraison
				</CardTitle>
				<CardDescription>
					Utilisée pour les commandes de la boutique (goodies, contreparties Patreon). Privée :
					jamais affichée publiquement.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Form {...form}>
					<form onSubmit={form.handleSubmit(submit)} className="space-y-6">
						<FormField
							control={form.control}
							name="address_line1"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Adresse (ligne 1)</FormLabel>
									<FormControl>
										<Input placeholder="123 rue Inazuma" autoComplete="address-line1" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="address_line2"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Adresse (ligne 2)</FormLabel>
									<FormControl>
										<Input
											placeholder="Appartement, étage, bâtiment (facultatif)"
											autoComplete="address-line2"
											{...field}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
							<FormField
								control={form.control}
								name="postal_code"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Code postal</FormLabel>
										<FormControl>
											<Input placeholder="75001" autoComplete="postal-code" {...field} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={form.control}
								name="city"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Ville</FormLabel>
										<FormControl>
											<Input placeholder="Paris" autoComplete="address-level2" {...field} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
						</div>
						<FormField
							control={form.control}
							name="country"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Pays</FormLabel>
									<FormControl>
										<Input placeholder="France" autoComplete="country-name" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<div className="flex justify-end border-t border-border pt-6">
							<Button
								type="submit"
								disabled={form.formState.isSubmitting}
								className="rounded-full px-8"
							>
								{form.formState.isSubmitting ? "Enregistrement…" : "Enregistrer l'adresse"}
							</Button>
						</div>
					</form>
				</Form>
			</CardContent>
		</Card>
	);
}
