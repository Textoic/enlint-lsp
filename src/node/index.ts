import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import { createConnection, ProposedFeatures } from "vscode-languageserver/node";
import type { TextoicConfig } from "../config.js";
import { createParser, type Parser, type ParserData } from "../parser.js";
import { attachLanguageServer, type ServerOptions } from "../server.js";

export * from "../index.js";

export const configFileNames = ["textoic.config.json", ".textoicrc.json"];

const readJson = async <T>(path: string): Promise<T> =>
  JSON.parse(await readFile(path, "utf8")) as T;

const artisanFile = (name: string) =>
  fileURLToPath(import.meta.resolve(`@textoic/artisan/${name}`));

export const loadParser = async (dataDirectory?: string): Promise<Parser> => {
  const locate = (name: string) =>
    dataDirectory == null ? artisanFile(name) : join(dataDirectory, name);
  const [dictionary, weights] = await Promise.all([
    readJson<ParserData["dictionary"]>(locate("dictionary.json")),
    readJson<ParserData["weights"]>(locate("weights.json")),
  ]);
  return createParser({ dictionary, weights });
};

const configIn = (directory: string) =>
  configFileNames
    .map((name) => join(directory, name))
    .find((path) => existsSync(path));

export const findConfigFile = (from: string): string | undefined => {
  const found = configIn(from);
  const parent = dirname(from);
  if (found != null || parent === from || parse(from).root === from) {
    return found;
  }

  return findConfigFile(parent);
};

const isFileUri = (uri: string) => uri.startsWith("file:");

export const projectConfigFor = async (
  uri: string,
): Promise<TextoicConfig | undefined> => {
  if (!isFileUri(uri)) {
    return undefined;
  }

  const path = findConfigFile(dirname(fileURLToPath(uri)));
  return path == null ? undefined : readJson<TextoicConfig>(path);
};

const once = <T>(load: () => Promise<T>) => {
  let loading: Promise<T> | undefined;
  return () => {
    loading ??= load();
    return loading;
  };
};

export type StdioOptions = Partial<ServerOptions> & { dataDirectory?: string };

export const startStdioServer = ({
  dataDirectory,
  ...options
}: StdioOptions = {}) => {
  const connection = createConnection(ProposedFeatures.all);
  const workspace = attachLanguageServer(connection, {
    parser: once(() => loadParser(dataDirectory)),
    projectConfig: projectConfigFor,
    ...options,
  });
  connection.listen();
  return workspace;
};
