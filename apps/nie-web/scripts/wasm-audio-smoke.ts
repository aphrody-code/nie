/** Synthetic malformed HCA exercises the codec constructor without copyrighted fixtures. */
export function verifyAudioErrorRecovery(bindings: {
	audio_to_wav(bytes: Uint8Array): Uint8Array;
	detect_format(bytes: Uint8Array): string;
}): void {
	let rejected = false;
	try {
		bindings.audio_to_wav(new Uint8Array([72, 67, 65, 0, 2, 0, 0, 8]));
	} catch (error) {
		// A wasm trap is not a codec error: it can leave the shared stack pointer corrupted.
		if (typeof error !== "string" || !error.startsWith("HCA init:")) throw error;
		rejected = true;
	}
	if (!rejected) throw new Error("Malformed HCA was accepted");
	if (bindings.detect_format(new Uint8Array()) !== "?") {
		throw new Error("Audio failure corrupted the shared WASM runtime");
	}
}
