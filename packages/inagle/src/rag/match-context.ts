export async function buildMatchContext(inagle: any) {
	const battles = inagle.drops.getAllBattles();
	const matchContext = [];

	for (const [id, info] of battles.entries()) {
		const drops = inagle.drops.getTable(info.itemTableId);
		if (drops.length > 0) {
			matchContext.push({
				id: `0x${id.toString(16).toUpperCase()}`,
				tableId: info.itemTableId,
				drops: drops.map((d: any) => ({
					itemId: d.itemId,
					probability: d.probability,
					// Try to resolve item name
					name: inagle.items.getItem(d.itemId)?.name || `Item_${d.itemId}`,
				})),
			});
		}
	}

	return matchContext;
}
