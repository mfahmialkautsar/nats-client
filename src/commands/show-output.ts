import type { CommandContext } from "./context";
import { handleError } from "./utils";

export function showOutput(ctx: CommandContext) {
  try {
    ctx.channelRegistry.main().show(true);
  } catch (error) {
    handleError(ctx, error, "Show output failed");
  }
}
