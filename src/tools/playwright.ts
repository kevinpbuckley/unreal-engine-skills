import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { chromium, firefox, webkit } from "playwright";

export class PlaywrightTools {
  private browsers: Map<string, any> = new Map();
  private pages: Map<string, any> = new Map();

  getTools(): Tool[] {
    return [
      {
        name: "playwright_launch_browser",
        description: "Launch a browser instance (chromium, firefox, or webkit)",
        inputSchema: {
          type: "object",
          properties: {
            browser_type: {
              type: "string",
              enum: ["chromium", "firefox", "webkit"],
              description: "Type of browser to launch",
            },
            headless: {
              type: "boolean",
              description: "Run in headless mode",
              default: true,
            },
          },
          required: ["browser_type"],
        },
      },
      {
        name: "playwright_navigate",
        description: "Navigate to a URL",
        inputSchema: {
          type: "object",
          properties: {
            browser_id: {
              type: "string",
              description: "Browser instance ID",
            },
            url: {
              type: "string",
              description: "URL to navigate to",
            },
            wait_until: {
              type: "string",
              enum: ["load", "domcontentloaded", "networkidle"],
              default: "load",
            },
          },
          required: ["browser_id", "url"],
        },
      },
      {
        name: "playwright_screenshot",
        description: "Take a screenshot of the current page",
        inputSchema: {
          type: "object",
          properties: {
            browser_id: {
              type: "string",
              description: "Browser instance ID",
            },
            path: {
              type: "string",
              description: "Path to save screenshot",
            },
            full_page: {
              type: "boolean",
              description: "Capture full page",
              default: false,
            },
          },
          required: ["browser_id"],
        },
      },
      {
        name: "playwright_get_content",
        description: "Get page HTML content",
        inputSchema: {
          type: "object",
          properties: {
            browser_id: {
              type: "string",
              description: "Browser instance ID",
            },
          },
          required: ["browser_id"],
        },
      },
      {
        name: "playwright_close_browser",
        description: "Close browser instance",
        inputSchema: {
          type: "object",
          properties: {
            browser_id: {
              type: "string",
              description: "Browser instance ID",
            },
          },
          required: ["browser_id"],
        },
      },
    ];
  }

  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
    switch (name) {
      case "playwright_launch_browser": {
        const browserType = args.browser_type as string;
        const headless = (args.headless as boolean) ?? true;

        let browser;
        if (browserType === "chromium") {
          browser = await chromium.launch({ headless });
        } else if (browserType === "firefox") {
          browser = await firefox.launch({ headless });
        } else if (browserType === "webkit") {
          browser = await webkit.launch({ headless });
        }

        const browserId = `browser_${Date.now()}`;
        this.browsers.set(browserId, browser);

        return {
          content: [
            {
              type: "text",
              text: `Browser launched successfully. Browser ID: ${browserId}`,
            },
          ],
        };
      }

      case "playwright_navigate": {
        const browserId = args.browser_id as string;
        const url = args.url as string;
        const waitUntil = (args.wait_until as string) ?? "load";

        const browser = this.browsers.get(browserId);
        if (!browser) {
          return {
            content: [{ type: "text", text: `Browser ${browserId} not found` }],
            isError: true,
          };
        }

        const page = await browser.newPage();
        await page.goto(url, { waitUntil: waitUntil as any });

        const pageId = `page_${Date.now()}`;
        this.pages.set(pageId, page);

        return {
          content: [
            {
              type: "text",
              text: `Navigated to ${url}. Page ID: ${pageId}`,
            },
          ],
        };
      }

      case "playwright_screenshot": {
        const browserId = args.browser_id as string;
        const path = args.path as string | undefined;
        const fullPage = (args.full_page as boolean) ?? false;

        const browser = this.browsers.get(browserId);
        if (!browser) {
          return {
            content: [{ type: "text", text: `Browser ${browserId} not found` }],
            isError: true,
          };
        }

        const pages = await browser.contexts()[0]?.pages() || [];
        if (pages.length === 0) {
          return {
            content: [{ type: "text", text: "No page found" }],
            isError: true,
          };
        }

        const screenshot = await pages[0].screenshot({ path, fullPage });
        return {
          content: [
            {
              type: "text",
              text: `Screenshot taken successfully${path ? ` and saved to ${path}` : ""}`,
            },
          ],
        };
      }

      case "playwright_get_content": {
        const browserId = args.browser_id as string;

        const browser = this.browsers.get(browserId);
        if (!browser) {
          return {
            content: [{ type: "text", text: `Browser ${browserId} not found` }],
            isError: true,
          };
        }

        const pages = await browser.contexts()[0]?.pages() || [];
        if (pages.length === 0) {
          return {
            content: [{ type: "text", text: "No page found" }],
            isError: true,
          };
        }

        const content = await pages[0].content();
        return {
          content: [
            {
              type: "text",
              text: content,
            },
          ],
        };
      }

      case "playwright_close_browser": {
        const browserId = args.browser_id as string;

        const browser = this.browsers.get(browserId);
        if (!browser) {
          return {
            content: [{ type: "text", text: `Browser ${browserId} not found` }],
            isError: true,
          };
        }

        await browser.close();
        this.browsers.delete(browserId);

        return {
          content: [
            {
              type: "text",
              text: `Browser ${browserId} closed successfully`,
            },
          ],
        };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  }
}
