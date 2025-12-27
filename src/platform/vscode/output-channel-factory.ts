import * as vscode from "vscode";
import type {
  OutputChannelFactory,
  OutputChannelLike,
} from "@/services/output-channel-registry";

export function createVsCodeChannelFactory(): OutputChannelFactory {
  return (label: string): OutputChannelLike =>
    vscode.window.createOutputChannel(label);
}
