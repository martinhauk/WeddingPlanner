import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { type Diagnostic, error } from './diagnostics.ts';

export type JsonRead = { readonly ok: true; readonly value: unknown } | { readonly ok: false };

/**
 * Reads `<dir>/<file>` as JSON. A missing file or invalid JSON adds a diagnostic (without any
 * content of the file) and returns `{ ok: false }`; other I/O errors are thrown.
 */
export async function readJson(
  dir: string,
  file: string,
  diagnostics: Diagnostic[],
): Promise<JsonRead> {
  let text: string;
  try {
    text = await readFile(path.join(dir, file), 'utf8');
  } catch (cause) {
    const code = cause instanceof Error && 'code' in cause ? cause.code : undefined;
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') {
      diagnostics.push(error('E_FILE_MISSING', file, '$', 'file not found'));
      return { ok: false };
    }
    throw cause;
  }
  try {
    return { ok: true, value: JSON.parse(text.replace(/^﻿/, '')) };
  } catch {
    // The parser's message can quote file content, so it is not passed on.
    diagnostics.push(error('E_JSON', file, '$', 'is not valid JSON'));
    return { ok: false };
  }
}
