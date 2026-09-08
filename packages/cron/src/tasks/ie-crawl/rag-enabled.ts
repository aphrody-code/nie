/**
 * Interrupteur d'exploitation pour l'ancien pipeline RAG.
 *
 * Le défaut reste actif pour préserver les environnements de développement et
 * les commandes historiques. La production pose explicitement `RAG_ENABLED=0`
 * dans `nie-cron.service` depuis le retrait du sidecar et du store locaux.
 */
export function ragEnabled(): boolean {
	const value = process.env.RAG_ENABLED?.trim().toLowerCase();
	return value !== "0" && value !== "false" && value !== "off";
}
