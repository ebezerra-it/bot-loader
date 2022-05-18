/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import fs from 'fs';
import path from 'path';
import v8 from 'v8';

function isNumber(number: any): boolean {
  return (
    !Number.isNaN(Number.parseInt(String(number))) &&
    number !== null &&
    !Array.isArray(number) &&
    typeof number !== 'object'
  );
}

function structuredClone(obj: any): any {
  return v8.deserialize(v8.serialize(obj));
}

async function loadJSONConfigFile(
  jsonFileName: string,
): Promise<any | undefined> {
  const pathFileName = path.join(__dirname, '../../config', jsonFileName);
  return JSON.parse(fs.readFileSync(pathFileName, 'utf-8'));
}

async function loadJSONFile(
  jsonPathFileName: string,
): Promise<any | undefined> {
  return JSON.parse(fs.readFileSync(jsonPathFileName, 'utf-8'));
}

export { isNumber, structuredClone, loadJSONConfigFile, loadJSONFile };
