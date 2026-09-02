/**
 * Adapter exports
 *
 * - `hono.js` - Original adapter (compatible mode)
 * - `hono-rpc.js` - New RPC adapter with Zod 4 validation
 *
 * @example RPC Usage
 * ```typescript
 * import { createHonoApp, type InagleApp } from '@rosegriffon/inagle/adapters/hono-rpc'
 * import { hc } from 'hono/client'
 *
 * const app = createHonoApp({ characters, skills })
 * const client = hc<InagleApp>('http://localhost:3000')
 * ```
 */

// Hono adapter
export { createInagleAppAsync, type InagleApp } from "./hono.js";

// Hono RPC Adapter (Zod Validated)
/*
export {
	createInagleRPCApp,
	formatZodError,
	type InagleContext as InagleRPCContext,
	type InagleRPCApp,
	toJSONSchema,
} from "./hono-rpc.js";
*/
