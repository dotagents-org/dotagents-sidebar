// What the webview's scripts find in the page: the shared modules (each script declares one), the
// xterm.js bundles and what VS Code and the extension put there. Only for the type check.

declare const agentLayout: typeof import("../src/shared/layout.js");
declare const agentDrag: typeof import("../src/shared/drag.js");
declare const agentKeys: typeof import("../src/shared/keys.js");
declare const agentLinks: typeof import("./terminals/links.js");
declare const agentCwd: typeof import("./terminals/cwd.js");
declare const agentCanvasFont: typeof import("./terminals/canvas-font.js");

declare const Terminal: typeof import("@xterm/xterm").Terminal;
declare const FitAddon: typeof import("@xterm/addon-fit");
declare const WebglAddon: typeof import("@xterm/addon-webgl");
declare const WebLinksAddon: typeof import("@xterm/addon-web-links");

type VsCodeApi = { postMessage(message: unknown): void };
declare function acquireVsCodeApi(): VsCodeApi;

interface Window {
  acquireVsCodeApi(): VsCodeApi;
  DOTAGENTS_SIDEBAR_SETTINGS: any; // built by the extension (html() in src/extension.js)
  dotagentsAvatar: { mount(canvas: HTMLCanvasElement, options: { who: string; color: string; state: string; working: boolean; size: number }): unknown };
}
