import { unavailable } from "./native-error";
class WebMenu { async popup(): Promise<void> { throw unavailable("Les menus natifs"); } async close() {} }
export class Menu { static async new(_options: unknown): Promise<WebMenu> { return new WebMenu(); } }
export class PredefinedMenuItem { static async new(options: unknown): Promise<unknown> { return options; } }
