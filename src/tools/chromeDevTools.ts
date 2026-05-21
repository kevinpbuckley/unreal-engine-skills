import { Tool } from "@modelcontextprotocol/sdk/types.js";
import CDP from "chrome-remote-interface";

export class ChromeDevToolsTools {
  private clients: Map<string, any> = new Map();

  getTools(): Tool[] {
    return [
      {
        name: "chrome_connect",
        description: "Connect to Chrome DevTools Protocol",
        inputSchema: {
          type: "object",
          properties: {
            host: {
              type: "string",
              description: "Chrome debugger host",
              default: "localhost",
            },
            port: {
              type: "number",
              description: "Chrome debugger port",
              default: 9222,
            },
          },
        },
      },
      {
        name: "chrome_get_page_source",
        description: "Get current page source via Chrome DevTools",
        inputSchema: {
          type: "object",
          properties: {
            client_id: {
              type: "string",
              description: "Client connection ID",
            },
          },
          required: ["client_id"],
        },
      },
      {
        name: "chrome_evaluate",
        description: "Evaluate JavaScript in the page context",
        inputSchema: {
          type: "object",
          properties: {
            client_id: {
              type: "string",
              description: "Client connection ID",
            },
            expression: {
              type: "string",
              description: "JavaScript expression to evaluate",
            },
          },
          required: ["client_id", "expression"],
        },
      },
      {
        name: "chrome_screenshot",
        description: "Capture screenshot via Chrome DevTools",
        inputSchema: {
          type: "object",
          properties: {
            client_id: {
              type: "string",
              description: "Client connection ID",
            },
            format: {
              type: "string",
              enum: ["png", "jpeg"],
              default: "png",
            },
          },
          required: ["client_id"],
        },
      },
      {
        name: "chrome_set_viewport",
        description: "Set viewport size",
        inputSchema: {
          type: "object",
          properties: {
            client_id: {
              type: "string",
              description: "Client connection ID",
            },
            width: {
              type: "number",
              description: "Viewport width",
            },
            height: {
              type: "number",
              description: "Viewport height",
            },
          },
          required: ["client_id", "width", "height"],
        },
      },
      {
        name: "chrome_disconnect",
        description: "Disconnect from Chrome DevTools",
        inputSchema: {
          type: "object",
          properties: {
            client_id: {
              type: "string",
              description: "Client connection ID",
            },
          },
          required: ["client_id"],
        },
      },
    ];
  }

  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
    switch (name) {
      case "chrome_connect": {
        const host = (args.host as string) ?? "localhost";
        const port = (args.port as number) ?? 9222;

        try {
          const client = await CDP({ host, port });
          const clientId = `client_${Date.now()}`;
          this.clients.set(clientId, client);

          return {
            content: [
              {
                type: "text",
                text: `Connected to Chrome DevTools at ${host}:${port}. Client ID: ${clientId}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to connect to Chrome DevTools: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }

      case "chrome_get_page_source": {
        const clientId = args.client_id as string;
        const client = this.clients.get(clientId);

        if (!client) {
          return {
            content: [{ type: "text", text: `Client ${clientId} not found` }],
            isError: true,
          };
        }

        try {
          const { DOM } = client;
          const { root } = await DOM.getDocument();
          const html = await DOM.getOuterHTML({ nodeId: root.nodeId });

          return {
            content: [
              {
                type: "text",
                text: html || "No content available",
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error getting page source: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }

      case "chrome_evaluate": {
        const clientId = args.client_id as string;
        const expression = args.expression as string;
        const client = this.clients.get(clientId);

        if (!client) {
          return {
            content: [{ type: "text", text: `Client ${clientId} not found` }],
            isError: true,
          };
        }

        try {
          const { Runtime } = client;
          const result = await Runtime.evaluate({ expression });

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error evaluating expression: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }

      case "chrome_screenshot": {
        const clientId = args.client_id as string;
        const format = (args.format as string) ?? "png";
        const client = this.clients.get(clientId);

        if (!client) {
          return {
            content: [{ type: "text", text: `Client ${clientId} not found` }],
            isError: true,
          };
        }

        try {
          const { Page } = client;
          const screenshot = await Page.captureScreenshot({ format: format as any });

          return {
            content: [
              {
                type: "text",
                text: `Screenshot captured (${format}): ${screenshot.data.substring(0, 100)}...`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error capturing screenshot: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }

      case "chrome_set_viewport": {
        const clientId = args.client_id as string;
        const width = args.width as number;
        const height = args.height as number;
        const client = this.clients.get(clientId);

        if (!client) {
          return {
            content: [{ type: "text", text: `Client ${clientId} not found` }],
            isError: true,
          };
        }

        try {
          const { Emulation } = client;
          await Emulation.setDeviceMetricsOverride({
            width,
            height,
            deviceScaleFactor: 1,
            mobile: false,
          });

          return {
            content: [
              {
                type: "text",
                text: `Viewport set to ${width}x${height}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error setting viewport: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }

      case "chrome_disconnect": {
        const clientId = args.client_id as string;
        const client = this.clients.get(clientId);

        if (!client) {
          return {
            content: [{ type: "text", text: `Client ${clientId} not found` }],
            isError: true,
          };
        }

        try {
          await client.close();
          this.clients.delete(clientId);

          return {
            content: [
              {
                type: "text",
                text: `Disconnected from Chrome DevTools`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error disconnecting: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  }
}
