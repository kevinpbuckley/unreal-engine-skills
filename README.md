# Unreal Engine Skills MCP

An MCP (Model Context Protocol) server for Unreal Engine skills with Playwright and Chrome DevTools integration.

## Features

- **Playwright Integration**: Browser automation and testing capabilities (Chromium, Firefox, WebKit)
- **Chrome DevTools Protocol**: Direct integration with Chrome DevTools for advanced browser control
- **MCP Server**: Expose skills as tools via the Model Context Protocol

## Installation

```bash
npm install
npm run install-browsers
```

## Building

```bash
npm run build
```

## Running

Development mode:
```bash
npm run dev
```

Production mode:
```bash
npm start
```

## Available Tools

### Playwright Tools
- `playwright_launch_browser` - Launch a browser instance
- `playwright_navigate` - Navigate to a URL
- `playwright_screenshot` - Take a screenshot
- `playwright_get_content` - Get page HTML content
- `playwright_close_browser` - Close browser instance

### Chrome DevTools Tools
- `chrome_connect` - Connect to Chrome DevTools Protocol
- `chrome_get_page_source` - Get page source via CDT
- `chrome_evaluate` - Evaluate JavaScript in page context
- `chrome_screenshot` - Capture screenshot via CDT
- `chrome_set_viewport` - Set viewport size
- `chrome_disconnect` - Disconnect from CDT

## Project Structure

```
src/
├── server.ts          # Main MCP server
├── tools/
│   ├── playwright.ts  # Playwright tools
│   └── chromeDevTools.ts # Chrome DevTools tools
└── skills/            # Custom skills directory
```

## License

MIT
