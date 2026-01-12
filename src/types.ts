import { z } from 'zod';

// Checkpoint within a segment
export const CheckpointSchema = z.object({
  id: z.string(),
  description: z.string(),
  completed: z.boolean().default(false)
});
export type Checkpoint = z.infer<typeof CheckpointSchema>;

// BUILD segment - create new functionality
export const BuildSegmentSchema = z.object({
  id: z.string(),
  type: z.literal('build'),
  title: z.string(),
  goldenCode: z.string(),
  targetFile: z.string(),
  explanation: z.string(),
  engineeringFocus: z.string(),
  checkpoints: z.array(CheckpointSchema)
});
export type BuildSegment = z.infer<typeof BuildSegmentSchema>;

// REFACTOR segment - fix working but "bad" code
export const RefactorSegmentSchema = z.object({
  id: z.string(),
  type: z.literal('refactor'),
  title: z.string(),
  startingCode: z.string(),
  goldenCode: z.string(),
  targetFile: z.string(),
  problem: z.string(),
  lesson: z.string(),
  checkpoints: z.array(CheckpointSchema)
});
export type RefactorSegment = z.infer<typeof RefactorSegmentSchema>;

// Discriminated union of segment types
export const SegmentSchema = z.discriminatedUnion('type', [
  BuildSegmentSchema,
  RefactorSegmentSchema
]);
export type Segment = z.infer<typeof SegmentSchema>;

// Full curriculum definition
export const CurriculumSchema = z.object({
  id: z.string(),
  projectName: z.string(),
  projectGoal: z.string(),
  workingDirectory: z.string(),
  segments: z.array(SegmentSchema),
  createdAt: z.string()
});
export type Curriculum = z.infer<typeof CurriculumSchema>;

// User progress state
export const StateSchema = z.object({
  curriculumPath: z.string().nullable(),
  currentSegmentIndex: z.number().default(0),
  completedSegments: z.array(z.string()),
  totalMinutesSpent: z.number().default(0),
  lastAccessedAt: z.string(),
  // Context summary from previous segment (for context pruning)
  previousSegmentSummary: z.string().optional()
});
export type State = z.infer<typeof StateSchema>;
export type TutorState = State; // Alias for clarity

// Pre-flight check result
export interface PreflightResult {
  ok: boolean;
  error?: string;
}

// Tool execution result
export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
}
