import * as vscode from "vscode";
import { NatsSession } from "@/services/nats-session";
import {
  OutputChannelLike,
  OutputChannelRegistry,
} from "@/services/output-channel-registry";
import { NatsAction, NatsActionType } from "@/core/nats-actions";

interface JetStreamCommandDependencies {
  session: NatsSession;
  channelRegistry: OutputChannelRegistry;
  defaultTimeoutMs: number;
  resolveAction(
    filePath: string,
    line: number,
    type?: NatsActionType,
  ): Promise<NatsAction | undefined>;
  resolveText(value: string): string;
  resolveServer(value: string | undefined): string | undefined;
  register(
    command: string,
    callback: (...args: any[]) => Thenable<void> | void,
  ): void;
}

export function registerJetStreamPullCommand(
  deps: JetStreamCommandDependencies,
): void {
  deps.register(
    "nats.jetStreamPull",
    async (filePath: string, line: number) => {
      const action = await deps.resolveAction(filePath, line, "jetstreamPull");
      if (
        !action ||
        action.type !== "jetstreamPull" ||
        !action.stream ||
        !action.durable
      ) {
        vscode.window.showErrorMessage(
          "JETSTREAM action not found on this line",
        );
        return;
      }
      const server = deps.resolveServer(action.server);
      if (!server) {
        vscode.window.showErrorMessage(
          "JETSTREAM block is missing a NATS-Server value or inline URL",
        );
        return;
      }
      const stream = deps.resolveText(action.stream);
      const durable = deps.resolveText(action.durable);
      const sink: OutputChannelLike = deps.channelRegistry.main();
      sink.show(true);
      await deps.session.pullJetStream(
        server,
        stream,
        durable,
        {
          batchSize: action.batchSize ?? 1,
          timeoutMs: action.timeoutMs ?? deps.defaultTimeoutMs,
        },
        sink,
      );
      vscode.window.showInformationMessage(
        `JetStream pull executed for ${stream}/${durable}`,
      );
    },
  );
}
