import * as vscode from "vscode";
import { NatsSession } from "@/services/nats-session";
import { OutputChannelRegistry } from "@/services/output-channel-registry";
import { VariableStore } from "@/services/variable-store";
import { StatusBarController } from "@/platform/vscode/status-bar-controller";
import { registerCodeLensProvider } from "@/features/code-lens/nats-code-lens-provider";

export interface CommandContext {
  context: vscode.ExtensionContext;
  session: NatsSession;
  channelRegistry: OutputChannelRegistry;
  variableStore: VariableStore;
  statusBar: StatusBarController;
  codeLensProvider: ReturnType<typeof registerCodeLensProvider>;
}
