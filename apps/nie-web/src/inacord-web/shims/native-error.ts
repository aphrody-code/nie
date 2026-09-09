export function unavailable(capability: string): Error {
	return new Error(`${capability} n’est pas disponible dans le mode navigateur. Installez l’application desktop.`);
}
