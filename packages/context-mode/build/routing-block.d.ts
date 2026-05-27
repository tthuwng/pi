import type { ToolNamer } from "./tool-naming.js";
export interface RoutingBlockOptions {
    includeCommands?: boolean;
}
export declare function createRoutingBlock(t: ToolNamer, options?: RoutingBlockOptions): string;
export declare function createReadGuidance(t: ToolNamer): string;
export declare function createGrepGuidance(t: ToolNamer): string;
export declare function createBashGuidance(t: ToolNamer): string;
