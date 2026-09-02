import { IPinfoWrapper } from "node-ipinfo";

const { IPINFO_TOKEN } = process.env;

// Initialize wrapper only if token is present
const ipinfoWrapper = IPINFO_TOKEN ? new IPinfoWrapper(IPINFO_TOKEN) : null;

export interface IPIntelligenceData {
	ip: string;
	city?: string;
	region?: string;
	country?: string;
	loc?: string;
	org?: string;
	postal?: string;
	timezone?: string;
	privacy?: {
		vpn: boolean;
		proxy: boolean;
		tor: boolean;
		relay?: boolean;
		hosting?: boolean;
	};
	asn?: {
		asn: string;
		name: string;
		domain?: string;
		route?: string;
		type?: string;
	};
	company?: {
		name: string;
		domain?: string;
		type?: string;
	};
}

/**
 * Enriches an IP address with geolocation and risk data.
 * Returns null if the lookup fails or token is missing.
 */
export async function getIPIntelligence(ip: string): Promise<IPIntelligenceData | null> {
	// Skip localhost or private IPs usually, but ipinfo handles some locally.
	// For local dev, return mock data.
	if (process.env.NODE_ENV === "development" && (ip === "::1" || ip === "127.0.0.1")) {
		return {
			city: "Localhost",
			country: "Devland",
			ip,
			privacy: { proxy: false, tor: false, vpn: false },
		};
	}

	if (!ipinfoWrapper) {
		// Graceful fallback if no token is configured
		console.warn("IPINFO_TOKEN not set. IP Intelligence skipped.");
		return null;
	}

	try {
		const data = await ipinfoWrapper.lookupIp(ip);

		// Normalize data structure
		return {
			asn: data.asn,
			city: data.city,
			company: data.company,
			country: data.country,
			ip: data.ip,
			loc: data.loc,
			org: data.org,
			postal: data.postal,
			privacy: data.privacy
				? {
						vpn: data.privacy.vpn || false,
						proxy: data.privacy.proxy || false,
						tor: data.privacy.tor || false,
						relay: data.privacy.relay || false,
						hosting: data.privacy.hosting || false,
					}
				: undefined,
			region: data.region,
			timezone: data.timezone,
		};
	} catch (error) {
		console.error(`Error looking up IP ${ip}:`, error);
		return null;
	}
}
