export const CAN_USE_DOM: boolean =
	typeof window !== "undefined" &&
	window.document !== undefined &&
	window.document.createElement !== undefined;
