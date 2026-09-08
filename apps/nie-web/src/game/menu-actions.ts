import type { MenuEntry } from "../entries";
import type { MainMenuAction } from "../pages/MainMenu";

export interface MenuActionBinding {
	/** Stable host control identity, independent of localized route segments. */
	id: string;
	onActivate: () => void;
}

/**
 * Binds published catalogue entries to implemented host destinations. The catalogue owns
 * presentation/order; a missing host binding never becomes an invented navigation action.
 * This is host navigation, not a mapping of native Lua menu commands.
 */
export function bindMenuActions(
	entries: readonly MenuEntry[],
	bindings: Readonly<Record<string, MenuActionBinding | undefined>>,
): MainMenuAction[] {
	return entries.flatMap((entry) => {
		const binding = Object.hasOwn(bindings, entry.route) ? bindings[entry.route] : undefined;
		return binding ? [{ ...binding, label: entry.label, glyph: entry.glyph }] : [];
	});
}
