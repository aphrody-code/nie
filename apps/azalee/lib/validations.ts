import { z } from "zod";

export const searchParamsSchema = z.object({
	ageGroup: z.string().optional(),
	category: z.string().optional(),
	element: z.string().optional(),
	gender: z.string().optional(),
	grade: z.string().optional(),
	has_video: z.string().optional(),
	overdrive: z.string().optional(),
	page: z
		.string()
		.transform((val) => Math.max(1, parseInt(val, 10)))
		.optional()
		.default(1),
	pcat: z.string().optional(),
	perPage: z
		.string()
		.transform((val) => {
			const n = parseInt(val, 10);
			return [10, 20, 50, 200].includes(n) ? n : 20;
		})
		.optional(),
	playstyle: z.string().optional(),
	position: z.string().optional(),
	power_max: z.string().optional(),
	power_min: z.string().optional(),
	q: z.string().optional().default(""),
	rarity: z.string().optional(),
	role: z.string().optional(),
	series: z.string().optional(),
	show_aura: z.string().optional(),
	sort: z.string().optional(),
	status: z.string().optional(),
	tab: z.string().optional(),
	team: z.string().optional(),
	type: z.string().optional(),
	view: z.string().optional(),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;

export function parseSearchParams(params: unknown): SearchParams {
	const result = searchParamsSchema.safeParse(params);
	if (!result.success) {
		return {
			page: 1,
			q: "",
		};
	}
	return result.data;
}
