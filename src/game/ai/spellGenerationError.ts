import type { SpellStage } from "@/game/ai/spellLog";

/**
 * Typed error for the spell generation pipeline. Carries the originating
 * pipeline stage and (when available) the raw LLM output so the error UI can
 * surface diagnostic context and the repair loop can re-prompt.
 */
export class SpellGenerationError extends Error {
  readonly stage: SpellStage;
  readonly rawOutput?: string;
  readonly userMessage: string;
  readonly canRepair: boolean;

  constructor(opts: {
    stage: SpellStage;
    message: string;
    userMessage?: string;
    rawOutput?: string;
    cause?: unknown;
    canRepair?: boolean;
  }) {
    super(opts.message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "SpellGenerationError";
    this.stage = opts.stage;
    this.rawOutput = opts.rawOutput;
    this.userMessage = opts.userMessage ?? defaultUserMessage(opts.stage);
    this.canRepair = opts.canRepair ?? Boolean(opts.rawOutput);
  }
}

function defaultUserMessage(stage: SpellStage): string {
  switch (stage) {
    case "load":
      return "The Sage is still gathering breath. Try again in a moment.";
    case "concept":
      return "The Sage could not grasp the shape of your intent.";
    case "mechanics":
      return "The Sage glimpsed the form but failed to balance the forces.";
    case "visual":
      return "The Sage saw the spell but the colors slipped through their fingers.";
    case "compose":
      return "The Sage assembled the runes but they refused to lock together.";
    case "validate":
      return "The runes did not match the Sanctuary's laws.";
    case "repair":
      return "The Sage tried to mend the spell, but the cracks ran deep.";
    default:
      return "The Sage spoke in tongues we could not transcribe.";
  }
}
