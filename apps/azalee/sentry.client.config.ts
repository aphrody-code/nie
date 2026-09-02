import * as Sentry from "@sentry/nextjs";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
	Sentry.init({
		debug: false,
		dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
		environment: process.env.NODE_ENV || "development",
		replaysOnErrorSampleRate: 1.0,
		replaysSessionSampleRate: 0.1,
		tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
	});
}
