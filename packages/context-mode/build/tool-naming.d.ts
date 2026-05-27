export declare function getToolName(platform: string, bareTool: string): string;
export type ToolNamer = (bareTool: string) => string;
export declare function createToolNamer(platform: string): ToolNamer;
export declare const KNOWN_PLATFORMS: string[];
