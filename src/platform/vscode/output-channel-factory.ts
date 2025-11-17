import * as vscode from "vscode";
import {
  OutputChannelFactory,
  OutputChannelLike,
} from "@/services/output-channel-registry";

export function createVsCodeChannelFactory(): OutputChannelFactory {
  return (label: string): OutputChannelLike =>
    vscode.window.createOutputChannel(label);
}
