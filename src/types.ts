import { z } from 'zod';

/**
 * A file that is open in the IDE.
 */
export const FileSchema = z.object({
  path: z.string(),
  timestamp: z.number(),
  isActive: z.boolean().optional(),
  selectedText: z.string().optional(),
  cursor: z.object({
    line: z.number(),
    character: z.number(),
  }).optional(),
  content: z.string().optional(),
});
export type File = z.infer<typeof FileSchema>;

/**
 * The context of the IDE.
 */
export const IdeContextSchema = z.object({
  workspaceState: z.object({
    openFiles: z.array(FileSchema).optional(),
    isTrusted: z.boolean().optional(),
    workspacePath: z.string().optional(),
  }).optional(),
});
export type IdeContext = z.infer<typeof IdeContextSchema>;

/**
 * A notification that the IDE context has been updated.
 */
export const IdeContextNotificationSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.literal('ide/contextUpdate'),
  params: IdeContextSchema,
});

/**
 * Request to read a specific file.
 */
export const ReadFileRequestSchema = z.object({
  path: z.string(),
});
export type ReadFileRequest = z.infer<typeof ReadFileRequestSchema>;

/**
 * Request to goto a location in the IDE.
 */
export const GotoRequestSchema = z.object({
  path: z.string(),
  line: z.number().optional(),
  character: z.number().optional(),
});
export type GotoRequest = z.infer<typeof GotoRequestSchema>;

/**
 * Connection info written to temp file.
 */
export const ConnectionInfoSchema = z.object({
  port: z.number(),
  workspacePath: z.string(),
  authToken: z.string(),
});
export type ConnectionInfo = z.infer<typeof ConnectionInfoSchema>;
