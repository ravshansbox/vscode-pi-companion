"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConnectionInfoSchema = exports.GotoRequestSchema = exports.ReadFileRequestSchema = exports.IdeContextNotificationSchema = exports.IdeContextSchema = exports.FileSchema = void 0;
const zod_1 = require("zod");
/**
 * A file that is open in the IDE.
 */
exports.FileSchema = zod_1.z.object({
    path: zod_1.z.string(),
    timestamp: zod_1.z.number(),
    isActive: zod_1.z.boolean().optional(),
    selectedText: zod_1.z.string().optional(),
    cursor: zod_1.z.object({
        line: zod_1.z.number(),
        character: zod_1.z.number(),
    }).optional(),
    content: zod_1.z.string().optional(),
});
/**
 * The context of the IDE.
 */
exports.IdeContextSchema = zod_1.z.object({
    workspaceState: zod_1.z.object({
        openFiles: zod_1.z.array(exports.FileSchema).optional(),
        isTrusted: zod_1.z.boolean().optional(),
        workspacePath: zod_1.z.string().optional(),
    }).optional(),
});
/**
 * A notification that the IDE context has been updated.
 */
exports.IdeContextNotificationSchema = zod_1.z.object({
    jsonrpc: zod_1.z.literal('2.0'),
    method: zod_1.z.literal('ide/contextUpdate'),
    params: exports.IdeContextSchema,
});
/**
 * Request to read a specific file.
 */
exports.ReadFileRequestSchema = zod_1.z.object({
    path: zod_1.z.string(),
});
/**
 * Request to goto a location in the IDE.
 */
exports.GotoRequestSchema = zod_1.z.object({
    path: zod_1.z.string(),
    line: zod_1.z.number().optional(),
    character: zod_1.z.number().optional(),
});
/**
 * Connection info written to temp file.
 */
exports.ConnectionInfoSchema = zod_1.z.object({
    port: zod_1.z.number(),
    workspacePath: zod_1.z.string(),
    authToken: zod_1.z.string(),
});
