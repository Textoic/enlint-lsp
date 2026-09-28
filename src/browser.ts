import {
  BrowserMessageReader,
  BrowserMessageWriter,
  createConnection,
} from "vscode-languageserver/browser";
import { createParser, type ParserData, type Parser } from "./parser.js";
import { attachLanguageServer, type ServerOptions } from "./server.js";

export * from "./index.js";

export type ParserUrls = { dictionary: string; weights: string };

const fetchJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load ${url}: ${response.status}`);
  }

  return response.json() as Promise<T>;
};

export const loadParserFrom = async (urls: ParserUrls): Promise<Parser> => {
  const [dictionary, weights] = await Promise.all([
    fetchJson<ParserData["dictionary"]>(urls.dictionary),
    fetchJson<ParserData["weights"]>(urls.weights),
  ]);
  return createParser({ dictionary, weights });
};

const once = <T>(load: () => Promise<T>) => {
  let loading: Promise<T> | undefined;
  return () => {
    loading ??= load();
    return loading;
  };
};

export const startWorkerServer = (
  urls: ParserUrls,
  options: Omit<ServerOptions, "parser"> = {},
) => {
  const scope = self as DedicatedWorkerGlobalScope;
  const connection = createConnection(
    new BrowserMessageReader(scope),
    new BrowserMessageWriter(scope),
  );
  const workspace = attachLanguageServer(connection, {
    ...options,
    parser: once(() => loadParserFrom(urls)),
  });
  connection.listen();
  return workspace;
};
