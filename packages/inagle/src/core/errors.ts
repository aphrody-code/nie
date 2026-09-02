/**
 * @file errors.ts
 * @description Gestion d'erreurs structurée pour @/lib/inagle
 */

/**
 * Codes d'erreur pour le package inagle
 */
export const InagleErrorCode = {
	// Erreurs de chargement de données
	DATA_NOT_FOUND: "DATA_NOT_FOUND",
	DATA_PARSE_ERROR: "DATA_PARSE_ERROR",
	DATA_VALIDATION_ERROR: "DATA_VALIDATION_ERROR",

	// Erreurs de configuration
	CONFIG_MISSING: "CONFIG_MISSING",
	CONFIG_INVALID: "CONFIG_INVALID",
	PATH_NOT_FOUND: "PATH_NOT_FOUND",

	// Erreurs d'API
	API_INIT_FAILED: "API_INIT_FAILED",
	ENTITY_NOT_FOUND: "ENTITY_NOT_FOUND",
	INVALID_PARAMETER: "INVALID_PARAMETER",

	// Erreurs de parsing
	PARSER_ERROR: "PARSER_ERROR",
	BINARY_FORMAT_ERROR: "BINARY_FORMAT_ERROR",
	JSON_FORMAT_ERROR: "JSON_FORMAT_ERROR",

	// Erreurs réseau (Zukan)
	NETWORK_ERROR: "NETWORK_ERROR",
	SCRAPING_ERROR: "SCRAPING_ERROR",
} as const;

export type InagleErrorCodeType = (typeof InagleErrorCode)[keyof typeof InagleErrorCode];

/**
 * Interface pour les détails d'erreur
 */
export interface InagleErrorDetails {
	/** Chemin du fichier concerné */
	filePath?: string;
	/** ID de l'entité concernée */
	entityId?: string;
	/** Type d'entité */
	entityType?: string;
	/** Données supplémentaires */
	data?: unknown;
	/** Message d'aide */
	hint?: string;
}

/**
 * Classe d'erreur personnalisée pour inagle
 *
 * @example
 * ```ts
 * throw new InagleError(
 *   InagleErrorCode.DATA_NOT_FOUND,
 *   "Character data file not found",
 *   { filePath: "chara_base.json", hint: "Run data extraction first" }
 * );
 * ```
 */
export class InagleError extends Error {
	public readonly code: InagleErrorCodeType;
	public readonly details?: InagleErrorDetails;
	public readonly timestamp: Date;
	public override readonly cause?: Error;

	constructor(
		code: InagleErrorCodeType,
		message: string,
		details?: InagleErrorDetails,
		cause?: Error
	) {
		super(message);
		this.name = "InagleError";
		this.code = code;
		this.details = details;
		this.timestamp = new Date();
		this.cause = cause;

		// Maintient la stack trace correcte en V8
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, InagleError);
		}
	}

	/**
	 * Formatte l'erreur pour les logs
	 */
	toLogString(): string {
		const parts = [`[Inagle] ${this.code}: ${this.message}`];

		if (this.details) {
			if (this.details.filePath) {
				parts.push(`  File: ${this.details.filePath}`);
			}
			if (this.details.entityId) {
				parts.push(`  Entity: ${this.details.entityType || "unknown"}#${this.details.entityId}`);
			}
			if (this.details.hint) {
				parts.push(`  Hint: ${this.details.hint}`);
			}
		}

		return parts.join("\n");
	}

	/**
	 * Convertit en objet JSON sérialisable
	 */
	toJSON(): Record<string, unknown> {
		return {
			name: this.name,
			code: this.code,
			message: this.message,
			details: this.details,
			timestamp: this.timestamp.toISOString(),
			stack: this.stack,
		};
	}
}

/**
 * Type guard pour vérifier si une erreur est une InagleError
 */
export function isInagleError(error: unknown): error is InagleError {
	return error instanceof InagleError;
}

/**
 * Wrappe une erreur inconnue en InagleError
 */
export function wrapError(
	error: unknown,
	code: InagleErrorCodeType,
	context?: string
): InagleError {
	if (isInagleError(error)) {
		return error;
	}

	const message = error instanceof Error ? error.message : String(error);
	const fullMessage = context ? `${context}: ${message}` : message;
	const cause = error instanceof Error ? error : undefined;

	return new InagleError(code, fullMessage, undefined, cause);
}

/**
 * Logger structuré pour inagle
 */
export const inagleLogger = {
	warn(code: InagleErrorCodeType, message: string, details?: InagleErrorDetails): void {
		console.warn(`[Inagle] ${code}: ${message}`, details ?? "");
	},

	error(error: InagleError): void {
		console.error(error.toLogString());
		if (error.cause) {
			console.error("  Caused by:", error.cause);
		}
	},

	info(message: string): void {
		console.info(`[Inagle] ${message}`);
	},

	debug(message: string, data?: unknown): void {
		if (process.env.INAGLE_DEBUG === "true") {
			console.debug(`[Inagle Debug] ${message}`, data ?? "");
		}
	},
};
