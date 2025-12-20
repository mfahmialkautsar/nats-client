import { CommandContext } from "./context";

export function showOutput(ctx: CommandContext) {
  ctx.channelRegistry.main().show(true);
}
