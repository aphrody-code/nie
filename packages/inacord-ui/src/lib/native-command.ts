/** Host event only. Native command meaning and cue selection remain in the Rust manifest. */
export const NATIVE_COMMAND_EVENT = "nie-native-command";

export interface NativeCommandDetail {
	/** Exact VFS path of the native object whose command was actually accepted. */
	objectPath: string;
	/** Original command identity, such as CMD_ENTER or CMD_FCS_NEXT. */
	command: string;
}

declare global {
	interface WindowEventMap {
		"nie-native-command": CustomEvent<NativeCommandDetail>;
	}
}

/** Notify a mounted browser/desktop host without introducing sound meanings into the UI. */
export function emitNativeCommand(objectPath: string, command: string): void {
	if (typeof window === "undefined") return;
	window.dispatchEvent(new CustomEvent<NativeCommandDetail>(NATIVE_COMMAND_EVENT, {
		detail: { objectPath, command },
	}));
}
