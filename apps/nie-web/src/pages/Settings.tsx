/**
 * Host settings, with optional native Options row assets. Native PC setting effects
 * and screen placement remain separate from these existing host preferences.
 *
 * La page ne dessine rien : `SettingsScreen` vient du paquet partagé et demande lui-même à
 * l'hôte ce qu'il sait faire. Ce qui reste ici est ce qui appartient à CET hôte : la langue.
 * Sous nie, changer de langue n'est pas un état local — c'est une navigation entière,
 * servie par `nie-site` sous son préfixe (`/en/settings`, `/ja/settings`). La page aligne donc
 * le réglage `locale` sur l'URL à l'ouverture, et navigue quand « Appliquer » l'a changé.
 */
import {
	type Locale,
	SETTING_FAMILIES,
	type SettingFamily,
	SettingsScreen,
	getSettings,
	setSettings,
} from "@niers/inacord-ui";
import type { NativeMenuScene } from "@niers/inacord-ui/shell/native-title-menu";
import { useEffect, useState } from "react";
import { loadMenuPresentation } from "../game/bridge";
import { SETTINGS } from "../entries";
import { localeFromPrefix, pathForEntry, prefixForLocale } from "../routing";

export function Settings({ prefixe, onRetour }: { prefixe: string; onRetour: () => void }) {
	const [nativeScene, setNativeScene] = useState<NativeMenuScene>();
	const [nativeState, setNativeState] = useState<"loading" | "ready" | "unavailable">("loading");
	useEffect(() => {
		let mounted = true;
		void loadMenuPresentation("options-row").then(scene => {
			if (mounted) { setNativeScene(scene); setNativeState("ready"); }
		}, () => { if (mounted) setNativeState("unavailable"); });
		return () => { mounted = false; };
	}, []);
	// L'URL fait foi : un réglage `locale` qui contredirait la langue servie afficherait
	// « English » sur une page française.
	const localeServie = localeFromPrefix(prefixe);
	useEffect(() => {
		if (getSettings().locale !== localeServie) setSettings({ locale: localeServie });
	}, [localeServie]);

	// `?tab=display` ouvre directement un onglet : un lien profond, et le moyen de prouver au
	// `--dump-dom` que chaque famille rend bien ses lignes.
	const tab = new URLSearchParams(window.location.search).get("tab");
	const initialFamily = SETTING_FAMILIES.find((f) => f.id === tab)?.id as SettingFamily | undefined;

	return (
		<div style={{ position: "fixed", inset: 0 }} data-native-presentation={nativeState}>
			<SettingsScreen
				title="Réglages Inacord"
				nativeScene={nativeScene}
				initialFamily={initialFamily}
				onBack={onRetour}
				onApply={(reglages, changes) => {
					if (!changes.includes("locale")) return;
					const locale = reglages.locale as Locale;
					if (locale === localeServie) return;
					window.location.assign(pathForEntry(prefixForLocale(locale), SETTINGS));
				}}
			/>
		</div>
	);
}
