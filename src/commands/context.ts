import type * as vscode from "vscode";
import type { NatsSession } from "@/services/nats-session";
import type { OutputChannelRegistry } from "@/services/output-channel-registry";
import type { VariableStore } from "@/services/variable-store";
import type { StatusBarController } from "@/platform/vscode/status-bar-controller";
import type { registerCodeLensProvider } from "@/features/code-lens/nats-code-lens-provider";

export interface CommandContext {
  context: vscode.ExtensionContext;
  session: NatsSession;
  channelRegistry: OutputChannelRegistry;
  variableStore: VariableStore;
  statusBar: StatusBarController;
  codeLensProvider: ReturnType<typeof registerCodeLensProvider>;
}
