#!/usr/bin/env node
import { startStdioServer } from "./index.js";

const dataFlag = process.argv.indexOf("--data");

startStdioServer(
  dataFlag === -1 ? {} : { dataDirectory: process.argv[dataFlag + 1] },
);
