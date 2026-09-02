import { redirect } from "next/navigation";

/**
 * Ancienne troisième implémentation des réglages.
 *
 * Le wiki en avait deux (`/settings` et `/dashboard/settings`, via
 * `components/dashboard/settings-form.tsx`) qui éditaient les mêmes colonnes
 * avec des formulaires, des validations et des bogues différents. Tout est
 * regroupé sur `/settings`, qui partage désormais ses composants avec le site
 * principal ; ce chemin est conservé pour ne pas casser les liens existants.
 */
export default function DashboardSettingsPage() {
	redirect("/settings");
}
