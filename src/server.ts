import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { PlaywrightTools } from "./tools/playwright.js";
import { ChromeDevToolsTools } from "./tools/chromeDevTools.js";

const server = new Server({
  name: "unreal-engine-skills",
  version: "1.0.0",
});

const playwrightTools = new PlaywrightTools();
const chromeDevToolsTools = new ChromeDevToolsTools();

// Register tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools: Tool[] = [
    ...playwrightTools.getTools(),
    ...chromeDevToolsTools.getTools(),
  ];
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = request.params.arguments || {};

  try {
    // Route to appropriate tool handler
    if (name.startsWith("playwright_")) {
      return await playwrightTools.callTool(name, args as Record<string, unknown>);
    } else if (name.startsWith("chrome_")) {
      return await chromeDevToolsTools.callTool(name, args as Record<string, unknown>);
    }

    return {
      content: [
        {
          type: "text",
          text: `Unknown tool: ${name}`,
        },
      ],
      isError: true,
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Unreal Engine Skills MCP server running on stdio");
}

main().catch(console.error);
