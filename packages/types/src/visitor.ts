/**
 * Types liés au suivi des visiteurs (non-authentifiés ou anonymes).
 */

export interface VisitorInfo {
	ip?: string;
	userAgent?: string;
	country?: string;
	city?: string;
	isBot: boolean;
	firstSeen: string;
	lastSeen: string;
}

export interface PageView {
	path: string;
	referrer?: string;
	timestamp: string;
	durationMs?: number;
}

/** Tracking payload pour analytics interne. */
export interface VisitorTrack {
	visitorId: string; // UUID ou Fingerprint
	sessionId: string;
	page: PageView;
	info: VisitorInfo;
}
