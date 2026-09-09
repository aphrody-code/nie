const noOp = async () => {};
const webWindow = { setTitle: noOp, minimize: noOp, toggleMaximize: noOp, close: noOp, startResizeDragging: noOp, isMaximized: async () => false, onResized: async () => () => {} };
export function getCurrentWindow() { return webWindow; }
